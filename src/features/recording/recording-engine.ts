import type { RecordingRecord } from '../workspace/workspace-store';
import { checkRecordingCapabilities } from './recording-capabilities';
import { finalizeRecordingSession, type FinalizeRecordingResult } from './recording-finalizer';
import { RecordingStore } from './recording-store';
import {
  generateRecordingId,
  type ArchiveChunkRecord,
  type BrowserCapabilities,
  type RecordingEngineEvents,
  type RecordingEngineState,
  type RecordingErrorCode,
  type RecordingError,
  type RecordingSession,
  type RecordingStateStatus,
  type TranscriptionSegmentRecord,
} from './recording-types';
import type { DialogSegment } from '../../lib/transcript';

export const SEGMENT_CORE_SECONDS = 60;
export const SEGMENT_OVERLAP_SECONDS = 5;

export interface RecordingEngineOptions {
  store?: RecordingStore;
  capabilities?: BrowserCapabilities;
  segmentCoreSeconds?: number;
  segmentOverlapSeconds?: number;
  getMediaStream?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  saveToWorkspaceFn?: (
    recording: RecordingRecord,
    audioBlob: Blob,
    segments: DialogSegment[],
    speakerNames: Record<string, string>
  ) => Promise<void>;
}

interface SegmentRecorderRuntime {
  id: string;
  segmentIndex: number;
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
  status: 'starting' | 'active' | 'stopping' | 'stopped';
  plannedStartSec: number;
  plannedCoreDurationSec: number;
  overlapSec: number;
  activeRecordedMs: number;
  lastResumePerfMs: number | null;
  rotationTimerId: ReturnType<typeof setTimeout> | null;
  overlapTimerId: ReturnType<typeof setTimeout> | null;
  stopPromise: Promise<void>;
  resolveStop: () => void;
}

export class RecordingEngine {
  private store: RecordingStore;
  private capabilities: BrowserCapabilities;
  private segmentCoreSec: number;
  private segmentOverlapSec: number;
  private getMediaStream: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private saveToWorkspaceFn?: (
    recording: RecordingRecord,
    audioBlob: Blob,
    segments: DialogSegment[],
    speakerNames: Record<string, string>
  ) => Promise<void>;

  private status: RecordingStateStatus = 'idle';
  private sessionId: string | null = null;
  private targetProjectId = 'project-default';
  private sessionTitle = 'Rekaman Rapat';

  private stream: MediaStream | null = null;
  private archiveRecorder: MediaRecorder | null = null;
  private activeRecorders = new Map<string, SegmentRecorderRuntime>();
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private activeSegmentIndex = 0;

  private archiveChunkIndex = 0;
  private archiveTotalBytes = 0;

  // Lifecycle & Concurrency Guards
  private sessionGeneration = 0;
  private terminalCleanupPromise: Promise<void> | null = null;

  // Monotonic Duration Tracking
  private startPerfMs: number | null = null;
  private totalPausedDurationMs = 0;
  private currentPauseStartMs: number | null = null;
  private isPaused = false;

  private error: RecordingError | null = null;
  private events: RecordingEngineEvents = {};

  constructor(options: RecordingEngineOptions = {}) {
    this.store = options.store ?? new RecordingStore();
    this.capabilities = options.capabilities ?? checkRecordingCapabilities();
    this.segmentCoreSec = options.segmentCoreSeconds ?? SEGMENT_CORE_SECONDS;
    this.segmentOverlapSec = options.segmentOverlapSeconds ?? SEGMENT_OVERLAP_SECONDS;
    this.saveToWorkspaceFn = options.saveToWorkspaceFn;
    this.getMediaStream = options.getMediaStream ?? (
      typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
        ? constraints => navigator.mediaDevices.getUserMedia(constraints)
        : () => Promise.reject(new Error('navigator.mediaDevices.getUserMedia tidak tersedia'))
    );
  }

  setEvents(events: RecordingEngineEvents): void {
    this.events = events;
  }

  getState(): RecordingEngineState {
    return {
      status: this.status,
      sessionId: this.sessionId,
      activeDurationMs: this.getActiveDurationMs(),
      archiveTotalBytes: this.archiveTotalBytes,
      segmentCount: this.activeSegmentIndex,
      pendingWrites: this.store.getPendingWriteCount(),
      error: this.error,
    };
  }

  getCapabilities(): BrowserCapabilities {
    return this.capabilities;
  }

  getActiveDurationMs(): number {
    if (this.startPerfMs === null) return 0;
    const now = performance.now();
    let uncommittedPause = 0;
    if (this.isPaused && this.currentPauseStartMs !== null) {
      uncommittedPause = Math.max(0, now - this.currentPauseStartMs);
    }
    const elapsed = now - this.startPerfMs;
    return Math.max(0, Math.round(elapsed - (this.totalPausedDurationMs + uncommittedPause)));
  }

  private transition(newStatus: RecordingStateStatus, err?: RecordingError): void {
    this.status = newStatus;
    if (err !== undefined) {
      this.error = err;
    } else if (newStatus === 'completed' || newStatus === 'recording') {
      this.error = null;
    }
    this.events.onStateChange?.(this.getState());
    if (err) this.events.onError?.(err);

    if (this.sessionId) {
      void this.store.updateSession(this.sessionId, {
        status: newStatus,
        activeDurationMs: this.getActiveDurationMs(),
        archiveTotalBytes: this.archiveTotalBytes,
        segmentCount: this.activeSegmentIndex,
        errorCode: err?.code ?? null,
        errorMessage: err?.message ?? null,
      }).catch(() => {
        // ignore background status update error
      });
    }
  }

  private stopAllTracks(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.stream = null;
    }
  }

  private clearAllPendingTimers(): void {
    for (const timerId of this.pendingTimers) {
      try {
        clearTimeout(timerId);
      } catch {
        // ignore
      }
    }
    this.pendingTimers.clear();
  }

  /**
   * Central Idempotent Terminal Cleanup.
   * Cancels timers, stops active recorders without hanging on unstarted ones,
   * prevents concurrent cleanup races, and guarantees media stream tracks stop.
   */
  private centralTerminalCleanup(): Promise<void> {
    if (this.terminalCleanupPromise) {
      return this.terminalCleanupPromise;
    }

    this.terminalCleanupPromise = (async () => {
      this.sessionGeneration += 1;
      this.clearAllPendingTimers();

      const stopPromises: Promise<void>[] = [];

      // Stop active segment recorders
      for (const runtime of Array.from(this.activeRecorders.values())) {
        if (runtime.recorder.state !== 'inactive' && runtime.status === 'active') {
          runtime.status = 'stopping';
          try {
            runtime.recorder.stop();
          } catch {
            runtime.resolveStop();
          }
          stopPromises.push(runtime.stopPromise);
        } else {
          runtime.resolveStop();
        }
      }

      // Stop continuous archive recorder
      if (this.archiveRecorder && this.archiveRecorder.state !== 'inactive') {
        const archiveStopPromise = new Promise<void>(resolve => {
          this.archiveRecorder!.onstop = () => resolve();
          try {
            this.archiveRecorder!.requestData();
          } catch {
            // ignore
          }
          try {
            this.archiveRecorder!.stop();
          } catch {
            resolve();
          }
        });
        stopPromises.push(archiveStopPromise);
      }

      await Promise.all(stopPromises);
      this.activeRecorders.clear();
      this.archiveRecorder = null;

      // Release physical microphone tracks unconditionally
      this.stopAllTracks();
    })();

    return this.terminalCleanupPromise;
  }

  private async handleFatalError(code: RecordingErrorCode, message: string): Promise<void> {
    if (this.status === 'completed' || this.status === 'cancelled' || this.status === 'failed') return;
    this.transition('failed', { code, message });
    await this.centralTerminalCleanup();
  }

  private async handleHardwareEnded(): Promise<void> {
    if (this.status === 'completed' || this.status === 'cancelled' || this.status === 'failed') return;
    this.transition('failed', {
      code: 'device-ended',
      message: 'Perangkat mikrofon fisik terputus atau dinonaktifkan oleh sistem.',
    });
    await this.centralTerminalCleanup();
  }

  /**
   * Starts a new recording session.
   * Explicit user gesture required. Strictly guarded against double start.
   */
  async start(options: { targetProjectId?: string; title?: string } = {}): Promise<string> {
    if (this.status !== 'idle' && this.status !== 'ready') {
      throw new Error(`Tidak dapat memulai rekaman dari status "${this.status}".`);
    }

    if (!this.capabilities.supported || !this.capabilities.selectedMimeType) {
      const err = {
        code: 'unsupported-browser' as RecordingErrorCode,
        message: this.capabilities.reason || 'Browser tidak mendukung perekaman audio lokal yang diperlukan.',
      };
      this.transition('failed', err);
      throw new Error(err.message);
    }

    this.transition('requesting-permission');

    let stream: MediaStream;
    try {
      stream = await this.getMediaStream({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (permErr: any) {
      this.stopAllTracks();
      const code: RecordingErrorCode =
        permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError'
          ? 'permission-denied'
          : permErr.name === 'NotFoundError' || permErr.name === 'DevicesNotFoundError'
            ? 'microphone-not-found'
            : 'microphone-unreadable';

      const err = { code, message: permErr.message || 'Izin akses mikrofon ditolak.' };
      this.transition('failed', err);
      throw permErr;
    }

    this.stream = stream;

    // Attach hardware-ended listener
    stream.getAudioTracks().forEach(track => {
      track.onended = () => {
        void this.handleHardwareEnded();
      };
    });

    this.sessionGeneration += 1;
    const currentRunGen = this.sessionGeneration;
    this.terminalCleanupPromise = null;

    this.sessionId = generateRecordingId('rec-draft');
    this.targetProjectId = options.targetProjectId || 'project-default';
    this.sessionTitle = options.title || 'Rekaman Rapat';
    this.error = null;
    this.archiveChunkIndex = 0;
    this.archiveTotalBytes = 0;
    this.activeSegmentIndex = 0;

    const now = Date.now();
    const sessionRecord: RecordingSession = {
      sessionId: this.sessionId,
      targetProjectId: this.targetProjectId,
      title: this.sessionTitle,
      status: 'recording',
      startedAt: now,
      lastUpdatedAt: now,
      activeDurationMs: 0,
      mimeType: this.capabilities.selectedMimeType,
      archiveChunkCount: 0,
      archiveTotalBytes: 0,
      segmentCount: 0,
      errorCode: null,
      errorMessage: null,
    };

    try {
      await this.store.saveSession(sessionRecord);
    } catch (saveErr: any) {
      await this.centralTerminalCleanup();
      const err = {
        code: 'storage-write-failed' as RecordingErrorCode,
        message: 'Gagal membuat sesi rekaman di IndexedDB lokal.',
      };
      this.transition('failed', err);
      throw saveErr;
    }

    // Initialize Monotonic Duration Tracker
    this.startPerfMs = performance.now();
    this.totalPausedDurationMs = 0;
    this.currentPauseStartMs = null;
    this.isPaused = false;

    // Start Path A: Continuous Archive Recorder (timeslice 1000ms)
    try {
      const archiveRec = new MediaRecorder(stream, { mimeType: this.capabilities.selectedMimeType });
      archiveRec.ondataavailable = event => {
        if (this.sessionGeneration !== currentRunGen) return;
        if (this.status !== 'recording' && this.status !== 'paused' && this.status !== 'stopping') return;
        this.handleArchiveDataAvailable(event, currentRunGen);
      };
      archiveRec.onerror = () => {
        if (this.sessionGeneration !== currentRunGen) return;
        void this.handleFatalError('storage-write-failed', 'MediaRecorder arsip mengalami kegagalan stream.');
      };
      archiveRec.start(1000);
      this.archiveRecorder = archiveRec;
    } catch (archiveErr: any) {
      this.archiveRecorder = null;
      await this.centralTerminalCleanup();
      const err = {
        code: 'storage-write-failed' as RecordingErrorCode,
        message: archiveErr?.message || 'Gagal memulai MediaRecorder arsip kontinu.',
      };
      this.transition('failed', err);
      throw archiveErr;
    }

    this.transition('recording');

    // Start Path B: First Transcription Segment Recorder
    try {
      this.startSegmentRecorder(0);
    } catch (segErr: any) {
      await this.centralTerminalCleanup();
      const err = {
        code: 'storage-write-failed' as RecordingErrorCode,
        message: segErr?.message || 'Gagal memulai MediaRecorder segmen pertama.',
      };
      this.transition('failed', err);
      throw segErr;
    }

    return this.sessionId;
  }

  private handleArchiveDataAvailable(event: BlobEvent, gen: number): void {
    if (!event.data || event.data.size === 0 || !this.sessionId) return;
    if (this.sessionGeneration !== gen) return;
    if (this.status !== 'recording' && this.status !== 'paused' && this.status !== 'stopping') return;

    const size = event.data.size;
    this.archiveTotalBytes += size;

    const chunkRecord: ArchiveChunkRecord = {
      sessionId: this.sessionId,
      chunkIndex: this.archiveChunkIndex++,
      blob: event.data,
      sizeBytes: size,
      timestampMs: Math.round(event.timeStamp || performance.now()),
      activeDurationMs: this.getActiveDurationMs(),
      createdAt: Date.now(),
    };

    this.store.appendArchiveChunk(chunkRecord).catch(err => {
      if (this.sessionGeneration !== gen) return;
      const code: RecordingErrorCode = err?.name === 'QuotaExceededError' ? 'storage-quota' : 'storage-write-failed';
      void this.handleFatalError(code, 'Gagal menulis potongan audio ke penyimpanan lokal IndexedDB.');
    });
  }

  private startSegmentRecorder(segIndex: number): void {
    if (!this.stream || !this.sessionId) return;
    if (this.status !== 'recording' && this.status !== 'paused') return;

    const gen = this.sessionGeneration;
    const recorderId = generateRecordingId(`seg-${segIndex}`);
    const mimeType = this.capabilities.selectedMimeType || 'audio/webm;codecs=opus';

    let resolveStop!: () => void;
    const stopPromise = new Promise<void>(resolve => {
      resolveStop = resolve;
    });

    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, { mimeType });
    } catch (recErr: any) {
      resolveStop();
      void this.handleFatalError('storage-write-failed', recErr?.message || 'Gagal membuat MediaRecorder segmen.');
      return;
    }

    const isolatedChunks: Blob[] = [];

    const runtime: SegmentRecorderRuntime = {
      id: recorderId,
      segmentIndex: segIndex,
      recorder: rec,
      chunks: isolatedChunks,
      mimeType,
      status: 'starting',
      plannedStartSec: segIndex * this.segmentCoreSec,
      plannedCoreDurationSec: this.segmentCoreSec,
      overlapSec: this.segmentOverlapSec,
      activeRecordedMs: 0,
      lastResumePerfMs: performance.now(),
      rotationTimerId: null,
      overlapTimerId: null,
      stopPromise,
      resolveStop,
    };

    rec.ondataavailable = e => {
      if (this.sessionGeneration !== gen) return;
      if (this.status !== 'recording' && this.status !== 'paused' && this.status !== 'stopping') return;
      if (e.data && e.data.size > 0) {
        isolatedChunks.push(e.data);
      }
    };

    rec.onstop = () => {
      runtime.status = 'stopped';
      resolveStop();
    };

    rec.onerror = () => {
      if (this.sessionGeneration !== gen) return;
      void this.handleFatalError('storage-write-failed', 'MediaRecorder segmen mengalami kegagalan stream.');
    };

    try {
      rec.start();
      runtime.status = 'active';
      this.activeRecorders.set(recorderId, runtime);
    } catch (startErr: any) {
      runtime.status = 'stopped';
      resolveStop();
      this.activeRecorders.delete(recorderId);
      if (segIndex === 0) {
        throw startErr;
      }
      void this.handleFatalError('storage-write-failed', startErr?.message || 'Gagal memulai MediaRecorder segmen.');
      return;
    }

    this.scheduleSegmentRotation(runtime, gen);
  }

  private scheduleSegmentRotation(runtime: SegmentRecorderRuntime, gen: number): void {
    if (this.isPaused || this.sessionGeneration !== gen) return;

    const remainingCoreMs = Math.max(
      0,
      runtime.plannedCoreDurationSec * 1000 - runtime.activeRecordedMs
    );

    const timerId = setTimeout(() => {
      this.pendingTimers.delete(timerId);
      runtime.rotationTimerId = null;
      if (this.sessionGeneration !== gen || this.isPaused) return;
      this.handoverToNextSegment(runtime, gen);
    }, remainingCoreMs);

    runtime.rotationTimerId = timerId;
    this.pendingTimers.add(timerId);
  }

  private handoverToNextSegment(finishingRuntime: SegmentRecorderRuntime, gen: number): void {
    if (this.sessionGeneration !== gen || this.isPaused) return;

    // Start next recorder for overlap window
    this.activeSegmentIndex += 1;
    this.startSegmentRecorder(this.activeSegmentIndex);

    finishingRuntime.status = 'stopping';
    const remainingOverlapMs = finishingRuntime.overlapSec * 1000;

    const timerId = setTimeout(async () => {
      this.pendingTimers.delete(timerId);
      finishingRuntime.overlapTimerId = null;
      if (this.sessionGeneration !== gen) return;
      await this.stopAndFinalizeSegmentRuntime(finishingRuntime, gen);
    }, remainingOverlapMs);

    finishingRuntime.overlapTimerId = timerId;
    this.pendingTimers.add(timerId);
  }

  private async stopAndFinalizeSegmentRuntime(runtime: SegmentRecorderRuntime, gen: number): Promise<void> {
    if (runtime.recorder.state !== 'inactive') {
      try {
        runtime.recorder.stop();
      } catch {
        runtime.resolveStop();
      }
    }

    await runtime.stopPromise;
    this.activeRecorders.delete(runtime.id);

    if (this.sessionGeneration === gen && this.status !== 'cancelled' && this.status !== 'failed') {
      this.finalizeSegmentData(runtime);
    }
  }

  private finalizeSegmentData(runtime: SegmentRecorderRuntime): void {
    if (!this.sessionId || runtime.chunks.length === 0) return;

    const blob = new Blob(runtime.chunks, { type: runtime.mimeType || 'audio/webm;codecs=opus' });
    const plannedStartSec = runtime.plannedStartSec;
    const plannedEndSec = plannedStartSec + runtime.plannedCoreDurationSec + runtime.overlapSec;

    const record: TranscriptionSegmentRecord = {
      sessionId: this.sessionId,
      segmentIndex: runtime.segmentIndex,
      blob,
      sizeBytes: blob.size,
      durationSec: runtime.plannedCoreDurationSec + runtime.overlapSec,
      plannedStartSec,
      plannedEndSec,
      overlapStartSec: plannedStartSec,
      overlapEndSec: plannedStartSec + runtime.overlapSec,
      transcribed: false,
      createdAt: Date.now(),
    };

    this.store.appendTranscriptionSegment(record).then(() => {
      this.events.onSegmentReady?.(record);
    }).catch(err => {
      console.warn('Gagal menyimpan segmen transkripsi sementara:', err);
    });
  }

  pause(): void {
    if (this.status !== 'recording') return;

    this.isPaused = true;
    this.currentPauseStartMs = performance.now();

    try { this.archiveRecorder?.pause(); } catch { /* ignore */ }

    // Pause and accumulate active duration for all active segment recorders
    for (const runtime of this.activeRecorders.values()) {
      if (runtime.lastResumePerfMs !== null) {
        runtime.activeRecordedMs += performance.now() - runtime.lastResumePerfMs;
        runtime.lastResumePerfMs = null;
      }
      if (runtime.rotationTimerId !== null) {
        clearTimeout(runtime.rotationTimerId);
        this.pendingTimers.delete(runtime.rotationTimerId);
        runtime.rotationTimerId = null;
      }
      if (runtime.overlapTimerId !== null) {
        clearTimeout(runtime.overlapTimerId);
        this.pendingTimers.delete(runtime.overlapTimerId);
        runtime.overlapTimerId = null;
      }
      try {
        runtime.recorder.pause();
      } catch {
        // ignore
      }
    }

    this.transition('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;

    if (this.currentPauseStartMs !== null) {
      const pauseDuration = performance.now() - this.currentPauseStartMs;
      this.totalPausedDurationMs += Math.max(0, pauseDuration);
      this.currentPauseStartMs = null;
    }
    this.isPaused = false;

    try { this.archiveRecorder?.resume(); } catch { /* ignore */ }

    const gen = this.sessionGeneration;
    for (const runtime of this.activeRecorders.values()) {
      runtime.lastResumePerfMs = performance.now();
      try {
        runtime.recorder.resume();
      } catch {
        // ignore
      }

      if (runtime.status === 'stopping') {
        const recordedOverlapMs = Math.max(
          0,
          runtime.activeRecordedMs - runtime.plannedCoreDurationSec * 1000
        );
        const remainingOverlapMs = Math.max(0, runtime.overlapSec * 1000 - recordedOverlapMs);

        const timerId = setTimeout(async () => {
          this.pendingTimers.delete(timerId);
          runtime.overlapTimerId = null;
          if (this.sessionGeneration !== gen) return;
          await this.stopAndFinalizeSegmentRuntime(runtime, gen);
        }, remainingOverlapMs);

        runtime.overlapTimerId = timerId;
        this.pendingTimers.add(timerId);
      } else {
        this.scheduleSegmentRotation(runtime, gen);
      }
    }

    this.transition('recording');
  }

  /**
   * Normal Stop & Finalization.
   * Flushes archive and segment recorders, waits for final chunks to enter write queue,
   * loads completed durable transcript segments, and atomically commits to workspace.
   */
  async stop(): Promise<FinalizeRecordingResult> {
    if (this.status === 'recoverable') {
      return this.retryFinalization();
    }

    if (this.status !== 'recording' && this.status !== 'paused') {
      throw new Error(`Tidak dapat menghentikan rekaman dari status "${this.status}".`);
    }

    const currentSessionId = this.sessionId;
    if (!currentSessionId) {
      throw new Error('Tidak ada sesi rekaman aktif.');
    }

    // 1. Transition to 'stopping' to allow final dataavailable flush while blocking new rotations
    this.transition('stopping');
    this.clearAllPendingTimers();

    const finalizationPromises: Promise<void>[] = [];

    // 2. Stop segment recorders and finalize their collected chunks
    for (const runtime of Array.from(this.activeRecorders.values())) {
      if (runtime.recorder.state !== 'inactive') {
        try {
          runtime.recorder.stop();
        } catch {
          runtime.resolveStop();
        }
      }
      finalizationPromises.push(
        runtime.stopPromise.then(() => {
          this.finalizeSegmentData(runtime);
        })
      );
    }

    // 3. Flush & stop archive recorder (requestData flushes final chunk into handleArchiveDataAvailable)
    if (this.archiveRecorder && this.archiveRecorder.state !== 'inactive') {
      const archiveStopP = new Promise<void>(resolve => {
        this.archiveRecorder!.onstop = () => resolve();
        try {
          this.archiveRecorder!.requestData();
        } catch {
          // ignore
        }
        try {
          this.archiveRecorder!.stop();
        } catch {
          resolve();
        }
      });
      finalizationPromises.push(archiveStopP);
    }

    await Promise.all(finalizationPromises);
    this.activeRecorders.clear();
    this.archiveRecorder = null;

    // 4. Release all physical microphone tracks immediately
    this.stopAllTracks();

    // 5. Wait for all pending IndexedDB writes (including final flushed chunks) to commit
    await this.store.waitForPendingWrites();

    // 6. Execute durable finalization
    return this.executeFinalization(currentSessionId);
  }

  /**
   * Retries finalization for a session that halted in 'recoverable' state
   * (e.g. after a checkpoint read or workspace save transient failure).
   * Does not re-record or re-transcribe.
   */
  async retryFinalization(): Promise<FinalizeRecordingResult> {
    if (this.status !== 'recoverable') {
      throw new Error(`Tidak dapat melakukan retry finalisasi dari status "${this.status}".`);
    }

    const currentSessionId = this.sessionId;
    if (!currentSessionId) {
      throw new Error('Tidak ada sesi rekaman aktif untuk difinalisasi.');
    }

    return this.executeFinalization(currentSessionId);
  }

  private async executeFinalization(sessionId: string): Promise<FinalizeRecordingResult> {
    // 6. Load all completed durable transcription segments to reconstruct global transcript
    let finalSegments: DialogSegment[];
    try {
      finalSegments = await this.loadCompletedTranscriptSegments(sessionId);
    } catch (segLoadErr: any) {
      const errPayload: RecordingError = {
        code: 'checkpoint-read-failed',
        message: `Gagal memuat checkpoint transkripsi: ${segLoadErr?.message || 'Penyimpanan lokal tidak dapat dibaca.'}`,
        retryable: true,
      };
      this.transition('recoverable', errPayload);
      try {
        await this.store.updateSession(sessionId, {
          status: 'recoverable',
          errorCode: 'checkpoint-read-failed',
          errorMessage: errPayload.message,
        });
      } catch {
        // ignore background update error
      }
      const err = new Error(errPayload.message);
      (err as any).code = errPayload.code;
      (err as any).retryable = true;
      throw err;
    }

    this.transition('finalizing');

    // 7. Finalize archive Blob and save to workspace with reconstructed transcript
    try {
      const result = await finalizeRecordingSession(sessionId, this.store, {
        projectId: this.targetProjectId,
        title: this.sessionTitle,
        segments: finalSegments,
        saveToWorkspaceFn: this.saveToWorkspaceFn,
      });

      this.transition('completed');
      return result;
    } catch (finalErr: any) {
      const isRecoverable = finalErr?.code === 'workspace-save-failed';
      const code: RecordingErrorCode = finalErr?.code || 'archive-finalization-failed';
      const message: string = finalErr?.message || 'Gagal merakit arsip rekaman akhir.';
      this.transition(isRecoverable ? 'recoverable' : 'failed', {
        code,
        message,
        retryable: isRecoverable,
      });
      throw finalErr;
    }
  }

  private async loadCompletedTranscriptSegments(sessionId: string): Promise<DialogSegment[]> {
    const storedSegs = await this.store.getTranscriptionSegments(sessionId);
    const completedSegs = storedSegs
      .filter(s => s.transcribed && s.transcriptDialogs && s.transcriptDialogs.length > 0)
      .sort((a, b) => a.segmentIndex - b.segmentIndex);

    const finalSegments: DialogSegment[] = [];
    for (const seg of completedSegs) {
      if (seg.transcriptDialogs) {
        finalSegments.push(...seg.transcriptDialogs);
      }
    }
    return finalSegments;
  }

  /**
   * Cancels the active recording session.
   * Halts all tracks, stops recorders, awaits pending writes, and discards draft data.
   */
  async cancel(): Promise<void> {
    if (this.status === 'idle' || this.status === 'completed' || this.status === 'cancelled') {
      return;
    }

    const targetSessionId = this.sessionId;

    // 1. Mark lifecycle cancelled internally and reject late dataavailable
    this.transition('cancelled');

    // 2. Stop all recorders and release tracks
    await this.centralTerminalCleanup();

    // 3. Await in-flight IndexedDB writes to settle
    await this.store.waitForPendingWrites();

    // 4. Safely purge temporary session data
    if (targetSessionId) {
      try {
        await this.store.deleteSessionData(targetSessionId);
      } catch {
        // ignore
      }
    }

    this.sessionId = null;
  }
}
