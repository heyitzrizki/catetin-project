import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { RecordingStore } from '../../src/features/recording/recording-store';
import { RecordingEngine } from '../../src/features/recording/recording-engine';
import {
  assembleArchiveBlob,
  finalizeRecordingSession,
  hasWebmEbmlHeader,
  validateArchiveChunksStructure,
  validateBlobPlayable,
  WEBM_EBML_MAGIC_BYTES,
} from '../../src/features/recording/recording-finalizer';
import {
  deduplicateCrossSegmentBoundary,
  mergeCrossSegmentDialogs,
  RecordingTranscriptionAdapter,
  tokenize,
  type OverlapBounds,
} from '../../src/features/recording/recording-transcription-adapter';
import type {
  ArchiveChunkRecord,
  BrowserCapabilities,
  RecordingSession,
  TranscriptionSegmentRecord,
} from '../../src/features/recording/recording-types';
import type { DialogSegment } from '../../src/lib/transcript';

// Mock Track & Stream for MediaRecorder tests
class MockMediaStreamTrack {
  kind = 'audio';
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  onended: (() => void) | null = null;
  stopped = false;
  stopCount = 0;

  stop() {
    this.stopCount++;
    this.stopped = true;
    this.readyState = 'ended';
  }

  triggerEnded() {
    this.stopped = true;
    this.readyState = 'ended';
    if (this.onended) {
      this.onended();
    }
  }
}

class MockMediaStream {
  tracks: MockMediaStreamTrack[];

  constructor(tracks?: MockMediaStreamTrack[]) {
    this.tracks = tracks ?? [new MockMediaStreamTrack()];
  }

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static nextStartThrowsError: Error | null = null;

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  instanceIndex: number;
  autoEmitChunkOnRequestData = true;
  autoEmitChunkOnStop = false;
  delayedStopMs = 0;
  customPayload: number[] | null = null;

  constructor(public stream: any, options: { mimeType?: string } = {}) {
    this.mimeType = options.mimeType || 'audio/webm;codecs=opus';
    this.instanceIndex = MockMediaRecorder.instances.length;
    MockMediaRecorder.instances.push(this);
  }

  start(_timeslice?: number) {
    if (MockMediaRecorder.nextStartThrowsError) {
      const err = MockMediaRecorder.nextStartThrowsError;
      MockMediaRecorder.nextStartThrowsError = null;
      throw err;
    }
    this.state = 'recording';
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    const doStop = () => {
      // Deliver final chunk asynchronously before onstop (mirroring real browser behavior)
      queueMicrotask(() => {
        if (this.autoEmitChunkOnStop && this.ondataavailable) {
          const payload = this.customPayload || [0x1a, 0x45, 0xdf, 0xa3, this.instanceIndex, 250];
          this.ondataavailable({
            data: new Blob([new Uint8Array(payload)], { type: this.mimeType }),
            timeStamp: Date.now(),
          });
        }
        queueMicrotask(() => {
          if (this.onstop) {
            this.onstop();
          }
        });
      });
    };

    if (this.delayedStopMs > 0) {
      setTimeout(doStop, this.delayedStopMs);
    } else {
      doStop();
    }
  }

  requestData() {
    queueMicrotask(() => {
      if (this.autoEmitChunkOnRequestData && this.ondataavailable) {
        const payload = this.customPayload || [0x1a, 0x45, 0xdf, 0xa3, this.instanceIndex, 100];
        this.ondataavailable({
          data: new Blob([new Uint8Array(payload)], { type: this.mimeType }),
          timeStamp: Date.now(),
        });
      }
    });
  }

  emitData(payload: number[]) {
    if (this.ondataavailable) {
      this.ondataavailable({
        data: new Blob([new Uint8Array(payload)], { type: this.mimeType }),
        timeStamp: Date.now(),
      });
    }
  }

  triggerError(err = new Error('Stream error')) {
    if (this.onerror) {
      this.onerror(err);
    }
  }
}

class MockHtmlAudioElement {
  static nextOutcome: 'playable' | 'media-error' | 'timeout' = 'playable';
  static instances: MockHtmlAudioElement[] = [];

  preload = 'auto';
  src = '';
  duration = 2.5;
  error: { code: number; message: string } | null = null;
  paused = true;
  removedSrc = false;
  loadCalls = 0;
  listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor() {
    MockHtmlAudioElement.instances.push(this);
  }

  addEventListener(type: string, cb: (...args: any[]) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: (...args: any[]) => void) {
    this.listeners.get(type)?.delete(cb);
  }

  dispatchEvent(type: string) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      fn();
    }
  }

  pause() {
    this.paused = true;
  }

  removeAttribute(attr: string) {
    if (attr === 'src') {
      this.src = '';
      this.removedSrc = true;
    }
  }

  load() {
    this.loadCalls += 1;
    if (!this.src) return;
    const outcome = MockHtmlAudioElement.nextOutcome;
    queueMicrotask(() => {
      if (!this.src) return;
      if (outcome === 'playable') {
        this.duration = 2.5;
        this.dispatchEvent('loadedmetadata');
        this.dispatchEvent('canplay');
      } else if (outcome === 'media-error') {
        this.error = { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
        this.dispatchEvent('error');
      }
      // 'timeout' intentionally emits nothing so timeout handler triggers
    });
  }
}

// Ensure global MediaRecorder and Audio exist in Node test env
(globalThis as any).MediaRecorder = MockMediaRecorder;
(globalThis as any).Audio = MockHtmlAudioElement;

beforeEach(() => {
  MockMediaRecorder.instances = [];
  MockMediaRecorder.nextStartThrowsError = null;
  MockHtmlAudioElement.instances = [];
  MockHtmlAudioElement.nextOutcome = 'playable';
});

const createMockAudioContext = (overrides: Record<string, any> = {}) => ({
  sampleRate: 48000,
  closed: false,
  decodeAudioData: async () => ({
    sampleRate: 48000,
    numberOfChannels: 1,
    length: 48000,
    duration: 1,
    getChannelData: () => new Float32Array(48000),
  }),
  close: async function () {
    (this as any).closed = true;
  },
  ...overrides,
});

const supportedCapabilities: BrowserCapabilities = {
  supported: true,
  isSecureContext: true,
  hasMediaDevices: true,
  hasMediaRecorder: true,
  selectedMimeType: 'audio/webm;codecs=opus',
  reason: null,
};

test('1. Legal and illegal state transitions', async () => {
  const store = new RecordingStore(`test-state-transitions-${Date.now()}`);
  const mockTrack = new MockMediaStreamTrack();
  const mockStream = new MockMediaStream([mockTrack]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => mockStream as any,
    saveToWorkspaceFn: async () => {},
  });

  assert.equal(engine.getState().status, 'idle');

  const sessionId = await engine.start();
  assert.equal(engine.getState().status, 'recording');
  assert.equal(engine.getState().sessionId, sessionId);

  await assert.rejects(
    async () => engine.start(),
    /Tidak dapat memulai rekaman dari status "recording"/
  );

  engine.pause();
  assert.equal(engine.getState().status, 'paused');

  engine.pause();
  assert.equal(engine.getState().status, 'paused');

  engine.resume();
  assert.equal(engine.getState().status, 'recording');

  engine.resume();
  assert.equal(engine.getState().status, 'recording');

  const res = await engine.stop();
  assert.equal(engine.getState().status, 'completed');
  assert.ok(res.recordingId);

  await assert.rejects(
    async () => engine.stop(),
    /Tidak dapat menghentikan rekaman dari status "completed"/
  );

  store.close();
});

test('2. Double start and double stop guards', async () => {
  const store = new RecordingStore(`test-double-guards-${Date.now()}`);
  const mockTrack = new MockMediaStreamTrack();
  const mockStream = new MockMediaStream([mockTrack]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => mockStream as any,
    saveToWorkspaceFn: async () => {},
  });

  await engine.start();
  assert.equal(engine.getState().status, 'recording');

  await assert.rejects(
    async () => engine.start(),
    /Tidak dapat memulai rekaman dari status "recording"/
  );

  const stopPromise1 = engine.stop();
  await assert.rejects(
    async () => engine.stop(),
    /Tidak dapat menghentikan rekaman/
  );

  await stopPromise1;
  assert.equal(engine.getState().status, 'completed');
  store.close();
});

test('3. Serial ordered IndexedDB writes', async () => {
  const store = new RecordingStore(`test-serial-writes-${Date.now()}`);
  const sessionId = 'rec-test-serial';

  const session: RecordingSession = {
    sessionId,
    targetProjectId: 'proj-1',
    title: 'Test',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 0,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: null,
    errorMessage: null,
  };
  await store.saveSession(session);

  const promises: Promise<void>[] = [];
  for (let i = 0; i < 10; i++) {
    const chunk: ArchiveChunkRecord = {
      sessionId,
      chunkIndex: i,
      blob: new Blob([new Uint8Array([i])]),
      sizeBytes: 1,
      timestampMs: i * 1000,
      activeDurationMs: (i + 1) * 1000,
      createdAt: Date.now(),
    };
    promises.push(store.appendArchiveChunk(chunk));
  }

  assert.ok(store.getPendingWriteCount() > 0);
  await Promise.all(promises);
  assert.equal(store.getPendingWriteCount(), 0);

  const chunks = await store.getOrderedArchiveChunks(sessionId);
  assert.equal(chunks.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(chunks[i].chunkIndex, i);
  }

  const updatedSession = await store.getSession(sessionId);
  assert.equal(updatedSession?.archiveChunkCount, 10);
  assert.equal(updatedSession?.archiveTotalBytes, 10);
  store.close();
});

test('4. Finalization awaiting pending writes', async () => {
  const store = new RecordingStore(`test-await-writes-${Date.now()}`);
  const sessionId = 'rec-test-await';

  await store.saveSession({
    sessionId,
    targetProjectId: 'p1',
    title: 'Rapat',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 3000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: null,
    errorMessage: null,
  });

  const appendP = store.appendArchiveChunk({
    sessionId,
    chunkIndex: 0,
    blob: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]),
    sizeBytes: 4,
    timestampMs: 1000,
    activeDurationMs: 1000,
    createdAt: Date.now(),
  });

  assert.equal(store.getPendingWriteCount(), 1);

  let savedBlobSize = 0;
  const mockSave = async (_rec: any, blob: Blob) => {
    savedBlobSize = blob.size;
  };

  const result = await finalizeRecordingSession(sessionId, store, {
    saveToWorkspaceFn: mockSave,
  });

  assert.equal(result.audioBlob.size, 4);
  assert.equal(savedBlobSize, 4);
  await appendP;
  assert.equal(store.getPendingWriteCount(), 0);
  store.close();
});

test('5. QuotaExceededError preserving saved draft chunks', async () => {
  const store = new RecordingStore(`test-quota-protection-${Date.now()}`);
  const sessionId = 'rec-quota-session';

  await store.saveSession({
    sessionId,
    targetProjectId: 'p1',
    title: 'Quota Test',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 1000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: null,
    errorMessage: null,
  });

  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 0,
    blob: new Blob([new Uint8Array([100])]),
    sizeBytes: 1,
    timestampMs: 1000,
    activeDurationMs: 1000,
    createdAt: Date.now(),
  });

  const db = await store.init();
  const origTx = db.transaction.bind(db);
  (db as any).transaction = function (stores: any, mode: any) {
    const tx = origTx(stores, mode);
    if (mode === 'readwrite') {
      const origStore = tx.objectStore.bind(tx);
      tx.objectStore = function (name: string) {
        const s = origStore(name);
        if (name === 'archiveChunks') {
          return {
            ...s,
            put: () => {
              const req: any = {
                error: new DOMException('The quota has been exceeded.', 'QuotaExceededError'),
                onerror: null,
                onsuccess: null,
              };
              queueMicrotask(() => {
                if (req.onerror) req.onerror(new Event('error'));
              });
              return req;
            },
          };
        }
        return s;
      };
    }
    return tx;
  };

  await assert.rejects(
    async () => {
      await store.appendArchiveChunk({
        sessionId,
        chunkIndex: 1,
        blob: new Blob([new Uint8Array([200])]),
        sizeBytes: 1,
        timestampMs: 2000,
        activeDurationMs: 2000,
        createdAt: Date.now(),
      });
    },
    /QuotaExceededError/
  );

  (db as any).transaction = origTx;

  const preservedChunks = await store.getOrderedArchiveChunks(sessionId);
  assert.equal(preservedChunks.length, 1);
  assert.equal(preservedChunks[0].chunkIndex, 0);

  store.close();
});

test('6. Normal stop releasing all stream tracks', async () => {
  const store = new RecordingStore(`test-stop-tracks-${Date.now()}`);
  const track1 = new MockMediaStreamTrack();
  const track2 = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track1, track2]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
    saveToWorkspaceFn: async () => {},
  });

  await engine.start();

  assert.equal(track1.stopped, false);
  assert.equal(track2.stopped, false);

  await engine.stop();

  assert.equal(track1.stopped, true);
  assert.equal(track2.stopped, true);
  assert.equal(track1.readyState, 'ended');
  assert.equal(track2.readyState, 'ended');

  store.close();
});

test('7. Error path releasing all stream tracks', async () => {
  const store = new RecordingStore(`test-error-tracks-${Date.now()}`);
  const track1 = new MockMediaStreamTrack();
  const stream1 = new MockMediaStream([track1]);

  const engine1 = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream1 as any,
  });

  await engine1.start();
  assert.equal(track1.stopped, false);

  track1.triggerEnded();
  await new Promise(r => setTimeout(r, 20));

  assert.equal(track1.stopped, true);
  assert.equal(engine1.getState().status, 'failed');
  assert.equal(engine1.getState().error?.code, 'device-ended');

  const track2 = new MockMediaStreamTrack();
  const stream2 = new MockMediaStream([track2]);
  const engine2 = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream2 as any,
  });

  await engine2.start();
  assert.equal(track2.stopped, false);

  const archiveRec = MockMediaRecorder.instances[MockMediaRecorder.instances.length - 2];
  archiveRec.triggerError(new Error('Recorder stream failed'));

  await new Promise(r => setTimeout(r, 25));

  assert.equal(track2.stopped, true);
  assert.equal(engine2.getState().status, 'failed');

  store.close();
});

test('8. Archive save failure retaining draft chunks', async () => {
  const store = new RecordingStore(`test-save-failure-retain-${Date.now()}`);
  const sessionId = 'rec-failure-retain';

  await store.saveSession({
    sessionId,
    targetProjectId: 'p1',
    title: 'Retain Test',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 2000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: null,
    errorMessage: null,
  });

  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 0,
    blob: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]),
    sizeBytes: 4,
    timestampMs: 1000,
    activeDurationMs: 1000,
    createdAt: Date.now(),
  });

  const failingSave = async () => {
    throw new Error('Disk IO failure in workspace database');
  };

  await assert.rejects(
    async () => finalizeRecordingSession(sessionId, store, { saveToWorkspaceFn: failingSave }),
    /Gagal menyimpan rekaman ke workspace\. Data sementara tetap tersimpan aman\./
  );

  const updatedSession = await store.getSession(sessionId);
  assert.equal(updatedSession?.status, 'recoverable');
  assert.equal(updatedSession?.errorCode, 'workspace-save-failed');

  const preservedChunks = await store.getOrderedArchiveChunks(sessionId);
  assert.equal(preservedChunks.length, 1);
  assert.equal(preservedChunks[0].sizeBytes, 4);

  store.close();
});

test('9. Successful workspace save triggering draft cleanup', async () => {
  const store = new RecordingStore(`test-save-success-cleanup-${Date.now()}`);
  const sessionId = 'rec-cleanup-success';

  await store.saveSession({
    sessionId,
    targetProjectId: 'p1',
    title: 'Cleanup Test',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 2000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 1,
    errorCode: null,
    errorMessage: null,
  });

  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 0,
    blob: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]),
    sizeBytes: 4,
    timestampMs: 1000,
    activeDurationMs: 1000,
    createdAt: Date.now(),
  });

  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 1,
    blob: new Blob([new Uint8Array([4, 5, 6])]),
    sizeBytes: 3,
    timestampMs: 2000,
    activeDurationMs: 2000,
    createdAt: Date.now(),
  });

  let workspaceSaved = false;
  const mockSave = async () => {
    workspaceSaved = true;
  };

  const result = await finalizeRecordingSession(sessionId, store, { saveToWorkspaceFn: mockSave });
  assert.equal(workspaceSaved, true);
  assert.equal(result.audioBlob.size, 7);

  const chunksAfter = await store.getOrderedArchiveChunks(sessionId);
  assert.equal(chunksAfter.length, 0);

  const sessionAfter = await store.getSession(sessionId);
  assert.equal(sessionAfter, null);

  store.close();
});

test('10. Checkpoint resume reconstructing transcript from durable checkpoints without re-decoding', async () => {
  const store = new RecordingStore(`test-checkpoint-reconstruct-${Date.now()}`);
  const sessionId = 'rec-cp-recon';

  let decodeCount = 0;
  const mockAudioContext = createMockAudioContext({
    decodeAudioData: async () => {
      decodeCount += 1;
      return {
        sampleRate: 48000,
        numberOfChannels: 1,
        length: 48000,
        duration: 1,
        getChannelData: () => new Float32Array(48000),
      };
    },
  });

  let workerCalls = 0;
  const mockWorker = {
    transcribeAudio: async () => {
      workerCalls += 1;
      return [{ text: 'Segmen ketiga baru', start: 0, end: 5 }];
    },
  };

  const seg0Dialogs: DialogSegment[] = [
    { id: 0, seconds: 10, time: '00:10', speaker: 'Pembicara', text: 'Teks dari segmen 0.' },
  ];
  const seg1Dialogs: DialogSegment[] = [
    { id: 1000, seconds: 70, time: '01:10', speaker: 'Pembicara', text: 'Teks dari segmen 1.' },
  ];

  await store.saveSession({
    sessionId,
    targetProjectId: 'p1',
    title: 'CP Session',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 120000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 2,
    archiveTotalBytes: 100,
    segmentCount: 2,
    errorCode: null,
    errorMessage: null,
  });

  await store.appendTranscriptionSegment({
    sessionId,
    segmentIndex: 0,
    blob: new Blob([new Uint8Array([1])]),
    sizeBytes: 1,
    durationSec: 65,
    plannedStartSec: 0,
    plannedEndSec: 65,
    overlapStartSec: 0,
    overlapEndSec: 5,
    transcribed: true,
    transcriptDialogs: seg0Dialogs,
    createdAt: Date.now(),
  });

  await store.appendTranscriptionSegment({
    sessionId,
    segmentIndex: 1,
    blob: new Blob([new Uint8Array([2])]),
    sizeBytes: 1,
    durationSec: 65,
    plannedStartSec: 60,
    plannedEndSec: 125,
    overlapStartSec: 60,
    overlapEndSec: 65,
    transcribed: true,
    transcriptDialogs: seg1Dialogs,
    createdAt: Date.now(),
  });

  const adapter = new RecordingTranscriptionAdapter(store, mockWorker, mockAudioContext as any);
  await adapter.initializeFromCheckpoints(sessionId);

  assert.equal(adapter.getAccumulatedDialogs().length, 2);
  assert.equal(adapter.getAccumulatedDialogs()[0].text, 'Teks dari segmen 0.');
  assert.equal(adapter.getAccumulatedDialogs()[1].text, 'Teks dari segmen 1.');

  adapter.enqueueSegment({
    sessionId,
    segmentIndex: 2,
    blob: new Blob([new Uint8Array([3])]),
    sizeBytes: 1,
    durationSec: 65,
    plannedStartSec: 120,
    plannedEndSec: 185,
    overlapStartSec: 120,
    overlapEndSec: 125,
    transcribed: false,
    createdAt: Date.now(),
  });

  await new Promise(r => setTimeout(r, 30));

  assert.equal(decodeCount, 1);
  assert.equal(workerCalls, 1);

  const allDialogs = adapter.getAccumulatedDialogs();
  assert.equal(allDialogs.length, 3);
  assert.equal(allDialogs[0].text, 'Teks dari segmen 0.');
  assert.equal(allDialogs[1].text, 'Teks dari segmen 1.');
  assert.equal(allDialogs[2].text, 'Segmen ketiga baru');

  store.close();
});

test('11. Cancellation halting subsequent segment transcription and checking runToken after every await', async () => {
  const store = new RecordingStore(`test-cancel-halt-${Date.now()}`);
  const sessionId = 'rec-cancel-halt';

  let resolveWorkerPromise!: (val: any) => void;
  const pendingWorkerPromise = new Promise<any>(res => {
    resolveWorkerPromise = res;
  });

  let workerCalls = 0;
  const mockWorker = {
    transcribeAudio: async () => {
      workerCalls += 1;
      return pendingWorkerPromise;
    },
  };

  const adapter = new RecordingTranscriptionAdapter(
    store,
    mockWorker,
    createMockAudioContext() as any
  );

  adapter.enqueueSegment({
    sessionId,
    segmentIndex: 0,
    blob: new Blob([new Uint8Array([1])]),
    sizeBytes: 1,
    durationSec: 60,
    plannedStartSec: 0,
    plannedEndSec: 60,
    overlapStartSec: 0,
    overlapEndSec: 0,
    transcribed: false,
    createdAt: Date.now(),
  });

  await new Promise(r => setTimeout(r, 15));
  assert.equal(workerCalls, 1);

  adapter.cancel();

  resolveWorkerPromise([{ text: 'Late text that must be dropped', start: 0, end: 5 }]);
  await new Promise(r => setTimeout(r, 20));

  assert.equal(adapter.getAccumulatedDialogs().length, 0);

  const segs = await store.getTranscriptionSegments(sessionId);
  assert.equal(segs.length, 0);

  store.close();
});

test('12. Global timestamp mapping and formatted time label across segments (IMPORTANT 1)', async () => {
  const seg1Dialogs = [
    { id: 1, seconds: 10, time: '00:10', speaker: 'A', text: 'Pembahasan agenda pertama.' },
    { id: 2, seconds: 50, time: '00:50', speaker: 'A', text: 'Menjelang segmen kedua.' },
  ];

  const seg2Dialogs = [
    { id: 1001, seconds: 5, time: '00:05', speaker: 'B', text: 'Lanjut poin kedua.' },
    { id: 1002, seconds: 20, time: '00:20', speaker: 'B', text: 'Poin ketiga selesai.' },
  ];

  const bounds: OverlapBounds = { overlapStartSec: 55, overlapEndSec: 60 };
  const merged = mergeCrossSegmentDialogs(seg1Dialogs, seg2Dialogs, 55, bounds);

  assert.equal(merged.length, 4);
  assert.equal(merged[0].seconds, 10);
  assert.equal(merged[0].time, '00:10');

  assert.equal(merged[1].seconds, 50);
  assert.equal(merged[1].time, '00:50');

  // seg2: 55 + 5 = 60s -> '01:00'
  assert.equal(merged[2].seconds, 60);
  assert.equal(merged[2].time, '01:00');

  // seg2: 55 + 20 = 75s -> '01:15'
  assert.equal(merged[3].seconds, 75);
  assert.equal(merged[3].time, '01:15');

  for (let i = 1; i < merged.length; i++) {
    assert.ok(merged[i].seconds >= merged[i - 1].seconds);
  }
});

test('13. Regression deduplication of "what you are / What you are country"', () => {
  const textA = 'And so my fellow Americans ask not what you are';
  const textB = 'What you are country can do for you';

  const { dedupedTextB, matchedTokens } = deduplicateCrossSegmentBoundary(textA, textB, 10);

  assert.deepEqual(matchedTokens, ['What', 'you', 'are']);
  assert.equal(dedupedTextB, 'country can do for you');

  const combined = `${textA} ${dedupedTextB}`;
  assert.equal(combined, 'And so my fellow Americans ask not what you are country can do for you');
});

test('14. Case and punctuation normalization in deduplication', () => {
  const textA = 'Terima kasih, selamat pagi.';
  const textB = 'Selamat Pagi! Rekan-rekan sekalian.';

  const { dedupedTextB, matchedTokens } = deduplicateCrossSegmentBoundary(textA, textB, 8);

  assert.deepEqual(matchedTokens, ['Selamat', 'Pagi!']);
  assert.equal(dedupedTextB, 'Rekan-rekan sekalian.');
});

test('15. Natural repetition outside overlap preserved without tolerance leakage (IMPORTANT 2)', () => {
  const seg1Dialogs = [
    // 1 second outside overlap (overlap is 55-60s)
    { id: 1, seconds: 54, time: '00:54', speaker: 'A', text: 'keputusan penting kita buat' },
  ];
  const seg2Dialogs = [
    // Exactly at overlap boundary (global 61s, 1s outside overlap)
    { id: 1001, seconds: 6, time: '00:06', speaker: 'B', text: 'keputusan penting kita buat kembali' },
  ];

  const bounds: OverlapBounds = { overlapStartSec: 55, overlapEndSec: 60 };
  const merged = mergeCrossSegmentDialogs(seg1Dialogs, seg2Dialogs, 55, bounds);

  // Both are 1 second outside [55, 60], so without 2-second tolerance, they MUST NOT be deduplicated!
  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, 'keputusan penting kita buat');
  assert.equal(merged[1].text, 'keputusan penting kita buat kembali');
});

test('16. Unsupported browser blocking permission request', async () => {
  const unsupportedCapabilities: BrowserCapabilities = {
    supported: false,
    isSecureContext: false,
    hasMediaDevices: false,
    hasMediaRecorder: false,
    selectedMimeType: null,
    reason: 'Koneksi tidak aman (bukan HTTPS atau localhost).',
  };

  let getUserMediaCalled = false;
  const engine = new RecordingEngine({
    capabilities: unsupportedCapabilities,
    getMediaStream: async () => {
      getUserMediaCalled = true;
      return new MockMediaStream() as any;
    },
  });

  await assert.rejects(
    async () => engine.start(),
    /Koneksi tidak aman/
  );

  assert.equal(getUserMediaCalled, false);
  assert.equal(engine.getState().status, 'failed');
  assert.equal(engine.getState().error?.code, 'unsupported-browser');
});

test('17. Zero network/cloud calls from recording modules', async () => {
  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCallCount += 1;
    throw new Error('Network call prohibited in local recording engine!');
  }) as any;

  const store = new RecordingStore(`test-zero-network-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
    saveToWorkspaceFn: async () => {},
  });

  try {
    await engine.start();
    await engine.stop();
    assert.equal(fetchCallCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});

test('18. Two overlapping recorders produce distinct isolated payloads without mixing (CRITICAL 1)', async () => {
  const store = new RecordingStore(`test-isolated-pingpong-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    segmentCoreSeconds: 0.05,
    segmentOverlapSeconds: 0.05,
    getMediaStream: async () => stream as any,
    saveToWorkspaceFn: async () => {},
  });

  const capturedSegments: TranscriptionSegmentRecord[] = [];
  engine.setEvents({
    onSegmentReady: seg => {
      capturedSegments.push(seg);
    },
  });

  await engine.start();
  const instancesAtStart = [...MockMediaRecorder.instances];

  const segRec0 = instancesAtStart[instancesAtStart.length - 1];
  segRec0.emitData([10, 11]);

  await new Promise(r => setTimeout(r, 75));

  const segRec1 = MockMediaRecorder.instances[MockMediaRecorder.instances.length - 1];
  assert.notEqual(segRec0, segRec1);

  segRec0.emitData([12, 13]);
  segRec1.emitData([20, 21]);

  await new Promise(r => setTimeout(r, 85));

  assert.ok(capturedSegments.length >= 1);
  const seg0 = capturedSegments[0];
  const seg0Bytes = Array.from(new Uint8Array(await seg0.blob.arrayBuffer()));

  assert.deepEqual(seg0Bytes, [10, 11, 12, 13]);

  await engine.stop();
  store.close();
});

test('19. Stop and cancel right while overlap is active (CRITICAL 2)', async () => {
  const store = new RecordingStore(`test-stop-cancel-overlap-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    segmentCoreSeconds: 0.04,
    segmentOverlapSeconds: 0.1,
    getMediaStream: async () => stream as any,
    saveToWorkspaceFn: async () => {},
  });

  await engine.start();
  await new Promise(r => setTimeout(r, 65));

  assert.ok(MockMediaRecorder.instances.length >= 3);

  await engine.stop();

  assert.equal(track.stopped, true);
  assert.equal(engine.getState().status, 'completed');

  store.close();
});

test('20. Delayed dataavailable after stop does not resurrect chunks after cancel (CRITICAL 4)', async () => {
  const store = new RecordingStore(`test-cancel-race-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
  });

  const sessionId = await engine.start();

  const lastRec = MockMediaRecorder.instances[MockMediaRecorder.instances.length - 1];
  lastRec.delayedStopMs = 20;
  lastRec.autoEmitChunkOnStop = true;

  await engine.cancel();
  await new Promise(r => setTimeout(r, 40));

  const chunks = await store.getOrderedArchiveChunks(sessionId);
  assert.equal(chunks.length, 0);

  const session = await store.getSession(sessionId);
  assert.equal(session, null);

  assert.equal(engine.getState().status, 'cancelled');
  store.close();
});

test('21. Pause before rotation boundary preserves remaining active duration and reschedules on resume (IMPORTANT 1)', async () => {
  const store = new RecordingStore(`test-pause-boundary-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    segmentCoreSeconds: 0.1,
    segmentOverlapSeconds: 0.05,
    getMediaStream: async () => stream as any,
    saveToWorkspaceFn: async () => {},
  });

  let rotations = 0;
  engine.setEvents({
    onSegmentReady: () => {
      rotations += 1;
    },
  });

  await engine.start();

  const segRec0 = MockMediaRecorder.instances[MockMediaRecorder.instances.length - 1];
  segRec0.emitData([1, 2, 3]);

  await new Promise(r => setTimeout(r, 40));
  engine.pause();
  assert.equal(engine.getState().status, 'paused');

  await new Promise(r => setTimeout(r, 120));
  assert.equal(rotations, 0);

  engine.resume();
  assert.equal(engine.getState().status, 'recording');
  assert.equal(rotations, 0);

  await new Promise(r => setTimeout(r, 160));
  assert.ok(rotations >= 1);

  await engine.stop();
  store.close();
});

test('22. AudioContext lifecycle: owned context closes on cancel/close, caller-injected is never closed (IMPORTANT 3)', async () => {
  const store = new RecordingStore(`test-audio-context-lifecycle-${Date.now()}`);

  const callerContext = createMockAudioContext();
  const adapterA = new RecordingTranscriptionAdapter(
    store,
    { transcribeAudio: async () => [] },
    callerContext as any
  );

  await adapterA.close();
  assert.equal(callerContext.closed, false);

  let createdOwnedCtx: any = null;
  const originalAudioContext = (globalThis as any).AudioContext;
  (globalThis as any).AudioContext = function () {
    createdOwnedCtx = createMockAudioContext();
    return createdOwnedCtx;
  };

  try {
    const adapterB = new RecordingTranscriptionAdapter(
      store,
      { transcribeAudio: async () => [{ text: 'Halo', start: 0, end: 1 }] }
    );

    adapterB.enqueueSegment({
      sessionId: 'test-owned',
      segmentIndex: 0,
      blob: new Blob([new Uint8Array([1])]),
      sizeBytes: 1,
      durationSec: 60,
      plannedStartSec: 0,
      plannedEndSec: 60,
      overlapStartSec: 0,
      overlapEndSec: 0,
      transcribed: false,
      createdAt: Date.now(),
    });

    await new Promise(r => setTimeout(r, 20));
    assert.ok(createdOwnedCtx !== null);
    assert.equal(createdOwnedCtx.closed, false);

    await adapterB.close();
    assert.equal(createdOwnedCtx.closed, true);
  } finally {
    (globalThis as any).AudioContext = originalAudioContext;
    store.close();
  }
});

test('23. IndexedDB durability: writes resolve only on tx.oncomplete and reject on tx.onabort/onerror (IMPORTANT 5)', async () => {
  const store = new RecordingStore(`test-idb-durability-${Date.now()}`);
  const sessionId = 'rec-durability';

  const session: RecordingSession = {
    sessionId,
    targetProjectId: 'p1',
    title: 'Durability',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 0,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: null,
    errorMessage: null,
  };

  await store.saveSession(session);
  const loaded = await store.getSession(sessionId);
  assert.equal(loaded?.title, 'Durability');

  const db = await store.init();
  const origTx = db.transaction.bind(db);
  (db as any).transaction = function (stores: any, mode: any) {
    const tx = origTx(stores, mode);
    if (mode === 'readwrite') {
      const origStore = tx.objectStore.bind(tx);
      tx.objectStore = function (name: string) {
        const s = origStore(name);
        return {
          ...s,
          put: () => {
            const req: any = { error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              try {
                tx.abort();
              } catch {
                // ignore
              }
            });
            return req;
          },
        };
      };
    }
    return tx;
  };

  await assert.rejects(
    async () => {
      await store.saveSession({
        ...session,
        sessionId: 'rec-aborted',
      });
    },
    /Session save aborted|QuotaExceededError|aborted/i
  );

  (db as any).transaction = origTx;
  store.close();
});

test('24. Short recording flushes final asynchronous archive chunk without timeslice loss (CRITICAL 1)', async () => {
  const store = new RecordingStore(`test-short-recording-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  let savedBlob: Blob | null = null;
  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
    saveToWorkspaceFn: async (_rec, blob) => {
      savedBlob = blob;
    },
  });

  await engine.start();

  // The archive recorder is instances[0]
  const archiveRec = MockMediaRecorder.instances[0];
  archiveRec.customPayload = [0x1a, 0x45, 0xdf, 0xa3, 42, 43, 44, 45];

  // Stop recording immediately. The ONLY archive chunk is flushed asynchronously via requestData/stop
  const result = await engine.stop();

  assert.ok(result.audioBlob);
  assert.ok(result.audioBlob.size > 0);
  assert.ok(savedBlob !== null);

  const finalBytes = Array.from(new Uint8Array(await result.audioBlob.arrayBuffer()));
  assert.deepEqual(finalBytes, [0x1a, 0x45, 0xdf, 0xa3, 42, 43, 44, 45]);

  store.close();
});

test('25. Start failure cleanup deadlock prevention (CRITICAL 2)', async () => {
  const store = new RecordingStore(`test-start-failure-${Date.now()}`);

  // Subtest A: Archive recorder start throws
  const trackA = new MockMediaStreamTrack();
  const streamA = new MockMediaStream([trackA]);
  const engineA = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => streamA as any,
  });

  MockMediaRecorder.nextStartThrowsError = new Error('Archive recorder start failed');
  await assert.rejects(
    async () => engineA.start(),
    /Archive recorder start failed/
  );

  assert.equal(trackA.stopped, true);
  assert.equal(engineA.getState().status, 'failed');

  // Subtest B: First segment recorder start throws
  const trackB = new MockMediaStreamTrack();
  const streamB = new MockMediaStream([trackB]);
  const engineB = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => streamB as any,
  });

  // Let archive recorder start succeed, but make segment recorder throw
  let startCount = 0;
  const origStart = MockMediaRecorder.prototype.start;
  MockMediaRecorder.prototype.start = function (timeslice?: number) {
    startCount += 1;
    if (startCount === 2) {
      throw new Error('First segment start failed');
    }
    this.state = 'recording';
  };

  try {
    await assert.rejects(
      async () => engineB.start(),
      /First segment start failed/
    );

    // Verify cleanup settled and tracks stopped without deadlock!
    assert.equal(trackB.stopped, true);
    assert.equal(engineB.getState().status, 'failed');
  } finally {
    MockMediaRecorder.prototype.start = origStart;
  }

  // Subtest C: Next ping-pong recorder start throws while old recorder is still active
  const trackC = new MockMediaStreamTrack();
  const streamC = new MockMediaStream([trackC]);
  const engineC = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    segmentCoreSeconds: 0.05,
    segmentOverlapSeconds: 0.05,
    getMediaStream: async () => streamC as any,
  });

  let pingPongCount = 0;
  MockMediaRecorder.prototype.start = function (timeslice?: number) {
    pingPongCount += 1;
    if (pingPongCount === 3) {
      throw new Error('Next ping-pong start failed');
    }
    this.state = 'recording';
  };

  try {
    await engineC.start();
    await new Promise(r => setTimeout(r, 70));

    assert.equal(trackC.stopped, true);
    assert.equal(engineC.getState().status, 'failed');
  } finally {
    MockMediaRecorder.prototype.start = origStart;
    store.close();
  }
});

test('26. Completed transcript checkpoints loaded and saved to workspace upon stop (CRITICAL 3)', async () => {
  const store = new RecordingStore(`test-transcript-finalize-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  let workspaceReceivedSegments: DialogSegment[] = [];
  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
    saveToWorkspaceFn: async (_rec, _blob, segments) => {
      workspaceReceivedSegments = segments;
    },
  });

  const sessionId = await engine.start();

  // Simulate transcription adapter saving durable checkpoints for segment 0 and 1
  await store.appendTranscriptionSegment({
    sessionId,
    segmentIndex: 0,
    blob: new Blob([new Uint8Array([1])]),
    sizeBytes: 1,
    durationSec: 65,
    plannedStartSec: 0,
    plannedEndSec: 65,
    overlapStartSec: 0,
    overlapEndSec: 5,
    transcribed: true,
    transcriptDialogs: [
      { id: 1, seconds: 10, time: '00:10', speaker: 'A', text: 'Dialog segmen nol.' },
    ],
    createdAt: Date.now(),
  });

  await store.appendTranscriptionSegment({
    sessionId,
    segmentIndex: 1,
    blob: new Blob([new Uint8Array([2])]),
    sizeBytes: 1,
    durationSec: 65,
    plannedStartSec: 60,
    plannedEndSec: 125,
    overlapStartSec: 60,
    overlapEndSec: 65,
    transcribed: true,
    transcriptDialogs: [
      { id: 1001, seconds: 75, time: '01:15', speaker: 'B', text: 'Dialog segmen satu.' },
    ],
    createdAt: Date.now(),
  });

  // Stop recording normally
  await engine.stop();

  // Both dialogs from checkpoints MUST be passed to workspace!
  assert.equal(workspaceReceivedSegments.length, 2);
  assert.equal(workspaceReceivedSegments[0].text, 'Dialog segmen nol.');
  assert.equal(workspaceReceivedSegments[1].text, 'Dialog segmen satu.');

  // And drafts are cleaned up only after workspace save succeeded
  const segsAfter = await store.getTranscriptionSegments(sessionId);
  assert.equal(segsAfter.length, 0);

  store.close();
});

test('27. Checkpoint failure preserves memory state and halts further processing (IMPORTANT 3)', async () => {
  const store = new RecordingStore(`test-checkpoint-failure-${Date.now()}`);
  const sessionId = 'rec-cp-fail';

  let workerCalls = 0;
  const mockWorker = {
    transcribeAudio: async () => {
      workerCalls += 1;
      return [{ text: 'Teks percobaan', start: 0, end: 5 }];
    },
  };

  const adapter = new RecordingTranscriptionAdapter(
    store,
    mockWorker,
    createMockAudioContext() as any
  );

  // Mock store.markSegmentTranscribed to throw failure
  const originalMark = store.markSegmentTranscribed.bind(store);
  store.markSegmentTranscribed = async () => {
    throw new Error('Disk IO failure while writing checkpoint');
  };

  try {
    adapter.enqueueSegment({
      sessionId,
      segmentIndex: 0,
      blob: new Blob([new Uint8Array([1])]),
      sizeBytes: 1,
      durationSec: 60,
      plannedStartSec: 0,
      plannedEndSec: 60,
      overlapStartSec: 0,
      overlapEndSec: 0,
      transcribed: false,
      createdAt: Date.now(),
    });

    adapter.enqueueSegment({
      sessionId,
      segmentIndex: 1,
      blob: new Blob([new Uint8Array([2])]),
      sizeBytes: 1,
      durationSec: 60,
      plannedStartSec: 60,
      plannedEndSec: 120,
      overlapStartSec: 60,
      overlapEndSec: 65,
      transcribed: false,
      createdAt: Date.now(),
    });

    await new Promise(r => setTimeout(r, 40));

    // Accumulated dialogs must remain unchanged (empty), and segment 1 must NOT be processed
    assert.equal(adapter.getAccumulatedDialogs().length, 0);
    assert.equal(workerCalls, 1);
  } finally {
    store.markSegmentTranscribed = originalMark;
    store.close();
  }
});

test('28. Concurrent fatal errors do not overwrite state or leak promises (IMPORTANT 4)', async () => {
  const store = new RecordingStore(`test-concurrent-errors-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
  });

  await engine.start();

  const archiveRec = MockMediaRecorder.instances[0];

  // Fire device-ended and recorder error concurrently
  track.triggerEnded();
  archiveRec.triggerError(new Error('Concurrent stream error'));

  await new Promise(r => setTimeout(r, 30));

  assert.equal(track.stopped, true);
  assert.equal(engine.getState().status, 'failed');

  store.close();
});

test('29. Checkpoint read failure preserves draft data and enables clean retry finalization', async () => {
  const store = new RecordingStore(`test-checkpoint-read-failure-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const savedWorkspaceRecordings: Array<{
    recording: any;
    audioBlob: Blob;
    segments: DialogSegment[];
    speakerNames: Record<string, string>;
  }> = [];

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
    saveToWorkspaceFn: async (recording, audioBlob, segments, speakerNames) => {
      savedWorkspaceRecordings.push({ recording, audioBlob, segments, speakerNames });
    },
  });

  const sessionId = await engine.start();

  // Emit archive chunk through the engine's archive recorder so chunkIndex and session count stay synchronized
  MockMediaRecorder.instances[0].emitData([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  await store.waitForPendingWrites();

  await store.appendTranscriptionSegment({
    sessionId,
    segmentIndex: 0,
    blob: new Blob([new Uint8Array([10, 20])]),
    sizeBytes: 2,
    durationSec: 60,
    plannedStartSec: 0,
    plannedEndSec: 65,
    overlapStartSec: 0,
    overlapEndSec: 5,
    transcribed: true,
    transcriptDialogs: [
      { id: 1, speaker: 'Pembicara 1', text: 'Halo selamat pagi', seconds: 10, time: '00:10' },
    ],
    createdAt: Date.now(),
  });

  let failRead = true;
  const originalGetTranscriptionSegments = store.getTranscriptionSegments.bind(store);
  store.getTranscriptionSegments = async (id: string) => {
    if (failRead) {
      throw new Error('IndexedDB disk IO read error during checkpoint fetch');
    }
    return originalGetTranscriptionSegments(id);
  };

  let deleteSessionDataCalled = false;
  const originalDeleteSessionData = store.deleteSessionData.bind(store);
  store.deleteSessionData = async (id: string) => {
    deleteSessionDataCalled = true;
    return originalDeleteSessionData(id);
  };

  // 1. Calling stop() must reject with structured checkpoint-read-failed error
  await assert.rejects(
    async () => engine.stop(),
    (err: any) => {
      assert.equal(err.code, 'checkpoint-read-failed');
      assert.equal(err.retryable, true);
      assert.match(err.message, /checkpoint transkripsi/);
      return true;
    }
  );

  // 2. Workspace save must NOT have been called
  assert.equal(savedWorkspaceRecordings.length, 0);

  // 3. Draft cleanup / delete must NOT have been called
  assert.equal(deleteSessionDataCalled, false);

  // 4. Session and engine status must be recoverable
  assert.equal(engine.getState().status, 'recoverable');
  assert.equal(engine.getState().error?.code, 'checkpoint-read-failed');
  assert.equal(engine.getState().error?.retryable, true);

  const storedSession = await store.getSession(sessionId);
  assert.equal(storedSession?.status, 'recoverable');
  assert.equal(storedSession?.errorCode, 'checkpoint-read-failed');

  // 5. Audio archive and draft data remain completely intact
  const preservedChunks = await store.getOrderedArchiveChunks(sessionId);
  assert.ok(preservedChunks.length >= 1);
  const preservedSegs = await originalGetTranscriptionSegments(sessionId);
  assert.equal(preservedSegs.length, 1);
  assert.equal(preservedSegs[0].transcriptDialogs?.[0].text, 'Halo selamat pagi');

  // 6. Restore read function and retry finalization
  failRead = false;
  const result = await engine.retryFinalization();

  // 7. Verify audio and transcript saved completely to workspace, then draft cleaned up
  assert.ok(result.recordingId);
  assert.equal(engine.getState().status, 'completed');
  assert.equal(savedWorkspaceRecordings.length, 1);
  assert.equal(savedWorkspaceRecordings[0].segments.length, 1);
  assert.equal(savedWorkspaceRecordings[0].segments[0].text, 'Halo selamat pagi');
  assert.ok(savedWorkspaceRecordings[0].audioBlob.size > 0);

  assert.equal(deleteSessionDataCalled, true);
  const remainingChunks = await store.getOrderedArchiveChunks(sessionId);
  assert.equal(remainingChunks.length, 0);

  store.close();
});

test('30. Terminal cleanup concurrency guarantees single execution and identical shared promise', async () => {
  const store = new RecordingStore(`test-cleanup-concurrency-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
  });

  await engine.start();
  assert.equal(track.stopCount, 0);

  // Invoke terminal cleanup concurrently twice before the first one completes
  const p1 = (engine as any).centralTerminalCleanup();
  const p2 = (engine as any).centralTerminalCleanup();

  // Both callers must receive the exact same Promise instance
  assert.strictEqual(p1, p2);

  await Promise.all([p1, p2]);

  // Track must be effectively stopped exactly once
  assert.equal(track.stopped, true);
  assert.equal(track.stopCount, 1);

  store.close();
});

test('31. preserveForRecovery stops recorders and tracks while preserving session, archive chunks, and checkpoints', async () => {
  const store = new RecordingStore(`test-preserve-recovery-${Date.now()}`);
  const track = new MockMediaStreamTrack();
  const stream = new MockMediaStream([track]);

  const engine = new RecordingEngine({
    store,
    capabilities: supportedCapabilities,
    getMediaStream: async () => stream as any,
  });

  const sessionId = await engine.start();

  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 0,
    blob: new Blob([new Uint8Array([1, 2, 3])]),
    sizeBytes: 3,
    timestampMs: 500,
    activeDurationMs: 500,
    createdAt: Date.now(),
  });

  await store.appendTranscriptionSegment({
    sessionId,
    segmentIndex: 0,
    blob: new Blob([new Uint8Array([4, 5])]),
    sizeBytes: 2,
    durationSec: 60,
    plannedStartSec: 0,
    plannedEndSec: 65,
    overlapStartSec: 0,
    overlapEndSec: 5,
    transcribed: true,
    transcriptDialogs: [{ id: 1, speaker: 'Pembicara 1', text: 'Tersimpan utuh', seconds: 1, time: '00:01' }],
    createdAt: Date.now(),
  });

  await engine.preserveForRecovery();

  assert.equal(track.stopped, true);
  assert.equal(engine.getState().status, 'recoverable');

  const session = await store.getSession(sessionId);
  assert.ok(session);
  assert.equal(session.status, 'recoverable');

  const chunks = await store.getOrderedArchiveChunks(sessionId);
  assert.ok(chunks.length >= 1);

  const segments = await store.getTranscriptionSegments(sessionId);
  assert.ok(segments.some(s => s.transcribed && s.transcriptDialogs?.[0]?.text === 'Tersimpan utuh'));

  const recoverable = await store.listRecoverableSessions();
  assert.equal(recoverable.length, 1);
  assert.equal(recoverable[0].sessionId, sessionId);

  store.close();
});

test('32. CRITICAL 2: Structural archive validation (missing middle index, duplicate index, missing index 0, invalid EBML, valid contiguous)', async () => {
  const makeChunk = (
    chunkIndex: number,
    bytes: number[] = [0x1a, 0x45, 0xdf, 0xa3, chunkIndex]
  ): ArchiveChunkRecord => ({
    sessionId: 'sess-struct',
    chunkIndex,
    blob: new Blob([new Uint8Array(bytes)], { type: 'audio/webm;codecs=opus' }),
    sizeBytes: bytes.length,
    timestampMs: (chunkIndex + 1) * 1000,
    activeDurationMs: (chunkIndex + 1) * 1000,
    createdAt: Date.now(),
  });

  // 1. Missing middle index: 0, 1, 3, 4
  const missingMiddle = await validateArchiveChunksStructure([
    makeChunk(0),
    makeChunk(1, [10, 11]),
    makeChunk(3, [30, 31]),
    makeChunk(4, [40, 41]),
  ]);
  assert.equal(missingMiddle.valid, false);
  assert.match(missingMiddle.reason || '', /index 2/i);

  // 2. Duplicate index: 0, 1, 1, 2
  const duplicateIdx = await validateArchiveChunksStructure([
    makeChunk(0),
    makeChunk(1, [10, 11]),
    makeChunk(1, [12, 13]),
    makeChunk(2, [20, 21]),
  ]);
  assert.equal(duplicateIdx.valid, false);
  assert.match(duplicateIdx.reason || '', /duplikasi.*index 1/i);

  // 3. Missing index 0: 1, 2, 3
  const missingZero = await validateArchiveChunksStructure([
    makeChunk(1, [10, 11]),
    makeChunk(2, [20, 21]),
    makeChunk(3, [30, 31]),
  ]);
  assert.equal(missingZero.valid, false);
  assert.match(missingZero.reason || '', /index 0/i);

  // 4. Invalid EBML header on chunk 0
  const invalidEbml = await validateArchiveChunksStructure([
    makeChunk(0, [0x00, 0x01, 0x02, 0x03]),
    makeChunk(1, [10, 11]),
  ]);
  assert.equal(invalidEbml.valid, false);
  assert.match(invalidEbml.reason || '', /EBML/i);

  // 5. Expected chunk count mismatch
  const countMismatch = await validateArchiveChunksStructure(
    [makeChunk(0), makeChunk(1, [10, 11])],
    3
  );
  assert.equal(countMismatch.valid, false);
  assert.match(countMismatch.reason || '', /tidak sesuai/i);

  // 6. Valid contiguous sequence (even when passed out of order: 2, 0, 1)
  const validSeq = await validateArchiveChunksStructure(
    [makeChunk(2, [20, 21]), makeChunk(0), makeChunk(1, [10, 11])],
    3
  );
  assert.equal(validSeq.valid, true);
  assert.deepEqual(
    validSeq.sortedChunks.map(c => c.chunkIndex),
    [0, 1, 2]
  );

  // 7. End-to-end finalizeRecordingSession with missing middle chunk (0, 1, 3, 4)
  const store = new RecordingStore(`test-gap-archive-${Date.now()}`);
  const sessionId = 'rec-gap-session';
  await store.saveSession({
    sessionId,
    targetProjectId: 'p1',
    title: 'Gap Test',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 5000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: null,
    errorMessage: null,
  });

  for (const idx of [0, 1, 3, 4]) {
    await store.appendArchiveChunk({
      ...makeChunk(idx, idx === 0 ? [0x1a, 0x45, 0xdf, 0xa3, 1] : [idx, idx + 1]),
      sessionId,
    });
  }

  let workspaceSaveCalled = false;
  let deleteCalled = false;
  const origDelete = store.deleteSessionData.bind(store);
  store.deleteSessionData = async (id: string) => {
    deleteCalled = true;
    return origDelete(id);
  };

  await assert.rejects(
    async () =>
      finalizeRecordingSession(sessionId, store, {
        saveToWorkspaceFn: async () => {
          workspaceSaveCalled = true;
        },
      }),
    (err: any) => {
      assert.equal(err.code, 'archive-finalization-failed');
      assert.equal(err.retryable, true);
      return true;
    }
  );

  assert.equal(workspaceSaveCalled, false);
  assert.equal(deleteCalled, false);
  const sessAfter = await store.getSession(sessionId);
  assert.equal(sessAfter?.status, 'recoverable');
  assert.equal(sessAfter?.errorCode, 'archive-finalization-failed');
  const retainedChunks = await store.getOrderedArchiveChunks(sessionId);
  assert.equal(retainedChunks.length, 4);

  store.close();
});

test('33. CRITICAL 1: Multi-segment invalid archive never saves single segment and preserves all 3 segments', async () => {
  const store = new RecordingStore(`test-crit1-multiseg-${Date.now()}`);
  const sessionId = 'rec-multiseg-preserve';

  await store.saveSession({
    sessionId,
    targetProjectId: 'proj-1',
    title: 'Rapat 3 Segmen',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 185000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 3,
    errorCode: null,
    errorMessage: null,
  });

  // Append invalid archive (missing chunk 0, only chunk 2 present)
  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 2,
    blob: new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'audio/webm;codecs=opus' }),
    sizeBytes: 4,
    timestampMs: 3000,
    activeDurationMs: 185000,
    createdAt: Date.now(),
  });

  // Append 3 finalized playable transcription segments
  for (let segIdx = 0; segIdx < 3; segIdx++) {
    const segBytes = [0x1a, 0x45, 0xdf, 0xa3, 100 + segIdx];
    await store.appendTranscriptionSegment({
      sessionId,
      segmentIndex: segIdx,
      blob: new Blob([new Uint8Array(segBytes)], { type: 'audio/webm;codecs=opus' }),
      sizeBytes: segBytes.length,
      durationSec: 65,
      plannedStartSec: segIdx * 60,
      plannedEndSec: segIdx * 60 + 65,
      overlapStartSec: segIdx * 60,
      overlapEndSec: segIdx === 0 ? 0 : segIdx * 60 + 5,
      transcribed: true,
      transcriptDialogs: [
        {
          id: segIdx + 1,
          speaker: 'Pembicara 1',
          text: `Kalimat segmen ${segIdx}`,
          seconds: segIdx * 60 + 5,
          time: `0${segIdx}:05`,
        },
      ],
      createdAt: Date.now(),
    });
  }

  let workspaceSaveCalls = 0;
  let deleteSessionCalls = 0;
  const origDelete = store.deleteSessionData.bind(store);
  store.deleteSessionData = async (id: string) => {
    deleteSessionCalls += 1;
    return origDelete(id);
  };

  await assert.rejects(
    async () =>
      finalizeRecordingSession(sessionId, store, {
        saveToWorkspaceFn: async () => {
          workspaceSaveCalls += 1;
        },
      }),
    (err: any) => {
      assert.equal(err.code, 'archive-finalization-failed');
      assert.equal(err.retryable, true);
      return true;
    }
  );

  // 1. Workspace save MUST NOT be called (no single segment saved as full recording)
  assert.equal(workspaceSaveCalls, 0);

  // 2. Draft deletion MUST NOT be called
  assert.equal(deleteSessionCalls, 0);

  // 3. All 3 finalized segments MUST remain intact in store
  const preservedSegments = await store.getTranscriptionSegments(sessionId);
  assert.equal(preservedSegments.length, 3);
  assert.deepEqual(
    preservedSegments.map(s => s.segmentIndex),
    [0, 1, 2]
  );

  // 4. Session status MUST be recoverable
  const sessionAfter = await store.getSession(sessionId);
  assert.equal(sessionAfter?.status, 'recoverable');
  assert.equal(sessionAfter?.errorCode, 'archive-finalization-failed');

  store.close();
});

test('34. IMPORTANT 4: Honest playback validation (validator injection & browser Audio probe lifecycle)', async () => {
  // Part A: Arbitrary 4-byte non-EBML Blob is rejected as unplayable
  const arbitraryBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm;codecs=opus' });
  const arbitraryCheck = await validateBlobPlayable(arbitraryBlob);
  assert.equal(arbitraryCheck.playable, false);
  assert.equal(arbitraryCheck.outcome, 'media-error');

  // Part B: Browser Audio probe lifecycle (loadedmetadata/canplay, error, timeout, cleanup)
  const validWebmBlob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])], {
    type: 'audio/webm;codecs=opus',
  });

  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const origCreateObjUrl = URL.createObjectURL;
  const origRevokeObjUrl = URL.revokeObjectURL;

  URL.createObjectURL = ((_b: Blob) => {
    const u = `blob:mock-url-${createdUrls.length + 1}`;
    createdUrls.push(u);
    return u;
  }) as any;
  URL.revokeObjectURL = ((u: string) => {
    revokedUrls.push(u);
  }) as any;

  try {
    // 1. Playable outcome
    MockHtmlAudioElement.instances = [];
    MockHtmlAudioElement.nextOutcome = 'playable';
    const resPlayable = await validateBlobPlayable(validWebmBlob, 200);
    assert.equal(resPlayable.playable, true);
    assert.equal(resPlayable.outcome, 'playable');
    assert.equal(MockHtmlAudioElement.instances.length, 1);
    const audio1 = MockHtmlAudioElement.instances[0];
    assert.equal(audio1.paused, true);
    assert.equal(audio1.removedSrc, true);
    assert.equal(audio1.src, '');
    for (const evt of ['canplay', 'loadedmetadata', 'error', 'stalled', 'abort']) {
      assert.equal(audio1.listeners.get(evt)?.size ?? 0, 0, `Listener ${evt} wajib dibersihkan`);
    }
    assert.equal(revokedUrls.length, 1);
    assert.equal(revokedUrls[0], createdUrls[0]);

    // 2. Media-error outcome
    MockHtmlAudioElement.instances = [];
    MockHtmlAudioElement.nextOutcome = 'media-error';
    const resErr = await validateBlobPlayable(validWebmBlob, 200);
    assert.equal(resErr.playable, false);
    assert.equal(resErr.outcome, 'media-error');
    const audio2 = MockHtmlAudioElement.instances[0];
    assert.equal(audio2.removedSrc, true);
    for (const evt of ['canplay', 'loadedmetadata', 'error', 'stalled', 'abort']) {
      assert.equal(audio2.listeners.get(evt)?.size ?? 0, 0, `Listener ${evt} wajib dibersihkan pada error`);
    }
    assert.equal(revokedUrls.length, 2);

    // 3. Timeout outcome
    MockHtmlAudioElement.instances = [];
    MockHtmlAudioElement.nextOutcome = 'timeout';
    const resTimeout = await validateBlobPlayable(validWebmBlob, 35);
    assert.equal(resTimeout.playable, false);
    assert.equal(resTimeout.outcome, 'timeout-unplayable');
    const audio3 = MockHtmlAudioElement.instances[0];
    assert.equal(audio3.removedSrc, true);
    for (const evt of ['canplay', 'loadedmetadata', 'error', 'stalled', 'abort']) {
      assert.equal(audio3.listeners.get(evt)?.size ?? 0, 0, `Listener ${evt} wajib dibersihkan pada timeout`);
    }
    assert.equal(revokedUrls.length, 3);
  } finally {
    URL.createObjectURL = origCreateObjUrl;
    URL.revokeObjectURL = origRevokeObjUrl;
    MockHtmlAudioElement.nextOutcome = 'playable';
  }

  // Part C: Validator injection in finalizeRecordingSession controls save/retain behavior
  const store = new RecordingStore(`test-validator-inj-${Date.now()}`);
  const sessionId = 'rec-val-inj';
  await store.saveSession({
    sessionId,
    targetProjectId: 'p1',
    title: 'Validator Injection',
    status: 'recording',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 10000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: null,
    errorMessage: null,
  });
  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 0,
    blob: validWebmBlob,
    sizeBytes: validWebmBlob.size,
    timestampMs: 1000,
    activeDurationMs: 10000,
    createdAt: Date.now(),
  });

  let savedCount = 0;
  // Inject false (media-error)
  await assert.rejects(
    async () =>
      finalizeRecordingSession(sessionId, store, {
        validateBlobPlayableFn: async () => ({
          playable: false,
          outcome: 'media-error',
          reason: 'Simulasi decode gagal',
        }),
        saveToWorkspaceFn: async () => {
          savedCount += 1;
        },
      }),
    /media-error/
  );
  assert.equal(savedCount, 0);
  assert.equal((await store.getOrderedArchiveChunks(sessionId)).length, 1);

  // Inject timeout-unplayable
  await assert.rejects(
    async () =>
      finalizeRecordingSession(sessionId, store, {
        validateBlobPlayableFn: async () => ({
          playable: false,
          outcome: 'timeout-unplayable',
          reason: 'Simulasi timeout',
        }),
        saveToWorkspaceFn: async () => {
          savedCount += 1;
        },
      }),
    /timeout-unplayable/
  );
  assert.equal(savedCount, 0);
  assert.equal((await store.getOrderedArchiveChunks(sessionId)).length, 1);

  // Inject playable: true -> saves to workspace and deletes draft
  const finalRes = await finalizeRecordingSession(sessionId, store, {
    validateBlobPlayableFn: async () => ({
      playable: true,
      outcome: 'playable',
    }),
    saveToWorkspaceFn: async () => {
      savedCount += 1;
    },
  });
  assert.ok(finalRes.recordingId);
  assert.equal(savedCount, 1);
  assert.equal((await store.getOrderedArchiveChunks(sessionId)).length, 0);

  store.close();
});
