import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExecutionDatabase: vi.fn(),
  readExecutionStoreSqliteState: vi.fn()
}));
vi.mock('@zana-ai/zcc-db', () => ({ openExecutionDatabase: mocks.openExecutionDatabase }));
vi.mock('@zana-ai/zcc-server/services/execution/storage/sqlite-state', () => ({
  readExecutionStoreSqliteState: mocks.readExecutionStoreSqliteState
}));

import { openExecutionStorage } from '../execution-storage.js';

const fakeDb = () => ({ close: vi.fn() }) as never;

describe('openExecutionStorage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens injected database at userData path and defaults to sqlite creation', () => {
    const openDatabase = vi.fn(() => fakeDb());
    const storage = openExecutionStorage({ userDataDir: '/u', backendEnv: undefined, warn: vi.fn(), openDatabase });
    expect(openDatabase).toHaveBeenCalledWith('/u/squad-executions.sqlite');
    expect(storage.createInJson).toBe(false);
    expect(mocks.openExecutionDatabase).not.toHaveBeenCalled();
  });

  it('falls back to the real opener when none injected', () => {
    const db = fakeDb();
    mocks.openExecutionDatabase.mockReturnValue(db);
    const storage = openExecutionStorage({ userDataDir: '/u', backendEnv: 'json', warn: vi.fn() });
    expect(storage.database).toBe(db);
    expect(storage.createInJson).toBe(true);
  });

  it('warns when json is forced and a resumable record exists', () => {
    const warn = vi.fn();
    const readState = vi.fn(() => [{ id: 'a', state: 'RUNNING' }]);
    const storage = openExecutionStorage({ userDataDir: '/u', backendEnv: 'json', warn, openDatabase: () => fakeDb(), readState });
    storage.warnIfSqliteSuperseded();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[main] ZCC_EXECUTION_STORE=json'));
  });

  it('does not warn when records are all completed or backend is sqlite', () => {
    const warn = vi.fn();
    const readState = vi.fn(() => [{ id: 'a', state: 'COMPLETED' }]);
    openExecutionStorage({ userDataDir: '/u', backendEnv: 'json', warn, openDatabase: () => fakeDb(), readState }).warnIfSqliteSuperseded();
    openExecutionStorage({ userDataDir: '/u', backendEnv: 'sqlite', warn, openDatabase: () => fakeDb(), readState: () => [{ id: 'b', state: 'RUNNING' }] }).warnIfSqliteSuperseded();
    expect(warn).not.toHaveBeenCalled();
  });

  it('default reader uses sqlite state records, or empty when absent', () => {
    const warn = vi.fn();
    mocks.readExecutionStoreSqliteState.mockReturnValueOnce({ value: { records: [{ id: 'a', state: 'RUNNING' }] } });
    const s = openExecutionStorage({ userDataDir: '/u', backendEnv: 'json', warn, openDatabase: () => fakeDb() });
    s.warnIfSqliteSuperseded();
    expect(mocks.readExecutionStoreSqliteState).toHaveBeenCalledWith(s.database, 'execution-store');
    expect(warn).toHaveBeenCalledTimes(1);
    mocks.readExecutionStoreSqliteState.mockReturnValueOnce(undefined);
    s.warnIfSqliteSuperseded();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('close is idempotent and tolerates a missing database', () => {
    const db = { close: vi.fn() };
    const s = openExecutionStorage({ userDataDir: '/u', backendEnv: undefined, warn: vi.fn(), openDatabase: () => db as never });
    s.close();
    s.close();
    expect(db.close).toHaveBeenCalledTimes(1);
    const none = openExecutionStorage({ userDataDir: '/u', backendEnv: undefined, warn: vi.fn(), openDatabase: () => undefined as never });
    expect(() => none.close()).not.toThrow();
  });
});
