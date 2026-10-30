import type { DialogSegment } from '../../lib/transcript';
import type {
  ArchiveChunkRecord,
  RecordingErrorCode,
  RecordingSession,
  TranscriptionSegmentRecord,
} from './recording-types';

export const RECORDING_DRAFTS_DB = 'catetin-recording-drafts';
export const RECORDING_DRAFTS_DB_VERSION = 1;

const STORES = {
  sessions: 'sessions',
  archiveChunks: 'archiveChunks',
  transcriptionSegments: 'transcriptionSegments',
} as const;

export class RecordingStore {
  private db: IDBDatabase | null = null;
  private pendingWrites = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingWaiters: Array<() => void> = [];

  constructor(private dbName = RECORDING_DRAFTS_DB) {}

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not supported in this environment');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, RECORDING_DRAFTS_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.sessions)) {
          db.createObjectStore(STORES.sessions, { keyPath: 'sessionId' });
        }
        if (!db.objectStoreNames.contains(STORES.archiveChunks)) {
          const chunkStore = db.createObjectStore(STORES.archiveChunks, {
            keyPath: ['sessionId', 'chunkIndex'],
          });
          chunkStore.createIndex('bySession', 'sessionId');
        }
        if (!db.objectStoreNames.contains(STORES.transcriptionSegments)) {
          const segStore = db.createObjectStore(STORES.transcriptionSegments, {
            keyPath: ['sessionId', 'segmentIndex'],
          });
          segStore.createIndex('bySession', 'sessionId');
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  getPendingWriteCount(): number {
    return this.pendingWrites;
  }

  async waitForPendingWrites(): Promise<void> {
    if (this.pendingWrites === 0) return;
    return new Promise(resolve => {
      this.pendingWaiters.push(resolve);
    });
  }

  private notifyWaitersIfDone(): void {
    if (this.pendingWrites === 0) {
      const waiters = [...this.pendingWaiters];
      this.pendingWaiters = [];
      waiters.forEach(w => w());
    }
  }

  async saveSession(session: RecordingSession): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.sessions, 'readwrite');
      const store = tx.objectStore(STORES.sessions);
      store.put(session);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save session'));
      tx.onabort = () => reject(tx.error ?? new Error('Session save aborted'));
    });
  }

  async updateSession(
    sessionId: string,
    updates: Partial<Omit<RecordingSession, 'sessionId'>>
  ): Promise<RecordingSession | null> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.sessions, 'readwrite');
      const store = tx.objectStore(STORES.sessions);
      const getReq = store.get(sessionId);
      let updated: RecordingSession | null = null;

      getReq.onsuccess = () => {
        const existing = getReq.result as RecordingSession | undefined;
        if (!existing) {
          return;
        }
        updated = {
          ...existing,
          ...updates,
          lastUpdatedAt: Date.now(),
        };
        store.put(updated);
      };

      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error ?? new Error('Failed to update session'));
      tx.onabort = () => reject(tx.error ?? new Error('Session update aborted'));
    });
  }

  async getSession(sessionId: string): Promise<RecordingSession | null> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.sessions, 'readonly');
      const store = tx.objectStore(STORES.sessions);
      const req = store.get(sessionId);
      req.onsuccess = () => resolve((req.result as RecordingSession) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async listRecoverableSessions(): Promise<RecordingSession[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.sessions, 'readonly');
      const store = tx.objectStore(STORES.sessions);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as RecordingSession[]) ?? [];
        // Active, paused, stopping, or finalizing sessions that crashed or were interrupted
        const recoverable = all.filter(
          s => s.status === 'recording' || s.status === 'paused' || s.status === 'stopping' || s.status === 'finalizing' || s.status === 'recoverable'
        );
        resolve(recoverable);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Appends an archive chunk through the serial write queue.
   * Tracks pending writes and catches QuotaExceededError without deleting existing data.
   */
  appendArchiveChunk(chunk: ArchiveChunkRecord): Promise<void> {
    this.pendingWrites += 1;

    const task = async () => {
      try {
        const db = await this.init();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([STORES.archiveChunks, STORES.sessions], 'readwrite');
          const chunkStore = tx.objectStore(STORES.archiveChunks);
          const sessionStore = tx.objectStore(STORES.sessions);

          const putChunkReq = chunkStore.put(chunk);
          putChunkReq.onerror = () => {
            reject(putChunkReq.error ?? tx.error ?? new Error('Transaction error while putting archive chunk'));
          };

          const getReq = sessionStore.get(chunk.sessionId);
          getReq.onsuccess = () => {
            const session = getReq.result as RecordingSession | undefined;
            if (session) {
              session.archiveChunkCount += 1;
              session.archiveTotalBytes += chunk.sizeBytes;
              session.activeDurationMs = chunk.activeDurationMs;
              session.lastUpdatedAt = Date.now();
              sessionStore.put(session);
            }
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => {
            const err = tx.error;
            reject(err ?? new Error('Transaction error while appending archive chunk'));
          };
          tx.onabort = () => {
            reject(tx.error ?? new Error('Transaction aborted while appending archive chunk'));
          };
        });
      } finally {
        this.pendingWrites -= 1;
        this.notifyWaitersIfDone();
      }
    };

    this.writeQueue = this.writeQueue.then(task, task);
    return this.writeQueue;
  }

  async getOrderedArchiveChunks(sessionId: string): Promise<ArchiveChunkRecord[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.archiveChunks, 'readonly');
      const store = tx.objectStore(STORES.archiveChunks);
      const index = store.index('bySession');
      const req = index.getAll(sessionId);

      req.onsuccess = () => {
        const list = (req.result as ArchiveChunkRecord[]) ?? [];
        list.sort((a, b) => a.chunkIndex - b.chunkIndex);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Appends a finalized transcription segment through the serial write queue.
   */
  appendTranscriptionSegment(segment: TranscriptionSegmentRecord): Promise<void> {
    this.pendingWrites += 1;

    const task = async () => {
      try {
        const db = await this.init();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([STORES.transcriptionSegments, STORES.sessions], 'readwrite');
          const segStore = tx.objectStore(STORES.transcriptionSegments);
          const sessionStore = tx.objectStore(STORES.sessions);

          const putSegReq = segStore.put(segment);
          putSegReq.onerror = () => {
            reject(putSegReq.error ?? tx.error ?? new Error('Transaction error while putting segment'));
          };

          const getReq = sessionStore.get(segment.sessionId);
          getReq.onsuccess = () => {
            const session = getReq.result as RecordingSession | undefined;
            if (session) {
              session.segmentCount = Math.max(session.segmentCount, segment.segmentIndex + 1);
              session.lastUpdatedAt = Date.now();
              sessionStore.put(session);
            }
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('Transaction error while appending segment'));
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted while appending segment'));
        });
      } finally {
        this.pendingWrites -= 1;
        this.notifyWaitersIfDone();
      }
    };

    this.writeQueue = this.writeQueue.then(task, task);
    return this.writeQueue;
  }

  async getTranscriptionSegments(sessionId: string): Promise<TranscriptionSegmentRecord[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.transcriptionSegments, 'readonly');
      const store = tx.objectStore(STORES.transcriptionSegments);
      const index = store.index('bySession');
      const req = index.getAll(sessionId);

      req.onsuccess = () => {
        const list = (req.result as TranscriptionSegmentRecord[]) ?? [];
        list.sort((a, b) => a.segmentIndex - b.segmentIndex);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async markSegmentTranscribed(
    sessionId: string,
    segmentIndex: number,
    dialogs?: DialogSegment[]
  ): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.transcriptionSegments, 'readwrite');
      const store = tx.objectStore(STORES.transcriptionSegments);
      const getReq = store.get([sessionId, segmentIndex]);

      getReq.onsuccess = () => {
        const existing = getReq.result as TranscriptionSegmentRecord | undefined;
        if (!existing) {
          return;
        }
        existing.transcribed = true;
        if (dialogs) {
          existing.transcriptDialogs = dialogs;
        }
        store.put(existing);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to mark segment transcribed'));
      tx.onabort = () => reject(tx.error ?? new Error('Mark segment transcribed aborted'));
    });
  }

  /**
   * Cleans up temporary session data (archive chunks and segments).
   * MUST only be called after workspace save and checkpointing succeed!
   */
  async deleteSessionData(sessionId: string): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORES.sessions, STORES.archiveChunks, STORES.transcriptionSegments],
        'readwrite'
      );

      tx.objectStore(STORES.sessions).delete(sessionId);

      const chunkStore = tx.objectStore(STORES.archiveChunks);
      const chunkIndex = chunkStore.index('bySession');
      const chunkKeysReq = chunkIndex.getAllKeys(sessionId);
      chunkKeysReq.onsuccess = () => {
        chunkKeysReq.result.forEach(k => chunkStore.delete(k));
      };

      const segStore = tx.objectStore(STORES.transcriptionSegments);
      const segIndex = segStore.index('bySession');
      const segKeysReq = segIndex.getAllKeys(sessionId);
      segKeysReq.onsuccess = () => {
        segKeysReq.result.forEach(k => segStore.delete(k));
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Delete session data error'));
      tx.onabort = () => reject(tx.error ?? new Error('Delete session data aborted'));
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
