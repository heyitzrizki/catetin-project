import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import {
  TranscriptionJobController,
  type TranscriptionUiSnapshot,
  type WorkerLike,
} from '../../src/features/transcription/job-controller';
import { listCheckpointSummaries } from '../../src/features/transcription/checkpoint-store';
import type { WorkerRequest, WorkerResponse } from '../../src/workers/transcription-protocol';
import type { DialogSegment } from '../../src/lib/transcript';

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function createWavFile(durationSeconds: number, name = 'test.wav'): Blob & { name: string; type: string } {
  const sampleRate = 16_000;
  const dataBytes = Math.floor(durationSeconds * sampleRate) * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data'); view.setUint32(40, dataBytes, true);
  const blob = new Blob([buffer], { type: 'audio/wav' }) as Blob & { name: string; type: string };
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

class MockWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  private handler: (req: WorkerRequest, worker: MockWorker) => void;

  constructor(handler: (req: WorkerRequest, worker: MockWorker) => void) {
    this.handler = handler;
  }

  postMessage(message: WorkerRequest) {
    this.handler(message, this);
  }

  emit(response: WorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }

  terminate() {
    this.terminated = true;
  }
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('catetin-transcription');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

test('completes multi-chunk WAV transcription, merges timestamps, and cleans up worker & checkpoint', async () => {
  const snapshots: TranscriptionUiSnapshot[] = [];
  let completedSegments: DialogSegment[] = [];
  let createdWorker: MockWorker | undefined;

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => ({ requestAdapter: async () => ({}) }),
    createWorker: () => {
      createdWorker = new MockWorker((req, worker) => {
        queueMicrotask(() => {
          if (req.type === 'init-model') {
            worker.emit({ type: 'model-progress', jobId: req.jobId, progress: 50, file: 'encoder.onnx' });
            worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
          } else if (req.type === 'transcribe-chunk') {
            worker.emit({
              type: 'chunk-complete',
              jobId: req.jobId,
              chunkId: req.chunkId,
              sourceIndex: req.sourceIndex,
              sourceStart: req.sourceStart,
              sourceEnd: req.sourceEnd,
              overlapStart: req.overlapStart,
              overlapEnd: req.overlapEnd,
              language: req.language,
              segments: [{
                text: req.sourceIndex === 0 ? 'Kalimat pembuka dari bagian pertama.' : 'Kalimat lanjutan dari bagian kedua.',
                start: req.sourceIndex === 0 ? 2 : 6,
                end: req.sourceIndex === 0 ? 8 : 12,
              }],
            });
          }
        });
      });
      return createdWorker;
    },
    onStatusChange: snap => snapshots.push(snap),
    onComplete: segments => { completedSegments = segments; },
  });

  await controller.runJob({ file: createWavFile(45, 'rapat.wav'), language: 'id' });

  const statuses = snapshots.map(s => s.status);
  assert.ok(statuses.includes('validating'));
  assert.ok(statuses.includes('preparing-model'));
  assert.ok(statuses.includes('preparing-audio'));
  assert.ok(statuses.includes('transcribing'));
  assert.ok(statuses.includes('assembling-result'));
  assert.equal(statuses.at(-1), 'completed');

  assert.equal(completedSegments.length, 2);
  assert.equal(completedSegments[0].time, '00:02');
  assert.equal(completedSegments[1].time, '00:31');
  assert.equal(createdWorker?.terminated, true);
  assert.equal((await listCheckpointSummaries()).length, 0);
});

test('completes whole-file decode route for MP3 after pre-decode duration verification and blocks unverified or over-limit MP3 before decode', async () => {
  const snapshots: TranscriptionUiSnapshot[] = [];
  let completedSegments: DialogSegment[] = [];
  let decodeCalls = 0;

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => undefined,
    probeDuration: async () => 10,
    decodeWholeFile: async () => {
      decodeCalls += 1;
      return new Float32Array(16_000 * 10);
    },
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        else if (req.type === 'transcribe-chunk') {
          worker.emit({
            type: 'chunk-complete',
            jobId: req.jobId,
            chunkId: req.chunkId,
            sourceIndex: req.sourceIndex,
            sourceStart: req.sourceStart,
            sourceEnd: req.sourceEnd,
            overlapStart: req.overlapStart,
            overlapEnd: req.overlapEnd,
            language: req.language,
            segments: [{ text: 'Transkrip MP3 pendek.', start: 1, end: 4 }],
          });
        }
      });
    }),
    onStatusChange: snap => snapshots.push(snap),
    onComplete: segments => { completedSegments = segments; },
  });

  const mp3 = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' }) as Blob & { name: string };
  Object.defineProperty(mp3, 'name', { value: 'wawancara.mp3' });
  await controller.runJob({ file: mp3, language: 'id' });
  assert.equal(snapshots.at(-1)?.status, 'completed');
  assert.equal(completedSegments[0]?.text, 'Transkrip MP3 pendek.');
  assert.equal(decodeCalls, 1);

  // Unverified duration must fail safely BEFORE calling decodeWholeFile
  const unverifiedController = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => undefined,
    probeDuration: async () => null,
    decodeWholeFile: async () => {
      decodeCalls += 1;
      return new Float32Array(16_000);
    },
    onStatusChange: snap => snapshots.push(snap),
    onComplete: () => {},
  });
  await unverifiedController.runJob({ file: mp3, language: 'id' });
  assert.equal(snapshots.at(-1)?.status, 'failed');
  assert.equal(snapshots.at(-1)?.errorReason, 'exceeds-safe-limit');
  assert.equal(decodeCalls, 1);
});

test('cancellation terminates worker and ignores late results from cancelled job', async () => {
  const snapshots: TranscriptionUiSnapshot[] = [];
  let completedCalled = false;
  let capturedWorker: MockWorker | undefined;

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => undefined,
    createWorker: () => {
      capturedWorker = new MockWorker((req, worker) => {
        if (req.type === 'init-model') {
          queueMicrotask(() => worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend }));
        } else if (req.type === 'transcribe-chunk') {
          queueMicrotask(() => {
            const oldHandler = worker.onmessage;
            controller.cancelActiveJob();
            oldHandler?.({
              data: {
                type: 'chunk-complete',
                jobId: req.jobId,
                chunkId: req.chunkId,
                sourceIndex: req.sourceIndex,
                sourceStart: req.sourceStart,
                sourceEnd: req.sourceEnd,
                overlapStart: req.overlapStart,
                overlapEnd: req.overlapEnd,
                language: req.language,
                segments: [{ text: 'Terlambat', start: 0, end: 2 }],
              },
            } as MessageEvent<WorkerResponse>);
          });
        }
      });
      return capturedWorker;
    },
    onStatusChange: snap => snapshots.push(snap),
    onComplete: () => { completedCalled = true; },
  });

  await controller.runJob({ file: createWavFile(15, 'cancel.wav'), language: 'id' });
  assert.equal(completedCalled, false);
  assert.equal(capturedWorker?.terminated, true);
  assert.equal(snapshots.at(-1)?.status, 'cancelled');
  assert.equal(controller.getJobState()?.phase, 'cancelled');
});

test('falls back from webgpu to wasm once during model initialization', async () => {
  const snapshots: TranscriptionUiSnapshot[] = [];
  let completedSegments: DialogSegment[] = [];

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => ({ requestAdapter: async () => ({}) }),
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
          if (req.backend === 'webgpu') {
            worker.emit({ type: 'worker-error', jobId: req.jobId, category: 'backend-failed', message: 'WebGPU init failed' });
            return;
          }
          worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        } else if (req.type === 'transcribe-chunk') {
          worker.emit({
            type: 'chunk-complete',
            jobId: req.jobId,
            chunkId: req.chunkId,
            sourceIndex: req.sourceIndex,
            sourceStart: req.sourceStart,
            sourceEnd: req.sourceEnd,
            overlapStart: req.overlapStart,
            overlapEnd: req.overlapEnd,
            language: req.language,
            segments: [{ text: 'Berhasil lewat fallback WASM.', start: 1, end: 4 }],
          });
        }
      });
    }),
    onStatusChange: snap => snapshots.push(snap),
    onComplete: segments => { completedSegments = segments; },
  });

  await controller.runJob({ file: createWavFile(15, 'fallback.wav'), language: 'id' });
  assert.equal(snapshots.at(-1)?.status, 'completed');
  assert.equal(controller.getJobState()?.backend, 'wasm');
  assert.equal(controller.getJobState()?.fallbackCount, 1);
  assert.equal(completedSegments[0]?.text, 'Berhasil lewat fallback WASM.');
});
