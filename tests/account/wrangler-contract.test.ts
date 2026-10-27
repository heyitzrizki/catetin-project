import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import worker from '../../worker/index.ts';
import type { Env } from '../../worker/env.ts';

test('wrangler.jsonc mengonfigurasi Cloudflare Assets binding dan Worker-first routing sempit', () => {
  const wranglerPath = path.resolve(process.cwd(), 'wrangler.jsonc');
  const content = fs.readFileSync(wranglerPath, 'utf8');

  // Parse JSONC (remove comments if any)
  const cleanJson = content.replace(/^\s*\/\/.*$/gm, '');
  const config = JSON.parse(cleanJson);

  assert.equal(config.main, 'worker/index.ts', 'Entrypoint worker harus mengarah ke worker/index.ts');
  assert.ok(config.assets, 'Konfigurasi assets harus tersedia');
  assert.equal(config.assets.binding, 'ASSETS', 'Assets harus memiliki binding: "ASSETS"');
  assert.equal(config.assets.directory, './dist');
  assert.equal(config.assets.not_found_handling, 'single-page-application');
  assert.deepEqual(config.assets.run_worker_first, ['/api/*'], 'Worker-first routing hanya untuk /api/*');
});

test('vite.config.ts mengonfigurasi proxy /api sempit menuju Wrangler dev di port 8787', () => {
  const vitePath = path.resolve(process.cwd(), 'vite.config.ts');
  const content = fs.readFileSync(vitePath, 'utf8');

  assert.ok(content.includes("'/api':"), 'Vite harus memiliki proxy untuk /api');
  assert.ok(content.includes("'http://localhost:8787'"), 'Target proxy harus http://localhost:8787');
  // Pastikan proxy tidak membocorkan data lokal selain /api
  assert.equal(content.includes("'/workspace'"), false);
  assert.equal(content.includes("'/audio'"), false);
});

test('kontrak router: non-api dialihkan ke env.ASSETS, unknown api mengembalikan 404', async () => {
  let assetFetchUrl = '';
  const mockEnv: Env = {
    ASSETS: {
      fetch: async (req: Request | string) => {
        assetFetchUrl = typeof req === 'string' ? req : req.url;
        return new Response('<!doctype html><html><body>Catetin SPA</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
    } as any,
    DB: {} as any,
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-chars-long-1234567890',
    GOOGLE_CLIENT_ID: 'test-id',
    GOOGLE_CLIENT_SECRET: 'test-sec',
    APP_ORIGIN: 'http://localhost:3000',
  };

  // 1. /studio -> SPA fallback via ASSETS
  const studioRes = await worker.fetch(new Request('http://localhost:3000/studio'), mockEnv, {} as any);
  assert.equal(studioRes.status, 200);
  assert.equal(studioRes.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.ok(assetFetchUrl.endsWith('/studio'));

  // 2. /api/health -> Worker direct 200 JSON
  const healthRes = await worker.fetch(new Request('http://localhost:3000/api/health'), mockEnv, {} as any);
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('content-type'), 'application/json');
  assert.deepEqual(await healthRes.json(), { ok: true });

  // 3. /api/unknown -> Worker direct 404 JSON
  const unkRes = await worker.fetch(new Request('http://localhost:3000/api/unknown-endpoint'), mockEnv, {} as any);
  assert.equal(unkRes.status, 404);
  assert.equal(unkRes.headers.get('content-type'), 'application/json');
  assert.deepEqual(await unkRes.json(), { error: 'not_found' });
});

