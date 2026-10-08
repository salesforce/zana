import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommandRuntime, dispatchHostCommand } from './command-dispatch.js';
import type { HostRpcCommand } from '@zana-ai/zcc-contracts/host-rpc';

const workspace = vi.hoisted(() => Object.fromEntries([
  'workspaceBranches', 'workspaceStatus', 'workspaceDiff', 'workspaceDiffFiles',
  'workspaceDiffPatch', 'workspaceCommit', 'workspaceSquashMerge',
  'workspacePullRequest', 'workspacePullRequestAction', 'workspacePullRequestCreate'
].map(name => [name, vi.fn()])));
vi.mock('@zana-ai/zcc-host-workspace', async importOriginal => ({
  ...await importOriginal<object>(), ...workspace
}));

const path = '/fixture/authorized-checkout';
const target = { type: 'uncommitted' };
const rows = [
  { type: 'host.list_branches', fn: 'workspaceBranches', fields: { limit: 12 }, args: [path, 12] },
  { type: 'workspace.status', fn: 'workspaceStatus', fields: {}, args: [path] },
  { type: 'workspace.diff', fn: 'workspaceDiff', fields: { target }, args: [path, target] },
  { type: 'workspace.diffFiles', fn: 'workspaceDiffFiles', fields: { target, maxFiles: 5 }, args: [path, target, 5] },
  { type: 'workspace.diffPatch', fn: 'workspaceDiffPatch', fields: { target, paths: ['note.md'], maxBytesPerFile: 1024 }, args: [path, target, ['note.md'], 1024] },
  { type: 'workspace.commit', fn: 'workspaceCommit', fields: { message: 'Fix preview', noVerify: false }, args: [path, 'Fix preview', false] },
  { type: 'workspace.squash_merge', fn: 'workspaceSquashMerge', fields: { targetBranch: 'main', message: 'Land preview' }, args: [path, 'main', 'Land preview'] },
  { type: 'workspace.pull_request', fn: 'workspacePullRequest', fields: {}, args: [path], wrapped: true },
  { type: 'workspace.pull_request_ready', fn: 'workspacePullRequestAction', fields: {}, args: [path, { operation: 'ready' }] },
  { type: 'workspace.pull_request_draft', fn: 'workspacePullRequestAction', fields: {}, args: [path, { operation: 'draft' }] },
  { type: 'workspace.pull_request_merge', fn: 'workspacePullRequestAction', fields: { method: 'squash' }, args: [path, { operation: 'merge', method: 'squash' }] },
  { type: 'workspace.pull_request_create', fn: 'workspacePullRequestCreate', fields: { title: 'Preview', body: 'PDF repair', base: 'main', draft: true }, args: [path, { title: 'Preview', body: 'PDF repair', base: 'main', draft: true }], wrapped: true }
];

beforeEach(() => {
  for (const fn of Object.values(workspace)) fn.mockReset().mockResolvedValue({ ok: true });
});

describe('host checkout command routing', () => {
  it.each(rows)('$type retains the requested checkout and operation options', async row => {
    const command = { type: row.type, workspacePath: path, ...row.fields } as HostRpcCommand;
    await expect(dispatchHostCommand(createCommandRuntime({}), command))
      .resolves.toEqual(row.wrapped ? { pullRequest: { ok: true } } : { ok: true });
    expect(workspace[row.fn]).toHaveBeenCalledExactlyOnceWith(...row.args);
  });

  it.each(rows)('$type surfaces a failed checkout operation instead of reporting success', async row => {
    workspace[row.fn].mockRejectedValueOnce(new Error('checkout unavailable'));
    const command = { type: row.type, workspacePath: path, ...row.fields } as HostRpcCommand;
    await expect(dispatchHostCommand(createCommandRuntime({}), command))
      .rejects.toMatchObject({ code: 'internal', message: 'checkout unavailable' });
  });
});
