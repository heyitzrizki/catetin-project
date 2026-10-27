import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/index.ts';
import type { Env } from '../../worker/env.ts';

function createMockEnv(overrides?: Partial<Env>): Env {
  let assetFetchCalled = false;
  return {
    ASSETS: {
      fetch: async (req: Request | string) => {
        assetFetchCalled = true;
        return new Response('<!doctype html><html><body>Catetin Shell</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      },
    } as any,
    DB: {} as any,
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-chars-long-1234567890',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    APP_ORIGIN: 'http://localhost:3000',
    ...overrides,
  };
}

test('GET /api/health mengembalikan 200 { ok: true } tanpa membocorkan env/secret', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost:3000/api/health', { method: 'GET' });
  const res = await worker.fetch(req, env, {} as any);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
  const text = JSON.stringify(body);
  assert.equal(text.includes('test-secret'), false);
  assert.equal(text.includes('test-google'), false);
});

test('unknown /api/* mengembalikan status 404 dengan response JSON yang aman', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost:3000/api/unknown-endpoint', { method: 'GET' });
  const res = await worker.fetch(req, env, {} as any);

  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
});

test('request non-api dialihkan ke env.ASSETS.fetch untuk SPA dan aset statis', async () => {
  let assetFetchCount = 0;
  let requestedUrl = '';
  const env: Env = {
    ASSETS: {
      fetch: async (req: Request | string) => {
        assetFetchCount++;
        requestedUrl = typeof req === 'string' ? req : req.url;
        return new Response('ok', { status: 200 });
      },
    } as any,
    DB: {} as any,
    APP_ORIGIN: 'http://localhost:3000',
  };

  const req = new Request('http://localhost:3000/studio', { method: 'GET' });
  const res = await worker.fetch(req, env, {} as any);

  assert.equal(res.status, 200);
  assert.equal(assetFetchCount, 1);
  assert.equal(requestedUrl, 'http://localhost:3000/studio');
});

