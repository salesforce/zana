import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listExecutionHosts: vi.fn(),
  listHosts: vi.fn(),
  getPrimaryHost: vi.fn(),
  resolveHarnessWorkspacePath: vi.fn()
}));

vi.mock('@zana-ai/zcc-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-db')>()),
  listExecutionHosts: mocks.listExecutionHosts,
  listHosts: mocks.listHosts,
  getPrimaryHost: mocks.getPrimaryHost
}));
vi.mock('../services/threads/remote-tool-proxy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/threads/remote-tool-proxy.js')>()),
  resolveHarnessWorkspacePath: mocks.resolveHarnessWorkspacePath
}));

import { createThreadFromRequest, ThreadCreateError } from './thread-create.js';

function makeCtx() {
  return {
    db: {},
    toProjects: () => [{ id: 'p1', name: 'p', path: '/tmp/p' }],
    config: { getConfig: () => ({ remoteDefaultPath: '~/work' }) },
    hostHub: {
      resolveHostId: (id: string) => id,
      ensureHostSessionReady: vi.fn(),
      callHostOnlineRpc: vi.fn(async () => ({ directory: '/home/u' }))
    }
  } as never;
}

describe('createThreadFromRequest host listing for workspace resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrimaryHost.mockReturnValue({ id: 'h1' });
  });

  it('feeds execution hosts (not all hosts) to the workspace resolver and probes the host home', async () => {
    mocks.listExecutionHosts.mockReturnValue([
      { id: 'h1', label: 'Local', kind: 'local', status: 'online' }
    ]);
    mocks.resolveHarnessWorkspacePath.mockImplementation(async (args: { hosts: unknown[]; remoteDefaultPath: string; probeHostHome: () => Promise<string> }) => {
      expect(await args.probeHostHome()).toBe('/home/u');
      throw new Error('stop-after-resolve');
    });
    const ctx = makeCtx();
    await expect(
      createThreadFromRequest(ctx, { projectId: 'p1', providerId: 'claude', input: [] })
    ).rejects.toBeInstanceOf(ThreadCreateError);
    expect(mocks.listExecutionHosts).toHaveBeenCalledTimes(1);
    expect(mocks.listHosts).not.toHaveBeenCalled();
    const args = mocks.resolveHarnessWorkspacePath.mock.calls[0]![0] as { hosts: unknown[]; remoteDefaultPath: string };
    expect(args.hosts).toHaveLength(1);
    expect(args.remoteDefaultPath).toBe('~/work');
  });
});

describe('createThreadFromRequest remote tool proxy launch', () => {
  it('passes execution hosts into remoteWorkspacePath when starting the thread', async () => {
    vi.resetModules();
    const remoteWorkspacePath = vi.fn(() => '/remote/ws');
    const threadLaunchRemote = vi.fn(() => ({ host: 'r' }));
    const listExecutionHosts = vi.fn(() => [{ id: 'h1', label: 'Local', kind: 'local', status: 'online' }]);
    vi.doMock('@zana-ai/zcc-db', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@zana-ai/zcc-db')>()),
      listExecutionHosts,
      getPrimaryHost: () => ({ id: 'h1' }),
      createEnvironment: (_db: unknown, row: Record<string, unknown>) => row,
      createThread: (_db: unknown, row: Record<string, unknown>) => ({ ...row, id: 't1' }),
      getEnvironment: () => null,
      updateEnvironmentDiscovery: vi.fn(),
      updateEnvironmentStatus: vi.fn(),
      updateThreadStatus: (_db: unknown, id: string, status: string) => ({ id, status })
    }));
    vi.doMock('../services/threads/remote-tool-proxy.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../services/threads/remote-tool-proxy.js')>()),
      isRemoteToolProxyActive: () => true,
      resolveHarnessWorkspacePath: async () => '/remote/ws',
      remoteWorkspacePath,
      threadLaunchRemote
    }));
    vi.doMock('../services/threads/spawn-choice-for-host.js', () => ({
      resolveSpawnChoiceForHost: () => ({ ok: true, choice: { kind: 'unmanaged' }, dropCwd: false })
    }));
    vi.doMock('../services/threads/workspace-path-claims.js', () => ({ unmanagedAttachRefusal: () => null }));
    vi.doMock('../services/threads/spawn-environment-provision.js', () => ({ provisionCommandFor: () => ({ type: 'environment.provision' }) }));
    const { createThreadFromRequest: create } = await import('./thread-create.js');
    const calls: Array<{ command: { type: string; remoteToolProxy?: boolean } }> = [];
    const emit = vi.fn();
    const ctx = {
      db: { transaction: (fn: () => unknown) => fn() },
      dataDir: '/tmp',
      hub: { emit },
      toProjects: () => [{ id: 'p1', name: 'p', path: '/tmp/p' }],
      config: { getConfig: () => ({ remoteDefaultPath: '~/work' }) },
      hostHub: {
        resolveHostId: (id: string) => id,
        ensureHostSessionReady: vi.fn(),
        callHostOnlineRpc: vi.fn(async (call: { command: { type: string } }) => {
          calls.push(call);
          if (call.command.type === 'provider.status') {
            return { providers: [{ family: 'claude', installed: true, enabled: true }] };
          }
          if (call.command.type === 'environment.provision') return { path: '/remote/ws', isGitRepo: false, isWorktree: false };
          return {};
        })
      }
    } as never;

    const result = await create(ctx, { projectId: 'p1', providerId: 'claude', input: ['hi'] });
    expect(result).toMatchObject({ status: 'running' });
    expect(remoteWorkspacePath).toHaveBeenCalledTimes(1);
    expect(remoteWorkspacePath.mock.calls[0]![3]).toHaveLength(1);
    expect(listExecutionHosts).toHaveBeenCalled();
    expect(calls.find((c) => c.command.type === 'thread.start')?.command.remoteToolProxy).toBe(true);
    expect(emit).toHaveBeenCalledWith('threads:updated', expect.anything());
  });
});
