import type { TranscriptionEvent, TranscriptionJobState, TranscriptionPhase, TranscriptionSettings } from './types';

const transitions: Record<TranscriptionPhase, readonly TranscriptionPhase[]> = {
  inspecting: ['preparing-model', 'cancelling', 'error'],
  'preparing-model': ['preparing-audio', 'cancelling', 'error'],
  'preparing-audio': ['transcribing', 'cancelling', 'error'],
  transcribing: ['falling-back', 'merging', 'cancelling', 'error'],
  'falling-back': ['transcribing', 'cancelling', 'error'],
  merging: ['checkpointing', 'cancelling', 'error'],
  checkpointing: ['complete', 'resumable', 'error'],
  paused: ['resumable', 'cancelling'],
  resumable: ['preparing-model', 'cancelling'],
  cancelling: ['cancelled', 'resumable', 'error'],
  cancelled: [], complete: [], error: ['preparing-model', 'cancelling'],
};

export function initialJobState(jobId: string, settings: TranscriptionSettings): TranscriptionJobState {
  return { jobId, ...settings, phase: 'inspecting', fallbackCount: 0 };
}

export function acceptsJobEvent(activeJobId: string, eventJobId: string) {
  return activeJobId === eventJobId;
}

export type JobStateResult =
  | { ok: true; state: TranscriptionJobState }
  | { ok: false; error: string; state: TranscriptionJobState };

export function reduceJobState(state: TranscriptionJobState, event: TranscriptionEvent): JobStateResult {
  if (!acceptsJobEvent(state.jobId, event.jobId)) return { ok: false, error: 'stale-job-event', state };
  if (event.type === 'fallback') {
    if (state.phase !== 'transcribing' || event.from !== 'webgpu' || event.to !== 'wasm' || state.backend !== 'webgpu' || state.fallbackCount > 0) {
      return { ok: false, error: 'illegal-fallback', state };
    }
    return { ok: true, state: { ...state, phase: 'falling-back', backend: 'wasm', fallbackCount: 1 } };
  }
  if (!transitions[state.phase].includes(event.phase)) {
    return { ok: false, error: `illegal-transition:${state.phase}->${event.phase}`, state };
  }
  return { ok: true, state: { ...state, phase: event.phase } };
}

