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

  // Verify model init does NOT fall back to WASM for resource-exhausted or cancelled
  for (const nonRecoverableInitCategory of ['resource-exhausted', 'cancelled'] as const) {
    const initBackends: string[] = [];
    const initSnapshots: TranscriptionUiSnapshot[] = [];
    const noInitFallbackController = new TranscriptionJobController({
      getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
      getGpu: () => ({ requestAdapter: async () => ({}) }),
      createWorker: () => new MockWorker((req, worker) => {
        queueMicrotask(() => {
          if (req.type === 'init-model') {
            initBackends.push(req.backend);
            worker.emit({
              type: 'worker-error',
              jobId: req.jobId,
              category: nonRecoverableInitCategory,
              message: `Init failed with ${nonRecoverableInitCategory}`,
            });
          }
        });
      }),
      onStatusChange: snap => initSnapshots.push(snap),
      onComplete: () => {},
    });

    await noInitFallbackController.runJob({ file: createWavFile(15, 'no-init-fallback.wav'), language: 'id', resume: false });
    assert.deepEqual(initBackends, ['webgpu'], `Should not retry init on wasm for ${nonRecoverableInitCategory}`);
    assert.equal(noInitFallbackController.getJobState()?.backend, 'webgpu');
    assert.equal(noInitFallbackController.getJobState()?.fallbackCount, 0);
    if (nonRecoverableInitCategory === 'cancelled') {
      assert.equal(initSnapshots.at(-1)?.status, 'cancelled');
    } else {
      assert.equal(initSnapshots.at(-1)?.status, 'failed');
      assert.equal(initSnapshots.at(-1)?.errorReason, 'resource-exhausted');
    }
  }
});

test('resumes from a compatible checkpoint without reprocessing already completed chunks', async () => {
  const wav = createWavFile(45, 'resume-session.wav');
  const processedSourceIndices: number[] = [];
  let failSecondChunk = true;
  let completedSegments: DialogSegment[] = [];
  const snapshots: TranscriptionUiSnapshot[] = [];

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => undefined,
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
          worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        } else if (req.type === 'transcribe-chunk') {
          processedSourceIndices.push(req.sourceIndex);
          if (req.sourceIndex === 1 && failSecondChunk) {
            worker.emit({ type: 'worker-error', jobId: req.jobId, category: 'transcription-failed', message: 'Interrupted on chunk 1' });
            return;
          }
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
              text: req.sourceIndex === 0 ? 'Bagian pertama tersimpan.' : 'Bagian kedua dilanjutkan.',
              start: req.sourceIndex === 0 ? 1 : 6,
              end: req.sourceIndex === 0 ? 5 : 10,
            }],
          });
        }
      });
    }),
    onStatusChange: snap => snapshots.push(snap),
    onComplete: segments => { completedSegments = segments; },
  });

  // First run: completes chunk 0, fails on chunk 1, leaving a compatible checkpoint with chunk 0
  await controller.runJob({ file: wav, language: 'id' });
  assert.equal(snapshots.at(-1)?.status, 'failed');
  assert.deepEqual(processedSourceIndices, [0, 1]);
  assert.equal((await listCheckpointSummaries()).length, 1);

  // Second run: resumes from checkpoint, skips chunk 0, processes only chunk 1
  failSecondChunk = false;
  processedSourceIndices.length = 0;
  await controller.runJob({ file: wav, language: 'id' });

  assert.equal(snapshots.at(-1)?.status, 'completed');
  assert.equal(snapshots.at(-1)?.resumedFromChunks, 1);
  assert.deepEqual(processedSourceIndices, [1]);
  assert.equal(completedSegments.length, 2);
  assert.equal(completedSegments[0]?.text, 'Bagian pertama tersimpan.');
  assert.equal(completedSegments[1]?.text, 'Bagian kedua dilanjutkan.');
  assert.equal((await listCheckpointSummaries()).length, 0);
});

test('discards a saved checkpoint and reprocesses from chunk 0 on next run', async () => {
  const wav = createWavFile(45, 'discard-session.wav');
  const processedSourceIndices: number[] = [];
  let failSecondChunk = true;
  const snapshots: TranscriptionUiSnapshot[] = [];

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => undefined,
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
          worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        } else if (req.type === 'transcribe-chunk') {
          processedSourceIndices.push(req.sourceIndex);
          if (req.sourceIndex === 1 && failSecondChunk) {
            worker.emit({ type: 'worker-error', jobId: req.jobId, category: 'transcription-failed', message: 'Interrupted' });
            return;
          }
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
            segments: [{ text: `Chunk ${req.sourceIndex}`, start: 1, end: 4 }],
          });
        }
      });
    }),
    onStatusChange: snap => snapshots.push(snap),
    onComplete: () => {},
  });

  await controller.runJob({ file: wav, language: 'id' });
  assert.equal((await listCheckpointSummaries()).length, 1);

  const discarded = await controller.discardCheckpoint({ file: wav, language: 'id' });
  assert.equal(discarded, true);
  assert.equal((await listCheckpointSummaries()).length, 0);
  assert.equal(snapshots.at(-1)?.status, 'idle');

  failSecondChunk = false;
  processedSourceIndices.length = 0;
  await controller.runJob({ file: wav, language: 'id' });
  assert.deepEqual(processedSourceIndices, [0, 1]);
  assert.equal(snapshots.at(-1)?.resumedFromChunks, 0);
});

test('falls back at most once from webgpu to wasm when transcribeChunk fails and retries only the failed chunk', async () => {
  const wav = createWavFile(45, 'chunk-fallback.wav');
  const attempts: Array<{ sourceIndex: number; backend: string; sampleLength: number }> = [];
  let completedSegments: DialogSegment[] = [];
  const snapshots: TranscriptionUiSnapshot[] = [];

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => ({ requestAdapter: async () => ({}) }),
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
          worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        } else if (req.type === 'transcribe-chunk') {
          attempts.push({ sourceIndex: req.sourceIndex, backend: req.backend, sampleLength: req.audio.length });
          if (req.sourceIndex === 1 && req.backend === 'webgpu') {
            worker.emit({ type: 'worker-error', jobId: req.jobId, category: 'backend-failed', message: 'WebGPU device lost on chunk 1' });
            return;
          }
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
              text: req.sourceIndex === 0 ? 'Bagian pertama di WebGPU.' : 'Bagian kedua diulang di WASM.',
              start: req.sourceIndex === 0 ? 1 : 6,
              end: req.sourceIndex === 0 ? 5 : 10,
            }],
          });
        }
      });
    }),
    onStatusChange: snap => snapshots.push(snap),
    onComplete: segments => { completedSegments = segments; },
  });

  await controller.runJob({ file: wav, language: 'id' });

  assert.equal(snapshots.at(-1)?.status, 'completed');
  assert.equal(controller.getJobState()?.backend, 'wasm');
  assert.equal(controller.getJobState()?.fallbackCount, 1);
  // Chunk 0 ran once on webgpu; chunk 1 failed on webgpu and retried once on wasm with non-detached samples
  assert.equal(attempts.length, 3);
  assert.deepEqual(
    attempts.map(a => ({ sourceIndex: a.sourceIndex, backend: a.backend })),
    [
      { sourceIndex: 0, backend: 'webgpu' },
      { sourceIndex: 1, backend: 'webgpu' },
      { sourceIndex: 1, backend: 'wasm' },
    ],
  );
  assert.ok(attempts[2].sampleLength > 0);
  assert.equal(completedSegments.length, 2);
  assert.equal(completedSegments[0]?.text, 'Bagian pertama di WebGPU.');
  assert.equal(completedSegments[1]?.text, 'Bagian kedua diulang di WASM.');
});

test('binds job snapshots and completion metadata to the recordingId where the job started', async () => {
  const snapshots: TranscriptionUiSnapshot[] = [];
  let completionMeta: { jobId: string; recordingId?: string; backend: string; durationSec: number } | undefined;

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => undefined,
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
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
            segments: [{ text: 'Terikat ke rekaman awal.', start: 1, end: 3 }],
          });
        }
      });
    }),
    onStatusChange: snap => snapshots.push(snap),
    onComplete: (_segments, meta) => { completionMeta = meta; },
  });

  await controller.runJob({
    file: createWavFile(12, 'bound.wav'),
    language: 'id',
    recordingId: 'local-recording-42',
  });

  assert.ok(snapshots.length > 0);
  for (const snap of snapshots) {
    assert.equal(snap.recordingId, 'local-recording-42');
  }
  assert.equal(completionMeta?.recordingId, 'local-recording-42');
});

test('persists fallback state to checkpoint when WASM retry fails so resume starts on WASM without repeating WebGPU', async () => {
  const wav = createWavFile(45, 'persisted-fallback.wav');
  const initBackends: string[] = [];
  const chunkAttempts: Array<{ sourceIndex: number; backend: string }> = [];
  let failWasmOnChunk1 = true;
  let completedSegments: DialogSegment[] = [];
  const snapshots: TranscriptionUiSnapshot[] = [];

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => ({ requestAdapter: async () => ({}) }),
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
          initBackends.push(req.backend);
          worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        } else if (req.type === 'transcribe-chunk') {
          chunkAttempts.push({ sourceIndex: req.sourceIndex, backend: req.backend });
          if (req.sourceIndex === 1 && req.backend === 'webgpu') {
            worker.emit({ type: 'worker-error', jobId: req.jobId, category: 'backend-failed', message: 'WebGPU failed on chunk 1' });
            return;
          }
          if (req.sourceIndex === 1 && req.backend === 'wasm' && failWasmOnChunk1) {
            worker.emit({ type: 'worker-error', jobId: req.jobId, category: 'transcription-failed', message: 'WASM retry failed on chunk 1' });
            return;
          }
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
              text: req.sourceIndex === 0 ? 'Chunk 0 dari WebGPU.' : 'Chunk 1 dilanjutkan langsung di WASM.',
              start: req.sourceIndex === 0 ? 1 : 6,
              end: req.sourceIndex === 0 ? 5 : 10,
            }],
          });
        }
      });
    }),
    onStatusChange: snap => snapshots.push(snap),
    onComplete: segments => { completedSegments = segments; },
  });

  // Run 1: Chunk 0 succeeds on webgpu -> Chunk 1 fails on webgpu -> falls back to wasm -> wasm retry fails
  await controller.runJob({ file: wav, language: 'id' });
  assert.equal(snapshots.at(-1)?.status, 'failed');
  assert.deepEqual(initBackends, ['webgpu', 'wasm']);
  assert.deepEqual(chunkAttempts, [
    { sourceIndex: 0, backend: 'webgpu' },
    { sourceIndex: 1, backend: 'webgpu' },
    { sourceIndex: 1, backend: 'wasm' },
  ]);

  const savedCheckpoint = await controller.findCompatibleCheckpoint({ file: wav, language: 'id' });
  assert.ok(savedCheckpoint);
  assert.equal(savedCheckpoint.settings.backend, 'wasm');
  assert.deepEqual(savedCheckpoint.backendHistory, ['webgpu', 'wasm']);
  assert.equal(savedCheckpoint.chunks.length, 1);
  assert.equal(savedCheckpoint.chunks[0]?.sourceIndex, 0);

  // Run 2: Resume from checkpoint -> must initialize WASM directly, preserve chunk 0, and NOT try WebGPU again
  failWasmOnChunk1 = false;
  initBackends.length = 0;
  chunkAttempts.length = 0;

  await controller.runJob({ file: wav, language: 'id' });

  assert.equal(snapshots.at(-1)?.status, 'completed');
  assert.equal(snapshots.at(-1)?.resumedFromChunks, 1);
  assert.equal(controller.getJobState()?.backend, 'wasm');
  assert.equal(controller.getJobState()?.fallbackCount, 1);
  assert.deepEqual(initBackends, ['wasm']);
  assert.deepEqual(chunkAttempts, [{ sourceIndex: 1, backend: 'wasm' }]);
  assert.equal(completedSegments.length, 2);
  assert.equal(completedSegments[0]?.text, 'Chunk 0 dari WebGPU.');
  assert.equal(completedSegments[1]?.text, 'Chunk 1 dilanjutkan langsung di WASM.');
});

test('discardCheckpoint with explicit target removes only the targeted checkpoint and preserves other checkpoints', async () => {
  const wavA = createWavFile(45, 'recording-a.wav');
  const wavB = createWavFile(55, 'recording-b.wav');

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => undefined,
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
          worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        } else if (req.type === 'transcribe-chunk') {
          if (req.sourceIndex === 1) {
            worker.emit({ type: 'worker-error', jobId: req.jobId, category: 'transcription-failed', message: 'Stop on chunk 1' });
            return;
          }
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
            segments: [{ text: 'Chunk 0 saved.', start: 1, end: 4 }],
          });
        }
      });
    }),
    onStatusChange: () => {},
    onComplete: () => {},
  });

  // Create checkpoint A, then checkpoint B (making B the controller's lastCheckpointId)
  await controller.runJob({ file: wavA, language: 'id' });
  await controller.runJob({ file: wavB, language: 'id' });

  const checkpointA = await controller.findCompatibleCheckpoint({ file: wavA, language: 'id' });
  const checkpointB = await controller.findCompatibleCheckpoint({ file: wavB, language: 'id' });
  assert.ok(checkpointA);
  assert.ok(checkpointB);
  assert.notEqual(checkpointA.id, checkpointB.id);
  assert.equal((await listCheckpointSummaries()).length, 2);

  // Also test the reverse: if A is the most recent run (lastCheckpointId = A), discarding B explicitly must NOT delete A
  await controller.runJob({ file: wavA, language: 'id' });
  const deletedB = await controller.discardCheckpoint({ file: wavB, language: 'id' });
  assert.equal(deletedB, true);

  const remaining = await listCheckpointSummaries();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.id, checkpointA.id);
  assert.equal(await controller.findCompatibleCheckpoint({ file: wavB, language: 'id' }), null);
  assert.equal((await controller.findCompatibleCheckpoint({ file: wavA, language: 'id' }))?.id, checkpointA.id);
});

test('does not fall back from webgpu to wasm for resource-exhausted, generic transcription-failed, decode/input error, or cancellation', async () => {
  const wav = createWavFile(45, 'no-fallback.wav');

  for (const nonRecoverableCategory of ['resource-exhausted', 'transcription-failed', 'cancelled'] as const) {
    const initBackends: string[] = [];
    const chunkBackends: string[] = [];
    const snapshots: TranscriptionUiSnapshot[] = [];

    const controller = new TranscriptionJobController({
      getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
      getGpu: () => ({ requestAdapter: async () => ({}) }),
      createWorker: () => new MockWorker((req, worker) => {
        queueMicrotask(() => {
          if (req.type === 'init-model') {
            initBackends.push(req.backend);
            worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
          } else if (req.type === 'transcribe-chunk') {
            chunkBackends.push(req.backend);
            worker.emit({
              type: 'worker-error',
              jobId: req.jobId,
              category: nonRecoverableCategory,
              message: `Non-recoverable error: ${nonRecoverableCategory}`,
            });
          }
        });
      }),
      onStatusChange: snap => snapshots.push(snap),
      onComplete: () => {},
    });

    await controller.runJob({ file: wav, language: 'id', resume: false });

    assert.deepEqual(initBackends, ['webgpu'], `Should not init wasm for ${nonRecoverableCategory}`);
    assert.deepEqual(chunkBackends, ['webgpu'], `Should not retry chunk on wasm for ${nonRecoverableCategory}`);
    assert.equal(controller.getJobState()?.backend, 'webgpu');
    assert.equal(controller.getJobState()?.fallbackCount, 0);
    if (nonRecoverableCategory === 'cancelled') {
      assert.equal(snapshots.at(-1)?.status, 'cancelled');
      assert.equal(snapshots.at(-1)?.errorReason, 'cancelled');
    } else if (nonRecoverableCategory === 'resource-exhausted') {
      assert.equal(snapshots.at(-1)?.status, 'failed');
      assert.equal(snapshots.at(-1)?.errorReason, 'resource-exhausted');
    } else {
      assert.equal(snapshots.at(-1)?.status, 'failed');
      assert.equal(snapshots.at(-1)?.errorReason, 'general-failure');
    }
  }

  // Also verify input/decode failure does not trigger WASM fallback
  const decodeSnapshots: TranscriptionUiSnapshot[] = [];
  const decodeInitBackends: string[] = [];
  const decodeFailController = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => ({ requestAdapter: async () => ({}) }),
    probeDuration: async () => 10,
    decodeWholeFile: async () => {
      throw new Error('Corrupted audio container');
    },
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
          decodeInitBackends.push(req.backend);
          worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        }
      });
    }),
    onStatusChange: snap => decodeSnapshots.push(snap),
    onComplete: () => {},
  });

  const mp3 = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' }) as Blob & { name: string };
  Object.defineProperty(mp3, 'name', { value: 'broken.mp3' });
  await decodeFailController.runJob({ file: mp3, language: 'id', resume: false });
  assert.deepEqual(decodeInitBackends, ['webgpu']);
  assert.equal(decodeSnapshots.at(-1)?.status, 'failed');
  assert.equal(decodeSnapshots.at(-1)?.errorReason, 'general-failure');
  assert.equal(decodeFailController.getJobState()?.backend, 'webgpu');
  assert.equal(decodeFailController.getJobState()?.fallbackCount, 0);
});

test('prevents an older concurrent runJob with delayed initialization from overtaking or mutating a newer runJob', async () => {
  const wavOld = createWavFile(12, 'old-run.wav');
  const wavNew = createWavFile(12, 'new-run.wav');
  const snapshots: TranscriptionUiSnapshot[] = [];
  const completions: Array<{ recordingId?: string; text: string }> = [];

  let resolveSlowAdapter!: (value: unknown) => void;
  let gpuCallCount = 0;

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => ({
      requestAdapter: () => {
        gpuCallCount += 1;
        if (gpuCallCount === 1) {
          return new Promise(resolve => {
            resolveSlowAdapter = resolve;
          });
        }
        return Promise.resolve({});
      },
    }),
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
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
            segments: [{ text: `Hasil untuk ${req.jobId}`, start: 1, end: 3 }],
          });
        }
      });
    }),
    onStatusChange: snap => snapshots.push(snap),
    onComplete: (segments, meta) => {
      completions.push({ recordingId: meta.recordingId, text: segments[0]?.text ?? '' });
    },
  });

  // Start run 1 (stalls inside inspectCapabilities -> requestAdapter)
  const run1Promise = controller.runJob({
    file: wavOld,
    language: 'id',
    recordingId: 'rec-old',
  });

  // Immediately start run 2 (supersedes run 1 before run 1 finishes its first await)
  const run2Promise = controller.runJob({
    file: wavNew,
    language: 'id',
    recordingId: 'rec-new',
  });

  // Now unblock run 1's delayed adapter request while run 2 is running/finishing
  resolveSlowAdapter({});

  await Promise.all([run1Promise, run2Promise]);

  // Run 1 must never emit any snapshot or completion; all snapshots and final state belong strictly to rec-new
  assert.ok(snapshots.length > 0);
  for (const snap of snapshots) {
    assert.equal(snap.recordingId, 'rec-new');
  }
  assert.equal(completions.length, 1);
  assert.equal(completions[0]?.recordingId, 'rec-new');
  assert.equal(controller.getActiveRecordingId(), 'rec-new');
  assert.equal(controller.getJobState()?.phase, 'complete');
});

test('enforces strict discardCheckpoint priority for checkpointId and removes all duplicate checkpoints for file+language', async () => {
  const wavA = createWavFile(45, 'dup-a.wav');
  const wavB = createWavFile(55, 'other-b.wav');

  const controller = new TranscriptionJobController({
    getDeviceSignals: () => ({ userAgent: 'Chrome/156.0 Windows NT 10.0', platform: 'Win32', maxTouchPoints: 0, mobile: false }),
    getGpu: () => undefined,
    createWorker: () => new MockWorker((req, worker) => {
      queueMicrotask(() => {
        if (req.type === 'init-model') {
          worker.emit({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
        } else if (req.type === 'transcribe-chunk') {
          if (req.sourceIndex === 1) {
            worker.emit({ type: 'worker-error', jobId: req.jobId, category: 'transcription-failed', message: 'Fail chunk 1' });
            return;
          }
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
            segments: [{ text: 'Chunk 0 saved.', start: 1, end: 4 }],
          });
        }
      });
    }),
    onStatusChange: () => {},
    onComplete: () => {},
  });

  // Create two distinct checkpoints for wavA (using resume: false) and one for wavB
  await controller.runJob({ file: wavA, language: 'id', resume: false });
  const firstWavAId = controller.getJobState()?.jobId;
  assert.ok(firstWavAId);

  await controller.runJob({ file: wavA, language: 'id', resume: false });
  const secondWavAId = controller.getJobState()?.jobId;
  assert.ok(secondWavAId);
  assert.notEqual(firstWavAId, secondWavAId);

  await controller.runJob({ file: wavB, language: 'id', resume: false });
  const wavBId = controller.getJobState()?.jobId;
  assert.ok(wavBId);

  assert.equal((await listCheckpointSummaries()).length, 3);

  // 1) Passing checkpointId + file must prioritize checkpointId and delete ONLY that single ID
  const deletedSingle = await controller.discardCheckpoint({
    checkpointId: firstWavAId,
    file: wavB,
    language: 'id',
  });
  assert.equal(deletedSingle, true);

  const afterSingleDelete = await listCheckpointSummaries();
  assert.equal(afterSingleDelete.length, 2);
  assert.deepEqual(
    afterSingleDelete.map(item => item.id).sort(),
    [secondWavAId, wavBId].sort(),
  );

  // Create one more duplicate checkpoint for wavA so wavA again has 2 checkpoints in storage
  await controller.runJob({ file: wavA, language: 'id', resume: false });
  const thirdWavAId = controller.getJobState()?.jobId;
  assert.ok(thirdWavAId);
  assert.equal((await listCheckpointSummaries()).length, 3);

  // 2) Passing file + language (without checkpointId) must delete ALL compatible checkpoints for wavA while preserving wavB
  const deletedAllWavA = await controller.discardCheckpoint({
    file: wavA,
    language: 'id',
  });
  assert.equal(deletedAllWavA, true);

  const afterMultiDelete = await listCheckpointSummaries();
  assert.equal(afterMultiDelete.length, 1);
  assert.equal(afterMultiDelete[0]?.id, wavBId);
  assert.equal(await controller.findCompatibleCheckpoint({ file: wavA, language: 'id' }), null);
  assert.equal((await controller.findCompatibleCheckpoint({ file: wavB, language: 'id' }))?.id, wavBId);
});
