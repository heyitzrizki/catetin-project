import type { TranscriptChunkResult } from './chunk-merger';
import type { JobCompatibility, TranscriptionBackend, TranscriptionLanguage, TranscriptionModel } from './types';

const DATABASE = 'catetin-transcription';
const STORE = 'checkpoints';
export const DEFAULT_RETENTION_DAYS = 30;
export const EXPIRY_WARNING_DAYS = 7;
const DAY_MS = 86_400_000;

export interface CheckpointSettings {
  model: TranscriptionModel;
  language: TranscriptionLanguage;
  backend: TranscriptionBackend;
}

export interface TranscriptionCheckpoint {
  id: string;
  inputFingerprint: string;
  settings: CheckpointSettings;
  compatibility: JobCompatibility;
  backendHistory: TranscriptionBackend[];
  chunks: TranscriptChunkResult[];
  state: 'paused' | 'resumable' | 'cancelled' | 'error';
  createdAt: number;
  updatedAt: number;
  retentionMode: 'timed' | 'manual';
}

export interface CheckpointSummary {
  id: string;
  inputFingerprint: string;
  state: TranscriptionCheckpoint['state'];
  updatedAt: number;
  retentionMode: TranscriptionCheckpoint['retentionMode'];
  expiresAt: number | null;
  expiringSoon: boolean;
  compatible?: boolean;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

function equalRecord(left: object, right: object) {
  const leftEntries = Object.entries(left);
  return leftEntries.length === Object.keys(right).length
    && leftEntries.every(([key, value]) => value === (right as Record<string, unknown>)[key]);
}

export async function saveCheckpoint(value: TranscriptionCheckpoint) {
  await withStore('readwrite', store => store.put(value));
}

export async function findResumableCheckpoint(
  inputFingerprint: string,
  settings: CheckpointSettings,
  compatibility: JobCompatibility,
): Promise<TranscriptionCheckpoint | null> {
  const checkpoints = await withStore<TranscriptionCheckpoint[]>('readonly', store => store.getAll());
  return checkpoints.find(item => item.inputFingerprint === inputFingerprint
    && equalRecord(item.settings, settings)
    && equalRecord(item.compatibility, compatibility)) ?? null;
}

export async function findMatchingCheckpoints(
  inputFingerprint: string,
  language: TranscriptionLanguage,
  compatibility: JobCompatibility,
): Promise<TranscriptionCheckpoint[]> {
  const checkpoints = await withStore<TranscriptionCheckpoint[]>('readonly', store => store.getAll());
  return checkpoints.filter(item => item.inputFingerprint === inputFingerprint
    && item.settings.language === language
    && equalRecord(item.compatibility, compatibility));
}

export async function setCheckpointRetention(id: string, retentionMode: TranscriptionCheckpoint['retentionMode']) {
  const checkpoint = await withStore<TranscriptionCheckpoint | undefined>('readonly', store => store.get(id));
  if (!checkpoint) return false;
  await saveCheckpoint({ ...checkpoint, retentionMode });
  return true;
}

export async function listCheckpointSummaries(now = Date.now()): Promise<CheckpointSummary[]> {
  const checkpoints = await withStore<TranscriptionCheckpoint[]>('readonly', store => store.getAll());
  return checkpoints.map(item => {
    const expiresAt = item.retentionMode === 'timed' ? item.updatedAt + DEFAULT_RETENTION_DAYS * DAY_MS : null;
    return {
      id: item.id,
      inputFingerprint: item.inputFingerprint,
      state: item.state,
      updatedAt: item.updatedAt,
      retentionMode: item.retentionMode,
      expiresAt,
      expiringSoon: expiresAt !== null && expiresAt > now && expiresAt - now <= EXPIRY_WARNING_DAYS * DAY_MS,
    };
  });
}

export async function deleteCheckpoint(id: string) {
  await withStore('readwrite', store => store.delete(id));
}

export async function purgeExpiredCheckpoints(now = Date.now()) {
  const summaries = await listCheckpointSummaries(now);
  const expired = summaries.filter(item => item.expiresAt !== null && item.expiresAt <= now).map(item => item.id);
  await Promise.all(expired.map(deleteCheckpoint));
  return expired;
}
