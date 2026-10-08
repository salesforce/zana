import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost, createEnvironment } from '@zana-ai/zcc-db';
import { projectGit } from './project-git.js';
import { workspaceStatusCacheFor } from '../services/environments/workspace-status-cache.js';
let dir: string, db: ReturnType<typeof openDatabase>;
const rpc = vi.fn(); let ctx: any;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-project-git-')); db = openDatabase(join(dir, 'state.sqlite'));
  upsertHost(db, { id: 'primary', name: 'Primary', hostKeyHash: 'a'.repeat(64), isPrimary: true });
  ctx = { db, toProjects: () => [{ id: 'project', path: '/original', sources: [{ id: 'source', hostId: 'remote', path: '/checkout' }] }], hostHub: { resolveHostId: (id: string) => id, callHostOnlineRpc: rpc } };
  rpc.mockReset(); rpc.mockResolvedValue({ isGitRepo: true, branchName: 'main', checkout: { kind: 'branch' }, ahead: 1, behind: 0, dirty: true, files: [{ path: 'file.txt', kind: 'modified' }, { path: '../secret', kind: 'untracked' }] });
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const scope = { projectId: 'project', hostId: 'remote' };
it('resolves the selected source and maps only safe Git paths', async () => {
  expect(await projectGit(ctx, { operation: 'status', path: '/checkout', scope })).toMatchObject({ branch: 'main', files: { '/checkout/file.txt': 'M' } });
  expect(rpc).toHaveBeenCalledWith({ hostId: 'remote', command: { type: 'workspace.status', workspacePath: '/checkout', workspaceProvisionType: 'unmanaged' } });
  await projectGit(ctx, { operation: 'status', path: '/original' }); expect(rpc.mock.lastCall![0].hostId).toBe('primary');
});
it('keeps HEAD and revision-gated discard on the same authorized machine', async () => {
  await projectGit(ctx, { operation: 'head', path: '/checkout/file.txt', scope });
  expect(rpc.mock.lastCall![0]).toMatchObject({ hostId: 'remote', command: { type: 'host.git_file', root: '/checkout', operation: 'head' } });
  await expect(projectGit(ctx, { operation: 'discard', path: '/checkout/file.txt', scope })).rejects.toThrow('Refresh');
  await projectGit(ctx, { operation: 'discard', path: '/checkout/file.txt', scope, expectedSha256: null });
  expect(rpc.mock.lastCall![0].command.expectedSha256).toBeNull();
});
it.each([
  { operation: 'shell', path: '/checkout', scope }, { operation: 'status', path: '/original', scope },
  { operation: 'head', path: '/checkout', scope }, { operation: 'status', path: '/checkout/../secret', scope }
])('rejects invalid operations and mismatched paths before host execution', async input => {
  await expect(projectGit(ctx, input)).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled();
});
it('handles non-repositories and returns current branch markers', async () => {
  rpc.mockResolvedValueOnce({ isGitRepo: false }); expect(await projectGit(ctx, { operation: 'status', path: '/checkout', scope })).toBeNull();
  // Status is shared for a short window; a second read reuses it.
  expect(await projectGit(ctx, { operation: 'branches', path: '/checkout', scope })).toEqual([]);
  expect(rpc).toHaveBeenCalledTimes(1);
  workspaceStatusCacheFor(ctx).invalidate('remote', '/checkout');
  rpc.mockResolvedValueOnce({ isGitRepo: true, branchName: 'main' }).mockResolvedValueOnce({ branches: ['main', 'feature'] });
  expect(await projectGit(ctx, { operation: 'branches', path: '/checkout', scope })).toEqual([{ name: 'main', current: true }, { name: 'feature', current: false }]);
  expect(await projectGit(ctx, { operation: 'worktrees', path: '/checkout', scope })).toEqual([expect.objectContaining({ path: '/checkout', isMain: true })]);
  upsertHost(db, { id: 'remote', name: 'Remote', hostKeyHash: 'b'.repeat(64), isPrimary: false });
  createEnvironment(db, { projectId: 'project', hostId: 'remote', path: '/managed', workspaceProvisionType: 'managed-worktree', status: 'ready', branchName: 'feature' });
  createEnvironment(db, { projectId: 'project', hostId: 'primary', path: '/other', workspaceProvisionType: 'managed-worktree', status: 'ready' });
  expect(await projectGit(ctx, { operation: 'worktrees', path: '/checkout', scope })).toEqual([expect.objectContaining({ path: '/checkout', isMain: true }), expect.objectContaining({ path: '/managed', branch: 'feature' })]);
});
