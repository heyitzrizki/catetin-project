import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getWorkspaceAccess,
  canRead,
  canMutateData,
  canManageMembers,
  canPerformOwnerAction,
  requireWorkspacePermission,
  assertCanRemoveOrDemoteMember,
  assertEntityBelongsToWorkspace,
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

test('personal owner allowed: pemilik sah ruang kerja personal mendapatkan akses owner', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();
  const iso = new Date().toISOString();

  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_pers_owner', 'Personal Owner', 'pers@example.com', iso, iso);

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_personal_1', 'personal', 'Ruang Saya', 'ws-pers-1', 'u_pers_owner', ?, ?)`
    )
    .run(now, now);

  const access = await getWorkspaceAccess(db, 'u_pers_owner', 'ws_personal_1');
  assert.equal(access.workspaceId, 'ws_personal_1');
  assert.equal(access.userId, 'u_pers_owner');
  assert.equal(access.workspaceType, 'personal');
  assert.equal(access.role, 'owner');
  assert.equal(access.latestChangeSeq, 0);
  assert.equal(access.minValidSyncSeq, 0);

  // Verifikasi izin owner
  assert.equal(canRead(access.role), true);
  assert.equal(canMutateData(access.role), true);
  assert.equal(canManageMembers(access.role), true);
  assert.equal(canPerformOwnerAction(access.role), true);
  assert.doesNotThrow(() => requireWorkspacePermission(access, 'owner'));
});

test('non-owner personal workspace ditolak sebagai not found (404)', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();
  const iso = new Date().toISOString();

  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_pers_owner', 'Owner', 'owner@example.com', iso, iso);
  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_intruder', 'Intruder', 'intruder@example.com', iso, iso);

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_personal_secret', 'personal', 'Ruang Rahasia', 'ws-pers-secret', 'u_pers_owner', ?, ?)`
    )
    .run(now, now);

  // Akses oleh non-owner WAJIB menghasilkan WORKSPACE_NOT_FOUND (404), bukan 403
  await assert.rejects(
    async () => {
      await getWorkspaceAccess(db, 'u_intruder', 'ws_personal_secret');
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'WORKSPACE_NOT_FOUND');
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test('team owner/admin/member permissions: hierarki peran dan hak akses tervalidasi', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();
  const iso = new Date().toISOString();

  for (const u of ['u_team_owner', 'u_team_admin', 'u_team_member']) {
    sqlite
      .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run(u, u, `${u}@example.com`, iso, iso);
  }

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_team_1', 'team', 'Tim Riset', 'ws-team-1', NULL, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_1', 'ws_team_1', 'u_team_owner', 'owner', ?, ?),
              ('m_2', 'ws_team_1', 'u_team_admin', 'admin', ?, ?),
              ('m_3', 'ws_team_1', 'u_team_member', 'member', ?, ?)`
    )
    .run(now, now, now, now, now, now);

  // 1. Owner
  const ownerAccess = await getWorkspaceAccess(db, 'u_team_owner', 'ws_team_1');
  assert.equal(ownerAccess.role, 'owner');
  assert.equal(canRead(ownerAccess.role), true);
  assert.equal(canMutateData(ownerAccess.role), true);
  assert.equal(canManageMembers(ownerAccess.role), true);
  assert.equal(canPerformOwnerAction(ownerAccess.role), true);
  assert.doesNotThrow(() => requireWorkspacePermission(ownerAccess, 'owner'));

  // 2. Admin
  const adminAccess = await getWorkspaceAccess(db, 'u_team_admin', 'ws_team_1');
  assert.equal(adminAccess.role, 'admin');
  assert.equal(canRead(adminAccess.role), true);
  assert.equal(canMutateData(adminAccess.role), true);
  assert.equal(canManageMembers(adminAccess.role), true);
  assert.equal(canPerformOwnerAction(adminAccess.role), false);
  assert.doesNotThrow(() => requireWorkspacePermission(adminAccess, 'manage_members'));
  assert.throws(() => requireWorkspacePermission(adminAccess, 'owner'), (err: any) => {
    assert.ok(err instanceof WorkspaceDomainError);
    assert.equal(err.code, 'FORBIDDEN');
    assert.equal(err.status, 403);
    return true;
  });

  // 3. Member
  const memberAccess = await getWorkspaceAccess(db, 'u_team_member', 'ws_team_1');
  assert.equal(memberAccess.role, 'member');
  assert.equal(canRead(memberAccess.role), true);
  assert.equal(canMutateData(memberAccess.role), true);
  assert.equal(canManageMembers(memberAccess.role), false);
  assert.equal(canPerformOwnerAction(memberAccess.role), false);
  assert.doesNotThrow(() => requireWorkspacePermission(memberAccess, 'mutate'));
  assert.throws(() => requireWorkspacePermission(memberAccess, 'manage_members'), (err: any) => {
    assert.ok(err instanceof WorkspaceDomainError);
    assert.equal(err.code, 'FORBIDDEN');
    assert.equal(err.status, 403);
    return true;
  });
});

test('revoked membership langsung ditolak seketika', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();
  const iso = new Date().toISOString();

  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_revoked', 'Revoked User', 'revoked@example.com', iso, iso);

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_team_rev', 'team', 'Tim Proyek', 'ws-team-rev', NULL, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_rev', 'ws_team_rev', 'u_revoked', 'member', ?, ?)`
    )
    .run(now, now);

  // Akses saat membership aktif: sukses
  const validAccess = await getWorkspaceAccess(db, 'u_revoked', 'ws_team_rev');
  assert.equal(validAccess.role, 'member');

  // Cabut membership
  sqlite.prepare(`DELETE FROM workspace_membership WHERE id = 'm_rev'`).run();

  // Akses seketika ditolak sebagai WORKSPACE_NOT_FOUND (404)
  await assert.rejects(
    async () => {
      await getWorkspaceAccess(db, 'u_revoked', 'ws_team_rev');
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'WORKSPACE_NOT_FOUND');
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test('cross-workspace resource isolation: resource milik workspace lain diperlakukan sebagai not found', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();
  const iso = new Date().toISOString();

  sqlite
    .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
    .run('u_creator', 'Creator', 'creator@example.com', iso, iso);

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_a', 'team', 'Workspace A', 'ws-a', NULL, ?, ?),
              ('ws_b', 'team', 'Workspace B', 'ws-b', NULL, ?, ?)`
    )
    .run(now, now, now, now);

  // Buat rekaman di Workspace A
  sqlite
    .prepare(
      `INSERT INTO recording (id, workspace_id, title, duration_sec, category, created_by_user_id, created_at, updated_at)
       VALUES ('rec_in_a', 'ws_a', 'Rekaman Rahasia A', 120, 'meeting', 'u_creator', ?, ?)`
    )
    .run(now, now);

  // Verifikasi rekaman di Workspace A sah
  await assert.doesNotReject(async () => {
    await assertEntityBelongsToWorkspace(db, 'ws_a', 'recording', 'rec_in_a');
  });

  // Verifikasi permintaan rekaman A dari Workspace B ditolak sebagai WORKSPACE_NOT_FOUND (404)
  await assert.rejects(
    async () => {
      await assertEntityBelongsToWorkspace(db, 'ws_b', 'recording', 'rec_in_a');
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'WORKSPACE_NOT_FOUND');
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test('last team owner tidak dapat dihapus atau didemote', async () => {
  const sqlite = createMigratedTestDb();
  const db = createD1DatabaseAdapter(sqlite);
  const now = Date.now();
  const iso = new Date().toISOString();

  for (const u of ['u_owner_sole', 'u_owner_second', 'u_admin_other']) {
    sqlite
      .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run(u, u, `${u}@example.com`, iso, iso);
  }

  sqlite
    .prepare(
      `INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
       VALUES ('ws_team_last_owner', 'team', 'Tim Solo Owner', 'ws-team-solo', NULL, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_sole', 'ws_team_last_owner', 'u_owner_sole', 'owner', ?, ?)`
    )
    .run(now, now);

  // 1. Upaya penghapusan owner tunggal ditolak dengan LAST_OWNER_REQUIRED (409)
  await assert.rejects(
    async () => {
      await assertCanRemoveOrDemoteMember(db, 'ws_team_last_owner', 'u_owner_sole', null);
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'LAST_OWNER_REQUIRED');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // 2. Upaya demosi owner tunggal menjadi admin ditolak dengan LAST_OWNER_REQUIRED (409)
  await assert.rejects(
    async () => {
      await assertCanRemoveOrDemoteMember(db, 'ws_team_last_owner', 'u_owner_sole', 'admin');
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'LAST_OWNER_REQUIRED');
      assert.equal(err.status, 409);
      return true;
    }
  );

  // 3. Tambahkan owner kedua
  sqlite
    .prepare(
      `INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
       VALUES ('m_sec', 'ws_team_last_owner', 'u_owner_second', 'owner', ?, ?)`
    )
    .run(now, now);

  // Sekarang u_owner_sole dapat didemote atau dihapus karena masih ada u_owner_second
  await assert.doesNotReject(async () => {
    await assertCanRemoveOrDemoteMember(db, 'ws_team_last_owner', 'u_owner_sole', 'admin');
  });

  await assert.doesNotReject(async () => {
    await assertCanRemoveOrDemoteMember(db, 'ws_team_last_owner', 'u_owner_sole', null);
  });
});

test('Barrier 1: actor lolos initial check, lalu membership actor dicabut sebelum write', async () => {
  const sqlite = createMigratedTestDb();
  const now = Date.now();
  const iso = new Date().toISOString();

  for (const u of ['u_b1_owner', 'u_b1_admin', 'u_b1_target']) {
    sqlite
      .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run(u, u, `${u}@example.com`, iso, iso);
  }
  sqlite
    .prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_b1', 'team', 'WS B1', 'ws-b1', NULL, ?, ?)")
    .run(now, now);
  sqlite
    .prepare("INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('m_b1_o', 'ws_b1', 'u_b1_owner', 'owner', ?, ?), ('m_b1_a', 'ws_b1', 'u_b1_admin', 'admin', ?, ?), ('m_b1_t', 'ws_b1', 'u_b1_target', 'member', ?, ?)")
    .run(now, now, now, now, now, now);

  const barrier = createDeferred();
  const dbInterleaved = createInterleavingD1Adapter(sqlite, {
    async beforeRun(sql) {
      if (sql.includes('DELETE FROM workspace_membership')) {
        await barrier.promise;
      }
    },
  });

  // Admin memulai penghapusan target member
  const task = removeWorkspaceMember(dbInterleaved, 'u_b1_admin', 'ws_b1', 'u_b1_target');

  await new Promise((r) => setTimeout(r, 20));

  // Owner mencabut keanggotaan admin sebelum write berlangsung
  const dbNormal = createD1DatabaseAdapter(sqlite);
  sqlite.prepare("DELETE FROM workspace_membership WHERE workspace_id = 'ws_b1' AND user_id = 'u_b1_admin'").run();

  barrier.resolve();

  // Admin yang sudah dicabut ditolak dengan FORBIDDEN (403)
  await assert.rejects(
    async () => {
      await task;
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'FORBIDDEN');
      assert.equal(err.status, 403);
      return true;
    }
  );

  // Target member tetap ada
  const targetMember = sqlite.prepare("SELECT user_id FROM workspace_membership WHERE workspace_id = 'ws_b1' AND user_id = 'u_b1_target'").get();
  assert.ok(targetMember);
});

test('Barrier 2: actor admin didemote menjadi member sebelum write', async () => {
  const sqlite = createMigratedTestDb();
  const now = Date.now();
  const iso = new Date().toISOString();

  for (const u of ['u_b2_owner', 'u_b2_admin', 'u_b2_target']) {
    sqlite
      .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run(u, u, `${u}@example.com`, iso, iso);
  }
  sqlite
    .prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_b2', 'team', 'WS B2', 'ws-b2', NULL, ?, ?)")
    .run(now, now);
  sqlite
    .prepare("INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('m_b2_o', 'ws_b2', 'u_b2_owner', 'owner', ?, ?), ('m_b2_a', 'ws_b2', 'u_b2_admin', 'admin', ?, ?), ('m_b2_t', 'ws_b2', 'u_b2_target', 'member', ?, ?)")
    .run(now, now, now, now, now, now);

  const barrier = createDeferred();
  const dbInterleaved = createInterleavingD1Adapter(sqlite, {
    async beforeRun(sql) {
      if (sql.includes('DELETE FROM workspace_membership')) {
        await barrier.promise;
      }
    },
  });

  const task = removeWorkspaceMember(dbInterleaved, 'u_b2_admin', 'ws_b2', 'u_b2_target');

  await new Promise((r) => setTimeout(r, 20));

  // Owner menurunkan role admin menjadi member
  sqlite.prepare("UPDATE workspace_membership SET role = 'member' WHERE workspace_id = 'ws_b2' AND user_id = 'u_b2_admin'").run();

  barrier.resolve();

  // Admin yang telah diturunkan perannya ditolak dengan FORBIDDEN (403)
  await assert.rejects(
    async () => {
      await task;
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'FORBIDDEN');
      assert.equal(err.status, 403);
      return true;
    }
  );

  const targetMember = sqlite.prepare("SELECT user_id FROM workspace_membership WHERE workspace_id = 'ws_b2' AND user_id = 'u_b2_target'").get();
  assert.ok(targetMember);
});

test('Barrier 3: target member berubah menjadi owner sebelum admin DELETE', async () => {
  const sqlite = createMigratedTestDb();
  const now = Date.now();
  const iso = new Date().toISOString();

  for (const u of ['u_b3_owner', 'u_b3_admin', 'u_b3_target']) {
    sqlite
      .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run(u, u, `${u}@example.com`, iso, iso);
  }
  sqlite
    .prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_b3', 'team', 'WS B3', 'ws-b3', NULL, ?, ?)")
    .run(now, now);
  sqlite
    .prepare("INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('m_b3_o', 'ws_b3', 'u_b3_owner', 'owner', ?, ?), ('m_b3_a', 'ws_b3', 'u_b3_admin', 'admin', ?, ?), ('m_b3_t', 'ws_b3', 'u_b3_target', 'member', ?, ?)")
    .run(now, now, now, now, now, now);

  const barrier = createDeferred();
  const dbInterleaved = createInterleavingD1Adapter(sqlite, {
    async beforeRun(sql) {
      if (sql.includes('DELETE FROM workspace_membership')) {
        await barrier.promise;
      }
    },
  });

  const task = removeWorkspaceMember(dbInterleaved, 'u_b3_admin', 'ws_b3', 'u_b3_target');

  await new Promise((r) => setTimeout(r, 20));

  // Owner menaikkan target member menjadi owner
  sqlite.prepare("UPDATE workspace_membership SET role = 'owner' WHERE workspace_id = 'ws_b3' AND user_id = 'u_b3_target'").run();

  barrier.resolve();

  // Admin tidak boleh menghapus target yang kini berstatus owner -> FORBIDDEN (403)
  await assert.rejects(
    async () => {
      await task;
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'FORBIDDEN');
      assert.equal(err.status, 403);
      return true;
    }
  );

  const targetMember = sqlite.prepare("SELECT role FROM workspace_membership WHERE workspace_id = 'ws_b3' AND user_id = 'u_b3_target'").get() as any;
  assert.equal(targetMember.role, 'owner');
});

test('Barrier 4: admin mencoba mengangkat owner', async () => {
  const sqlite = createMigratedTestDb();
  const now = Date.now();
  const iso = new Date().toISOString();

  for (const u of ['u_b4_owner', 'u_b4_admin', 'u_b4_target']) {
    sqlite
      .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run(u, u, `${u}@example.com`, iso, iso);
  }
  sqlite
    .prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_b4', 'team', 'WS B4', 'ws-b4', NULL, ?, ?)")
    .run(now, now);
  sqlite
    .prepare("INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('m_b4_o', 'ws_b4', 'u_b4_owner', 'owner', ?, ?), ('m_b4_a', 'ws_b4', 'u_b4_admin', 'admin', ?, ?), ('m_b4_t', 'ws_b4', 'u_b4_target', 'member', ?, ?)")
    .run(now, now, now, now, now, now);

  const db = createD1DatabaseAdapter(sqlite);

  // Admin mencoba mengangkat member menjadi owner
  await assert.rejects(
    async () => {
      await updateWorkspaceMemberRole(db, 'u_b4_admin', 'ws_b4', 'u_b4_target', 'owner');
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.code, 'FORBIDDEN');
      assert.equal(err.status, 403);
      return true;
    }
  );

  const targetMember = sqlite.prepare("SELECT role FROM workspace_membership WHERE workspace_id = 'ws_b4' AND user_id = 'u_b4_target'").get() as any;
  assert.equal(targetMember.role, 'member');
});

test('Barrier 5: concurrent owner removal tetap menyisakan minimal satu owner', async () => {
  const sqlite = createMigratedTestDb();
  const now = Date.now();
  const iso = new Date().toISOString();

  for (const u of ['u_b5_owner1', 'u_b5_owner2']) {
    sqlite
      .prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run(u, u, `${u}@example.com`, iso, iso);
  }
  sqlite
    .prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_b5', 'team', 'WS B5', 'ws-b5', NULL, ?, ?)")
    .run(now, now);
  sqlite
    .prepare("INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('m_b5_o1', 'ws_b5', 'u_b5_owner1', 'owner', ?, ?), ('m_b5_o2', 'ws_b5', 'u_b5_owner2', 'owner', ?, ?)")
    .run(now, now, now, now);

  const barrier = createDeferred();
  const dbInterleaved = createInterleavingD1Adapter(sqlite, {
    async beforeRun(sql) {
      if (sql.includes('DELETE FROM workspace_membership')) {
        await barrier.promise;
      }
    },
  });

  const dbNormal = createD1DatabaseAdapter(sqlite);

  // Owner 1 menghapus Owner 2 (tertahan di barrier)
  const taskDel2 = removeWorkspaceMember(dbInterleaved, 'u_b5_owner1', 'ws_b5', 'u_b5_owner2');

  await new Promise((r) => setTimeout(r, 20));

  // Owner 2 menghapus Owner 1 (berhasil)
  await removeWorkspaceMember(dbNormal, 'u_b5_owner2', 'ws_b5', 'u_b5_owner1');

  // Lepaskan Owner 1
  barrier.resolve();

  // Transaksi Owner 1 wajib gagal karena Owner 1 sudah bukan member dan Owner 2 adalah last owner
  await assert.rejects(
    async () => {
      await taskDel2;
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.ok(err.code === 'FORBIDDEN' || err.code === 'LAST_OWNER_REQUIRED');
      return true;
    }
  );

  // Tepat satu owner tersisa
  const owners = sqlite.prepare("SELECT user_id FROM workspace_membership WHERE workspace_id = 'ws_b5' AND role = 'owner'").all() as any[];
  assert.equal(owners.length, 1);
  assert.equal(owners[0].user_id, 'u_b5_owner2');
});

test('Sanitasi DB errors: raw error dengan pesan SQL sensitif diubah menjadi WorkspaceDomainError 500 generik', async () => {
  const sqlite = createMigratedTestDb();
  const sensitiveErrorMsg = 'FATAL SQLITE ERROR: SELECT * FROM secret_tokens WHERE internal_key = "abc_123_xyz" crashed table!';

  const dbFaulty = createInterleavingD1Adapter(sqlite, {
    beforeRun() {
      throw new Error(sensitiveErrorMsg);
    },
  });

  // 1. Uji pada removeWorkspaceMember
  await assert.rejects(
    async () => {
      await removeWorkspaceMember(dbFaulty, 'u_anyone', 'ws_any', 'u_target');
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.status, 500);
      assert.equal(err.code, 'INTERNAL_OPERATION_FAILED');
      assert.equal(err.message, 'Terjadi kesalahan internal saat memproses keanggotaan ruang kerja');
      assert.equal(err.message.includes('secret_tokens'), false);
      assert.equal(err.message.includes('abc_123_xyz'), false);
      assert.equal(err.message.includes('SQLITE'), false);
      return true;
    }
  );

  // 2. Uji pada updateWorkspaceMemberRole
  await assert.rejects(
    async () => {
      await updateWorkspaceMemberRole(dbFaulty, 'u_anyone', 'ws_any', 'u_target', 'member');
    },
    (err: any) => {
      assert.ok(err instanceof WorkspaceDomainError);
      assert.equal(err.status, 500);
      assert.equal(err.code, 'INTERNAL_OPERATION_FAILED');
      assert.equal(err.message, 'Terjadi kesalahan internal saat memproses keanggotaan ruang kerja');
      assert.equal(err.message.includes('secret_tokens'), false);
      assert.equal(err.message.includes('abc_123_xyz'), false);
      assert.equal(err.message.includes('SQLITE'), false);
      return true;
    }
  );
});
