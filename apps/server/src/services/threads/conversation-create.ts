import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ThreadStartResult } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createConversationThread,
  createEnvironment,
  findProjectEnvironmentByHostPath,
  getConversationThread,
  getEnvironment,
  hasPendingInteractionForThread,
  updateConversationThreadStatus,
  updateEnvironmentDiscovery,
  updateEnvironmentStatus,
  setConversationProviderThreadId,
  type ConversationThreadRow,
  type EnvironmentRow
} from '@zana-ai/zcc-db';
import {
  DEFAULT_SETUP_TIMEOUT_MS,
  buildManagedBranchName,
  titleFromPrompt,
  type SpawnEnvironmentChoice
} from '@zana-ai/zcc-domain';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import { clampPermissionModeToHost } from '../hosts/permission-ceiling.js';
import type { EnvironmentProvisionCommand, EnvironmentProvisionResult } from '@zana-ai/zcc-contracts/host-rpc';
import { AmbiguousHostError, HostUnavailableError } from '../../http/host-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { emitPluginThreadEvent } from '../../plugins/thread-events.js';
import { unmanagedAttachRefusal } from './workspace-path-claims.js';
import { resolveManagedTargetPath, resolvePersonalTargetPath } from './worktree-paths.js';
import {
  bridgeLaunchForProvider,
  canonicalThreadProviderId,
  getThreadProvider,
  permissionModeForLaunchProfile
} from './thread-provider-catalog.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { appendClientTurnRequested } from './client-turn-requested.js';

export interface CreateConversationInput {
  projectId: string;
  providerId: string;
  input: string[];
  hostId?: string;
  id?: string;
  environment?: SpawnEnvironmentChoice;
  checkout?: { kind: 'existing'; name: string } | { kind: 'new'; name: string; baseBranch: string };
  cwd?: string;
  title?: string;
  permissionMode?: 'accept-edits' | 'auto' | 'full';
  model?: string;
  reasoningLevel?: ReasoningLevel;
}

const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return new ThreadCreateError(500, 'thread-create-failed', error instanceof Error ? error.message : String(error));
}

function provisionCommandFor(
  environment: EnvironmentRow,
  project: Project,
  choice: SpawnEnvironmentChoice,
  checkout: CreateConversationInput['checkout']
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

export function threadTitle(input: Pick<CreateConversationInput, 'title'>, prompt: string[]): string {
  if (input.title?.trim()) return input.title.trim().slice(0, 120);
  if (prompt[0]) return titleFromPrompt(prompt[0]) || 'Thread';
  return 'Thread';
}

export function requestAutoThreadTitle(
  ctx: ProductHttpContext,
  input: CreateConversationInput,
  threadId: string,
  prompt: string[]
): void {
  const namer = ctx.threadTitleNamer;
  if (!namer) return;
  if (input.title?.trim()) {
    namer.reserve(threadId);
    return;
  }
  const text = prompt[0]?.trim();
  if (!text) return;
  namer.request(threadId, text);
}

async function startConversationOnHost(
  ctx: ProductHttpContext,
  args: {
    hostId: string;
    project: Project;
    thread: ConversationThreadRow;
    prompt: string[];
    environmentId: string;
    input: CreateConversationInput;
  }
): Promise<void> {
  const providerId = canonicalThreadProviderId(args.input.providerId);
  if (!getThreadProvider(providerId)) {
    throw new ThreadCreateError(400, 'invalid-provider', `unknown thread provider: ${args.input.providerId}`);
  }
  const dataDir = join(ctx.dataDir, 'thread-bridges', providerId);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const requestedMode = args.input.permissionMode ?? permissionModeForLaunchProfile(args.input.providerId);
  const permissionMode = clampPermissionModeToHost(ctx.db, args.hostId, requestedMode) ?? requestedMode;
  appendClientTurnRequested(ctx, {
    threadId: args.thread.id,
    prompt: args.prompt,
    kind: 'thread-start',
    permissionMode,
    model: args.input.model,
    reasoningLevel: args.input.reasoningLevel
  });
  const started = await ctx.hostHub.callHostOnlineRpc<ThreadStartResult>({
    hostId: args.hostId,
    command: {
      type: 'thread.start',
      threadId: args.thread.id,
      environmentId: args.environmentId,
      projectId: args.project.id,
      providerId,
      input: args.prompt,
      cwd: args.input.cwd,
      title: args.thread.title ?? undefined,
      bridgeLaunch: bridgeLaunchForProvider(providerId, dataDir),
      permissionMode,
      ...(args.input.model ? { model: args.input.model } : {}),
      ...(args.input.reasoningLevel ? { reasoningLevel: args.input.reasoningLevel } : {})
    }
  });
  if (started.providerThreadId) {
    setConversationProviderThreadId(ctx.db, args.thread.id, started.providerThreadId);
  }
}

export interface ConversationThreadView {
  id: string;
  projectId: string;
  hostId: string;
  environmentId: string | null;
  providerId: string;
  status: ConversationThreadRow['status'];
  originKind: ConversationThreadRow['originKind'];
  visibility: ConversationThreadRow['visibility'];
  title: string | null;
  providerThreadId: string | null;
  parentThreadId: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  cwd: string | null;
  branchName: string | null;
  isWorktree: boolean;
  hasPendingInteraction: boolean;
}

export function conversationThreadView(ctx: ProductHttpContext, thread: ConversationThreadRow): ConversationThreadView {
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  return {
    ...thread,
    cwd: environment?.path ?? null,
    branchName: environment?.branchName ?? null,
    isWorktree: environment?.isWorktree ?? false,
    hasPendingInteraction: hasPendingInteractionForThread(ctx.db, thread.id)
  };
}

export async function createConversationFromRequest(
  ctx: ProductHttpContext,
  input: CreateConversationInput
): Promise<ConversationThreadRow> {
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

  const project = requireProject(ctx, input.projectId);
  let hostId: string;
  try {
    hostId = ctx.hostHub.resolveHostId(input.hostId ?? project.hostId);
    ctx.hostHub.ensureHostSessionReady(hostId);
  } catch (error) {
    throw mapHostError(error);
  }

  let choice: SpawnEnvironmentChoice = input.environment ?? { kind: 'unmanaged' };
  if (project.remote && choice.kind !== 'unmanaged') {
    throw new ThreadCreateError(403, 'remote-unsupported', 'remote projects can only use this checkout');
  }

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

  const requestedId = input.id && THREAD_ID_RE.test(input.id) ? input.id : undefined;
  const providerId = canonicalThreadProviderId(input.providerId);

  if (choice.kind === 'unmanaged') {
    const existingUnmanaged = findProjectEnvironmentByHostPath(ctx.db, project.id, hostId, project.path);
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
    // Host `runtime.environments` is in-memory. After a daemon restart a DB-ready
    // unmanaged checkout is still unregistered, so thread.start would 409. Always
    // re-attach unmanaged (provision is realpath + discover). Managed worktrees
    // stay skip-if-ready because re-provision is not idempotent.
    const needsHostAttach = !canReuseReady || existing.workspaceProvisionType === 'unmanaged';
    const thread = createConversationThread(ctx.db, {
      id: requestedId,
      projectId: project.id,
      hostId,
      environmentId: existing.id,
      providerId,
      title: threadTitle(input, prompt),
      status: 'starting'
    });
    emitPluginThreadEvent(ctx, {
      name: 'thread.created',
      threadId: thread.id,
      projectId: thread.projectId
    });
    try {
      if (needsHostAttach) {
        const provisioned = await ctx.hostHub.callHostOnlineRpc<EnvironmentProvisionResult>({
          hostId,
          command: {
            ...provisionCommandFor(existing, project, { kind: 'unmanaged' }, input.checkout),
            initiator: { threadId: thread.id, provisioningId: existing.id }
          }
        });
        updateEnvironmentDiscovery(ctx.db, existing.id, {
          status: 'ready',
          path: provisioned.path,
          isGitRepo: provisioned.isGitRepo,
          isWorktree: provisioned.isWorktree,
          branchName: provisioned.branchName,
          defaultBranch: provisioned.defaultBranch,
          mergeBaseBranch: provisioned.defaultBranch
        });
      }
      await startConversationOnHost(ctx, { hostId, project, thread, prompt, environmentId: existing.id, input });
      const running = updateConversationThreadStatus(ctx.db, thread.id, 'active') ?? thread;
      ctx.hub.emit('threads:updated', conversationThreadView(ctx, running));
      requestAutoThreadTitle(ctx, input, running.id, prompt);
      emitPluginThreadEvent(ctx, {
        name: 'thread.active',
        threadId: running.id,
        projectId: running.projectId
      });
      return running;
    } catch (error) {
      failConversationStart(ctx, thread);
      if (!canReuseReady) updateEnvironmentStatus(ctx.db, existing.id, 'failed');
      if (error instanceof ThreadCreateError) throw error;
      throw mapHostError(error);
    }
  }

  let created: { environment: EnvironmentRow; thread: ConversationThreadRow };
  try {
  created = ctx.db.transaction(() => {
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
    const thread = createConversationThread(ctx.db, {
      id: requestedId,
      projectId: project.id,
      hostId,
      environmentId: environment.id,
      providerId,
      title: threadTitle(input, prompt),
      status: 'starting'
    });
    emitPluginThreadEvent(ctx, {
      name: 'thread.created',
      threadId: thread.id,
      projectId: thread.projectId
    });
    return { environment, thread };
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('UNIQUE constraint failed: environments.')) throw error;
    const path = choice.kind === 'unmanaged' ? project.path : null;
    const existing = path ? findProjectEnvironmentByHostPath(ctx.db, project.id, hostId, path) : null;
    if (!existing) throw error;
    choice = { kind: 'reuse', environmentId: existing.id };
    const thread = createConversationThread(ctx.db, {
      id: requestedId,
      projectId: project.id,
      hostId,
      environmentId: existing.id,
      providerId,
      title: threadTitle(input, prompt),
      status: 'starting'
    });
    emitPluginThreadEvent(ctx, {
      name: 'thread.created',
      threadId: thread.id,
      projectId: thread.projectId
    });
    created = { environment: existing, thread };
  }

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
    await startConversationOnHost(ctx, {
      hostId,
      project,
      thread: created.thread,
      prompt,
      environmentId: created.environment.id,
      input
    });
    const running = updateConversationThreadStatus(ctx.db, created.thread.id, 'active') ?? created.thread;
    ctx.hub.emit('threads:updated', conversationThreadView(ctx, running));
    requestAutoThreadTitle(ctx, input, running.id, prompt);
    emitPluginThreadEvent(ctx, {
      name: 'thread.active',
      threadId: running.id,
      projectId: running.projectId
    });
    return running;
  } catch (error) {
    failConversationStart(ctx, created.thread);
    updateEnvironmentStatus(ctx.db, created.environment.id, 'failed');
    if (error instanceof ThreadCreateError) throw error;
    throw mapHostError(error);
  }
}

function failConversationStart(ctx: ProductHttpContext, thread: ConversationThreadRow): void {
  const failed = updateConversationThreadStatus(ctx.db, thread.id, 'error') ?? {
    ...thread,
    status: 'error' as const
  };
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, failed));
  emitPluginThreadEvent(ctx, {
    name: 'thread.failed',
    threadId: failed.id,
    projectId: failed.projectId
  });
}

export function flattenThreadInput(input: unknown): string[] {
  if (typeof input === 'string') return [input];
  if (!Array.isArray(input)) return [];
  const parts: string[] = [];
  for (const part of input) {
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }
    if (part && typeof part === 'object' && 'type' in part && (part as { type: string }).type === 'text') {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts;
}

export { getConversationThread };
