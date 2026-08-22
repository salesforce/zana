import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrate.js';

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
  const sqlite = new Database(file);
  chmodSync(file, 0o600);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  migrate(sqlite);
  return {
    file,
    sqlite,
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn)(),
    close: () => sqlite.close()
  };
}
