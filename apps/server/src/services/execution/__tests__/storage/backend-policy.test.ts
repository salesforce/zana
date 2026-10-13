import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openExecutionDatabase, putExecutionRecord, type ExecutionDatabase } from '@zana-ai/zcc-db';
import {
  assertSideStoreStorage,
  executionStorageBackendForId,
  executionStoreCreationBackend,
  isResumableExecutionState,
  sqliteExecutionStoreWarning
} from '../../storage/backend-policy.js';
import { writeExecutionStoreSqliteState } from '../../storage/sqlite-state.js';

let directory: string;
let database: ExecutionDatabase | undefined;

function setup(): string {
  directory = mkdtempSync(join(tmpdir(), 'zcc-backend-policy-'));
  return join(directory, 'executions.json');
}

function ledger(ids: string[]): string {
  return JSON.stringify({ version: 1, revision: 1, records: ids.map((id) => ({ id })), events: [] });
}

function openDb(): ExecutionDatabase {
  database = openExecutionDatabase(join(directory, 'execution.sqlite'));
  return database;
}

afterEach(() => {
  database?.close();
  database = undefined;
  rmSync(directory, { recursive: true, force: true });
});

describe('executionStorageBackendForId', () => {
  it('is json without a database and never reads the file', () => {
    const filePath = setup();
    writeFileSync(filePath, '{ not json');
    expect(executionStorageBackendForId({ filePath, executionId: 'a' })).toBe('json');
  });

  it('finds sqlite owners with an indexed lookup that reads no record bodies', () => {
    const filePath = setup();
    const db = openDb();
    writeExecutionStoreSqliteState(db, 'execution-store', {
      version: 1, revision: 1, records: [{ id: 'sqlite-1' }], events: []
    }, null);
    const statements: string[] = [];
    const prepare = db.sqlite.prepare.bind(db.sqlite);
    (db.sqlite as unknown as { prepare: (sql: string) => unknown }).prepare = (sql) => {
      statements.push(sql);
      return prepare(sql);
    };
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'sqlite-1' })).toBe('sqlite');
    expect(statements).toContainEqual(expect.stringContaining('SELECT 1 FROM execution_store_record_rows WHERE store_id = ? AND id = ?'));
    expect(statements.some((sql) => sql.includes('value_json') && sql.includes('ORDER BY'))).toBe(false);
  });

  it('migrates a legacy aggregate SQLite ledger before the lookup', () => {
    const filePath = setup();
    const db = openDb();
    putExecutionRecord(db, 'execution-store', { version: 1, revision: 3, records: [{ id: 'legacy-1' }], events: [] });
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'legacy-1' })).toBe('sqlite');
  });

  it('finds json owners and defaults unclaimed executions to sqlite when a database exists', () => {
    const filePath = setup();
    writeFileSync(filePath, ledger(['json-1']));
    const db = openDb();
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'json-1' })).toBe('json');
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'nobody' })).toBe('sqlite');
  });

  it('defaults to sqlite when the json ledger is missing', () => {
    const filePath = setup();
    expect(executionStorageBackendForId({ filePath, database: openDb(), executionId: 'x' })).toBe('sqlite');
  });

  it('caches the json id set by file signature and refreshes when the file changes', () => {
    const filePath = setup();
    const db = openDb();
    writeFileSync(filePath, ledger(['one']));
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'one' })).toBe('json');
    // Same size, new content: the signature (mtime/ctime) must still invalidate.
    writeFileSync(filePath, ledger(['two']));
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'two' })).toBe('json');
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'one' })).toBe('sqlite');
    // Unchanged file served from cache.
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'two' })).toBe('json');
  });

  it('forgets a deleted ledger and tolerates corrupt or non-string ids', () => {
    const filePath = setup();
    const db = openDb();
    writeFileSync(filePath, ledger(['one']));
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'one' })).toBe('json');
    rmSync(filePath);
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'one' })).toBe('sqlite');
    writeFileSync(filePath, '{ corrupt');
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'one' })).toBe('sqlite');
    writeFileSync(filePath, JSON.stringify({ records: [{ id: 7 }, {}, { id: 'ok' }] }));
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'ok' })).toBe('json');
    writeFileSync(filePath, JSON.stringify({}));
    expect(executionStorageBackendForId({ filePath, database: db, executionId: 'ok' })).toBe('sqlite');
  });

  it('bounds the cache across many ledger files', () => {
    setup();
    const db = openDb();
    for (let index = 0; index < 20; index += 1) {
      const filePath = join(directory, `ledger-${index}.json`);
      writeFileSync(filePath, ledger([`id-${index}`]));
      expect(executionStorageBackendForId({ filePath, database: db, executionId: `id-${index}` })).toBe('json');
    }
    // Evicted entry is simply re-read.
    expect(executionStorageBackendForId({ filePath: join(directory, 'ledger-0.json'), database: db, executionId: 'id-0' })).toBe('json');
  });

  it('rethrows unexpected stat failures', () => {
    setup();
    const db = openDb();
    // A path component that is a file yields ENOTDIR, not ENOENT.
    const blocker = join(directory, 'blocker');
    writeFileSync(blocker, 'x');
    expect(() => executionStorageBackendForId({ filePath: join(blocker, 'ledger.json'), database: db, executionId: 'x' })).toThrow();
  });
});

describe('side store storage guard', () => {
  it('requires executionFilePath whenever a database is supplied', () => {
    setup();
    const db = openDb();
    expect(() => assertSideStoreStorage({ database: db }, 'thing')).toThrow('thing requires executionFilePath');
    expect(() => assertSideStoreStorage({ database: db, executionFilePath: 'x.json' }, 'thing')).not.toThrow();
    expect(() => assertSideStoreStorage({}, 'thing')).not.toThrow();
  });
});

describe('policy helpers', () => {
  it('chooses creation backends and resumable states', () => {
    expect(executionStoreCreationBackend('json')).toBe('json');
    expect(executionStoreCreationBackend(undefined)).toBe('sqlite');
    expect(isResumableExecutionState({ state: 'RUNNING' })).toBe(true);
    expect(isResumableExecutionState({ state: 'COMPLETED' })).toBe(false);
    expect(isResumableExecutionState({ state: 'STOPPED' })).toBe(true);
    expect(isResumableExecutionState({ state: 'STOPPED', timeoutReason: 'unresolved-blocker' })).toBe(false);
    expect(isResumableExecutionState({ state: 'STOPPED', timeoutReason: 'plan-correction-cancelled' })).toBe(false);
    expect(sqliteExecutionStoreWarning(false, [{ state: 'RUNNING' }])).toBeUndefined();
    expect(sqliteExecutionStoreWarning(true, [{ state: 'COMPLETED' }])).toBeUndefined();
    expect(sqliteExecutionStoreWarning(true, [{ state: 'RUNNING' }])).toContain('ZCC_EXECUTION_STORE=json');
  });
});
