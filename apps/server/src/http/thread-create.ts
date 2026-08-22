import type {
  EnvironmentProvisionCommand,
  EnvironmentProvisionResult,
  ProviderStatusResult,
  ThreadStartResult
} from '@zana-ai/zcc-contracts/host-rpc';
import {
  createEnvironment,
  createThread,
  getEnvironment,
  getThread,
  updateEnvironmentDiscovery,
  updateEnvironmentStatus,
  updateThreadStatus,
  type EnvironmentRow,
  type ThreadRow
} from '@zana-ai/zcc-db';
import {
  DEFAULT_SETUP_TIMEOUT_MS,
  buildManagedBranchName,
  type SpawnEnvironmentChoice
} from '@zana-ai/zcc-domain';
import type { Project } from '@zana-ai/zcc-domain/product';
import { harnessFamilyOf, parseProfile } from '@zana-ai/zcc-domain/launch-provider';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';
import type { ProductHttpContext } from './product-context.js';
import { unmanagedAttachRefusal } from '../services/threads/workspace-path-claims.js';
import { resolveManagedTargetPath, resolvePersonalTargetPath } from '../services/threads/worktree-paths.js';

export interface SpawnThreadInput {
  projectId: string;
  providerId: string;
  input: string[];
  hostId?: string;
  environment?: SpawnEnvironmentChoice;
  checkout?: { kind: 'existing'; name: string } | { kind: 'new'; name: string; baseBranch: string };
}

export class ThreadCreateError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ThreadCreateError';
  }
}

function requireLocalProject(ctx: ProductHttpContext, projectId: string): Project {
  const project = ctx.toProjects().find((row) => row.id === projectId);
  if (!project) {
    throw new ThreadCreateError(404, 'unknown-project', 'project is not registered');
  }
  if (project.remote) {
    throw new ThreadCreateError(403, 'remote-unsupported', 'remote projects cannot spawn loopback threads');
  }
  if (!project.path || project.path.length === 0) {
    throw new ThreadCreateError(403, 'cwd-escape', 'project path is not a confined directory');
  }
  return project;
}

export function resolveProviderFamily(providerId: string): ReturnType<typeof harnessFamilyOf> {
  const profile = parseProfile(providerId);
  return profile ? harnessFamilyOf(profile) : null;
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
    return new ThreadCreateError(502, code, message);
  }
  return new ThreadCreateError(500, 'thread-create-failed', error instanceof Error ? error.message : String(error));
}

function provisionCommandFor(
  environment: EnvironmentRow,
  project: Project,
  choice: SpawnEnvironmentChoice,
  checkout: SpawnThreadInput['checkout']
): EnvironmentProvisionCommand {
  if (choice.kind === 'personal') {
    return {
      type: 'environment.provision',
      environmentId: environment.id,
      workspaceProvisionType: 'personal',
      targetPath: environment.path ?? resolvePersonalTargetPath({ dataDir: '', environmentId: environment.id })
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
    path: project.path,
    checkout
  };
}

export async function createThreadFromRequest(
  ctx: ProductHttpContext,
  input: SpawnThreadInput
): Promise<ThreadRow> {
  if (!input.projectId) {
    throw new ThreadCreateError(400, 'invalid-project', 'projectId is required');
  }
  if (!input.providerId) {
    throw new ThreadCreateError(400, 'invalid-provider', 'providerId is required');
  }
  const prompt = input.input.map((part) => part.trim()).filter((part) => part.length > 0);
  if (prompt.length === 0) {
    throw new ThreadCreateError(400, 'invalid-input', 'input is required');
  }

  const project = requireLocalProject(ctx, input.projectId);
  let hostId: string;
  try {
    hostId = ctx.hostHub.resolveHostId(input.hostId);
    ctx.hostHub.ensureHostSessionReady(hostId);
  } catch (error) {
    throw mapHostError(error);
  }

  const choice: SpawnEnvironmentChoice = input.environment ?? { kind: 'unmanaged' };
  if (choice.kind === 'unmanaged' || input.checkout) {
    const refusal = unmanagedAttachRefusal(ctx.db, {
      dataDir: ctx.dataDir,
      checksOutBranch: Boolean(input.checkout),
      hostId,
      path: project.path,
      projectId: project.id
    });
    if (refusal) {
      throw new ThreadCreateError(409, refusal.reason, refusal.message);
    }
  }

  if (choice.kind === 'reuse') {
    const existing = getEnvironment(ctx.db, choice.environmentId);
    if (!existing || existing.projectId !== project.id || existing.hostId !== hostId) {
      throw new ThreadCreateError(404, 'unknown-environment', 'environment is not available');
    }
    if (existing.status !== 'ready' || !existing.path) {
      throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not ready');
    }
    const thread = createThread(ctx.db, {
      projectId: project.id,
      hostId,
      environmentId: existing.id,
      providerId: input.providerId,
      title: prompt[0]!.slice(0, 120),
      status: 'starting'
    });
    try {
      await startThreadOnHost(ctx, { hostId, project, thread, prompt, environmentId: existing.id, providerId: input.providerId });
      const running = updateThreadStatus(ctx.db, thread.id, 'running') ?? thread;
      ctx.hub.emit('threads:updated', running);
      return running;
    } catch (error) {
      updateThreadStatus(ctx.db, thread.id, 'failed');
      if (error instanceof ThreadCreateError) throw error;
      throw mapHostError(error);
    }
  }

  const created = ctx.db.transaction(() => {
    const environmentId = crypto.randomUUID();
    const path = choice.kind === 'worktree'
      ? resolveManagedTargetPath({ dataDir: ctx.dataDir, environmentId, sourcePath: project.path })
      : choice.kind === 'personal'
        ? resolvePersonalTargetPath({ dataDir: ctx.dataDir, environmentId })
        : project.path;
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
    const thread = createThread(ctx.db, {
      projectId: project.id,
      hostId,
      environmentId: environment.id,
      providerId: input.providerId,
      title: prompt[0]!.slice(0, 120),
      status: 'starting'
    });
    return { environment, thread };
  });

  try {
    const provisioned = await ctx.hostHub.callHostOnlineRpc<EnvironmentProvisionResult>({
      hostId,
      command: {
        ...provisionCommandFor(created.environment, project, choice, input.checkout),
        initiator: { threadId: created.thread.id, provisioningId: created.environment.id }
      }
    });
    updateEnvironmentDiscovery(ctx.db, created.environment.id, {
      status: 'ready',
      path: provisioned.path,
      isGitRepo: provisioned.isGitRepo,
      isWorktree: provisioned.isWorktree,
      branchName: provisioned.branchName,
      defaultBranch: provisioned.defaultBranch,
      mergeBaseBranch: provisioned.defaultBranch
    });

    await startThreadOnHost(ctx, {
      hostId,
      project,
      thread: created.thread,
      prompt,
      environmentId: created.environment.id,
      providerId: input.providerId
    });
    const running = updateThreadStatus(ctx.db, created.thread.id, 'running') ?? created.thread;
    ctx.hub.emit('threads:updated', running);
    return running;
  } catch (error) {
    updateThreadStatus(ctx.db, created.thread.id, 'failed');
    updateEnvironmentStatus(ctx.db, created.environment.id, 'failed');
    if (error instanceof ThreadCreateError) throw error;
    throw mapHostError(error);
  }
}

async function startThreadOnHost(
  ctx: ProductHttpContext,
  args: {
    hostId: string;
    project: Project;
    thread: ThreadRow;
    prompt: string[];
    environmentId: string;
    providerId: string;
  }
): Promise<void> {
  const status = await ctx.hostHub.callHostOnlineRpc<ProviderStatusResult>({
    hostId: args.hostId,
    command: { type: 'provider.status' }
  });
  const family = resolveProviderFamily(args.providerId);
  const provider = status.providers.find((entry) => entry.family === family);
  if (!family || !provider?.installed || !provider.enabled) {
    throw new ThreadCreateError(503, 'provider_unavailable', `provider ${args.providerId} is not available on that host`);
  }
  await ctx.hostHub.callHostOnlineRpc<ThreadStartResult>({
    hostId: args.hostId,
    command: {
      type: 'thread.start',
      threadId: args.thread.id,
      environmentId: args.environmentId,
      projectId: args.project.id,
      providerId: args.providerId,
      input: args.prompt
    }
  });
}

export function getThreadRecord(ctx: ProductHttpContext, id: string): ThreadRow | null {
  return getThread(ctx.db, id);
}

export function threadView(ctx: ProductHttpContext, thread: ThreadRow) {
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  return {
    ...thread,
    cwd: environment?.path ?? null,
    branchName: environment?.branchName ?? null,
    isWorktree: environment?.isWorktree ?? false
  };
}
