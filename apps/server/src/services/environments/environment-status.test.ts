import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
vi.mock('@zana-ai/zcc-db', () => ({ getEnvironment: vi.fn(), listEnvironmentsByProject: vi.fn() }));
import { getEnvironment } from '@zana-ai/zcc-db';
import { environmentStatus, runEnvironmentAction } from './environment-actions.js';

const call = vi.fn();
let ctx: ProductHttpContext;
const statusCalls = () => call.mock.calls.filter(([input]) => input.command.type === 'workspace.status').length;

beforeEach(() => {
  // A fresh host hub per test, so the per-hub status cache starts empty.
  ctx = { db: {}, hostHub: { callHostOnlineRpc: call } } as unknown as ProductHttpContext;
  call.mockReset().mockImplementation(async ({ command }) => command.type === 'workspace.status'
    ? { isGitRepo: true, dirty: true }
    : { commitSha: 'abc' });
  vi.mocked(getEnvironment).mockReturnValue({
    id: 'e1', path: '/project', hostId: 'h1', status: 'ready', isGitRepo: true,
    workspaceProvisionType: 'managed-worktree', branchName: 'zcc/x'
  } as never);
});

describe('environment status', () => {
  it('shares one host request between concurrent pollers', async () => {
    const results = await Promise.all([environmentStatus(ctx, 'e1'), environmentStatus(ctx, 'e1'), environmentStatus(ctx, 'e1')]);
    expect(results).toEqual([{ isGitRepo: true, dirty: true }, { isGitRepo: true, dirty: true }, { isGitRepo: true, dirty: true }]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith({
      hostId: 'h1',
      command: { type: 'workspace.status', workspacePath: '/project', workspaceProvisionType: 'managed-worktree' }
    });
  });

  it.each([
    { action: 'commit' },
    { action: 'squash_merge', targetBranch: 'main' }
  ])('refreshes status after $action', async (body) => {
    await environmentStatus(ctx, 'e1');
    await runEnvironmentAction(ctx, 'e1', body);
    await environmentStatus(ctx, 'e1');
    expect(statusCalls()).toBe(2);
  });

  it('refreshes status even when the action fails', async () => {
    await environmentStatus(ctx, 'e1');
    call.mockImplementationOnce(async () => { throw new Error('commit failed'); });
    await expect(runEnvironmentAction(ctx, 'e1', { action: 'commit' })).rejects.toThrow('commit failed');
    await environmentStatus(ctx, 'e1');
    expect(statusCalls()).toBe(2);
  });

  it('rejects invalid actions without contacting the host', async () => {
    await expect(runEnvironmentAction(ctx, 'e1', { action: 'nope' })).rejects.toMatchObject({ status: 400 });
    expect(call).not.toHaveBeenCalled();
  });
});
