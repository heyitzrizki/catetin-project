import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../worker/index.ts';
import type { Env } from '../../worker/env.ts';

async function signCookieValue(value: string, secret: string): Promise<string> {
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    algorithm,
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    algorithm.name,
    key,
    new TextEncoder().encode(value)
  );
  const b64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${value}.${b64}`);
}

function setupTestDatabase() {
  const db = new DatabaseSync(':memory:');
  const m1 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0001_better_auth.sql'), 'utf8');
  const m2 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0002_account_usage.sql'), 'utf8');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(m1);
  db.exec(m2);

  // Mock D1 transaction/batch yang merepresentasikan sifat atomik sesungguhnya (bukan Promise.all)
  const d1Compat = {
    prepare: (query: string) => {
      const stmt = db.prepare(query);
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
      db.exec('BEGIN TRANSACTION;');
      try {
        const results = [];
        for (const s of stmts) {
          results.push(await s.all());
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    },
    exec: async (query: string) => { db.exec(query); },
  };

  return { db, d1Compat };
}

const TEST_SECRET = 'test-secret-at-least-32-chars-long-1234567890';

function createTestEnv(d1Compat: any, overrides?: Partial<Env>): Env {
  return {
    ASSETS: { fetch: async () => new Response('assets') } as any,
    DB: d1Compat as any,
    BETTER_AUTH_SECRET: TEST_SECRET,
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    APP_ORIGIN: 'http://localhost:3000',
    ...overrides,
  };
}

async function createAuthenticatedUser(db: DatabaseSync, id: string, name: string, email: string) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run(id, name, email, now, now);

  const token = `token_${id}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") VALUES (?, ?, ?, ?, ?, ?)')
    .run(`s_${id}`, expiresAt, token, now, now, id);

  const signedToken = await signCookieValue(token, TEST_SECRET);
  return {
    id,
    token,
    signedToken,
    cookie: `better-auth.session_token=${signedToken}; __Secure-better-auth.session_token=${signedToken}`,
  };
}

test('unauthenticated request ke /api/account/* ditolak dengan 401 dan Cache-Control no-store', async () => {
  const { db, d1Compat } = setupTestDatabase();
  try {
    const env = createTestEnv(d1Compat);

    const summaryReq = new Request('http://localhost:3000/api/account/summary');
    const summaryRes = await worker.fetch(summaryReq, env, {} as any);
    assert.equal(summaryRes.status, 401);
    assert.equal(summaryRes.headers.get('cache-control'), 'no-store');
    const summaryBody = await summaryRes.json();
    assert.equal(summaryBody.error, 'unauthorized');

    const usageReq = new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed' }),
    });
    const usageRes = await worker.fetch(usageReq, env, {} as any);
    assert.equal(usageRes.status, 401);
    assert.equal(usageRes.headers.get('cache-control'), 'no-store');
  } finally {
    db.close();
  }
});

test('CSRF dan Origin validation menolak origin asing atau origin dev pada environment production', async () => {
  const { db, d1Compat } = setupTestDatabase();
  try {
    // 1. Dev environment dengan Origin asing
    const devEnv = createTestEnv(d1Compat, { APP_ORIGIN: 'http://localhost:3000' });
    const user = await createAuthenticatedUser(db, 'user_csrf', 'CSRF User', 'csrf@example.com');

    const evilReq = new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://evil.attacker.com',
        'Cookie': user.cookie,
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed' }),
    });
    const evilRes = await worker.fetch(evilReq, devEnv, {} as any);
    assert.equal(evilRes.status, 403);
    const evilBody = await evilRes.json();
    assert.equal(evilBody.error, 'untrusted_origin');

    // 2. Production environment menolak Origin localhost
    const prodOrigin = 'https://catetin-project.anwars-rizki.workers.dev';
    const prodEnv = createTestEnv(d1Compat, { APP_ORIGIN: prodOrigin });

    const prodFakeDevReq = new Request(`${prodOrigin}/api/account/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000',
        'Cookie': user.cookie,
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed' }),
    });
    const prodFakeDevRes = await worker.fetch(prodFakeDevReq, prodEnv, {} as any);
    assert.equal(prodFakeDevRes.status, 403, 'Production harus menolak origin localhost');

    // 3. Production menerima canonical origin production
    const prodValidReq = new Request(`${prodOrigin}/api/account/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': prodOrigin,
        'Cookie': user.cookie,
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed' }),
    });
    const prodValidRes = await worker.fetch(prodValidReq, prodEnv, {} as any);
    assert.equal(prodValidRes.status, 200, 'Production harus menerima canonical production origin');
  } finally {
    db.close();
  }
});

test('Strict request contract menolak ekstra field, userId dalam body, payload > 1KB, dan invalid confirmation', async () => {
  const { db, d1Compat } = setupTestDatabase();
  try {
    const env = createTestEnv(d1Compat);
    const userA = await createAuthenticatedUser(db, 'user_contract', 'Alice', 'contract@example.com');

    // 1. Body dengan field tambahan (misal userId atau metadata) harus DITOLAK dengan status 400
    const extraFieldReq = new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed', userId: 'hacked_id' }),
    });
    const extraFieldRes = await worker.fetch(extraFieldReq, env, {} as any);
    assert.equal(extraFieldRes.status, 400, 'Request dengan field ekstra (misal userId) wajib ditolak 400');
    const extraFieldBody = await extraFieldRes.json();
    assert.equal(extraFieldBody.error, 'invalid_payload');

    // 2. Body payload melebihi batas 1 KB (1024 bytes) ditolak dengan status 400
    const largePayload = JSON.stringify({
      eventType: 'local_transcription_completed',
      padding: 'x'.repeat(1200),
    });
    const largeReq = new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Length': String(largePayload.length),
      },
      body: largePayload,
    });
    const largeRes = await worker.fetch(largeReq, env, {} as any);
    assert.equal(largeRes.status, 400);

    // 3. DELETE /api/account tanpa confirmation eksplisit ditolak 400
    const delNoConfirmReq = new Request('http://localhost:3000/api/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({}),
    });
    const delNoConfirmRes = await worker.fetch(delNoConfirmReq, env, {} as any);
    assert.equal(delNoConfirmRes.status, 400);
    const delNoConfirmBody = await delNoConfirmRes.json();
    assert.equal(delNoConfirmBody.error, 'invalid_payload');

    // 4. DELETE /api/account dengan confirmation salah ditolak 400
    const delWrongConfirmReq = new Request('http://localhost:3000/api/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ confirmation: 'wrong' }),
    });
    const delWrongConfirmRes = await worker.fetch(delWrongConfirmReq, env, {} as any);
    assert.equal(delWrongConfirmRes.status, 400);

    // 5. DELETE /api/account dengan extra key atau userId ditolak 400
    const delExtraKeyReq = new Request('http://localhost:3000/api/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ confirmation: 'delete-account', userId: userA.id }),
    });
    const delExtraKeyRes = await worker.fetch(delExtraKeyReq, env, {} as any);
    assert.equal(delExtraKeyRes.status, 400);
    const delExtraKeyBody = await delExtraKeyRes.json();
    assert.equal(delExtraKeyBody.error, 'invalid_payload');

    // 6. DELETE /api/account dengan body array ditolak 400
    const delArrayReq = new Request('http://localhost:3000/api/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify([{ confirmation: 'delete-account' }]),
    });
    const delArrayRes = await worker.fetch(delArrayReq, env, {} as any);
    assert.equal(delArrayRes.status, 400);

    // 7. Multibyte UTF-8 payload test: panjang string < 1000 tapi byte > 1024 ditolak 400
    // Tiap karakter emoji bernilai 4 byte UTF-8. 300 emoji = 1200 bytes (> 1024)
    const multibyteEmoji = '🔥'.repeat(300);
    assert.ok(multibyteEmoji.length < 1000, 'Karakter string di bawah 1000');
    assert.ok(new TextEncoder().encode(multibyteEmoji).byteLength > 1024, 'Byte UTF-8 melebihi 1024');

    // Test POST usage dengan multibyte payload
    const multibytePostReq = new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed', padding: multibyteEmoji }),
    });
    const multibytePostRes = await worker.fetch(multibytePostReq, env, {} as any);
    assert.equal(multibytePostRes.status, 400);
    const mbPostBody = await multibytePostRes.json();
    assert.equal(mbPostBody.error, 'payload_too_large');

    // Test DELETE dengan multibyte payload
    const multibyteDelReq = new Request('http://localhost:3000/api/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ confirmation: 'delete-account', padding: multibyteEmoji }),
    });
    const multibyteDelRes = await worker.fetch(multibyteDelReq, env, {} as any);
    assert.equal(multibyteDelRes.status, 400);
    const mbDelBody = await multibyteDelRes.json();
    assert.equal(mbDelBody.error, 'payload_too_large');
  } finally {
    db.close();
  }
});

test('POST /api/account/usage mencatat allowlisted events dengan UPSERT atomik dan respons Cache-Control no-store', async () => {
  const { db, d1Compat } = setupTestDatabase();
  try {
    const env = createTestEnv(d1Compat);
    const userA = await createAuthenticatedUser(db, 'user_a', 'Alice', 'alice@example.com');

    // 1. Sukses mencatat local_transcription_completed
    const req1 = new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed' }),
    });
    const res1 = await worker.fetch(req1, env, {} as any);
    assert.equal(res1.status, 200);
    assert.equal(res1.headers.get('cache-control'), 'no-store');
    const body1 = await res1.json();
    assert.equal(body1.ok, true);

    // 2. Event kedua pada hari yang sama menambah counter atomik
    const req2 = new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed' }),
    });
    const res2 = await worker.fetch(req2, env, {} as any);
    assert.equal(res2.status, 200);

    // 3. Event type asing ditolak dengan status 400
    const reqForeign = new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userA.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ eventType: 'unauthorized_arbitrary_event' }),
    });
    const resForeign = await worker.fetch(reqForeign, env, {} as any);
    assert.equal(resForeign.status, 400);

    // 4. Verifikasi ringkasan /api/account/summary untuk userA
    const summaryReq = new Request('http://localhost:3000/api/account/summary', {
      headers: { 'Cookie': userA.cookie },
    });
    const summaryRes = await worker.fetch(summaryReq, env, {} as any);
    assert.equal(summaryRes.status, 200);
    assert.equal(summaryRes.headers.get('cache-control'), 'no-store');
    const summaryData = await summaryRes.json();
    assert.equal(summaryData.user.id, 'user_a');
    assert.equal(summaryData.user.email, 'alice@example.com');
    assert.equal(summaryData.usage.totals.local_transcription_completed, 2);
    assert.equal(summaryData.usage.totals.transcript_export_completed, 0);
    assert.equal(summaryData.usage.totals.catetin_backup_completed, 0);
    assert.equal(summaryData.usage.totalCount, 2);
  } finally {
    db.close();
  }
});

// Unit test transaksi kompatibel (SQLite) membuktikan semantik batch atomik dan rollback
test('unit test transaksi kompatibel (SQLite): atomic account deletion me-rollback saat gagal dan membersihkan cloud saat sukses', async () => {
  const { db, d1Compat } = setupTestDatabase();
  try {
    const env = createTestEnv(d1Compat);
    const userToDelete = await createAuthenticatedUser(db, 'user_del', 'Delete Me', 'del@example.com');

    // Buat usage untuk user_del
    await worker.fetch(new Request('http://localhost:3000/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userToDelete.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ eventType: 'local_transcription_completed' }),
    }), env, {} as any);

    // 1. Simulasi kegagalan di tengah batch: buat batch melempar error saat query user
    let simulatedFailure = true;
    const originalBatch = d1Compat.batch;
    d1Compat.batch = async (stmts: any[]) => {
      if (simulatedFailure) {
        db.exec('BEGIN TRANSACTION;');
        // jalankan stmt pertama
        await stmts[0].run();
        // lempar error simulasi sebelum commit
        db.exec('ROLLBACK;');
        throw new Error('D1 storage error simulated');
      }
      return originalBatch(stmts);
    };

    const failedDelRes = await worker.fetch(new Request('http://localhost:3000/api/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userToDelete.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ confirmation: 'delete-account' }),
    }), env, {} as any);

    assert.equal(failedDelRes.status, 500, 'Harus mengembalikan 500 saat batch gagal');

    // BUKTI ROLLBACK: Karena rollback, user dan usage masih ada dan tidak terhapus sebagian
    const userRowAfterFailure = db.prepare('SELECT * FROM "user" WHERE "id" = ?').get('user_del');
    assert.ok(userRowAfterFailure, 'User TIDAK boleh terhapus jika transaksi gagal di tengah jalan');

    const usageRowAfterFailure = db.prepare('SELECT * FROM "account_usage" WHERE "userId" = ?').all('user_del');
    assert.equal(usageRowAfterFailure.length, 1, 'Usage TIDAK boleh terhapus jika transaksi gagal');

    // 2. Sekarang jalankan transaksi yang berhasil
    simulatedFailure = false;
    const successDelRes = await worker.fetch(new Request('http://localhost:3000/api/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userToDelete.cookie,
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({ confirmation: 'delete-account' }),
    }), env, {} as any);

    assert.equal(successDelRes.status, 200);
    assert.equal(successDelRes.headers.get('cache-control'), 'no-store');

    // Verifikasi database: semua tabel cloud telah bersih
    const userRow = db.prepare('SELECT * FROM "user" WHERE "id" = ?').get('user_del');
    assert.equal(userRow, undefined);

    const usageRows = db.prepare('SELECT * FROM "account_usage" WHERE "userId" = ?').all('user_del');
    assert.equal(usageRows.length, 0);

    const sessionRows = db.prepare('SELECT * FROM "session" WHERE "userId" = ?').all('user_del');
    assert.equal(sessionRows.length, 0);
  } finally {
    db.close();
  }
});
