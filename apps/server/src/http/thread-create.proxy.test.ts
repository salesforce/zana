import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  proxy: vi.fn(),
  listExecutionHosts: vi.fn(),
  remoteWorkspacePath: vi.fn(),
  resolveHarnessWorkspacePath: vi.fn(),
  createThread: vi.fn(),
  createEnvironment: vi.fn(),
  updateThreadStatus: vi.fn(),
  updateEnvironmentDiscovery: vi.fn(),
  updateEnvironmentStatus: vi.fn()
}));

vi.mock('@zana-ai/zcc-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-db')>()),
  listExecutionHosts: m.listExecutionHosts,
  getPrimaryHost: () => ({ id: 'h1' }),
  getEnvironment: () => ({ id: 'env1', path: '/r/ws' }),
  createThread: m.createThread,
  createEnvironment: m.createEnvironment,
  updateThreadStatus: m.updateThreadStatus,
  updateEnvironmentDiscovery: m.updateEnvironmentDiscovery,
  updateEnvironmentStatus: m.updateEnvironmentStatus
}));
vi.mock('../services/threads/remote-tool-proxy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/threads/remote-tool-proxy.js')>()),
  isRemoteToolProxyActive: m.proxy,
  boundRemoteHostId: () => undefined,
  remoteWorkspacePath: m.remoteWorkspacePath,
  resolveHarnessWorkspacePath: m.resolveHarnessWorkspacePath
}));
vi.mock('../services/threads/spawn-choice-for-host.js', () => ({
  resolveSpawnChoiceForHost: () => ({ ok: true, choice: { kind: 'unmanaged' }, dropCwd: false })
}));
vi.mock('../services/threads/workspace-path-claims.js', () => ({ unmanagedAttachRefusal: () => null }));
vi.mock('../services/threads/spawn-environment-provision.js', () => ({ provisionCommandFor: () => ({ type: 'environment.provision' }) }));

import { createThreadFromRequest } from './thread-create.js';

function makeCtx(calls: Array<{ type: string; [k: string]: unknown }>) {
  return {
    db: { transaction: (fn: () => unknown) => fn() },
    dataDir: '/tmp/none',
    hub: { emit: vi.fn() },
    toProjects: () => [{ id: 'p1', name: 'p', path: '/tmp/p', remote: { host: 'x', path: '/r' } }],
    config: { getConfig: () => ({ remoteDefaultPath: '~/work' }) },
    hostHub: {
      resolveHostId: (id: string) => id,
      ensureHostSessionReady: vi.fn(),
      callHostOnlineRpc: vi.fn(async (a: { command: { type: string } }) => {
        calls.push(a.command);
        if (a.command.type === 'provider.status') return { providers: [{ family: 'claude', installed: true, enabled: true }] };
        if (a.command.type === 'environment.provision') return { path: '/r/ws', isGitRepo: false, isWorktree: false };
        return {};
      })
    }
  } as never;
}

describe('createThreadFromRequest remote tool proxy launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.listExecutionHosts.mockReturnValue([{ id: 'h1', label: 'Local', kind: 'local', status: 'online' }]);
    m.resolveHarnessWorkspacePath.mockResolvedValue('/r/ws');
    m.remoteWorkspacePath.mockReturnValue('/r/ws');
    m.createEnvironment.mockReturnValue({ id: 'env1' });
    m.createThread.mockReturnValue({ id: 'th1', title: 't' });
    m.updateThreadStatus.mockImplementation((_db: unknown, _id: string, status: string) => ({ id: 'th1', status }));
  });

  it('passes the remote launch descriptor and keeps cwd/environment when the proxy is active', async () => {
    m.proxy.mockReturnValue(true);
    const calls: Array<{ type: string; [k: string]: unknown }> = [];
    await createThreadFromRequest(makeCtx(calls), { projectId: 'p1', providerId: 'claude', input: ['hi'], executionEnvironment: 'sandbox' });
    const start = calls.find((c) => c.type === 'thread.start')!;
    expect(start.remoteToolProxy).toBe(true);
    expect(start.remote).toBeTruthy();
    expect(start.environment).toBe('sandbox');
    expect(m.remoteWorkspacePath).toHaveBeenCalledWith(expect.anything(), true, '~/work', expect.any(Array));
    expect(m.listExecutionHosts).toHaveBeenCalled();
  });

  it('drops cwd/environment and the remote descriptor for remote projects without the proxy', async () => {
    m.proxy.mockReturnValue(false);
    const calls: Array<{ type: string; [k: string]: unknown }> = [];
    await createThreadFromRequest(makeCtx(calls), { projectId: 'p1', providerId: 'claude', input: ['hi'], executionEnvironment: 'sandbox' });
    const start = calls.find((c) => c.type === 'thread.start')!;
    expect(start.remoteToolProxy).toBeUndefined();
    expect(start.cwd).toBeUndefined();
    expect(start.environment).toBeUndefined();
  });
});
