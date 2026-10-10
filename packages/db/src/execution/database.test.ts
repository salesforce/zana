import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteExecutionRecord,
  getExecutionRecord,
  openExecutionDatabase,
  putExecutionRecord,
  type ExecutionDatabase
} from '../index.js';

let database: ExecutionDatabase | null = null;
let directory: string | null = null;

afterEach(() => {
  database?.close();
  database = null;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

describe('execution database', () => {
  it('migrates an isolated schema with WAL, foreign keys, and a short live lock wait', () => {
    directory = mkdtempSync(join(tmpdir(), 'zcc-execution-db-'));
    database = openExecutionDatabase(join(directory, 'execution.sqlite'));

    expect(database.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.sqlite.pragma('busy_timeout', { simple: true })).toBe(25);
    expect(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_records'").get())
      .toEqual({ name: 'execution_records' });
    expect(database.sqlite.prepare('SELECT version FROM execution_schema_migrations').all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 }
    ]);
  });

  it('persists typed JSON records across reopen, replaces values, and deletes by id', () => {
    directory = mkdtempSync(join(tmpdir(), 'zcc-execution-db-'));
    const file = join(directory, 'execution.sqlite');
    database = openExecutionDatabase(file);
    const first = putExecutionRecord(database, 'execution-1', { state: 'running', attempt: 1 });
    const replacement = putExecutionRecord(database, 'execution-1', { state: 'completed', attempt: 2 });
    expect(replacement).toMatchObject({ id: 'execution-1', value: { state: 'completed', attempt: 2 }, createdAt: first.createdAt });
    database.close();

    database = openExecutionDatabase(file);
    expect(getExecutionRecord<{ state: string; attempt: number }>(database, 'execution-1')?.value)
      .toEqual({ state: 'completed', attempt: 2 });
    expect(deleteExecutionRecord(database, 'execution-1')).toBe(true);
    expect(deleteExecutionRecord(database, 'execution-1')).toBe(false);
    expect(getExecutionRecord(database, 'execution-1')).toBeNull();
  });
});
