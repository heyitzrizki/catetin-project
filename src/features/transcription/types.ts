export type TranscriptionBackend = 'webgpu' | 'wasm';
export type TranscriptionLanguage = 'id' | 'en';
export type TranscriptionModel = 'tiny' | 'base' | 'small';

export interface JobCompatibility {
  checkpointSchema: string;
  transcriptionProtocol: string;
  transformersVersion: string;
  modelRepository: string;
  modelRevision: string;
  chunkPolicyVersion: string;
  mergerVersion: string;
  transcriptSchemaVersion: string;
}

export type TranscriptionPhase =
  | 'inspecting' | 'preparing-model' | 'preparing-audio' | 'transcribing'
  | 'falling-back' | 'merging' | 'checkpointing' | 'paused' | 'resumable'
  | 'cancelling' | 'cancelled' | 'complete' | 'error';

export interface TranscriptionSettings {
  model: TranscriptionModel;
  language: TranscriptionLanguage;
  backend: TranscriptionBackend;
}

export interface TranscriptionJobState extends TranscriptionSettings {
  jobId: string;
  phase: TranscriptionPhase;
  fallbackCount: number;
}

export type TranscriptionEvent =
  | { type: 'advance'; jobId: string; phase: TranscriptionPhase }
  | { type: 'fallback'; jobId: string; from: TranscriptionBackend; to: TranscriptionBackend; attempt: 1 };

