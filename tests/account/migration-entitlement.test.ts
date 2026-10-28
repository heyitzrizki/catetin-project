import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('file migrasi 0003_account_entitlement.sql hanya memuat entitlement minimal tanpa payment/workspace data', () => {
  const migrationPath = path.resolve(process.cwd(), 'migrations/0003_account_entitlement.sql');
  assert.ok(fs.existsSync(migrationPath), 'migrations/0003_account_entitlement.sql harus ada');

  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
  assert.ok(sql.includes('account_entitlement'), 'Harus membuat tabel account_entitlement');
  assert.ok(sql.includes('userid') || sql.includes('"userid"'), 'Harus memiliki kolom userId');
  assert.ok(sql.includes('plan'), 'Harus memiliki kolom plan');
  assert.ok(sql.includes('status'), 'Harus memiliki kolom status');
  assert.ok(sql.includes('source'), 'Harus memiliki kolom source');
  assert.ok(sql.includes('startsat') || sql.includes('"startsat"'), 'Harus memiliki kolom startsAt');
  assert.ok(sql.includes('endsat') || sql.includes('"endsat"'), 'Harus memiliki kolom endsAt');
  assert.ok(sql.includes('on delete cascade'), 'Harus cascade on delete');

  // Privacy boundary: Dilarang memuat tabel atau kolom payment / workspace
  assert.equal(/\bpayment\b/i.test(sql), false, 'Tidak boleh ada kata payment');
  assert.equal(/\bcard\b/i.test(sql), false, 'Tidak boleh ada kata card');
  assert.equal(/\binvoice\b/i.test(sql), false, 'Tidak boleh ada kata invoice');
  assert.equal(/\bamount\b/i.test(sql), false, 'Tidak boleh ada kata amount');
  assert.equal(/\brecording\b/i.test(sql), false, 'Tidak boleh ada kata recording');
  assert.equal(/\btranscript\b/i.test(sql), false, 'Tidak boleh ada kata transcript');
});

test('skema migration 0001, 0002, dan 0003 berjalan mulus secara berurutan di SQLite', () => {
  const migration1 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0001_better_auth.sql'), 'utf8');
  const migration2 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0002_account_usage.sql'), 'utf8');
  const migration3 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0003_account_entitlement.sql'), 'utf8');

  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(migration1);
    db.exec(migration2);
    db.exec(migration3);

    const now = new Date().toISOString();
    // Insert user
    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run('u_ent_1', 'Rina', 'rina@example.com', now, now);

    // Insert valid pro entitlement
    db.prepare(`
      INSERT INTO "account_entitlement" ("userId", "plan", "status", "source", "startsAt", "endsAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('u_ent_1', 'pro', 'active', 'promotion', now, null, now, now);

    const row = db.prepare('SELECT * FROM "account_entitlement" WHERE "userId" = ?').get('u_ent_1') as any;
    assert.equal(row.userId, 'u_ent_1');
    assert.equal(row.plan, 'pro');
    assert.equal(row.status, 'active');
    assert.equal(row.source, 'promotion');

    // Test ON DELETE CASCADE: deleting user must delete entitlement automatically
    db.prepare('DELETE FROM "user" WHERE "id" = ?').run('u_ent_1');
    const remaining = db.prepare('SELECT * FROM "account_entitlement" WHERE "userId" = ?').get('u_ent_1');
    assert.equal(remaining, undefined, 'Entitlement harus terhapus saat user dihapus (ON DELETE CASCADE)');
  } finally {
    db.close();
  }
});
test('CHECK constraints pada account_entitlement menolak data tidak sah', () => {
  const migration1 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0001_better_auth.sql'), 'utf8');
  const migration3 = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0003_account_entitlement.sql'), 'utf8');

  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(migration1);
    db.exec(migration3);

    const now = new Date().toISOString();
    db.prepare('INSERT INTO "user" ("id", "name", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)')
      .run('u_check_1', 'Test User', 'check@example.com', now, now);

    // 1. Invalid plan: only 'pro' allowed in Stage 4C1 (free users have no row)
    assert.throws(() => {
      db.prepare(`
        INSERT INTO "account_entitlement" ("userId", "plan", "status", "source", "startsAt", "endsAt", "createdAt", "updatedAt")
        VALUES (?, 'free', 'active', 'promotion', ?, null, ?, ?)
      `).run('u_check_1', now, now, now);
    }, /CHECK constraint failed/i);

    // 2. Invalid status: only ('active', 'grace', 'expired', 'revoked')
    assert.throws(() => {
      db.prepare(`
        INSERT INTO "account_entitlement" ("userId", "plan", "status", "source", "startsAt", "endsAt", "createdAt", "updatedAt")
        VALUES (?, 'pro', 'pending_payment', 'promotion', ?, null, ?, ?)
      `).run('u_check_1', now, now, now);
    }, /CHECK constraint failed/i);

    // 3. Invalid source: only ('promotion', 'admin', 'midtrans')
    assert.throws(() => {
      db.prepare(`
        INSERT INTO "account_entitlement" ("userId", "plan", "status", "source", "startsAt", "endsAt", "createdAt", "updatedAt")
        VALUES (?, 'pro', 'active', 'manual_transfer', ?, null, ?, ?)
      `).run('u_check_1', now, now, now);
    }, /CHECK constraint failed/i);
  } finally {
    db.close();
  }
});
