import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthRequest } from '../../worker/auth.ts';
import {
  configurationProblem,
  DEV_ORIGINS,
  PROD_ORIGIN,
  getTrustedOrigins,
  isOriginAllowed,
  isRedirectAllowed,
  normalizeOrigin,
} from '../../worker/http.ts';
import worker from '../../worker/index.ts';
import type { Env } from '../../worker/env.ts';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';

function createMockEnv(overrides?: Partial<Env>): Env {
  const mockD1 = {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        all: async () => ({ results: [], meta: {} }),
        run: async () => ({ results: [], meta: {} }),
      }),
      all: async () => ({ results: [], meta: {} }),
      run: async () => ({ results: [], meta: {} }),
    }),
    batch: async () => [],
    exec: async () => {},
  };

  return {
    ASSETS: { fetch: async () => new Response('assets') } as any,
    DB: mockD1 as any,
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-chars-long-1234567890',
    GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'GOCSPX-test-client-secret-value-12345',
    APP_ORIGIN: 'http://localhost:3000',
    ...overrides,
  };
}

test('configurationProblem mendeteksi secret di bawah 32 karakter dan key hilang tanpa membocorkan nilai rahasia', () => {
  const completeEnv = createMockEnv();
  assert.equal(configurationProblem(completeEnv), null);

  // Secret 16-31 karakter harus ditolak
  const secret16 = createMockEnv({ BETTER_AUTH_SECRET: '1234567890123456' }); // 16 chars
  assert.ok(problemContains(configurationProblem(secret16), 'BETTER_AUTH_SECRET'));

  const secret31 = createMockEnv({ BETTER_AUTH_SECRET: '1234567890123456789012345678901' }); // 31 chars
  assert.ok(problemContains(configurationProblem(secret31), 'BETTER_AUTH_SECRET'));

  // Secret 32 karakter harus diterima
  const secret32 = createMockEnv({ BETTER_AUTH_SECRET: '12345678901234567890123456789012' }); // 32 chars
  assert.equal(configurationProblem(secret32), null);

  const missingSecret = createMockEnv({ BETTER_AUTH_SECRET: undefined });
  assert.ok(problemContains(configurationProblem(missingSecret), 'BETTER_AUTH_SECRET'));

  const missingGoogle = createMockEnv({ GOOGLE_CLIENT_SECRET: undefined });
  assert.ok(problemContains(configurationProblem(missingGoogle), 'GOOGLE_CLIENT_SECRET'));

  const missingDb = createMockEnv({ DB: undefined as any });
  assert.ok(problemContains(configurationProblem(missingDb), 'DB'));

  const missingAppOrigin = createMockEnv({ APP_ORIGIN: undefined });
  assert.ok(problemContains(configurationProblem(missingAppOrigin), 'APP_ORIGIN'));

  const invalidAppOrigin = createMockEnv({ APP_ORIGIN: 'not-a-valid-url' });
  assert.ok(problemContains(configurationProblem(invalidAppOrigin), 'APP_ORIGIN'));
});

function problemContains(msg: string | null, field: string): boolean {
  return typeof msg === 'string' && msg.includes(field);
}

test('pemisahan trusted origins: production hanya mempercayai canonical production origin, dev mempercayai localhost', () => {
  // Production
  const prodTrusted = getTrustedOrigins(PROD_ORIGIN);
  assert.deepEqual(prodTrusted, [PROD_ORIGIN]);
  assert.equal(isOriginAllowed('http://localhost:3000', PROD_ORIGIN), false);
  assert.equal(isOriginAllowed('http://localhost:8787', PROD_ORIGIN), false);
  assert.equal(isOriginAllowed('https://evil.example.com', PROD_ORIGIN), false);
  assert.equal(isOriginAllowed(PROD_ORIGIN, PROD_ORIGIN), true);
  assert.equal(isOriginAllowed(`${PROD_ORIGIN}/`, PROD_ORIGIN), true);

  // Development
  const devTrusted = getTrustedOrigins('http://localhost:3000');
  assert.ok(devTrusted.includes('http://localhost:3000'));
  assert.ok(devTrusted.includes('http://127.0.0.1:3000'));
  assert.ok(devTrusted.includes('http://localhost:8787'));
  assert.equal(devTrusted.includes('https://evil.example.com'), false);
});

test('isRedirectAllowed menolak callback absolut yang tidak sesuai dengan active canonical APP_ORIGIN', () => {
  // Production context
  assert.equal(isRedirectAllowed('/studio', PROD_ORIGIN), true, 'Relative path selalu diizinkan');
  assert.equal(isRedirectAllowed(`${PROD_ORIGIN}/studio`, PROD_ORIGIN), true, 'Canonical production origin diizinkan');
  assert.equal(isRedirectAllowed('http://localhost:3000/studio', PROD_ORIGIN), false, 'Production harus menolak localhost:3000');
  assert.equal(isRedirectAllowed('http://localhost:8787/api/auth/callback/google', PROD_ORIGIN), false, 'Production harus menolak localhost:8787');
  assert.equal(isRedirectAllowed('https://malicious.com/callback', PROD_ORIGIN), false, 'Production harus menolak domain eksternal');
  assert.equal(isRedirectAllowed('//evil.com/fake', PROD_ORIGIN), false, 'Protocol-relative harus ditolak');

  // Development context
  const devOrigin = 'http://localhost:3000';
  assert.equal(isRedirectAllowed('/studio', devOrigin), true);
  assert.equal(isRedirectAllowed('http://localhost:3000/studio', devOrigin), true);
  assert.equal(isRedirectAllowed('http://localhost:8787/studio', devOrigin), false, 'Redirect absolut harus sama persis dengan canonical APP_ORIGIN');
  assert.equal(isRedirectAllowed('https://malicious.com/callback', devOrigin), false);
});

test('handleAuthRequest mengembalikan 500 JSON yang aman saat konfigurasi tidak lengkap', async () => {
  const brokenEnv = createMockEnv({ BETTER_AUTH_SECRET: undefined });
  const req = new Request('http://localhost:3000/api/auth/get-session', { method: 'GET' });
  const res = await handleAuthRequest(req, brokenEnv);

  assert.equal(res.status, 500);
  assert.equal(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assert.equal(body.error, 'configuration_error');
  assert.equal(JSON.stringify(body).includes('test-secret'), false);
});

test('handleAuthRequest menolak origin yang tidak ada di allowlist dengan status 403', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost:3000/api/auth/sign-in/social', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://malicious-site.example.com',
    },
    body: JSON.stringify({ provider: 'google' }),
  });
  const res = await handleAuthRequest(req, env);

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'untrusted_origin');
});

test('handleAuthRequest menolak untrusted callbackURL pada query atau body dengan status 403', async () => {
  const env = createMockEnv();

  // Untrusted callback in query
  const queryReq = new Request('http://localhost:3000/api/auth/sign-in/social?callbackURL=https://evil.com/steal-token', {
    method: 'GET',
  });
  const queryRes = await handleAuthRequest(queryReq, env);
  assert.equal(queryRes.status, 403);
  const queryBody = await queryRes.json();
  assert.equal(queryBody.error, 'untrusted_redirect');

  // Untrusted callback in JSON body
  const bodyReq = new Request('http://localhost:3000/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: 'https://evil.com/stolen' }),
  });
  const bodyRes = await handleAuthRequest(bodyReq, env);
  assert.equal(bodyRes.status, 403);
  const bodyJson = await bodyRes.json();
  assert.equal(bodyJson.error, 'untrusted_redirect');
});

test('perketat route boundary: /api/authenticity tidak masuk ke Better Auth dan mengembalikan JSON 404', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost:3000/api/authenticity', { method: 'GET' });
  const res = await worker.fetch(req, env, {} as any);

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'not_found');
});

test('file migrasi D1 hanya memuat tabel akun Better Auth dan tidak memuat konten workspace Catetin', () => {
  const migrationPath = path.resolve(process.cwd(), 'migrations/0001_better_auth.sql');
  assert.ok(fs.existsSync(migrationPath), 'migrations/0001_better_auth.sql harus ada');

  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
  assert.ok(sql.includes('create table if not exists "user"') || sql.includes('create table "user"') || sql.includes('create table user'));
  assert.ok(sql.includes('session'));
  assert.ok(sql.includes('account'));
  assert.ok(sql.includes('verification'));

  // Local-first data boundary: tidak boleh ada tabel konten workspace Catetin
  assert.equal(/\bcreate\s+table.*recording\b/i.test(sql), false);
  assert.equal(/\bcreate\s+table.*transcript\b/i.test(sql), false);
  assert.equal(/\bcreate\s+table.*project\b/i.test(sql), false);
  assert.equal(/\bcreate\s+table.*folder\b/i.test(sql), false);
  assert.equal(/\bcreate\s+table.*audio\b/i.test(sql), false);
  assert.equal(/\bcreate\s+table.*tag\b/i.test(sql), false);
});

test('compatibility integration: Better Auth schema validation default berjalan sukses terhadap SQLite in-memory yang dimigrasi dari 0001_better_auth.sql', async () => {
  const migrationPath = path.resolve(process.cwd(), 'migrations/0001_better_auth.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Database SQLite temporary in-memory: self-contained, tidak bergantung pada .wrangler/state (aman untuk CI & fresh clone)
  const rawDb = new DatabaseSync(':memory:');

  try {
    rawDb.exec(sql);

    // D1 compatibility adapter untuk membuktikan kompatibilitas skema SQLite/D1
    const d1Compat = {
      prepare: (query: string) => {
        const stmt = rawDb.prepare(query);
        return {
          bind: (...values: any[]) => ({
            all: async () => ({ results: stmt.all(...values), meta: {} }),
            run: async () => {
              stmt.run(...values);
              return { results: [], meta: {} };
            },
          }),
          all: async () => ({ results: stmt.all(), meta: {} }),
          run: async () => {
            stmt.run();
            return { results: [], meta: {} };
          },
        };
      },
      batch: async (stmts: any[]) => {
        return Promise.all(stmts.map(s => s.all()));
      },
      exec: async (query: string) => {
        rawDb.exec(query);
      },
    };

    // Jalankan Better Auth dengan schema validation default aktif (validateSchema: true / default)
    const auth = betterAuth({
      database: d1Compat as any,
      secret: 'test-secret-at-least-32-chars-long-1234567890',
      baseURL: 'http://localhost:3000',
      socialProviders: {
        google: {
          clientId: 'test-google-id',
          clientSecret: 'test-google-sec',
        },
      },
    });

    const res = await auth.handler(new Request('http://localhost:3000/api/auth/get-session'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body, null);
  } finally {
    // Bersihkan resource database setelah test
    rawDb.close();
  }
});
