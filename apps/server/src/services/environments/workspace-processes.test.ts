import { describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import {
  killWorkspaceProcesses,
  listWorkspaceProcesses,
  parseKillPids
} from './workspace-processes.js';
import { getEnvironment } from '@zana-ai/zcc-db';

vi.mock('@zana-ai/zcc-db', () => ({
  getEnvironment: vi.fn()
}));

function ctx(overrides?: Partial<ProductHttpContext> & {
  projects?: Array<{ id: string; path?: string; hostId?: string }>;
  rpc?: ReturnType<typeof vi.fn>;
}): ProductHttpContext {
  const rpc = overrides?.rpc ?? vi.fn(async () => ({ processes: [], truncated: false, supported: true }));
  return {
    toProjects: () => overrides?.projects ?? [],
    hostHub: {
      resolveHostId: (hostId?: string) => hostId ?? 'host-1',
      callHostOnlineRpc: rpc
    }
  } as unknown as ProductHttpContext;
}

describe('workspace process inspector', () => {
  it('lists processes for a registered project path', async () => {
    const rpc = vi.fn(async () => ({
      processes: [{ pid: 9, cwd: '/tmp/proj', command: 'vite' }],
      truncated: false,
      supported: true
    }));
    const result = await listWorkspaceProcesses(
      ctx({ projects: [{ id: 'proj-1', path: '/tmp/proj', hostId: 'host-1' }], rpc }),
      { kind: 'project', projectId: 'proj-1' }
    );
    expect(result.processes[0]?.command).toBe('vite');
    expect(rpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: {
        type: 'workspace.processes.list',
        workspacePath: '/tmp/proj',
        workspaceProvisionType: 'unmanaged'
      }
    });
  });

  it('404s an unknown project without calling the host', async () => {
    const rpc = vi.fn();
    await expect(
      listWorkspaceProcesses(ctx({ rpc }), { kind: 'project', projectId: 'missing' })
    ).rejects.toMatchObject({ status: 404, code: 'unknown-project' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('kills only the requested pids on a ready environment', async () => {
    vi.mocked(getEnvironment).mockReturnValue({
      id: 'env-1',
      hostId: 'host-9',
      path: '/tmp/worktree',
      status: 'ready',
      workspaceProvisionType: 'managed-worktree'
    } as never);
    const rpc = vi.fn(async () => ({ killed: [{ pid: 42, cwd: '/tmp/worktree', command: 'sleep' }] }));
    const result = await killWorkspaceProcesses(
      ctx({ rpc }),
      { kind: 'environment', environmentId: 'env-1' },
      { pids: [42] }
    );
    expect(result.killed[0]?.pid).toBe(42);
    expect(rpc).toHaveBeenCalledWith({
      hostId: 'host-9',
      command: {
        type: 'workspace.processes.kill',
        workspacePath: '/tmp/worktree',
        workspaceProvisionType: 'managed-worktree',
        pids: [42]
      }
    });
  });

  it('rejects an implicit kill-all', () => {
    expect(() => parseKillPids({})).toThrow(ThreadCreateError);
    expect(() => parseKillPids({ pids: [] })).toThrow(ThreadCreateError);
  });
});
