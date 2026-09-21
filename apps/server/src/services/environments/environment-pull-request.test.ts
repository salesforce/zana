import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
vi.mock('@zana-ai/zcc-db', () => ({ getEnvironment: vi.fn(), listEnvironmentsByProject: vi.fn() }));
import { getEnvironment } from '@zana-ai/zcc-db';
import { environmentPullRequest } from './environment-actions.js';

const call = vi.fn();
const ctx = { db: {}, hostHub: { callHostOnlineRpc: call } } as unknown as ProductHttpContext;
beforeEach(() => {
  call.mockReset().mockResolvedValue({ pullRequest: { number: 7 } });
  vi.mocked(getEnvironment).mockReturnValue({ id: 'e1', path: '/project', hostId: 'h1', status: 'ready', isGitRepo: true, workspaceProvisionType: 'unmanaged' } as never);
});
describe('optional environment PR metadata', () => {
  it('returns available metadata from the authorized environment', async () => {
    await expect(environmentPullRequest(ctx, 'e1')).resolves.toEqual({ pullRequest: { number: 7 } });
    expect(call).toHaveBeenCalledWith({ hostId: 'h1', command: { type: 'workspace.pull_request', workspacePath: '/project', workspaceProvisionType: 'unmanaged' } });
  });
  it.each(['gh_missing', 'gh_failed'])('reports %s as an unavailable lookup', async (code) => {
    call.mockRejectedValue(Object.assign(Error('CLI unavailable'), { code }));
    await expect(environmentPullRequest(ctx, 'e1')).resolves.toEqual({ pullRequest: null, unavailableReason: 'CLI unavailable' });
  });
  it('skips non-Git projects', async () => {
    vi.mocked(getEnvironment).mockReturnValue({ path: '/project', status: 'ready', isGitRepo: false } as never);
    await expect(environmentPullRequest(ctx, 'e1')).resolves.toEqual({ pullRequest: null });
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['host_offline', 'path-escape', 'unexpected'])('preserves %s failures', async (code) => {
    const error = Object.assign(Error(code), { code });
    call.mockRejectedValue(error);
    await expect(environmentPullRequest(ctx, 'e1')).rejects.toBe(error);
  });
  it('rejects unknown and unready environments before contacting the host', async () => {
    vi.mocked(getEnvironment).mockReturnValueOnce(null).mockReturnValueOnce({ path: null } as never);
    await expect(environmentPullRequest(ctx, 'missing')).rejects.toMatchObject({ status: 404 });
    await expect(environmentPullRequest(ctx, 'pending')).rejects.toMatchObject({ status: 409 });
    expect(call).not.toHaveBeenCalled();
  });
});
