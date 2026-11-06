import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isTranscriptPayloadWithinLimit, normalizeTagName } from '../../worker/types/cloud-model.js';

const migration1Path = path.resolve(process.cwd(), 'migrations/0001_better_auth.sql');
const migration2Path = path.resolve(process.cwd(), 'migrations/0002_account_usage.sql');
const migration3Path = path.resolve(process.cwd(), 'migrations/0003_account_entitlement.sql');
const migration4Path = path.resolve(process.cwd(), 'migrations/0004_cloud_workspace_data_model.sql');

function createMigratedDb(): DatabaseSync {
  const m1 = fs.readFileSync(migration1Path, 'utf8');
  const m2 = fs.readFileSync(migration2Path, 'utf8');
  const m3 = fs.readFileSync(migration3Path, 'utf8');
  const m4 = fs.readFileSync(migration4Path, 'utf8');

  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(m1);
  db.exec(m2);
  db.exec(m3);
  db.exec(m4);
  return db;
}

test('skema migration 0001, 0002, 0003, dan 0004 dapat diterapkan berurutan ke database kosong', () => {
  const db = createMigratedDb();
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name);

    const expectedR2Tables = [
      'workspace',
      'workspace_membership',
      'project',
      'folder',
      'tag',
      'recording',
      'audio_asset',
      'recording_tag',
      'speaker',
      'transcript',
      'transcript_revision',
      'workspace_change_log',
      'mutation_idempotency',
      'import_ledger',
      'account_deletion_job',
      'account_deletion_object',
    ];

    for (const tbl of expectedR2Tables) {
      assert.ok(tables.includes(tbl), `Tabel ${tbl} harus ada di database`);
    }

    const forbiddenTables = [
      'transcription_job',
      'account_balance',
      'balance_transaction',
      'subscription',
      'payment',
      'invoice',
      'referral',
    ];
    for (const forbidden of forbiddenTables) {
      assert.equal(tables.includes(forbidden), false, `Tabel ${forbidden} tidak boleh ada di migration 0004`);
    }
  } finally {
    db.close();
  }
});

test('workspace ownership: personal vs team dan penolakan cascade deletion pada team', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    const iso = new Date().toISOString();

    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_owner_1',
      'Owner User',
      'owner@example.com',
      iso,
      iso
    );

    // 1. Personal workspace wajib memiliki personal_owner_user_id
    db.prepare(`
      INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
      VALUES (?, 'personal', ?, ?, ?, ?, ?)
    `).run('ws_pers_1', 'Ruang Pribadi', 'ws-pers-1', 'u_owner_1', now, now);

    // 2. Personal workspace tanpa personal_owner_user_id harus ditolak CHECK constraint
    assert.throws(() => {
      db.prepare(`
        INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
        VALUES ('ws_bad_pers', 'personal', 'Bad Personal', 'ws-bad', NULL, ?, ?)
      `).run(now, now);
    }, /CHECK constraint failed/i);

    // 3. User yang sama tidak boleh memiliki personal workspace kedua (UNIQUE constraint)
    assert.throws(() => {
      db.prepare(`
        INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
        VALUES ('ws_pers_2', 'personal', 'Ruang Pribadi 2', 'ws-pers-2', 'u_owner_1', ?, ?)
      `).run(now, now);
    }, /UNIQUE constraint failed/i);

    // 4. Team workspace tidak boleh memiliki personal_owner_user_id
    db.prepare(`
      INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
      VALUES (?, 'team', ?, ?, NULL, ?, ?)
    `).run('ws_team_1', 'Tim Studio', 'ws-team-1', now, now);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
        VALUES ('ws_bad_team', 'team', 'Bad Team', 'ws-bad-team', 'u_owner_1', ?, ?)
      `).run(now, now);
    }, /CHECK constraint failed/i);

    // 5. Team workspace ownership ditentukan via membership role 'owner'
    db.prepare(`
      INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
      VALUES ('wsm_1', 'ws_team_1', 'u_owner_1', 'owner', ?, ?)
    `).run(now, now);

    // 6. Menghapus user anggota tidak menghapus team workspace
    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_member_1',
      'Member User',
      'member@example.com',
      iso,
      iso
    );
    db.prepare(`
      INSERT INTO workspace_membership (id, workspace_id, user_id, role, created_at, updated_at)
      VALUES ('wsm_2', 'ws_team_1', 'u_member_1', 'member', ?, ?)
    `).run(now, now);

    db.prepare('DELETE FROM "user" WHERE "id" = ?').run('u_member_1');
    const teamWs = db.prepare('SELECT * FROM workspace WHERE id = ?').get('ws_team_1') as any;
    assert.ok(teamWs, 'Team workspace tidak boleh terhapus ketika user dihapus');

    // 7. Menghapus user yang memiliki personal workspace atau last owner ditolak
    assert.throws(() => {
      db.prepare('DELETE FROM "user" WHERE "id" = ?').run('u_owner_1');
    }, /FOREIGN KEY constraint failed|LAST_OWNER_REQUIRED/i);
  } finally {
    db.close();
  }
});

test('folder per project: folder wajib milik project, tidak ada nesting, dan FK folder scope aman', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    const iso = new Date().toISOString();

    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_proj_1',
      'Project User',
      'proj@example.com',
      iso,
      iso
    );
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_p1', 'team', 'WS P1', 'ws-p1', NULL, ?, ?)").run(now, now);
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_p2', 'team', 'WS P2', 'ws-p2', NULL, ?, ?)").run(now, now);

    db.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at, updated_at) VALUES ('prj_1', 'ws_p1', 'Proyek 1', 'u_proj_1', ?, ?)").run(now, now);
    db.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at, updated_at) VALUES ('prj_2', 'ws_p1', 'Proyek 2', 'u_proj_1', ?, ?)").run(now, now);
    db.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at, updated_at) VALUES ('prj_ws2', 'ws_p2', 'Proyek WS2', 'u_proj_1', ?, ?)").run(now, now);

    // 1. Folder wajib memiliki project_id
    db.prepare("INSERT INTO folder (id, workspace_id, project_id, name, created_at, updated_at) VALUES ('fld_1', 'ws_p1', 'prj_1', 'Folder Proyek 1', ?, ?)").run(now, now);

    // 2. Folder tidak memiliki kolom parent
    const folderCols = (db.prepare("PRAGMA table_info('folder')").all() as any[]).map((c) => c.name);
    assert.equal(folderCols.includes('parent_id'), false);
    assert.equal(folderCols.includes('parent_folder_id'), false);

    // 3. Folder menolak cross-workspace project
    assert.throws(() => {
      db.prepare("INSERT INTO folder (id, workspace_id, project_id, name, created_at, updated_at) VALUES ('fld_bad', 'ws_p1', 'prj_ws2', 'Bad Folder', ?, ?)").run(now, now);
    }, /FOREIGN KEY constraint failed/i);

    // 4. Recording menolak folder dari project lain dalam workspace yang sama
    assert.throws(() => {
      db.prepare("INSERT INTO recording (id, workspace_id, project_id, folder_id, title, created_by_user_id, created_at, updated_at) VALUES ('rec_bad', 'ws_p1', 'prj_2', 'fld_1', 'Rekaman Bad', 'u_proj_1', ?, ?)").run(now, now);
    }, /FOREIGN KEY constraint failed.*folder does not belong to same workspace and project/i);

    // 5. Recording menolak folder dari workspace lain
    assert.throws(() => {
      db.prepare("INSERT INTO recording (id, workspace_id, project_id, folder_id, title, created_by_user_id, created_at, updated_at) VALUES ('rec_bad_ws', 'ws_p2', 'prj_ws2', 'fld_1', 'Rekaman Bad WS', 'u_proj_1', ?, ?)").run(now, now);
    }, /FOREIGN KEY constraint failed.*folder does not belong to same workspace and project/i);

    // 6. Recording valid dengan folder dan project cocok
    db.prepare("INSERT INTO recording (id, workspace_id, project_id, folder_id, title, created_by_user_id, created_at, updated_at) VALUES ('rec_ok', 'ws_p1', 'prj_1', 'fld_1', 'Rekaman OK', 'u_proj_1', ?, ?)").run(now, now);
    let rec = db.prepare('SELECT folder_id FROM recording WHERE id = ?').get('rec_ok') as any;
    assert.equal(rec.folder_id, 'fld_1');

    // 7. Menghapus folder membuat recording.folder_id menjadi NULL tanpa menghapus rekaman
    db.prepare("DELETE FROM folder WHERE id = 'fld_1'").run();
    rec = db.prepare('SELECT folder_id, project_id FROM recording WHERE id = ?').get('rec_ok') as any;
    assert.equal(rec.folder_id, null);
    assert.equal(rec.project_id, 'prj_1');
  } finally {
    db.close();
  }
});

test('project delete behavior: ON DELETE RESTRICT menolak hard delete saat masih direferensikan recording', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    const iso = new Date().toISOString();

    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_pdel_1',
      'PDel User',
      'pdel@example.com',
      iso,
      iso
    );
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_pdel', 'team', 'WS PDel', 'ws-pdel', NULL, ?, ?)").run(now, now);
    db.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at, updated_at) VALUES ('prj_pdel', 'ws_pdel', 'Proyek PDel', 'u_pdel_1', ?, ?)").run(now, now);
    db.prepare("INSERT INTO folder (id, workspace_id, project_id, name, created_at, updated_at) VALUES ('fld_pdel', 'ws_pdel', 'prj_pdel', 'Folder PDel', ?, ?)").run(now, now);

    db.prepare("INSERT INTO recording (id, workspace_id, project_id, folder_id, title, created_by_user_id, created_at, updated_at) VALUES ('rec_pdel', 'ws_pdel', 'prj_pdel', 'fld_pdel', 'Rec PDel', 'u_pdel_1', ?, ?)").run(now, now);

    // 1. Hard delete project yang masih direferensikan recording ditolak
    assert.throws(() => {
      db.prepare("DELETE FROM project WHERE id = 'prj_pdel'").run();
    }, /FOREIGN KEY constraint failed/i);

    // 2. Constraint & Trigger: recording tidak boleh memiliki folder tanpa project
    assert.throws(() => {
      db.prepare("UPDATE recording SET project_id = NULL WHERE id = 'rec_pdel'").run();
    }, /CHECK constraint failed|FOREIGN KEY constraint failed.*folder does not belong to same workspace and project/i);

    // 3. Setelah recording dilepas dari folder dan project, hard delete project berhasil
    db.prepare("UPDATE recording SET folder_id = NULL, project_id = NULL WHERE id = 'rec_pdel'").run();
    db.prepare("DELETE FROM project WHERE id = 'prj_pdel'").run();

    // 4. Verifikasi workspace_id recording tetap utuh
    const rec = db.prepare('SELECT * FROM recording WHERE id = ?').get('rec_pdel') as any;
    assert.equal(rec.workspace_id, 'ws_pdel');
    assert.equal(rec.project_id, null);
    assert.equal(rec.folder_id, null);
  } finally {
    db.close();
  }
});

test('transcript revision multiplicity: satu transcript dapat memiliki banyak revisi dengan composite FK aman', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    const iso = new Date().toISOString();

    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_rev_user',
      'Rev User',
      'rev@example.com',
      iso,
      iso
    );
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_rev', 'team', 'WS Rev', 'ws-rev', NULL, ?, ?)").run(now, now);
    db.prepare("INSERT INTO recording (id, workspace_id, title, created_by_user_id, created_at, updated_at) VALUES ('rec_rev_1', 'ws_rev', 'Rec Rev 1', 'u_rev_user', ?, ?)").run(now, now);
    db.prepare("INSERT INTO recording (id, workspace_id, title, created_by_user_id, created_at, updated_at) VALUES ('rec_rev_2', 'ws_rev', 'Rec Rev 2', 'u_rev_user', ?, ?)").run(now, now);

    db.prepare(`
      INSERT INTO transcript (id, recording_id, workspace_id, raw_document_json, checksum, created_at, updated_at)
      VALUES ('txn_rev_1', 'rec_rev_1', 'ws_rev', '{"segments":[]}', 'chk1', ?, ?)
    `).run(now, now);

    // 1. Revision 1 dan revision 2 untuk transcript/recording yang sama berhasil
    db.prepare(`
      INSERT INTO transcript_revision (id, transcript_id, recording_id, workspace_id, revision_number, r2_key, size_bytes, checksum, created_by_user_id, created_at)
      VALUES ('rev_1', 'txn_rev_1', 'rec_rev_1', 'ws_rev', 1, 'r2/rev1', 100, 'chk1', 'u_rev_user', ?)
    `).run(now);

    db.prepare(`
      INSERT INTO transcript_revision (id, transcript_id, recording_id, workspace_id, revision_number, r2_key, size_bytes, checksum, created_by_user_id, created_at)
      VALUES ('rev_2', 'txn_rev_1', 'rec_rev_1', 'ws_rev', 2, 'r2/rev2', 150, 'chk2', 'u_rev_user', ?)
    `).run(now);

    const revisions = db.prepare('SELECT revision_number FROM transcript_revision WHERE transcript_id = ? ORDER BY revision_number ASC').all('txn_rev_1') as any[];
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0].revision_number, 1);
    assert.equal(revisions[1].revision_number, 2);

    // 2. Revision duplikat revision_number pada transcript sama ditolak
    assert.throws(() => {
      db.prepare(`
        INSERT INTO transcript_revision (id, transcript_id, recording_id, workspace_id, revision_number, r2_key, size_bytes, checksum, created_by_user_id, created_at)
        VALUES ('rev_dup', 'txn_rev_1', 'rec_rev_1', 'ws_rev', 1, 'r2/revdup', 100, 'chk1', 'u_rev_user', ?)
      `).run(now);
    }, /UNIQUE constraint failed/i);

    // 3. Revision yang menunjuk transcript_id txn_rev_1 tetapi recording_id rec_rev_2 ditolak
    assert.throws(() => {
      db.prepare(`
        INSERT INTO transcript_revision (id, transcript_id, recording_id, workspace_id, revision_number, r2_key, size_bytes, checksum, created_by_user_id, created_at)
        VALUES ('rev_bad_rec', 'txn_rev_1', 'rec_rev_2', 'ws_rev', 3, 'r2/bad', 100, 'chk3', 'u_rev_user', ?)
      `).run(now);
    }, /FOREIGN KEY constraint failed/i);
  } finally {
    db.close();
  }
});

test('retention purge consistency: kombinasi valid dan invalid pada audio_asset', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    const iso = new Date().toISOString();

    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_ret_2',
      'Ret User',
      'ret2@example.com',
      iso,
      iso
    );
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_ret2', 'team', 'WS Ret2', 'ws-ret2', NULL, ?, ?)").run(now, now);
    db.prepare("INSERT INTO recording (id, workspace_id, title, created_by_user_id, created_at, updated_at) VALUES ('rec_ret2', 'ws_ret2', 'Rec Ret2', 'u_ret_2', ?, ?)").run(now, now);

    // 1. until_deleted dengan purge_at NULL berhasil
    db.prepare(`
      INSERT INTO audio_asset (id, recording_id, workspace_id, r2_key, filename, mime_type, size_bytes, duration_sec, sha256, retention_tier, purge_at, created_at, updated_at)
      VALUES ('aud_ok_until', 'rec_ret2', 'ws_ret2', 'r2/until', 'audio.mp3', 'audio/mpeg', 100, 1.0, 'sha', 'until_deleted', NULL, ?, ?)
    `).run(now, now);

    // 2. until_deleted dengan purge_at non-NULL ditolak
    assert.throws(() => {
      db.prepare(`
        INSERT INTO audio_asset (id, recording_id, workspace_id, r2_key, filename, mime_type, size_bytes, duration_sec, sha256, retention_tier, purge_at, created_at, updated_at)
        VALUES ('aud_bad_until', 'rec_ret2', 'ws_ret2', 'r2/until_bad', 'audio.mp3', 'audio/mpeg', 100, 1.0, 'sha', 'until_deleted', ?, ?, ?)
      `).run(now + 10000, now, now);
    }, /CHECK constraint failed/i);

    // 3. 7_days dengan purge_at non-NULL berhasil
    db.prepare(`
      INSERT INTO audio_asset (id, recording_id, workspace_id, r2_key, filename, mime_type, size_bytes, duration_sec, sha256, retention_tier, purge_at, created_at, updated_at)
      VALUES ('aud_ok_7', 'rec_ret2', 'ws_ret2', 'r2/7', 'audio.mp3', 'audio/mpeg', 100, 1.0, 'sha', '7_days', ?, ?, ?)
    `).run(now + 7 * 86400000, now, now);

    // 4. 7_days dengan purge_at NULL ditolak
    assert.throws(() => {
      db.prepare(`
        INSERT INTO audio_asset (id, recording_id, workspace_id, r2_key, filename, mime_type, size_bytes, duration_sec, sha256, retention_tier, purge_at, created_at, updated_at)
        VALUES ('aud_bad_7', 'rec_ret2', 'ws_ret2', 'r2/7_bad', 'audio.mp3', 'audio/mpeg', 100, 1.0, 'sha', '7_days', NULL, ?, ?)
      `).run(now, now);
    }, /CHECK constraint failed/i);

    // 5. 30_days dengan purge_at non-NULL berhasil
    db.prepare(`
      INSERT INTO audio_asset (id, recording_id, workspace_id, r2_key, filename, mime_type, size_bytes, duration_sec, sha256, retention_tier, purge_at, created_at, updated_at)
      VALUES ('aud_ok_30', 'rec_ret2', 'ws_ret2', 'r2/30', 'audio.mp3', 'audio/mpeg', 100, 1.0, 'sha', '30_days', ?, ?, ?)
    `).run(now + 30 * 86400000, now, now);

    // 6. 30_days dengan purge_at NULL ditolak
    assert.throws(() => {
      db.prepare(`
        INSERT INTO audio_asset (id, recording_id, workspace_id, r2_key, filename, mime_type, size_bytes, duration_sec, sha256, retention_tier, purge_at, created_at, updated_at)
        VALUES ('aud_bad_30', 'rec_ret2', 'ws_ret2', 'r2/30_bad', 'audio.mp3', 'audio/mpeg', 100, 1.0, 'sha', '30_days', NULL, ?, ?)
      `).run(now, now);
    }, /CHECK constraint failed/i);
  } finally {
    db.close();
  }
});

test('tag normalization: case-insensitive deduplication via normalized_name', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_tag1', 'team', 'WS Tag 1', 'ws-tag-1', NULL, ?, ?)").run(now, now);
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_tag2', 'team', 'WS Tag 2', 'ws-tag-2', NULL, ?, ?)").run(now, now);

    // 1. Simpan tag dengan normalized_name
    const rawName1 = '  Riset   Produk  ';
    const normName1 = normalizeTagName(rawName1);
    db.prepare(`
      INSERT INTO tag (id, workspace_id, name, normalized_name, created_at, updated_at)
      VALUES ('tag_1', 'ws_tag1', ?, ?, ?, ?)
    `).run(rawName1, normName1, now, now);

    // 2. Simpan tag dengan variasi huruf besar/kecil dan spasi dalam workspace sama ditolak
    const rawName2 = 'Riset Produk';
    const normName2 = normalizeTagName(rawName2);
    assert.equal(normName1, normName2);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO tag (id, workspace_id, name, normalized_name, created_at, updated_at)
        VALUES ('tag_dup', 'ws_tag1', ?, ?, ?, ?)
      `).run(rawName2, normName2, now, now);
    }, /UNIQUE constraint failed.*normalized_name/i);

    // 3. Tag dengan normalized_name sama pada workspace berbeda diperbolehkan
    db.prepare(`
      INSERT INTO tag (id, workspace_id, name, normalized_name, created_at, updated_at)
      VALUES ('tag_ws2', 'ws_tag2', ?, ?, ?, ?)
    `).run(rawName2, normName2, now, now);

    const tagWs2 = db.prepare('SELECT * FROM tag WHERE id = ?').get('tag_ws2') as any;
    assert.equal(tagWs2.workspace_id, 'ws_tag2');
    assert.equal(tagWs2.normalized_name, 'riset produk');
  } finally {
    db.close();
  }
});

test('real D1 transcript size test: bound parameter INSERT dan UPDATE mendekati 1 MB berhasil', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    const iso = new Date().toISOString();

    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_size_1',
      'Size User',
      'size@example.com',
      iso,
      iso
    );
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_size', 'team', 'WS Size', 'ws-size', NULL, ?, ?)").run(now, now);
    db.prepare("INSERT INTO recording (id, workspace_id, title, created_by_user_id, created_at, updated_at) VALUES ('rec_size', 'ws_size', 'Rec Size', 'u_size_1', ?, ?)").run(now, now);

    // Buat payload naskah JSON valid sebesar ~1,000,000 bytes (sedikit di bawah batas 1,048,576 byte)
    const fillerText = 'Teks dialog transkripsi panjang untuk verifikasi batas muatan D1. '.repeat(14000);
    const nearOneMbJson = JSON.stringify({
      version: 1,
      dialogs: [
        { id: 'd1', speaker: 'Pembicara 1', text: fillerText },
      ],
    });

    const byteLen = new TextEncoder().encode(nearOneMbJson).length;
    assert.ok(byteLen > 900000 && byteLen < 1048576, `Ukuran naskah harus mendekati 1 MB, aktual: ${byteLen} bytes`);
    assert.equal(isTranscriptPayloadWithinLimit(nearOneMbJson), true);

    // 1. Bound parameter INSERT naskah mendekati 1 MB berhasil
    db.prepare(`
      INSERT INTO transcript (id, recording_id, workspace_id, raw_document_json, checksum, segment_count, word_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 50000, ?, ?)
    `).run('txn_size_1', 'rec_size', 'ws_size', nearOneMbJson, 'checksum_test', now, now);

    const inserted = db.prepare('SELECT raw_document_json, version FROM transcript WHERE id = ?').get('txn_size_1') as any;
    assert.equal(inserted.raw_document_json.length, nearOneMbJson.length);
    assert.equal(inserted.version, 1);

    // 2. Bound parameter UPDATE naskah mendekati 1 MB berhasil
    const updatedFiller = 'Pembaruan isi naskah transkripsi dialog yang telah disunting. '.repeat(14000);
    const updatedJson = JSON.stringify({
      version: 2,
      dialogs: [
        { id: 'd1', speaker: 'Pembicara 1 (Terverifikasi)', text: updatedFiller },
      ],
    });
    assert.equal(isTranscriptPayloadWithinLimit(updatedJson), true);

    db.prepare(`
      UPDATE transcript
      SET raw_document_json = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = 1
    `).run(updatedJson, now + 1000, 'txn_size_1');

    const updated = db.prepare('SELECT raw_document_json, version FROM transcript WHERE id = ?').get('txn_size_1') as any;
    assert.equal(updated.raw_document_json.length, updatedJson.length);
    assert.equal(updated.version, 2);

    // 3. Payload di atas batas 1 MB (1,048,576 byte) ditolak oleh helper sebelum kueri dieksekusi
    const overOneMbJson = 'x'.repeat(1024 * 1024 + 100);
    assert.equal(isTranscriptPayloadWithinLimit(overOneMbJson), false);
  } finally {
    db.close();
  }
});

test('idempotency scope: UNIQUE(workspace_id, user_id, client_mutation_id)', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    const iso = new Date().toISOString();

    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_idem_a',
      'User A',
      'usera@example.com',
      iso,
      iso
    );
    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_idem_b',
      'User B',
      'userb@example.com',
      iso,
      iso
    );

    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_id_1', 'team', 'WS Id 1', 'ws-id-1', NULL, ?, ?)").run(now, now);
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_id_2', 'team', 'WS Id 2', 'ws-id-2', NULL, ?, ?)").run(now, now);

    db.prepare(`
      INSERT INTO workspace_change_log (change_seq, mutation_id, workspace_id, entity_type, entity_id, operation, version, changed_at, client_mutation_id)
      VALUES (1, 'mut_uuid_1', 'ws_id_1', 'project', 'p1', 'upsert', 1, ?, 'mut_xyz')
    `).run(now);
    db.prepare(`
      INSERT INTO workspace_change_log (change_seq, mutation_id, workspace_id, entity_type, entity_id, operation, version, changed_at, client_mutation_id)
      VALUES (2, 'mut_uuid_2', 'ws_id_1', 'project', 'p2', 'upsert', 1, ?, 'mut_xyz')
    `).run(now);
    db.prepare(`
      INSERT INTO workspace_change_log (change_seq, mutation_id, workspace_id, entity_type, entity_id, operation, version, changed_at, client_mutation_id)
      VALUES (3, 'mut_uuid_3', 'ws_id_2', 'project', 'p3', 'upsert', 1, ?, 'mut_xyz')
    `).run(now);

    // 1. Simpan key mutasi u_idem_a pada ws_id_1
    db.prepare(`
      INSERT INTO mutation_idempotency (id, workspace_id, user_id, client_mutation_id, payload_hash, mutation_id, response_data_json, created_at, expires_at)
      VALUES ('id_1', 'ws_id_1', 'u_idem_a', 'mut_xyz', 'hash1', 'mut_uuid_1', '{"ok":true}', ?, ?)
    `).run(now, now + 600000);

    // 2. User sama + workspace sama + key sama ditolak
    assert.throws(() => {
      db.prepare(`
        INSERT INTO mutation_idempotency (id, workspace_id, user_id, client_mutation_id, payload_hash, mutation_id, response_data_json, created_at, expires_at)
        VALUES ('id_2', 'ws_id_1', 'u_idem_a', 'mut_xyz', 'hash2', 'mut_uuid_1', '{"ok":true}', ?, ?)
      `).run(now, now + 600000);
    }, /UNIQUE constraint failed/i);

    // 3. User berbeda + workspace sama + key sama diperbolehkan
    db.prepare(`
      INSERT INTO mutation_idempotency (id, workspace_id, user_id, client_mutation_id, payload_hash, mutation_id, response_data_json, created_at, expires_at)
      VALUES ('id_3', 'ws_id_1', 'u_idem_b', 'mut_xyz', 'hash3', 'mut_uuid_2', '{"ok":true}', ?, ?)
    `).run(now, now + 600000);

    // 4. Workspace berbeda + key sama diperbolehkan
    db.prepare(`
      INSERT INTO mutation_idempotency (id, workspace_id, user_id, client_mutation_id, payload_hash, mutation_id, response_data_json, created_at, expires_at)
      VALUES ('id_4', 'ws_id_2', 'u_idem_a', 'mut_xyz', 'hash4', 'mut_uuid_3', '{"ok":true}', ?, ?)
    `).run(now, now + 600000);
  } finally {
    db.close();
  }
});

test('import ledger device scope: UNIQUE(user_id, device_id, entity_type, local_source_id)', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    const iso = new Date().toISOString();

    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)').run(
      'u_imp_1',
      'Import User',
      'imp@example.com',
      iso,
      iso
    );

    // 1. Simpan import entitas recording dari device_1
    db.prepare(`
      INSERT INTO import_ledger (id, user_id, device_id, import_batch_id, entity_type, local_source_id, cloud_entity_id, created_at)
      VALUES ('imp_1', 'u_imp_1', 'dev_1', 'batch_1', 'recording', 'rec-local-1', 'rec_cloud_1', ?)
    `).run(now);

    // 2. Local ID sama dari device berbeda diperbolehkan
    db.prepare(`
      INSERT INTO import_ledger (id, user_id, device_id, import_batch_id, entity_type, local_source_id, cloud_entity_id, created_at)
      VALUES ('imp_2', 'u_imp_1', 'dev_2', 'batch_1', 'recording', 'rec-local-1', 'rec_cloud_2', ?)
    `).run(now);

    // 3. Local ID sama untuk entity type berbeda pada device yang sama diperbolehkan
    db.prepare(`
      INSERT INTO import_ledger (id, user_id, device_id, import_batch_id, entity_type, local_source_id, cloud_entity_id, created_at)
      VALUES ('imp_3', 'u_imp_1', 'dev_1', 'batch_1', 'project', 'rec-local-1', 'prj_cloud_1', ?)
    `).run(now);

    // 4. Local ID sama dari device sama dan entity type sama ditolak
    assert.throws(() => {
      db.prepare(`
        INSERT INTO import_ledger (id, user_id, device_id, import_batch_id, entity_type, local_source_id, cloud_entity_id, created_at)
        VALUES ('imp_4', 'u_imp_1', 'dev_1', 'batch_2', 'recording', 'rec-local-1', 'rec_cloud_3', ?)
      `).run(now);
    }, /UNIQUE constraint failed/i);
  } finally {
    db.close();
  }
});

test('syncable child entities: tag, speaker, audio_asset, recording_tag memiliki version dan change log menerima semua entity type', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();
    db.prepare("INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at) VALUES ('ws_sync', 'team', 'WS Sync', 'ws-sync', NULL, ?, ?)").run(now, now);

    const validEntityTypes = [
      'project',
      'folder',
      'recording',
      'transcript',
      'tag',
      'audio_asset',
      'speaker',
      'recording_tag',
    ];

    let seq = 1;
    for (const et of validEntityTypes) {
      db.prepare(`
        INSERT INTO workspace_change_log (mutation_id, workspace_id, entity_type, entity_id, operation, version, changed_at, client_mutation_id)
        VALUES (?, 'ws_sync', ?, 'ent_1', 'upsert', 1, ?, ?)
      `).run(`mut_valid_${seq}`, et, now, `client_mut_${seq}`);
      seq++;
    }

    // Entity type tidak sah ditolak
    assert.throws(() => {
      db.prepare(`
        INSERT INTO workspace_change_log (mutation_id, workspace_id, entity_type, entity_id, operation, version, changed_at, client_mutation_id)
        VALUES ('mut_invalid', 'ws_sync', 'unknown_type', 'ent_1', 'upsert', 1, ?, 'client_mut_err')
      `).run(now);
    }, /CHECK constraint failed/i);
  } finally {
    db.close();
  }
});

test('EXPLAIN QUERY PLAN: kueri kritis memanfaatkan indeks tanpa full table scan', () => {
  const db = createMigratedDb();
  try {
    // 1. Membership lookup user/workspace
    const qp1 = db.prepare('EXPLAIN QUERY PLAN SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?').all() as any[];
    assert.ok(qp1.some((r) => r.detail.includes('USING INDEX') || r.detail.includes('USING COVERING INDEX')));
    assert.equal(qp1.some((r) => r.detail.includes('SCAN TABLE')), false);

    // 2. Recording list per workspace updated cursor
    const qp2 = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM recording WHERE workspace_id = ? AND updated_at < ? ORDER BY updated_at DESC LIMIT 50').all() as any[];
    assert.ok(qp2.some((r) => r.detail.includes('idx_recording_workspace_updated')));
    assert.equal(qp2.some((r) => r.detail.includes('SCAN TABLE')), false);

    // 3. Sync delta workspace/change_seq
    const qp3 = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM workspace_change_log WHERE workspace_id = ? AND change_seq > ? ORDER BY change_seq ASC LIMIT 100').all() as any[];
    assert.ok(qp3.some((r) => r.detail.includes('idx_change_log_lookup')));
    assert.equal(qp3.some((r) => r.detail.includes('SCAN TABLE')), false);

    // 4. Deletion objects per job/status
    const qp4 = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM account_deletion_object WHERE deletion_job_id = ? AND status = ?').all() as any[];
    assert.ok(qp4.some((r) => r.detail.includes('idx_deletion_obj_status')));
    assert.equal(qp4.some((r) => r.detail.includes('SCAN TABLE')), false);

    // 5. Expired idempotency cleanup
    const qp5 = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM mutation_idempotency WHERE expires_at < ?').all() as any[];
    assert.ok(qp5.some((r) => r.detail.includes('idx_idempotency_expires')));
    assert.equal(qp5.some((r) => r.detail.includes('SCAN TABLE')), false);
  } finally {
    db.close();
  }
});

test('workspace sync cursor persistence: latest_change_seq, min_valid_sync_seq, dan simulasi purge', () => {
  const db = createMigratedDb();
  try {
    const now = Date.now();

    // 1. Workspace baru memiliki latest_change_seq = 0 dan min_valid_sync_seq = 0
    db.prepare(`
      INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, created_at, updated_at)
      VALUES ('ws_cursor_1', 'team', 'Cursor WS 1', 'cursor-ws-1', NULL, ?, ?)
    `).run(now, now);

    const ws1 = db.prepare('SELECT latest_change_seq, min_valid_sync_seq FROM workspace WHERE id = ?').get('ws_cursor_1') as any;
    assert.equal(ws1.latest_change_seq, 0);
    assert.equal(ws1.min_valid_sync_seq, 0);

    // 2. Constraint menolak min_valid_sync_seq negatif
    assert.throws(() => {
      db.prepare(`
        INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
        VALUES ('ws_bad_neg', 'team', 'Bad Neg', 'ws-bad-neg', NULL, 5, -1, ?, ?)
      `).run(now, now);
    }, /CHECK constraint failed/i);

    // 3. Constraint menolak latest_change_seq < min_valid_sync_seq
    assert.throws(() => {
      db.prepare(`
        INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
        VALUES ('ws_bad_order', 'team', 'Bad Order', 'ws-bad-order', NULL, 10, 15, ?, ?)
      `).run(now, now);
    }, /CHECK constraint failed/i);

    // Evaluator kursor sinkronisasi delta Catetin
    function evaluateSyncCursor(sinceSeq: number, minValidSeq: number, latestSeq: number) {
      if (sinceSeq < minValidSeq) {
        return { action: 'FULL_RESYNC_REQUIRED', minValidSeq, currentSeq: latestSeq };
      }
      return { action: 'DELTA_SYNC', sinceSeq, latestSeq };
    }

    // 4. since_seq = 0 pada workspace baru tetap valid
    const initialSync = evaluateSyncCursor(0, ws1.min_valid_sync_seq, ws1.latest_change_seq);
    assert.equal(initialSync.action, 'DELTA_SYNC');
    assert.equal(initialSync.sinceSeq, 0);

    // 5. Setelah simulasi purge sampai sequence 100:
    // min_valid_sync_seq diperbarui menjadi 100, latest_change_seq = 150
    db.prepare(`
      UPDATE workspace
      SET latest_change_seq = 150, min_valid_sync_seq = 100
      WHERE id = 'ws_cursor_1'
    `).run();

    const ws1Updated = db.prepare('SELECT latest_change_seq, min_valid_sync_seq FROM workspace WHERE id = ?').get('ws_cursor_1') as any;
    assert.equal(ws1Updated.min_valid_sync_seq, 100);
    assert.equal(ws1Updated.latest_change_seq, 150);

    // since_seq 99 memerlukan full resync
    const sync99 = evaluateSyncCursor(99, ws1Updated.min_valid_sync_seq, ws1Updated.latest_change_seq);
    assert.equal(sync99.action, 'FULL_RESYNC_REQUIRED');
    assert.equal(sync99.minValidSeq, 100);
    assert.equal(sync99.currentSeq, 150);

    // since_seq 100 tetap valid
    const sync100 = evaluateSyncCursor(100, ws1Updated.min_valid_sync_seq, ws1Updated.latest_change_seq);
    assert.equal(sync100.action, 'DELTA_SYNC');
    assert.equal(sync100.sinceSeq, 100);

    // 6. Dua workspace menyimpan latest/min-valid cursor secara independen meskipun change_seq global memiliki gap
    db.prepare(`
      INSERT INTO workspace (id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, created_at, updated_at)
      VALUES ('ws_cursor_2', 'team', 'Cursor WS 2', 'cursor-ws-2', NULL, 350, 200, ?, ?)
    `).run(now, now);

    const ws2 = db.prepare('SELECT latest_change_seq, min_valid_sync_seq FROM workspace WHERE id = ?').get('ws_cursor_2') as any;
    assert.equal(ws2.min_valid_sync_seq, 200);
    assert.equal(ws2.latest_change_seq, 350);

    // Pastikan ws1 tidak terpengaruh oleh kursor ws2
    const ws1Recheck = db.prepare('SELECT latest_change_seq, min_valid_sync_seq FROM workspace WHERE id = ?').get('ws_cursor_1') as any;
    assert.equal(ws1Recheck.min_valid_sync_seq, 100);
    assert.equal(ws1Recheck.latest_change_seq, 150);
  } finally {
    db.close();
  }
});
