import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETUP_TIMEOUT_MS } from '@zana-ai/zcc-domain';
import type { EnvironmentRow } from '@zana-ai/zcc-db';
import type { Project } from '@zana-ai/zcc-domain/product';
import { AmbiguousHostError, HostUnavailableError } from '../../http/host-hub.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ProductHttpContext } from '../../http/product-context.js';

const db = vi.hoisted(() => ({
  createEnvironment: vi.fn(),
  findProjectEnvironmentByHostPath: vi.fn(() => null),
  getEnvironment: vi.fn(),
  getPrimaryHost: vi.fn(() => ({ id: 'host-1' })),
  listHosts: vi.fn(() => []),
  updateEnvironmentDiscovery: vi.fn(),
  updateEnvironmentStatus: vi.fn()
}));

const remote = vi.hoisted(() => ({
  boundRemoteHostId: vi.fn(() => undefined as string | null | undefined),
  isRemoteToolProxyActive: vi.fn(() => false),
  resolveHarnessWorkspacePath: vi.fn(async () => '/tmp/demo')
}));

const claims = vi.hoisted(() => ({
  unmanagedAttachRefusal: vi.fn(() => null)
}));

const personal = vi.hoisted(() => ({
  resolvePersonalTargetPathOnHost: vi.fn(async () => '/tmp/personal/env-1')
}));

vi.mock('@zana-ai/zcc-db', () => db);

vi.mock('./remote-tool-proxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./remote-tool-proxy.js')>();
  return {
    ...actual,
    boundRemoteHostId: remote.boundRemoteHostId,
    isRemoteToolProxyActive: remote.isRemoteToolProxyActive,
    resolveHarnessWorkspacePath: remote.resolveHarnessWorkspacePath
  };
});

vi.mock('./workspace-path-claims.js', () => claims);

vi.mock('./host-personal-path.js', () => personal);

const { provisionCommandFor, provisionProjectEnvironment } = await import('./spawn-environment-provision.js');
const { REMOTE_HOST_DAEMON_REQUIRED } = await import('./remote-tool-proxy.js');

const project = { id: 'proj-1', name: 'Demo', path: '/tmp/demo' } as Project;
const reuseId = '11111111-1111-4111-8111-111111111111';

function env(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: 'env-1',
    projectId: 'proj-1',
    hostId: 'host-1',
    path: '/tmp/demo-wt',
    name: null,
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: 'managed-worktree',
    branchName: 'zcc/env-1',
    baseBranch: 'main',
    defaultBranch: 'main',
    mergeBaseBranch: 'main',
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  } as EnvironmentRow;
}

describe('provisionCommandFor', () => {
  it('builds a managed-worktree provision command', () => {
    expect(provisionCommandFor(
      env(),
      project,
      { kind: 'worktree' },
      undefined,
      '/tmp/demo'
    )).toEqual({
      type: 'environment.provision',
      environmentId: 'env-1',
      workspaceProvisionType: 'managed-worktree',
      sourcePath: '/tmp/demo',
      targetPath: '/tmp/demo-wt',
      branchName: 'zcc/env-1',
      baseBranch: 'main',
      setupTimeoutMs: DEFAULT_SETUP_TIMEOUT_MS
    });
  });

  it('synthesizes a managed branch name when the environment has none', () => {
    const command = provisionCommandFor(
      env({ branchName: null }),
      project,
      { kind: 'worktree' },
      undefined,
      '/tmp/demo'
    );
    expect(command.workspaceProvisionType).toBe('managed-worktree');
    expect(command.branchName).toMatch(/^zcc\//);
  });

  it('builds a personal provision command', () => {
    expect(provisionCommandFor(
      env({ path: '/tmp/personal/env-1', workspaceProvisionType: 'personal', branchName: null, baseBranch: null }),
      project,
      { kind: 'personal' },
      undefined,
      '/tmp/demo'
    )).toEqual({
      type: 'environment.provision',
      environmentId: 'env-1',
      workspaceProvisionType: 'personal',
      targetPath: '/tmp/personal/env-1'
    });
  });

  it('fails closed when a personal environment is missing its path', () => {
    expect(() => provisionCommandFor(
      env({ path: null, workspaceProvisionType: 'personal' }),
      project,
      { kind: 'personal' },
      undefined,
      '/tmp/demo'
    )).toThrow(ThreadCreateError);
  });

  it('builds an unmanaged attach command with optional checkout', () => {
    expect(provisionCommandFor(
      env({ workspaceProvisionType: 'unmanaged', path: '/tmp/demo' }),
      project,
      { kind: 'unmanaged' },
      { kind: 'existing', name: 'feature' },
      '/tmp/demo'
    )).toEqual({
      type: 'environment.provision',
      environmentId: 'env-1',
      workspaceProvisionType: 'unmanaged',
      path: '/tmp/demo',
      checkout: { kind: 'existing', name: 'feature' }
    });
  });
});

describe('provisionProjectEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.findProjectEnvironmentByHostPath.mockReturnValue(null);
    db.getPrimaryHost.mockReturnValue({ id: 'host-1' });
    remote.boundRemoteHostId.mockReturnValue(undefined);
    remote.isRemoteToolProxyActive.mockReturnValue(false);
    remote.resolveHarnessWorkspacePath.mockResolvedValue('/tmp/demo');
    claims.unmanagedAttachRefusal.mockReturnValue(null);
    personal.resolvePersonalTargetPathOnHost.mockResolvedValue('/tmp/personal/env-1');
  });

  function ctx(overrides: {
    projects?: Project[];
    rpc?: (input: { command: { type: string } }) => Promise<unknown>;
    resolveHostId?: (id?: string) => string;
  } = {}): ProductHttpContext {
    const projects = overrides.projects ?? [project];
    return {
      dataDir: '/tmp/zcc-data',
      db: {},
      toProjects: () => projects,
      config: { getConfig: () => ({}) },
      hostHub: {
        resolveHostId: overrides.resolveHostId ?? ((id?: string) => id ?? 'host-1'),
        ensureHostSessionReady: () => ({}),
        callHostOnlineRpc: overrides.rpc ?? (async (input: { command: { type: string; targetPath?: string } }) => {
          if (input.command.type === 'environment.provision') {
            return {
              path: input.command.targetPath ?? '/tmp/demo-wt',
              isGitRepo: true,
              isWorktree: true,
              branchName: 'zcc/env',
              defaultBranch: 'main'
            };
          }
          throw new Error(input.command.type);
        })
      }
    } as unknown as ProductHttpContext;
  }

  function expectCreateError(
    promise: Promise<unknown>,
    code: string,
    status: number
  ) {
    return expect(promise).rejects.toMatchObject({ code, status });
  }

  it('rejects an unknown project', async () => {
    await expectCreateError(provisionProjectEnvironment(ctx({ projects: [] }), {
      projectId: 'missing',
      choice: { kind: 'worktree' }
    }), 'unknown-project', 404);
  });

  it('rejects a project without a confined path', async () => {
    await expectCreateError(provisionProjectEnvironment(ctx({
      projects: [{ ...project, path: '' }]
    }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'cwd-escape', 403);
  });

  it('rejects a managed worktree on a remote project', async () => {
    await expectCreateError(provisionProjectEnvironment(ctx({
      projects: [{ ...project, remote: { host: 'box' } } as Project]
    }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'remote-unsupported', 403);
  });

  it('rejects a remote project that has no bound host daemon', async () => {
    remote.boundRemoteHostId.mockReturnValue(null);
    await expectCreateError(provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'unmanaged' }
    }), REMOTE_HOST_DAEMON_REQUIRED, 409);
  });

  it('rejects a remote-tool-proxy launch when no primary host is connected', async () => {
    remote.isRemoteToolProxyActive.mockReturnValue(true);
    db.getPrimaryHost.mockReturnValue(null);
    await expectCreateError(provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'host-unavailable', 503);
  });

  it('maps a disconnected host to host-unavailable', async () => {
    await expectCreateError(provisionProjectEnvironment(ctx({
      resolveHostId: () => { throw new HostUnavailableError(); }
    }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'host-unavailable', 503);
  });

  it('maps an ambiguous host to 409', async () => {
    await expectCreateError(provisionProjectEnvironment(ctx({
      resolveHostId: () => { throw new AmbiguousHostError(); }
    }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'ambiguous-host', 409);
  });

  it('maps a generic host error while resolving the workspace', async () => {
    await expectCreateError(provisionProjectEnvironment(ctx({
      resolveHostId: () => { throw new Error('boom'); }
    }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'workspace-provision-failed', 500);
  });

  it('refuses a foreign-host checkout that is not the project machine', async () => {
    await expectCreateError(provisionProjectEnvironment(ctx({
      projects: [{ ...project, hostId: 'other-host' }],
      resolveHostId: () => 'host-1'
    }), {
      projectId: 'proj-1',
      hostId: 'host-1',
      choice: { kind: 'worktree' }
    }), 'host-workspace-mismatch', 400);
  });

  it('refuses an unmanaged attach that another project already owns', async () => {
    claims.unmanagedAttachRefusal.mockReturnValue({
      reason: 'foreign-managed',
      message: 'Workspace path is a managed workspace owned by another project'
    });
    await expectCreateError(provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'unmanaged' }
    }), 'foreign-managed', 409);
  });

  it('provisions a new managed worktree without creating a thread', async () => {
    const created = env({ status: 'provisioning' });
    const ready = env({ status: 'ready' });
    db.createEnvironment.mockReturnValue(created);
    db.getEnvironment.mockReturnValue(ready);
    const result = await provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      hostId: 'host-1',
      choice: { kind: 'worktree', branchSlug: 'task' }
    });
    expect(result).toEqual(ready);
    expect(db.createEnvironment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: 'proj-1',
      hostId: 'host-1',
      workspaceProvisionType: 'managed-worktree',
      status: 'provisioning'
    }));
    expect(db.updateEnvironmentDiscovery).toHaveBeenCalled();
  });

  it('provisions a personal workspace on the host', async () => {
    const created = env({
      path: '/tmp/personal/env-1',
      workspaceProvisionType: 'personal',
      status: 'provisioning'
    });
    const ready = env({
      path: '/tmp/personal/env-1',
      workspaceProvisionType: 'personal',
      status: 'ready'
    });
    db.createEnvironment.mockReturnValue(created);
    db.getEnvironment.mockReturnValue(ready);
    const result = await provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'personal' }
    });
    expect(result).toEqual(ready);
    expect(personal.resolvePersonalTargetPathOnHost).toHaveBeenCalled();
    expect(db.createEnvironment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceProvisionType: 'personal',
      path: '/tmp/personal/env-1'
    }));
  });

  it('maps a personal path failure through the host error mapper', async () => {
    personal.resolvePersonalTargetPathOnHost.mockRejectedValue(
      Object.assign(new Error('missing clone default'), { code: 'path_not_found' })
    );
    await expectCreateError(provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'personal' }
    }), 'path_not_found', 400);
  });

  it('reuses a ready environment without re-attaching', async () => {
    const ready = env({ status: 'ready', workspaceProvisionType: 'managed-worktree' });
    db.getEnvironment.mockReturnValue(ready);
    const rpc = vi.fn();
    const result = await provisionProjectEnvironment(ctx({ rpc }), {
      projectId: 'proj-1',
      hostId: 'host-1',
      choice: { kind: 'reuse', environmentId: reuseId }
    });
    expect(result).toEqual(ready);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects reuse of an environment from another project', async () => {
    db.getEnvironment.mockReturnValue(env({ projectId: 'other' }));
    await expectCreateError(provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'reuse', environmentId: reuseId }
    }), 'unknown-environment', 404);
  });

  it('rejects reuse of a managed environment that is not ready', async () => {
    db.getEnvironment.mockReturnValue(env({ status: 'provisioning' }));
    await expectCreateError(provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'reuse', environmentId: reuseId }
    }), 'environment_not_ready', 409);
  });

  it('re-attaches a not-ready unmanaged environment on reuse', async () => {
    const existing = env({
      workspaceProvisionType: 'unmanaged',
      status: 'provisioning',
      path: null
    });
    const ready = env({ workspaceProvisionType: 'unmanaged', status: 'ready', path: '/tmp/demo' });
    db.getEnvironment.mockReturnValueOnce(existing).mockReturnValueOnce(ready);
    const result = await provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'reuse', environmentId: reuseId }
    });
    expect(result).toEqual(ready);
    expect(db.updateEnvironmentDiscovery).toHaveBeenCalled();
  });

  it('promotes an existing unmanaged row into reuse and re-attaches', async () => {
    const existing = env({ workspaceProvisionType: 'unmanaged', path: '/tmp/demo' });
    db.findProjectEnvironmentByHostPath.mockReturnValue(existing);
    db.getEnvironment.mockReturnValue(existing);
    const result = await provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'unmanaged' }
    });
    expect(result).toEqual(existing);
    expect(db.updateEnvironmentDiscovery).toHaveBeenCalled();
  });

  it('creates a fresh unmanaged environment when none exists at the path', async () => {
    const created = env({ workspaceProvisionType: 'unmanaged', status: 'provisioning', path: '/tmp/demo' });
    const ready = env({ workspaceProvisionType: 'unmanaged', status: 'ready', path: '/tmp/demo' });
    db.createEnvironment.mockReturnValue(created);
    db.getEnvironment.mockReturnValue(ready);
    const result = await provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'unmanaged' },
      checkout: { kind: 'existing', name: 'feature' }
    });
    expect(result).toEqual(ready);
    expect(db.createEnvironment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceProvisionType: 'unmanaged'
    }));
  });

  it('fails closed when provision returns no path', async () => {
    db.createEnvironment.mockReturnValue(env({ status: 'provisioning' }));
    db.getEnvironment.mockReturnValue(env({ path: null, status: 'ready' }));
    await expectCreateError(provisionProjectEnvironment(ctx(), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'workspace-provision-failed', 500);
    expect(db.updateEnvironmentStatus).toHaveBeenCalledWith(expect.anything(), 'env-1', 'failed');
  });

  it('maps provider_unavailable from the host attach', async () => {
    db.createEnvironment.mockReturnValue(env({ status: 'provisioning' }));
    await expectCreateError(provisionProjectEnvironment(ctx({
      rpc: async () => {
        throw Object.assign(new Error('no plugin'), { code: 'provider_unavailable' });
      }
    }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'provider_unavailable', 503);
    expect(db.updateEnvironmentStatus).toHaveBeenCalledWith(expect.anything(), 'env-1', 'failed');
  });

  it('maps cwd-escape from the host attach', async () => {
    db.createEnvironment.mockReturnValue(env({ status: 'provisioning' }));
    await expectCreateError(provisionProjectEnvironment(ctx({
      rpc: async () => {
        throw Object.assign(new Error('escaped'), { code: 'cwd-escape' });
      }
    }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'cwd-escape', 403);
  });

  it('maps an unknown host code to a 502', async () => {
    db.createEnvironment.mockReturnValue(env({ status: 'provisioning' }));
    await expectCreateError(provisionProjectEnvironment(ctx({
      rpc: async () => {
        throw Object.assign(new Error('plugin exploded'), { code: 'weird' });
      }
    }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    }), 'weird', 502);
  });

  it('uses the bound remote host when one is present', async () => {
    remote.boundRemoteHostId.mockReturnValue('remote-host');
    const created = env({ hostId: 'remote-host', status: 'provisioning' });
    const ready = env({ hostId: 'remote-host', status: 'ready' });
    db.createEnvironment.mockReturnValue(created);
    db.getEnvironment.mockReturnValue(ready);
    const resolveHostId = vi.fn((id?: string) => id ?? 'host-1');
    const result = await provisionProjectEnvironment(ctx({
      projects: [{ ...project, remote: { host: 'box' } } as Project],
      resolveHostId
    }), {
      projectId: 'proj-1',
      choice: { kind: 'unmanaged' }
    });
    expect(result).toEqual(ready);
    expect(resolveHostId).toHaveBeenCalledWith('remote-host');
  });

  it('uses the primary host when the remote-tool-proxy path is active', async () => {
    remote.isRemoteToolProxyActive.mockReturnValue(true);
    db.getPrimaryHost.mockReturnValue({ id: 'primary-host' });
    const created = env({ hostId: 'primary-host', status: 'provisioning' });
    const ready = env({ hostId: 'primary-host', status: 'ready' });
    db.createEnvironment.mockReturnValue(created);
    db.getEnvironment.mockReturnValue(ready);
    const resolveHostId = vi.fn((id?: string) => id ?? 'host-1');
    const result = await provisionProjectEnvironment(ctx({ resolveHostId }), {
      projectId: 'proj-1',
      choice: { kind: 'worktree' }
    });
    expect(result).toEqual(ready);
    expect(resolveHostId).toHaveBeenCalledWith('primary-host');
  });
});
