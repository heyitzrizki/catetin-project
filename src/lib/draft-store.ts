import type { DialogSegment, Recording } from './transcript';

const DATABASE = 'catetin-local';
const STORE = 'workspace';
const KEY = 'current';

export interface SavedWorkspace {
  recordings: Recording[];
  drafts: Record<string, DialogSegment[]>;
  speakerNames: Record<string, Record<string, string>>;
  audioFiles: Record<string, Blob>;
  activeId?: string;
  selectedModel?: 'tiny' | 'base' | 'small';
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkspace(): Promise<SavedWorkspace | null> {
  if (!('indexedDB' in window)) return null;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE);
    const request = transaction.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function saveWorkspace(value: SavedWorkspace) {
  if (!('indexedDB' in window)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
