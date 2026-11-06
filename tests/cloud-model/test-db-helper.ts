import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../worker/workspace/db-types.ts';

const migration1Path = path.resolve(process.cwd(), 'migrations/0001_better_auth.sql');
const migration2Path = path.resolve(process.cwd(), 'migrations/0002_account_usage.sql');
const migration3Path = path.resolve(process.cwd(), 'migrations/0003_account_entitlement.sql');
const migration4Path = path.resolve(process.cwd(), 'migrations/0004_cloud_workspace_data_model.sql');

export function createMigratedTestDb(): DatabaseSync {
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

export function createD1DatabaseAdapter(db: DatabaseSync): D1DatabaseLike {
  return createInterleavingD1Adapter(db, {});
}

export interface InterleavingHooks {
  beforeFirst?: (sql: string, values: unknown[]) => Promise<void> | void;
  afterFirst?: (sql: string, result: unknown) => Promise<void> | void;
  beforeBatch?: (statements: D1PreparedStatementLike[]) => Promise<void> | void;
  beforeBatchStatement?: (index: number, stmt: D1PreparedStatementLike) => Promise<void> | void;
  afterBatch?: (results: any[]) => Promise<void> | void;
  beforeRun?: (sql: string, values: unknown[]) => Promise<void> | void;
}

export function createInterleavingD1Adapter(
  db: DatabaseSync,
  hooks: InterleavingHooks = {}
): D1DatabaseLike {
  return {
    prepare(sql: string): D1PreparedStatementLike {
      let boundValues: unknown[] = [];
      const stmt: D1PreparedStatementLike = {
        _sql: sql,
        _values: boundValues,
        bind(...values: unknown[]) {
          boundValues = values;
          stmt._values = boundValues;
          return stmt;
        },
        async all<T = unknown>() {
          const results = db.prepare(sql).all(...(boundValues as any[])) as T[];
          return { results };
        },
        async first<T = unknown>(colName?: string) {
          if (hooks.beforeFirst) {
            await hooks.beforeFirst(sql, boundValues);
          }
          const row = db.prepare(sql).get(...(boundValues as any[])) as any;
          if (hooks.afterFirst) {
            await hooks.afterFirst(sql, row);
          }
          if (!row) return null;
          if (colName) return (row[colName] ?? null) as T;
          return row as T;
        },
        async run() {
          if (hooks.beforeRun) {
            await hooks.beforeRun(sql, boundValues);
          }
          const res = db.prepare(sql).run(...(boundValues as any[]));
          return { results: [], meta: res };
        },
      };
      return stmt;
    },
    async batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<any[]> {
      if (hooks.beforeBatch) {
        await hooks.beforeBatch(statements);
      }
      db.exec('BEGIN TRANSACTION;');
      try {
        const results = [];
        for (let i = 0; i < statements.length; i++) {
          const s = statements[i];
          if (hooks.beforeBatchStatement) {
            await hooks.beforeBatchStatement(i, s);
          }
          const sql = s._sql ?? '';
          const vals = s._values ?? [];
          const upper = sql.trim().toUpperCase();
          if (upper.startsWith('SELECT') || upper.includes('RETURNING')) {
            const rows = db.prepare(sql).all(...(vals as any[]));
            results.push({ results: rows, meta: {} });
          } else {
            const meta = db.prepare(sql).run(...(vals as any[]));
            results.push({ results: [], meta });
          }
        }
        db.exec('COMMIT;');
        if (hooks.afterBatch) {
          await hooks.afterBatch(results);
        }
        return results;
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    },
    async exec(query: string) {
      db.exec(query);
    },
  };
}
