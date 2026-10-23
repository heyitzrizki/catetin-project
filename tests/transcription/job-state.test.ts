import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsJobEvent, initialJobState, reduceJobState } from '../../src/features/transcription/job-state';

const settings = { model: 'tiny' as const, language: 'id' as const, backend: 'webgpu' as const };

test('follows the legal successful job path', () => {
  let state = initialJobState('job-1', settings);
  for (const phase of ['preparing-model', 'preparing-audio', 'transcribing', 'merging', 'checkpointing', 'complete'] as const) {
    const result = reduceJobState(state, { type: 'advance', jobId: 'job-1', phase });
    assert.equal(result.ok, true);
    if (result.ok) state = result.state;
  }
  assert.equal(state.phase, 'complete');
});

test('rejects an illegal transition without mutating state', () => {
  const state = initialJobState('job-1', settings);
  const result = reduceJobState(state, { type: 'advance', jobId: 'job-1', phase: 'complete' });
  assert.deepEqual(result, { ok: false, error: 'illegal-transition:inspecting->complete', state });
});

test('ignores an event from an obsolete job id', () => {
  assert.equal(acceptsJobEvent('job-current', 'job-old'), false);
  const state = initialJobState('job-current', settings);
  const result = reduceJobState(state, { type: 'advance', jobId: 'job-old', phase: 'preparing-model' });
  assert.deepEqual(result, { ok: false, error: 'stale-job-event', state });
});

test('records one webgpu to wasm fallback', () => {
  let state = initialJobState('job-1', settings);
  for (const phase of ['preparing-model', 'preparing-audio', 'transcribing'] as const) {
    const result = reduceJobState(state, { type: 'advance', jobId: 'job-1', phase });
    assert.equal(result.ok, true);
    if (result.ok) state = result.state;
  }
  const fallback = reduceJobState(state, { type: 'fallback', jobId: 'job-1', from: 'webgpu', to: 'wasm', attempt: 1 });
  assert.equal(fallback.ok, true);
  if (!fallback.ok) return;
  assert.equal(fallback.state.phase, 'falling-back');
  assert.equal(fallback.state.backend, 'wasm');
  assert.equal(fallback.state.fallbackCount, 1);
  const again = reduceJobState(fallback.state, { type: 'fallback', jobId: 'job-1', from: 'webgpu', to: 'wasm', attempt: 1 });
  assert.equal(again.ok, false);
});

test('never permits wasm to webgpu fallback', () => {
  const state = initialJobState('job-1', { ...settings, backend: 'wasm' });
  const result = reduceJobState(state, { type: 'fallback', jobId: 'job-1', from: 'wasm', to: 'webgpu', attempt: 1 });
  assert.equal(result.ok, false);
});
