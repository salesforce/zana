import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SQLITE_LOCK_WAIT_MS } from '../contention.js';
import type { SqliteDatabase } from '../connection.js';
import { createSqliteDatabase } from '../sqlite.js';
import { migrateExecutionDatabase } from './schema.js';

export interface ExecutionDatabase {
  readonly file: string;
  readonly sqlite: SqliteDatabase;
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Opens the execution database with the same runtime-safe SQLite binding and contention policy as product storage. */
export function openExecutionDatabase(file: string): ExecutionDatabase {
  const directory = dirname(file);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const sqlite = createSqliteDatabase(file);
  chmodSync(file, 0o600);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  migrateExecutionDatabase(sqlite);
  sqlite.pragma(`busy_timeout = ${SQLITE_LOCK_WAIT_MS}`);
  return {
    file,
    sqlite,
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn)(),
    close: () => sqlite.close()
  };
}
