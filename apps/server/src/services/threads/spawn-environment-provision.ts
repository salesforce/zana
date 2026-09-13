import {
  createEnvironment,
  findProjectEnvironmentByHostPath,
  getEnvironment,
  getPrimaryHost,
  listHosts,
  updateEnvironmentDiscovery,
  updateEnvironmentStatus,
  type EnvironmentRow
} from '@zana-ai/zcc-db';
import {
  DEFAULT_SETUP_TIMEOUT_MS,
  buildManagedBranchName,
  type SpawnEnvironmentChoice
} from '@zana-ai/zcc-domain';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { EnvironmentProvisionCommand, EnvironmentProvisionResult } from '@zana-ai/zcc-contracts/host-rpc';
import { AmbiguousHostError, HostUnavailableError } from '../../http/host-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { unmanagedAttachRefusal } from './workspace-path-claims.js';
import { resolveManagedTargetPath } from './worktree-paths.js';
import { resolvePersonalTargetPathOnHost } from './host-personal-path.js';
import {
  boundRemoteHostId,
  isRemoteToolProxyActive,
  resolveHarnessWorkspacePath,
  REMOTE_HOST_DAEMON_REQUIRED,
  REMOTE_HOST_DAEMON_REQUIRED_MESSAGE
} from './remote-tool-proxy.js';
import { resolveSpawnChoiceForHost } from './spawn-choice-for-host.js';
import { toRemoteStartPathHost } from '../hosts/host-public.js';

export type SpawnCheckout =
  | { kind: 'existing'; name: string }
  | { kind: 'new'; name: string; baseBranch: string };

export function provisionCommandFor(
  environment: EnvironmentRow,
  project: Project,
  choice: SpawnEnvironmentChoice,
  checkout: SpawnCheckout | undefined,
  workspacePath: string
): EnvironmentProvisionCommand {
  if (choice.kind === 'personal') {
    if (!environment.path) {
      throw new ThreadCreateError(500, 'thread-create-failed', 'personal workspace path is missing');
    }
    return {
      type: 'environment.provision',
      environmentId: environment.id,
      workspaceProvisionType: 'personal',
      targetPath: environment.path
    };
  }
  if (choice.kind === 'worktree') {
    return {
      type: 'environment.provision',
      environmentId: environment.id,
      workspaceProvisionType: 'managed-worktree',
      sourcePath: project.path,
      targetPath: environment.path!,
      branchName: environment.branchName ?? buildManagedBranchName({ threadId: environment.id }),
      baseBranch: environment.baseBranch,
      setupTimeoutMs: DEFAULT_SETUP_TIMEOUT_MS
    };
  }
  return {
    type: 'environment.provision',
    environmentId: environment.id,
    workspaceProvisionType: 'unmanaged',
    path: workspacePath,
    checkout
  };
}

function mapHostError(error: unknown): ThreadCreateError {
  if (error instanceof HostUnavailableError) {
    return new ThreadCreateError(503, 'host-unavailable', error.message);
  }
  if (error instanceof AmbiguousHostError) {
    return new ThreadCreateError(409, 'ambiguous-host', error.message);
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: string }).code);
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'path_not_found') return new ThreadCreateError(400, code, message);
    if (code === 'provider_unavailable') return new ThreadCreateError(503, code, message);
    if (code === 'cwd-escape') return new ThreadCreateError(403, code, message);
    return new ThreadCreateError(502, code, message);
  }
  return new ThreadCreateError(500, 'workspace-provision-failed', error instanceof Error ? error.message : String(error));
}

function requireProject(ctx: ProductHttpContext, projectId: string): Project {
  const project = ctx.toProjects().find((row) => row.id === projectId);
  if (!project) {
    throw new ThreadCreateError(404, 'unknown-project', 'project is not registered');
  }
  if (!project.path || project.path.length === 0) {
    throw new ThreadCreateError(403, 'cwd-escape', 'project path is not a confined directory');
  }
  return project;
}

async function attachEnvironmentOnHost(
  ctx: ProductHttpContext,
  args: {
    hostId: string;
    project: Project;
    environment: EnvironmentRow;
    choice: SpawnEnvironmentChoice;
    checkout?: SpawnCheckout;
    workspacePath: string;
  }
): Promise<EnvironmentRow> {
  try {
    const provisioned = await ctx.hostHub.callHostOnlineRpc<EnvironmentProvisionResult>({
      hostId: args.hostId,
      command: {
        ...provisionCommandFor(args.environment, args.project, args.choice, args.checkout, args.workspacePath),
        initiator: null
      }
    });
    updateEnvironmentDiscovery(ctx.db, args.environment.id, {
      status: 'ready',
      path: provisioned.path,
      isGitRepo: provisioned.isGitRepo,
      isWorktree: provisioned.isWorktree,
      branchName: provisioned.branchName,
      defaultBranch: provisioned.defaultBranch,
      mergeBaseBranch: provisioned.defaultBranch
    });
    const ready = getEnvironment(ctx.db, args.environment.id);
    if (!ready?.path) {
      throw new ThreadCreateError(500, 'workspace-provision-failed', 'environment path is missing after provision');
    }
    return ready;
  } catch (error) {
    updateEnvironmentStatus(ctx.db, args.environment.id, 'failed');
    if (error instanceof ThreadCreateError) throw error;
    throw mapHostError(error);
  }
}

/**
 * Provision a managed worktree / personal / reuse environment without creating
 * a product Thread. CLI Agent launches use this so they stay on terminals.create.
 */
export async function provisionProjectEnvironment(
  ctx: ProductHttpContext,
  input: {
    projectId: string;
    hostId?: string;
    choice: SpawnEnvironmentChoice;
    checkout?: SpawnCheckout;
  }
): Promise<EnvironmentRow> {
  const project = requireProject(ctx, input.projectId);
  if (project.remote && input.choice.kind !== 'unmanaged') {
    throw new ThreadCreateError(403, 'remote-unsupported', 'remote projects can only use this checkout');
  }
  const boundRemote = boundRemoteHostId(project);
  if (boundRemote === null) {
    throw new ThreadCreateError(409, REMOTE_HOST_DAEMON_REQUIRED, REMOTE_HOST_DAEMON_REQUIRED_MESSAGE);
  }
  const remoteToolProxy = isRemoteToolProxyActive(project, boundRemote ?? input.hostId);
  const primary = getPrimaryHost(ctx.db);
  let hostId: string;
  let workspacePath: string;
  try {
    if (boundRemote) {
      hostId = ctx.hostHub.resolveHostId(boundRemote);
    } else if (remoteToolProxy) {
      if (!primary) {
        throw new ThreadCreateError(503, 'host-unavailable', 'This machine’s host daemon is not connected.');
      }
      hostId = ctx.hostHub.resolveHostId(primary.id);
    } else {
      hostId = ctx.hostHub.resolveHostId(input.hostId ?? project.hostId);
    }
    ctx.hostHub.ensureHostSessionReady(hostId);
    workspacePath = await resolveHarnessWorkspacePath({
      project,
      remoteToolProxy,
      remoteDefaultPath: ctx.config.getConfig().remoteDefaultPath,
      hosts: listHosts(ctx.db).map(toRemoteStartPathHost),
      probeHostHome: async () => {
        const listing = await ctx.hostHub.callHostOnlineRpc<{ directory: string }>({
          hostId,
          command: { type: 'host.browse_directory' }
        });
        return listing.directory;
      }
    });
  } catch (error) {
    if (error instanceof ThreadCreateError) throw error;
    throw mapHostError(error);
  }

  const spawnChoice = resolveSpawnChoiceForHost({
    project,
    choice: input.choice,
    executionHostId: hostId,
    primaryHostId: primary?.id,
    remoteToolProxy
  });
  if (!spawnChoice.ok) {
    throw new ThreadCreateError(400, spawnChoice.code, spawnChoice.message);
  }
  let choice = spawnChoice.choice;

  if (choice.kind === 'unmanaged' || input.checkout) {
    const refusal = unmanagedAttachRefusal(ctx.db, {
      dataDir: ctx.dataDir,
      checksOutBranch: Boolean(input.checkout),
      hostId,
      path: workspacePath,
      projectId: project.id
    });
    if (refusal) {
      throw new ThreadCreateError(409, refusal.reason, refusal.message);
    }
  }

  if (choice.kind === 'unmanaged') {
    const existingUnmanaged = findProjectEnvironmentByHostPath(ctx.db, project.id, hostId, workspacePath);
    if (existingUnmanaged) {
      choice = { kind: 'reuse', environmentId: existingUnmanaged.id };
    }
  }

  if (choice.kind === 'reuse') {
    const existing = getEnvironment(ctx.db, choice.environmentId);
    if (!existing || existing.projectId !== project.id || existing.hostId !== hostId) {
      throw new ThreadCreateError(404, 'unknown-environment', 'environment is not available');
    }
    const canReuseReady = existing.status === 'ready' && Boolean(existing.path);
    if (!canReuseReady && existing.workspaceProvisionType !== 'unmanaged') {
      throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not ready');
    }
    const needsHostAttach = !canReuseReady || existing.workspaceProvisionType === 'unmanaged';
    if (!needsHostAttach) return existing;
    return attachEnvironmentOnHost(ctx, {
      hostId,
      project,
      environment: existing,
      choice: { kind: 'unmanaged' },
      checkout: input.checkout,
      workspacePath
    });
  }

  const environmentId = crypto.randomUUID();
  let personalPath: string | undefined;
  if (choice.kind === 'personal') {
    try {
      personalPath = await resolvePersonalTargetPathOnHost(ctx, hostId, environmentId);
    } catch (error) {
      throw mapHostError(error);
    }
  }
  const path = choice.kind === 'worktree'
    ? resolveManagedTargetPath({ dataDir: ctx.dataDir, environmentId, sourcePath: project.path })
    : choice.kind === 'personal'
      ? personalPath!
      : workspacePath;
  const environment = createEnvironment(ctx.db, {
    id: environmentId,
    projectId: project.id,
    hostId,
    path,
    workspaceProvisionType: choice.kind === 'worktree' ? 'managed-worktree' : choice.kind === 'personal' ? 'personal' : 'unmanaged',
    branchName: choice.kind === 'worktree'
      ? buildManagedBranchName({ threadId: environmentId, branchSlug: choice.branchSlug })
      : null,
    baseBranch: choice.kind === 'worktree' ? choice.baseBranch ?? null : null,
    status: 'provisioning'
  });
  return attachEnvironmentOnHost(ctx, {
    hostId,
    project,
    environment,
    choice,
    checkout: input.checkout,
    workspacePath
  });
}
