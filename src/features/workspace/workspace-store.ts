import type { DialogSegment, Recording } from '../../lib/transcript';

export const WORKSPACE_DATABASE = 'catetin-local';
export const WORKSPACE_DB_VERSION = 2;
export const DEFAULT_PROJECT_ID = 'project-default';

export const DEMO_RECORDING_IDS = new Set(['wawancara', 'rapat', 'kuliah']);

export function isDemoRecordingId(id: string): boolean {
  return DEMO_RECORDING_IDS.has(id);
}

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
  projects?: ProjectRecord[];
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

export interface ProjectSummary {
  id: string;
  title: string;
  folderId: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  recordingCount: number;
  totalDurationSec: number;
}

export interface RecentRecording {
  id: string;
  title: string;
  projectId: string;
  projectTitle: string;
  category: string;
  filename: string;
  durationSec: number;
  updatedAt: number;
}

export interface WorkspaceStats {
  projectCount: number;
  recordingCount: number;
  totalDurationSec: number;
  lastUpdatedAt: number | null;
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

  if (ws.projects) {
    for (const p of ws.projects) {
      projects.put(p);
      knownProjects.add(p.id);
    }
  }

  const userRecordings = (ws.recordings ?? []).filter(item => !isDemoRecordingId(item.id));
  const incomingIds = new Set(userRecordings.map(item => item.id));

  for (const [index, recording] of userRecordings.entries()) {
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
    if (isDemoRecordingId(id)) continue;
    if (!existingAudio.has(id)) audio.put(blob, id);
  }
  for (const key of existingAudio) {
    const keyStr = String(key);
    if (isDemoRecordingId(keyStr)) {
      audio.delete(key);
      continue;
    }
    if (!(keyStr in (ws.audioFiles ?? {}))) audio.delete(key);
  }

  if (ws.activeId && !isDemoRecordingId(ws.activeId)) meta.put(ws.activeId, 'activeId'); else meta.delete('activeId');
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

export async function createProject(title: string): Promise<ProjectRecord> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('Penyimpanan lokal tidak tersedia.');
  }
  const cleanTitle = title.trim();
  if (!cleanTitle) {
    throw new Error('Judul project tidak boleh kosong.');
  }
  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);
    const now = Date.now();
    const id = `project-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const record: ProjectRecord = {
      id,
      title: cleanTitle,
      folderId: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    await inTransaction(db, [S.projects], 'readwrite', async tx => {
      tx.objectStore(S.projects).put(record);
    });
    return record;
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<ProjectRecord[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);
    return await inTransaction(db, [S.projects], 'readonly', async tx => {
      const items = await request(tx.objectStore(S.projects).getAll() as IDBRequest<ProjectRecord[]>);
      return items.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  } finally {
    db.close();
  }
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);
    return await inTransaction(db, [S.projects, S.recordings], 'readonly', async tx => {
      const [projects, allRecordings] = await Promise.all([
        request(tx.objectStore(S.projects).getAll() as IDBRequest<ProjectRecord[]>),
        request(tx.objectStore(S.recordings).getAll() as IDBRequest<RecordingRecord[]>),
      ]);
      const userRecordings = allRecordings.filter(r => !isDemoRecordingId(r.id));
      const recordingsByProject = new Map<string, RecordingRecord[]>();
      for (const rec of userRecordings) {
        const list = recordingsByProject.get(rec.projectId) ?? [];
        list.push(rec);
        recordingsByProject.set(rec.projectId, list);
      }

      const summaries: ProjectSummary[] = [];
      for (const project of projects) {
        const recs = recordingsByProject.get(project.id) ?? [];
        // Only include DEFAULT_PROJECT_ID if it actually contains user recordings
        if (project.id === DEFAULT_PROJECT_ID && recs.length === 0) continue;
        summaries.push({
          id: project.id,
          title: project.title,
          folderId: project.folderId,
          tags: project.tags,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          recordingCount: recs.length,
          totalDurationSec: recs.reduce((sum, r) => sum + (r.durationSec || 0), 0),
        });
      }
      return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  } finally {
    db.close();
  }
}

export async function listRecentRecordings(limit = 6): Promise<RecentRecording[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);
    return await inTransaction(db, [S.projects, S.recordings], 'readonly', async tx => {
      const [projects, allRecordings] = await Promise.all([
        request(tx.objectStore(S.projects).getAll() as IDBRequest<ProjectRecord[]>),
        request(tx.objectStore(S.recordings).getAll() as IDBRequest<RecordingRecord[]>),
      ]);
      const projectMap = new Map(projects.map(p => [p.id, p]));
      const userRecordings = allRecordings.filter(r => !isDemoRecordingId(r.id));
      userRecordings.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return userRecordings.slice(0, limit).map(rec => ({
        id: rec.id,
        title: rec.title,
        projectId: rec.projectId,
        projectTitle: projectMap.get(rec.projectId)?.title ?? 'Rekaman saya',
        category: rec.category,
        filename: rec.filename,
        durationSec: rec.durationSec,
        updatedAt: rec.updatedAt,
      }));
    });
  } finally {
    db.close();
  }
}

export async function getWorkspaceStats(): Promise<WorkspaceStats> {
  if (typeof indexedDB === 'undefined') {
    return { projectCount: 0, recordingCount: 0, totalDurationSec: 0, lastUpdatedAt: null };
  }
  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);
    return await inTransaction(db, [S.projects, S.recordings], 'readonly', async tx => {
      const [projects, allRecordings] = await Promise.all([
        request(tx.objectStore(S.projects).getAll() as IDBRequest<ProjectRecord[]>),
        request(tx.objectStore(S.recordings).getAll() as IDBRequest<RecordingRecord[]>),
      ]);
      const userRecordings = allRecordings.filter(r => !isDemoRecordingId(r.id));
      const userProjects = projects.filter(p => p.id !== DEFAULT_PROJECT_ID || userRecordings.some(r => r.projectId === p.id));

      let lastUpdatedAt: number | null = null;
      for (const p of userProjects) {
        if (!lastUpdatedAt || p.updatedAt > lastUpdatedAt) lastUpdatedAt = p.updatedAt;
      }
      for (const r of userRecordings) {
        if (!lastUpdatedAt || r.updatedAt > lastUpdatedAt) lastUpdatedAt = r.updatedAt;
      }

      return {
        projectCount: userProjects.length,
        recordingCount: userRecordings.length,
        totalDurationSec: userRecordings.reduce((sum, r) => sum + (r.durationSec || 0), 0),
        lastUpdatedAt,
      };
    });
  } finally {
    db.close();
  }
}

export async function loadWorkspace(): Promise<SavedWorkspace | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);
    return await inTransaction(db, [S.recordings, S.transcripts, S.audio, S.meta, S.projects], 'readonly', async tx => {
      const [records, transcriptList, audioKeys, audioValues, activeId, selectedModel, projects] = await Promise.all([
        request(tx.objectStore(S.recordings).getAll() as IDBRequest<RecordingRecord[]>),
        request(tx.objectStore(S.transcripts).getAll() as IDBRequest<TranscriptRecord[]>),
        request(tx.objectStore(S.audio).getAllKeys() as IDBRequest<IDBValidKey[]>),
        request(tx.objectStore(S.audio).getAll() as IDBRequest<Blob[]>),
        request(tx.objectStore(S.meta).get('activeId') as IDBRequest<string | undefined>),
        request(tx.objectStore(S.meta).get('selectedModel') as IDBRequest<SavedWorkspace['selectedModel']>),
        request(tx.objectStore(S.projects).getAll() as IDBRequest<ProjectRecord[]>),
      ]);
      const userRecords = records.filter(r => !isDemoRecordingId(r.id));
      if (!userRecords.length && !projects.length) return null;

      const transcripts = new Map(transcriptList.map(item => [item.recordingId, item]));
      const result: SavedWorkspace = {
        projects,
        recordings: [],
        drafts: {},
        speakerNames: {},
        audioFiles: {},
        activeId: activeId && !isDemoRecordingId(activeId) ? activeId : undefined,
        selectedModel,
      };
      for (const record of [...userRecords].sort((a, b) => a.sortIndex - b.sortIndex)) {
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
      audioKeys.forEach((key, index) => {
        const keyStr = String(key);
        if (!isDemoRecordingId(keyStr)) {
          result.audioFiles[keyStr] = audioValues[index];
        }
      });
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
