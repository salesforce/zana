import { createRequire } from 'node:module';
import type { PluginDatabase } from '@zana-ai/zcc-plugin-sdk/server';

const require = createRequire(import.meta.url);

/** In-memory SQLite shaped like `zcc.storage.database()`, for tests. */
export function createTestDatabase(): PluginDatabase {
  const Database = require('better-sqlite3') as new (path: string) => object;
  const db = new Database(':memory:');
  const runBatch = Reflect.get(db, 'exec') as (sql: string) => void;
  const prepare = Reflect.get(db, 'prepare') as PluginDatabase['prepare'];
  const beginTxn = Reflect.get(db, 'transaction') as (fn: () => unknown) => () => unknown;
  return {
    runScript: (sql) => runBatch.call(db, sql),
    prepare: (sql) => prepare.call(db, sql),
    migrate: (statements) => {
      for (const statement of statements) runBatch.call(db, statement);
    },
    transaction: <T>(fn: () => T): T => beginTxn.call(db, fn)() as T
  };
}
