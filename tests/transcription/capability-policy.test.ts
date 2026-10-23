import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDevice, createCapabilityPolicy, verifyWebGpu, type DeviceSignals } from '../../src/features/transcription/capability-policy';

const desktop: DeviceSignals = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0, mobile: false };

test('classifies phones, iPad desktop mode, touch laptops, and ambiguous handhelds safely', () => {
  assert.equal(classifyDevice({ userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5, mobile: true }).class, 'phone');
  assert.equal(classifyDevice({ userAgent: 'Android Mobile', platform: 'Linux armv8', maxTouchPoints: 5, mobile: true }).class, 'phone');
  assert.equal(classifyDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5, mobile: false }).class, 'tablet');
  assert.equal(classifyDevice({ ...desktop, maxTouchPoints: 10 }).class, 'desktop');
  assert.equal(classifyDevice({ userAgent: 'Foldable', platform: 'Linux', maxTouchPoints: 5 }).class, 'phone');
});

test('does not use viewport width to classify device safety', () => {
  assert.equal(classifyDevice({ ...desktop, viewportWidth: 320 }).class, 'desktop');
  assert.equal(classifyDevice({ ...desktop, viewportWidth: 1920 }).class, 'desktop');
});

test('locks phones and unknown devices to tiny', () => {
  const phone = createCapabilityPolicy({ device: { class: 'phone', reason: 'mobile-signal' }, webGpu: { available: true, reason: 'adapter-ready' } });
  const unknown = createCapabilityPolicy({ device: { class: 'unknown', reason: 'unrecognized' }, webGpu: { available: false, reason: 'missing-api' } });
  assert.deepEqual(phone.allowedModels, ['tiny']);
  assert.equal(phone.recommendedModel, 'tiny');
  assert.deepEqual(unknown.allowedModels, ['tiny']);
});

test('verifies a real adapter before preferring webgpu', async () => {
  assert.deepEqual(await verifyWebGpu(undefined), { available: false, reason: 'missing-api' });
  assert.deepEqual(await verifyWebGpu({ requestAdapter: async () => null }), { available: false, reason: 'adapter-unavailable' });
  const ready = await verifyWebGpu({ requestAdapter: async () => ({}) });
  assert.deepEqual(ready, { available: true, reason: 'adapter-ready' });
  const policy = createCapabilityPolicy({ device: classifyDevice(desktop), webGpu: ready });
  assert.equal(policy.preferredBackend, 'webgpu');
  assert.equal(policy.fallbackBackend, 'wasm');
});

test('uses wasm only when adapter request rejects', async () => {
  const webGpu = await verifyWebGpu({ requestAdapter: async () => { throw new Error('blocked'); } });
  const policy = createCapabilityPolicy({ device: classifyDevice(desktop), webGpu });
  assert.equal(policy.preferredBackend, 'wasm');
  assert.equal(policy.fallbackBackend, null);
});
