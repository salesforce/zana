import type { SqliteDatabase } from '../connection.js';

const EXECUTION_SCHEMA_V1 = [
  `CREATE TABLE execution_records (
    id TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK (length(value_json) <= 4194304),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX execution_records_updated_at_idx ON execution_records(updated_at DESC, id DESC)'
] as const;

const EXECUTION_SCHEMA_V2 = [
  `CREATE TABLE execution_artifact_records (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    content_digest TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(content) <= 65536),
    producer_role TEXT,
    producer_slot_id TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (execution_id, name)
  )`,
  'CREATE INDEX execution_artifact_records_execution_project_idx ON execution_artifact_records(execution_id, project_id, created_at, id)'
] as const;

// The execution ledger is retained at supported record/event capacity. It must
// not be serialized into the capped generic execution_records value column.
const EXECUTION_SCHEMA_V3 = [
  `CREATE TABLE execution_store_meta (
    store_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    state_hash TEXT NOT NULL
  )`,
  `CREATE TABLE execution_store_record_rows (
    store_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    id TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (store_id, id),
    UNIQUE (store_id, position)
  )`,
  `CREATE TABLE execution_store_event_rows (
    store_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (store_id, id),
    UNIQUE (store_id, position)
  )`,
  'CREATE INDEX execution_store_event_rows_execution_idx ON execution_store_event_rows(store_id, execution_id, sequence, position)'
] as const;

const EXECUTION_SCHEMA_V4 = [
  'CREATE INDEX execution_artifact_records_execution_recency_idx ON execution_artifact_records(execution_id, created_at DESC, id DESC)'
] as const;

function applyVersion(database: SqliteDatabase, version: number, statements: readonly string[]): void {
  database.transaction(() => {
    for (const statement of statements) database.exec(statement);
    database.prepare('INSERT INTO execution_schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
  })();
}

/** Migrates the isolated execution store without sharing main application migration history. */
export function migrateExecutionDatabase(database: SqliteDatabase): void {
  database.exec('CREATE TABLE IF NOT EXISTS execution_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(
    (database.prepare('SELECT version FROM execution_schema_migrations').all() as Array<{ version: number }>)
      .map((row) => row.version)
  );
  if (!applied.has(1)) applyVersion(database, 1, EXECUTION_SCHEMA_V1);
  if (!applied.has(2)) applyVersion(database, 2, EXECUTION_SCHEMA_V2);
  if (!applied.has(3)) applyVersion(database, 3, EXECUTION_SCHEMA_V3);
  if (!applied.has(4)) applyVersion(database, 4, EXECUTION_SCHEMA_V4);
}

export { EXECUTION_SCHEMA_V1, EXECUTION_SCHEMA_V2, EXECUTION_SCHEMA_V3, EXECUTION_SCHEMA_V4 };
