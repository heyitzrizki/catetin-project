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
  const m3 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0003_account_entitlement.sql'), 'utf8');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(m1);
  db.exec(m2);
  db.exec(m3);

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
    GOOGLE_CLIENT_ID: 'test-google-id',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
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

test('1. API: unauthenticated request ke /api/account/entitlement ditolak 401 dengan no-store', async () => {
  const { db, d1Compat } = setupTestDatabase();
  const env = createTestEnv(d1Compat);

  try {
    const req = new Request('http://localhost:3000/api/account/entitlement', {
      method: 'GET',
    });
    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('Vary'), 'Cookie, Origin');
    const json = await res.json() as any;
    assert.equal(json.error, 'unauthorized');
  } finally {
    db.close();
  }
});
test('2. API: user tanpa row entitlement menerima plan Free secara otomatis', async () => {
  const { db, d1Compat } = setupTestDatabase();
  const env = createTestEnv(d1Compat);

  try {
    const authUser = await createAuthenticatedUser(db, 'u_free_user', 'Free User', 'free@example.com');

    const req = new Request('http://localhost:3000/api/account/entitlement', {
      method: 'GET',
      headers: {
        'Cookie': authUser.cookie,
      },
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    const json = await res.json() as any;
    assert.equal(json.plan, 'free');
    assert.equal(json.status, 'none');
    assert.ok(Array.isArray(json.features));
    assert.ok(json.features.includes('local_workspace'));
    assert.ok(json.serverNow);
  } finally {
    db.close();
  }
});
test('3. API: user Pro menerima plan Pro dengan startsAt dan status yang valid', async () => {
  const { db, d1Compat } = setupTestDatabase();
  const env = createTestEnv(d1Compat);

  try {
    const authUser = await createAuthenticatedUser(db, 'u_pro_user', 'Pro User', 'pro@example.com');
    const now = new Date().toISOString();
    const endsAt = new Date(Date.now() + 30 * 86400000).toISOString();

    db.prepare(`
      INSERT INTO "account_entitlement" ("userId", "plan", "status", "source", "startsAt", "endsAt", "createdAt", "updatedAt")
      VALUES (?, 'pro', 'active', 'promotion', ?, ?, ?, ?)
    `).run(authUser.id, now, endsAt, now, now);

    const req = new Request('http://localhost:3000/api/account/entitlement', {
      method: 'GET',
      headers: {
        'Cookie': authUser.cookie,
      },
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 200);
    const json = await res.json() as any;
    assert.equal(json.plan, 'pro');
    assert.equal(json.status, 'active');
    assert.equal(json.source, 'promotion');
    assert.equal(json.endsAt, endsAt);
  } finally {
    db.close();
  }
});
test('4. API: isolasi entitlement antar pengguna (User B tidak dapat membaca Pro milik User A)', async () => {
  const { db, d1Compat } = setupTestDatabase();
  const env = createTestEnv(d1Compat);

  try {
    const userA = await createAuthenticatedUser(db, 'u_A', 'User A', 'usera@example.com');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO "account_entitlement" ("userId", "plan", "status", "source", "startsAt", "endsAt", "createdAt", "updatedAt")
      VALUES (?, 'pro', 'active', 'promotion', ?, null, ?, ?)
    `).run(userA.id, now, now, now);

    const userB = await createAuthenticatedUser(db, 'u_B', 'User B', 'userb@example.com');

    // User B tries to spoof user A by passing query string
    const req = new Request('http://localhost:3000/api/account/entitlement?userId=u_A', {
      method: 'GET',
      headers: {
        'Cookie': userB.cookie,
      },
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 200);
    const json = await res.json() as any;
    // Must strictly return User B's entitlement (Free), query parameter must be completely ignored
    assert.equal(json.plan, 'free');
    assert.equal(json.status, 'none');
  } finally {
    db.close();
  }
});
test('5. API: tidak ada endpoint mutasi untuk entitlement (POST, PUT, DELETE ditolak 405)', async () => {
  const { db, d1Compat } = setupTestDatabase();
  const env = createTestEnv(d1Compat);

  try {
    const authUser = await createAuthenticatedUser(db, 'u_mut_1', 'Mut User', 'mut@example.com');

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const req = new Request('http://localhost:3000/api/account/entitlement', {
        method,
        headers: {
          'Cookie': authUser.cookie,
          'Origin': 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan: 'pro' }),
      });
      const res = await worker.fetch(req, env, {} as any);
      assert.equal(res.status, 405, `Method ${method} harus ditolak dengan 405`);
    }
  } finally {
    db.close();
  }
});
test('6. API: DELETE /api/account membersihkan row account_entitlement secara atomik', async () => {
  const { db, d1Compat } = setupTestDatabase();
  const env = createTestEnv(d1Compat);

  try {
    const authUser = await createAuthenticatedUser(db, 'u_del_1', 'Del User', 'del@example.com');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO "account_entitlement" ("userId", "plan", "status", "source", "startsAt", "endsAt", "createdAt", "updatedAt")
      VALUES (?, 'pro', 'active', 'promotion', ?, null, ?, ?)
    `).run(authUser.id, now, now, now);

    const req = new Request('http://localhost:3000/api/account', {
      method: 'DELETE',
      headers: {
        'Cookie': authUser.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'delete-account' }),
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 200);

    const remainingEnt = db.prepare('SELECT * FROM "account_entitlement" WHERE "userId" = ?').get(authUser.id);
    assert.equal(remainingEnt, undefined, 'Entitlement harus terhapus saat akun dihapus');

    const remainingUser = db.prepare('SELECT * FROM "user" WHERE "id" = ?').get(authUser.id);
    assert.equal(remainingUser, undefined, 'User harus terhapus');
  } finally {
    db.close();
  }
});
test('7. API: tidak ada payment route atau admin mutation route (seluruhnya ditolak 404)', async () => {
  const { db, d1Compat } = setupTestDatabase();
  const env = createTestEnv(d1Compat);

  try {
    const authUser = await createAuthenticatedUser(db, 'u_no_admin', 'Regular User', 'user@example.com');

    const blockedRoutes = [
      '/api/admin/entitlement',
      '/api/admin/users',
      '/api/payment/checkout',
      '/api/payment/order',
      '/api/payment/midtrans',
      '/api/payment/webhook',
    ];

    for (const route of blockedRoutes) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const req = new Request(`http://localhost:3000${route}`, {
          method,
          headers: {
            'Cookie': authUser.cookie,
            'Origin': 'http://localhost:3000',
            'Content-Type': 'application/json',
          },
        });
        const res = await worker.fetch(req, env, {} as any);
        assert.equal(res.status, 404, `Route ${method} ${route} dilarang ada dan harus 404`);
      }
    }
  } finally {
    db.close();
  }
});
