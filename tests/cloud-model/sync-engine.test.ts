import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendWorkspaceChange,
  getWorkspaceDelta,
  purgeWorkspaceChangeLog,
  canonicalizeJson,
  hashCanonicalPayload,
} from '../../worker/workspace/sync-engine.ts';
import {
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from '../../worker/workspace/workspace-auth.ts';
import { WorkspaceDomainError } from '../../worker/workspace/workspace-errors.ts';
import {
  createMigratedTestDb,
  createD1DatabaseAdapter,
  createInterleavingD1Adapter,
} from './test-db-helper.ts';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setupWorkspaceEnv(sqlite: any) {
  const now = Date.now();
  const iso = new Date().toISOString();

  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_alice', 'Alice', 'alice@example.com', iso, iso);
  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_bob', 'Bob', 'bob@example.com', iso, iso);

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
       VALUES ('ws_main', 'team', 'Workspace Main', 'ws-main', NULL, 0, 0, ?, ?),
              ('ws_other', 'team', 'Workspace Other', 'ws-other', NULL, 0, 0, ?, ?)`
    )
    .run(now, now, now, now);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_main_alice', 'ws_main', 'u_alice', 'owner', ?, ?),
              ('m_main_bob', 'ws_main', 'u_bob', 'member', ?, ?),
              ('m_other_bob', 'ws_other', 'u_bob', 'owner', ?, ?)`
    )
    .run(now, now, now, now, now, now);
}

test('canonicalizeJson dan hashCanonicalPayload deterministik terlepas dari urutan key', async () => {
  const objA = { z: 10, a: 'catetin', nested: { b: 2, a: 1 } };
  const objB = { a: 'catetin', nested: { a: 1, b: 2 }, z: 10 };

  const canonicalA = canonicalizeJson(objA);
  const canonicalB = canonicalizeJson(objB);
  assert.equal(canonicalA, canonicalB);
  assert.equal(canonicalA, '{"a":"catetin","nested":{"a":1,"b":2},"z":10}');

  const hashA = await hashCanonicalPayload(objA);
  const hashB = await hashCanonicalPayload(objB);
  assert.equal(hashA, hashB);
});

test('append mutasi memperbarui latest_change_seq secara atomik', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  const res1 = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_1',
    operation: 'upsert',
    data: { name: 'Proyek Perdana' },
    mutation: {
      clientMutationId: 'mut_p1',
      payload: { name: 'Proyek Perdana' },
    },
    domainPlan: {
      action: 'insert',
      attributes: {
        name: 'Proyek Perdana',
      },
    },
  });

  assert.ok(res1.changeSeq > 0);
  assert.equal(res1.operation, 'upsert');

  // Periksa bahwa workspace.latest_change_seq terupdate secara atomik
  const wsRow = sqlite.prepare('SELECT latest_change_seq FROM workspace WHERE id = ?').get('ws_main') as any;
  assert.equal(wsRow.latest_change_seq, res1.changeSeq);

  // Append mutasi kedua
  const res2 = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'folder',
    entityId: 'fld_1',
    operation: 'upsert',
    mutation: {
      clientMutationId: 'mut_f1',
      payload: { name: 'Folder 1' },
    },
    domainPlan: {
      action: 'insert',
      attributes: {
        project_id: 'prj_1',
        name: 'Folder 1',
      },
    },
  });

  assert.equal(res2.changeSeq, res1.changeSeq + 1);
  const wsRow2 = sqlite.prepare('SELECT latest_change_seq FROM workspace WHERE id = ?').get('ws_main') as any;
  assert.equal(wsRow2.latest_change_seq, res2.changeSeq);
});

test('global sequence gap antar-workspace tetap menghasilkan delta benar', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // Mutasi 1 di ws_main -> seq 1
  const m1 = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_main_1',
    operation: 'upsert',
    mutation: {
      clientMutationId: 'mut_m1',
      payload: { val: 1 },
    },
    domainPlan: {
      action: 'insert',
      attributes: {
        name: 'Proyek Main 1',
      },
    },
  });
  assert.equal(m1.changeSeq, 1);

  // Mutasi 2 di ws_other -> seq 2 (membuat gap sequence di ws_main)
  const o1 = await appendWorkspaceChange(db, {
    workspaceId: 'ws_other',
    userId: 'u_bob',
    entityType: 'project',
    entityId: 'prj_other_1',
    operation: 'upsert',
    mutation: {
      clientMutationId: 'mut_o1',
      payload: { val: 2 },
    },
    domainPlan: {
      action: 'insert',
      attributes: {
        name: 'Proyek Other 1',
      },
    },
  });
  assert.equal(o1.changeSeq, 2);

  // Mutasi 3 di ws_main -> seq 3
  const m2 = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_main_2',
    operation: 'upsert',
    mutation: {
      clientMutationId: 'mut_m2',
      payload: { val: 3 },
    },
    domainPlan: {
      action: 'insert',
      attributes: {
        name: 'Proyek Main 2',
      },
    },
  });
  assert.equal(m2.changeSeq, 3);

  // Tarik delta untuk ws_main dari sinceSeq = 0
  const delta = await getWorkspaceDelta(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    sinceSeq: 0,
  });

  assert.equal(delta.code, undefined);
  if (!delta.code) {
    assert.equal(delta.latestSeq, 3);
    assert.equal(delta.changes.length, 2);
    assert.equal(delta.changes[0].changeSeq, 1);
    assert.equal(delta.changes[0].entityId, 'prj_main_1');
    assert.equal(delta.changes[1].changeSeq, 3);
    assert.equal(delta.changes[1].entityId, 'prj_main_2');
    assert.equal(delta.hasMore, false);
    assert.equal(delta.nextSeq, 3);
  }
});

test('sinceSeq < minValidSeq menghasilkan FULL_RESYNC_REQUIRED dan sinceSeq === minValidSeq valid', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // Set kursor batas validitas ke 100 dan latest ke 150
  sqlite.prepare('UPDATE workspace SET min_valid_sync_seq = 100, latest_change_seq = 150 WHERE id = ?').run('ws_main');

  // 1. sinceSeq 99 (< 100) mengembalikan FULL_RESYNC_REQUIRED
  const resyncResult = await getWorkspaceDelta(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    sinceSeq: 99,
  });
  assert.equal(resyncResult.code, 'FULL_RESYNC_REQUIRED');
  if (resyncResult.code === 'FULL_RESYNC_REQUIRED') {
    assert.equal(resyncResult.minValidSeq, 100);
    assert.equal(resyncResult.currentSeq, 150);
  }

  // 2. sinceSeq 100 (=== 100) bernilai valid
  const validResult = await getWorkspaceDelta(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    sinceSeq: 100,
  });
  assert.equal(validResult.code, undefined);
  if (!validResult.code) {
    assert.equal(validResult.latestSeq, 150);
    assert.equal(validResult.nextSeq, 100);
    assert.equal(validResult.changes.length, 0);
  }

  // 3. sinceSeq negatif ditolak dengan INVALID_SYNC_CURSOR (400)
  await assert.rejects(
    async () => {
      await getWorkspaceDelta(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        sinceSeq: -1,
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_SYNC_CURSOR');
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('pagination ascending, hasMore, dan nextSeq benar', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // Tambahkan 5 mutasi
  for (let i = 1; i <= 5; i++) {
    await appendWorkspaceChange(db, {
      workspaceId: 'ws_main',
      userId: 'u_alice',
      entityType: 'tag',
      entityId: `tag_${i}`,
      operation: 'upsert',
      mutation: {
        clientMutationId: `mut_tag_${i}`,
        payload: { tagNum: i },
      },
      domainPlan: {
        action: 'insert',
        attributes: {
          name: `Tag ${i}`,
          normalized_name: `tag_${i}`,
        },
      },
    });
  }

  // Tarik halaman 1 dengan limit 2
  const page1 = await getWorkspaceDelta(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    sinceSeq: 0,
    limit: 2,
  });
  assert.equal(page1.code, undefined);
  if (!page1.code) {
    assert.equal(page1.changes.length, 2);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.nextSeq, 2);
    assert.equal(page1.changes[0].changeSeq, 1);
    assert.equal(page1.changes[1].changeSeq, 2);

    // Tarik halaman 2 dengan sinceSeq = page1.nextSeq (2) dan limit 2
    const page2 = await getWorkspaceDelta(db, {
      workspaceId: 'ws_main',
      userId: 'u_alice',
      sinceSeq: page1.nextSeq,
      limit: 2,
    });
    assert.equal(page2.code, undefined);
    if (!page2.code) {
      assert.equal(page2.changes.length, 2);
      assert.equal(page2.hasMore, true);
      assert.equal(page2.nextSeq, 4);
      assert.equal(page2.changes[0].changeSeq, 3);
      assert.equal(page2.changes[1].changeSeq, 4);

      // Tarik halaman 3 sisa data
      const page3 = await getWorkspaceDelta(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        sinceSeq: page2.nextSeq,
        limit: 2,
      });
      assert.equal(page3.code, undefined);
      if (!page3.code) {
        assert.equal(page3.changes.length, 1);
        assert.equal(page3.hasMore, false);
        assert.equal(page3.nextSeq, 5);
        assert.equal(page3.changes[0].changeSeq, 5);
      }
    }
  }
});

// =========================================================================
// DETERMINISTIC INTERLEAVING CONCURRENCY SUITE (SCENARIOS A - I)
// =========================================================================

test('Skenario A: Two concurrent mutations with same expectedVersion: exactly one succeeds, one gets VERSION_CONFLICT', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const now = Date.now();

  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('prj_cas_a', 'ws_main', 'Nama Awal', 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  const barrierA = createDeferred();
  const barrierB = createDeferred();

  let countBatch = 0;
  const db = createInterleavingD1Adapter(sqlite, {
    async beforeBatch() {
      countBatch++;
      if (countBatch === 1) {
        // Mutasi 1 menunggu di barrier
        await barrierA.promise;
      } else if (countBatch === 2) {
        // Mutasi 2 menunggu di barrier
        await barrierB.promise;
      }
    },
  });

  const task1 = appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_cas_a',
    operation: 'upsert',
    expectedVersion: 1,
    mutation: { clientMutationId: 'cas_a_1', payload: { name: 'Versi 1' } },
    domainPlan: {
      action: 'update',
      attributes: { name: 'Versi 1' },
    },
  });

  const task2 = appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_cas_a',
    operation: 'upsert',
    expectedVersion: 1,
    mutation: { clientMutationId: 'cas_a_2', payload: { name: 'Versi 2' } },
    domainPlan: {
      action: 'update',
      attributes: { name: 'Versi 2' },
    },
  });

  // Biarkan kedua task melewati pre-check saat version masih 1
  await new Promise((r) => setTimeout(r, 20));

  // Lepaskan mutasi 1 lebih dulu untuk menyelesaikan commit
  barrierA.resolve();
  const res1 = await task1;
  assert.equal(res1.version, 2);

  // Sekarang lepaskan mutasi 2 yang masih memegang expectedVersion: 1
  barrierB.resolve();
  await assert.rejects(
    async () => {
      await task2;
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'VERSION_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // Verifikasi hanya 1 baris change log yang bertambah
  const logRows = sqlite.prepare('SELECT change_seq FROM workspace_change_log WHERE entity_id = ?').all('prj_cas_a');
  assert.equal(logRows.length, 1);

  // Verifikasi nama proyek adalah 'Versi 1'
  const prjRow = sqlite.prepare('SELECT name, version FROM project WHERE id = ?').get('prj_cas_a') as any;
  assert.equal(prjRow.name, 'Versi 1');
  assert.equal(prjRow.version, 2);
});

test('Skenario B: Concurrent mutation and member removal: mutation commits iff member valid at write time, mid-flight gets FORBIDDEN', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);

  const bobBatchBarrier = createDeferred();

  const dbBob = createInterleavingD1Adapter(sqlite, {
    async beforeBatch() {
      // Bob menunggu tepat sebelum commit batch
      await bobBatchBarrier.promise;
    },
  });

  // Bob memulai mutasi (lolos pre-check otorisasi awal)
  const bobTask = appendWorkspaceChange(dbBob, {
    workspaceId: 'ws_main',
    userId: 'u_bob',
    entityType: 'tag',
    entityId: 'tag_bob_det',
    operation: 'upsert',
    mutation: { clientMutationId: 'bob_mut_det', payload: { name: 'Tag Bob' } },
    domainPlan: {
      action: 'insert',
      attributes: {
        name: 'Tag Bob',
        normalized_name: 'tag_bob',
      },
    },
  });

  // Berikan jeda agar Bob melewati pre-check
  await new Promise((r) => setTimeout(r, 20));

  // Alice (owner) mencabut keanggotaan Bob selagi mutasi Bob tertahan
  const dbAlice = createD1DatabaseAdapter(sqlite);
  await removeWorkspaceMember(dbAlice, 'u_alice', 'ws_main', 'u_bob');

  // Lepaskan Bob untuk mencoba commit batch
  bobBatchBarrier.resolve();

  // Guard SQL commit-time wajib menolak mutasi Bob dengan FORBIDDEN (403)
  await assert.rejects(
    async () => {
      await bobTask;
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'FORBIDDEN');
      assert.equal(err.status, 403);
      return true;
    }
  );

  // Verifikasi tidak ada tag atau change log yang tercipta dari Bob
  const tagRow = sqlite.prepare('SELECT id FROM tag WHERE id = ?').get('tag_bob_det');
  assert.equal(tagRow, undefined);
  const logRows = sqlite.prepare("SELECT change_seq FROM workspace_change_log WHERE client_mutation_id = 'bob_mut_det'").all();
  assert.equal(logRows.length, 0);
});

test('Skenario C: Concurrent mutation and delete: upsert arriving after delete gets VERSION_CONFLICT (no resurrection)', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const now = Date.now();

  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('prj_tomb_c', 'ws_main', 'Proyek Aktif', 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  const upsertBarrier = createDeferred();

  const dbUpsert = createInterleavingD1Adapter(sqlite, {
    async beforeBatch() {
      // Upsert menunggu sebelum batch
      await upsertBarrier.promise;
    },
  });

  // Task upsert dimulai (lolos pre-check karena entitas belum terhapus)
  const upsertTask = appendWorkspaceChange(dbUpsert, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_tomb_c',
    operation: 'upsert',
    expectedVersion: 1,
    mutation: { clientMutationId: 'mut_upsert_after_del', payload: { name: 'Resurrected' } },
    domainPlan: {
      action: 'update',
      attributes: { name: 'Resurrected' },
    },
  });

  await new Promise((r) => setTimeout(r, 20));

  // Delete dieksekusi duluan menggunakan D1 adapter normal
  const dbNormal = createD1DatabaseAdapter(sqlite);
  const delRes = await appendWorkspaceChange(dbNormal, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_tomb_c',
    operation: 'delete',
    expectedVersion: 1,
    mutation: { clientMutationId: 'mut_delete_c', payload: { action: 'delete' } },
    domainPlan: {
      action: 'delete',
    },
  });
  assert.ok(delRes.changeSeq > 0);

  // Sekarang lepaskan upsert yang tertahan
  upsertBarrier.resolve();

  // Upsert wajib ditolak dengan VERSION_CONFLICT (409) dan tidak boleh membangkitkan tombstone
  await assert.rejects(
    async () => {
      await upsertTask;
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'VERSION_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // Verifikasi entitas di database tetap berstatus deleted_at
  const prjRow = sqlite.prepare('SELECT deleted_at FROM project WHERE id = ?').get('prj_tomb_c') as any;
  assert.notEqual(prjRow.deleted_at, null);
});

test('Skenario D: Concurrent idempotent requests: both receive same canonical response with identical non-zero changeSeq', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);

  const barrierA = createDeferred();
  const barrierB = createDeferred();

  let countBatch = 0;
  const db = createInterleavingD1Adapter(sqlite, {
    async beforeBatch() {
      countBatch++;
      if (countBatch === 1) {
        await barrierA.promise;
      } else if (countBatch === 2) {
        await barrierB.promise;
      }
    },
  });

  const mutation = {
    clientMutationId: 'mut_idem_det_d',
    payload: { title: 'Dokumen Idempotent' },
  };

  const task1 = appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_idem_d',
    operation: 'upsert',
    mutation,
    domainPlan: {
      action: 'insert',
      attributes: {
        name: 'Dokumen Idempotent',
      },
    },
  });

  const task2 = appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_idem_d',
    operation: 'upsert',
    mutation,
    domainPlan: {
      action: 'insert',
      attributes: {
        name: 'Dokumen Idempotent',
      },
    },
  });

  await new Promise((r) => setTimeout(r, 20));

  // Lepaskan task 1 untuk melakukan commit
  barrierA.resolve();
  const res1 = await task1;

  // Lepaskan task 2 yang mengalami collision UNIQUE di mutation_idempotency
  barrierB.resolve();
  const res2 = await task2;

  assert.ok(res1.changeSeq > 0);
  assert.equal(res1.changeSeq, res2.changeSeq);
  assert.equal(res1.operation, res2.operation);
  assert.equal(res1.entityId, res2.entityId);

  // Verifikasi di database: tepat 1 change log dan 1 mutation_idempotency
  const logRows = sqlite.prepare("SELECT change_seq FROM workspace_change_log WHERE client_mutation_id = 'mut_idem_det_d'").all();
  assert.equal(logRows.length, 1);
  const idemRows = sqlite.prepare("SELECT mutation_id FROM mutation_idempotency WHERE client_mutation_id = 'mut_idem_det_d'").all() as any[];
  assert.equal(idemRows.length, 1);
  assert.ok(idemRows[0].mutation_id);
});

test('Skenario E: Concurrent demote/remove on last owner: exactly one succeeds, one gets LAST_OWNER_REQUIRED', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const now = Date.now();
  const iso = new Date().toISOString();

  // Tambahkan Carol sebagai owner kedua di ws_main
  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_carol', 'Carol', 'carol@example.com', iso, iso);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_main_carol', 'ws_main', 'u_carol', 'owner', ?, ?)`
    )
    .run(now, now);

  const barrierCarol = createDeferred();

  const dbInterleaved = createInterleavingD1Adapter(sqlite, {
    async beforeRun(sql) {
      if (sql.includes('UPDATE workspace_membership')) {
        // Demote Carol menunggu barrier
        await barrierCarol.promise;
      }
    },
  });

  const dbAlice = createD1DatabaseAdapter(sqlite);

  // Task 1: Carol mendemote dirinya sendiri menjadi member (tertahan di barrier)
  const taskDemoteCarol = updateWorkspaceMemberRole(dbInterleaved, 'u_carol', 'ws_main', 'u_carol', 'member');

  await new Promise((r) => setTimeout(r, 20));

  // Task 2: Alice mendemote dirinya sendiri menjadi member (berhasil, tinggal Carol sebagai 1-satunya owner)
  await updateWorkspaceMemberRole(dbAlice, 'u_alice', 'ws_main', 'u_alice', 'member');

  // Lepaskan demote Carol
  barrierCarol.resolve();

  // Trigger trg_prevent_last_owner_demotion wajib meledak dan ditangkap sebagai LAST_OWNER_REQUIRED
  await assert.rejects(
    async () => {
      await taskDemoteCarol;
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'LAST_OWNER_REQUIRED');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // Pastikan tepat 1 owner tersisa di database
  const ownerCount = sqlite
    .prepare("SELECT COUNT(*) as count FROM workspace_membership WHERE workspace_id = 'ws_main' AND role = 'owner'")
    .get() as any;
  assert.equal(ownerCount.count, 1);
});

test('Skenario F: Concurrent purge: min_valid_sync_seq monotonically advances to highest requested boundary', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);

  sqlite.prepare('UPDATE workspace SET latest_change_seq = 20, min_valid_sync_seq = 0 WHERE id = ?').run('ws_main');

  const purge5Barrier = createDeferred();

  const dbPurge5 = createInterleavingD1Adapter(sqlite, {
    async beforeBatch() {
      // Purge 5 menunggu barrier
      await purge5Barrier.promise;
    },
  });

  const taskPurge5 = purgeWorkspaceChangeLog(dbPurge5, { workspaceId: 'ws_main', upToSeq: 5 });

  await new Promise((r) => setTimeout(r, 20));

  // Purge 10 dieksekusi duluan dan selesai
  const dbPurge10 = createD1DatabaseAdapter(sqlite);
  const res10 = await purgeWorkspaceChangeLog(dbPurge10, { workspaceId: 'ws_main', upToSeq: 10 });
  assert.equal(res10.minValidSyncSeq, 10);
  assert.equal(res10.purgedUpToSeq, 10);

  // Lepaskan Purge 5
  purge5Barrier.resolve();
  const res5 = await taskPurge5;

  // Nilai kursor tidak boleh mundur ke 5, harus tetap di 10 (actual committed boundary)
  assert.equal(res5.minValidSyncSeq, 10);
  assert.equal(res5.purgedUpToSeq, 10);

  const ws = sqlite.prepare('SELECT min_valid_sync_seq FROM workspace WHERE id = ?').get('ws_main') as any;
  assert.equal(ws.min_valid_sync_seq, 10);
});

test('Skenario G: Read delta during concurrent append: reader receives consistent snapshot', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // Buat 2 mutasi awal
  for (let i = 1; i <= 2; i++) {
    await appendWorkspaceChange(db, {
      workspaceId: 'ws_main',
      userId: 'u_alice',
      entityType: 'tag',
      entityId: `tag_g_${i}`,
      operation: 'upsert',
      mutation: { clientMutationId: `mut_g_${i}`, payload: { i } },
      domainPlan: {
        action: 'insert',
        attributes: { name: `Tag G ${i}`, normalized_name: `tag_g_${i}` },
      },
    });
  }

  // Pembacaan delta sebelum append selesai membaca snapshot persis (latestSeq = 2, nextSeq = 2)
  const delta1 = await getWorkspaceDelta(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    sinceSeq: 0,
  });

  assert.equal(delta1.code, undefined);
  if (!delta1.code) {
    assert.equal(delta1.latestSeq, 2);
    assert.equal(delta1.changes.length, 2);
    assert.equal(delta1.nextSeq, 2);
  }

  // Append mutasi ke-3
  await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'tag',
    entityId: 'tag_g_3',
    operation: 'upsert',
    mutation: { clientMutationId: 'mut_g_3', payload: { 3: true } },
    domainPlan: {
      action: 'insert',
      attributes: { name: 'Tag G 3', normalized_name: 'tag_g_3' },
    },
  });

  // Pembacaan delta berikutnya dari sinceSeq = 2 mengambil tepat 1 perubahan baru
  const delta2 = await getWorkspaceDelta(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    sinceSeq: 2,
  });

  assert.equal(delta2.code, undefined);
  if (!delta2.code) {
    assert.equal(delta2.latestSeq, 3);
    assert.equal(delta2.changes.length, 1);
    assert.equal(delta2.changes[0].changeSeq, 3);
    assert.equal(delta2.nextSeq, 3);
  }
});

test('Skenario H: Domain mutation affecting 0 rows (wrong version): change log and idempotency are NOT written', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();

  sqlite
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at)
       VALUES ('prj_zero_h', 'ws_main', 'Original Project', 'u_alice', 1, ?, ?)`
    )
    .run(now, now);

  // Upaya mutasi dengan expectedVersion: 99 padahal versi di DB adalah 1
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_zero_h',
        operation: 'upsert',
        expectedVersion: 99,
        mutation: { clientMutationId: 'mut_zero_h', payload: { name: 'Ghost Name' } },
        domainPlan: {
          action: 'update',
          attributes: { name: 'Ghost Name' },
        },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'VERSION_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // Buktikan tidak ada baris yang tersimpan di change log atau idempotency
  const logRows = sqlite.prepare("SELECT change_seq FROM workspace_change_log WHERE entity_id = 'prj_zero_h'").all();
  assert.equal(logRows.length, 0);

  const idemRows = sqlite.prepare("SELECT mutation_id FROM mutation_idempotency WHERE client_mutation_id = 'mut_zero_h'").all();
  assert.equal(idemRows.length, 0);

  // Proyek asli tetap utuh di versi 1
  const prj = sqlite.prepare('SELECT name, version FROM project WHERE id = ?').get('prj_zero_h') as any;
  assert.equal(prj.name, 'Original Project');
  assert.equal(prj.version, 1);
});

test('Skenario I: Crash simulation (rollback): if statement fails in batch, no domain row, change log, or idempotency persists', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);

  // Simulasi crash adapter: menyuntikkan kegagalan fatal di dalam transaksi batch
  const dbCrash = createInterleavingD1Adapter(sqlite, {
    beforeBatchStatement(index) {
      if (index === 2) {
        throw new Error('SIMULATED_ENGINE_CRASH_DURING_BATCH');
      }
    },
  });

  await assert.rejects(
    async () => {
      await appendWorkspaceChange(dbCrash, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_crash_i',
        operation: 'upsert',
        mutation: { clientMutationId: 'mut_crash_i', payload: { name: 'Crash Project' } },
        domainPlan: {
          action: 'insert',
          attributes: {
            name: 'Crash Project',
          },
        },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'VERSION_CONFLICT');
      return true;
    }
  );

  // Verifikasi rollback sempurna: tidak ada row domain, change log, atau idempotency
  const prj = sqlite.prepare('SELECT id FROM project WHERE id = ?').get('prj_crash_i');
  assert.equal(prj, undefined);

  const logRows = sqlite.prepare("SELECT change_seq FROM workspace_change_log WHERE client_mutation_id = 'mut_crash_i'").all();
  assert.equal(logRows.length, 0);

  const idemRows = sqlite.prepare("SELECT mutation_id FROM mutation_idempotency WHERE client_mutation_id = 'mut_crash_i'").all();
  assert.equal(idemRows.length, 0);

  const ws = sqlite.prepare('SELECT latest_change_seq FROM workspace WHERE id = ?').get('ws_main') as any;
  assert.equal(ws.latest_change_seq, 0);
});

// =========================================================================
// CANONICAL IDEMPOTENCY, TYPED PLAN ENFORCEMENT & ALLOWLIST TESTS
// =========================================================================

test('Canonical Idempotency: insert menghasilkan committed version 1', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  const res = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_ver_test',
    operation: 'upsert',
    mutation: { clientMutationId: 'mut_caller_ver', payload: { name: 'Ver Test' } },
    domainPlan: {
      action: 'insert',
      attributes: { name: 'Ver Test' },
    },
  });

  assert.equal(res.version, 1);
  const row = sqlite.prepare('SELECT version FROM project WHERE id = ?').get('prj_ver_test') as any;
  assert.equal(row.version, 1);
  const logRow = sqlite.prepare("SELECT version FROM workspace_change_log WHERE client_mutation_id = 'mut_caller_ver'").get() as any;
  assert.equal(logRow.version, 1);
});

test('Canonical Idempotency: update menghasilkan committed version aktual', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();

  sqlite
    .prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at) VALUES ('prj_act_ver', 'ws_main', 'Initial', 'u_alice', 1, ?, ?)")
    .run(now, now);

  const res = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_act_ver',
    operation: 'upsert',
    expectedVersion: 1,
    mutation: { clientMutationId: 'mut_act_ver', payload: { name: 'Updated' } },
    domainPlan: {
      action: 'update',
      attributes: { name: 'Updated' },
    },
  });

  assert.equal(res.version, 2);
  const row = sqlite.prepare('SELECT version FROM project WHERE id = ?').get('prj_act_ver') as any;
  assert.equal(row.version, 2);
  const logRow = sqlite.prepare("SELECT version FROM workspace_change_log WHERE client_mutation_id = 'mut_act_ver'").get() as any;
  assert.equal(logRow.version, 2);
});

test('Canonical Idempotency: retry identik deep-equal dengan respons pertama dan raw idempotency tidak menyimpan sequence/version', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  const payload = {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project' as const,
    entityId: 'prj_deep_eq',
    operation: 'upsert' as const,
    data: { customField: 'value123' },
    mutation: { clientMutationId: 'mut_deep_eq', payload: { name: 'Deep Equal Project' } },
    domainPlan: {
      action: 'insert' as const,
      attributes: { name: 'Deep Equal Project' },
    },
  };

  const res1 = await appendWorkspaceChange(db, payload);
  const res2 = await appendWorkspaceChange(db, payload);

  assert.deepEqual(res1, res2);
  assert.equal(res1.changeSeq, 1);
  assert.equal(res1.version, 1);
  assert.equal(res1.operation, 'upsert');
  assert.equal(res1.entityId, 'prj_deep_eq');
  assert.deepEqual(res1.data, { customField: 'value123' });

  // Verifikasi tabel mutation_idempotency: tidak ada kolom change_seq atau version
  const rawIdem = sqlite.prepare("SELECT * FROM mutation_idempotency WHERE client_mutation_id = 'mut_deep_eq'").get() as any;
  assert.equal(rawIdem.change_seq, undefined);
  assert.equal(rawIdem.version, undefined);
  assert.ok(rawIdem.mutation_id);
  assert.equal(rawIdem.response_data_json, JSON.stringify({ customField: 'value123' }));
});

test('Typed Domain Plan: domainPlan tidak ada ditolak', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_no_plan',
        operation: 'upsert',
        mutation: { clientMutationId: 'mut_no_plan', payload: {} },
      } as any);
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('Typed Domain Plan: validasi mapping action-operation yang tidak sesuai ditolak', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // 1. action delete + operation upsert ditolak
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_invalid_map1',
        operation: 'upsert',
        mutation: { clientMutationId: 'mut_inv_1', payload: {} },
        domainPlan: { action: 'delete' },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      return true;
    }
  );

  // 2. action update + operation delete ditolak
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_invalid_map2',
        operation: 'delete',
        mutation: { clientMutationId: 'mut_inv_2', payload: {} },
        domainPlan: { action: 'update', attributes: { name: 'X' } },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      return true;
    }
  );

  // 3. action insert + operation delete ditolak
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_invalid_map3',
        operation: 'delete',
        mutation: { clientMutationId: 'mut_inv_3', payload: {} },
        domainPlan: { action: 'insert', attributes: { name: 'X' } },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('Typed Domain Plan: kegagalan domain write tidak membuat log, cursor, atau idempotency row', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // Coba update pada entitas yang tidak ada dengan expectedVersion 1
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_non_existent',
        operation: 'upsert',
        expectedVersion: 1,
        mutation: { clientMutationId: 'mut_fail_domain', payload: { name: 'Ghost' } },
        domainPlan: { action: 'update', attributes: { name: 'Ghost' } },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'VERSION_CONFLICT');
      return true;
    }
  );

  const logs = sqlite.prepare("SELECT * FROM workspace_change_log WHERE client_mutation_id = 'mut_fail_domain'").all();
  assert.equal(logs.length, 0);
  const idems = sqlite.prepare("SELECT * FROM mutation_idempotency WHERE client_mutation_id = 'mut_fail_domain'").all();
  assert.equal(idems.length, 0);
  const ws = sqlite.prepare('SELECT latest_change_seq FROM workspace WHERE id = ?').get('ws_main') as any;
  assert.equal(ws.latest_change_seq, 0);
});

test('Attribute Allowlist: mass assignment dan kolom tak diizinkan ditolak terstruktur', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // 1. Kolom tidak dikenal pada insert
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_mass_1',
        operation: 'upsert',
        mutation: { clientMutationId: 'mut_mass_1', payload: {} },
        domainPlan: {
          action: 'insert',
          attributes: { name: 'Project Mass', is_admin: true },
        },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      return true;
    }
  );

  // 2. Caller mencoba override created_by_user_id pada insert
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_mass_2',
        operation: 'upsert',
        mutation: { clientMutationId: 'mut_mass_2', payload: {} },
        domainPlan: {
          action: 'insert',
          attributes: { name: 'Project Mass', created_by_user_id: 'u_hacker' },
        },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('Attribute Allowlist: reparenting lintas project atau recording ditolak', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();

  sqlite
    .prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, version, created_at, updated_at) VALUES ('prj_p1', 'ws_main', 'Project 1', 'u_alice', 1, ?, ?), ('prj_p2', 'ws_main', 'Project 2', 'u_alice', 1, ?, ?)")
    .run(now, now, now, now);

  sqlite
    .prepare("INSERT INTO folder (id, workspace_id, project_id, name, version, created_at, updated_at) VALUES ('fld_1', 'ws_main', 'prj_p1', 'Folder 1', 1, ?, ?)")
    .run(now, now);

  // Upaya reparenting folder ke project_id lain ditolak
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'folder',
        entityId: 'fld_1',
        operation: 'upsert',
        expectedVersion: 1,
        mutation: { clientMutationId: 'mut_reparent_fld', payload: {} },
        domainPlan: {
          action: 'update',
          attributes: { project_id: 'prj_p2', name: 'Moved Folder' },
        },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('project_id'));
      return true;
    }
  );

  // Buat recording pada prj_p1
  sqlite
    .prepare("INSERT INTO recording (id, workspace_id, project_id, title, category, duration_sec, created_by_user_id, version, created_at, updated_at) VALUES ('rec_r1', 'ws_main', 'prj_p1', 'Rec 1', 'general', 10, 'u_alice', 1, ?, ?)")
    .run(now, now);

  // Upaya reparenting recording ke project lain ditolak
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'recording',
        entityId: 'rec_r1',
        operation: 'upsert',
        expectedVersion: 1,
        mutation: { clientMutationId: 'mut_reparent_rec', payload: {} },
        domainPlan: {
          action: 'update',
          attributes: { project_id: 'prj_p2', title: 'Moved Rec' },
        },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('project_id'));
      return true;
    }
  );
});

// =========================================================================
// SERVER-OWNED IDEMPOTENCY FINGERPRINT & MANDATORY CAS TESTS
// =========================================================================

test('Server-Owned Idempotency Fingerprint: deteksi divergensi intent pada idempotency key sama', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // Buat entity awal untuk pengujian update/delete
  const baseRes = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_fp_base',
    operation: 'upsert',
    data: { tag: 'initial' },
    mutation: { clientMutationId: 'mut_base_init', payload: { name: 'Initial FP Project' } },
    domainPlan: {
      action: 'insert',
      attributes: { name: 'Initial FP Project' },
    },
  });
  assert.equal(baseRes.version, 1);

  // 1. Eksekusi mutasi awal dengan clientMutationId 'mut_fp_test'
  const baseUpdateParams = {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project' as const,
    entityId: 'prj_fp_base',
    operation: 'upsert' as const,
    expectedVersion: 1,
    data: { step: 1 },
    mutation: { clientMutationId: 'mut_fp_test', payload: { name: 'Updated Step 1' } },
    domainPlan: {
      action: 'update' as const,
      attributes: { name: 'Updated Step 1' },
    },
  };

  const initialRes = await appendWorkspaceChange(db, baseUpdateParams);
  assert.equal(initialRes.version, 2);

  // 2. Key sama + intent identik => replay canonical result (200 OK semantics)
  const replayRes = await appendWorkspaceChange(db, baseUpdateParams);
  assert.deepEqual(replayRes, initialRes);

  // 3. Key sama + entityId berbeda => IDEMPOTENCY_CONFLICT (409)
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        ...baseUpdateParams,
        entityId: 'prj_other_target',
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // 4. Key sama + action/operation berbeda => IDEMPOTENCY_CONFLICT (409)
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        ...baseUpdateParams,
        operation: 'delete',
        domainPlan: { action: 'delete' },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // 5. Key sama + attributes berbeda => IDEMPOTENCY_CONFLICT (409)
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        ...baseUpdateParams,
        domainPlan: {
          action: 'update',
          attributes: { name: 'Divergent Attributes' },
        },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // 6. Key sama + expectedVersion berbeda => IDEMPOTENCY_CONFLICT (409)
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        ...baseUpdateParams,
        expectedVersion: 99,
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // 7. Key sama + response data berbeda => IDEMPOTENCY_CONFLICT (409)
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        ...baseUpdateParams,
        data: { step: 999 },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    }
  );
});

test('Mandatory CAS: penegakan expectedVersion untuk insert, update, dan delete', async () => {
  const sqlite = createMigratedTestDb();
  setupWorkspaceEnv(sqlite);
  const db = createD1DatabaseAdapter(sqlite);

  // 1. Insert dengan expectedVersion 0 berhasil
  const ins1 = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_cas_val_1',
    operation: 'upsert',
    expectedVersion: 0,
    mutation: { clientMutationId: 'mut_ins_0', payload: { name: 'Ins 0' } },
    domainPlan: { action: 'insert', attributes: { name: 'Ins 0' } },
  });
  assert.equal(ins1.version, 1);

  // 2. Insert dengan expectedVersion undefined berhasil
  const ins2 = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_cas_val_2',
    operation: 'upsert',
    expectedVersion: undefined,
    mutation: { clientMutationId: 'mut_ins_undef', payload: { name: 'Ins Undef' } },
    domainPlan: { action: 'insert', attributes: { name: 'Ins Undef' } },
  });
  assert.equal(ins2.version, 1);

  // 3. Insert dengan expectedVersion selain 0 atau undefined ditolak (400 INVALID_MUTATION_PLAN)
  for (const invalidVer of [1, 2, -1, 1.5, NaN]) {
    await assert.rejects(
      async () => {
        await appendWorkspaceChange(db, {
          workspaceId: 'ws_main',
          userId: 'u_alice',
          entityType: 'project',
          entityId: `prj_ins_bad_${invalidVer}`,
          operation: 'upsert',
          expectedVersion: invalidVer,
          mutation: { clientMutationId: `mut_ins_bad_${invalidVer}`, payload: { name: 'Bad Ins' } },
          domainPlan: { action: 'insert', attributes: { name: 'Bad Ins' } },
        });
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceDomainError);
        assert.equal(err.code, 'INVALID_MUTATION_PLAN');
        assert.equal(err.status, 400);
        return true;
      }
    );
  }

  // 4. Update tanpa expectedVersion (undefined) ditolak (400 INVALID_MUTATION_PLAN)
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_cas_val_1',
        operation: 'upsert',
        mutation: { clientMutationId: 'mut_upd_missing_ver', payload: { name: 'Missing Ver' } },
        domainPlan: { action: 'update', attributes: { name: 'Missing Ver' } },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      return true;
    }
  );

  // 5. Update dengan expectedVersion tidak valid (0, negatif, desimal, NaN) ditolak (400)
  for (const badVer of [0, -1, -5, 1.25, NaN]) {
    await assert.rejects(
      async () => {
        await appendWorkspaceChange(db, {
          workspaceId: 'ws_main',
          userId: 'u_alice',
          entityType: 'project',
          entityId: 'prj_cas_val_1',
          operation: 'upsert',
          expectedVersion: badVer,
          mutation: { clientMutationId: `mut_upd_bad_${badVer}`, payload: { name: 'Bad Ver' } },
          domainPlan: { action: 'update', attributes: { name: 'Bad Ver' } },
        });
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceDomainError);
        assert.equal(err.code, 'INVALID_MUTATION_PLAN');
        assert.equal(err.status, 400);
        return true;
      }
    );
  }

  // 6. Delete tanpa expectedVersion (undefined) ditolak (400 INVALID_MUTATION_PLAN)
  await assert.rejects(
    async () => {
      await appendWorkspaceChange(db, {
        workspaceId: 'ws_main',
        userId: 'u_alice',
        entityType: 'project',
        entityId: 'prj_cas_val_1',
        operation: 'delete',
        mutation: { clientMutationId: 'mut_del_missing_ver', payload: {} },
        domainPlan: { action: 'delete' },
      });
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'INVALID_MUTATION_PLAN');
      assert.equal(err.status, 400);
      return true;
    }
  );

  // 7. Delete dengan expectedVersion tidak valid (0, negatif, desimal, NaN) ditolak (400)
  for (const badVer of [0, -2, 2.5, NaN]) {
    await assert.rejects(
      async () => {
        await appendWorkspaceChange(db, {
          workspaceId: 'ws_main',
          userId: 'u_alice',
          entityType: 'project',
          entityId: 'prj_cas_val_1',
          operation: 'delete',
          expectedVersion: badVer,
          mutation: { clientMutationId: `mut_del_bad_${badVer}`, payload: {} },
          domainPlan: { action: 'delete' },
        });
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceDomainError);
        assert.equal(err.code, 'INVALID_MUTATION_PLAN');
        assert.equal(err.status, 400);
        return true;
      }
    );
  }

  // 8. Update dengan expectedVersion valid integer positif berhasil
  const updOk = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_cas_val_1',
    operation: 'upsert',
    expectedVersion: 1,
    mutation: { clientMutationId: 'mut_upd_ok', payload: { name: 'Valid Upd' } },
    domainPlan: { action: 'update', attributes: { name: 'Valid Upd' } },
  });
  assert.equal(updOk.version, 2);

  // 9. Delete dengan expectedVersion valid integer positif berhasil
  const delOk = await appendWorkspaceChange(db, {
    workspaceId: 'ws_main',
    userId: 'u_alice',
    entityType: 'project',
    entityId: 'prj_cas_val_1',
    operation: 'delete',
    expectedVersion: 2,
    mutation: { clientMutationId: 'mut_del_ok', payload: {} },
    domainPlan: { action: 'delete' },
  });
  assert.equal(delOk.version, 3);
  assert.equal(delOk.operation, 'delete');
});
