import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Runs the real `db:migrate` entrypoint (`lib/db/migrate.mjs`) against a temp
 * SQLite file (as a separate process, since `getDb()` memoizes a singleton
 * per-process keyed off `DATABASE_URL` at import time — a fresh process per
 * test run guarantees a clean `DATABASE_URL` read) and asserts:
 *   1. All five tables from design §3 exist (via `sqlite_master`).
 *   2. A round-trip insert/select on `releases`, including the `blob` archive
 *      bytes column, works end to end.
 */
const WEBSITE_ROOT = join(__dirname, '..', '..', '..');

describe('db:migrate (sqlite)', () => {
  let dir: string;
  let dbFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-registry-migrate-'));
    dbFile = join(dir, 'test.db');
    execFileSync(process.execPath, [join(WEBSITE_ROOT, 'lib', 'db', 'migrate.mjs')], {
      cwd: WEBSITE_ROOT,
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: 'pipe'
    });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is idempotent — a second run does not throw', () => {
    expect(() =>
      execFileSync(process.execPath, [join(WEBSITE_ROOT, 'lib', 'db', 'migrate.mjs')], {
        cwd: WEBSITE_ROOT,
        env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
        stdio: 'pipe'
      })
    ).not.toThrow();
  });

  it('creates all five design-§3 tables', async () => {
    const Database = (await import('better-sqlite3')).default;
    const sqlite = new Database(dbFile, { readonly: true });
    try {
      const rows = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      const names = new Set(rows.map((r) => r.name));
      for (const table of ['users', 'sessions', 'publish_tokens', 'extensions', 'releases']) {
        expect(names.has(table)).toBe(true);
      }
    } finally {
      sqlite.close();
    }
  });

  it('round-trips an insert/select on releases with a blob archive', async () => {
    const Database = (await import('better-sqlite3')).default;
    const sqlite = new Database(dbFile);
    try {
      const now = Date.now();
      sqlite
        .prepare(
          `INSERT INTO users (id, github_id, github_login, avatar_url, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run('user-1', 42, 'octocat', null, now);
      sqlite
        .prepare(`INSERT INTO extensions (id, owner_user_id, created_at) VALUES (?, ?, ?)`)
        .run('gus', 'user-1', now);

      const archiveBytes = Buffer.from(JSON.stringify({ files: { 'extension.json': 'e30=' } }));
      sqlite
        .prepare(
          `INSERT INTO releases (
             extension_id, version, zcc_api, sha256, signature, permissions,
             title, description, author, icon, archive_bytes, archive_size,
             published_by, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'gus',
          '0.1.0',
          '>=1 <2',
          'deadbeef',
          'c2ln',
          JSON.stringify(['storage']),
          'GUS',
          'desc',
          'octocat',
          'Ticket',
          archiveBytes,
          archiveBytes.byteLength,
          'user-1',
          now
        );

      const row = sqlite
        .prepare(`SELECT * FROM releases WHERE extension_id = ? AND version = ?`)
        .get('gus', '0.1.0') as { archive_bytes: Buffer; archive_size: number };

      expect(Buffer.from(row.archive_bytes).equals(archiveBytes)).toBe(true);
      expect(row.archive_size).toBe(archiveBytes.byteLength);
    } finally {
      sqlite.close();
    }
  });
});
