import { createRequire } from 'node:module';
import { MEMORY_SCHEMA } from './memory-store.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

export function wrapSqlite(db) {
  const runBatch = Reflect.get(db, 'exec');
  const beginTxn = Reflect.get(db, 'transaction');
  const prepare = Reflect.get(db, 'prepare');
  return {
    runScript(sql) {
      runBatch.call(db, sql);
    },
    prepare(sql) {
      return prepare.call(db, sql);
    },
    migrate(statements) {
      for (const statement of statements) runBatch.call(db, statement);
    },
    transaction(fn) {
      return beginTxn.call(db, fn)();
    }
  };
}

export function createMemorySqlite() {
  return wrapSqlite(new Database(':memory:'));
}

export function createMemoryTestDatabase() {
  const wrapped = createMemorySqlite();
  wrapped.migrate(MEMORY_SCHEMA);
  return wrapped;
}
