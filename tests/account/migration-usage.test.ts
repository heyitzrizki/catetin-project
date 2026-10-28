import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('file migrasi 0002_account_usage.sql hanya memuat counter agregat dan tidak memuat konten workspace', () => {
  const migrationPath = path.resolve(process.cwd(), 'migrations/0002_account_usage.sql');
  assert.ok(fs.existsSync(migrationPath), 'migrations/0002_account_usage.sql harus ada');

  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
  assert.ok(sql.includes('account_usage'), 'Harus membuat tabel account_usage');
  assert.ok(sql.includes('usageDate') || sql.includes('"usagedate"'), 'Harus memiliki kolom usageDate');
  assert.ok(sql.includes('eventType') || sql.includes('"eventtype"'), 'Harus memiliki kolom eventType');
  assert.ok(sql.includes('count'), 'Harus memiliki kolom count');
  assert.ok(sql.includes('on delete cascade'), 'Harus cascade on delete');

  // Privacy boundary: tidak boleh ada tabel konten workspace Catetin
  assert.equal(/\bcreate\s+table.*recording\b/i.test(sql), false, 'Tidak boleh ada tabel recording');
  assert.equal(/\bcreate\s+table.*transcript\b/i.test(sql), false, 'Tidak boleh ada tabel transcript');
  assert.equal(/\bcreate\s+table.*project\b/i.test(sql), false, 'Tidak boleh ada tabel project');
  assert.equal(/\bcreate\s+table.*folder\b/i.test(sql), false, 'Tidak boleh ada tabel folder');
  assert.equal(/\bcreate\s+table.*audio\b/i.test(sql), false, 'Tidak boleh ada tabel audio');
  assert.equal(/\bcreate\s+table.*tag\b/i.test(sql), false, 'Tidak boleh ada tabel tag');
});

test('skema migration 0001 dan 0002 berjalan mulus di SQLite in-memory dan mendukung UPSERT atomik serta CASCADE', () => {
  const migration1 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0001_better_auth.sql'), 'utf8');
  const migration2 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0002_account_usage.sql'), 'utf8');

  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(migration1);
    db.exec(migration2);

    const now = new Date().toISOString();
    // Insert user
    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run('u_test_1', 'Budi', 'budi@example.com', now, now);

    // Atomic UPSERT
    const upsertStmt = db.prepare(`
      INSERT INTO "account_usage" ("id", "userId", "usageDate", "eventType", "count", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT ("userId", "usageDate", "eventType")
      DO UPDATE SET
        "count" = "account_usage"."count" + 1,
        "updatedAt" = excluded."updatedAt"
    `);

    // First event on 2026-10-28
    upsertStmt.run('row_1', 'u_test_1', '2026-10-28', 'local_transcription_completed', now, now);
    let row = db.prepare('SELECT * FROM "account_usage" WHERE "id" = ?').get('row_1') as any;
    assert.equal(row.count, 1);
    assert.equal(row.eventType, 'local_transcription_completed');

    // Second event on same day and same eventType -> count must be 2
    const updatedTime = new Date(Date.now() + 1000).toISOString();
    upsertStmt.run('row_2', 'u_test_1', '2026-10-28', 'local_transcription_completed', updatedTime, updatedTime);
    row = db.prepare('SELECT * FROM "account_usage" WHERE "userId" = ? AND "eventType" = ?').get('u_test_1', 'local_transcription_completed') as any;
    assert.equal(row.count, 2);
    assert.equal(row.updatedAt, updatedTime);

    // Different event on same day -> new separate row with count 1
    upsertStmt.run('row_3', 'u_test_1', '2026-10-28', 'transcript_export_completed', now, now);
    const rows = db.prepare('SELECT * FROM "account_usage" WHERE "userId" = ?').all('u_test_1') as any[];
    assert.equal(rows.length, 2);

    // CHECK constraint test: event asing harus ditolak oleh skema SQLite
    assert.throws(() => {
      db.prepare(`
        INSERT INTO "account_usage" ("id", "userId", "usageDate", "eventType", "count", "createdAt", "updatedAt")
        VALUES ('row_invalid', 'u_test_1', '2026-10-28', 'invalid_event_type', 1, ?, ?)
      `).run(now, now);
    }, /CHECK constraint failed/i, 'CHECK constraint harus menolak eventType asing');

    // CASCADE test: deleting user deletes all their usage rows
    db.prepare('DELETE FROM "user" WHERE "id" = ?').run('u_test_1');
    const remainingUsage = db.prepare('SELECT * FROM "account_usage" WHERE "userId" = ?').all('u_test_1');
    assert.equal(remainingUsage.length, 0, 'Usage rows harus terhapus saat user dihapus (CASCADE)');
  } finally {
    db.close();
  }
});
