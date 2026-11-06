import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/index.ts';
import type { Env } from '../../worker/env.ts';
import {
  createMigratedTestDb,
  createD1DatabaseAdapter,
  createInterleavingD1Adapter,
} from './test-db-helper.ts';

const TEST_SECRET = 'test-secret-at-least-32-chars-long-1234567890';

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

async function createAuthenticatedUser(sqlite: any, id: string, name: string, email: string) {
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run(id, name, email, now, now);

  const token = `token_${id}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  sqlite
    .prepare('INSERT INTO "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") VALUES (?, ?, ?, ?, ?, ?)')
    .run(`s_${id}`, expiresAt, token, now, now, id);

  const signedToken = await signCookieValue(token, TEST_SECRET);
  return {
    id,
    token,
    signedToken,
    cookie: `better-auth.session_token=${signedToken}; __Secure-better-auth.session_token=${signedToken}`,
  };
}

function createTestEnv(d1Adapter: any, overrides?: Partial<Env>): Env {
  return {
    ASSETS: { fetch: async () => new Response('assets-spa-ok', { status: 200 }) } as any,
    DB: d1Adapter as any,
    BETTER_AUTH_SECRET: TEST_SECRET,
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    APP_ORIGIN: 'http://localhost:3000',
    ...overrides,
  };
}

// =========================================================================
// R2C-B1 INTEGRATION TESTS: Idempotent Personal Workspace Bootstrap API
// =========================================================================

test('1. tanpa sesi -> 401', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 401);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('vary'), 'Cookie, Origin');
  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('2. Origin hilang -> 403', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.equal(body.error.message, 'Origin tidak terpercaya');
});

test('3. Origin tidak dipercaya -> 403', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://evil-attacker.site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.equal(body.error.message, 'Origin tidak terpercaya');
});

test('4. Content-Type salah -> 400', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'text/plain',
      },
      body: '{}',
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_CONTENT_TYPE');
});

test('5. malformed JSON -> structured 400', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: '{"broken": json',
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_REQUEST_BODY');
});

test('6. body array/null/non-object -> 400', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const invalidBodies = ['[]', 'null', '"string"', '123', 'true'];
  for (const b of invalidBodies) {
    const res = await worker.fetch(
      new Request('http://localhost:3000/api/workspaces/bootstrap', {
        method: 'POST',
        headers: {
          'Cookie': alice.cookie,
          'Origin': 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: b,
      }),
      env,
      {} as any
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_REQUEST_BODY');
  }
});

test('7. payload terlalu besar -> ditolak sebelum operasi database', async () => {
  const sqlite = createMigratedTestDb();
  let dbTouched = false;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeFirst: () => { dbTouched = true; },
    beforeRun: () => { dbTouched = true; },
  });
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const largeBody = JSON.stringify({ padding: 'a'.repeat(600) });
  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: largeBody,
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 400);
  assert.equal(dbTouched, false);
  const body = await res.json();
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('8. bootstrap pertama membuat personal workspace dan created=true', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('vary'), 'Cookie, Origin');
  const body = await res.json();
  assert.equal(body.created, true);
  assert.ok(body.workspace);
  assert.ok(typeof body.workspace.id === 'string' && body.workspace.id.length > 0);
  assert.equal(body.workspace.type, 'personal');
  assert.equal(body.workspace.name, 'Ruang Kerja Utama');
  assert.ok(body.workspace.slug.startsWith('personal-'));
  assert.equal(body.workspace.role, 'owner');
  assert.ok(typeof body.workspace.createdAt === 'number' && body.workspace.createdAt > 0);
  assert.ok(typeof body.workspace.updatedAt === 'number' && body.workspace.updatedAt > 0);

  // Verifikasi ke dalam database
  const row = sqlite
    .prepare('SELECT * FROM workspace WHERE personal_owner_user_id = ?')
    .get('u_alice') as any;
  assert.ok(row);
  assert.equal(row.id, body.workspace.id);
  assert.equal(row.type, 'personal');
  assert.equal(row.deleted_at, null);
});

test('9. bootstrap kedua mengembalikan ID sama dan created=false', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const req = () =>
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

  const res1 = await worker.fetch(req(), env, {} as any);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.created, true);

  const res2 = await worker.fetch(req(), env, {} as any);
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.created, false);
  assert.equal(body2.workspace.id, body1.workspace.id);
  assert.equal(body2.workspace.slug, body1.workspace.slug);
  assert.equal(body2.workspace.name, body1.workspace.name);
  assert.equal(body2.workspace.role, 'owner');
});

test('10. dua request concurrent menghasilkan tepat satu workspace', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const req = () =>
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

  const [res1, res2] = await Promise.all([
    worker.fetch(req(), env, {} as any),
    worker.fetch(req(), env, {} as any),
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);

  const countRow = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM workspace WHERE personal_owner_user_id = ?')
    .get('u_alice') as any;
  assert.equal(countRow.cnt, 1);
});

test('11. masing-masing request concurrent menerima canonical workspace yang sama', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const req = () =>
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

  const [res1, res2] = await Promise.all([
    worker.fetch(req(), env, {} as any),
    worker.fetch(req(), env, {} as any),
  ]);

  const body1 = await res1.json();
  const body2 = await res2.json();

  assert.equal(body1.workspace.id, body2.workspace.id);
  assert.equal(body1.workspace.slug, body2.workspace.slug);
  assert.equal(body1.workspace.name, body2.workspace.name);
  assert.equal(body1.workspace.role, 'owner');

  // Satu bernilai true (pemenang race), satu bernilai false (pengambil canonical)
  const createdFlags = [body1.created, body2.created].sort();
  assert.deepEqual(createdFlags, [false, true]);
});

test('12. user berbeda memperoleh workspace berbeda', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');

  const req = (cookie: string) =>
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

  const resAlice = await worker.fetch(req(alice.cookie), env, {} as any);
  const resBob = await worker.fetch(req(bob.cookie), env, {} as any);

  assert.equal(resAlice.status, 200);
  assert.equal(resBob.status, 200);

  const bodyAlice = await resAlice.json();
  const bodyBob = await resBob.json();

  assert.notEqual(bodyAlice.workspace.id, bodyBob.workspace.id);
  assert.notEqual(bodyAlice.workspace.slug, bodyBob.workspace.slug);
  assert.equal(bodyAlice.created, true);
  assert.equal(bodyBob.created, true);
});

test('13. workspace team tidak menghalangi personal bootstrap', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  // Buat team workspace tempat Alice menjadi member
  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES (?, 'team', ?, ?, NULL, 0, 0, ?, ?)`
    )
    .run('ws_team_1', 'Team Enterprise', 'team-enterprise-slug', now, now);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?)`
    )
    .run('mem_alice', 'ws_team_1', 'u_alice', now, now);

  // Bootstrap personal workspace untuk Alice
  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created, true);
  assert.equal(body.workspace.type, 'personal');
  assert.notEqual(body.workspace.id, 'ws_team_1');

  // Pastikan kedua workspace ada di database
  const workspaces = sqlite
    .prepare('SELECT id, type, personal_owner_user_id FROM workspace ORDER BY created_at ASC')
    .all() as any[];
  assert.equal(workspaces.length, 2);
});

test('14. personal workspace soft-deleted menghasilkan structured conflict, bukan workspace baru', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  // Masukkan personal workspace yang berstatus soft-deleted
  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at, deleted_at)
       VALUES (?, 'personal', ?, ?, ?, 0, 0, ?, ?, ?)`
    )
    .run('ws_personal_deleted', 'Ruang Kerja Lama', 'personal-slug-deleted', 'u_alice', now - 10000, now - 5000, now - 1000);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, 'WORKSPACE_DELETED');
  assert.equal(
    body.error.message,
    'Ruang kerja personal telah dihapus. Kebijakan pemulihan belum tersedia.'
  );

  // Pastikan tidak ada workspace baru yang dibuat
  const countRow = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM workspace WHERE personal_owner_user_id = ?')
    .get('u_alice') as any;
  assert.equal(countRow.cnt, 1);
});

test('15. unique conflict yang diharapkan tidak membocorkan SQLite error', async () => {
  const sqlite = createMigratedTestDb();
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  // Simulasikan balapan: saat INSERT akan dijalankan, row sudah dibuat oleh transaksi paralel
  let raceTriggered = false;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeRun: async (sql) => {
      if (sql.includes('INSERT INTO workspace') && !raceTriggered) {
        raceTriggered = true;
        sqlite
          .prepare(
            `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at, deleted_at)
             VALUES (?, 'personal', ?, ?, ?, 0, 0, ?, ?, NULL)`
          )
          .run('ws_parallel_created', 'Ruang Kerja Paralel', 'personal-parallel-slug', 'u_alice', now, now);
      }
    },
  });

  const env = createTestEnv(db);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created, false);
  assert.equal(body.workspace.id, 'ws_parallel_created');
  assert.equal(body.workspace.name, 'Ruang Kerja Paralel');
  assert.equal(body.workspace.slug, 'personal-parallel-slug');
  assert.equal(body.error, undefined);
});

test('16. unknown database error menjadi INTERNAL_OPERATION_FAILED', async () => {
  const sqlite = createMigratedTestDb();
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const db = createInterleavingD1Adapter(sqlite, {
    beforeFirst: (sql) => {
      if (sql.includes('FROM workspace')) {
        throw new Error('Database disk I/O failure: SQLITE_IOERR');
      }
    },
  });

  const env = createTestEnv(db);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, 'INTERNAL_OPERATION_FAILED');
  assert.equal(
    body.error.message,
    'Terjadi kesalahan internal pada server ruang kerja'
  );
  // Pastikan tidak ada raw SQL atau stack trace yang bocor
  assert.equal(JSON.stringify(body).includes('SQLITE_IOERR'), false);
  assert.equal(JSON.stringify(body).includes('disk I/O failure'), false);
});

test('17. response tidak memuat owner ID, cursor internal, email, token, atau raw row', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  const topKeys = Object.keys(body).sort();
  assert.deepEqual(topKeys, ['created', 'workspace']);

  const wsKeys = Object.keys(body.workspace).sort();
  assert.deepEqual(wsKeys, ['createdAt', 'id', 'name', 'role', 'slug', 'type', 'updatedAt']);

  assert.equal((body.workspace as any).personal_owner_user_id, undefined);
  assert.equal((body.workspace as any).personalOwnerUserId, undefined);
  assert.equal((body.workspace as any).latest_change_seq, undefined);
  assert.equal((body.workspace as any).min_valid_sync_seq, undefined);
  assert.equal((body.workspace as any).deleted_at, undefined);
  assert.equal((body as any).email, undefined);
  assert.equal((body as any).token, undefined);
});

test('18. GET/PUT/PATCH/DELETE pada bootstrap -> 405 dengan Allow: POST', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const disallowedMethods = ['GET', 'PUT', 'PATCH', 'DELETE'];
  for (const m of disallowedMethods) {
    const res = await worker.fetch(
      new Request('http://localhost:3000/api/workspaces/bootstrap', {
        method: m,
        headers: {
          'Cookie': alice.cookie,
          'Origin': 'http://localhost:3000',
        },
      }),
      env,
      {} as any
    );

    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
    const body = await res.json();
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(body.error.message, 'Metode HTTP tidak didukung pada endpoint bootstrap');
  }
});

test('19. read endpoints R2C-A tetap read-only', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const readEndpoints = [
    'http://localhost:3000/api/workspaces',
    'http://localhost:3000/api/workspaces/ws_any',
    'http://localhost:3000/api/workspaces/ws_any/snapshot',
    'http://localhost:3000/api/workspaces/ws_any/sync',
  ];

  for (const ep of readEndpoints) {
    const res = await worker.fetch(
      new Request(ep, {
        method: 'POST',
        headers: {
          'Cookie': alice.cookie,
          'Origin': 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
      env,
      {} as any
    );

    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
    const body = await res.json();
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(body.error.message, 'Metode HTTP tidak didukung pada endpoint ini');
  }
});

test('20. route account/auth/health/assets tidak regresi', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Test 20.1: /api/auth/get-session
  const authRes = await worker.fetch(
    new Request('http://localhost:3000/api/auth/get-session', {
      headers: { 'Cookie': alice.cookie },
    }),
    env,
    {} as any
  );
  assert.equal(authRes.status, 200);

  // Test 20.2: /api/account/summary
  const accountRes = await worker.fetch(
    new Request('http://localhost:3000/api/account/summary', {
      headers: { 'Cookie': alice.cookie },
    }),
    env,
    {} as any
  );
  assert.equal(accountRes.status, 200);

  // Test 20.3: Asset SPA fallback
  const spaRes = await worker.fetch(
    new Request('http://localhost:3000/dashboard'),
    env,
    {} as any
  );
  assert.equal(spaRes.status, 200);
  const spaText = await spaRes.text();
  assert.equal(spaText, 'assets-spa-ok');
});

test('21. validasi field terlarang: menolak userId, workspaceId, role, dll', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const forbiddenFields = [
    { userId: 'u_attacker' },
    { workspaceId: 'ws_injected' },
    { role: 'admin' },
    { owner: 'u_someone' },
    { slug: 'custom-slug' },
    { plan: 'pro' },
    { name: 'Custom Name' },
    { table: 'workspace' },
  ];

  for (const payload of forbiddenFields) {
    const res = await worker.fetch(
      new Request('http://localhost:3000/api/workspaces/bootstrap', {
        method: 'POST',
        headers: {
          'Cookie': alice.cookie,
          'Origin': 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
      env,
      {} as any
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_REQUEST_BODY');
  }
});

test('22. validasi field locale: menerima id dan en, menolak nilai lain', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');

  // Tolak locale selain id atau en
  const invalidLocaleRes = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ locale: 'fr' }),
    }),
    env,
    {} as any
  );
  assert.equal(invalidLocaleRes.status, 400);
  const invalidBody = await invalidLocaleRes.json();
  assert.equal(invalidBody.error.code, 'INVALID_REQUEST_BODY');

  // Terima locale en
  const enRes = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ locale: 'en' }),
    }),
    env,
    {} as any
  );
  assert.equal(enRes.status, 200);
  const enBody = await enRes.json();
  assert.equal(enBody.workspace.name, 'Personal Workspace');

  // Terima locale id
  const idRes = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': bob.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ locale: 'id' }),
    }),
    env,
    {} as any
  );
  assert.equal(idRes.status, 200);
  const idBody = await idRes.json();
  assert.equal(idBody.workspace.name, 'Ruang Kerja Utama');
});

test('23. strict Content-Type: menerima application/json dengan parameter dan menolak format lain', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Positif: parameter charset utf-8
  const validContentTypes = [
    'application/json; charset=utf-8',
    'application/json; charset=UTF-8',
    'application/json;charset=utf-8',
  ];

  for (const ct of validContentTypes) {
    const res = await worker.fetch(
      new Request('http://localhost:3000/api/workspaces/bootstrap', {
        method: 'POST',
        headers: {
          'Cookie': alice.cookie,
          'Origin': 'http://localhost:3000',
          'Content-Type': ct,
        },
        body: JSON.stringify({}),
      }),
      env,
      {} as any
    );
    assert.equal(res.status, 200);
  }

  // Negatif: format tidak diizinkan
  const invalidContentTypes = [
    'application/jsonp',
    'text/application/json',
    'application/problem+json',
    'application/json, text/plain',
    'text/plain; application/json',
  ];

  for (const ct of invalidContentTypes) {
    const res = await worker.fetch(
      new Request('http://localhost:3000/api/workspaces/bootstrap', {
        method: 'POST',
        headers: {
          'Cookie': alice.cookie,
          'Origin': 'http://localhost:3000',
          'Content-Type': ct,
        },
        body: JSON.stringify({}),
      }),
      env,
      {} as any
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_CONTENT_TYPE');
  }
});

test('24. validasi Content-Length: tolak malformed, negatif, desimal, suffix, dan overflow', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const invalidHeaders = [
    '-1',
    '1.5',
    '1junk',
    '1000', // di atas batas maksimum 512
    '99999999999999999999999999999999999', // overflow batas integer aman
  ];

  for (const cl of invalidHeaders) {
    const res = await worker.fetch(
      new Request('http://localhost:3000/api/workspaces/bootstrap', {
        method: 'POST',
        headers: {
          'Cookie': alice.cookie,
          'Origin': 'http://localhost:3000',
          'Content-Type': 'application/json',
          'Content-Length': cl,
        },
        body: '{}',
      }),
      env,
      {} as any
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    if (cl === '1000') {
      assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
    } else {
      assert.equal(body.error.code, 'INVALID_REQUEST_BODY');
    }
  }
});

test('25. streaming payload limit: tolak stream >512 byte tanpa Content-Length atau dengan header bohong', async () => {
  const sqlite = createMigratedTestDb();
  let workspaceTableQueried = false;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeFirst: (sql) => {
      if (sql.includes('workspace')) workspaceTableQueried = true;
    },
    beforeRun: (sql) => {
      if (sql.includes('workspace')) workspaceTableQueried = true;
    },
  });
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // 25.1 Stream melebihi 512 byte dalam beberapa chunk dan membatalkan stream
  let streamCancelled = false;
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(200));
      controller.enqueue(new Uint8Array(200));
      controller.enqueue(new Uint8Array(200)); // Total 600 byte > 512 byte
    },
    cancel() {
      streamCancelled = true;
    },
  });

  const res1 = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: oversizedStream,
      duplex: 'half',
    } as any),
    env,
    {} as any
  );

  assert.equal(res1.status, 400);
  const body1 = await res1.json();
  assert.equal(body1.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(streamCancelled, true);
  // Verifikasi tidak ada operasi workspace SELECT atau INSERT yang dijalankan
  assert.equal(workspaceTableQueried, false);

  // 25.2 Content-Length berbohong lebih kecil dari body sebenarnya
  let liarStreamCancelled = false;
  const liarStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"padding":"'));
      controller.enqueue(new Uint8Array(500));
      controller.enqueue(new TextEncoder().encode('"}'));
    },
    cancel() {
      liarStreamCancelled = true;
    },
  });

  const res2 = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
        'Content-Length': '2', // Bohong, aslinya > 512 byte
      },
      body: liarStream,
      duplex: 'half',
    } as any),
    env,
    {} as any
  );

  assert.equal(res2.status, 400);
  const body2 = await res2.json();
  assert.equal(body2.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(liarStreamCancelled, true);
  assert.equal(workspaceTableQueried, false);
});

test('26. bounded collision recovery: collision slug pada attempt pertama berhasil pada attempt berikutnya', async () => {
  const sqlite = createMigratedTestDb();
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');
  const now = Date.now();

  // Buat workspace milik Bob dengan slug tertentu
  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES (?, 'personal', ?, ?, ?, 0, 0, ?, ?)`
    )
    .run('ws_bob', 'Ruang Kerja Bob', 'colliding-slug', 'u_bob', now, now);

  let attemptCount = 0;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeRun: (sql, values) => {
      if (sql.includes('INSERT INTO workspace')) {
        attemptCount++;
        if (attemptCount === 1) {
          // Paksa attempt 1 menabrak slug milik Bob
          values[2] = 'colliding-slug';
        }
      }
    },
  });
  const env = createTestEnv(db);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 200);
  assert.equal(attemptCount, 2);
  const body = await res.json();
  assert.equal(body.created, true);
  assert.ok(body.workspace.slug.startsWith('personal-'));
  assert.notEqual(body.workspace.slug, 'colliding-slug');
});

test('27. bounded collision recovery: collision workspace ID pada attempt pertama berhasil pada attempt berikutnya', async () => {
  const sqlite = createMigratedTestDb();
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');
  const now = Date.now();

  // Buat workspace milik Bob dengan ID tertentu
  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES (?, 'personal', ?, ?, ?, 0, 0, ?, ?)`
    )
    .run('colliding-id', 'Ruang Kerja Bob', 'bob-unique-slug', 'u_bob', now, now);

  let attemptCount = 0;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeRun: (sql, values) => {
      if (sql.includes('INSERT INTO workspace')) {
        attemptCount++;
        if (attemptCount === 1) {
          // Paksa attempt 1 menabrak ID milik Bob
          values[0] = 'colliding-id';
        }
      }
    },
  });
  const env = createTestEnv(db);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 200);
  assert.equal(attemptCount, 2);
  const body = await res.json();
  assert.equal(body.created, true);
  assert.notEqual(body.workspace.id, 'colliding-id');
});

test('28. collision berulang sampai retry habis menghasilkan sanitized 500', async () => {
  const sqlite = createMigratedTestDb();
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');
  const now = Date.now();

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES (?, 'personal', ?, ?, ?, 0, 0, ?, ?)`
    )
    .run('ws_bob', 'Ruang Kerja Bob', 'perpetual-colliding-slug', 'u_bob', now, now);

  let attemptCount = 0;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeRun: (sql, values) => {
      if (sql.includes('INSERT INTO workspace')) {
        attemptCount++;
        // Seluruh 3 attempt dipaksa menabrak slug
        values[2] = 'perpetual-colliding-slug';
      }
    },
  });
  const env = createTestEnv(db);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 500);
  assert.equal(attemptCount, 3);
  const body = await res.json();
  assert.equal(body.error.code, 'INTERNAL_OPERATION_FAILED');
  assert.equal(
    body.error.message,
    'Terjadi kesalahan internal saat menyiapkan ruang kerja personal'
  );
  assert.equal(JSON.stringify(body).includes('UNIQUE constraint'), false);
});

test('29. unknown constraint atau non-unique error tidak dianggap owner race', async () => {
  const sqlite = createMigratedTestDb();
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  let checkedOwnerAfterError = false;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeFirst: (sql) => {
      if (sql.includes('personal_owner_user_id = ?')) {
        checkedOwnerAfterError = true;
      }
    },
    beforeRun: (sql) => {
      if (sql.includes('INSERT INTO workspace')) {
        throw new Error('CHECK constraint failed: workspace');
      }
    },
  });
  const env = createTestEnv(db);

  // Reset flag pengecekan awal
  checkedOwnerAfterError = false;

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/bootstrap', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, 'INTERNAL_OPERATION_FAILED');
  assert.equal(JSON.stringify(body).includes('CHECK constraint'), false);
});
