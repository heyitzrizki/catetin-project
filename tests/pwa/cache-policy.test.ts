import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheKeyForRequest, classifyRequest, extractBuildAssets, obsoleteAppCaches, prepareCacheWrite } from '../../public/sw-policy.js';

const origin = 'https://catetin.example';

test('uses network first for navigations and non-hashed app files', () => {
  assert.equal(classifyRequest(`${origin}/studio`, 'navigate', origin), 'network-first');
  assert.equal(classifyRequest(`${origin}/index.html`, 'same-origin', origin), 'network-first');
  assert.equal(classifyRequest(`${origin}/sw.js`, 'same-origin', origin), 'network-first');
  assert.equal(classifyRequest(`${origin}/sw-policy.js`, 'same-origin', origin), 'network-first');
  assert.equal(classifyRequest(`${origin}/manifest.webmanifest`, 'same-origin', origin), 'network-first');
});

test('uses cache first only for content-addressed build assets', () => {
  assert.equal(classifyRequest(`${origin}/assets/index-aXGiw89X.js`, 'same-origin', origin), 'cache-first');
  assert.equal(classifyRequest(`${origin}/assets/font-Cg2kxhWu.woff2`, 'same-origin', origin), 'cache-first');
  assert.equal(classifyRequest(`${origin}/assets/transcription.worker.js`, 'same-origin', origin), 'network-first');
});

test('bypasses app cache for cross-origin model and CDN requests', () => {
  assert.equal(classifyRequest('https://huggingface.co/model.onnx', 'cors', origin), 'bypass');
  assert.equal(classifyRequest('https://cdn.jsdelivr.net/runtime.wasm', 'cors', origin), 'bypass');
});

test('removes only obsolete Catetin app caches', () => {
  assert.deepEqual(obsoleteAppCaches(
    ['catetin-app-v1', 'catetin-app-v2', 'unrelated-cache'],
    'catetin-app-v2',
  ), ['catetin-app-v1']);
});

test('extracts content-addressed scripts and styles needed by the offline shell', () => {
  const html = `<!doctype html><script type="module" src="/assets/index-aXGiw89X.js"></script>
    <link rel="stylesheet" href="/assets/index-CAOFUL5M.css">
    <link rel="icon" href="/icon.svg"><script src="https://other.example/app-12345678.js"></script>`;
  assert.deepEqual(extractBuildAssets(html, origin), [
    '/assets/index-aXGiw89X.js',
    '/assets/index-CAOFUL5M.css',
  ]);
});

test('clones a cacheable response before its original body is consumed', async () => {
  const response = new Response('bundle-content', { status: 200 });
  const prepared = prepareCacheWrite(response);
  assert.ok(prepared);
  assert.equal(await response.text(), 'bundle-content');
  assert.equal(await prepared?.cacheCopy.text(), 'bundle-content');
});

test('uses one canonical cache key for the same content-addressed asset', () => {
  assert.equal(cacheKeyForRequest(`${origin}/assets/index-aXGiw89X.js?ignored=1`, origin), '/assets/index-aXGiw89X.js');
  assert.equal(cacheKeyForRequest(`${origin}/index.html`, origin), `${origin}/index.html`);
});
