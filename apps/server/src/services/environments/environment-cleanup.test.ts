import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveThread, destroyEnvironment, destroyEnvironmentIfIdle } from './environment-cleanup.js';
import type { ProductHttpContext, ProductTerminalRecord } from '../../http/product-context.js';
import {
  getThread,
  updateThreadStatus,
  getEnvironment,
  countLiveThreadsForEnvironment,
  updateEnvironmentStatus
} from '@zana-ai/zcc-db';

vi.mock('@zana-ai/zcc-db', () => ({
  getThread: vi.fn(),
  updateThreadStatus: vi.fn(),
  countLiveThreadsForEnvironment: vi.fn(() => 0),
  getEnvironment: vi.fn(() => null),
  updateEnvironmentStatus: vi.fn()
}));

const thread = {
  id: 'thr-1',
  projectId: 'proj-1',
  hostId: 'host-1',
  environmentId: 'env-1',
  providerId: 'claude',
  status: 'running' as const,
  title: 'Hello',
  createdAt: 1,
  updatedAt: 1
};

beforeEach(() => {
  vi.mocked(getThread).mockReset();
  vi.mocked(updateThreadStatus).mockReset();
  vi.mocked(getEnvironment).mockReset();
  vi.mocked(countLiveThreadsForEnvironment).mockReset();
  vi.mocked(updateEnvironmentStatus).mockReset();
  vi.mocked(countLiveThreadsForEnvironment).mockReturnValue(0);
});

describe('archiveThread', () => {
  it('marks the thread completed before stop, even when the host throws', async () => {
    const order: string[] = [];
    vi.mocked(getThread).mockReturnValue(thread);
    vi.mocked(updateThreadStatus).mockImplementation((_db, id, status) => {
      order.push('complete');
      return { ...thread, id, status };
    });
    const emit = vi.fn();
    const callHostOnlineRpc = vi.fn(async () => {
      order.push('stop');
      throw new Error('host down');
    });
    const ctx = {
      db: {},
      hub: { emit },
      hostHub: { callHostOnlineRpc },
      pendingInteractions: {
        interruptPendingInteractionsForThreadIds: vi.fn(() => [])
      }
    } as unknown as ProductHttpContext;

    expect(await archiveThread(ctx, thread.id)).toBe(true);
    expect(order).toEqual(['complete', 'stop']);
    expect(updateThreadStatus).toHaveBeenCalledWith(ctx.db, thread.id, 'completed');
    expect(emit).toHaveBeenCalledWith(
      'threads:updated',
      expect.objectContaining({ id: thread.id, status: 'completed' })
    );
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: thread.hostId,
      command: { type: 'thread.stop', threadId: thread.id }
    });
  });

  it('returns false for an unknown thread without calling the host', async () => {
    vi.mocked(getThread).mockReturnValue(null);
    const callHostOnlineRpc = vi.fn();
    const ctx = {
      db: {},
      hub: { emit: vi.fn() },
      hostHub: { callHostOnlineRpc },
      pendingInteractions: {
        interruptPendingInteractionsForThreadIds: vi.fn(() => [])
      }
    } as unknown as ProductHttpContext;

    expect(await archiveThread(ctx, 'missing')).toBe(false);
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
    expect(updateThreadStatus).not.toHaveBeenCalled();
  });
});

describe('destroyEnvironment', () => {
  const environment = {
    id: 'env-1',
    projectId: 'proj-1',
    hostId: 'host-1',
    path: '/tmp/worktree',
    managed: true,
    status: 'ready' as const,
    workspaceProvisionType: 'managed-worktree' as const
  };

  it('stops product terminals whose cwd sits under a disposable workspace, then destroys', async () => {
    vi.mocked(getEnvironment).mockReturnValue(environment as never);
    vi.mocked(countLiveThreadsForEnvironment).mockReturnValue(0);
    const inside: ProductTerminalRecord = {
      id: 'term-in',
      projectId: 'proj-1',
      title: 'dev',
      profile: 'shell',
      cwd: '/tmp/worktree/app',
      status: 'running',
      createdAt: 1,
      hostId: 'host-1'
    };
    const outside: ProductTerminalRecord = {
      id: 'term-out',
      projectId: 'proj-1',
      title: 'other',
      profile: 'shell',
      cwd: '/tmp/other',
      status: 'running',
      createdAt: 1,
      hostId: 'host-1'
    };
    const callHostOnlineRpc = vi.fn(async () => ({ destroyed: true }));
    const emit = vi.fn();
    const ctx = {
      db: {},
      hub: { emit },
      hostHub: { callHostOnlineRpc },
      terminalSessions: new Map([
        [inside.id, inside],
        [outside.id, outside]
      ])
    } as unknown as ProductHttpContext;

    await destroyEnvironment(ctx, environment.id);
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: { type: 'terminal.stop', sessionId: inside.id }
    });
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: {
        type: 'environment.destroy',
        environmentId: environment.id,
        workspacePath: environment.path,
        workspaceProvisionType: 'managed-worktree'
      }
    });
    expect(inside.status).toBe('exited');
    expect(outside.status).toBe('running');
  });

  it('does not sweep terminals or processes for an unmanaged checkout', async () => {
    vi.mocked(getEnvironment).mockReturnValue({
      ...environment,
      managed: false,
      workspaceProvisionType: 'unmanaged'
    } as never);
    const callHostOnlineRpc = vi.fn();
    const session: ProductTerminalRecord = {
      id: 'term-in',
      projectId: 'proj-1',
      title: 'dev',
      profile: 'shell',
      cwd: '/tmp/worktree',
      status: 'running',
      createdAt: 1,
      hostId: 'host-1'
    };
    const ctx = {
      db: {},
      hub: { emit: vi.fn() },
      hostHub: { callHostOnlineRpc },
      terminalSessions: new Map([[session.id, session]])
    } as unknown as ProductHttpContext;

    await destroyEnvironment(ctx, environment.id);
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(updateEnvironmentStatus).toHaveBeenCalledWith(ctx.db, environment.id, 'destroyed');
  });

  it('refuses to destroy while a live CLI Agent occupies the environment', async () => {
    vi.mocked(getEnvironment).mockReturnValue(environment as never);
    vi.mocked(countLiveThreadsForEnvironment).mockReturnValue(0);
    const session: ProductTerminalRecord = {
      id: 'cli-1',
      projectId: 'proj-1',
      title: 'inspect the checkout',
      profile: 'claude',
      cwd: '/tmp/worktree',
      status: 'running',
      createdAt: 1,
      hostId: 'host-1',
      workspaceEnvironmentId: environment.id
    };
    const callHostOnlineRpc = vi.fn();
    const ctx = {
      db: {},
      hub: { emit: vi.fn() },
      hostHub: { callHostOnlineRpc },
      terminalSessions: new Map([[session.id, session]])
    } as unknown as ProductHttpContext;

    await expect(destroyEnvironment(ctx, environment.id)).rejects.toMatchObject({
      code: 'environment_in_use'
    });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
    await destroyEnvironmentIfIdle(ctx, environment.id);
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });
});
