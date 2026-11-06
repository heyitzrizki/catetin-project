import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/index.ts';
import type { Env } from '../../worker/env.ts';
import {
  createMigratedTestDb,
  createD1DatabaseAdapter,
  createInterleavingD1Adapter,
} from './test-db-helper.ts';
import { appendWorkspaceChange, purgeWorkspaceChangeLog } from '../../worker/workspace/sync-engine.ts';

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
// R2C-A INTEGRATION TESTS
// =========================================================================

test('1. seluruh endpoint tanpa sesi -> 401', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);

  const endpoints = [
    'http://localhost:3000/api/workspaces',
    'http://localhost:3000/api/workspaces/ws_any',
    'http://localhost:3000/api/workspaces/ws_any/snapshot',
    'http://localhost:3000/api/workspaces/ws_any/sync?since=0',
  ];

  for (const ep of endpoints) {
    const res = await worker.fetch(new Request(ep), env, {} as any);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('vary'), 'Cookie, Origin');
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  }
});

test('2. user hanya melihat workspace miliknya/yang menjadi member', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');
  const charlie = await createAuthenticatedUser(sqlite, 'u_charlie', 'Charlie', 'charlie@example.com');

  // ws_alice (personal), ws_bob (personal)
  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_alice_pers', 'personal', 'Alice Personal', 'alice-personal', 'u_alice', ?, ?),
              ('ws_bob_pers', 'personal', 'Bob Personal', 'bob-personal', 'u_bob', ?, ?)`
    )
    .run(now, now, now + 1, now + 1);

  // ws_team1 (Alice owner, Bob member), ws_team2 (Charlie owner)
  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_team1', 'team', 'Team 1', 'team-1', NULL, ?, ?),
              ('ws_team2', 'team', 'Team 2', 'team-2', NULL, ?, ?)`
    )
    .run(now + 2, now + 2, now + 3, now + 3);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m1', 'ws_team1', 'u_alice', 'owner', ?, ?),
              ('m2', 'ws_team1', 'u_bob', 'member', ?, ?),
              ('m3', 'ws_team2', 'u_charlie', 'owner', ?, ?)`
    )
    .run(now, now, now, now, now, now);

  // Alice request
  const reqAlice = new Request('http://localhost:3000/api/workspaces', {
    headers: { Cookie: alice.cookie },
  });
  const resAlice = await worker.fetch(reqAlice, env, {} as any);
  assert.equal(resAlice.status, 200);
  const bodyAlice = await resAlice.json();
  assert.equal(bodyAlice.workspaces.length, 2);
  assert.equal(bodyAlice.workspaces[0].id, 'ws_alice_pers');
  assert.equal(bodyAlice.workspaces[0].role, 'owner');
  assert.equal(bodyAlice.workspaces[1].id, 'ws_team1');
  assert.equal(bodyAlice.workspaces[1].role, 'owner');

  // Bob request
  const reqBob = new Request('http://localhost:3000/api/workspaces', {
    headers: { Cookie: bob.cookie },
  });
  const resBob = await worker.fetch(reqBob, env, {} as any);
  assert.equal(resBob.status, 200);
  const bodyBob = await resBob.json();
  assert.equal(bodyBob.workspaces.length, 2);
  assert.equal(bodyBob.workspaces[0].id, 'ws_bob_pers');
  assert.equal(bodyBob.workspaces[0].role, 'owner');
  assert.equal(bodyBob.workspaces[1].id, 'ws_team1');
  assert.equal(bodyBob.workspaces[1].role, 'member');

  // Charlie request
  const reqCharlie = new Request('http://localhost:3000/api/workspaces', {
    headers: { Cookie: charlie.cookie },
  });
  const resCharlie = await worker.fetch(reqCharlie, env, {} as any);
  assert.equal(resCharlie.status, 200);
  const bodyCharlie = await resCharlie.json();
  assert.equal(bodyCharlie.workspaces.length, 1);
  assert.equal(bodyCharlie.workspaces[0].id, 'ws_team2');
  assert.equal(bodyCharlie.workspaces[0].role, 'owner');
});

test('3. non-member tidak dapat membedakan workspace tidak ada dan workspace terlarang', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_alice', 'personal', 'Alice Work', 'alice-work', 'u_alice', ?, ?)`
    )
    .run(now, now);

  // Bob mencoba mengakses workspace pribadi milik Alice -> 404 WORKSPACE_NOT_FOUND
  const req1 = new Request('http://localhost:3000/api/workspaces/ws_alice', {
    headers: { Cookie: bob.cookie },
  });
  const res1 = await worker.fetch(req1, env, {} as any);
  assert.equal(res1.status, 404);
  const body1 = await res1.json();
  assert.equal(body1.error.code, 'WORKSPACE_NOT_FOUND');

  // Bob mencoba mengakses ID yang sama sekali tidak ada -> persis 404 WORKSPACE_NOT_FOUND
  const req2 = new Request('http://localhost:3000/api/workspaces/ws_non_existent', {
    headers: { Cookie: bob.cookie },
  });
  const res2 = await worker.fetch(req2, env, {} as any);
  assert.equal(res2.status, 404);
  const body2 = await res2.json();
  assert.equal(body2.error.code, 'WORKSPACE_NOT_FOUND');
  assert.deepEqual(body1, body2);
});

test('4. workspace soft-deleted tidak muncul', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at, deleted_at)
       VALUES ('ws_del', 'personal', 'Deleted Work', 'deleted-work', 'u_alice', ?, ?, ?)`
    )
    .run(now, now, now);

  // 1. GET /api/workspaces tidak memuat workspace yang sudah soft-deleted
  const resList = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  const bodyList = await resList.json();
  assert.equal(bodyList.workspaces.length, 0);

  // 2. GET /api/workspaces/ws_del -> 404
  const resGet = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_del', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(resGet.status, 404);

  // 3. GET /api/workspaces/ws_del/snapshot -> 404
  const resSnap = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_del/snapshot', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(resSnap.status, 404);

  // 4. GET /api/workspaces/ws_del/sync?since=0 -> 404
  const resSync = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_del/sync?since=0', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(resSync.status, 404);
});

test('5. snapshot tidak mencampur data workspace lain', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_a', 'personal', 'WS A', 'ws-a', 'u_alice', 5, 0, ?, ?),
              ('ws_b', 'team', 'WS B', 'ws-b', NULL, 10, 0, ?, ?)`
    )
    .run(now, now, now, now);

  // Data di ws_a
  sqlite
    .prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at) VALUES ('prj_a', 'ws_a', 'Project A', 'u_alice', 1, ?, ?)")
    .run(now, now);
  sqlite
    .prepare("INSERT INTO folder (id, workspace_id, project_id, name, version, created_at, updated_at) VALUES ('fld_a', 'ws_a', 'prj_a', 'Folder A', 1, ?, ?)")
    .run(now, now);
  sqlite
    .prepare("INSERT INTO tag (id, workspace_id, name, normalized_name, version, created_at, updated_at) VALUES ('tag_a', 'ws_a', 'Tag A', 'tag a', 1, ?, ?)")
    .run(now, now);

  // Data di ws_b
  sqlite
    .prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at) VALUES ('prj_b', 'ws_b', 'Project B', 'u_alice', 1, ?, ?)")
    .run(now, now);

  // Tarik snapshot ws_a
  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_a/snapshot', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(res.status, 200);
  const snap = await res.json();

  assert.equal(snap.workspace.id, 'ws_a');
  assert.equal(snap.entities.projects.length, 1);
  assert.equal(snap.entities.projects[0].id, 'prj_a');
  assert.equal(snap.entities.projects[0].workspaceId, 'ws_a');
  assert.equal(snap.entities.folders.length, 1);
  assert.equal(snap.entities.folders[0].id, 'fld_a');
  assert.equal(snap.entities.tags.length, 1);
  assert.equal(snap.entities.tags[0].id, 'tag_a');

  // Tidak ada entitas dari ws_b
  assert.equal(snap.entities.projects.some((p: any) => p.id === 'prj_b'), false);
});

test('6. snapshot tidak mengembalikan deleted entities', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_snap_del', 'personal', 'WS Snap Del', 'ws-snap-del', 'u_alice', 2, 0, ?, ?)`
    )
    .run(now, now);

  // Project aktif dan project deleted
  sqlite
    .prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at) VALUES ('prj_active', 'ws_snap_del', 'Active', 'u_alice', 1, ?, ?)")
    .run(now, now);
  sqlite
    .prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at, deleted_at) VALUES ('prj_deleted', 'ws_snap_del', 'Deleted', 'u_alice', 2, ?, ?, ?)")
    .run(now, now, now);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_snap_del/snapshot', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(res.status, 200);
  const snap = await res.json();

  assert.equal(snap.entities.projects.length, 1);
  assert.equal(snap.entities.projects[0].id, 'prj_active');
});

test('7. snapshot cursor konsisten', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_cursor', 'personal', 'WS Cursor', 'ws-cursor', 'u_alice', 42, 10, ?, ?)`
    )
    .run(now, now);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_cursor/snapshot', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(res.status, 200);
  const snap = await res.json();

  assert.equal(snap.latestSeq, 42);
  assert.equal(snap.minValidSeq, 10);
});

test('8. delta sync terurut monotonik', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_delta', 'personal', 'WS Delta', 'ws-delta', 'u_alice', 0, 0, ?, ?)`
    )
    .run(now, now);

  // Buat 3 mutasi melalui appendWorkspaceChange
  for (let i = 1; i <= 3; i++) {
    await appendWorkspaceChange(db, {
      workspaceId: 'ws_delta',
      userId: 'u_alice',
      entityType: 'project',
      entityId: `prj_d_${i}`,
      operation: 'upsert',
      mutation: { clientMutationId: `m_${i}`, payload: { name: `Prj ${i}` } },
      domainPlan: { action: 'insert', attributes: { name: `Prj ${i}` } },
    });
  }

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_delta/sync?since=0', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(res.status, 200);
  const delta = await res.json();

  assert.equal(delta.changes.length, 3);
  assert.ok(delta.changes[0].changeSeq < delta.changes[1].changeSeq);
  assert.ok(delta.changes[1].changeSeq < delta.changes[2].changeSeq);
  assert.equal(delta.nextSeq, delta.changes[2].changeSeq);
  assert.equal(delta.hasMore, false);
});

test('9. batas since = minValidSeq valid', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_bound', 'personal', 'WS Bound', 'ws-bound', 'u_alice', 0, 0, ?, ?)`
    )
    .run(now, now);

  // Buat mutasi 1-3
  for (let i = 1; i <= 3; i++) {
    await appendWorkspaceChange(db, {
      workspaceId: 'ws_bound',
      userId: 'u_alice',
      entityType: 'project',
      entityId: `prj_b_${i}`,
      operation: 'upsert',
      mutation: { clientMutationId: `mb_${i}`, payload: { name: `B ${i}` } },
      domainPlan: { action: 'insert', attributes: { name: `B ${i}` } },
    });
  }

  // Purge sampai sequence 2 -> min_valid_sync_seq menjadi 2
  await purgeWorkspaceChangeLog(db, { workspaceId: 'ws_bound', upToSeq: 2 });

  // since = min_valid_sync_seq (2) wajib valid (status 200)
  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_bound/sync?since=2', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(res.status, 200);
  const delta = await res.json();
  assert.equal(delta.changes.length, 1);
  assert.equal(delta.changes[0].changeSeq, 3);
});

test('10. since di bawah batas -> FULL_RESYNC_REQUIRED', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_resync', 'personal', 'WS Resync', 'ws-resync', 'u_alice', 10, 5, ?, ?)`
    )
    .run(now, now);

  // since 4 (< min_valid_sync_seq 5) -> 409 FULL_RESYNC_REQUIRED
  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_resync/sync?since=4', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'FULL_RESYNC_REQUIRED');
  assert.equal(body.error.code, 'FULL_RESYNC_REQUIRED');
  assert.equal(body.minValidSeq, 5);
  assert.equal(body.currentSeq, 10);
});

test('11. query since negatif, desimal, NaN, kosong, atau duplikat ditolak', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_inv_param', 'personal', 'WS Inv', 'ws-inv', 'u_alice', 0, 0, ?, ?)`
    )
    .run(now, now);

  const invalidUrls = [
    'http://localhost:3000/api/workspaces/ws_inv_param/sync?since=-1',
    'http://localhost:3000/api/workspaces/ws_inv_param/sync?since=1.5',
    'http://localhost:3000/api/workspaces/ws_inv_param/sync?since=abc',
    'http://localhost:3000/api/workspaces/ws_inv_param/sync?since=',
    'http://localhost:3000/api/workspaces/ws_inv_param/sync',
    'http://localhost:3000/api/workspaces/ws_inv_param/sync?since=1&since=2',
  ];

  for (const url of invalidUrls) {
    const res = await worker.fetch(
      new Request(url, { headers: { Cookie: alice.cookie } }),
      env,
      {} as any
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_SYNC_CURSOR');
  }
});

test('12. pagination tidak skip/duplicate change', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_page', 'personal', 'WS Page', 'ws-page', 'u_alice', 0, 0, ?, ?)`
    )
    .run(now, now);

  // Tambahkan 5 mutasi
  for (let i = 1; i <= 5; i++) {
    await appendWorkspaceChange(db, {
      workspaceId: 'ws_page',
      userId: 'u_alice',
      entityType: 'project',
      entityId: `prj_p_${i}`,
      operation: 'upsert',
      mutation: { clientMutationId: `mp_${i}`, payload: { name: `P ${i}` } },
      domainPlan: { action: 'insert', attributes: { name: `P ${i}` } },
    });
  }

  // Halaman 1 (limit=2)
  const res1 = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_page/sync?since=0&limit=2', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  const page1 = await res1.json();
  assert.equal(page1.changes.length, 2);
  assert.equal(page1.hasMore, true);
  const seqs1 = page1.changes.map((c: any) => c.changeSeq);

  // Halaman 2 (since=page1.nextSeq, limit=2)
  const res2 = await worker.fetch(
    new Request(`http://localhost:3000/api/workspaces/ws_page/sync?since=${page1.nextSeq}&limit=2`, { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  const page2 = await res2.json();
  assert.equal(page2.changes.length, 2);
  assert.equal(page2.hasMore, true);
  const seqs2 = page2.changes.map((c: any) => c.changeSeq);

  // Halaman 3 (sisa 1 item)
  const res3 = await worker.fetch(
    new Request(`http://localhost:3000/api/workspaces/ws_page/sync?since=${page2.nextSeq}&limit=2`, { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  const page3 = await res3.json();
  assert.equal(page3.changes.length, 1);
  assert.equal(page3.hasMore, false);
  const seqs3 = page3.changes.map((c: any) => c.changeSeq);

  // Verifikasi tidak ada gap dan tidak ada duplikasi
  const allSeqs = [...seqs1, ...seqs2, ...seqs3];
  assert.deepEqual(allSeqs, [1, 2, 3, 4, 5]);
});

test('13. page size melewati batas ditolak atau diklem sesuai kontrak yang dipilih dan diuji', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_clamp', 'personal', 'WS Clamp', 'ws-clamp', 'u_alice', 0, 0, ?, ?)`
    )
    .run(now, now);

  // Limit tidak valid (negatif, desimal, duplikat) ditolak 400
  const badLimits = [
    'http://localhost:3000/api/workspaces/ws_clamp/sync?since=0&limit=-5',
    'http://localhost:3000/api/workspaces/ws_clamp/sync?since=0&limit=0',
    'http://localhost:3000/api/workspaces/ws_clamp/sync?since=0&limit=1.5',
    'http://localhost:3000/api/workspaces/ws_clamp/sync?since=0&limit=10&limit=20',
  ];
  for (const url of badLimits) {
    const res = await worker.fetch(new Request(url, { headers: { Cookie: alice.cookie } }), env, {} as any);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_SYNC_CURSOR');
  }

  // Limit melebihi 500 diklem secara aman dan berhasil (200)
  const resClamped = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_clamp/sync?since=0&limit=9999', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(resClamped.status, 200);
});

test('14. unsupported method -> 405', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_method', 'personal', 'WS Method', 'ws-method', 'u_alice', ?, ?)`
    )
    .run(now, now);

  const testCases = [
    { url: 'http://localhost:3000/api/workspaces', method: 'POST' },
    { url: 'http://localhost:3000/api/workspaces/ws_method', method: 'PUT' },
    { url: 'http://localhost:3000/api/workspaces/ws_method/snapshot', method: 'DELETE' },
    { url: 'http://localhost:3000/api/workspaces/ws_method/sync', method: 'PATCH' },
  ];

  for (const tc of testCases) {
    const res = await worker.fetch(
      new Request(tc.url, { method: tc.method, headers: { Cookie: alice.cookie } }),
      env,
      {} as any
    );
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
    const body = await res.json();
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
  }
});

test('15. header no-store dan Vary benar', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_hdr', 'personal', 'WS Hdr', 'ws-hdr', 'u_alice', ?, ?)`
    )
    .run(now, now);

  // 1. Permintaan dengan origin tepercaya menghasilkan CORS spesifik (bukan wildcard *)
  const reqTrusted = new Request('http://localhost:3000/api/workspaces', {
    headers: {
      Cookie: alice.cookie,
      Origin: 'http://localhost:3000',
    },
  });
  const resTrusted = await worker.fetch(reqTrusted, env, {} as any);
  assert.equal(resTrusted.headers.get('cache-control'), 'no-store');
  assert.equal(resTrusted.headers.get('vary'), 'Cookie, Origin');
  assert.equal(resTrusted.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal(resTrusted.headers.get('access-control-allow-credentials'), 'true');
  assert.notEqual(resTrusted.headers.get('access-control-allow-origin'), '*');

  // 2. Permintaan dengan origin asing tidak mendapatkan header CORS
  const reqUntrusted = new Request('http://localhost:3000/api/workspaces', {
    headers: {
      Cookie: alice.cookie,
      Origin: 'https://attacker.evil.com',
    },
  });
  const resUntrusted = await worker.fetch(reqUntrusted, env, {} as any);
  assert.equal(resUntrusted.headers.get('cache-control'), 'no-store');
  assert.equal(resUntrusted.headers.get('access-control-allow-origin'), null);
});

test('16. unknown/raw database errors disanitasi', async () => {
  const sqlite = createMigratedTestDb();
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Suntikkan kegagalan fatal dengan pesan internal SQL sensitif
  const dbCrash = createInterleavingD1Adapter(sqlite, {
    beforeFirst(sql) {
      if (sql.includes('FROM workspace')) {
        throw new Error('SQLITE_INTERNAL_ERROR: SELECT sensitive_admin_token FROM secret_users');
      }
    },
  });
  const envCrash = createTestEnv(dbCrash);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_any', { headers: { Cookie: alice.cookie } }),
    envCrash,
    {} as any
  );
  assert.equal(res.status, 500);
  const rawText = await res.text();
  assert.equal(rawText.includes('sensitive_admin_token'), false);
  assert.equal(rawText.includes('SQLITE_INTERNAL_ERROR'), false);
  assert.equal(rawText.includes('secret_users'), false);

  const body = JSON.parse(rawText);
  assert.equal(body.error.code, 'INTERNAL_OPERATION_FAILED');
  assert.equal(body.error.message, 'Terjadi kesalahan internal pada server ruang kerja');
});

test('17. tidak ada metadata workspace lokal atau binary audio dalam response', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_safe', 'personal', 'WS Safe', 'ws-safe', 'u_alice', ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO recording (id, workspace_id, title, duration_sec, created_by_user_id, version, created_at, updated_at)
       VALUES ('rec_s1', 'ws_safe', 'Recording 1', 60.0, 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO audio_asset (id, recording_id, workspace_id, r2_key, filename, mime_type, size_bytes, duration_sec, retention_tier, purge_at, sha256, version, created_at, updated_at)
       VALUES ('aud_s1', 'rec_s1', 'ws_safe', 'raw_audio/internal_secret_key.m4a', 'safe.m4a', 'audio/mp4', 1024, 60.0, 'until_deleted', NULL, 'sha256_secret_hash', 1, ?, ?)`
    )
    .run(now, now);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_safe/snapshot', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(res.status, 200);
  const rawText = await res.text();

  assert.equal(rawText.includes('raw_audio/internal_secret_key.m4a'), false);
  assert.equal(rawText.includes('sha256_secret_hash'), false);
  assert.equal(rawText.includes('local_v2_id'), false);
  assert.equal(rawText.includes('personal_owner_user_id'), false);
});

test('18. dua user pada workspace berbeda tidak mengalami cross-tenant leakage', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_t_alice', 'personal', 'WS Alice', 'ws-alice', 'u_alice', ?, ?),
              ('ws_t_bob', 'personal', 'WS Bob', 'ws-bob', 'u_bob', ?, ?)`
    )
    .run(now, now, now, now);

  // Bob mencoba membaca workspace Alice -> 404
  const resBobTriesAlice = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_t_alice/snapshot', { headers: { Cookie: bob.cookie } }),
    env,
    {} as any
  );
  assert.equal(resBobTriesAlice.status, 404);

  // Alice mencoba membaca workspace Bob -> 404
  const resAliceTriesBob = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_t_bob/snapshot', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal(resAliceTriesBob.status, 404);
});

test('19. personal dan team membership read authorization', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');
  const charlie = await createAuthenticatedUser(sqlite, 'u_charlie', 'Charlie', 'charlie@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_hier_team', 'team', 'Hier Team', 'hier-team', NULL, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_o', 'ws_hier_team', 'u_alice', 'owner', ?, ?),
              ('m_a', 'ws_hier_team', 'u_bob', 'admin', ?, ?),
              ('m_m', 'ws_hier_team', 'u_charlie', 'member', ?, ?)`
    )
    .run(now, now, now, now, now, now);

  // Alice -> role owner
  const resA = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_hier_team', { headers: { Cookie: alice.cookie } }),
    env,
    {} as any
  );
  assert.equal((await resA.json()).workspace.role, 'owner');

  // Bob -> role admin
  const resB = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_hier_team', { headers: { Cookie: bob.cookie } }),
    env,
    {} as any
  );
  assert.equal((await resB.json()).workspace.role, 'admin');

  // Charlie -> role member
  const resC = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_hier_team', { headers: { Cookie: charlie.cookie } }),
    env,
    {} as any
  );
  assert.equal((await resC.json()).workspace.role, 'member');
});

test('20. route lama /api/health, /api/auth/*, /api/account/*, serta SPA assets tidak mengalami regresi', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);

  // 1. /api/health
  const healthRes = await worker.fetch(new Request('http://localhost:3000/api/health'), env, {} as any);
  assert.equal(healthRes.status, 200);
  assert.deepEqual(await healthRes.json(), { ok: true });

  // 2. /api/auth/*
  const authRes = await worker.fetch(new Request('http://localhost:3000/api/auth/get-session'), env, {} as any);
  assert.equal(authRes.status, 200);

  // 3. /api/account/* (unauthenticated)
  const accRes = await worker.fetch(new Request('http://localhost:3000/api/account/summary'), env, {} as any);
  assert.equal(accRes.status, 401);

  // 4. SPA assets route (fallback untuk rute non-/api/)
  const spaRes = await worker.fetch(new Request('http://localhost:3000/dashboard'), env, {} as any);
  assert.equal(spaRes.status, 200);
  assert.equal(await spaRes.text(), 'assets-spa-ok');

  // 5. Unknown api route
  const unkRes = await worker.fetch(new Request('http://localhost:3000/api/random-unknown'), env, {} as any);
  assert.equal(unkRes.status, 404);
  assert.deepEqual(await unkRes.json(), { error: 'not_found' });
});

test('21. TOCTOU interleaving: pencabutan membership sebelum/saat query batch snapshot menghasilkan 404 tanpa kebocoran data', async () => {
  const sqlite = createMigratedTestDb();
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_toctou_team', 'team', 'TOCTOU Team', 'toctou-team', NULL, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_toctou_alice', 'ws_toctou_team', 'u_alice', 'owner', ?, ?),
              ('m_toctou_bob', 'ws_toctou_team', 'u_bob', 'member', ?, ?)`
    )
    .run(now, now, now, now);

  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('prj_secret', 'ws_toctou_team', 'Secret Project', 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  // Buat adapter interleaving: tepat sebelum batch statement pertama dieksekusi di database, keanggotaan Bob dicabut
  let revocationTriggered = false;
  const dbInterleaved = createInterleavingD1Adapter(sqlite, {
    beforeBatchStatement(index) {
      if (index === 0 && !revocationTriggered) {
        revocationTriggered = true;
        sqlite
          .prepare("DELETE FROM workspace_membership WHERE workspace_id = 'ws_toctou_team' AND user_id = 'u_bob'")
          .run();
      }
    },
  });
  const envInterleaved = createTestEnv(dbInterleaved);

  // Bob meminta snapshot
  const resSnap = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_toctou_team/snapshot', {
      headers: { Cookie: bob.cookie },
    }),
    envInterleaved,
    {} as any
  );

  assert.equal(revocationTriggered, true);
  assert.equal(resSnap.status, 404);
  const snapBody = await resSnap.json();
  assert.equal(snapBody.error.code, 'WORKSPACE_NOT_FOUND');
  const rawText = JSON.stringify(snapBody);
  assert.equal(rawText.includes('prj_secret'), false);
  assert.equal(rawText.includes('Secret Project'), false);

  // Verifikasi detail route menghasilkan 404 setelah membership tidak lagi ada
  const resDetail = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_toctou_team', {
      headers: { Cookie: bob.cookie },
    }),
    envInterleaved,
    {} as any
  );
  assert.equal(resDetail.status, 404);
  const detailBody = await resDetail.json();
  assert.equal(detailBody.error.code, 'WORKSPACE_NOT_FOUND');
});

test('22. Sanitasi transcript segments: membuang field internal dan menangani item malformed secara aman', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_seg_san', 'personal', 'Seg San', 'seg-san', 'u_alice', ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO recording (id, workspace_id, title, duration_sec, created_by_user_id, version, created_at, updated_at)
       VALUES ('rec_seg_1', 'ws_seg_san', 'Rec 1', 10.0, 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  const plantedDocument = {
    segments: [
      {
        id: 'seg_valid_1',
        speaker: 'Narasumber',
        seconds: 4.25,
        time: '00:04',
        text: 'Halo selamat pagi semuanya',
        internalSecret: 'TOP_SECRET_INTERNAL_KEY',
        rawProviderPayload: { model: 'whisper-large-v3', internalTokens: [1, 2, 3] },
        token: 'bearer_token_should_not_leak',
      },
      {
        id: 'seg_malformed_1',
        speaker: 99999, // bukan string -> harus dilewati
        seconds: -10, // negatif -> harus dilewati
        time: '00:10',
        text: 'Teks invalid',
      },
      'string acak bukan object',
      null,
      12345,
      {
        id: 'seg_valid_2',
        speaker: 'Pewawancara',
        seconds: 8.5,
        time: '00:08',
        text: 'Selamat pagi juga',
      },
    ],
  };

  sqlite
    .prepare(
      `INSERT INTO transcript (id, recording_id, workspace_id, summary_text, segment_count, word_count, raw_document_json, checksum, version, created_at, updated_at)
       VALUES ('txn_seg_1', 'rec_seg_1', 'ws_seg_san', 'Ringkasan', 2, 8, ?, 'chk123', 1, ?, ?)`
    )
    .run(JSON.stringify(plantedDocument), now, now);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_seg_san/snapshot', {
      headers: { Cookie: alice.cookie },
    }),
    env,
    {} as any
  );
  assert.equal(res.status, 200);
  const snap = await res.json();
  const rawText = JSON.stringify(snap);

  // Pastikan properti rahasia internal tidak bocor ke output JSON
  assert.equal(rawText.includes('TOP_SECRET_INTERNAL_KEY'), false);
  assert.equal(rawText.includes('rawProviderPayload'), false);
  assert.equal(rawText.includes('bearer_token_should_not_leak'), false);
  assert.equal(rawText.includes('internalSecret'), false);

  // Pastikan hanya 2 segmen valid yang diproyeksikan
  const segments = snap.entities.transcripts[0].segments;
  assert.equal(segments.length, 2);

  assert.equal(segments[0].id, 'seg_valid_1');
  assert.equal(segments[0].speaker, 'Narasumber');
  assert.equal(segments[0].seconds, 4.25);
  assert.equal(segments[0].time, '00:04');
  assert.equal(segments[0].text, 'Halo selamat pagi semuanya');
  assert.equal('internalSecret' in segments[0], false);
  assert.equal('rawProviderPayload' in segments[0], false);
  assert.equal('token' in segments[0], false);

  assert.equal(segments[1].id, 'seg_valid_2');
  assert.equal(segments[1].speaker, 'Pewawancara');
  assert.equal(segments[1].seconds, 8.5);
  assert.equal(segments[1].text, 'Selamat pagi juga');
});

test('23. Tangani malformed percent-encoding: rute detail, snapshot, dan sync menghasilkan 404 konsisten, bukan 500', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const malformedPaths = [
    'http://localhost:3000/api/workspaces/%',
    'http://localhost:3000/api/workspaces/%ZZ',
    'http://localhost:3000/api/workspaces/%/snapshot',
    'http://localhost:3000/api/workspaces/%ZZ/snapshot',
    'http://localhost:3000/api/workspaces/%/sync?since=0',
    'http://localhost:3000/api/workspaces/%ZZ/sync?since=0',
  ];

  for (const path of malformedPaths) {
    const res = await worker.fetch(
      new Request(path, { headers: { Cookie: alice.cookie } }),
      env,
      {} as any
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'WORKSPACE_NOT_FOUND');
  }
});

test('24. Nullable epoch conversion: nilai epoch 0 pada purgeAt tidak berubah menjadi null', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const now = Date.now();

  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_epoch', 'personal', 'WS Epoch', 'ws-epoch', 'u_alice', ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO recording (id, workspace_id, title, duration_sec, created_by_user_id, version, created_at, updated_at)
       VALUES ('rec_epoch', 'ws_epoch', 'Rec Epoch', 30.0, 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  // Berikan purge_at = 0 pada asset dengan retention_tier = '30_days'
  sqlite
    .prepare(
      `INSERT INTO audio_asset (id, recording_id, workspace_id, r2_key, filename, mime_type, size_bytes, duration_sec, retention_tier, purge_at, sha256, version, created_at, updated_at)
       VALUES ('aud_epoch', 'rec_epoch', 'ws_epoch', 'raw/epoch.m4a', 'epoch.m4a', 'audio/mp4', 500, 30.0, '30_days', 0, 'sha_epoch', 1, ?, ?)`
    )
    .run(now, now);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_epoch/snapshot', {
      headers: { Cookie: alice.cookie },
    }),
    env,
    {} as any
  );
  assert.equal(res.status, 200);
  const snap = await res.json();

  // Pastikan nilai epoch 0 tetap 0, bukan null
  assert.strictEqual(snap.entities.audioAssets[0].purgeAt, 0);
  assert.strictEqual(snap.entities.recordings[0].audioPurgeAt, 0);
});
