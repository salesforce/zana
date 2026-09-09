import type { ThreadStartResult } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createConversationThread,
  createEnvironment,
  findProjectEnvironmentByHostPath,
  getConversationThread,
  getEnvironment,
  getPrimaryHost,
  listConversationThreadEvents,
  listHosts,
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
import type { ReasoningLevel, PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import { clampPermissionModeToHost } from '../hosts/permission-ceiling.js';
import type { EnvironmentProvisionCommand, EnvironmentProvisionResult } from '@zana-ai/zcc-contracts/host-rpc';
import { AmbiguousHostError, HostUnavailableError } from '../../http/host-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { applyLoggedConversationLifecycleEvent } from './conversation-lifecycle-outcome.js';
import { emitPluginThreadEvent } from '../../plugins/thread-events.js';
import { unmanagedAttachRefusal } from './workspace-path-claims.js';
import { resolveManagedTargetPath } from './worktree-paths.js';
import { resolvePersonalTargetPathOnHost } from './host-personal-path.js';
import {
  bridgeLaunchForProvider,
  canonicalThreadProviderId,
  getThreadProvider,
  permissionModeForLaunchProfile
} from './thread-provider-catalog.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { appendClientTurnRequested } from './client-turn-requested.js';
import { startLiveTurnCommand } from './conversation-live-turn.js';
import {
  boundRemoteHostId,
  isRemoteToolProxyActive,
  remoteWorkspacePath,
  resolveHarnessWorkspacePath,
  REMOTE_HOST_DAEMON_REQUIRED,
  REMOTE_HOST_DAEMON_REQUIRED_MESSAGE,
  threadLaunchRemote
} from './remote-tool-proxy.js';
import { resolveSpawnChoiceForHost } from './spawn-choice-for-host.js';
import { toRemoteStartPathHost } from '../hosts/host-public.js';
import { packConversationSessionTooling } from './conversation-session-tools.js';
import { attachmentMarkersFromInput, hostPromptInputFromInput, resolvePromptAttachmentPath } from '../projects/attachments.js';
import { withResolvedPluginMentionContext } from '../../plugins/plugin-mentions.js';
import {
  withResolvedPathMentionContext,
  workspacePathMentionReaders
} from '../../plugins/path-mentions.js';
import { latestProviderCheckpoint } from './conversation-edit-message.js';
import { conversationThreadView } from './conversation-thread-view.js';
import {
  requestedExecutionModeFromTurn,
  claudeCodePermissionModeForTurn
} from './conversation-execution-mode.js';
import { derivedProviderOptionsForCommand } from './derived-provider-options.js';
import { recordThreadExecutionMode } from './conversation-plan.js';

export {
  conversationThreadView,
  conversationThreadViews,
  type ConversationThreadView
} from './conversation-thread-view.js';

export interface CreateConversationInput {
  projectId: string;
  providerId: string;
  input: string[];
  promptInput?: unknown;
  hostId?: string;
  id?: string;
  environment?: SpawnEnvironmentChoice;
  checkout?: { kind: 'existing'; name: string } | { kind: 'new'; name: string; baseBranch: string };
  cwd?: string;
  title?: string;
  permissionMode?: 'accept-edits' | 'auto' | 'full';
  model?: string;
  reasoningLevel?: ReasoningLevel;
  acpMode?: string;
  parentThreadId?: string;
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
  checkout: CreateConversationInput['checkout'],
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
    hostPrompt: PromptInput[];
    environmentId: string;
    input: CreateConversationInput;
    remoteToolProxy: boolean;
    dropCwd?: boolean;
  }
): Promise<{ permissionMode: string }> {
  const providerId = canonicalThreadProviderId(args.input.providerId);
  if (!getThreadProvider(providerId)) {
    throw new ThreadCreateError(400, 'invalid-provider', `unknown thread provider: ${args.input.providerId}`);
  }
  const requestedMode = requestedExecutionModeFromTurn({
    acpMode: args.input.acpMode,
    input: args.hostPrompt
  });
  const claudeCodePermissionMode = claudeCodePermissionModeForTurn(providerId, requestedMode);
  recordThreadExecutionMode(ctx.db, {
    threadId: args.thread.id,
    requestedMode,
    effectiveMode: requestedMode
  });
  const requestedPermissionMode = args.input.permissionMode ?? permissionModeForLaunchProfile(args.input.providerId);
  const permissionMode = clampPermissionModeToHost(ctx.db, args.hostId, requestedPermissionMode) ?? requestedPermissionMode;
  const providerOptions = derivedProviderOptionsForCommand({
    providerId,
    threadId: args.thread.id,
    projectId: args.project.id,
    model: args.input.model,
    permissionMode,
    promptMode: requestedMode === 'plan' ? 'plan' : undefined,
    plugins: ctx.plugins
  });
  const clientRequestId = appendClientTurnRequested(ctx, {
    threadId: args.thread.id,
    prompt: args.prompt,
    promptInput: args.input.promptInput,
    kind: 'thread-start',
    permissionMode,
    model: args.input.model,
    reasoningLevel: args.input.reasoningLevel,
    acpMode: args.input.acpMode
  });
  const sessionTooling = await packConversationSessionTooling(ctx, {
    threadId: args.thread.id,
    projectId: args.project.id
  });
  const checkpoint = getThreadProvider(providerId)?.capabilities.fork === 'checkpoint'
    ? latestProviderCheckpoint(listConversationThreadEvents(ctx.db, args.thread.id))?.checkpoint
    : undefined;
  startLiveTurnCommand(ctx, {
    hostId: args.hostId,
    command: {
      type: 'thread.start',
      threadId: args.thread.id,
      environmentId: args.environmentId,
      projectId: args.project.id,
      providerId,
      input: args.hostPrompt,
      cwd: args.dropCwd
        ? undefined
        : (args.remoteToolProxy || !args.project.remote ? args.input.cwd : undefined),
      title: args.thread.title ?? undefined,
      bridgeLaunch: bridgeLaunchForProvider(providerId, ctx.pluginHostArtifacts),
      permissionMode,
      ...(args.input.model ? { model: args.input.model } : {}),
      ...(args.input.reasoningLevel ? { reasoningLevel: args.input.reasoningLevel } : {}),
      ...(args.input.acpMode ? { acpMode: args.input.acpMode } : {}),
      ...(claudeCodePermissionMode ? { claudeCodePermissionMode } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(clientRequestId ? { clientRequestId } : {}),
      ...(checkpoint ? { providerCheckpointId: checkpoint } : {}),
      ...sessionTooling,
      ...(args.remoteToolProxy ? {
        remote: threadLaunchRemote(
          args.project,
          remoteWorkspacePath(
            args.project,
            args.remoteToolProxy,
            ctx.config.getConfig().remoteDefaultPath,
            listHosts(ctx.db).map(toRemoteStartPathHost)
          )
        ),
        remoteToolProxy: true
      } : {})
    },
    onSuccess: (result) => {
      const started = result as ThreadStartResult;
      if (started?.providerThreadId) {
        setConversationProviderThreadId(ctx.db, args.thread.id, started.providerThreadId);
      }
    },
    onError: (error) => {
      void import('./conversation-turn-settlement.js')
        .then(({ settleLiveTurnCommandFailure }) => {
          settleLiveTurnCommandFailure(ctx, {
            thread: args.thread,
            commandType: 'thread.start',
            clientRequestId,
            error
          });
        })
        .catch(() => undefined);
    }
  });
  // permissionMode is the closest server-computed signal for "plan vs an actual
  // agent run" (PORTABLE_EXECUTION_STATES in AgentLauncher.tsx) available at this
  // seam — surfaced to plugins as PluginThreadEvent.executionState.
  return { permissionMode };
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
  const pluginResolvedPromptInput = await withResolvedPluginMentionContext(ctx.plugins, input.promptInput);
  const textPrompt = flattenThreadInput(pluginResolvedPromptInput).map((part) => part.trim()).filter((part) => part.length > 0);
  const promptSource = textPrompt.length > 0 ? textPrompt : input.input.map((part) => part.trim()).filter((part) => part.length > 0);
  let resolvedPromptInput = pluginResolvedPromptInput;
  let prompt = hostPromptInputFromInput(
    resolvedPromptInput,
    promptSource,
    (path) => resolvePromptAttachmentPath(ctx.dataDir, input.projectId, path)
  );
  if (prompt.length === 0) {
    throw new ThreadCreateError(400, 'invalid-input', 'input is required');
  }

  const project = requireProject(ctx, input.projectId);
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

  resolvedPromptInput = await withResolvedPathMentionContext(
    resolvedPromptInput,
    workspacePathMentionReaders(ctx, hostId, workspacePath)
  );
  prompt = hostPromptInputFromInput(
    resolvedPromptInput,
    promptSource,
    (path) => resolvePromptAttachmentPath(ctx.dataDir, input.projectId, path)
  );

  // Presence-only signal for plugins (never the marker text/paths themselves).
  const hadAttachments = attachmentMarkersFromInput(
    resolvedPromptInput,
    (path) => resolvePromptAttachmentPath(ctx.dataDir, input.projectId, path)
  ).length > 0;

  let choice: SpawnEnvironmentChoice = input.environment ?? { kind: 'unmanaged' };
  if (project.remote && choice.kind !== 'unmanaged') {
    throw new ThreadCreateError(403, 'remote-unsupported', 'remote projects can only use this checkout');
  }
  const spawnChoice = resolveSpawnChoiceForHost({
    project,
    choice,
    executionHostId: hostId,
    primaryHostId: primary?.id,
    remoteToolProxy
  });
  if (!spawnChoice.ok) {
    throw new ThreadCreateError(400, spawnChoice.code, spawnChoice.message);
  }
  choice = spawnChoice.choice;
  const dropCwd = spawnChoice.dropCwd;

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

  const requestedId = input.id && THREAD_ID_RE.test(input.id) ? input.id : undefined;
  const providerId = canonicalThreadProviderId(input.providerId);

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
      title: threadTitle(input, textPrompt),
      status: 'starting',
      parentThreadId: input.parentThreadId ?? null
    });
    emitPluginThreadEvent(ctx, {
      name: 'thread.created',
      threadId: thread.id,
      projectId: thread.projectId,
      providerId: thread.providerId,
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
      hadAttachments
    });
    try {
      if (needsHostAttach) {
        const provisioned = await ctx.hostHub.callHostOnlineRpc<EnvironmentProvisionResult>({
          hostId,
          command: {
            ...provisionCommandFor(existing, project, { kind: 'unmanaged' }, input.checkout, workspacePath),
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
      const launch = await startConversationOnHost(ctx, {
        hostId, project, thread, prompt: textPrompt, hostPrompt: prompt, environmentId: existing.id, input: { ...input, promptInput: resolvedPromptInput }, remoteToolProxy, dropCwd
      });
      const running = applyLoggedConversationLifecycleEvent(ctx, {
        threadId: thread.id,
        event: { type: 'run.started' }
      }).applied
        ? (getConversationThread(ctx.db, thread.id) ?? thread)
        : thread;
      ctx.hub.emit('threads:updated', conversationThreadView(ctx, running));
      requestAutoThreadTitle(ctx, input, running.id, textPrompt);
      emitPluginThreadEvent(ctx, {
        name: 'thread.active',
        threadId: running.id,
        projectId: running.projectId,
        providerId: running.providerId,
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
        executionState: launch.permissionMode
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
  const environmentId = crypto.randomUUID();
  let personalPath: string | undefined;
  if (choice.kind === 'personal') {
    try {
      personalPath = await resolvePersonalTargetPathOnHost(ctx, hostId, environmentId);
    } catch (error) {
      throw mapHostError(error);
    }
  }
  try {
    created = ctx.db.transaction(() => {
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
      const thread = createConversationThread(ctx.db, {
        id: requestedId,
        projectId: project.id,
        hostId,
        environmentId: environment.id,
        providerId,
        title: threadTitle(input, textPrompt),
        status: 'starting',
        parentThreadId: input.parentThreadId ?? null
      });
      emitPluginThreadEvent(ctx, {
        name: 'thread.created',
        threadId: thread.id,
        projectId: thread.projectId,
        providerId: thread.providerId,
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
        hadAttachments
      });
      return { environment, thread };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('UNIQUE constraint failed: environments.')) throw error;
    const path = choice.kind === 'unmanaged' ? workspacePath : null;
    const existing = path ? findProjectEnvironmentByHostPath(ctx.db, project.id, hostId, path) : null;
    if (!existing) throw error;
    choice = { kind: 'reuse', environmentId: existing.id };
    const thread = createConversationThread(ctx.db, {
      id: requestedId,
      projectId: project.id,
      hostId,
      environmentId: existing.id,
      providerId,
      title: threadTitle(input, textPrompt),
      status: 'starting',
      parentThreadId: input.parentThreadId ?? null
    });
    emitPluginThreadEvent(ctx, {
      name: 'thread.created',
      threadId: thread.id,
      projectId: thread.projectId,
      providerId: thread.providerId,
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
      hadAttachments
    });
    created = { environment: existing, thread };
  }

  try {
    const provisioned = await ctx.hostHub.callHostOnlineRpc<EnvironmentProvisionResult>({
      hostId,
      command: {
        ...provisionCommandFor(created.environment, project, choice, input.checkout, workspacePath),
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
    const launch = await startConversationOnHost(ctx, {
      hostId,
      project,
      thread: created.thread,
      prompt: textPrompt,
      hostPrompt: prompt,
      environmentId: created.environment.id,
      input: { ...input, promptInput: resolvedPromptInput },
      remoteToolProxy,
      dropCwd
    });
    const running = applyLoggedConversationLifecycleEvent(ctx, {
      threadId: created.thread.id,
      event: { type: 'run.started' }
    }).applied
      ? (getConversationThread(ctx.db, created.thread.id) ?? created.thread)
      : created.thread;
    ctx.hub.emit('threads:updated', conversationThreadView(ctx, running));
    requestAutoThreadTitle(ctx, input, running.id, textPrompt);
    emitPluginThreadEvent(ctx, {
      name: 'thread.active',
      threadId: running.id,
      projectId: running.projectId,
      providerId: running.providerId,
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
      executionState: launch.permissionMode
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
  const outcome = applyLoggedConversationLifecycleEvent(ctx, {
    threadId: thread.id,
    event: { type: 'run.failed' }
  });
  const failed = outcome.applied ? outcome.thread : {
    ...thread,
    status: 'error' as const
  };
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, failed));
  emitPluginThreadEvent(ctx, {
    name: 'thread.failed',
    threadId: failed.id,
    projectId: failed.projectId,
    providerId: failed.providerId
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
