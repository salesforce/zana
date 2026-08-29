import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256Hex } from '../signing';

/**
 * Seeds a temp SQLite DB (migrated the same way `migrate.test.ts` does — the
 * real `db:migrate` entrypoint run as a subprocess, so this test never
 * hand-rolls schema DDL) with two versions of one extension id plus a second
 * id, then asserts `buildIndex()` (lib/feed.ts) projects them onto the EXACT
 * public `RegistryIndex` shape the frozen desktop client
 * (`fetchRegistryIndex`) and the website's own `fetchCatalog` both gate on:
 * `schema === 1 && Array.isArray(releases)`.
 *
 * `DATABASE_URL` (read lazily by `getDb()` on first call, not at import time)
 * and `PUBLIC_BASE_URL` are set in `beforeAll`, before any call into
 * `lib/feed.ts` — so this file's `getDb()` singleton picks up the temp DB.
 */
const WEBSITE_ROOT = join(__dirname, '..', '..');
const PUBLIC_BASE_URL = 'https://registry.example.test';

describe('feed', () => {
  let dir: string;
  let dbFile: string;
  const now = Date.now();

  const archiveGusA = Buffer.from(JSON.stringify({ files: { 'package.json': 'eyJpZCI6Imd1cyJ9' } }));
  const archiveGusB = Buffer.from(JSON.stringify({ files: { 'package.json': 'eyJpZCI6Imd1cyIsInYiOiJiIn0=' } }));
  const archiveZana = Buffer.from(JSON.stringify({ files: { 'package.json': 'eyJpZCI6InphbmEifQ==' } }));

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-registry-feed-'));
    dbFile = join(dir, 'test.db');
    execFileSync(process.execPath, [join(WEBSITE_ROOT, 'lib', 'db', 'migrate.mjs')], {
      cwd: WEBSITE_ROOT,
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: 'pipe'
    });

    // Set env BEFORE the first getDb() call in this process — getDb() reads
    // DATABASE_URL lazily (buildDb()), not at module-import time.
    process.env.DATABASE_URL = `file:${dbFile}`;
    process.env.PUBLIC_BASE_URL = PUBLIC_BASE_URL;

    const Database = (await import('better-sqlite3')).default;
    const sqlite = new Database(dbFile);
    try {
      sqlite
        .prepare(`INSERT INTO users (id, github_id, github_login, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run('user-1', 42, 'octocat', null, now);
      sqlite
        .prepare(`INSERT INTO extensions (id, owner_user_id, created_at) VALUES (?, ?, ?)`)
        .run('gus', 'user-1', now);
      sqlite
        .prepare(`INSERT INTO extensions (id, owner_user_id, created_at) VALUES (?, ?, ?)`)
        .run('zana', 'user-1', now);

      const insertRelease = sqlite.prepare(
        `INSERT INTO releases (
           extension_id, version, zcc_api, sha256, signature, permissions,
           title, description, author, icon, archive_bytes, archive_size,
           published_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // Two versions of "gus" — the second has no optional metadata at all,
      // so buildIndex() must omit those keys entirely (never emit `null`).
      insertRelease.run(
        'gus',
        '0.1.0',
        '>=1 <2',
        sha256Hex(archiveGusA),
        'c2ln1',
        JSON.stringify(['storage', 'projects:read']),
        'GUS',
        'GUS integration',
        'octocat',
        'Ticket',
        archiveGusA,
        archiveGusA.byteLength,
        'user-1',
        now
      );
      insertRelease.run(
        'gus',
        '0.2.0',
        '>=1 <2',
        sha256Hex(archiveGusB),
        'c2ln2',
        null,
        null,
        null,
        null,
        null,
        archiveGusB,
        archiveGusB.byteLength,
        'user-1',
        now + 1
      );

      // A second, distinct id.
      insertRelease.run(
        'zana',
        '1.0.0',
        '^1.0.0',
        sha256Hex(archiveZana),
        'c2ln3',
        JSON.stringify(['storage']),
        'Zana',
        'Orchestration',
        'octocat',
        'Bot',
        archiveZana,
        archiveZana.byteLength,
        'user-1',
        now
      );
    } finally {
      sqlite.close();
    }
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('buildIndex() returns {schema:1, releases:[...]} with ALL rows and the schema===1 guard both clients use', async () => {
    const { buildIndex } = await import('../feed.ts');
    const index = await buildIndex();

    // The exact guard fetchRegistryIndex/fetchCatalog both apply.
    expect(index.schema === 1 && Array.isArray(index.releases)).toBe(true);
    expect(index.releases).toHaveLength(3);
  });

  it('projects correct url, sha256, signature, and permissions for a fully-populated release', async () => {
    const { buildIndex } = await import('../feed.ts');
    const index = await buildIndex();

    const gusA = index.releases.find((r) => r.id === 'gus' && r.version === '0.1.0');
    expect(gusA).toBeDefined();
    expect(gusA!.url).toBe(`${PUBLIC_BASE_URL}/extensions/archives/gus-0.1.0.json`);
    expect(gusA!.sha256).toBe(sha256Hex(archiveGusA));
    expect(gusA!.signature).toBe('c2ln1');
    expect(gusA!.zccApi).toBe('>=1 <2');
    expect(gusA!.permissions).toEqual(['storage', 'projects:read']);
    expect(gusA!.title).toBe('GUS');
    expect(gusA!.description).toBe('GUS integration');
    expect(gusA!.author).toBe('octocat');
    expect(gusA!.icon).toBe('Ticket');
  });

  it('omits null optional fields entirely rather than emitting them as null', async () => {
    const { buildIndex } = await import('../feed.ts');
    const index = await buildIndex();

    const gusB = index.releases.find((r) => r.id === 'gus' && r.version === '0.2.0');
    expect(gusB).toBeDefined();
    for (const key of ['permissions', 'title', 'description', 'author', 'icon'] as const) {
      expect(Object.prototype.hasOwnProperty.call(gusB, key)).toBe(false);
    }
    // Required fields are still present.
    expect(gusB!.url).toBe(`${PUBLIC_BASE_URL}/extensions/archives/gus-0.2.0.json`);
    expect(gusB!.sha256).toBe(sha256Hex(archiveGusB));
  });

  it('lists the second, distinct extension id too', async () => {
    const { buildIndex } = await import('../feed.ts');
    const index = await buildIndex();

    const zana = index.releases.find((r) => r.id === 'zana');
    expect(zana).toBeDefined();
    expect(zana!.version).toBe('1.0.0');
    expect(zana!.url).toBe(`${PUBLIC_BASE_URL}/extensions/archives/zana-1.0.0.json`);
  });

  it('serialized index stays well under the 1 MiB client cap', async () => {
    const { buildIndex, INDEX_MAX_BYTES } = await import('../feed.ts');
    const index = await buildIndex();
    const bytes = Buffer.byteLength(JSON.stringify(index), 'utf-8');
    expect(bytes).toBeLessThan(INDEX_MAX_BYTES);
  });

  it('findArchiveByFilename returns the exact stored bytes, and sha256Hex(bytes) matches the stored sha256', async () => {
    const { findArchiveByFilename, buildIndex } = await import('../feed.ts');

    const bytes = await findArchiveByFilename('gus-0.1.0.json');
    expect(bytes).not.toBeNull();
    expect(bytes!.equals(archiveGusA)).toBe(true);

    const index = await buildIndex();
    const gusA = index.releases.find((r) => r.id === 'gus' && r.version === '0.1.0')!;
    expect(sha256Hex(bytes!)).toBe(gusA.sha256);
  });

  it('findArchiveByFilename resolves the second version and the second id too', async () => {
    const { findArchiveByFilename } = await import('../feed.ts');

    const gusB = await findArchiveByFilename('gus-0.2.0.json');
    expect(gusB!.equals(archiveGusB)).toBe(true);

    const zana = await findArchiveByFilename('zana-1.0.0.json');
    expect(zana!.equals(archiveZana)).toBe(true);
  });

  it('findArchiveByFilename returns null for an unknown filename', async () => {
    const { findArchiveByFilename } = await import('../feed.ts');
    const missing = await findArchiveByFilename('nope-9.9.9.json');
    expect(missing).toBeNull();
  });
});
