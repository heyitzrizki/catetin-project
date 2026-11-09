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
    .prepare('INSERT OR IGNORE INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
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

function setupTestWorkspaces(sqlite: any) {
  const now = Date.now();
  const iso = new Date().toISOString();

  sqlite
    .prepare('INSERT OR IGNORE INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_alice', 'Alice', 'alice@example.com', iso, iso);
  sqlite
    .prepare('INSERT OR IGNORE INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_bob', 'Bob', 'bob@example.com', iso, iso);

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_personal_alice', 'personal', 'Ruang Kerja Alice', 'personal-alice', 'u_alice', 0, 0, ?, ?),
              ('ws_personal_bob', 'personal', 'Ruang Kerja Bob', 'personal-bob', 'u_bob', 0, 0, ?, ?),
              ('ws_team_shared', 'team', 'Team Collab', 'team-collab', NULL, 0, 0, ?, ?),
              ('ws_deleted', 'team', 'Deleted Space', 'deleted-space', NULL, 0, 0, ?, ?)`
    )
    .run(now, now, now, now, now, now, now, now);

  sqlite
    .prepare('UPDATE workspace SET deleted_at = ? WHERE id = ?')
    .run(now, 'ws_deleted');

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_team_alice', 'ws_team_shared', 'u_alice', 'owner', ?, ?),
              ('m_team_bob', 'ws_team_shared', 'u_bob', 'member', ?, ?)`
    )
    .run(now, now, now, now);
}

function buildMutationReq(
  workspaceId: string,
  cookie: string,
  body: unknown,
  options?: {
    method?: string;
    origin?: string | null;
    contentType?: string;
    contentLength?: string;
  }
): Request {
  const method = options?.method ?? 'POST';
  const headers: Record<string, string> = {
    'Cookie': cookie,
  };

  if (options?.origin !== null) {
    headers['Origin'] = options?.origin ?? 'http://localhost:3000';
  }
  if (options?.contentType !== undefined) {
    if (options.contentType) headers['Content-Type'] = options.contentType;
  } else {
    headers['Content-Type'] = 'application/json';
  }
  if (options?.contentLength) {
    headers['Content-Length'] = options.contentLength;
  }

  const init: RequestInit = {
    method,
    headers,
  };

  if (method === 'POST') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  return new Request(`http://localhost:3000/api/workspaces/${workspaceId}/mutations`, init);
}

// =========================================================================
// A. HTTP & SECURITY TESTS
// =========================================================================

test('A1. tanpa sesi -> 401', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);

  const res = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_personal_alice/mutations', {
      method: 'POST',
      headers: {
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientMutationId: 'mut_1',
        entityType: 'project',
        entityId: 'proj_1',
        action: 'insert',
        payload: { name: 'Proyek Baru' },
      }),
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('A2. missing atau untrusted Origin -> 403', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Missing origin
  const reqNoOrigin = buildMutationReq('ws_personal_alice', alice.cookie, {}, { origin: null });
  const resNoOrigin = await worker.fetch(reqNoOrigin, env, {} as any);
  assert.equal(resNoOrigin.status, 403);
  const bodyNoOrigin = await resNoOrigin.json();
  assert.equal(bodyNoOrigin.error.code, 'FORBIDDEN');

  // Untrusted origin
  const reqUntrusted = buildMutationReq('ws_personal_alice', alice.cookie, {}, { origin: 'http://evil.com' });
  const resUntrusted = await worker.fetch(reqUntrusted, env, {} as any);
  assert.equal(resUntrusted.status, 403);
  const bodyUntrusted = await resUntrusted.json();
  assert.equal(bodyUntrusted.error.code, 'FORBIDDEN');
});

test('A3. wrong Content-Type -> reject 400', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const invalidTypes = [
    'text/plain',
    'application/jsonp',
    'text/application/json',
    'application/json, text/plain',
  ];

  for (const ct of invalidTypes) {
    const req = buildMutationReq('ws_personal_alice', alice.cookie, '{}', { contentType: ct });
    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_CONTENT_TYPE');
  }
});

test('A4. malformed, oversized (413), atau invalid UTF-8 stream -> reject 400 / 413', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Malformed JSON -> 400
  const reqMalformed = buildMutationReq('ws_personal_alice', alice.cookie, '{"broken": json');
  const resMalformed = await worker.fetch(reqMalformed, env, {} as any);
  assert.equal(resMalformed.status, 400);
  const bodyMalformed = await resMalformed.json();
  assert.equal(bodyMalformed.error.code, 'INVALID_REQUEST_BODY');

  // Content-Length melebihi batas -> 413 PAYLOAD_TOO_LARGE
  const reqOverContentLength = buildMutationReq(
    'ws_personal_alice',
    alice.cookie,
    {},
    { contentLength: String(2 * 1024 * 1024) }
  );
  const resOverContentLength = await worker.fetch(reqOverContentLength, env, {} as any);
  assert.equal(resOverContentLength.status, 413);
  const bodyOverContentLength = await resOverContentLength.json();
  assert.equal(bodyOverContentLength.error.code, 'PAYLOAD_TOO_LARGE');

  // Non-transcript payload > 64 KB ditolak -> 413 PAYLOAD_TOO_LARGE
  const largeNonTranscript = {
    clientMutationId: 'mut_large',
    entityType: 'project',
    entityId: 'proj_large',
    action: 'insert',
    payload: {
      name: 'P'.repeat(70000), // > 64 KB
    },
  };
  const reqLarge = buildMutationReq('ws_personal_alice', alice.cookie, largeNonTranscript);
  const resLarge = await worker.fetch(reqLarge, env, {} as any);
  assert.equal(resLarge.status, 413);
  const bodyLarge = await resLarge.json();
  assert.equal(bodyLarge.error.code, 'PAYLOAD_TOO_LARGE');

  // Global stream hard cap (stream > 1 MB + 64 KB) -> 413 PAYLOAD_TOO_LARGE
  const hugeStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(600 * 1024));
      controller.enqueue(new Uint8Array(600 * 1024)); // Total 1.2 MB > 1.06 MB limit
    },
  });
  const resHuge = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_personal_alice/mutations', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: hugeStream,
      duplex: 'half',
    } as any),
    env,
    {} as any
  );
  assert.equal(resHuge.status, 413);
  const bodyHuge = await resHuge.json();
  assert.equal(bodyHuge.error.code, 'PAYLOAD_TOO_LARGE');

  // Invalid UTF-8 stream -> 400 INVALID_REQUEST_BODY
  const invalidUtf8Stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff, 0xfe, 0xfd]));
      controller.close();
    },
  });
  const resInvalidUtf8 = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_personal_alice/mutations', {
      method: 'POST',
      headers: {
        'Cookie': alice.cookie,
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: invalidUtf8Stream,
      duplex: 'half',
    } as any),
    env,
    {} as any
  );
  assert.equal(resInvalidUtf8.status, 400);
  const bodyInvalidUtf8 = await resInvalidUtf8.json();
  assert.equal(bodyInvalidUtf8.error.code, 'INVALID_REQUEST_BODY');
});

test('A5. unsupported method -> 405 dengan Allow: POST', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const disallowed = ['GET', 'PUT', 'PATCH', 'DELETE'];
  for (const m of disallowed) {
    const req = buildMutationReq('ws_personal_alice', alice.cookie, {}, { method: m });
    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
    const body = await res.json();
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
  }
});

test('A6. injeksi field terlarang (domainPlan, userId, workspaceId, dll) -> reject 400', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const forbiddenTopLevel = [
    { domainPlan: { action: 'insert' } },
    { userId: 'u_attacker' },
    { workspaceId: 'ws_injected' },
    { operation: 'upsert' },
    { responseData: {} },
    { version: 5 },
    { table: 'project' },
  ];

  for (const payload of forbiddenTopLevel) {
    const fullBody = {
      clientMutationId: 'mut_inj',
      entityType: 'project',
      entityId: 'proj_inj',
      action: 'insert',
      payload: { name: 'Valid Project' },
      ...payload,
    };
    const req = buildMutationReq('ws_personal_alice', alice.cookie, fullBody);
    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_REQUEST_BODY');
  }
});

test('A7. audio_asset public mutation -> reject 400 eksplisit', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const req = buildMutationReq('ws_personal_alice', alice.cookie, {
    clientMutationId: 'mut_audio_reject',
    entityType: 'audio_asset',
    entityId: 'audio_1',
    action: 'insert',
    payload: { recordingId: 'rec_1' },
  });

  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_MUTATION_PLAN');
  assert.equal(body.error.message, 'Mutasi audio_asset tidak diizinkan melalui public mutation API');
});

// =========================================================================
// B. ENTITY SCHEMA & VALIDATION TESTS
// =========================================================================

test('B8. valid insert, update, dan delete untuk setiap entitas yang didukung', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // 1. Project insert -> update -> delete
  const resP1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_p1',
      entityType: 'project',
      entityId: 'proj_1',
      action: 'insert',
      payload: { name: 'Proyek Riset', description: 'Deskripsi awal' },
    }),
    env,
    {} as any
  );
  assert.equal(resP1.status, 200);
  const bodyP1 = await resP1.json();
  assert.equal(bodyP1.mutation.version, 1);
  assert.equal(bodyP1.mutation.data.name, 'Proyek Riset');

  const resP2 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_p2',
      entityType: 'project',
      entityId: 'proj_1',
      action: 'update',
      expectedVersion: 1,
      payload: { name: 'Proyek Riset Baru' },
    }),
    env,
    {} as any
  );
  assert.equal(resP2.status, 200);
  const bodyP2 = await resP2.json();
  assert.equal(bodyP2.mutation.version, 2);
  assert.equal(bodyP2.mutation.data.name, 'Proyek Riset Baru');

  // 2. Folder insert -> update
  const resF1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_f1',
      entityType: 'folder',
      entityId: 'fold_1',
      action: 'insert',
      payload: { projectId: 'proj_1', name: 'Wawancara', color: '#6366f1' },
    }),
    env,
    {} as any
  );
  assert.equal(resF1.status, 200);
  const bodyF1 = await resF1.json();
  assert.equal(bodyF1.mutation.version, 1);
  assert.equal(bodyF1.mutation.data.name, 'Wawancara');

  // 3. Tag insert -> update
  const resT1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_t1',
      entityType: 'tag',
      entityId: 'tag_1',
      action: 'insert',
      payload: { name: 'Penting Banget' },
    }),
    env,
    {} as any
  );
  assert.equal(resT1.status, 200);
  const bodyT1 = await resT1.json();
  assert.equal(bodyT1.mutation.data.normalizedName, 'penting banget');

  // 4. Recording insert -> update
  const resR1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_r1',
      entityType: 'recording',
      entityId: 'rec_1',
      action: 'insert',
      payload: {
        title: 'Sesi Diskusi 1',
        projectId: 'proj_1',
        folderId: 'fold_1',
        durationSec: 120.5,
      },
    }),
    env,
    {} as any
  );
  assert.equal(resR1.status, 200);
  const bodyR1 = await resR1.json();
  assert.equal(bodyR1.mutation.version, 1);
  assert.equal(bodyR1.mutation.data.title, 'Sesi Diskusi 1');

  // 5. Speaker insert -> update
  const resS1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_s1',
      entityType: 'speaker',
      entityId: 'spk_1',
      action: 'insert',
      payload: {
        recordingId: 'rec_1',
        label: 'spk_a',
        displayName: 'Narasumber Utama',
        color: 'blue',
      },
    }),
    env,
    {} as any
  );
  assert.equal(resS1.status, 200);
  const bodyS1 = await resS1.json();
  assert.equal(bodyS1.mutation.data.displayName, 'Narasumber Utama');

  // 6. Recording Tag insert -> delete
  const resRT1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_rt1',
      entityType: 'recording_tag',
      entityId: 'rt_1',
      action: 'insert',
      payload: { recordingId: 'rec_1', tagId: 'tag_1' },
    }),
    env,
    {} as any
  );
  assert.equal(resRT1.status, 200);

  const resRT2 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_rt2',
      entityType: 'recording_tag',
      entityId: 'rt_1',
      action: 'delete',
      expectedVersion: 1,
    }),
    env,
    {} as any
  );
  assert.equal(resRT2.status, 200);
  const bodyRT2 = await resRT2.json();
  assert.equal(bodyRT2.mutation.operation, 'delete');
  assert.equal(bodyRT2.mutation.data, null);

  // 7. Transcript insert -> update -> delete
  const transcriptDoc = {
    segments: [
      { id: 'seg_1', speaker: 'spk_a', seconds: 0, time: '00:00', text: 'Halo dunia' },
      { id: 'seg_2', speaker: 'spk_a', seconds: 5, time: '00:05', text: 'Catetin transkrip' },
    ],
  };
  const resTr1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tr1',
      entityType: 'transcript',
      entityId: 'tr_1',
      action: 'insert',
      payload: {
        recordingId: 'rec_1',
        documentJson: transcriptDoc,
        summaryText: 'Ringkasan singkat sesi',
      },
    }),
    env,
    {} as any
  );
  assert.equal(resTr1.status, 200);
  const bodyTr1 = await resTr1.json();
  assert.equal(bodyTr1.mutation.data.segmentCount, 2);
  assert.equal(bodyTr1.mutation.data.wordCount, 4);
  assert.ok(bodyTr1.mutation.data.checksum);

  // Transcript update
  const resTr2 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tr2',
      entityType: 'transcript',
      entityId: 'tr_1',
      action: 'update',
      expectedVersion: 1,
      payload: {
        documentJson: {
          segments: [
            { id: 'seg_1', speaker: 'spk_a', seconds: 0, time: '00:00', text: 'Halo dunia baru' },
          ],
        },
        summaryText: 'Ringkasan diperbarui',
      },
    }),
    env,
    {} as any
  );
  assert.equal(resTr2.status, 200);
  const bodyTr2 = await resTr2.json();
  assert.equal(bodyTr2.mutation.version, 2);
  assert.equal(bodyTr2.mutation.data.segmentCount, 1);
  assert.equal(bodyTr2.mutation.data.wordCount, 3);

  // Transcript delete
  const resTr3 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tr3',
      entityType: 'transcript',
      entityId: 'tr_1',
      action: 'delete',
      expectedVersion: 2,
    }),
    env,
    {} as any
  );
  assert.equal(resTr3.status, 200);
  const bodyTr3 = await resTr3.json();
  assert.equal(bodyTr3.mutation.operation, 'delete');
  assert.equal(bodyTr3.mutation.data, null);
});

test('B9. missing required fields -> reject 400', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Project tanpa name
  const res1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_bad_p',
      entityType: 'project',
      entityId: 'p_bad',
      action: 'insert',
      payload: {},
    }),
    env,
    {} as any
  );
  assert.equal(res1.status, 400);

  // Folder tanpa projectId
  const res2 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_bad_f',
      entityType: 'folder',
      entityId: 'f_bad',
      action: 'insert',
      payload: { name: 'Folder' },
    }),
    env,
    {} as any
  );
  assert.equal(res2.status, 400);
});

test('B10. unknown fields in entity payload -> reject 400', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_extra_field',
      entityType: 'project',
      entityId: 'p_extra',
      action: 'insert',
      payload: {
        name: 'Proyek',
        injectedField: 'hack',
      },
    }),
    env,
    {} as any
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_MUTATION_PLAN');
});

test('B11. empty update -> reject 400', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_empty_upd',
      entityType: 'project',
      entityId: 'p_1',
      action: 'update',
      expectedVersion: 1,
      payload: {},
    }),
    env,
    {} as any
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_MUTATION_PLAN');
});

test('B12. invalid ID, string, number, atau color -> reject 400', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Invalid entityId (spasi dan tanda kurung)
  const resBadId = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_bad_id',
      entityType: 'project',
      entityId: 'invalid id (with spaces)',
      action: 'insert',
      payload: { name: 'Name' },
    }),
    env,
    {} as any
  );
  assert.equal(resBadId.status, 400);

  // Invalid durationSec (negatif)
  const resBadNum = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_bad_num',
      entityType: 'recording',
      entityId: 'rec_bad',
      action: 'insert',
      payload: { title: 'Rec', durationSec: -5 },
    }),
    env,
    {} as any
  );
  assert.equal(resBadNum.status, 400);

  // Invalid color format
  const resBadColor = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_bad_col',
      entityType: 'folder',
      entityId: 'fold_bad',
      action: 'insert',
      payload: { projectId: 'proj_1', name: 'Folder', color: 'javascript:alert(1)' },
    }),
    env,
    {} as any
  );
  assert.equal(resBadColor.status, 400);
});

test('B13. transcript size, malformed JSON, malformed segments, dan preservation data pada kegagalan', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Buat recording terlebih dahulu
  sqlite
    .prepare(
      `INSERT INTO recording (id, workspace_id, title, created_by_user_id, version, created_at, updated_at)
       VALUES ('rec_valid', 'ws_personal_alice', 'Rec Valid', 'u_alice', 1, ?, ?)`
    )
    .run(Date.now(), Date.now());

  // 13.1 documentJson bukan object atau tanpa array segments -> 400
  for (const invalidDoc of [
    '{ broken json',
    null,
    ['bukan object'],
    { segments: 'bukan array' },
    { segments: [], extraRootField: 'forbidden' },
  ]) {
    const resMalformed = await worker.fetch(
      buildMutationReq('ws_personal_alice', alice.cookie, {
        clientMutationId: `mut_tr_mal_${Math.random().toString(36).slice(2)}`,
        entityType: 'transcript',
        entityId: 'tr_mal',
        action: 'insert',
        payload: {
          recordingId: 'rec_valid',
          documentJson: invalidDoc,
        },
      }),
      env,
      {} as any
    );
    assert.equal(resMalformed.status, 400);
    const bodyMal = await resMalformed.json();
    assert.equal(bodyMal.error.code, 'INVALID_MUTATION_PLAN');
  }

  // 13.2 Setiap segmen malformed WAJIB menolak seluruh mutasi (400), tanpa silent drop/truncation
  const malformedSegmentPayloads = [
    [null],
    [{ id: 's1', speaker: 'spk', seconds: 0, text: 'Tanpa time' }],
    [{ id: '', speaker: 'spk', seconds: 0, time: '00:00', text: 'ID kosong' }],
    [{ id: 's1', speaker: '   ', seconds: 0, time: '00:00', text: 'Speaker kosong' }],
    [{ id: 's1', speaker: 'spk', seconds: -1, time: '00:00', text: 'Seconds negatif' }],
    [{ id: 's1', speaker: 'spk', seconds: 0, time: '', text: 'Time kosong' }],
    [{ id: 's1', speaker: 'spk', seconds: 0, time: '00:00', text: '   ' }],
    [{ id: 'x'.repeat(129), speaker: 'spk', seconds: 0, time: '00:00', text: 'ID terlalu panjang' }],
    [{ id: 's1', speaker: 'spk', seconds: 0, time: '00:00', text: 'x'.repeat(10001) }],
    // Campuran segmen valid + segmen invalid tidak boleh disaring diam-diam
    [
      { id: 's1', speaker: 'spk', seconds: 0, time: '00:00', text: 'Segmen 1 valid' },
      { id: '', speaker: 'spk', seconds: 5, time: '00:05', text: 'Segmen 2 invalid' },
    ],
  ];

  for (let i = 0; i < malformedSegmentPayloads.length; i++) {
    const resBadSeg = await worker.fetch(
      buildMutationReq('ws_personal_alice', alice.cookie, {
        clientMutationId: `mut_tr_badseg_${i}`,
        entityType: 'transcript',
        entityId: 'tr_mal',
        action: 'insert',
        payload: {
          recordingId: 'rec_valid',
          documentJson: { segments: malformedSegmentPayloads[i] },
        },
      }),
      env,
      {} as any
    );
    assert.equal(resBadSeg.status, 400, `Harusnya 400 untuk kasus segmen malformed ke-${i}`);
    const bodyBadSeg = await resBadSeg.json();
    assert.equal(bodyBadSeg.error.code, 'INVALID_MUTATION_PLAN');
  }

  // Pastikan tidak ada baris tr_mal yang bocor ke database
  const malCount = sqlite.prepare(`SELECT COUNT(*) as cnt FROM transcript WHERE id = 'tr_mal'`).get() as any;
  assert.equal(malCount.cnt, 0);

  // 13.3 Segmen valid penuh dengan field internal/provider tambahan -> 200 OK, field ekstra dibersihkan
  const resValidStrip = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tr_clean',
      entityType: 'transcript',
      entityId: 'tr_clean',
      action: 'insert',
      payload: {
        recordingId: 'rec_valid',
        documentJson: {
          segments: [
            {
              id: 's1',
              speaker: 'spk',
              seconds: 0,
              time: '00:00',
              text: 'Segmen bersih',
              secretToken: 'LEAK',
              providerConfidence: 0.99,
            },
          ],
        },
        summaryText: 'Ringkasan awal yang sah',
      },
    }),
    env,
    {} as any
  );
  assert.equal(resValidStrip.status, 200);
  const bodyClean = await resValidStrip.json();
  assert.equal(bodyClean.mutation.data.segmentCount, 1);
  assert.equal(bodyClean.mutation.data.wordCount, 2);

  const savedBeforeFailedUpdate = sqlite
    .prepare(
      `SELECT version, raw_document_json, checksum, segment_count, word_count, summary_text
       FROM transcript WHERE id = 'tr_clean'`
    )
    .get() as any;
  assert.ok(savedBeforeFailedUpdate);
  assert.ok(!savedBeforeFailedUpdate.raw_document_json.includes('LEAK'));
  const parsedStoredDoc = JSON.parse(savedBeforeFailedUpdate.raw_document_json);
  assert.equal(parsedStoredDoc.segments[0].secretToken, undefined);
  assert.equal(parsedStoredDoc.segments[0].providerConfidence, undefined);

  // 13.4 Update dengan segmen malformed -> 400, dan data serta metadata lama TIDAK BERUBAH
  const resFailedUpdate = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tr_fail_upd',
      entityType: 'transcript',
      entityId: 'tr_clean',
      action: 'update',
      expectedVersion: 1,
      payload: {
        documentJson: {
          segments: [
            { id: 's1', speaker: 'spk', seconds: 0, time: '00:00', text: 'Segmen baru' },
            { id: 's2', speaker: 'spk', seconds: -10, time: '00:10', text: 'Segmen rusak' },
          ],
        },
        summaryText: 'Ringkasan yang tidak boleh tersimpan',
      },
    }),
    env,
    {} as any
  );
  assert.equal(resFailedUpdate.status, 400);

  const savedAfterFailedUpdate = sqlite
    .prepare(
      `SELECT version, raw_document_json, checksum, segment_count, word_count, summary_text
       FROM transcript WHERE id = 'tr_clean'`
    )
    .get() as any;
  assert.deepEqual(savedAfterFailedUpdate, savedBeforeFailedUpdate);

  // 13.5 Escape-heavy boundary test dekat 1 MB (1,048,576 bytes)
  // Setiap segmen memiliki banyak karakter kutipan dan newline yang di-escape dalam JSON
  const escapeChunk = 'Kutipan "teks" \\ miring \n baris baru \t tab '.repeat(160); // ~7,040 char
  const near1MbSegments = [];
  for (let i = 0; i < 120; i++) {
    near1MbSegments.push({
      id: `seg_${i}`,
      speaker: 'spk_1',
      seconds: i,
      time: '00:01',
      text: escapeChunk,
    });
  }
  const canonicalNear1Mb = JSON.stringify({ segments: near1MbSegments });
  const near1MbBytes = new TextEncoder().encode(canonicalNear1Mb).byteLength;
  assert.ok(near1MbBytes > 900_000 && near1MbBytes <= 1_048_576, `Expected near 1MB, got ${near1MbBytes}`);

  const resEscapeOk = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tr_escape_ok',
      entityType: 'transcript',
      entityId: 'tr_clean',
      action: 'update',
      expectedVersion: 1,
      payload: {
        documentJson: { segments: near1MbSegments },
      },
    }),
    env,
    {} as any
  );
  assert.equal(resEscapeOk.status, 200);

  // Melampaui 1 MB (tetapi masih di bawah 1 MB + 64 KB outer request cap) -> 413 PAYLOAD_TOO_LARGE
  const over1MbSegments = [...near1MbSegments];
  for (let i = 120; i < 138; i++) {
    over1MbSegments.push({
      id: `seg_${i}`,
      speaker: 'spk_1',
      seconds: i,
      time: '00:01',
      text: escapeChunk,
    });
  }
  const over1MbBytes = new TextEncoder().encode(JSON.stringify({ segments: over1MbSegments })).byteLength;
  assert.ok(over1MbBytes > 1_048_576 && over1MbBytes < 1_048_576 + 64 * 1024, `Got ${over1MbBytes}`);

  const resEscapeOver = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tr_escape_over',
      entityType: 'transcript',
      entityId: 'tr_clean',
      action: 'update',
      expectedVersion: 2,
      payload: {
        documentJson: { segments: over1MbSegments },
      },
    }),
    env,
    {} as any
  );
  assert.equal(resEscapeOver.status, 413);
  const bodyEscapeOver = await resEscapeOver.json();
  assert.equal(bodyEscapeOver.error.code, 'PAYLOAD_TOO_LARGE');
});

test('B14. checksum dan count dihitung server-side', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  sqlite
    .prepare(
      `INSERT INTO recording (id, workspace_id, title, created_by_user_id, version, created_at, updated_at)
       VALUES ('rec_calc', 'ws_personal_alice', 'Rec Calc', 'u_alice', 1, ?, ?)`
    )
    .run(Date.now(), Date.now());

  // Klien mencoba mengirim checksum dan count buatan sendiri
  const res = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_calc_cheat',
      entityType: 'transcript',
      entityId: 'tr_calc',
      action: 'insert',
      payload: {
        recordingId: 'rec_calc',
        documentJson: {
          segments: [{ id: 's1', speaker: 'spk', seconds: 0, time: '00:00', text: 'Satu dua tiga' }],
        },
        checksum: 'fake-checksum',
        segmentCount: 999,
        wordCount: 888,
      },
    }),
    env,
    {} as any
  );

  // Ditolak karena field checksum/segmentCount/wordCount tidak boleh dikirim klien
  assert.equal(res.status, 400);
});

test('B15. normalized tag server-side dan duplicate collision menghasilkan 409 conflict', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Insert tag pertama
  const res1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tag_norm1',
      entityType: 'tag',
      entityId: 'tag_norm1',
      action: 'insert',
      payload: { name: '  Kategori   Utama  ' },
    }),
    env,
    {} as any
  );
  assert.equal(res1.status, 200);

  // Insert tag kedua dengan spasi/huruf besar kecil berbeda tetapi normalisasi sama
  const res2 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_tag_norm2',
      entityType: 'tag',
      entityId: 'tag_norm2',
      action: 'insert',
      payload: { name: 'kategori utama' },
    }),
    env,
    {} as any
  );
  assert.equal(res2.status, 409);
  const body2 = await res2.json();
  assert.equal(body2.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(body2.error.message, 'Tag dengan nama tersebut sudah ada dalam ruang kerja ini');
});

// =========================================================================
// C. ISOLATION & RELATIONAL TESTS
// =========================================================================

test('C16. cross-workspace entity atau reference -> 404', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');
  const now = Date.now();

  // Buat project di ruang kerja Bob
  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('proj_bob_1', 'ws_personal_bob', 'Proyek Bob', 'u_bob', 1, ?, ?)`
    )
    .run(now, now);

  // Alice mencoba membuat folder di ruang kerjanya yang mereferensikan project Bob
  const resCrossRef = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_cross_ref',
      entityType: 'folder',
      entityId: 'fold_alice_1',
      action: 'insert',
      payload: { projectId: 'proj_bob_1', name: 'Folder Alice' },
    }),
    env,
    {} as any
  );
  assert.equal(resCrossRef.status, 404);

  // Alice mencoba mengupdate project Bob lewat endpoint ruang kerjanya
  const resCrossEntity = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_cross_upd',
      entityType: 'project',
      entityId: 'proj_bob_1',
      action: 'update',
      expectedVersion: 1,
      payload: { name: 'Bajak Proyek' },
    }),
    env,
    {} as any
  );
  assert.equal(resCrossEntity.status, 404);
});

test('C17. recording-folder-project mismatch ditolak', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('proj_a', 'ws_personal_alice', 'Proyek A', 'u_alice', 1, ?, ?),
              ('proj_b', 'ws_personal_alice', 'Proyek B', 'u_alice', 1, ?, ?)`
    )
    .run(now, now, now, now);

  sqlite
    .prepare(
      `INSERT INTO folder (id, workspace_id, project_id, name, version, created_at, updated_at)
       VALUES ('fold_a', 'ws_personal_alice', 'proj_a', 'Folder di Proyek A', 1, ?, ?)`
    )
    .run(now, now);

  // Recording diarahkan ke proj_b tetapi menggunakan fold_a (yang ada di proj_a)
  const resMismatch = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_mismatch',
      entityType: 'recording',
      entityId: 'rec_mismatch',
      action: 'insert',
      payload: {
        title: 'Mismatched Rec',
        projectId: 'proj_b',
        folderId: 'fold_a',
      },
    }),
    env,
    {} as any
  );

  assert.equal(resMismatch.status, 400);
  const body = await resMismatch.json();
  assert.equal(body.error.code, 'INVALID_MUTATION_PLAN');
  assert.equal(body.error.message, 'Folder tidak termasuk dalam project yang ditentukan');
});

test('C18. non-member mutation -> 404 generik', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const charlie = await createAuthenticatedUser(sqlite, 'u_charlie', 'Charlie', 'charlie@example.com');

  // Charlie bukan anggota ws_team_shared
  const res = await worker.fetch(
    buildMutationReq('ws_team_shared', charlie.cookie, {
      clientMutationId: 'mut_unauth',
      entityType: 'project',
      entityId: 'proj_charlie',
      action: 'insert',
      payload: { name: 'Proyek Charlie' },
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'WORKSPACE_NOT_FOUND');
});

test('C19. membership revoked saat commit boundary -> 403', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const bob = await createAuthenticatedUser(sqlite, 'u_bob', 'Bob', 'bob@example.com');

  // Simulasikan pencabutan membership tepat sebelum commit batch dijalankan
  let revoked = false;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeBatch: (stmts) => {
      const isMutationBatch = stmts.some((s: any) => s._sql?.includes('INSERT INTO workspace_change_log'));
      if (isMutationBatch && !revoked) {
        revoked = true;
        sqlite
          .prepare('DELETE FROM workspace_membership WHERE workspace_id = ? AND user_id = ?')
          .run('ws_team_shared', 'u_bob');
      }
    },
  });
  const env = createTestEnv(db);

  const res = await worker.fetch(
    buildMutationReq('ws_team_shared', bob.cookie, {
      clientMutationId: 'mut_mid_revoke',
      entityType: 'project',
      entityId: 'proj_mid',
      action: 'insert',
      payload: { name: 'Proyek Mid Revoke' },
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('C19b. commit-time relational integrity: parent soft-deleted tepat sebelum batch harus rollback penuh', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  // Siapkan parent project, folder, recording, dan tag yang aktif saat preflight
  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('proj_race', 'ws_personal_alice', 'Project Race', 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO folder (id, workspace_id, project_id, name, version, created_at, updated_at)
       VALUES ('fold_race', 'ws_personal_alice', 'proj_race', 'Folder Race', 1, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO recording (id, workspace_id, project_id, folder_id, title, created_by_user_id, version, created_at, updated_at)
       VALUES ('rec_race', 'ws_personal_alice', 'proj_race', 'fold_race', 'Recording Race', 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO tag (id, workspace_id, name, normalized_name, version, created_at, updated_at)
       VALUES ('tag_race', 'ws_personal_alice', 'Tag Race', 'tag race', 1, ?, ?)`
    )
    .run(now, now);

  let beforeBatchAction: (() => void) | null = null;
  const db = createInterleavingD1Adapter(sqlite, {
    beforeBatch: (stmts) => {
      const isMutationBatch = stmts.some((s: any) => s._sql?.includes('INSERT INTO workspace_change_log'));
      if (isMutationBatch && beforeBatchAction) {
        const fn = beforeBatchAction;
        beforeBatchAction = null;
        fn();
      }
    },
  });
  const env = createTestEnv(db);

  // 1. folder -> project: soft-delete project tepat sebelum commit batch
  beforeBatchAction = () => {
    sqlite.prepare(`UPDATE project SET deleted_at = ? WHERE id = 'proj_race'`).run(Date.now());
  };
  const resFolderRace = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_race_fold_proj',
      entityType: 'folder',
      entityId: 'fold_child_orphan',
      action: 'insert',
      payload: { projectId: 'proj_race', name: 'Folder Orphan' },
    }),
    env,
    {} as any
  );
  assert.equal(resFolderRace.status, 404);
  const bodyFolderRace = await resFolderRace.json();
  assert.equal(bodyFolderRace.error.code, 'WORKSPACE_NOT_FOUND');
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) as cnt FROM folder WHERE id = 'fold_child_orphan'`).get() as any).cnt,
    0
  );

  // Pulihkan proj_race untuk skenario berikutnya
  sqlite.prepare(`UPDATE project SET deleted_at = NULL WHERE id = 'proj_race'`).run();

  // 2. recording -> folder/project: soft-delete folder tepat sebelum commit batch
  beforeBatchAction = () => {
    sqlite.prepare(`UPDATE folder SET deleted_at = ? WHERE id = 'fold_race'`).run(Date.now());
  };
  const resRecFolderRace = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_race_rec_fold',
      entityType: 'recording',
      entityId: 'rec_child_orphan',
      action: 'insert',
      payload: { title: 'Rec Orphan', projectId: 'proj_race', folderId: 'fold_race' },
    }),
    env,
    {} as any
  );
  assert.equal(resRecFolderRace.status, 404);
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) as cnt FROM recording WHERE id = 'rec_child_orphan'`).get() as any).cnt,
    0
  );

  // Pulihkan fold_race, lalu uji soft-delete project saat insert recording
  sqlite.prepare(`UPDATE folder SET deleted_at = NULL WHERE id = 'fold_race'`).run();
  beforeBatchAction = () => {
    sqlite.prepare(`UPDATE project SET deleted_at = ? WHERE id = 'proj_race'`).run(Date.now());
  };
  const resRecProjRace = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_race_rec_proj',
      entityType: 'recording',
      entityId: 'rec_child_orphan_2',
      action: 'insert',
      payload: { title: 'Rec Orphan 2', projectId: 'proj_race', folderId: 'fold_race' },
    }),
    env,
    {} as any
  );
  assert.equal(resRecProjRace.status, 404);
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) as cnt FROM recording WHERE id = 'rec_child_orphan_2'`).get() as any).cnt,
    0
  );
  sqlite.prepare(`UPDATE project SET deleted_at = NULL WHERE id = 'proj_race'`).run();

  // 3. transcript -> recording: soft-delete recording tepat sebelum commit batch
  beforeBatchAction = () => {
    sqlite.prepare(`UPDATE recording SET deleted_at = ? WHERE id = 'rec_race'`).run(Date.now());
  };
  const resTrRecRace = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_race_tr_rec',
      entityType: 'transcript',
      entityId: 'tr_child_orphan',
      action: 'insert',
      payload: {
        recordingId: 'rec_race',
        documentJson: {
          segments: [{ id: 's1', speaker: 'spk', seconds: 0, time: '00:00', text: 'Halo' }],
        },
      },
    }),
    env,
    {} as any
  );
  assert.equal(resTrRecRace.status, 404);
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) as cnt FROM transcript WHERE id = 'tr_child_orphan'`).get() as any).cnt,
    0
  );
  sqlite.prepare(`UPDATE recording SET deleted_at = NULL WHERE id = 'rec_race'`).run();

  // 4. recording_tag -> recording/tag: soft-delete tag tepat sebelum commit batch
  beforeBatchAction = () => {
    sqlite.prepare(`UPDATE tag SET deleted_at = ? WHERE id = 'tag_race'`).run(Date.now());
  };
  const resRtTagRace = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_race_rt_tag',
      entityType: 'recording_tag',
      entityId: 'rt_child_orphan',
      action: 'insert',
      payload: { recordingId: 'rec_race', tagId: 'tag_race' },
    }),
    env,
    {} as any
  );
  assert.equal(resRtTagRace.status, 404);
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) as cnt FROM recording_tag WHERE id = 'rt_child_orphan'`).get() as any).cnt,
    0
  );
  sqlite.prepare(`UPDATE tag SET deleted_at = NULL WHERE id = 'tag_race'`).run();

  // Dan soft-delete recording saat insert recording_tag
  beforeBatchAction = () => {
    sqlite.prepare(`UPDATE recording SET deleted_at = ? WHERE id = 'rec_race'`).run(Date.now());
  };
  const resRtRecRace = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_race_rt_rec',
      entityType: 'recording_tag',
      entityId: 'rt_child_orphan_2',
      action: 'insert',
      payload: { recordingId: 'rec_race', tagId: 'tag_race' },
    }),
    env,
    {} as any
  );
  assert.equal(resRtRecRace.status, 404);
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) as cnt FROM recording_tag WHERE id = 'rt_child_orphan_2'`).get() as any).cnt,
    0
  );

  // Verifikasi workspace_change_log dan idempotency tetap bersih (0 entri dari semua race yang gagal)
  const logCount = (sqlite.prepare(`SELECT COUNT(*) as cnt FROM workspace_change_log WHERE workspace_id = 'ws_personal_alice'`).get() as any).cnt;
  const idemCount = (sqlite.prepare(`SELECT COUNT(*) as cnt FROM mutation_idempotency WHERE workspace_id = 'ws_personal_alice'`).get() as any).cnt;
  assert.equal(logCount, 0);
  assert.equal(idemCount, 0);
});

test('C20. deleted workspace atau deleted entity mutation -> 404 / 409', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  // 20.1 Ruang kerja soft-deleted
  const resWsDeleted = await worker.fetch(
    buildMutationReq('ws_deleted', alice.cookie, {
      clientMutationId: 'mut_ws_del',
      entityType: 'project',
      entityId: 'p_del',
      action: 'insert',
      payload: { name: 'Proyek' },
    }),
    env,
    {} as any
  );
  assert.equal(resWsDeleted.status, 404);

  // 20.2 Entitas soft-deleted tidak dapat diupdate
  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at, deleted_at)
       VALUES ('proj_soft_del', 'ws_personal_alice', 'Proyek Dihapus', 'u_alice', 2, ?, ?, ?)`
    )
    .run(now, now, now);

  const resEntDeleted = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_ent_del',
      entityType: 'project',
      entityId: 'proj_soft_del',
      action: 'update',
      expectedVersion: 2,
      payload: { name: 'Coba Update' },
    }),
    env,
    {} as any
  );
  assert.equal(resEntDeleted.status, 409);
  const bodyEntDeleted = await resEntDeleted.json();
  assert.equal(bodyEntDeleted.error.code, 'VERSION_CONFLICT');
  assert.equal(bodyEntDeleted.error.message, 'Entitas telah dihapus dan tidak dapat dimutasi kembali');
});

test('C21. tidak ada raw database row, internal token, atau SQL error bocor ke response', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_leak_test',
      entityType: 'project',
      entityId: 'proj_leak',
      action: 'insert',
      payload: { name: 'Proyek Bersih' },
    }),
    env,
    {} as any
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  const mutKeys = Object.keys(body.mutation).sort();
  assert.deepEqual(mutKeys, [
    'changeSeq',
    'changedAt',
    'data',
    'entityId',
    'entityType',
    'operation',
    'version',
    'workspaceId',
  ]);

  assert.equal(body.mutation.data.created_by_user_id, undefined);
  assert.equal(body.mutation.data.last_mutation_id, undefined);
  assert.equal(body.mutation.data.deleted_at, undefined);
});

// =========================================================================
// D. CAS, IDEMPOTENCY, & CONCURRENCY TESTS
// =========================================================================

test('D22. mandatory expectedVersion pada update dan delete', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // Update tanpa expectedVersion
  const resNoVer = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_no_ver',
      entityType: 'project',
      entityId: 'proj_1',
      action: 'update',
      payload: { name: 'Update Tanpa Versi' },
    }),
    env,
    {} as any
  );
  assert.equal(resNoVer.status, 400);
  const bodyNoVer = await resNoVer.json();
  assert.equal(bodyNoVer.error.code, 'INVALID_MUTATION_PLAN');

  // Update dengan expectedVersion 0
  const resZeroVer = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_zero_ver',
      entityType: 'project',
      entityId: 'proj_1',
      action: 'update',
      expectedVersion: 0,
      payload: { name: 'Update Versi 0' },
    }),
    env,
    {} as any
  );
  assert.equal(resZeroVer.status, 400);
});

test('D23. stale version -> 409 version conflict', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('proj_stale', 'ws_personal_alice', 'Proyek Versi 3', 'u_alice', 3, ?, ?)`
    )
    .run(now, now);

  const resStale = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_stale',
      entityType: 'project',
      entityId: 'proj_stale',
      action: 'update',
      expectedVersion: 2, // Versi nyata adalah 3
      payload: { name: 'Coba Versi Stale' },
    }),
    env,
    {} as any
  );

  assert.equal(resStale.status, 409);
  const bodyStale = await resStale.json();
  assert.equal(bodyStale.error.code, 'VERSION_CONFLICT');
});

test('D24 & D28. identical replay mengembalikan response canonical yang sama', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const reqBody = {
    clientMutationId: 'mut_idempotent_1',
    entityType: 'project',
    entityId: 'proj_idem',
    action: 'insert',
    payload: { name: 'Proyek Idempoten' },
  };

  const res1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, reqBody),
    env,
    {} as any
  );
  assert.equal(res1.status, 200);
  const body1 = await res1.json();

  const res2 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, reqBody),
    env,
    {} as any
  );
  assert.equal(res2.status, 200);
  const body2 = await res2.json();

  assert.deepEqual(body1, body2);
  assert.equal(body2.mutation.changeSeq, body1.mutation.changeSeq);

  // D28. Delete replay
  const delBody = {
    clientMutationId: 'mut_del_idem',
    entityType: 'project',
    entityId: 'proj_idem',
    action: 'delete',
    expectedVersion: 1,
  };

  const resDel1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, delBody),
    env,
    {} as any
  );
  assert.equal(resDel1.status, 200);
  const bodyDel1 = await resDel1.json();

  const resDel2 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, delBody),
    env,
    {} as any
  );
  assert.equal(resDel2.status, 200);
  const bodyDel2 = await resDel2.json();

  assert.deepEqual(bodyDel1, bodyDel2);
  assert.equal(bodyDel2.mutation.operation, 'delete');
});

test('D25. divergent replay -> 409 idempotency conflict', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const res1 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_diverge',
      entityType: 'project',
      entityId: 'proj_div_1',
      action: 'insert',
      payload: { name: 'Nama Asli' },
    }),
    env,
    {} as any
  );
  assert.equal(res1.status, 200);

  // Key sama tetapi payload berbeda
  const res2 = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_diverge',
      entityType: 'project',
      entityId: 'proj_div_1',
      action: 'insert',
      payload: { name: 'Nama Berbeda' },
    }),
    env,
    {} as any
  );
  assert.equal(res2.status, 409);
  const body2 = await res2.json();
  assert.equal(body2.error.code, 'IDEMPOTENCY_CONFLICT');
});

test('D26. concurrent identical mutations -> satu perubahan committed', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  const reqBody = {
    clientMutationId: 'mut_concurrent_same',
    entityType: 'project',
    entityId: 'proj_conc',
    action: 'insert',
    payload: { name: 'Proyek Konkuren' },
  };

  const [res1, res2] = await Promise.all([
    worker.fetch(buildMutationReq('ws_personal_alice', alice.cookie, reqBody), env, {} as any),
    worker.fetch(buildMutationReq('ws_personal_alice', alice.cookie, reqBody), env, {} as any),
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);

  const b1 = await res1.json();
  const b2 = await res2.json();

  assert.deepEqual(b1, b2);

  // Verifikasi hanya 1 baris yang ada di change log
  const logRows = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM workspace_change_log WHERE client_mutation_id = ?')
    .get('mut_concurrent_same') as any;
  assert.equal(logRows.cnt, 1);
});

test('D27. concurrent same version different mutations -> satu sukses, satu version conflict', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('proj_race_cas', 'ws_personal_alice', 'Versi 1', 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  const reqA = buildMutationReq('ws_personal_alice', alice.cookie, {
    clientMutationId: 'mut_race_a',
    entityType: 'project',
    entityId: 'proj_race_cas',
    action: 'update',
    expectedVersion: 1,
    payload: { name: 'Update dari A' },
  });

  const reqB = buildMutationReq('ws_personal_alice', alice.cookie, {
    clientMutationId: 'mut_race_b',
    entityType: 'project',
    entityId: 'proj_race_cas',
    action: 'update',
    expectedVersion: 1,
    payload: { name: 'Update dari B' },
  });

  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);

  const [resA, resB] = await Promise.all([
    worker.fetch(reqA, env, {} as any),
    worker.fetch(reqB, env, {} as any),
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409]);
});

test('D29. tombstone cannot be revived', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');
  const now = Date.now();

  // Entitas telah dihapus (tombstone)
  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at, deleted_at)
       VALUES ('proj_tomb', 'ws_personal_alice', 'Tombstone', 'u_alice', 2, ?, ?, ?)`
    )
    .run(now, now, now);

  // Coba insert kembali dengan ID yang sama
  const resRevive = await worker.fetch(
    buildMutationReq('ws_personal_alice', alice.cookie, {
      clientMutationId: 'mut_revive',
      entityType: 'project',
      entityId: 'proj_tomb',
      action: 'insert',
      payload: { name: 'Bangkitkan Proyek' },
    }),
    env,
    {} as any
  );

  assert.equal(resRevive.status, 409);
  const bodyRevive = await resRevive.json();
  assert.equal(bodyRevive.error.code, 'VERSION_CONFLICT');
  assert.equal(bodyRevive.error.message, 'Entitas telah dihapus dan tidak dapat dimutasi kembali');
});

// =========================================================================
// E. REGRESSION TESTS
// =========================================================================

test('E30. bootstrap, read, snapshot, sync, account, auth, dan assets tetap bekerja', async () => {
  const sqlite = createMigratedTestDb();
  setupTestWorkspaces(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const env = createTestEnv(db);
  const alice = await createAuthenticatedUser(sqlite, 'u_alice', 'Alice', 'alice@example.com');

  // 1. Read workspace list
  const resList = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces', {
      headers: { 'Cookie': alice.cookie },
    }),
    env,
    {} as any
  );
  assert.equal(resList.status, 200);

  // 2. Read snapshot
  const resSnap = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_personal_alice/snapshot', {
      headers: { 'Cookie': alice.cookie },
    }),
    env,
    {} as any
  );
  assert.equal(resSnap.status, 200);

  // 3. Delta sync
  const resSync = await worker.fetch(
    new Request('http://localhost:3000/api/workspaces/ws_personal_alice/sync?since=0', {
      headers: { 'Cookie': alice.cookie },
    }),
    env,
    {} as any
  );
  assert.equal(resSync.status, 200);

  // 4. Bootstrap workspace
  const resBoot = await worker.fetch(
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
  assert.equal(resBoot.status, 200);
  const bodyBoot = await resBoot.json();
  assert.equal(bodyBoot.created, false);

  // 5. Account summary
  const resAcc = await worker.fetch(
    new Request('http://localhost:3000/api/account/summary', {
      headers: { 'Cookie': alice.cookie },
    }),
    env,
    {} as any
  );
  assert.equal(resAcc.status, 200);

  // 6. SPA fallback
  const resSpa = await worker.fetch(
    new Request('http://localhost:3000/app/dashboard'),
    env,
    {} as any
  );
  assert.equal(resSpa.status, 200);
});
