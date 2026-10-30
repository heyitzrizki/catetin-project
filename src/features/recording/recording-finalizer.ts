import { addSingleRecordingToWorkspace, type RecordingRecord } from '../workspace/workspace-store';
import type { RecordingStore } from './recording-store';
import { generateRecordingId, type ArchiveChunkRecord } from './recording-types';
import type { DialogSegment } from '../../lib/transcript';

export interface FinalizeRecordingResult {
  recordingId: string;
  audioBlob: Blob;
  durationSec: number;
}

export function assembleArchiveBlob(
  chunks: ArchiveChunkRecord[],
  mimeType = 'audio/webm;codecs=opus'
): Blob {
  if (!chunks || chunks.length === 0) {
    throw new Error('Tidak ada chunk rekaman yang tersimpan.');
  }

  const parts: BlobPart[] = chunks.map(c => c.blob);
  const blob = new Blob(parts, { type: mimeType });

  if (blob.size === 0) {
    throw new Error('Berkas arsip rekaman kosong.');
  }

  return blob;
}

export async function finalizeRecordingSession(
  sessionId: string,
  store: RecordingStore,
  options: {
    projectId?: string;
    title?: string;
    segments?: DialogSegment[];
    speakerNames?: Record<string, string>;
    saveToWorkspaceFn?: (
      recording: RecordingRecord,
      audioBlob: Blob,
      segments: DialogSegment[],
      speakerNames: Record<string, string>
    ) => Promise<void>;
  } = {}
): Promise<FinalizeRecordingResult> {
  // 1. Ensure all pending disk writes have finished
  await store.waitForPendingWrites();

  // 2. Fetch session and ordered archive chunks
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Sesi rekaman ${sessionId} tidak ditemukan di penyimpanan lokal.`);
  }

  const chunks = await store.getOrderedArchiveChunks(sessionId);
  if (chunks.length === 0) {
    await store.updateSession(sessionId, {
      status: 'failed',
      errorCode: 'archive-finalization-failed',
      errorMessage: 'Tidak ada data rekaman audio yang berhasil dihimpun.',
    });
    const err = new Error('Gagal merakit arsip rekaman: data audio kosong.');
    (err as any).code = 'archive-finalization-failed';
    throw err;
  }

  // 3. Pre-validate total metadata size before assembly
  const totalArchiveBytes = chunks.reduce((acc, c) => acc + c.sizeBytes, 0);
  if (totalArchiveBytes === 0) {
    const err = new Error('Gagal merakit arsip rekaman: total ukuran chunk 0 byte.');
    (err as any).code = 'archive-finalization-failed';
    throw err;
  }

  // 4. Assemble unified archive Blob referencing chunk Blobs directly without whole-file ArrayBuffer copying
  let audioBlob: Blob;
  try {
    audioBlob = assembleArchiveBlob(chunks, session.mimeType || 'audio/webm;codecs=opus');
  } catch (assembleErr: any) {
    await store.updateSession(sessionId, {
      status: 'failed',
      errorCode: 'archive-finalization-failed',
      errorMessage: assembleErr.message || 'Gagal merakit blob rekaman.',
    });
    const err = new Error('Perakitan audio arsip gagal.');
    (err as any).code = 'archive-finalization-failed';
    throw err;
  }

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

  // 4. Save to workspace store with safety guard
  const saveFn = options.saveToWorkspaceFn ?? addSingleRecordingToWorkspace;
  try {
    await saveFn(
      recordingRecord,
      audioBlob,
      options.segments ?? [],
      options.speakerNames ?? {}
    );
  } catch (workspaceErr: any) {
    // If workspace save fails, preserve draft so user doesn't lose the recording!
    await store.updateSession(sessionId, {
      status: 'recoverable',
      errorCode: 'workspace-save-failed',
      errorMessage: workspaceErr.message || 'Gagal menyimpan rekaman ke workspace lokal.',
    });
    const err = new Error('Gagal menyimpan rekaman ke workspace. Data sementara tetap tersimpan aman.');
    (err as any).code = 'workspace-save-failed';
    throw err;
  }

  // 5. ONLY delete temporary session draft data AFTER workspace save successfully completed!
  try {
    await store.deleteSessionData(sessionId);
  } catch {
    // Non-critical if draft cleanup fails, as workspace record is already safe
  }

  return {
    recordingId,
    audioBlob,
    durationSec,
  };
}
