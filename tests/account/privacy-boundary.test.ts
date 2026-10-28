import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthRequest } from '../../worker/auth.ts';
import type { Env } from '../../worker/env.ts';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function createInMemD1Env(): { env: Env; close: () => void } {
  const migrationPath = path.resolve(process.cwd(), 'migrations/0001_better_auth.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // In-memory SQLite compatibility database created self-contained inside the test
  const rawDb = new DatabaseSync(':memory:');
  rawDb.exec(sql);

  const realD1 = {
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

  return {
    env: {
      ASSETS: { fetch: async () => new Response('ok') } as any,
      DB: realD1 as any,
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-chars-long-1234567890',
      GOOGLE_CLIENT_ID: 'test-google-id',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
      APP_ORIGIN: 'http://localhost:3000',
    },
    close: () => rawDb.close(),
  };
}

test('privacy boundary: source code account feature tidak mengimpor store workspace lokal', () => {
  const accountDir = path.resolve(process.cwd(), 'src/features/account');
  const files = fs.readdirSync(accountDir);

  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    const content = fs.readFileSync(path.join(accountDir, file), 'utf8');

    // Rule local-first: Modul account tidak boleh membaca workspace-store, draft-store, atau audio files
    assert.equal(
      content.includes('workspace-store'),
      false,
      `Modul ${file} tidak boleh mengimpor workspace-store`
    );
    assert.equal(
      content.includes('draft-store'),
      false,
      `Modul ${file} tidak boleh mengimpor draft-store`
    );
    assert.equal(
      content.includes('indexedDB'),
      false,
      `Modul ${file} tidak boleh membaca indexedDB secara langsung`
    );
    assert.equal(
      content.includes('localStorage.setItem("catetin-token"'),
      false,
      `Modul ${file} tidak boleh menyimpan token ke localStorage`
    );
  }
});

test('privacy boundary: request account API tidak mengirim payload audio, naskah, atau rekaman', async () => {
  const { env, close } = createInMemD1Env();

  try {
    const req = new Request('http://localhost:3000/api/auth/get-session', { method: 'GET' });
    const res = await handleAuthRequest(req, env);

    assert.equal(res.status, 200);
    const bodyText = await res.text();

    // Pastikan tidak ada data workspace yang bocor dalam request/response
    assert.equal(bodyText.includes('audioFiles'), false);
    assert.equal(bodyText.includes('segments'), false);
    assert.equal(bodyText.includes('speakerNames'), false);
    assert.equal(bodyText.includes('projects'), false);
    assert.equal(bodyText.includes('folders'), false);
    assert.equal(bodyText.includes('recordings'), false);
  } finally {
    close();
  }
});

test('privacy boundary: worker account code tidak memuat referensi atau tabel workspace lokal', () => {
  const accountWorkerPath = path.resolve(process.cwd(), 'worker/account.ts');
  const content = fs.readFileSync(accountWorkerPath, 'utf8');

  assert.equal(content.includes('recordingId'), false, 'worker/account tidak boleh menerima recordingId');
  assert.equal(content.includes('projectId'), false, 'worker/account tidak boleh menerima projectId');
  assert.equal(content.includes('folderId'), false, 'worker/account tidak boleh menerima folderId');
  assert.equal(content.includes('transcriptText'), false, 'worker/account tidak boleh memproses transcriptText');
  assert.equal(content.includes('audioBuffer'), false, 'worker/account tidak boleh memproses audioBuffer');

  const entitlementWorkerPath = path.resolve(process.cwd(), 'worker/entitlement.ts');
  const entitlementContent = fs.readFileSync(entitlementWorkerPath, 'utf8');

  assert.equal(entitlementContent.includes('recordingId'), false, 'worker/entitlement tidak boleh menerima recordingId');
  assert.equal(entitlementContent.includes('transcriptText'), false, 'worker/entitlement tidak boleh memproses transcriptText');
  assert.equal(entitlementContent.includes('audioBuffer'), false, 'worker/entitlement tidak boleh memproses audioBuffer');
});

test('privacy boundary: pricing page tidak mengimpor store workspace lokal', () => {
  const pricingPagePath = path.resolve(process.cwd(), 'src/components/pricing/PricingPage.tsx');
  const content = fs.readFileSync(pricingPagePath, 'utf8');

  assert.equal(content.includes('workspace-store'), false, 'PricingPage tidak boleh mengimpor workspace-store');
  assert.equal(content.includes('draft-store'), false, 'PricingPage tidak boleh mengimpor draft-store');
  assert.equal(content.includes('indexedDB'), false, 'PricingPage tidak boleh membaca indexedDB');
});
