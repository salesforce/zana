import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrate.js';
import { createSqliteDatabase } from './sqlite.js';
import { SQLITE_LOCK_WAIT_MS } from './contention.js';

export type SqliteDatabase = InstanceType<typeof Database>;

export interface ZccDatabase {
  readonly file: string;
  readonly sqlite: SqliteDatabase;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export function openDatabase(file: string): ZccDatabase {
  const directory = dirname(file);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const sqlite = createSqliteDatabase(file);
  chmodSync(file, 0o600);
  // Takes effect only before the first table exists, so new databases can
  // return freed pages; existing ones keep their mode until a manual VACUUM.
  sqlite.pragma('auto_vacuum = INCREMENTAL');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  migrate(sqlite);
  // Bootstrap may wait for migrations. Once live, a competing writer must not
  // put the product event loop to sleep for five seconds.
  sqlite.pragma(`busy_timeout = ${SQLITE_LOCK_WAIT_MS}`);
  return {
    file,
    sqlite,
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn)(),
    close: () => sqlite.close()
  };
}
