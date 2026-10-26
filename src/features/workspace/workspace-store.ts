import type { DialogSegment, Recording } from '../../lib/transcript';

export const WORKSPACE_DATABASE = 'catetin-local';
export const WORKSPACE_DB_VERSION = 2;
export const DEFAULT_PROJECT_ID = 'project-default';

const LEGACY_STORE = 'workspace';
const LEGACY_KEY = 'current';
const S = {
  projects: 'projects',
  recordings: 'recordings',
  transcripts: 'transcripts',
  audio: 'audio',
  folders: 'folders',
  meta: 'meta',
} as const;
const ALL_STORES = [LEGACY_STORE, S.projects, S.recordings, S.transcripts, S.audio, S.folders, S.meta];

export interface SavedWorkspace {
  recordings: Recording[];
  drafts: Record<string, DialogSegment[]>;
  speakerNames: Record<string, Record<string, string>>;
  audioFiles: Record<string, Blob>;
  activeId?: string;
  selectedModel?: 'tiny' | 'base' | 'small';
}

export interface ProjectRecord {
  id: string;
  title: string;
  folderId: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** Folders are a single level: no parentId by design. */
export interface FolderRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface RecordingRecord {
  id: string;
  projectId: string;
  folderId: string | null;
  tags: string[];
  title: string;
  category: string;
  filename: string;
  durationSec: number;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptRecord {
  recordingId: string;
  segments: DialogSegment[];
  speakerNames: Record<string, string>;
  updatedAt: number;
}

export interface MigrationOptions {
  /** Test hook: throwing here must abort the whole migration transaction. */
  onBeforeCommit?: () => void;
}

export function openWorkspaceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DATABASE, WORKSPACE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE);
      if (!db.objectStoreNames.contains(S.projects)) db.createObjectStore(S.projects, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(S.folders)) db.createObjectStore(S.folders, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(S.recordings)) {
        db.createObjectStore(S.recordings, { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains(S.transcripts)) db.createObjectStore(S.transcripts, { keyPath: 'recordingId' });
      if (!db.objectStoreNames.contains(S.audio)) db.createObjectStore(S.audio);
      if (!db.objectStoreNames.contains(S.meta)) db.createObjectStore(S.meta);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function inTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const finished = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaksi penyimpanan dibatalkan.'));
  });
  finished.catch(() => undefined);
  try {
    const result = await work(tx);
    await finished;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* already finished */ }
    throw error;
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Writes a full snapshot into the normalized stores. Must run inside a readwrite transaction. */
async function applySnapshot(tx: IDBTransaction, ws: SavedWorkspace, now: number) {
  const projects = tx.objectStore(S.projects);
  const recordings = tx.objectStore(S.recordings);
  const transcripts = tx.objectStore(S.transcripts);
  const audio = tx.objectStore(S.audio);
  const meta = tx.objectStore(S.meta);

  const [existingRecordings, existingTranscripts, audioKeys, existingProjects] = await Promise.all([
    request(recordings.getAll() as IDBRequest<RecordingRecord[]>),
    request(transcripts.getAll() as IDBRequest<TranscriptRecord[]>),
    request(audio.getAllKeys() as IDBRequest<IDBValidKey[]>),
    request(projects.getAll() as IDBRequest<ProjectRecord[]>),
  ]);
  const previousRecordings = new Map(existingRecordings.map(item => [item.id, item]));
  const previousTranscripts = new Map(existingTranscripts.map(item => [item.recordingId, item]));
  const knownProjects = new Set(existingProjects.map(item => item.id));
  const incomingIds = new Set((ws.recordings ?? []).map(item => item.id));

  for (const [index, recording] of (ws.recordings ?? []).entries()) {
    const previous = previousRecordings.get(recording.id);
    let projectId = recording.projectId ?? previous?.projectId ?? DEFAULT_PROJECT_ID;
    if (!knownProjects.has(projectId)) projectId = DEFAULT_PROJECT_ID;
    if (!knownProjects.has(DEFAULT_PROJECT_ID) && projectId === DEFAULT_PROJECT_ID) {
      projects.put({ id: DEFAULT_PROJECT_ID, title: 'Rekaman saya', folderId: null, tags: [], createdAt: now, updatedAt: now } satisfies ProjectRecord);
      knownProjects.add(DEFAULT_PROJECT_ID);
    }

    const segments = ws.drafts?.[recording.id] ?? recording.segments;
    const speakerNames = ws.speakerNames?.[recording.id] ?? {};
    const previousTranscript = previousTranscripts.get(recording.id);
    const transcriptChanged = !previousTranscript
      || !sameJson(previousTranscript.segments, segments)
      || !sameJson(previousTranscript.speakerNames, speakerNames);
    if (transcriptChanged) {
      transcripts.put({ recordingId: recording.id, segments, speakerNames, updatedAt: now } satisfies TranscriptRecord);
    }

    const next: RecordingRecord = {
      id: recording.id,
      projectId,
      folderId: recording.folderId ?? previous?.folderId ?? null,
      tags: recording.tags ?? previous?.tags ?? [],
      title: recording.title,
      category: recording.category,
      filename: recording.filename,
      durationSec: recording.durationSec,
      sortIndex: index,
      createdAt: previous?.createdAt ?? recording.createdAt ?? now,
      updatedAt: previous?.updatedAt ?? recording.updatedAt ?? now,
    };
    const contentChanged = !previous || transcriptChanged || !sameJson(
      { ...previous, sortIndex: 0, updatedAt: 0 },
      { ...next, sortIndex: 0, updatedAt: 0 },
    );
    if (contentChanged) next.updatedAt = now;
    if (contentChanged || previous?.sortIndex !== index) recordings.put(next);
  }

  for (const previous of existingRecordings) {
    if (incomingIds.has(previous.id)) continue;
    recordings.delete(previous.id);
    transcripts.delete(previous.id);
  }

  const existingAudio = new Set(audioKeys.map(String));
  for (const [id, blob] of Object.entries(ws.audioFiles ?? {})) {
    if (!existingAudio.has(id)) audio.put(blob, id);
  }
  for (const key of existingAudio) {
    if (!(key in (ws.audioFiles ?? {}))) audio.delete(key);
  }

  if (ws.activeId) meta.put(ws.activeId, 'activeId'); else meta.delete('activeId');
  if (ws.selectedModel) meta.put(ws.selectedModel, 'selectedModel'); else meta.delete('selectedModel');
}

/**
 * Moves the legacy single-record workspace into the normalized stores.
 * Runs in one transaction, so an interrupted run leaves the legacy record untouched,
 * and the `schema` marker makes later runs a no-op.
 */
export async function migrateLegacyWorkspace(db: IDBDatabase, options: MigrationOptions = {}) {
  await inTransaction(db, ALL_STORES, 'readwrite', async tx => {
    const meta = tx.objectStore(S.meta);
    if (await request(meta.get('schema'))) return;
    const legacyStore = tx.objectStore(LEGACY_STORE);
    const legacy = await request(legacyStore.get(LEGACY_KEY)) as SavedWorkspace | undefined;
    const now = Date.now();
    if (legacy) {
      await applySnapshot(tx, {
        recordings: legacy.recordings ?? [],
        drafts: legacy.drafts ?? {},
        speakerNames: legacy.speakerNames ?? {},
        audioFiles: legacy.audioFiles ?? {},
        activeId: legacy.activeId,
        selectedModel: legacy.selectedModel,
      }, now);
      legacyStore.delete(LEGACY_KEY);
    }
    meta.put({ version: WORKSPACE_DB_VERSION, migratedFromLegacy: Boolean(legacy), migratedAt: now }, 'schema');
    options.onBeforeCommit?.();
  });
}

export async function loadWorkspace(): Promise<SavedWorkspace | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);
    return await inTransaction(db, [S.recordings, S.transcripts, S.audio, S.meta], 'readonly', async tx => {
      const [records, transcriptList, audioKeys, audioValues, activeId, selectedModel] = await Promise.all([
        request(tx.objectStore(S.recordings).getAll() as IDBRequest<RecordingRecord[]>),
        request(tx.objectStore(S.transcripts).getAll() as IDBRequest<TranscriptRecord[]>),
        request(tx.objectStore(S.audio).getAllKeys() as IDBRequest<IDBValidKey[]>),
        request(tx.objectStore(S.audio).getAll() as IDBRequest<Blob[]>),
        request(tx.objectStore(S.meta).get('activeId') as IDBRequest<string | undefined>),
        request(tx.objectStore(S.meta).get('selectedModel') as IDBRequest<SavedWorkspace['selectedModel']>),
      ]);
      if (!records.length) return null;
      const transcripts = new Map(transcriptList.map(item => [item.recordingId, item]));
      const result: SavedWorkspace = { recordings: [], drafts: {}, speakerNames: {}, audioFiles: {}, activeId, selectedModel };
      for (const record of [...records].sort((a, b) => a.sortIndex - b.sortIndex)) {
        const transcript = transcripts.get(record.id);
        const segments = transcript?.segments ?? [];
        result.recordings.push({
          id: record.id,
          title: record.title,
          category: record.category,
          filename: record.filename,
          durationSec: record.durationSec,
          segments,
          projectId: record.projectId,
          folderId: record.folderId,
          tags: record.tags,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
        if (transcript) {
          result.drafts[record.id] = segments;
          result.speakerNames[record.id] = transcript.speakerNames;
        }
      }
      audioKeys.forEach((key, index) => { result.audioFiles[String(key)] = audioValues[index]; });
      return result;
    });
  } finally {
    db.close();
  }
}

export async function saveWorkspace(value: SavedWorkspace) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);
    await inTransaction(db, ALL_STORES, 'readwrite', tx => applySnapshot(tx, value, Date.now()));
  } finally {
    db.close();
  }
}

