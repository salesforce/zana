import {
  archiveConversationThread,
  countActiveConversationTurns,
  createConversationThread,
  getConversationThread,
  getEnvironment,
  getThreadExecutionState,
  listConversationThreadEvents,
  listConversationThreadsByProject,
  listDueDeferredThreadMessages,
  listLiveConversationThreadsForHost,
  setConversationProviderThreadId,
  unarchiveConversationThread,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import { copyForkSourceHistory, describeCopiedForkStart, resolveConversationForkPoint } from './conversation-fork-history.js';
import {
  deferConversationSend,
  dropDeferredConversationMessages,
  flushDeferredConversationMessages,
  pauseConversationQueue,
  resumeConversationQueue
} from './conversation-deferred-messages.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import {
  canDispatch,
  isHostOfflineError,
  isHostRpcTimeout,
  type ThreadSendMode
} from './conversation-dispatch-checkpoint.js';
import { conversationThreadView, flattenThreadInput } from './conversation-create.js';
import { isPlanExecutionMode, requestedExecutionModeFromTurn } from './conversation-execution-mode.js';
import { hostPromptFromInput, resolvePromptAttachmentPath } from '../projects/attachments.js';
import { resolveActivePlanTurn } from './conversation-timeline.js';
import { emitPluginThreadEvent } from '../../plugins/thread-events.js';
import { appendClientTurnRequested } from './client-turn-requested.js';
import { recoverConversationProviderThreadId } from './conversation-provider-identity.js';
import { destroyEnvironmentIfIdle } from '../environments/environment-cleanup.js';
import {
  isUnknownThreadHostError,
  resumeConversationOnHost,
  threadResumeFields
} from './conversation-host-rpc.js';
import {
  settleLiveTurnCommandFailure
} from './conversation-turn-settlement.js';
import { startLiveTurnCommand } from './conversation-live-turn.js';
import { LIVE_TURN_COMMAND_TIMEOUT_MS } from '../../http/host-hub.js';
import { archiveConversationOnHost, unarchiveConversationOnHost } from './thread-host-commands.js';
import { bridgeLaunchForProvider, getThreadProvider, permissionModeForLaunchProfile } from './thread-provider-catalog.js';
import { clampPermissionModeToHost } from '../hosts/permission-ceiling.js';
import { packConversationSessionTooling } from './conversation-session-tools.js';
import { withResolvedPluginMentionContext } from '../../plugins/plugin-mentions.js';
import { appendStopRequestedEvent, finalizeInterruptedConversation } from './conversation-interrupt.js';
import {
  markOwningThreadPlanTasksInterrupted,
  recordThreadExecutionMode
} from './conversation-plan.js';
import { applyLoggedConversationLifecycleEvent } from './conversation-lifecycle-outcome.js';
import { findOpenConversationTurn } from './conversation-host-recovery.js';
import {
  ensureConversationThreadIsWritable,
  ensureRuntimeCanAcceptActiveSend,
  resolveConversationSendMode,
  shouldQueueGhostActiveSend
} from './conversation-send-request.js';
import { isManualCompactionActive } from './conversation-compaction-state.js';
import {
  prependDeferredFirstTurnContext,
  resolveDeferredFirstTurnContext
} from './conversation-deferred-first-turn.js';

export type { ThreadSendMode } from './conversation-dispatch-checkpoint.js';

export async function sendConversationTurn(
  ctx: ProductHttpContext,
  threadId: string,
  input: unknown,
  mode: ThreadSendMode = 'auto',
  execution?: { model?: string; reasoningLevel?: ReasoningLevel; acpMode?: string },
  options: { drain?: boolean; resumeQueue?: boolean; compact?: boolean } = {}
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const live = recoverConversationProviderThreadId(ctx.db, thread);
  ensureConversationThreadIsWritable(live);
  if (!live.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  if (options.compact !== true) {
    const requestedMode = requestedExecutionModeFromTurn({
      acpMode: execution?.acpMode,
      input
    });
    recordThreadExecutionMode(ctx.db, {
      threadId: live.id,
      requestedMode,
      effectiveMode: requestedMode
    });
  }
  const pending = ctx.pendingInteractions.hasPendingThreadInteraction(threadId);
  if (pending && mode === 'start') {
    throw new ThreadCreateError(
      409,
      'awaiting_user_interaction',
      'Thread is awaiting user interaction. Resolve the pending interaction before sending another prompt.'
    );
  }
  const threadActive = live.status === 'active' || live.status === 'starting';
  const hostOnline = ctx.hostHub.connectedHostIds?.().includes(live.hostId) === true;
  const explicitRootSend = options.drain !== true && mode !== 'queue-if-active';
  if (explicitRootSend || options.resumeQueue) {
    resumeConversationQueue(ctx, live.id);
  }
  const ghostQueue = shouldQueueGhostActiveSend(ctx, live, mode);
  if (options.compact !== true && isManualCompactionActive(ctx, live.id) && options.drain !== true) {
    deferConversationSend(ctx, { threadId: live.id, input, mode, execution });
    return live;
  }
  const shouldQueue = options.drain !== true && (
    ghostQueue
    || pending
    || !hostOnline
    || (mode === 'queue-if-active' && threadActive)
    || canDispatch({
      archived: Boolean(live.archivedAt),
      queuePaused: false,
      pendingInteraction: pending,
      hostOnline,
      sendAfter: null,
      liveActiveCount: countActiveConversationTurns(ctx.db)
    }).kind === 'delay' && mode === 'queue-if-active'
  );
  if (shouldQueue) {
    deferConversationSend(ctx, { threadId: live.id, input, mode, execution });
    return live;
  }
  const resolvedMode = resolveConversationSendMode(live, mode);
  ensureRuntimeCanAcceptActiveSend(ctx, live, resolvedMode);
  const resolvedInput = prependDeferredFirstTurnContext(
    await withResolvedPluginMentionContext(ctx.plugins, input),
    resolveDeferredFirstTurnContext(ctx, live.id)
  );
  const textPrompt = flattenThreadInput(resolvedInput).map((part) => part.trim()).filter((part) => part.length > 0);
  const prompt = hostPromptFromInput(
    resolvedInput,
    textPrompt,
    (path) => resolvePromptAttachmentPath(ctx.dataDir, live.projectId, path)
  );
  if (prompt.length === 0) {
    throw new ThreadCreateError(400, 'invalid-input', 'input is required');
  }
  const steerTurnId = resolvedMode === 'steer' || resolvedMode === 'steer-if-active'
    ? findOpenConversationTurn(ctx.db, live.id)?.turnId ?? null
    : null;
  const clientRequestId = appendClientTurnRequested(ctx, {
    threadId: live.id,
    prompt: textPrompt,
    promptInput: resolvedInput,
    kind: steerTurnId ? 'steer' : 'new-turn',
    expectedTurnId: steerTurnId,
    model: execution?.model,
    reasoningLevel: execution?.reasoningLevel
  });
  const started = applyLoggedConversationLifecycleEvent(ctx, {
    threadId: live.id,
    event: { type: 'run.started' }
  });
  // Follow-ups on an already-active thread have no run.started cell; still submit.
  if (!started.applied && live.status !== 'active') {
    return getConversationThread(ctx.db, live.id) ?? live;
  }
  await dispatchTurnSubmit(ctx, {
    thread: live,
    prompt,
    mode: resolvedMode,
    execution,
    clientRequestId,
    input,
    drain: options.drain === true
  });
  const next = getConversationThread(ctx.db, live.id) ?? live;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  if (textPrompt[0] && next.originKind !== 'fork') ctx.threadTitleNamer?.request(next.id, textPrompt[0]);
  emitPluginThreadEvent(ctx, {
    name: 'thread.active',
    threadId: next.id,
    projectId: next.projectId
  });
  return next;
}

async function dispatchTurnSubmit(
  ctx: ProductHttpContext,
  args: {
    thread: ConversationThreadRow;
    prompt: string[];
    mode: ThreadSendMode;
    execution?: { model?: string; reasoningLevel?: ReasoningLevel; acpMode?: string };
    clientRequestId?: string;
    input: unknown;
    drain: boolean;
  }
): Promise<void> {
  if (!args.thread.providerThreadId && args.thread.originKind === 'fork') {
    const command = await threadStartCommandForFork(
      ctx,
      args.thread,
      args.prompt,
      args.execution,
      args.clientRequestId
    );
    startLiveTurnCommand(ctx, {
      hostId: args.thread.hostId,
      command,
      onSuccess: (result) => {
        const started = result as { providerThreadId?: string };
        if (started?.providerThreadId) {
          setConversationProviderThreadId(ctx.db, args.thread.id, started.providerThreadId);
        }
      },
      onError: (error) => {
        void recoverOrSettleTurnSubmit(ctx, args, error).catch(() => undefined);
      }
    });
    return;
  }
  const command = await turnSubmitCommand(
    ctx,
    args.thread,
    args.prompt,
    args.mode,
    args.execution,
    args.clientRequestId,
    args.drain
  );
  startLiveTurnCommand(ctx, {
    hostId: args.thread.hostId,
    command,
    onError: (error) => {
      void recoverOrSettleTurnSubmit(ctx, args, error).catch(() => undefined);
    }
  });
}

async function recoverOrSettleTurnSubmit(
  ctx: ProductHttpContext,
  args: {
    thread: ConversationThreadRow;
    prompt: string[];
    mode: ThreadSendMode;
    execution?: { model?: string; reasoningLevel?: ReasoningLevel; acpMode?: string };
    clientRequestId?: string;
    input: unknown;
    drain: boolean;
  },
  error: unknown
): Promise<void> {
  if (isHostOfflineError(error) && !isHostRpcTimeout(error) && !args.drain) {
    deferConversationSend(ctx, {
      threadId: args.thread.id,
      input: args.input,
      mode: args.mode,
      execution: args.execution
    });
    return;
  }
  if (isUnknownThreadHostError(error)) {
    try {
      const current = recoverConversationProviderThreadId(
        ctx.db,
        getConversationThread(ctx.db, args.thread.id) ?? args.thread
      );
      await resumeConversationOnHost(ctx, current);
      await ctx.hostHub.callHostOnlineRpc({
        hostId: current.hostId,
        command: await turnSubmitCommand(
          ctx,
          current,
          args.prompt,
          args.mode,
          args.execution,
          args.clientRequestId,
          args.drain
        ),
        timeoutMs: LIVE_TURN_COMMAND_TIMEOUT_MS
      });
      return;
    } catch (resumeError) {
      settleLiveTurnCommandFailure(ctx, {
        thread: args.thread,
        commandType: 'turn.submit',
        clientRequestId: args.clientRequestId,
        error: resumeError
      });
      return;
    }
  }
  settleLiveTurnCommandFailure(ctx, {
    thread: args.thread,
    commandType: 'turn.submit',
    clientRequestId: args.clientRequestId,
    error
  });
}

export async function stopConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const openTurn = findOpenConversationTurn(ctx.db, thread.id);
  const hasLiveRuntime = thread.status === 'active'
    || thread.status === 'starting'
    || (thread.status === 'stopping' && openTurn != null);

  if (!hasLiveRuntime) {
    try {
      await ctx.hostHub.callHostOnlineRpc({
        hostId: thread.hostId,
        command: { type: 'thread.stop', threadId: thread.id }
      });
    } catch {
      /* Release is best-effort: idle/error stop must not pretend a turn was interrupted. */
    }
    return getConversationThread(ctx.db, thread.id) ?? thread;
  }

  appendStopRequestedEvent(ctx.db, ctx.hub, thread.id);
  pauseConversationQueue(ctx, thread.id);
  ctx.pendingInteractions.interruptPendingInteractionsForThreadIds({
    threadIds: [thread.id],
    reason: 'thread-stopped'
  });
  markOwningThreadPlanTasksInterrupted(ctx.db, thread.id);
  applyLoggedConversationLifecycleEvent(ctx, {
    threadId: thread.id,
    event: { type: 'stop.requested' }
  });
  const startingWithoutTurn = thread.status === 'starting' && openTurn == null;
  try {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: thread.hostId,
      command: { type: 'thread.stop', threadId: thread.id }
    });
  } catch (error) {
    if (isHostRpcTimeout(error) && !startingWithoutTurn) {
      const stopping = {
        ...(getConversationThread(ctx.db, thread.id) ?? thread),
        status: 'stopping' as const
      };
      ctx.hub.emit('threads:updated', conversationThreadView(ctx, stopping));
      return stopping;
    }
    if (!isUnknownThreadHostError(error) && !isHostOfflineError(error) && !startingWithoutTurn) {
      /* Fall through and finalize locally so history is not stuck on stopping. */
    }
  }
  const next = finalizeInterruptedConversation(ctx.db, ctx.hub, {
    threadId: thread.id,
    reason: 'manual-stop'
  }) ?? thread;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  emitPluginThreadEvent(ctx, {
    name: 'thread.idle',
    threadId: next.id,
    projectId: next.projectId
  });
  void import('./conversation-child-notifications.js')
    .then(({ notifyParentOfChildTurn }) => notifyParentOfChildTurn(ctx, next))
    .catch(() => undefined);
  return next;
}

export async function cancelConversationPlan(
  ctx: ProductHttpContext,
  threadId: string
): Promise<{ ok: true }> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const activePlanTurn = resolveActivePlanTurn(ctx, thread);
  const execution = getThreadExecutionState(ctx.db, threadId);
  const stickyPlan = isPlanExecutionMode(execution?.requestedMode)
    || isPlanExecutionMode(execution?.effectiveMode);
  if (!activePlanTurn && !stickyPlan) {
    throw new ThreadCreateError(409, 'invalid_request', 'Plan mode is not active');
  }
  if (activePlanTurn) {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: thread.hostId,
      command: {
        type: 'thread.plan.cancel',
        threadId: thread.id,
        expectedTurnId: activePlanTurn.turnId
      }
    });
  }
  recordThreadExecutionMode(ctx.db, {
    threadId: thread.id,
    requestedMode: 'agent',
    effectiveMode: 'agent'
  });
  const next = getConversationThread(ctx.db, thread.id) ?? thread;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  return { ok: true };
}

export async function resumeConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const live = recoverConversationProviderThreadId(ctx.db, thread);
  if (!live.environmentId || !live.providerThreadId) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  await resumeConversationOnHost(ctx, live);
  const next = getConversationThread(ctx.db, live.id) ?? live;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  return next;
}

export async function archiveConversation(
  ctx: ProductHttpContext,
  threadId: string,
  options: { skipEnvironmentCleanup?: boolean } = {}
): Promise<boolean> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) return false;
  if (!options.skipEnvironmentCleanup) {
    const hiddenChildren = listConversationThreadsByProject(ctx.db, thread.projectId, true, { includeHidden: true })
      .filter((row) => (
        row.parentThreadId === thread.id
        && row.visibility === 'hidden'
        && row.archivedAt === null
      ));
    for (const child of hiddenChildren) {
      await archiveConversation(ctx, child.id, { skipEnvironmentCleanup: true });
    }
  }
  ctx.pendingInteractions.interruptPendingInteractionsForThreadIds({
    threadIds: [thread.id],
    reason: 'thread-deleted'
  });
  dropDeferredConversationMessages(ctx, thread.id);
  try {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: thread.hostId,
      command: { type: 'thread.stop', threadId }
    });
  } catch {
    /* already gone */
  }
  const archived = archiveConversationThread(ctx.db, threadId) ?? thread;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, archived));
  emitPluginThreadEvent(ctx, {
    name: 'thread.archived',
    threadId: archived.id,
    projectId: archived.projectId
  });
  emitPluginThreadEvent(ctx, {
    name: 'thread.deleted',
    threadId: archived.id,
    projectId: archived.projectId
  });
  await archiveConversationOnHost(ctx, archived);
  if (!options.skipEnvironmentCleanup && thread.environmentId) {
    await destroyEnvironmentIfIdle(ctx, thread.environmentId);
  }
  return true;
}

export async function unarchiveConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!thread.archivedAt) {
    throw new ThreadCreateError(409, 'not_archived', 'thread is not archived');
  }
  if (!thread.environmentId || !getEnvironment(ctx.db, thread.environmentId)) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not registered');
  }
  const restored = unarchiveConversationThread(ctx.db, threadId) ?? thread;
  await unarchiveConversationOnHost(ctx, restored);
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, restored));
  return restored;
}

export async function forkConversation(
  ctx: ProductHttpContext,
  threadId: string,
  options?: {
    sourceSeqEnd?: number;
    visibility?: ConversationThreadRow['visibility'];
    originPluginId?: string | null;
    agentContextSeed?: unknown[];
    title?: string;
  }
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!thread.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  resolveConversationForkPoint({
    events: listConversationThreadEvents(ctx.db, thread.id),
    forkCapability: getThreadProvider(thread.providerId)?.capabilities.fork,
    sourceProviderThreadId: thread.providerThreadId,
    sourceSeqEnd: options?.sourceSeqEnd
  });
  const forked = createConversationThread(ctx.db, {
    projectId: thread.projectId,
    hostId: thread.hostId,
    environmentId: thread.environmentId,
    providerId: thread.providerId,
    title: options?.title
      ?? (thread.title ? `${thread.title} (fork)` : 'Forked thread'),
    status: 'idle',
    parentThreadId: thread.id,
    originKind: 'fork',
    originPluginId: options?.originPluginId ?? null,
    visibility: options?.visibility ?? 'visible'
  });
  copyForkSourceHistory(ctx.db, {
    sourceThreadId: thread.id,
    targetThreadId: forked.id,
    sourceSeqEnd: options?.sourceSeqEnd
  });
  const seed = Array.isArray(options?.agentContextSeed) ? options.agentContextSeed : [];
  if (seed.length > 0) {
    appendClientTurnRequested(ctx, {
      threadId: forked.id,
      prompt: [],
      promptInput: seed,
      kind: 'thread-start'
    });
  }
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, forked));
  emitPluginThreadEvent(ctx, {
    name: 'thread.created',
    threadId: forked.id,
    projectId: forked.projectId
  });
  // Forks already have an explicit "… (fork)" title; pin the id so a later
  // follow-up cannot overwrite it via the retry path on sendConversationTurn.
  ctx.threadTitleNamer?.reserve(forked.id);
  return forked;
}

export async function flushHeldConversationSends(
  ctx: ProductHttpContext,
  threadId: string,
  options: { force?: boolean; enforceConcurrencyCap?: boolean } = {}
): Promise<void> {
  if (options.force) resumeConversationQueue(ctx, threadId);
  await flushDeferredConversationMessages(ctx, threadId, async (payload) => {
    await sendConversationTurn(ctx, threadId, payload.input, payload.mode, payload.execution, { drain: true });
  }, options);
}

/** Drain due next-turn rows for every thread on a host that just came online. */
export async function flushDueConversationSendsForHost(
  ctx: ProductHttpContext,
  hostId: string
): Promise<void> {
  const seen = new Set<string>();
  for (const row of listDueDeferredThreadMessages(ctx.db)) {
    if (seen.has(row.threadId)) continue;
    const thread = getConversationThread(ctx.db, row.threadId);
    if (!thread || thread.hostId !== hostId || thread.archivedAt) continue;
    seen.add(row.threadId);
    await flushHeldConversationSends(ctx, row.threadId, { enforceConcurrencyCap: true });
  }
}

/** Re-dispatch stop for stopping threads still live after a host reconnect. */
export async function reconcileStoppingConversationThreadsOnHostConnect(
  ctx: ProductHttpContext,
  hostId: string
): Promise<void> {
  for (const thread of listLiveConversationThreadsForHost(ctx.db, hostId)) {
    if (thread.status !== 'stopping') continue;
    try {
      await ctx.hostHub.callHostOnlineRpc({
        hostId: thread.hostId,
        command: { type: 'thread.stop', threadId: thread.id }
      });
    } catch (error) {
      if (isHostRpcTimeout(error)) continue;
    }
    const next = finalizeInterruptedConversation(ctx.db, ctx.hub, {
      threadId: thread.id,
      reason: 'manual-stop'
    });
    if (next) {
      ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
      emitPluginThreadEvent(ctx, {
        name: 'thread.idle',
        threadId: next.id,
        projectId: next.projectId
      });
      void import('./conversation-child-notifications.js')
        .then(({ notifyParentOfChildTurn }) => notifyParentOfChildTurn(ctx, next))
        .catch(() => undefined);
    }
  }
}

async function turnSubmitCommand(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow,
  prompt: string[],
  mode: ThreadSendMode,
  execution?: { model?: string; reasoningLevel?: ReasoningLevel; acpMode?: string },
  clientRequestId?: string,
  drain = false
): Promise<Parameters<ProductHttpContext['hostHub']['callHostOnlineRpc']>[0]['command']> {
  if (!thread.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const resume = await threadResumeFields(ctx, thread);
  return {
    type: 'turn.submit',
    threadId: thread.id,
    environmentId: thread.environmentId,
    input: prompt,
    mode,
    ...(resume ? { resume } : {}),
    ...(execution?.model ? { model: execution.model } : {}),
    ...(execution?.reasoningLevel ? { reasoningLevel: execution.reasoningLevel } : {}),
    ...(execution?.acpMode ? { acpMode: execution.acpMode } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
    permissionEscalation: drain ? 'deny' : 'ask',
    ...(mode === 'steer' || mode === 'steer-if-active'
      ? (() => {
        const expectedTurnId = findOpenConversationTurn(ctx.db, thread.id)?.turnId;
        return expectedTurnId ? { expectedTurnId } : {};
      })()
      : {})
  };
}

async function threadStartCommandForFork(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow,
  prompt: string[],
  execution?: { model?: string; reasoningLevel?: ReasoningLevel; acpMode?: string },
  clientRequestId?: string
): Promise<Parameters<ProductHttpContext['hostHub']['callHostOnlineRpc']>[0]['command']> {
  if (!thread.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const environment = getEnvironment(ctx.db, thread.environmentId);
  const requestedMode = permissionModeForLaunchProfile(thread.providerId);
  const permissionMode = clampPermissionModeToHost(ctx.db, thread.hostId, requestedMode) ?? requestedMode;
  const sessionTooling = await packConversationSessionTooling(ctx, {
    threadId: thread.id,
    projectId: thread.projectId
  });
  const fork = describeCopiedForkStart(
    listConversationThreadEvents(ctx.db, thread.id),
    getThreadProvider(thread.providerId)?.capabilities.fork
  );
  return {
    type: 'thread.start',
    threadId: thread.id,
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    providerId: thread.providerId,
    input: prompt,
    cwd: environment?.path ?? undefined,
    title: thread.title ?? undefined,
    bridgeLaunch: bridgeLaunchForProvider(thread.providerId, ctx.pluginHostArtifacts),
    permissionMode,
    ...(execution?.model ? { model: execution.model } : {}),
    ...(execution?.reasoningLevel ? { reasoningLevel: execution.reasoningLevel } : {}),
    ...(execution?.acpMode ? { acpMode: execution.acpMode } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
    ...(fork?.sourceProviderThreadId ? { providerThreadId: fork.sourceProviderThreadId } : {}),
    ...(fork?.sourceProviderCheckpointId ? { providerCheckpointId: fork.sourceProviderCheckpointId } : {}),
    ...sessionTooling
  };
}
