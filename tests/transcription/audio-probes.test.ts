import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateProbeVerdict, validateProbeResult, type AudioPreparationProbeResult } from '../../spikes/audio-chunking/probes';

function validProbe(overrides: Partial<AudioPreparationProbeResult> = {}): AudioPreparationProbeResult {
  return {
    browser: { name: 'Chrome', version: '156.0.8078.47', os: 'Windows 11' },
    deviceClass: 'desktop',
    media: { codec: 'pcm-s16le', container: 'wav', durationSeconds: 120, fileSizeBytes: 3_840_044 },
    route: 'pcm-wav-blob-slice',
    retainsFullFileBytes: false,
    retainsFullDecodedPcm: false,
    chunkDurationSeconds: 30,
    overlapSeconds: 5,
    maxSimultaneousNormalizedPcmSeconds: 35,
    liveNormalizedChunkBuffers: 1,
    completed: true,
    failureCategory: null,
    memory: { status: 'measured', peakBytes: 2_240_000 },
    ...overrides,
  };
}

test('accepts a complete reproducible probe record', () => {
  assert.deepEqual(validateProbeResult(validProbe()), []);
  assert.equal(evaluateProbeVerdict(validProbe()), 'bounded');
});

test('requires exact environment, media, route, completion, and memory evidence', () => {
  const invalid = validProbe({
    browser: { name: '', version: '', os: '' },
    media: { codec: '', container: '', durationSeconds: 0, fileSizeBytes: 0 },
    route: '',
    failureCategory: 'decode-error',
    memory: { status: 'unavailable', reason: '' },
  });
  assert.deepEqual(validateProbeResult(invalid), [
    'browser.name', 'browser.version', 'browser.os', 'media.codec', 'media.container',
    'media.durationSeconds', 'media.fileSizeBytes', 'route', 'memory.reason',
  ]);
});

test('does not label whole-file decoded PCM as bounded', () => {
  assert.equal(evaluateProbeVerdict(validProbe({ retainsFullDecodedPcm: true })), 'unbounded');
  assert.equal(evaluateProbeVerdict(validProbe({ retainsFullFileBytes: true })), 'unbounded');
});

test('does not label multiple live chunks or an oversized live window as bounded', () => {
  assert.equal(evaluateProbeVerdict(validProbe({ liveNormalizedChunkBuffers: 2 })), 'unbounded');
  assert.equal(evaluateProbeVerdict(validProbe({ maxSimultaneousNormalizedPcmSeconds: 36 })), 'unbounded');
});

test('reports unavailable when the route cannot complete or memory cannot be observed', () => {
  assert.equal(evaluateProbeVerdict(validProbe({ completed: false, failureCategory: 'demux-unavailable' })), 'unavailable');
  assert.equal(evaluateProbeVerdict(validProbe({ memory: { status: 'unavailable', reason: 'browser-api-missing' } })), 'unavailable');
});
