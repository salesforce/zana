import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { canonicalPluginPath, createPluginActivationStore } from './plugin-activation-store.js';
import type { InstalledPluginRow } from './plugin-store.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'activation-store-')); roots.push(dir);
  const owned = join(dir, 'plugins/sample'); await mkdir(owned, { recursive: true });
  const previous = { id: 'sample', sourceKind: 'git', version: '1.0.0', enabled: true, installedAt: 1,
    rootDir: join(dir, 'plugins/generations', randomUUID(), 'git') } as InstalledPluginRow;
  const candidate = { ...previous, version: '2.0.0', rootDir: join(dir, 'plugins/generations', randomUUID(), 'git') };
  await mkdir(previous.rootDir, { recursive: true }); await mkdir(candidate.rootDir, { recursive: true });
  const store = createPluginActivationStore(dir);
  return { dir, owned, previous, candidate, store };
}

it('makes a WAL-safe, private snapshot and restores only owned state, including deleted and new keys', async () => {
  const f = await fixture();
  await mkdir(join(f.owned, 'secrets/nested'), { recursive: true });
  await writeFile(join(f.owned, 'secrets/nested/token'), 'secret', { mode: 0o644 });
  await writeFile(join(f.owned, 'kv.json'), JSON.stringify({ 'schedule:job:last': 'before', saved: 1 }));
  await writeFile(join(f.owned, 'settings.json'), '{"name":"before"}');
  await writeFile(join(f.owned, 'unowned.txt'), 'outside recovery');
  const db = createSqliteDatabase(join(f.owned, 'data.db'));
  try {
    db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0');
    db.exec("CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('before')");
    const journal = await f.store.prepare(f.previous, f.candidate, 123);
    expect(await f.store.list()).toEqual([journal]);
    expect(journal.files.map(file => file.path).sort()).toEqual(['data.db', 'kv.json', 'secrets/nested/token', 'settings.json']);
    const snapshot = join(f.dir, 'plugin-activations', journal.id, 'snapshot');
    expect((await stat(join(snapshot, 'secrets/nested/token'))).mode & 0o777).toBe(0o600);
    db.exec("UPDATE records SET value='after'"); db.close();
    await writeFile(join(f.owned, 'kv.json'), '{"new":2}'); await rm(join(f.owned, 'settings.json'));
    await writeFile(join(f.owned, 'secrets/new'), 'new secret');
    const restoring = await f.store.phase(journal, 'restoring');
    await f.store.restore(restoring); await f.store.restore(restoring); // Repeat after an interrupted restore.
    const restored = createSqliteDatabase(join(f.owned, 'data.db'));
    try { expect(restored.prepare('SELECT value FROM records').get()).toEqual({ value: 'before' }); } finally { restored.close(); }
    expect(JSON.parse(await readFile(join(f.owned, 'kv.json'), 'utf8'))).toEqual({ 'schedule:job:last': 'before', saved: 1 });
    expect(await readFile(join(f.owned, 'settings.json'), 'utf8')).toContain('before');
    expect(await readdir(join(f.owned, 'secrets'))).toEqual(['nested']);
    expect(await readFile(join(f.owned, 'unowned.txt'), 'utf8')).toBe('outside recovery');
    await f.store.phase(restoring, 'restored'); await f.store.finish(journal); expect(await f.store.list()).toEqual([]);
  } finally { if (db.open) db.close(); }
});

it('restores absence as well as presence, handles missing storage and discards interrupted snapshots', async () => {
  const f = await fixture(); await rm(f.owned, { recursive: true });
  expect(await f.store.list()).toEqual([]);
  const journal = await f.store.prepare(f.previous, f.candidate, 0);
  await mkdir(f.owned); await writeFile(join(f.owned, 'kv.json'), '{"migration":true}');
  await f.store.restore(journal); expect(await readdir(f.owned)).toEqual([]);
  const partial = join(f.dir, 'plugin-activations', randomUUID()); await mkdir(partial);
  expect(await f.store.list()).toEqual([journal]); await expect(stat(partial)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['tamper', 'traverse', 'duplicate', 'outside', 'identity', 'file-symlink', 'ancestor-symlink', 'storage-symlink'])('fails closed before modifying live state: %s', async mode => {
  const f = await fixture(); await mkdir(join(f.owned, 'secrets')); await writeFile(join(f.owned, 'secrets/token'), 'before');
  const journal = await f.store.prepare(f.previous, f.candidate, 0);
  await writeFile(join(f.owned, 'kv.json'), 'live');
  const snapshot = join(f.dir, 'plugin-activations', journal.id, 'snapshot');
  if (mode === 'tamper') await writeFile(join(snapshot, 'secrets/token'), 'damage');
  if (mode === 'traverse') journal.files[0]!.path = '../kv.json';
  if (mode === 'duplicate') journal.files.push(journal.files[0]!);
  if (mode === 'outside') journal.previous.rootDir = tmpdir();
  if (mode === 'identity') journal.candidate.id = 'other';
  if (mode === 'file-symlink') { await rm(join(snapshot, 'secrets/token')); await symlink(join(f.owned, 'secrets/token'), join(snapshot, 'secrets/token')); }
  if (mode === 'ancestor-symlink') { await rm(join(snapshot, 'secrets'), { recursive: true }); await symlink(join(f.owned, 'secrets'), join(snapshot, 'secrets')); }
  if (mode === 'storage-symlink') { await rm(f.owned, { recursive: true }); await mkdir(join(f.dir, 'outside')); await writeFile(join(f.dir, 'outside/kv.json'), 'live'); await symlink(join(f.dir, 'outside'), f.owned); }
  await expect(f.store.restore(journal)).rejects.toThrow();
  expect(await readFile(join(f.owned, 'kv.json'), 'utf8')).toBe('live');
});

it.each(['symlink', 'directory', 'secrets-file', 'large', 'many', 'database-sidecar'])('refuses unsafe or unbounded snapshots and removes partial files: %s', async mode => {
  const f = await fixture();
  if (mode === 'symlink') await symlink(f.previous.rootDir, join(f.owned, 'settings.json'));
  if (mode === 'directory') await mkdir(join(f.owned, 'kv.json'));
  if (mode === 'secrets-file') await writeFile(join(f.owned, 'secrets'), 'invalid');
  if (mode === 'large') { await writeFile(join(f.owned, 'kv.json'), ''); await truncate(join(f.owned, 'kv.json'), 257 * 1024 * 1024); }
  if (mode === 'many') { await mkdir(join(f.owned, 'secrets')); await Promise.all(Array.from({ length: 1024 }, (_, i) => writeFile(join(f.owned, 'secrets', String(i)), ''))); }
  if (mode === 'database-sidecar') { const db = createSqliteDatabase(join(f.owned, 'data.db')); db.exec('CREATE TABLE sample(id)'); db.close(); await symlink(f.previous.rootDir, join(f.owned, 'data.db-wal')); }
  await expect(f.store.prepare(f.previous, f.candidate, 0)).rejects.toThrow();
  expect(await f.store.list()).toEqual([]);
}, 60_000);

it('rejects corrupted journals, unexpected entries and journal symlinks', async () => {
  const f = await fixture(); const journal = await f.store.prepare(f.previous, f.candidate, 0);
  const file = join(f.dir, 'plugin-activations', journal.id, 'journal.json');
  await writeFile(file, JSON.stringify({ ...journal, id: randomUUID() })); await expect(f.store.list()).rejects.toThrow('disagree');
  await writeFile(file, 'broken'); await expect(f.store.list()).rejects.toThrow();
  await rm(file); await symlink(join(f.owned, 'kv.json'), file); await expect(f.store.list()).rejects.toThrow('journal file');
  await rm(file); await writeFile(file, JSON.stringify(journal));
  await writeFile(join(f.dir, 'plugin-activations/unexpected'), ''); await expect(f.store.list()).rejects.toThrow('Unexpected');
});

it('ignores only regular OS metadata while scanning every independent journal', async () => {
  const f = await fixture(); const journal = await f.store.prepare(f.previous, f.candidate, 0);
  const root = join(f.dir, 'plugin-activations');
  for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) await writeFile(join(root, name), 'metadata');
  expect(await f.store.scan()).toEqual({ journals: [journal], issues: [] });
  expect(await f.store.list()).toEqual([journal]);
  const bad = randomUUID(); await mkdir(join(root, bad)); await writeFile(join(root, bad, 'journal.json'), 'broken');
  const result = await f.store.scan();
  expect(result.journals).toEqual([journal]); expect(result.issues).toEqual([{ entry: bad, detail: expect.any(String) }]);
  expect(await readFile(join(root, bad, 'journal.json'), 'utf8')).toBe('broken');
});

it.each(['directory', 'symlink'] as const)('does not ignore %s disguised as OS metadata', async mode => {
  const f = await fixture(); const root = join(f.dir, 'plugin-activations'); await mkdir(root);
  if (mode === 'directory') await mkdir(join(root, '.DS_Store'));
  else await symlink(f.owned, join(root, '.DS_Store'));
  expect((await f.store.scan()).issues).toEqual([{ entry: '.DS_Store', detail: 'Unexpected plugin activation entry' }]);
});

it('bounds directory scanning and reports overflow without discarding remaining evidence', async () => {
  const f = await fixture(); const root = join(f.dir, 'plugin-activations'); await mkdir(root);
  await Promise.all(Array.from({ length: 257 }, async () => {
    const dir = join(root, randomUUID()); await mkdir(dir); await writeFile(join(dir, 'journal.json'), 'broken');
  }));
  const result = await f.store.scan();
  expect(result.issues).toHaveLength(257);
  expect(result.issues.at(-1)?.detail).toContain('Too many pending');
  expect(await readdir(root)).toHaveLength(257);
});

it('collects orphan managed generations while preserving registered subdirectories and foreign folders', async () => {
  const f = await fixture(); const generations = join(f.dir, 'plugins/generations');
  await mkdir(join(generations, 'foreign')); await symlink(f.previous.rootDir, join(generations, randomUUID()));
  await f.store.pruneGenerations([f.previous.rootDir, '/unmanaged']);
  expect(await stat(f.previous.rootDir)).toBeDefined(); await expect(stat(f.candidate.rootDir)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await stat(join(generations, 'foreign'))).toBeDefined();
  await rm(generations, { recursive: true }); await f.store.pruneGenerations([]);
});

it('reads completed journals after generation cleanup through canonical filesystem aliases', async () => {
  const f = await fixture(); const alias = join(f.dir, 'alias'); await symlink(join(f.dir, 'plugins'), alias);
  const previous = { ...f.previous, rootDir: f.previous.rootDir.replace(join(f.dir, 'plugins'), alias) };
  let journal = await f.store.prepare(previous, f.candidate, 0); journal = await f.store.phase(journal, 'committed');
  await rm(join(f.previous.rootDir, '..'), { recursive: true, force: true });
  expect((await f.store.list())[0]).toEqual(journal);
  expect(canonicalPluginPath(previous.rootDir)).toBe(canonicalPluginPath(f.previous.rootDir));
  await f.store.pruneGenerations([previous.rootDir]);
  await symlink(join(f.dir, 'nonexistent'), join(f.dir, 'dangling'));
  expect(() => canonicalPluginPath(join(f.dir, 'dangling/child'))).toThrow('dangling');
  await expect(f.store.phase({ ...journal, candidate: { ...f.candidate, rootDir: join(f.dir, 'outside/missing') } }, 'committed')).rejects.toThrow('outside managed');
});


it('permits a path-recovery snapshot only inside managed storage', async () => {
  const f = await fixture();
  const previous = { ...f.previous, sourceKind: 'path' as const };
  const candidate = { ...f.candidate, sourceKind: 'path' as const };
  const journal = await f.store.prepare(previous, candidate, 0);
  expect((await f.store.list())[0]?.candidate.sourceKind).toBe('path');
  await expect(f.store.phase({ ...journal, candidate: { ...candidate, rootDir: f.dir } }, 'committed')).rejects.toThrow('outside managed');
});
