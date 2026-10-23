import { env, pipeline } from '@huggingface/transformers';

type ModelSize = 'tiny' | 'base' | 'small';
type Request = { type: 'transcribe'; audio: Float32Array; model: ModelSize; language: 'id' | 'en'; useWebGpu: boolean };

const models: Record<ModelSize, string> = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
};

env.useBrowserCache = true;
env.useWasmCache = true;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
}

let cached: { key: string; pipe: any } | null = null;

self.onmessage = async (event: MessageEvent<Request>) => {
  if (event.data.type !== 'transcribe') return;
  const { audio, model, language, useWebGpu } = event.data;
  const key = `${model}-${useWebGpu ? 'webgpu' : 'wasm'}`;
  try {
    if (!cached || cached.key !== key) {
      self.postMessage({ type: 'status', stage: 'model', message: 'Menyiapkan model transkripsi…' });
      cached = {
        key,
        pipe: await pipeline('automatic-speech-recognition', models[model], {
          device: useWebGpu ? 'webgpu' : 'wasm',
          dtype: useWebGpu ? 'fp16' : 'q8',
          progress_callback: (progress: { status?: string; progress?: number; file?: string }) => {
            self.postMessage({ type: 'progress', stage: 'model', progress: progress.progress ?? null, file: progress.file ?? '' });
          },
        }),
      };
    }
    self.postMessage({ type: 'status', stage: 'transcription', message: 'Mentranskripsikan rekaman di perangkat…' });
    const output = await cached.pipe(audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: language === 'id' ? 'indonesian' : 'english',
      task: 'transcribe',
    }) as { text: string; chunks?: Array<{ text: string; timestamp: [number | null, number | null] }> };
    self.postMessage({ type: 'complete', output });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
