import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { PLUGIN_DATABASE_BACKUP_RETENTION, PluginDatabaseBackupError } from '@zana-ai/zcc-plugin-sdk';
import { backupCopyHandle, createPluginDatabaseBackup, type PluginBackupSource } from './plugin-database-backup.js';
import { createPluginApi } from './plugin-api.js';

const dirs: string[] = [];
const handles: Array<{ close(): void; open?: boolean }> = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) if (handle.open !== false) handle.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function pluginDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-plugin-backup-')));
  dirs.push(dir);
  return dir;
}

function liveDatabase(dir: string) {
  const db = createSqliteDatabase(join(dir, 'data.db'));
  handles.push(db);
  db.pragma('journal_mode = WAL');
  return db;
}

function backupFor(dir: string, db: ReturnType<typeof createSqliteDatabase>, extra: Partial<Parameters<typeof createPluginDatabaseBackup>[0]> = {}) {
  return createPluginDatabaseBackup({
    pluginId: 'demo', pluginDir: dir, source: () => db,
    openCopy: (file) => backupCopyHandle(createSqliteDatabase(file)), now: () => 1234, ...extra
  });
}

const leftovers = async (dir: string) => (await readdir(join(dir, 'backups'))).filter((entry) => entry.startsWith('.'));
const codeOf = (error: unknown) => (error as PluginDatabaseBackupError).code;

describe('createPluginDatabaseBackup', () => {
  it('copies a consistent snapshot while writes keep landing between backup steps', async () => {
    const dir = await pluginDir();
    const db = liveDatabase(dir);
    db.prepare('CREATE TABLE ledger (id INTEGER PRIMARY KEY, debit INTEGER NOT NULL, credit INTEGER NOT NULL, pad BLOB)').run();
    const insert = db.prepare('INSERT INTO ledger (debit, credit, pad) VALUES (?, ?, randomblob(3000))');
    db.transaction(() => { for (let i = 0; i < 3000; i++) insert.run(i, i); })();
    let writes = 0, writing = true;
    // Each transaction keeps debit = credit per row; a torn copy would break the pair or the balance.
    const writer = (async () => {
      while (writing) {
        db.transaction(() => {
          db.prepare('UPDATE ledger SET debit = debit + 1 WHERE id = ?').run((writes % 3000) + 1);
          db.prepare('UPDATE ledger SET credit = credit + 1 WHERE id = ?').run((writes % 3000) + 1);
          insert.run(writes, writes);
        })();
        writes++;
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    let result: Awaited<ReturnType<ReturnType<typeof backupFor>>>;
    // Stop the writer even when the backup rejects, so a failure surfaces instead of a hang or a late DB error.
    try { result = await backupFor(dir, db)({ name: 'snapshot' }); } finally { writing = false; await writer; }
    expect(writes).toBeGreaterThan(0);
    expect(result).toMatchObject({ name: 'snapshot', path: join(dir, 'backups', 'snapshot.db'), createdAt: 1234 });
    expect(result.sha256).toBe(createHash('sha256').update(await readFile(result.path)).digest('hex'));
    expect(result.bytes).toBe((await stat(result.path)).size);
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'backups'))).mode & 0o777).toBe(0o700);
    const copy = createSqliteDatabase(result.path, { readonly: true });
    handles.push(copy);
    expect(copy.prepare('SELECT COUNT(*) AS n FROM ledger WHERE debit <> credit').get()).toEqual({ n: 0 });
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(copy.prepare('SELECT backup_id, plugin_id, created_at FROM _zcc_backup').all())
      .toEqual([{ backup_id: result.backupId, plugin_id: 'demo', created_at: 1234 }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = '_zcc_backup'").get()).toBeUndefined();
    expect(await leftovers(dir)).toEqual([]);
  });

  it('replaces a stale marker carried by a restored source and replaces same-name backups atomically', async () => {
    const dir = await pluginDir();
    const db = liveDatabase(dir);
    db.prepare('CREATE TABLE _zcc_backup (backup_id TEXT)').run();
    db.prepare("INSERT INTO _zcc_backup VALUES ('old')").run();
    const backup = backupFor(dir, db);
    const first = await backup({ name: 'same' });
    const second = await backup({ name: 'same' });
    expect(second.backupId).not.toBe(first.backupId);
    expect((await readdir(join(dir, 'backups')))).toEqual(['same.db']);
    const copy = createSqliteDatabase(second.path, { readonly: true });
    handles.push(copy);
    expect(copy.prepare('SELECT backup_id FROM _zcc_backup').all()).toEqual([{ backup_id: second.backupId }]);
  });

  it.each([
    [{ name: '../escape' }], [{ name: '.hidden' }], [{ name: 'a/b' }], [{ name: '' }], [{ name: 'x'.repeat(97) }], [{ name: 'a..b' }],
    [{ name: 'ok', maxBytes: 0 }], [{ name: 'ok', maxBytes: 1.5 }], [{ name: 'ok', maxBytes: 2 ** 40 }], [{ name: 7 }], [null]
  ])('rejects unconfined or malformed options %j', async (options) => {
    const dir = await pluginDir();
    await expect(backupFor(dir, liveDatabase(dir))(options as never)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses oversized databases before, during and after copying, leaving no partial file', async () => {
    const dir = await pluginDir();
    const db = liveDatabase(dir);
    db.prepare('CREATE TABLE t (pad BLOB)').run();
    db.prepare('INSERT INTO t VALUES (randomblob(20000))').run();
    const pageBytes = Number(db.pragma('page_count', { simple: true })) * Number(db.pragma('page_size', { simple: true }));
    await expect(backupFor(dir, db)({ name: 'small', maxBytes: pageBytes - 1 })).rejects.toMatchObject({ code: 'too-large' });
    // The marker table adds a page, so the finished copy is over an exact-size ceiling.
    await expect(backupFor(dir, db)({ name: 'exact', maxBytes: pageBytes })).rejects.toMatchObject({ code: 'too-large' });
    const growing: PluginBackupSource = { pragma: (source) => db.pragma(source, { simple: true }),
      backup: async (_file, options) => { options!.progress!({ totalPages: 1_000_000, remainingPages: 1 }); } };
    await expect(backupFor(dir, db, { source: () => growing })({ name: 'grow', maxBytes: pageBytes * 2 })).rejects.toMatchObject({ code: 'too-large' });
    expect(await readdir(join(dir, 'backups'))).toEqual([]);
  });

  it('aborts before start, mid-copy and on plugin disposal without leaving partial files', async () => {
    const dir = await pluginDir();
    const db = liveDatabase(dir);
    db.prepare('CREATE TABLE t (pad BLOB)').run();
    db.transaction(() => { for (let i = 0; i < 400; i++) db.prepare('INSERT INTO t VALUES (randomblob(4000))').run(); })();
    const early = new AbortController(); early.abort();
    await expect(backupFor(dir, db)({ name: 'early', signal: early.signal })).rejects.toMatchObject({ code: 'aborted', name: 'AbortError' });
    const mid = new AbortController();
    const steps: PluginBackupSource = { pragma: (source) => db.pragma(source, { simple: true }),
      backup: (file, options) => db.backup(file, { progress: (info) => { mid.abort(); return options!.progress!(info) as number; } }) };
    await expect(backupFor(dir, db, { source: () => steps })({ name: 'mid', signal: mid.signal })).rejects.toMatchObject({ code: 'aborted' });
    const lifetime = new AbortController();
    const disposing: PluginBackupSource = { pragma: (source) => db.pragma(source, { simple: true }),
      backup: async () => { lifetime.abort(); throw new Error('database connection is not open'); } };
    await expect(backupFor(dir, db, { source: () => disposing, lifetime: lifetime.signal })({ name: 'gone' })).rejects.toMatchObject({ code: 'aborted' });
    const late = new AbortController();
    const afterCopy: PluginBackupSource = { pragma: (source) => db.pragma(source, { simple: true }),
      backup: async (file) => { await db.backup(file); late.abort(); } };
    await expect(backupFor(dir, db, { source: () => afterCopy })({ name: 'late', signal: late.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(await readdir(join(dir, 'backups'))).toEqual([]);
  });

  it('maps driver and integrity failures to failed and removes the copy', async () => {
    const dir = await pluginDir();
    const db = liveDatabase(dir);
    const broken: PluginBackupSource = { pragma: (source) => db.pragma(source, { simple: true }), backup: async () => { throw 'disk gone'; } };
    await expect(backupFor(dir, db, { source: () => broken })({ name: 'broken' })).rejects.toMatchObject({ code: 'failed', message: expect.stringContaining('disk gone') });
    const thrown: PluginBackupSource = { pragma: (source) => db.pragma(source, { simple: true }), backup: async () => { throw new Error('io error'); } };
    await expect(backupFor(dir, db, { source: () => thrown })({ name: 'thrown' })).rejects.toMatchObject({ code: 'failed', message: expect.stringContaining('io error') });
    const corrupt = backupFor(dir, db, { openCopy: (file) => {
      const real = backupCopyHandle(createSqliteDatabase(file));
      return { ...real, pragma: (source, options) => source === 'quick_check' ? 'row 3 missing from index' : real.pragma(source, options) };
    } });
    await expect(corrupt({ name: 'corrupt' })).rejects.toMatchObject({ code: 'failed', message: expect.stringContaining('integrity') });
    expect(await readdir(join(dir, 'backups'))).toEqual([]);
  });

  it('runs one backup at a time and keeps going after a failed one', async () => {
    const dir = await pluginDir();
    const db = liveDatabase(dir);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const slow: PluginBackupSource = { pragma: (source) => db.pragma(source, { simple: true }),
      backup: async (file) => {
        const call = ++calls;
        order.push(`start-${call}`);
        if (call === 1) { await gate; throw new Error('first fails'); }
        await db.backup(file);
        order.push(`end-${call}`);
      } };
    const backup = backupFor(dir, db, { source: () => slow });
    const first = backup({ name: 'one' }), second = backup({ name: 'two' });
    await vi.waitFor(() => expect(order).toEqual(['start-1']), { timeout: 5000 });
    // Give a wrongly-concurrent second backup several turns to start; serialization keeps it out.
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['start-1']);
    release();
    await expect(first).rejects.toMatchObject({ code: 'failed' });
    await expect(second).resolves.toMatchObject({ name: 'two' });
    expect(order).toEqual(['start-1', 'start-2', 'end-2']);
  });

  it('keeps a bounded number of backups and clears interrupted temp files', async () => {
    const dir = await pluginDir();
    const db = liveDatabase(dir);
    await mkdir(join(dir, 'backups'));
    await writeFile(join(dir, 'backups', '.crashed.tmp-1234'), 'partial');
    const backup = backupFor(dir, db);
    for (let i = 0; i < PLUGIN_DATABASE_BACKUP_RETENTION + 3; i++) {
      await backup({ name: `b${String(i).padStart(2, '0')}` });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const files = (await readdir(join(dir, 'backups'))).sort();
    expect(files).toHaveLength(PLUGIN_DATABASE_BACKUP_RETENTION);
    expect(files.at(-1)).toBe(`b${String(PLUGIN_DATABASE_BACKUP_RETENTION + 2).padStart(2, '0')}.db`);
    expect(files).not.toContain('.crashed.tmp-1234');
  });

  it('refuses a backups folder that is a symlink out of the plugin folder', async () => {
    const dir = await pluginDir(), outside = await pluginDir();
    await symlink(outside, join(dir, 'backups'));
    await expect(backupFor(dir, liveDatabase(dir))({ name: 'escape' })).rejects.toMatchObject({ code: 'failed', message: expect.stringContaining('plain directory') });
    expect(await readdir(outside)).toEqual([]);
  });
});

describe('storage.backupDatabase through createPluginApi', () => {
  it('backs up the plugin database and aborts in-flight work on dispose', async () => {
    const dir = await pluginDir();
    const handle = createPluginApi('backupdemo', dir);
    const db = handle.api.storage.database();
    db.runScript('CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES (\'kept\');');
    const result = await handle.api.storage.backupDatabase({ name: 'first' });
    expect(result.path).toBe(join(dir, 'backups', 'first.db'));
    const copy = createSqliteDatabase(result.path, { readonly: true });
    handles.push(copy);
    expect(copy.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'kept' }]);
    expect(copy.prepare('SELECT plugin_id FROM _zcc_backup').get()).toEqual({ plugin_id: 'backupdemo' });
    db.runScript('CREATE TABLE pad (b BLOB); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000) INSERT INTO pad SELECT randomblob(4000) FROM n;');
    const pending = handle.api.storage.backupDatabase({ name: 'second' });
    await handle.dispose();
    await expect(pending).rejects.toBeInstanceOf(PluginDatabaseBackupError);
    expect((await readdir(join(dir, 'backups'))).filter((entry) => entry !== 'first.db')).toEqual([]);
    expect(() => handle.api.storage.backupDatabase({ name: 'stale' })).toThrow('stale');
  });
});

it('reports codes on errors for callers', () => {
  expect(codeOf(new PluginDatabaseBackupError('too-large', 'x'))).toBe('too-large');
});
