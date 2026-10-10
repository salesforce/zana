import { createHash } from 'node:crypto';
import type { ExecutionDatabase, ExecutionJson } from '@zana-ai/zcc-db';
import { getExecutionRecord } from '@zana-ai/zcc-db';

export function executionJsonHash(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('execution state must be JSON serializable');
  return createHash('sha256').update(serialized).digest('hex');
}

/** Atomically replaces one namespaced execution record when its JSON is unchanged. */
export function writeExecutionSqliteState(
  database: ExecutionDatabase,
  key: string,
  value: unknown,
  expectedHash: string | null
): void {
  const valueJson = JSON.stringify(value);
  if (valueJson === undefined) throw new TypeError('execution state must be JSON serializable');
  const now = Date.now();
  database.transaction(() => {
    const current = database.sqlite.prepare(
      'SELECT value_json, updated_at FROM execution_records WHERE id = ?'
    ).get(key) as { value_json: string; updated_at: number } | undefined;
    const currentHash = current ? createHash('sha256').update(current.value_json).digest('hex') : null;
    if (currentHash !== expectedHash) throw new Error('stale execution SQLite state');
    if (!current) {
      database.sqlite.prepare(
        'INSERT INTO execution_records (id, value_json, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run(key, valueJson, now, now);
      return;
    }
    const result = database.sqlite.prepare(
      'UPDATE execution_records SET value_json = ?, updated_at = ? WHERE id = ? AND value_json = ? AND updated_at = ?'
    ).run(valueJson, now, key, current.value_json, current.updated_at);
    if (Number(result.changes) !== 1) throw new Error('stale execution SQLite state');
  });
}

export function readExecutionSqliteState<T>(database: ExecutionDatabase | undefined, key: string): { value: T; hash: string } | null {
  if (!database) return null;
  const record = getExecutionRecord<ExecutionJson>(database, key);
  return record ? { value: record.value as T, hash: executionJsonHash(record.value) } : null;
}

interface ExecutionStoreState {
  version: 1;
  revision: number;
  records: Array<{ id: string }>;
  events: Array<{ id: string; executionId: string; sequence: number }>;
}

interface ExecutionStoreMetaRow {
  revision: number;
  state_hash: string;
}

interface ExecutionStoreValueRow {
  value_json: string;
}

/**
 * Moves the former aggregate execution ledger into independently bounded rows.
 * The delete is part of this transaction so a restart sees either source, never
 * a partially-migrated ledger.
 */
function migrateLegacyExecutionStore(database: ExecutionDatabase, storeId: string): void {
  const meta = database.sqlite.prepare('SELECT revision FROM execution_store_meta WHERE store_id = ?').get(storeId);
  if (meta) return;
  const legacy = database.sqlite.prepare('SELECT value_json FROM execution_records WHERE id = ?').get(storeId) as { value_json: string } | undefined;
  if (!legacy) return;
  const state = JSON.parse(legacy.value_json) as ExecutionStoreState;
  if (state.version !== 1 || !Number.isInteger(state.revision) || !Array.isArray(state.records) || !Array.isArray(state.events)) {
    throw new Error('corrupt legacy execution SQLite state');
  }
  const hash = createHash('sha256').update(legacy.value_json).digest('hex');
  const insertRecord = database.sqlite.prepare(
    'INSERT INTO execution_store_record_rows (store_id, position, id, value_json) VALUES (?, ?, ?, ?)'
  );
  const insertEvent = database.sqlite.prepare(
    'INSERT INTO execution_store_event_rows (store_id, position, id, execution_id, sequence, value_json) VALUES (?, ?, ?, ?, ?, ?)'
  );
  database.transaction(() => {
    for (const [position, record] of state.records.entries()) {
      insertRecord.run(storeId, position, record.id, JSON.stringify(record));
    }
    for (const [position, event] of state.events.entries()) {
      insertEvent.run(storeId, position, event.id, event.executionId, event.sequence, JSON.stringify(event));
    }
    database.sqlite.prepare('INSERT INTO execution_store_meta (store_id, revision, state_hash) VALUES (?, ?, ?)')
      .run(storeId, state.revision, hash);
    database.sqlite.prepare('DELETE FROM execution_records WHERE id = ?').run(storeId);
  });
}

/** Reads a row-backed execution ledger while retaining whole-ledger CAS semantics. */
export function readExecutionStoreSqliteState<T extends ExecutionStoreState>(
  database: ExecutionDatabase | undefined,
  storeId: string
): { value: T; hash: string } | null {
  if (!database) return null;
  migrateLegacyExecutionStore(database, storeId);
  const meta = database.sqlite.prepare('SELECT revision, state_hash FROM execution_store_meta WHERE store_id = ?').get(storeId) as ExecutionStoreMetaRow | undefined;
  if (!meta) return null;
  const records = (database.sqlite.prepare(
    'SELECT value_json FROM execution_store_record_rows WHERE store_id = ? ORDER BY position ASC'
  ).all(storeId) as ExecutionStoreValueRow[]).map((row) => JSON.parse(row.value_json));
  const events = (database.sqlite.prepare(
    'SELECT value_json FROM execution_store_event_rows WHERE store_id = ? ORDER BY position ASC'
  ).all(storeId) as ExecutionStoreValueRow[]).map((row) => JSON.parse(row.value_json));
  return { value: { version: 1, revision: meta.revision, records, events } as T, hash: meta.state_hash };
}

/** Atomically replaces ledger rows only when prior full-ledger snapshot matches. */
export function writeExecutionStoreSqliteState<T extends ExecutionStoreState>(
  database: ExecutionDatabase,
  storeId: string,
  value: T,
  expectedHash: string | null
): void {
  const valueJson = JSON.stringify(value);
  if (valueJson === undefined) throw new TypeError('execution state must be JSON serializable');
  const hash = createHash('sha256').update(valueJson).digest('hex');
  migrateLegacyExecutionStore(database, storeId);
  database.transaction(() => {
    const current = database.sqlite.prepare('SELECT state_hash FROM execution_store_meta WHERE store_id = ?').get(storeId) as Pick<ExecutionStoreMetaRow, 'state_hash'> | undefined;
    if ((current?.state_hash ?? null) !== expectedHash) throw new Error('stale execution SQLite state');
    database.sqlite.prepare('DELETE FROM execution_store_record_rows WHERE store_id = ?').run(storeId);
    database.sqlite.prepare('DELETE FROM execution_store_event_rows WHERE store_id = ?').run(storeId);
    const insertRecord = database.sqlite.prepare(
      'INSERT INTO execution_store_record_rows (store_id, position, id, value_json) VALUES (?, ?, ?, ?)'
    );
    const insertEvent = database.sqlite.prepare(
      'INSERT INTO execution_store_event_rows (store_id, position, id, execution_id, sequence, value_json) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [position, record] of value.records.entries()) insertRecord.run(storeId, position, record.id, JSON.stringify(record));
    for (const [position, event] of value.events.entries()) insertEvent.run(storeId, position, event.id, event.executionId, event.sequence, JSON.stringify(event));
    database.sqlite.prepare(
      `INSERT INTO execution_store_meta (store_id, revision, state_hash) VALUES (?, ?, ?)
       ON CONFLICT (store_id) DO UPDATE SET revision = excluded.revision, state_hash = excluded.state_hash`
    ).run(storeId, value.revision, hash);
  });
}
