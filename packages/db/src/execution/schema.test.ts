import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteDatabase } from '../sqlite.js';
import type { SqliteDatabase } from '../connection.js';
import {
  EXECUTION_SCHEMA_V1,
  EXECUTION_SCHEMA_V2,
  EXECUTION_SCHEMA_V3,
  migrateExecutionDatabase
} from './schema.js';

let directory: string | null = null;
let sqlite: SqliteDatabase | null = null;

afterEach(() => {
  sqlite?.close();
  sqlite = null;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

describe('execution schema migration v1-3 to v4', () => {
  it('upgrades a v3 database in place, keeping data and adding the artifact recency index', () => {
    directory = mkdtempSync(join(tmpdir(), 'zcc-execution-schema-'));
    sqlite = createSqliteDatabase(join(directory, 'execution.sqlite'));
    sqlite.exec('CREATE TABLE execution_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    [EXECUTION_SCHEMA_V1, EXECUTION_SCHEMA_V2, EXECUTION_SCHEMA_V3].forEach((statements, index) => {
      for (const statement of statements) sqlite!.exec(statement);
      sqlite!.prepare('INSERT INTO execution_schema_migrations (version, applied_at) VALUES (?, ?)').run(index + 1, 1);
    });
    sqlite.prepare('INSERT INTO execution_records (id, value_json, created_at, updated_at) VALUES (?, ?, ?, ?)').run('r', '{"a":1}', 1, 1);
    sqlite.prepare(
      `INSERT INTO execution_artifact_records (id, execution_id, attempt, project_id, name, media_type, content_digest, content, created_at)
       VALUES ('a1', 'e1', 1, 'p', 'n', 'text/plain', 'sha256:x', 'body', 5)`
    ).run();
    const indexNames = () => (sqlite!.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((row) => row.name);
    expect(indexNames()).not.toContain('execution_artifact_records_execution_recency_idx');

    migrateExecutionDatabase(sqlite);

    expect(indexNames()).toContain('execution_artifact_records_execution_recency_idx');
    expect((sqlite.prepare('SELECT version FROM execution_schema_migrations ORDER BY version').all() as Array<{ version: number }>).map((row) => row.version))
      .toEqual([1, 2, 3, 4]);
    expect(sqlite.prepare('SELECT value_json FROM execution_records WHERE id = ?').get('r')).toEqual({ value_json: '{"a":1}' });
    expect(sqlite.prepare('SELECT content FROM execution_artifact_records WHERE id = ?').get('a1')).toEqual({ content: 'body' });
    // Idempotent on re-run.
    migrateExecutionDatabase(sqlite);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM execution_schema_migrations').get() as { n: number }).n).toBe(4);
  });

  it('upgrades a v1-only database through every later version', () => {
    directory = mkdtempSync(join(tmpdir(), 'zcc-execution-schema-'));
    sqlite = createSqliteDatabase(join(directory, 'execution.sqlite'));
    sqlite.exec('CREATE TABLE execution_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    for (const statement of EXECUTION_SCHEMA_V1) sqlite.exec(statement);
    sqlite.prepare('INSERT INTO execution_schema_migrations (version, applied_at) VALUES (1, 1)').run();
    migrateExecutionDatabase(sqlite);
    expect((sqlite.prepare('SELECT version FROM execution_schema_migrations ORDER BY version').all() as Array<{ version: number }>).map((row) => row.version))
      .toEqual([1, 2, 3, 4]);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'execution_store_meta'").get()).toBeDefined();
  });
});
