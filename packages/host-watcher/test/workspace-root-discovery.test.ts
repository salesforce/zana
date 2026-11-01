import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveWorkspaceRootIgnores } from '../src/workspace-root-ignores.js';

const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); execFile.mockReset(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const root = async () => { const dir = await mkdtemp(join(tmpdir(), 'zcc-ignore-discovery-')); roots.push(dir); return dir; };

it('prefixes ignored directories and reports nested status failures without losing other repositories', async () => {
  const cwd = await root();
  await mkdir(join(cwd, 'apps/good/.git'), { recursive: true });
  await mkdir(join(cwd, 'apps/broken/.git'), { recursive: true });
  await mkdir(join(cwd, 'node_modules/skip/.git'), { recursive: true });
  execFile.mockImplementation((_command, _args, options, callback) => {
    if (options.cwd.endsWith('broken')) callback(new Error('status unavailable'), '');
    else callback(null, '!! dist/\0!! ignored-file.txt\0?? loose-file.txt\0');
  });
  const result = await resolveWorkspaceRootIgnores({ cwd, gitRoot: false });
  expect(result.ignore).toContain('apps/good/dist');
  expect(result.ignore).not.toContain('.git');
  expect(result.ignore).not.toContain('apps/good/ignored-file.txt');
  expect(result.failures).toEqual(['apps/broken: status unavailable']);
  expect(execFile).toHaveBeenCalledTimes(2);
  expect(execFile.mock.calls[0]![2]).toMatchObject({ timeout: 5_000, maxBuffer: 10 * 1024 * 1024 });
});

it('keeps base ignores when root status or directory enumeration fails', async () => {
  const cwd = await root();
  execFile.mockImplementation((_command, _args, _options, callback) => callback(new Error('not a repository'), ''));
  expect(await resolveWorkspaceRootIgnores({ cwd, gitRoot: true })).toMatchObject({ failures: ['not a repository'], ignore: expect.arrayContaining(['.git', '**/node_modules/**']) });
  expect(await resolveWorkspaceRootIgnores({ cwd: join(cwd, 'missing'), gitRoot: false })).toMatchObject({ failures: [], ignore: expect.arrayContaining(['**/node_modules/**']) });
});

it('shares a 5000-directory budget and bounds the breadth of discovery', async () => {
  const dir = (name: string) => ({ name, isDirectory: () => true });
  const readdir = vi.spyOn(fs, 'readdir').mockImplementation(async (path) => String(path) === '/wide'
    ? Array.from({ length: 20_000 }, (_, index) => dir(`directory-${index}`)) as never
    : [] as never);
  const result = await resolveWorkspaceRootIgnores({ cwd: '/wide', gitRoot: false });
  expect(readdir).toHaveBeenCalledTimes(5_000);
  expect(execFile).not.toHaveBeenCalled();
  expect(result.failures).toEqual([]);
});
