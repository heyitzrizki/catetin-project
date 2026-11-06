/**
 * Kontrak abstraksi database untuk D1 dan pengujian SQLite lokal.
 */

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<{ results?: unknown[]; meta?: unknown }>;
  _sql?: string;
  _values?: unknown[];
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<any[]>;
  exec?(query: string): Promise<any>;
}
