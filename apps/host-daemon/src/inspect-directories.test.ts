import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectDirectories } from './inspect-directories.js';
import { HostInspectDirectoriesCommandSchema, HostInspectDirectoriesResultSchema, parseHostRpcResult } from '@zana-ai/zcc-contracts/host-rpc';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))); });
it('resolves aliases, distinguishes files/missing paths, and handles bounded batches', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'inspect-projects-')); roots.push(root);
  await fs.mkdir(join(root, 'repo')); await fs.writeFile(join(root, 'file'), '');
  await fs.symlink(join(root, 'repo'), join(root, 'alias'));
  const paths = [join(root, 'alias'), join(root, 'file'), join(root, 'absent'), ...Array(9).fill(join(root, 'repo'))];
  const result = await inspectDirectories(paths);
  expect(result.directories).toHaveLength(12);
  expect(result.directories[0]).toEqual({ requestedPath: paths[0], path: await fs.realpath(join(root, 'repo')), status: 'ready' });
  expect(result.directories[1].status).toBe('not-directory');
  expect(result.directories[2].status).toBe('missing');
  expect(parseHostRpcResult('host.inspect_directories', result)).toEqual(result);
});
it('reports denied access without calling it a missing directory', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'inspect-denied-')); roots.push(root);
  vi.spyOn(fs, 'access').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
  expect((await inspectDirectories([root])).directories[0].status).toBe('inaccessible');
});
it.each([[], ['relative'], Array(101).fill('/tmp')].map(paths => [paths]))('rejects invalid directory requests', async paths => {
  await expect(inspectDirectories(paths)).rejects.toThrow('absolute folder paths');
  expect(HostInspectDirectoriesCommandSchema.safeParse({ type: 'host.inspect_directories', paths }).success).toBe(paths.length === 1);
});
it('rejects malformed result states and oversized transport requests', () => {
  expect(HostInspectDirectoriesCommandSchema.safeParse({ type: 'host.inspect_directories', paths: ['/tmp'], extra: true }).success).toBe(false);
  expect(HostInspectDirectoriesResultSchema.safeParse({ directories: [{ requestedPath: '/tmp', path: null, status: 'deleted' }] }).success).toBe(false);
});
