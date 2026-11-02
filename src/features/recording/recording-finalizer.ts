import { addSingleRecordingToWorkspace, type RecordingRecord } from '../workspace/workspace-store';
import type { RecordingStore } from './recording-store';
import { generateRecordingId, type ArchiveChunkRecord } from './recording-types';
import type { DialogSegment } from '../../lib/transcript';

export interface FinalizeRecordingResult {
  recordingId: string;
  audioBlob: Blob;
  durationSec: number;
  segments?: DialogSegment[];
}

export const WEBM_EBML_MAGIC_BYTES = [0x1a, 0x45, 0xdf, 0xa3] as const;

export interface ArchiveStructureValidationResult {
  valid: boolean;
  reason?: string;
  sortedChunks: ArchiveChunkRecord[];
}

export type PlaybackProbeOutcome = 'playable' | 'media-error' | 'timeout-unplayable';

export interface PlaybackValidationResult {
  playable: boolean;
  outcome?: PlaybackProbeOutcome;
  reason?: string;
}

/**
 * Checks whether a Blob starts with the 4-byte WebM EBML header (1A 45 DF A3).
 */
export async function hasWebmEbmlHeader(blob: Blob): Promise<boolean> {
  if (!blob || blob.size < 4) return false;
  try {
    const headerSlice = blob.slice(0, 4);
    const buf =
      typeof headerSlice.arrayBuffer === 'function'
        ? await headerSlice.arrayBuffer()
        : await new Response(headerSlice).arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length < 4) return false;
    return (
      bytes[0] === WEBM_EBML_MAGIC_BYTES[0] &&
      bytes[1] === WEBM_EBML_MAGIC_BYTES[1] &&
      bytes[2] === WEBM_EBML_MAGIC_BYTES[2] &&
      bytes[3] === WEBM_EBML_MAGIC_BYTES[3]
    );
  } catch {
    return false;
  }
}

/**
 * Step 1: Structural validation of archive chunks before assembly.
 * Validates:
 * - non-empty chunk list
 * - unique non-negative integer chunkIndex values (no duplicates)
 * - presence of chunkIndex 0
 * - contiguous sequence from 0 to N-1 (no missing middle chunks)
 * - non-empty blob on each chunk
 * - chunk count matches session.archiveChunkCount when available
 * - chunk 0 begins with WebM EBML magic bytes (1A 45 DF A3)
 */
export async function validateArchiveChunksStructure(
  chunks: ArchiveChunkRecord[],
  expectedChunkCount?: number
): Promise<ArchiveStructureValidationResult> {
  if (!chunks || chunks.length === 0) {
    return {
      valid: false,
      reason: 'Tidak ada chunk rekaman yang tersimpan.',
      sortedChunks: [],
    };
  }

  const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  const seenIndices = new Set<number>();
  for (const chunk of sortedChunks) {
    if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) {
      return {
        valid: false,
        reason: `Index chunk arsip tidak valid (${chunk.chunkIndex}).`,
        sortedChunks,
      };
    }
    if (seenIndices.has(chunk.chunkIndex)) {
      return {
        valid: false,
        reason: `Terdapat duplikasi chunk arsip pada index ${chunk.chunkIndex}.`,
        sortedChunks,
      };
    }
    seenIndices.add(chunk.chunkIndex);
  }

  if (sortedChunks[0].chunkIndex !== 0) {
    return {
      valid: false,
      reason: 'Header rekaman (chunk awal index 0) tidak ditemukan.',
      sortedChunks,
    };
  }

  for (let i = 0; i < sortedChunks.length; i++) {
    if (sortedChunks[i].chunkIndex !== i) {
      return {
        valid: false,
        reason: `Urutan chunk arsip tidak berurutan pada index ${i} (ditemukan index ${sortedChunks[i].chunkIndex}).`,
        sortedChunks,
      };
    }
    if (!sortedChunks[i].blob || sortedChunks[i].blob.size === 0 || sortedChunks[i].sizeBytes <= 0) {
      return {
        valid: false,
        reason: `Data chunk arsip pada index ${i} kosong (0 byte).`,
        sortedChunks,
      };
    }
  }

  if (typeof expectedChunkCount === 'number' && expectedChunkCount > 0) {
    if (sortedChunks.length !== expectedChunkCount) {
      return {
        valid: false,
        reason: `Jumlah chunk arsip (${sortedChunks.length}) tidak sesuai dengan catatan sesi (${expectedChunkCount}).`,
        sortedChunks,
      };
    }
  }

  const hasValidHeader = await hasWebmEbmlHeader(sortedChunks[0].blob);
  if (!hasValidHeader) {
    return {
      valid: false,
      reason: 'Chunk pertama tidak memiliki header WebM EBML yang valid (1A 45 DF A3).',
      sortedChunks,
    };
  }

  return {
    valid: true,
    sortedChunks,
  };
}

/**
 * Step 2: Concatenates validated ordered archive chunks into a single Blob.
 */
export function assembleArchiveBlob(
  chunks: ArchiveChunkRecord[],
  mimeType = 'audio/webm;codecs=opus'
): Blob {
  if (!chunks || chunks.length === 0) {
    throw new Error('Tidak ada chunk rekaman yang tersimpan.');
  }

  const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  if (sortedChunks[0].chunkIndex !== 0) {
    throw new Error('Header rekaman (chunk awal index 0) tidak ditemukan.');
  }

  const parts: BlobPart[] = sortedChunks.map(c => c.blob);
  const blob = new Blob(parts, { type: mimeType });

  if (blob.size === 0) {
    throw new Error('Berkas arsip rekaman kosong.');
  }

  return blob;
}

/**
 * Step 3: Bounded browser playback probe using HTMLAudioElement.
 * Outcomes are strictly: 'playable' | 'media-error' | 'timeout-unplayable'.
 * All event listeners, timers, audio attributes, and Object URLs are cleaned up in all paths.
 */
export async function validateBlobPlayable(
  blob: Blob,
  timeoutMs = 4000
): Promise<PlaybackValidationResult> {
  if (!blob || blob.size === 0) {
    return {
      playable: false,
      outcome: 'media-error',
      reason: 'Ukuran blob audio 0 byte.',
    };
  }

  const hasHeader = await hasWebmEbmlHeader(blob);
  if (!hasHeader) {
    return {
      playable: false,
      outcome: 'media-error',
      reason: 'Header WebM EBML (1A 45 DF A3) tidak valid.',
    };
  }

  const AudioCtor: typeof Audio | undefined =
    typeof Audio !== 'undefined'
      ? Audio
      : typeof window !== 'undefined' && typeof (window as any).Audio === 'function'
        ? (window as any).Audio
        : undefined;

  const urlApi: typeof URL | undefined =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL
      : typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function'
        ? window.URL
        : undefined;

  if (typeof AudioCtor !== 'function' || !urlApi) {
    return {
      playable: false,
      outcome: 'media-error',
      reason: 'HTMLAudioElement tidak tersedia untuk memvalidasi pemutaran audio.',
    };
  }

  return new Promise<PlaybackValidationResult>((resolve) => {
    let resolved = false;
    let url = '';
    try {
      url = urlApi.createObjectURL(blob);
    } catch (err: any) {
      return resolve({
        playable: false,
        outcome: 'media-error',
        reason: err?.message || 'Gagal membuat URL objek audio.',
      });
    }

    const audio = new AudioCtor();
    audio.preload = 'metadata';

    const cleanup = () => {
      try {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('stalled', onStalled);
        audio.removeEventListener('abort', onAbort);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // ignore audio cleanup error
      }
      try {
        if (url) {
          urlApi.revokeObjectURL(url);
        }
      } catch {
        // ignore URL revoke error
      }
    };

    const finish = (playable: boolean, outcome: PlaybackProbeOutcome, reason?: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup();
      resolve({ playable, outcome, reason });
    };

    const onCanPlay = () => finish(true, 'playable');
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        finish(true, 'playable');
      }
    };
    const onError = () => {
      const err = audio.error;
      finish(
        false,
        'media-error',
        err
          ? `Code ${err.code}: ${err.message || 'Media decode error'}`
          : 'Format audio tidak dapat dibaca oleh peramban.'
      );
    };
    const onStalled = () => {
      // Wait until timeout or recovery unless error fires
    };
    const onAbort = () => {
      finish(false, 'media-error', 'Pemutaran evaluasi audio dibatalkan.');
    };

    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);
    audio.addEventListener('abort', onAbort);

    const timer = setTimeout(() => {
      finish(false, 'timeout-unplayable', 'Validasi pemutaran audio peramban melampaui batas waktu.');
    }, timeoutMs);

    try {
      audio.src = url;
      audio.load();
    } catch (err: any) {
      finish(false, 'media-error', err?.message || 'Gagal memuat elemen audio.');
    }
  });
}

/**
 * Loads completed durable transcription checkpoints from IndexedDB
 * and reconstructs the ordered global transcript.
 * If reading checkpoints fails, marks the session as recoverable and throws a structured error
 * so draft audio and checkpoints are never overwritten or deleted.
 */
export async function loadCompletedTranscriptSegments(
  sessionId: string,
  store: RecordingStore
): Promise<DialogSegment[]> {
  let storedSegs;
  try {
    storedSegs = await store.getTranscriptionSegments(sessionId);
  } catch (segLoadErr: any) {
    const message = `Gagal memuat checkpoint transkripsi: ${segLoadErr?.message || 'Penyimpanan lokal tidak dapat dibaca.'}`;
    try {
      await store.updateSession(sessionId, {
        status: 'recoverable',
        errorCode: 'checkpoint-read-failed',
        errorMessage: message,
      });
    } catch {
      // ignore background update error
    }
    const err = new Error(message);
    (err as any).code = 'checkpoint-read-failed';
    (err as any).retryable = true;
    throw err;
  }

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
 * Centralized transcript-aware finalization pipeline used by:
 * - Normal RecordingEngine.stop()
 * - RecordingEngine.retryFinalization()
 * - Recovery from app restart
 */
export interface FinalizeRecordingOptions {
  projectId?: string;
  title?: string;
  segments?: DialogSegment[];
  speakerNames?: Record<string, string>;
  validateBlobPlayableFn?: (blob: Blob) => Promise<PlaybackValidationResult>;
  saveToWorkspaceFn?: (
    recording: RecordingRecord,
    audioBlob: Blob,
    segments: DialogSegment[],
    speakerNames: Record<string, string>
  ) => Promise<void>;
}

export async function finalizeRecordingSession(
  sessionId: string,
  store: RecordingStore,
  options: FinalizeRecordingOptions = {}
): Promise<FinalizeRecordingResult> {
  // Ensure all pending disk writes have finished
  await store.waitForPendingWrites();

  // Fetch session metadata
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Sesi rekaman ${sessionId} tidak ditemukan di penyimpanan lokal.`);
  }

  // 1. Load ordered archive chunks
  const chunks = await store.getOrderedArchiveChunks(sessionId);
  if (chunks.length === 0) {
    await store.updateSession(sessionId, {
      status: 'recoverable',
      errorCode: 'archive-finalization-failed',
      errorMessage: 'Tidak ada data rekaman audio yang berhasil dihimpun.',
    });
    const err = new Error('Gagal merakit arsip rekaman: data audio kosong.');
    (err as any).code = 'archive-finalization-failed';
    (err as any).retryable = true;
    throw err;
  }

  const totalArchiveBytes = chunks.reduce((acc, c) => acc + c.sizeBytes, 0);
  if (totalArchiveBytes === 0) {
    await store.updateSession(sessionId, {
      status: 'recoverable',
      errorCode: 'archive-finalization-failed',
      errorMessage: 'Gagal merakit arsip rekaman: total ukuran chunk 0 byte.',
    });
    const err = new Error('Gagal merakit arsip rekaman: total ukuran chunk 0 byte.');
    (err as any).code = 'archive-finalization-failed';
    (err as any).retryable = true;
    throw err;
  }

  // 2. Structural validation of archive chunks (index uniqueness, contiguity 0..N-1, count, EBML header)
  const structureResult = await validateArchiveChunksStructure(chunks, session.archiveChunkCount);
  if (!structureResult.valid) {
    const message = structureResult.reason || 'Struktur chunk arsip rekaman tidak lengkap atau rusak.';
    await store.updateSession(sessionId, {
      status: 'recoverable',
      errorCode: 'archive-finalization-failed',
      errorMessage: message,
    });
    const err = new Error(message);
    (err as any).code = 'archive-finalization-failed';
    (err as any).retryable = true;
    throw err;
  }

  // 3. Assemble unified archive Blob and validate playback
  // Never substitute a single transcription segment for the full session recording,
  // and never raw-concatenate multiple finalized WebM containers.
  let audioBlob: Blob;
  const validator = options.validateBlobPlayableFn ?? validateBlobPlayable;

  try {
    const candidateBlob = assembleArchiveBlob(
      structureResult.sortedChunks,
      session.mimeType || 'audio/webm;codecs=opus'
    );
    const validation = await validator(candidateBlob);
    if (!validation.playable) {
      throw new Error(
        `Audio arsip tidak dapat diputar (${validation.outcome || 'unplayable'}): ${validation.reason || 'Format tidak didukung'}`
      );
    }
    audioBlob = candidateBlob;
  } catch (assembleErr: any) {
    const message =
      assembleErr?.message ||
      'Bagian audio tetap tersimpan, tetapi belum dapat dirakit menjadi satu berkas utuh.';
    await store.updateSession(sessionId, {
      status: 'recoverable',
      errorCode: 'archive-finalization-failed',
      errorMessage: message,
    });
    const err = new Error(message);
    (err as any).code = 'archive-finalization-failed';
    (err as any).retryable = true;
    throw err;
  }

  // 4. Load completed durable transcriptDialogs and reconstruct global transcript
  const finalSegments =
    options.segments !== undefined
      ? options.segments
      : await loadCompletedTranscriptSegments(sessionId, store);

  const now = Date.now();
  const recordingId = generateRecordingId('rec');
  const durationSec = Math.max(1, Math.round(session.activeDurationMs / 1000));
  const chosenProjectId = options.projectId || session.targetProjectId || 'project-default';
  const chosenTitle = options.title || session.title || 'Rekaman Rapat';

  const recordingRecord: RecordingRecord = {
    id: recordingId,
    projectId: chosenProjectId,
    folderId: null,
    tags: ['mikrofon'],
    title: chosenTitle,
    category: 'Rekaman mikrofon',
    filename: `${recordingId}.webm`,
    durationSec,
    sortIndex: 0,
    createdAt: now,
    updatedAt: now,
  };

  // 5. Atomically save audio + metadata + transcript to workspace store
  const saveFn = options.saveToWorkspaceFn ?? addSingleRecordingToWorkspace;
  try {
    await saveFn(
      recordingRecord,
      audioBlob,
      finalSegments,
      options.speakerNames ?? {}
    );
  } catch (workspaceErr: any) {
    // If workspace save fails, preserve draft so user doesn't lose the recording or transcript
    await store.updateSession(sessionId, {
      status: 'recoverable',
      errorCode: 'workspace-save-failed',
      errorMessage: workspaceErr.message || 'Gagal menyimpan rekaman ke workspace lokal.',
    });
    const err = new Error('Gagal menyimpan rekaman ke workspace. Data sementara tetap tersimpan aman.');
    (err as any).code = 'workspace-save-failed';
    (err as any).retryable = true;
    throw err;
  }

  // 6. ONLY delete temporary session draft data AFTER workspace save successfully completed!
  try {
    await store.deleteSessionData(sessionId);
  } catch {
    // Non-critical if draft cleanup fails, as workspace record is already safe
  }

  return {
    recordingId,
    audioBlob,
    durationSec,
    segments: finalSegments,
  };
}
