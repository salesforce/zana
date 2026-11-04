import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runGit } from './git.js';
import { copyWorktreeIncludeFiles } from './worktree-include.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, copyFile: vi.fn(actual.copyFile) };
});

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zcc-include-'));
  dirs.push(root);
  const source = join(root, 'source'), target = join(root, 'target');
  await mkdir(source); await mkdir(target);
  await runGit(source, ['init', '-b', 'main']);
  return { root, source, target };
}
async function file(root: string, name: string, text = name) {
  await mkdir(dirname(join(root, name)), { recursive: true });
  await writeFile(join(root, name), text);
}

it('uses gitignore matching, including directories, anchoring and negations', async () => {
  const { source, target } = await fixture();
  for (const name of ['.env', '.env.local', '.env.skip', 'app/.env', 'secrets/key.pem', 'secrets/skip.pem', 'root-only', 'app/root-only', 'unmatched']) await file(source, name);
  // A directory exclusion must be reopened before Git can negate a child.
  await file(source, '.worktreeinclude', '.env*\n!.env.skip\nsecrets/*\n!secrets/skip.pem\n/root-only\n');
  expect((await copyWorktreeIncludeFiles(source, target)).copied.sort()).toEqual(['.env', '.env.local', 'app/.env', 'root-only', 'secrets/key.pem']);
  await file(source, '.worktreeinclude', 'secrets/\n');
  expect((await copyWorktreeIncludeFiles(source, target)).copied).toEqual(['secrets/skip.pem']);
});

it('never copies tracked source modifications, even when absent from the target', async () => {
  const { source, target } = await fixture();
  await file(source, '.worktreeinclude', '.env\n');
  await file(source, '.env', 'committed');
  await runGit(source, ['add', '.env']);
  await file(source, '.env', 'uncommitted');
  expect((await copyWorktreeIncludeFiles(source, target)).copied).toEqual([]);
});

it('does not descend into nested repositories or worktrees', async () => {
  const { source, target } = await fixture();
  await file(source, '.worktreeinclude', '.env\n');
  await file(source, '.env');
  const nested = join(source, '.git-worktrees', 'other');
  await mkdir(nested, { recursive: true });
  await runGit(nested, ['init', '-b', 'main']);
  await file(nested, '.env');
  expect((await copyWorktreeIncludeFiles(source, target)).copied).toEqual(['.env']);
});

it('skips symlinks, existing files and destination symlink directories', async () => {
  const { root, source, target } = await fixture();
  await file(source, '.worktreeinclude', '.env\nexisting\nlinked\nsecrets/\n');
  await file(source, '.env'); await file(source, 'existing', 'source');
  await file(source, 'secrets/key');
  await file(root, 'outside/untouched', 'original');
  await symlink(join(root, 'outside/untouched'), join(source, 'linked'));
  await symlink(join(root, 'outside'), join(target, 'secrets'));
  await file(target, 'existing', 'target');
  const result = await copyWorktreeIncludeFiles(source, target);
  expect(result.copied).toEqual(['.env']);
  expect(result.skipped).toEqual(expect.arrayContaining(['existing', 'linked']));
  expect(result.errors.join('\n')).toContain('secrets/key');
  expect(await readFile(join(target, 'existing'), 'utf8')).toBe('target');
  await expect(readFile(join(root, 'outside/key'))).rejects.toThrow();
  expect(await readFile(join(root, 'outside/untouched'), 'utf8')).toBe('original');
});

it('handles missing and comment-only include files without requiring Git', async () => {
  const { source, target } = await fixture();
  await rm(join(source, '.git'), { recursive: true });
  expect(await copyWorktreeIncludeFiles(source, target)).toEqual({ copied: [], skipped: [], errors: [] });
  await file(source, '.worktreeinclude', '# nothing\n\n');
  expect(await copyWorktreeIncludeFiles(source, target)).toEqual({ copied: [], skipped: [], errors: [] });
  await file(source, '.worktreeinclude', '.env\n');
  await expect(copyWorktreeIncludeFiles(source, target)).rejects.toThrow();
});

it('reports an unreadable include file', async () => {
  const { source, target } = await fixture();
  await mkdir(join(source, '.worktreeinclude'));
  expect((await copyWorktreeIncludeFiles(source, target)).errors).toHaveLength(1);
});

it.each(['EEXIST', 'EIO'])('handles a destination copy failure (%s) without overwriting', async code => {
  const { source, target } = await fixture();
  await file(source, '.worktreeinclude', '.env\n');
  await file(source, '.env');
  vi.mocked(fs.copyFile).mockRejectedValueOnce(Object.assign(new Error('copy failed'), { code }));
  const result = await copyWorktreeIncludeFiles(source, target);
  expect(result.copied).toEqual([]);
  if (code === 'EEXIST') expect(result.skipped).toEqual(['.env']);
  else expect(result.errors).toEqual(['.env: copy failed']);
});

it('honours cancellation before enumerating or copying', async () => {
  const { source, target } = await fixture();
  await file(source, '.worktreeinclude', '.env\n');
  await file(source, '.env');
  const controller = new AbortController();
  controller.abort(new Error('Provision cancelled'));
  await expect(copyWorktreeIncludeFiles(source, target, controller.signal)).rejects.toThrow('Provision cancelled');
});
