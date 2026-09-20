import type Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { sqliteNativeBinding } from './native-binding.mjs';

const sqliteRequire = createRequire(import.meta.url);

/** All product connections select their own runtime's binary; preparation never flips Electron into Node's install. */
export function createSqliteDatabase(file: string, options: Database.Options = {}): Database.Database {
  const Sqlite = sqliteRequire('better-sqlite3') as typeof Database;
  return new Sqlite(file, { nativeBinding: sqliteNativeBinding(sqliteRequire), ...options });
}
