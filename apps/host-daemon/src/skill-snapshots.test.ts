import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, readdir, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkillSnapshotStore, SKILL_SNAPSHOT_MAX_BYTES } from './skill-snapshots.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const run of cleanup.splice(0).reverse()) await run(); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-skill-snapshot-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'skills-generated', 'demo');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: demo\ndescription: unchanged\n---\nfirst');
  const store = createSkillSnapshotStore(dir);
  cleanup.push(() => store.dispose());
  return { dir, source, store };
}
function codexPath(roots: Awaited<ReturnType<ReturnType<typeof createSkillSnapshotStore>['capture']>>) {
  const root = roots.find(root => root.id === 'injected-0:codex');
  if (!root || root.providerId !== 'codex') throw new Error('missing injected root');
  return root.skillDirectoryRootPath;
}
it('keeps existing catalogs immutable, detects body/resource changes, and reuses identical snapshots', async () => {
  const { source, store } = await setup();
  const oldOwner = {}, newOwner = {};
  const oldPath = codexPath(await store.capture(oldOwner));
  expect(codexPath(await store.capture(oldOwner))).toBe(oldPath);
  await writeFile(join(source, 'SKILL.md'), '---\nname: demo\ndescription: unchanged\n---\nsecond');
  await writeFile(join(source, 'helper.sh'), 'echo second', { mode: 0o700 });
  const newPath = codexPath(await store.capture(newOwner));
  expect(newPath).not.toBe(oldPath);
  expect(await readFile(join(oldPath, 'demo', 'SKILL.md'), 'utf8')).toContain('first');
  expect(await readFile(join(newPath, 'demo', 'helper.sh'), 'utf8')).toBe('echo second');
  await store.release(oldOwner);
  await expect(readFile(join(oldPath, 'demo', 'SKILL.md'))).rejects.toThrow();
  expect(await readFile(join(newPath, 'demo', 'SKILL.md'), 'utf8')).toContain('second');
});
it('serializes concurrent capture and retains a shared catalog until both owners release it', async () => {
  const { store } = await setup();
  const a = {}, b = {};
  const paths = await Promise.all([store.capture(a), store.capture(b)]).then(roots => roots.map(codexPath));
  expect(paths[0]).toBe(paths[1]);
  await store.release(a);
  expect(await readdir(paths[0])).toEqual(['demo']);
  await store.release(b);
  await expect(readdir(paths[0])).rejects.toThrow();
});
it('rejects escaping symlinks and size overflow, then recovers without leaving temporary files', async () => {
  const { dir, source, store } = await setup();
  const outside = join(dir, 'outside');
  await writeFile(outside, 'private');
  const link = join(source, 'escape');
  await symlink(outside, link);
  await expect(store.capture({})).rejects.toThrow('escapes');
  await rm(link);
  const large = join(source, 'large');
  await writeFile(large, '');
  await truncate(large, SKILL_SNAPSHOT_MAX_BYTES + 1);
  await expect(store.capture({})).rejects.toThrow('64 MiB');
  await rm(large);
  const path = codexPath(await store.capture({}));
  expect(await readdir(path)).toEqual(['demo']);
  await store.dispose();
  await expect(store.capture({})).rejects.toThrow('closed');
});
it('retains dropped skills only for old sessions and removes snapshots on disposal', async () => {
  const { source, store } = await setup();
  const oldPath = codexPath(await store.capture({}));
  await rm(source, { recursive: true });
  const newPath = codexPath(await store.capture({}));
  expect(await readdir(newPath)).toEqual([]);
  expect(await readdir(oldPath)).toEqual(['demo']);
  await store.dispose();
  await expect(readdir(oldPath)).rejects.toThrow();
});

it('bounds retained revisions and makes room when an old owner is released', async () => {
  const { source, store } = await setup();
  const owners = Array.from({ length: 32 }, () => ({}));
  for (const [index, owner] of owners.entries()) {
    await writeFile(join(source, 'SKILL.md'), `revision ${index}`);
    await store.capture(owner);
  }
  await writeFile(join(source, 'SKILL.md'), 'next revision');
  await expect(store.capture({})).rejects.toThrow('Too many skill revisions');
  await store.release(owners[0]);
  expect(await readFile(join(codexPath(await store.capture({})), 'demo', 'SKILL.md'), 'utf8')).toBe('next revision');
});

it('removes only crashed daemon catalogs and rejects excessive nesting', async () => {
  const { dir, source, store } = await setup();
  const parent = join(dir, 'runtime-skill-snapshots');
  const dead = join(parent, '2147483647-00000000-0000-0000-0000-000000000000');
  const alive = join(parent, `${process.pid}-00000000-0000-0000-0000-000000000000`);
  await mkdir(dead, { recursive: true }); await mkdir(alive);
  await writeFile(join(parent, 'unrelated-file'), 'keep');
  await store.capture({});
  await expect(readdir(dead)).rejects.toThrow();
  expect(await readdir(alive)).toEqual([]);
  expect(await readFile(join(parent, 'unrelated-file'), 'utf8')).toBe('keep');
  await mkdir(join(source, ...Array(17).fill('nested')), { recursive: true });
  await expect(store.capture({})).rejects.toThrow('nesting');
});

it('copies main-authorized builtin symlinks and still confines their descendants', async () => {
  const { dir, source, store } = await setup();
  const builtin = join(dir, 'builtin');
  await mkdir(builtin);
  await writeFile(join(builtin, 'SKILL.md'), 'builtin contents');
  await symlink(builtin, join(source, '..', 'linked-builtin'));
  const { realpath } = await import('node:fs/promises');
  await writeFile(join(dir, 'injected-skill-roots.json'), JSON.stringify({ directoryRoots: [], builtinSkillTargets: [await realpath(builtin)] }));
  const path = codexPath(await store.capture({}));
  expect(await readFile(join(path, 'linked-builtin', 'SKILL.md'), 'utf8')).toBe('builtin contents');
  await symlink(join(source, 'SKILL.md'), join(builtin, 'escape'));
  await expect(store.capture({})).rejects.toThrow('escapes');
});
