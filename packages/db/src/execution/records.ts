import type { ExecutionDatabase } from './database.js';

export type ExecutionJson = null | boolean | number | string | readonly ExecutionJson[] | { readonly [key: string]: ExecutionJson };

export interface ExecutionRecord<T extends ExecutionJson = ExecutionJson> {
  id: string;
  value: T;
  createdAt: number;
  updatedAt: number;
}

interface ExecutionRecordSqlRow {
  id: string;
  value_json: string;
  created_at: number;
  updated_at: number;
}

function toRecord<T extends ExecutionJson>(row: ExecutionRecordSqlRow): ExecutionRecord<T> {
  return {
    id: row.id,
    value: JSON.parse(row.value_json) as T,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Returns one durable execution value, or null when its id has not been recorded. */
export function getExecutionRecord<T extends ExecutionJson>(database: ExecutionDatabase, id: string): ExecutionRecord<T> | null {
  const row = database.sqlite.prepare('SELECT id, value_json, created_at, updated_at FROM execution_records WHERE id = ?')
    .get(id) as ExecutionRecordSqlRow | undefined;
  return row ? toRecord<T>(row) : null;
}

/** Inserts or replaces an execution value while preserving its original creation timestamp. */
export function putExecutionRecord<T extends ExecutionJson>(database: ExecutionDatabase, id: string, value: T): ExecutionRecord<T> {
  const valueJson = JSON.stringify(value);
  if (valueJson === undefined) throw new TypeError('execution record value must be JSON serializable');
  const now = Date.now();
  database.sqlite.prepare(
    `INSERT INTO execution_records (id, value_json, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(id, valueJson, now, now);
  return getExecutionRecord<T>(database, id)!;
}

/** Deletes one durable execution value. */
export function deleteExecutionRecord(database: ExecutionDatabase, id: string): boolean {
  const result = database.sqlite.prepare('DELETE FROM execution_records WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}
