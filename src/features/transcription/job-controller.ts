import type { DialogSegment } from '../../lib/transcript';
import {
  CHUNK_CORE_SECONDS,
  CHUNK_OVERLAP_SECONDS,
  TARGET_SAMPLE_RATE,
  buildChunkWindows,
  computeInputFingerprint,
  generateWavSliceChunks,
  inspectAudioFile,
  type PreparedAudioChunk,
} from './audio-preparation';
import {
  classifyDevice,
  createCapabilityPolicy,
  verifyWebGpu,
  type CapabilityPolicy,
  type DeviceSignals,
} from './capability-policy';
import {
  deleteCheckpoint,
  findMatchingCheckpoints,
  findResumableCheckpoint,
  saveCheckpoint,
  type TranscriptionCheckpoint,
} from './checkpoint-store';
import { mergeChunkResults, toDialogSegments, type TranscriptChunkResult } from './chunk-merger';
import { acceptsJobEvent, initialJobState, reduceJobState } from './job-state';
import type {
  JobCompatibility,
  TranscriptionBackend,
  TranscriptionJobState,
  TranscriptionLanguage,
  TranscriptionPhase,
} from './types';
import type { WorkerRequest, WorkerResponse } from '../../workers/transcription-protocol';
import { setTranscriptionJobActive } from '../../pwa/update-coordinator';

export type TranscriptionUiStatus =
  | 'idle'
  | 'validating'
  | 'preparing-model'
  | 'preparing-audio'
  | 'transcribing'
  | 'assembling-result'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'unsupported';

export type TranscriptionErrorReason =
  | 'unsupported-format'
  | 'exceeds-safe-limit'
  | 'unsupported-device-policy'
  | 'model-load-failed'
  | 'resource-exhausted'
  | 'cancelled'
  | 'general-failure';

export interface TranscriptionUiSnapshot {
  status: TranscriptionUiStatus;
  jobState: TranscriptionJobState | null;
  recordingId?: string | null;
  progress: number | null;
  currentChunk: number | null;
  totalChunks: number | null;
  resumedFromChunks?: number;
  errorReason: TranscriptionErrorReason | null;
  messageKey: string;
  messageParams?: Record<string, string | number>;
  nextActionKey: string | null;
}

export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
}

export interface ControllerDependencies {
  createWorker?: () => WorkerLike;
  decodeWholeFile?: (file: Blob) => Promise<Float32Array>;
  probeDuration?: (file: Blob) => Promise<number | null>;
  getDeviceSignals?: () => DeviceSignals;
  getGpu?: () => { requestAdapter: () => Promise<unknown> } | undefined;
  onStatusChange: (snapshot: TranscriptionUiSnapshot) => void;
  onComplete: (segments: DialogSegment[], meta: { jobId: string; recordingId?: string; backend: TranscriptionBackend; durationSec: number }) => void;
}

const DEFAULT_COMPATIBILITY: JobCompatibility = {
  checkpointSchema: '1',
  transcriptionProtocol: '1',
  transformersVersion: '4.3.1',
  modelRepository: 'onnx-community/whisper-tiny',
  modelRevision: 'main',
  chunkPolicyVersion: '1',
  mergerVersion: '1',
  transcriptSchemaVersion: '1',
};

export function mapJobPhaseToUiStatus(phase: TranscriptionPhase): TranscriptionUiStatus {
  switch (phase) {
    case 'inspecting': return 'validating';
    case 'preparing-model': return 'preparing-model';
    case 'preparing-audio': return 'preparing-audio';
    case 'transcribing':
    case 'falling-back': return 'transcribing';
    case 'merging':
    case 'checkpointing': return 'assembling-result';
    case 'complete': return 'completed';
    case 'cancelling':
    case 'cancelled': return 'cancelled';
    case 'error': return 'failed';
    case 'paused':
    case 'resumable': return 'idle';
  }
}

export function createIdleSnapshot(): TranscriptionUiSnapshot {
  return {
    status: 'idle',
    jobState: null,
    recordingId: null,
    progress: null,
    currentChunk: null,
    totalChunks: null,
    resumedFromChunks: 0,
    errorReason: null,
    messageKey: '',
    nextActionKey: null,
  };
}

function defaultDeviceSignals(): DeviceSignals {
  if (typeof navigator === 'undefined') {
    return { userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false };
  }
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    userAgent: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    mobile: nav.userAgentData?.mobile,
  };
}

function defaultGetGpu() {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
}

function sliceWholePcmChunk(samples: Float32Array, win: ReturnType<typeof buildChunkWindows>[number]): PreparedAudioChunk {
  const startSample = Math.floor(win.sourceStart * TARGET_SAMPLE_RATE);
  const endSample = Math.min(samples.length, Math.ceil(win.sourceEnd * TARGET_SAMPLE_RATE));
  return { ...win, samples: samples.slice(startSample, endSample) };
}

export class TranscriptionJobController {
  private deps: ControllerDependencies;
  private activeRunToken = 0;
  private activeJobId: string | null = null;
  private activeRecordingId: string | undefined = undefined;
  private lastCheckpointId: string | null = null;
  private currentState: TranscriptionJobState | null = null;
  private worker: WorkerLike | null = null;
  private createdAt = 0;
  private cancelCallbacks = new Set<() => void>();

  constructor(deps: ControllerDependencies) {
    this.deps = deps;
  }

  getActiveJobId(): string | null {
    return this.activeJobId;
  }

  getActiveRecordingId(): string | undefined {
    return this.activeRecordingId;
  }

  getJobState(): TranscriptionJobState | null {
    return this.currentState;
  }

  private isLatestRun(runToken: number, jobId?: string): boolean {
    if (this.activeRunToken !== runToken) return false;
    if (jobId !== undefined && this.activeJobId !== jobId) return false;
    return true;
  }

  private terminateWorker() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    for (const cb of this.cancelCallbacks) cb();
    this.cancelCallbacks.clear();
  }

  private advanceState(jobId: string, nextPhase: TranscriptionPhase): boolean {
    if (!this.currentState || !acceptsJobEvent(this.currentState.jobId, jobId)) return false;
    if (this.currentState.phase === nextPhase) return true;
    const reduced = reduceJobState(this.currentState, { type: 'advance', jobId, phase: nextPhase });
    if (!reduced.ok) return false;
    this.currentState = reduced.state;
    return true;
  }

  private emitStatus(
    status: TranscriptionUiStatus,
    messageKey: string,
    options: {
      recordingId?: string | null;
      progress?: number | null;
      currentChunk?: number | null;
      totalChunks?: number | null;
      resumedFromChunks?: number;
      errorReason?: TranscriptionErrorReason | null;
      messageParams?: Record<string, string | number>;
      nextActionKey?: string | null;
    } = {},
  ) {
    this.deps.onStatusChange({
      status,
      jobState: this.currentState,
      recordingId: options.recordingId !== undefined ? options.recordingId : (this.activeRecordingId ?? null),
      progress: options.progress ?? null,
      currentChunk: options.currentChunk ?? null,
      totalChunks: options.totalChunks ?? null,
      resumedFromChunks: options.resumedFromChunks ?? 0,
      errorReason: options.errorReason ?? null,
      messageKey,
      messageParams: options.messageParams,
      nextActionKey: options.nextActionKey ?? null,
    });
  }

  cancelActiveJob() {
    const jobId = this.activeJobId;
    const state = this.currentState;
    if (!jobId || !state) return;

    this.activeRunToken += 1;
    this.activeJobId = null;
    setTranscriptionJobActive(false);

    if (this.worker) {
      try { this.worker.postMessage({ type: 'cancel-job', jobId }); } catch { /* ignore */ }
      this.terminateWorker();
    }

    let nextState = state;
    const cancelling = reduceJobState(nextState, { type: 'advance', jobId, phase: 'cancelling' });
    if (cancelling.ok) {
      nextState = cancelling.state;
      const cancelled = reduceJobState(nextState, { type: 'advance', jobId, phase: 'cancelled' });
      if (cancelled.ok) nextState = cancelled.state;
    }
    this.currentState = nextState;

    this.emitStatus('cancelled', 'Proses transkripsi dibatalkan.', {
      errorReason: 'cancelled',
      nextActionKey: 'Anda dapat memulai ulang transkripsi kapan saja atau memilih berkas lain.',
    });
  }

  dispose() {
    this.activeRunToken += 1;
    this.activeJobId = null;
    this.activeRecordingId = undefined;
    setTranscriptionJobActive(false);
    this.terminateWorker();
  }

  async inspectCapabilities(): Promise<{ policy: CapabilityPolicy; deviceClass: string; webGpuAvailable: boolean }> {
    const device = classifyDevice((this.deps.getDeviceSignals ?? defaultDeviceSignals)());
    const webGpu = await verifyWebGpu((this.deps.getGpu ?? defaultGetGpu)());
    return { policy: createCapabilityPolicy({ device, webGpu }), deviceClass: device.class, webGpuAvailable: webGpu.available };
  }

  async findCompatibleCheckpoint(params: {
    file: Blob & { name?: string; type?: string };
    language: TranscriptionLanguage;
    preferredBackend?: TranscriptionBackend;
    fingerprint?: string;
  }): Promise<TranscriptionCheckpoint | null> {
    const fingerprint = params.fingerprint ?? await computeInputFingerprint(params.file);
    let backend = params.preferredBackend;
    if (!backend) {
      const { policy } = await this.inspectCapabilities();
      backend = policy.preferredBackend;
    }
    const matches = await findMatchingCheckpoints(fingerprint, params.language, DEFAULT_COMPATIBILITY);
    const primaryMatches = matches
      .filter(item => item.settings.model === 'tiny' && item.settings.backend === backend)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const primary = primaryMatches[0] ?? null;

    if (backend === 'webgpu') {
      const wasmMatches = matches
        .filter(item => item.settings.model === 'tiny' && item.settings.backend === 'wasm')
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const wasmCheckpoint = wasmMatches[0] ?? null;
      if (wasmCheckpoint && (!primary || wasmCheckpoint.updatedAt >= primary.updatedAt)) {
        return wasmCheckpoint;
      }
    }
    return primary;
  }

  async discardCheckpoint(params?: {
    checkpointId?: string;
    file?: Blob & { name?: string; type?: string };
    language?: TranscriptionLanguage;
  }): Promise<boolean> {
    const hasCheckpointId = Boolean(params?.checkpointId);
    const hasFileTarget = !hasCheckpointId && Boolean(params?.file && params?.language);
    const hasExplicitTarget = hasCheckpointId || hasFileTarget;
    const idsToDelete = new Set<string>();

    if (hasCheckpointId && params?.checkpointId) {
      idsToDelete.add(params.checkpointId);
    } else if (hasFileTarget && params?.file && params?.language) {
      const fingerprint = await computeInputFingerprint(params.file);
      const matches = await findMatchingCheckpoints(fingerprint, params.language, DEFAULT_COMPATIBILITY);
      for (const match of matches) {
        if (match.settings.model === 'tiny') {
          idsToDelete.add(match.id);
        }
      }
    } else if (!hasExplicitTarget && this.lastCheckpointId) {
      idsToDelete.add(this.lastCheckpointId);
    }

    if (idsToDelete.size === 0) return false;

    if (this.activeJobId && (!hasExplicitTarget || idsToDelete.has(this.activeJobId))) {
      this.cancelActiveJob();
    }

    await Promise.all([...idsToDelete].map(id => deleteCheckpoint(id)));

    const clearedActiveOrLast = !hasExplicitTarget
      || (this.lastCheckpointId !== null && idsToDelete.has(this.lastCheckpointId))
      || (this.currentState !== null && idsToDelete.has(this.currentState.jobId));

    if (this.lastCheckpointId && idsToDelete.has(this.lastCheckpointId)) {
      this.lastCheckpointId = null;
    }
    if (clearedActiveOrLast) {
      this.currentState = null;
      this.deps.onStatusChange(createIdleSnapshot());
    }
    return true;
  }

  async runJob(params: {
    file: Blob & { name?: string; type?: string };
    language: TranscriptionLanguage;
    recordingId?: string;
    knownDurationSeconds?: number;
    resume?: boolean;
  }): Promise<void> {
    this.activeRunToken += 1;
    const runToken = this.activeRunToken;
    const provisionalJobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const boundRecordingId = params.recordingId;

    this.terminateWorker();
    this.activeJobId = provisionalJobId;
    this.activeRecordingId = boundRecordingId;
    setTranscriptionJobActive(true);

    const shouldResume = params.resume !== false;
    const { policy } = await this.inspectCapabilities();
    if (!this.isLatestRun(runToken, provisionalJobId)) return;

    const fingerprint = await computeInputFingerprint(params.file);
    if (!this.isLatestRun(runToken, provisionalJobId)) return;

    let existingCheckpoint: TranscriptionCheckpoint | null = null;
    if (shouldResume && policy.allowedModels.includes('tiny')) {
      existingCheckpoint = await this.findCompatibleCheckpoint({
        file: params.file,
        language: params.language,
        preferredBackend: policy.preferredBackend,
        fingerprint,
      });
      if (!this.isLatestRun(runToken, provisionalJobId)) return;
    }

    const jobId = existingCheckpoint?.id ?? provisionalJobId;
    this.activeJobId = jobId;
    this.activeRecordingId = boundRecordingId;
    this.lastCheckpointId = existingCheckpoint ? existingCheckpoint.id : null;
    this.createdAt = existingCheckpoint?.createdAt ?? Date.now();

    const initialBackend: TranscriptionBackend = existingCheckpoint
      ? existingCheckpoint.settings.backend
      : policy.preferredBackend;
    const initialFallbackCount = existingCheckpoint && existingCheckpoint.backendHistory.includes('webgpu') && existingCheckpoint.settings.backend === 'wasm'
      ? 1
      : 0;

    this.currentState = {
      ...initialJobState(jobId, {
        model: 'tiny',
        language: params.language,
        backend: initialBackend,
      }),
      fallbackCount: initialFallbackCount,
    };

    const resumedChunks: TranscriptChunkResult[] = existingCheckpoint ? [...existingCheckpoint.chunks] : [];
    const completedIndices = new Set<number>(resumedChunks.map(c => c.sourceIndex));

    this.emitStatus('validating', 'Memvalidasi berkas audio dan kemampuan perangkat…', {
      recordingId: boundRecordingId,
      resumedFromChunks: resumedChunks.length,
    });

    if (!policy.allowedModels.includes('tiny')) {
      this.failJob(jobId, 'unsupported', 'unsupported-device-policy', 'Perangkat ini belum memenuhi syarat kebijakan kemampuan untuk menjalankan transkripsi lokal.', undefined, 'Gunakan Chrome desktop untuk menjalankan transkripsi lokal.');
      return;
    }

    const inspection = await inspectAudioFile(params.file, {
      knownDurationSeconds: params.knownDurationSeconds,
      probeDuration: this.deps.probeDuration,
    });
    if (!this.isLatestRun(runToken, jobId)) return;

    if (!inspection.valid || !inspection.route) {
      if (inspection.errorCode === 'exceeds-safe-limit') {
        const maxMb = Math.round(inspection.maxAllowedBytes / (1024 * 1024));
        const maxMin = Math.round(inspection.maxAllowedDurationSeconds / 60);
        this.failJob(jobId, 'failed', 'exceeds-safe-limit', 'Berkas melewati batas pengaman private alpha ({maxMb} MB atau {maxMin} menit untuk format ini).', { maxMb, maxMin }, 'Gunakan berkas yang lebih pendek atau bagi rekaman menjadi beberapa bagian.');
        return;
      }
      if (inspection.errorCode === 'unverified-duration') {
        this.failJob(jobId, 'failed', 'exceeds-safe-limit', 'Durasi berkas terkompresi tidak dapat diverifikasi dengan aman sebelum dekode.', undefined, 'Konversi berkas ke WAV PCM 16-bit atau gunakan rekaman MP3/M4A/WebM dengan metadata durasi yang valid.');
        return;
      }
      if (inspection.errorCode === 'corrupt-wav' || inspection.errorCode === 'unsupported-wav-codec') {
        this.failJob(jobId, 'unsupported', 'unsupported-format', 'Berkas WAV ini bukan PCM 16-bit standar atau headernya rusak.', undefined, 'Ekspor ulang sebagai WAV PCM 16-bit atau gunakan MP3/M4A/WebM berdurasi pendek.');
        return;
      }
      this.failJob(jobId, 'unsupported', 'unsupported-format', 'Format berkas belum didukung untuk transkripsi lokal.', undefined, 'Pilih berkas audio WAV (PCM 16-bit), MP3, M4A, atau WebM.');
      return;
    }

    if (!this.isLatestRun(runToken, jobId) || !this.advanceState(jobId, 'preparing-model')) return;
    this.emitStatus(mapJobPhaseToUiStatus(this.currentState.phase), 'Menyiapkan model transkripsi di perangkat…', {
      recordingId: boundRecordingId,
      resumedFromChunks: resumedChunks.length,
    });

    const worker = this.deps.createWorker
      ? this.deps.createWorker()
      : new Worker(new URL('../../workers/transcription.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;

    const completedChunks: TranscriptChunkResult[] = [...resumedChunks];

    try {
      await this.initializeWorkerModel(jobId, worker);
      if (!this.isLatestRun(runToken, jobId) || !this.advanceState(jobId, 'preparing-audio')) return;
      this.emitStatus(mapJobPhaseToUiStatus(this.currentState.phase), 'Menyiapkan audio secara lokal…', {
        recordingId: boundRecordingId,
        resumedFromChunks: resumedChunks.length,
      });

      let totalDurationSec = inspection.durationSeconds ?? 0;

      if (inspection.route === 'pcm-wav-slice' && inspection.wavHeader) {
        totalDurationSec = inspection.wavHeader.durationSeconds;
        for await (const chunk of generateWavSliceChunks(params.file, inspection.wavHeader)) {
          if (!this.isLatestRun(runToken, jobId)) return;
          if (completedIndices.has(chunk.sourceIndex)) continue;
          const chunkResult = await this.transcribeChunk(jobId, worker, chunk, fingerprint, completedChunks, resumedChunks.length, runToken);
          if (!chunkResult || !this.isLatestRun(runToken, jobId)) return;
          completedChunks.push(chunkResult);
          completedIndices.add(chunk.sourceIndex);
          await this.persistCheckpoint(jobId, fingerprint, completedChunks, 'resumable');
        }
      } else {
        if (!this.deps.decodeWholeFile) throw new Error('decode-unavailable');
        let fullPcm: Float32Array | null = await this.deps.decodeWholeFile(params.file);
        if (!this.isLatestRun(runToken, jobId)) { fullPcm = null; return; }
        totalDurationSec = fullPcm.length / TARGET_SAMPLE_RATE;

        if (totalDurationSec > inspection.maxAllowedDurationSeconds) {
          fullPcm = null;
          const maxMb = Math.round(inspection.maxAllowedBytes / (1024 * 1024));
          const maxMin = Math.round(inspection.maxAllowedDurationSeconds / 60);
          this.failJob(jobId, 'failed', 'exceeds-safe-limit', 'Durasi rekaman melewati batas pengaman private alpha ({maxMin} menit) untuk format terkompresi.', { maxMb, maxMin }, 'Gunakan berkas WAV PCM 16-bit atau potong rekaman menjadi bagian yang lebih pendek.');
          return;
        }

        const windows = buildChunkWindows(totalDurationSec, CHUNK_CORE_SECONDS, CHUNK_OVERLAP_SECONDS);
        const effectiveWindows = windows.length > 0 ? windows : [{
          chunkId: 'chunk-0', sourceIndex: 0, totalChunks: 1, sourceStart: 0, sourceEnd: totalDurationSec, overlapStart: 0, overlapEnd: 0,
        }];

        for (let i = 0; i < effectiveWindows.length; i += 1) {
          if (!this.isLatestRun(runToken, jobId) || !fullPcm) return;
          const win = effectiveWindows[i];
          if (completedIndices.has(win.sourceIndex)) {
            if (i === effectiveWindows.length - 1) fullPcm = null;
            continue;
          }
          const chunk = sliceWholePcmChunk(fullPcm, win);
          if (i === effectiveWindows.length - 1) fullPcm = null; // Release whole PCM as soon as last slice is taken
          const chunkResult = await this.transcribeChunk(jobId, worker, chunk, fingerprint, completedChunks, resumedChunks.length, runToken);
          if (!chunkResult || !this.isLatestRun(runToken, jobId)) { fullPcm = null; return; }
          completedChunks.push(chunkResult);
          completedIndices.add(chunk.sourceIndex);
          await this.persistCheckpoint(jobId, fingerprint, completedChunks, 'resumable');
        }
      }

      if (!this.isLatestRun(runToken, jobId) || !this.currentState) return;
      if (this.currentState.phase === 'preparing-audio' && !this.advanceState(jobId, 'transcribing')) return;
      if (!this.advanceState(jobId, 'merging')) return;

      this.emitStatus(mapJobPhaseToUiStatus(this.currentState.phase), 'Menyusun hasil transkripsi bertimestamp…', {
        progress: 100,
        currentChunk: completedChunks.length,
        totalChunks: completedChunks.length,
        resumedFromChunks: resumedChunks.length,
      });

      const dialogSegments = toDialogSegments(mergeChunkResults(completedChunks));

      if (!this.advanceState(jobId, 'checkpointing')) return;
      try { await deleteCheckpoint(jobId); this.lastCheckpointId = null; } catch { /* ignore */ }
      if (!this.advanceState(jobId, 'complete')) return;

      const finalState = this.currentState;
      this.activeJobId = null;
      setTranscriptionJobActive(false);
      this.terminateWorker();

      this.deps.onComplete(dialogSegments, {
        jobId,
        recordingId: boundRecordingId,
        backend: finalState.backend,
        durationSec: totalDurationSec,
      });
      this.emitStatus('completed', 'Transkripsi selesai dan siap disunting.', {
        recordingId: boundRecordingId,
        progress: 100,
        currentChunk: completedChunks.length,
        totalChunks: completedChunks.length,
        resumedFromChunks: resumedChunks.length,
      });
    } catch (error) {
      if (!this.isLatestRun(runToken)) return;
      if (completedChunks.length > 0) await this.persistCheckpoint(jobId, fingerprint, completedChunks, 'error');
      const raw = error instanceof Error ? error.message : String(error);
      if (raw === 'handled-job-error' || !this.isLatestRun(runToken, jobId)) return;
      const isMemory = /out of memory|memory|allocation|oom/i.test(raw);
      this.failJob(
        jobId,
        'failed',
        isMemory ? 'resource-exhausted' : 'general-failure',
        isMemory ? 'Memori perangkat habis saat menyiapkan atau mentranskripsikan rekaman.' : 'Audio tidak dapat diproses hingga selesai di perangkat ini.',
        undefined,
        isMemory ? 'Tutup tab browser lain atau gunakan berkas berdurasi lebih pendek.' : 'Periksa format rekaman lalu klik Coba lagi.',
      );
    }
  }

  private async initializeWorkerModel(jobId: string, worker: WorkerLike): Promise<void> {
    if (!this.currentState) return;
    const attempt = (backend: TranscriptionBackend): Promise<void> =>
      new Promise((resolve, reject) => {
        const onCancel = () => resolve();
        this.cancelCallbacks.add(onCancel);
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (!msg || !acceptsJobEvent(jobId, msg.jobId) || this.activeJobId !== jobId) return;
          if (msg.type === 'model-progress') {
            if (this.currentState) {
              this.emitStatus(mapJobPhaseToUiStatus(this.currentState.phase), 'Mengunduh atau memuat model di perangkat…', { progress: msg.progress });
            }
          } else if (msg.type === 'model-ready') {
            this.cancelCallbacks.delete(onCancel);
            resolve();
          } else if (msg.type === 'worker-error') {
            this.cancelCallbacks.delete(onCancel);
            reject(msg);
          }
        };
        worker.onerror = () => {
          this.cancelCallbacks.delete(onCancel);
          reject({ type: 'worker-error', jobId, category: 'model-load-failed', message: 'Worker error' });
        };
        worker.postMessage({ type: 'init-model', jobId, backend });
      });

    try {
      await attempt(this.currentState.backend);
    } catch (err: any) {
      if (this.activeJobId !== jobId || !this.currentState) return;
      if (this.currentState.backend === 'webgpu' && this.currentState.fallbackCount === 0) {
        this.currentState = { ...this.currentState, backend: 'wasm', fallbackCount: 1 };
        this.emitStatus('preparing-model', 'WebGPU tidak dapat memuat model. Beralih ke WebAssembly…');
        try {
          await attempt('wasm');
          return;
        } catch (wasmErr: any) {
          err = wasmErr;
        }
      }
      const isResource = err?.category === 'resource-exhausted';
      this.failJob(
        jobId,
        'failed',
        isResource ? 'resource-exhausted' : 'model-load-failed',
        isResource ? 'Memori perangkat tidak cukup untuk memuat model transkripsi.' : 'Model transkripsi gagal dimuat atau diunduh.',
        undefined,
        'Periksa koneksi internet untuk unduhan model awal, atau coba ulangi beberapa saat lagi.',
      );
      throw new Error('handled-job-error');
    }
  }

  private async transcribeChunk(
    jobId: string,
    worker: WorkerLike,
    chunk: PreparedAudioChunk,
    fingerprint: string,
    completedChunks: TranscriptChunkResult[],
    resumedFromChunks = 0,
    runToken?: number,
  ): Promise<TranscriptChunkResult | null> {
    if (!this.currentState || this.activeJobId !== jobId) return null;
    if (runToken !== undefined && !this.isLatestRun(runToken, jobId)) return null;
    if (this.currentState.phase !== 'transcribing' && !this.advanceState(jobId, 'transcribing')) return null;

    const progress = chunk.totalChunks > 0 ? Math.round((chunk.sourceIndex / chunk.totalChunks) * 100) : null;
    this.emitStatus(
      mapJobPhaseToUiStatus(this.currentState.phase),
      chunk.totalChunks > 1 ? 'Mentranskripsikan bagian {current} dari {total} di perangkat…' : 'Mentranskripsikan rekaman di perangkat…',
      {
        progress,
        currentChunk: chunk.sourceIndex + 1,
        totalChunks: chunk.totalChunks,
        resumedFromChunks,
        messageParams: { current: chunk.sourceIndex + 1, total: chunk.totalChunks },
      },
    );

    const canFallback = this.currentState.backend === 'webgpu' && this.currentState.fallbackCount === 0;
    const retrySamples = canFallback ? chunk.samples.slice() : null;

    const attemptChunk = (audioSamples: Float32Array, backend: TranscriptionBackend): Promise<TranscriptChunkResult> =>
      new Promise<TranscriptChunkResult>((resolve, reject) => {
        const onCancel = () => reject({ type: 'worker-error', jobId, category: 'cancelled' });
        this.cancelCallbacks.add(onCancel);
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (!msg || !acceptsJobEvent(jobId, msg.jobId) || this.activeJobId !== jobId) return;
          if (runToken !== undefined && !this.isLatestRun(runToken, jobId)) return;
          if (msg.type === 'chunk-complete' && msg.chunkId === chunk.chunkId) {
            this.cancelCallbacks.delete(onCancel);
            resolve({
              jobId: msg.jobId,
              chunkId: msg.chunkId,
              sourceIndex: msg.sourceIndex,
              sourceStart: msg.sourceStart,
              sourceEnd: msg.sourceEnd,
              overlapStart: msg.overlapStart,
              overlapEnd: msg.overlapEnd,
              language: msg.language,
              segments: msg.segments,
            });
          } else if (msg.type === 'worker-error') {
            this.cancelCallbacks.delete(onCancel);
            reject(msg);
          }
        };
        worker.onerror = () => {
          this.cancelCallbacks.delete(onCancel);
          reject({ type: 'worker-error', jobId, category: 'transcription-failed' });
        };
        worker.postMessage(
          {
            type: 'transcribe-chunk',
            jobId,
            chunkId: chunk.chunkId,
            sourceIndex: chunk.sourceIndex,
            totalChunks: chunk.totalChunks,
            sourceStart: chunk.sourceStart,
            sourceEnd: chunk.sourceEnd,
            overlapStart: chunk.overlapStart,
            overlapEnd: chunk.overlapEnd,
            language: this.currentState!.language,
            backend,
            audio: audioSamples,
          },
          [audioSamples.buffer],
        );
      });

    try {
      return await attemptChunk(chunk.samples, this.currentState.backend);
    } catch (err: any) {
      if (this.activeJobId !== jobId || !this.currentState) return null;
      if (runToken !== undefined && !this.isLatestRun(runToken, jobId)) return null;
      if (
        this.currentState.backend === 'webgpu'
        && this.currentState.fallbackCount === 0
        && retrySamples
        && err?.category === 'backend-failed'
      ) {
        const fallbackReduced = reduceJobState(this.currentState, {
          type: 'fallback',
          jobId,
          from: 'webgpu',
          to: 'wasm',
          attempt: 1,
        });
        if (fallbackReduced.ok) {
          this.currentState = fallbackReduced.state;
          await this.persistCheckpoint(jobId, fingerprint, completedChunks, 'resumable');
          if (runToken !== undefined && !this.isLatestRun(runToken, jobId)) return null;
          this.emitStatus(
            mapJobPhaseToUiStatus(this.currentState.phase),
            'WebGPU tidak dapat memuat model. Beralih ke WebAssembly…',
            {
              progress,
              currentChunk: chunk.sourceIndex + 1,
              totalChunks: chunk.totalChunks,
              resumedFromChunks,
            },
          );
          try {
            await this.initializeWorkerModel(jobId, worker);
            if (this.activeJobId !== jobId || !this.currentState) return null;
            if (runToken !== undefined && !this.isLatestRun(runToken, jobId)) return null;
            if (!this.advanceState(jobId, 'transcribing')) return null;
            return await attemptChunk(retrySamples, 'wasm');
          } catch (wasmErr: any) {
            await this.persistCheckpoint(jobId, fingerprint, completedChunks, 'error');
            if (wasmErr instanceof Error && wasmErr.message === 'handled-job-error') {
              throw wasmErr;
            }
            err = wasmErr;
          }
        }
      }
      if (runToken !== undefined && !this.isLatestRun(runToken, jobId)) return null;
      if (err?.category === 'cancelled') {
        this.cancelActiveJob();
        throw new Error('handled-job-error');
      }
      await this.persistCheckpoint(jobId, fingerprint, completedChunks, 'error');
      if (runToken !== undefined && !this.isLatestRun(runToken, jobId)) return null;
      const isResource = err?.category === 'resource-exhausted';
      this.failJob(
        jobId,
        'failed',
        isResource ? 'resource-exhausted' : 'general-failure',
        isResource ? 'Memori perangkat habis saat mentranskripsikan rekaman.' : 'Proses transkripsi terhenti karena kendala pada runtime browser.',
        undefined,
        'Klik Coba lagi untuk mengulangi proses transkripsi.',
      );
      throw new Error('handled-job-error');
    }
  }

  private async persistCheckpoint(jobId: string, fingerprint: string, chunks: TranscriptChunkResult[], state: 'resumable' | 'error') {
    if (!this.currentState) return;
    try {
      await saveCheckpoint({
        id: jobId,
        inputFingerprint: fingerprint,
        settings: { model: 'tiny', language: this.currentState.language, backend: this.currentState.backend },
        compatibility: DEFAULT_COMPATIBILITY,
        backendHistory: this.currentState.fallbackCount > 0 ? ['webgpu', 'wasm'] : [this.currentState.backend],
        chunks,
        state,
        createdAt: this.createdAt,
        updatedAt: Date.now(),
        retentionMode: 'timed',
      });
      this.lastCheckpointId = jobId;
    } catch { /* best-effort checkpoint */ }
  }

  private failJob(
    jobId: string,
    uiStatus: 'failed' | 'unsupported',
    reason: TranscriptionErrorReason,
    messageKey: string,
    messageParams: Record<string, string | number> | undefined,
    nextActionKey: string,
  ) {
    if (this.currentState && acceptsJobEvent(this.currentState.jobId, jobId)) {
      const reduced = reduceJobState(this.currentState, { type: 'advance', jobId, phase: 'error' });
      if (reduced.ok) this.currentState = reduced.state;
    }
    this.activeJobId = null;
    setTranscriptionJobActive(false);
    this.terminateWorker();
    this.emitStatus(uiStatus, messageKey, { errorReason: reason, messageParams, nextActionKey });
  }
}
