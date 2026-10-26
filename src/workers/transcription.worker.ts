import { env, pipeline } from '@huggingface/transformers';
import type { ChunkSegment } from '../features/transcription/chunk-merger';
import type { WorkerErrorCategory, WorkerRequest, WorkerResponse } from './transcription-protocol';

const DEFAULT_MODEL = 'onnx-community/whisper-tiny';

env.useBrowserCache = true;
env.useWasmCache = true;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
}

let cached: { backend: 'webgpu' | 'wasm'; pipe: any } | null = null;
const cancelledJobIds = new Set<string>();

function post(message: WorkerResponse) {
  self.postMessage(message);
}

function classifyError(error: unknown, stage: 'model' | 'transcribe', backend: 'webgpu' | 'wasm'): WorkerErrorCategory {
  const raw = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/out of memory|memory|allocation|oom|arraybuffer/.test(raw)) return 'resource-exhausted';
  if (stage === 'model') return backend === 'webgpu' ? 'backend-failed' : 'model-load-failed';
  if (backend === 'webgpu' && /webgpu|gpu|device|adapter|shader|wgsl|pipeline|buffer|queue|compute|commandencoder|mapasync|dxgi|vulkan|metal|d3d/i.test(raw)) {
    return 'backend-failed';
  }
  return 'transcription-failed';
}

async function disposeCached() {
  if (!cached) return;
  const current = cached;
  cached = null;
  try { await current.pipe?.dispose?.(); } catch { /* ignore */ }
}

async function ensurePipeline(jobId: string, backend: 'webgpu' | 'wasm') {
  if (cached && cached.backend === backend) return cached.pipe;
  await disposeCached();
  const pipe = await pipeline('automatic-speech-recognition', DEFAULT_MODEL, {
    device: backend,
    dtype: backend === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: (progress: { status?: string; progress?: number; file?: string }) => {
      if (cancelledJobIds.has(jobId)) return;
      post({
        type: 'model-progress',
        jobId,
        progress: typeof progress.progress === 'number' ? Math.round(progress.progress) : null,
        file: progress.file ?? '',
      });
    },
  });
  cached = { backend, pipe };
  return pipe;
}

function toChunkSegments(
  output: { text?: string; chunks?: Array<{ text: string; timestamp?: [number | null, number | null] }> },
  fallbackDuration: number,
): ChunkSegment[] {
  const rawChunks = output.chunks?.filter(c => c.text?.trim()) ?? [];
  if (rawChunks.length > 0) {
    return rawChunks.map((chunk, i) => {
      const start = Math.max(0, Number(chunk.timestamp?.[0] ?? 0));
      const nextStart = rawChunks[i + 1]?.timestamp?.[0];
      const rawEnd = chunk.timestamp?.[1];
      const end = rawEnd != null && Number.isFinite(rawEnd)
        ? Math.max(start, Number(rawEnd))
        : nextStart != null && Number.isFinite(nextStart)
          ? Math.max(start, Number(nextStart))
          : Math.max(start, fallbackDuration);
      return { text: chunk.text.trim(), start, end };
    });
  }
  const text = (output.text ?? '').trim();
  return text ? [{ text, start: 0, end: Math.max(0, fallbackDuration) }] : [];
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (!req || typeof req !== 'object') return;

  if (req.type === 'cancel-job') {
    cancelledJobIds.add(req.jobId);
    post({ type: 'job-cancelled', jobId: req.jobId });
    return;
  }

  if (req.type === 'init-model') {
    if (cancelledJobIds.has(req.jobId)) return;
    try {
      await ensurePipeline(req.jobId, req.backend);
      if (!cancelledJobIds.has(req.jobId)) post({ type: 'model-ready', jobId: req.jobId, backend: req.backend });
    } catch (error) {
      await disposeCached();
      if (!cancelledJobIds.has(req.jobId)) {
        post({
          type: 'worker-error',
          jobId: req.jobId,
          category: classifyError(error, 'model', req.backend),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return;
  }

  if (req.type === 'transcribe-chunk') {
    if (cancelledJobIds.has(req.jobId)) return;
    try {
      const pipe = await ensurePipeline(req.jobId, req.backend);
      if (cancelledJobIds.has(req.jobId)) return;
      const output = (await pipe(req.audio, {
        return_timestamps: true,
        language: req.language === 'id' ? 'indonesian' : 'english',
        task: 'transcribe',
      })) as { text?: string; chunks?: Array<{ text: string; timestamp?: [number | null, number | null] }> };
      if (cancelledJobIds.has(req.jobId)) return;
      post({
        type: 'chunk-complete',
        jobId: req.jobId,
        chunkId: req.chunkId,
        sourceIndex: req.sourceIndex,
        sourceStart: req.sourceStart,
        sourceEnd: req.sourceEnd,
        overlapStart: req.overlapStart,
        overlapEnd: req.overlapEnd,
        language: req.language,
        segments: toChunkSegments(output, Math.max(0, req.sourceEnd - req.sourceStart)),
      });
    } catch (error) {
      if (!cancelledJobIds.has(req.jobId)) {
        post({
          type: 'worker-error',
          jobId: req.jobId,
          category: classifyError(error, 'transcribe', req.backend),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
};
