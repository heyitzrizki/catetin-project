import type { ChunkSegment } from '../features/transcription/chunk-merger';
import type { TranscriptionBackend, TranscriptionLanguage } from '../features/transcription/types';

export type WorkerErrorCategory =
  | 'model-load-failed'
  | 'backend-failed'
  | 'resource-exhausted'
  | 'cancelled'
  | 'transcription-failed';

export type WorkerRequest =
  | { type: 'init-model'; jobId: string; backend: TranscriptionBackend }
  | {
      type: 'transcribe-chunk';
      jobId: string;
      chunkId: string;
      sourceIndex: number;
      totalChunks: number;
      sourceStart: number;
      sourceEnd: number;
      overlapStart: number;
      overlapEnd: number;
      language: TranscriptionLanguage;
      backend: TranscriptionBackend;
      audio: Float32Array;
    }
  | { type: 'cancel-job'; jobId: string };

export type WorkerResponse =
  | { type: 'model-progress'; jobId: string; progress: number | null; file: string }
  | { type: 'model-ready'; jobId: string; backend: TranscriptionBackend }
  | {
      type: 'chunk-complete';
      jobId: string;
      chunkId: string;
      sourceIndex: number;
      sourceStart: number;
      sourceEnd: number;
      overlapStart: number;
      overlapEnd: number;
      language: TranscriptionLanguage;
      segments: ChunkSegment[];
    }
  | { type: 'job-cancelled'; jobId: string }
  | { type: 'worker-error'; jobId: string; category: WorkerErrorCategory; message: string };
