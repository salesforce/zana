import { assertPlanImplementationReady, assertPlanRevision } from './conversation-plan-implementation.js';
import { withConversationSend, withConversationSendCancellation, type ConversationSendLease } from './conversation-send-guard.js';
import {
  archiveConversationThread,
  createConversationThread,
  getConversationThread,
  getEnvironment,
  getThreadExecutionState,
  listConversationThreadEvents,
  listDueDeferredThreadMessages,
  listLiveConversationThreadsForHost,
  setConversationProviderThreadId,
  unarchiveConversationThread,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import {
  buildForkTranscriptSeed,
  canCloneProviderSession,
  copyForkSourceHistory,
  describeCopiedForkStart,
  resolveConversationForkPoint
} from './conversation-fork-history.js';
import {
  deferConversationSend,
  dropDeferredConversationMessages,
  flushDeferredConversationMessages,
  pauseConversationQueue,
  resumeConversationQueue,
  sendDeferredConversationMessage
} from './conversation-deferred-messages.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { PermissionMode, ReasoningLevel, PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import {
  isHostOfflineError,
  isHostRpcTimeout,
  type ThreadSendMode
} from './conversation-dispatch-checkpoint.js';
import { conversationThreadView, flattenThreadInput } from './conversation-create.js';
import {
  isPlanExecutionMode,
  requestedExecutionModeFromTurn,
  claudeCodePermissionModeForTurn
} from './conversation-execution-mode.js';
import { derivedProviderOptionsForCommand } from './derived-provider-options.js';
import { attachmentMarkersFromInput, hostPromptInputFromInput, resolvePromptAttachmentPath } from '../projects/attachments.js';
import { resolveActivePlanTurn } from './conversation-timeline.js';
import { emitPluginThreadEvent } from '../../plugins/thread-events.js';
import { appendClientTurnRequested } from './client-turn-requested.js';
import { recoverConversationProviderThreadId } from './conversation-provider-identity.js';
import { destroyEnvironmentIfIdle } from '../environments/environment-cleanup.js';
import { revokeThreadDesktopBrowserControl } from '../desktop-browsers.js';
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
import { collectConversationArchiveDescendants } from './conversation-child-ops.js';
import { bridgeLaunchForProvider, getThreadProvider } from './thread-provider-catalog.js';
import { readLastThreadExecution } from './thread-last-execution.js';
import { threadPermissionMode } from './thread-permission-mode.js';
import { packConversationSessionTooling } from './conversation-session-tools.js';
import { withResolvedPluginMentionContext } from '../../plugins/plugin-mentions.js';
import {
  threadPathMentionReaders,
  withResolvedPathMentionContext
} from '../../plugins/path-mentions.js';
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
  execution?: {
    permissionMode?: PermissionMode;
    model?: string;
    reasoningLevel?: ReasoningLevel;
    serviceTier?: 'default' | 'fast';
    acpMode?: string;
    claudeCodePermissionMode?: 'plan';
    providerOptions?: Record<string, unknown>;
  },
  options: { drain?: boolean; resumeQueue?: boolean; compact?: boolean; planRevision?: number } = {}
): Promise<ConversationThreadRow> {
  return withConversationSend(ctx.db, threadId, lease => sendConversationTurnWithLease(lease, ctx, threadId, input, mode, execution, options));
}

async function sendConversationTurnWithLease(
  lease: ConversationSendLease,
  ctx: ProductHttpContext,
  threadId: string,
  input: unknown,
  mode: ThreadSendMode = 'auto',
  execution?: {
    permissionMode?: PermissionMode;
    model?: string;
    reasoningLevel?: ReasoningLevel;
    serviceTier?: 'default' | 'fast';
    acpMode?: string;
    claudeCodePermissionMode?: 'plan';
    providerOptions?: Record<string, unknown>;
  },
  options: { drain?: boolean; resumeQueue?: boolean; compact?: boolean; planRevision?: number } = {}
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  let live = recoverConversationProviderThreadId(ctx.db, thread);
  if (options.planRevision !== undefined) assertPlanImplementationReady(ctx, live, options.planRevision);
  ensureConversationThreadIsWritable(live);
  if (!live.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const permissionMode = threadPermissionMode(ctx, live, execution?.permissionMode);
  const lastExecution = readLastThreadExecution(ctx, live.id);
  execution = {
    ...execution,
    model: execution?.model ?? lastExecution.model ?? undefined,
    reasoningLevel: execution?.reasoningLevel ?? lastExecution.reasoningLevel ?? undefined,
    acpMode: execution?.acpMode ?? lastExecution.acpMode ?? undefined,
    serviceTier: execution?.serviceTier ?? lastExecution.serviceTier
  };
  const serviceTier = execution.serviceTier;
  let packedExecution = { ...execution, permissionMode, serviceTier };
  const requestedMode = requestedExecutionModeFromTurn({ acpMode: execution?.acpMode, input });
  if (options.compact !== true) {
    const claudeCodePermissionMode = claudeCodePermissionModeForTurn(live.providerId, requestedMode);
    const providerOptions = derivedProviderOptionsForCommand({
      providerId: live.providerId,
      threadId: live.id,
      projectId: live.projectId,
      model: execution?.model,
      permissionMode,
      promptMode: requestedMode === 'plan' ? 'plan' : undefined,
      plugins: ctx.plugins
    });
    packedExecution = {
      ...execution,
      permissionMode,
      serviceTier,
      ...(claudeCodePermissionMode ? { claudeCodePermissionMode } : {}),
      ...(providerOptions ? { providerOptions } : {})
    };
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
    ctx.hub.emit('threads:updated', conversationThreadView(ctx, live));
    return live;
  }
  // Direct follow-ups wait only on this thread. The global concurrency cap
  // belongs to host-reconnect fan-out; queuing an idle thread here leaves it
  // without a completion event to trigger its drain.
  const shouldQueue = options.drain !== true && (
    ghostQueue
    || pending
    || !hostOnline
    || (mode === 'queue-if-active' && threadActive)
  );
  if (shouldQueue) {
    deferConversationSend(ctx, { threadId: live.id, input, mode, execution });
    ctx.hub.emit('threads:updated', conversationThreadView(ctx, live));
    return live;
  }
  let resolvedMode = resolveConversationSendMode(live, mode);
  ensureRuntimeCanAcceptActiveSend(ctx, live, resolvedMode);
  const resolvedInput = prependDeferredFirstTurnContext(
    await withResolvedPathMentionContext(
      await withResolvedPluginMentionContext(ctx.plugins, input),
      threadPathMentionReaders(ctx, live.id)
    ),
    resolveDeferredFirstTurnContext(ctx, live.id)
  );
  lease.assertCurrent();
  if (options.planRevision !== undefined) assertPlanImplementationReady(ctx, getConversationThread(ctx.db, threadId) ?? live, options.planRevision);
  live = recoverConversationProviderThreadId(ctx.db, getConversationThread(ctx.db, threadId) ?? live);
  ensureConversationThreadIsWritable(live);
  if (options.drain !== true && mode === 'queue-if-active' && (live.status === 'active' || live.status === 'starting')) {
    deferConversationSend(ctx, { threadId: live.id, input, mode, execution });
    ctx.hub.emit('threads:updated', conversationThreadView(ctx, live));
    return live;
  }
  resolvedMode = resolveConversationSendMode(live, mode);
  const textPrompt = flattenThreadInput(resolvedInput).map((part) => part.trim()).filter((part) => part.length > 0);
  const prompt = hostPromptInputFromInput(
    resolvedInput,
    textPrompt,
    (path) => resolvePromptAttachmentPath(ctx.dataDir, live.projectId, path)
  );
  if (prompt.length === 0) {
    throw new ThreadCreateError(400, 'invalid-input', 'input is required');
  }
  const steerTurnId = resolvedMode === 'steer'
    ? findOpenConversationTurn(ctx.db, live.id)?.turnId ?? null
    : null;
  if (options.compact !== true) {
    recordThreadExecutionMode(ctx.db, { threadId: live.id, requestedMode, effectiveMode: requestedMode });
  }
  const clientRequestId = appendClientTurnRequested(ctx, {
    threadId: live.id,
    prompt: textPrompt,
    promptInput: resolvedInput,
    kind: steerTurnId ? 'steer' : 'new-turn',
    expectedTurnId: steerTurnId,
    permissionMode,
    model: execution?.model,
    reasoningLevel: execution?.reasoningLevel,
    serviceTier,
    acpMode: execution?.acpMode
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
    lease: options.planRevision === undefined ? lease : {
      get cancelled() { return lease.cancelled; },
      retain: () => lease.retain(),
      assertCurrent: () => { lease.assertCurrent(); assertPlanRevision(ctx, threadId, options.planRevision!); }
    },
    thread: live,
    prompt,
    mode: resolvedMode,
    execution: packedExecution,
    clientRequestId,
    input,
    drain: options.drain === true
  });
  const next = getConversationThread(ctx.db, live.id) ?? live;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  if (textPrompt[0] && next.originKind !== 'fork') ctx.threadTitleNamer?.request(next.id, textPrompt[0]);
  // Presence-only signal for plugins (never the marker text/paths themselves).
  const hadAttachments = attachmentMarkersFromInput(
    resolvedInput,
    (path) => resolvePromptAttachmentPath(ctx.dataDir, live.projectId, path)
  ).length > 0;
  emitPluginThreadEvent(ctx, {
    name: 'thread.active',
    threadId: next.id,
    projectId: next.projectId,
    providerId: next.providerId,
    ...(packedExecution?.model ? { model: packedExecution.model } : {}),
    ...(packedExecution?.reasoningLevel ? { reasoningLevel: packedExecution.reasoningLevel } : {}),
    hadAttachments
  });
  return next;
}

async function dispatchTurnSubmit(
  ctx: ProductHttpContext,
  args: {
    lease: ConversationSendLease;
    thread: ConversationThreadRow;
    prompt: PromptInput[];
    mode: ThreadSendMode;
    execution?: {
      permissionMode?: PermissionMode;
      model?: string;
      reasoningLevel?: ReasoningLevel;
      serviceTier?: 'default' | 'fast';
      acpMode?: string;
    };
    clientRequestId?: string;
    input: unknown;
    drain: boolean;
  }
): Promise<void> {
  // Direct sends return promptly; a durable queue claim must wait for acceptance.
  const dispatch = async (command: Parameters<typeof startLiveTurnCommand>[1]['command'], onSuccess?: (result: unknown) => void) => {
    args.lease.assertCurrent();
    if (!args.drain) {
      const release = args.lease.retain();
      try {
        startLiveTurnCommand(ctx, {
          hostId: args.thread.hostId, command,
          onSuccess: result => { try { if (!args.lease.cancelled) onSuccess?.(result); } finally { release(); } },
          onError: (error) => {
            void recoverOrSettleTurnSubmit(ctx, args, error, command.type as 'thread.start' | 'turn.submit').catch(() => undefined).finally(release);
          }
        });
      } catch (error) {
        release();
        throw error;
      }
      return;
    }
    try {
      const result = await ctx.hostHub.callHostOnlineRpc({
        hostId: args.thread.hostId, command, timeoutMs: LIVE_TURN_COMMAND_TIMEOUT_MS
      });
      if (!args.lease.cancelled) onSuccess?.(result);
    } catch (error) {
      await recoverOrSettleTurnSubmit(ctx, args, error, command.type as 'thread.start' | 'turn.submit');
    }
  };
  try {
    if (!args.thread.providerThreadId && args.thread.originKind === 'fork') {
      const command = await threadStartCommandForFork(
        ctx,
        args.thread,
        args.prompt,
        args.execution,
        args.clientRequestId
      );
      await dispatch(command, (result) => {
        const started = result as { providerThreadId?: string };
        if (started?.providerThreadId) setConversationProviderThreadId(ctx.db, args.thread.id, started.providerThreadId);
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
    await dispatch(command);
  } catch (error) {
    if (args.lease.cancelled || (error instanceof ThreadCreateError && error.code === 'stale_plan')) settleLiveTurnCommandFailure(ctx, { thread: args.thread, commandType: 'turn.submit', clientRequestId: args.clientRequestId, error });
    throw error;
  }
}

async function recoverOrSettleTurnSubmit(
  ctx: ProductHttpContext,
  args: {
    lease: ConversationSendLease;
    thread: ConversationThreadRow;
    prompt: PromptInput[];
    mode: ThreadSendMode;
    execution?: {
      permissionMode?: PermissionMode;
      model?: string;
      reasoningLevel?: ReasoningLevel;
      serviceTier?: 'default' | 'fast';
      acpMode?: string;
    };
    clientRequestId?: string;
    input: unknown;
    drain: boolean;
  },
  error: unknown,
  commandType: 'thread.start' | 'turn.submit'
): Promise<void> {
  if (args.lease.cancelled) {
    settleLiveTurnCommandFailure(ctx, { thread: args.thread, commandType, clientRequestId: args.clientRequestId,
      error: new ThreadCreateError(409, 'send_cancelled', 'Send cancelled by Stop or Archive') });
    return;
  }
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
      await resumeConversationOnHost(ctx, current, () => args.lease.assertCurrent());
      const command = await turnSubmitCommand(ctx, current, args.prompt, args.mode, args.execution, args.clientRequestId, args.drain);
      args.lease.assertCurrent();
      await ctx.hostHub.callHostOnlineRpc({
        hostId: current.hostId,
        command,
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
      if (args.drain) throw resumeError;
      return;
    }
  }
  settleLiveTurnCommandFailure(ctx, {
    thread: args.thread,
    commandType,
    clientRequestId: args.clientRequestId,
    error
  });
  if (args.drain) throw error;
}

export async function stopConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  return withConversationSendCancellation(ctx.db, threadId, () => stopConversationInternal(ctx, threadId));
}

async function stopConversationInternal(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  pauseConversationQueue(ctx, thread.id);
  await revokeThreadDesktopBrowserControl(ctx, thread.id).catch(() => {});
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
    projectId: next.projectId,
    providerId: next.providerId
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
  if (!activePlanTurn) {
    throw new ThreadCreateError(409, 'invalid_request', 'Plan mode is not active');
  }
  const result = await ctx.hostHub.callHostOnlineRpc<{ threadId: string; cancelled: boolean }>({
    hostId: thread.hostId,
    command: { type: 'thread.plan.cancel', threadId: thread.id, expectedTurnId: activePlanTurn.turnId }
  });
  const refreshed = getConversationThread(ctx.db, thread.id) ?? thread;
  if (!result.cancelled || result.threadId !== thread.id || resolveActivePlanTurn(ctx, refreshed)) {
    throw new ThreadCreateError(409, 'invalid_request', 'The provider did not confirm that Plan mode exited');
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
  ensureConversationThreadIsWritable(live);
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
  return withConversationSendCancellation(ctx.db, threadId, () => archiveConversationInternal(ctx, threadId, options));
}

async function archiveConversationInternal(
  ctx: ProductHttpContext,
  threadId: string,
  options: { skipEnvironmentCleanup?: boolean } = {}
): Promise<boolean> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) return false;
  await revokeThreadDesktopBrowserControl(ctx, thread.id).catch(() => {});
  if (!options.skipEnvironmentCleanup) {
    const descendants = collectConversationArchiveDescendants(ctx, thread);
    for (const child of descendants) {
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
    projectId: archived.projectId,
    providerId: archived.providerId
  });
  emitPluginThreadEvent(ctx, {
    name: 'thread.deleted',
    threadId: archived.id,
    projectId: archived.projectId,
    providerId: archived.providerId
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
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  if (!environment || ['destroyed', 'destroying', 'failed'].includes(environment.status)) {
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
  const forkCapability = getThreadProvider(thread.providerId)?.capabilities.fork;
  resolveConversationForkPoint({
    events: listConversationThreadEvents(ctx.db, thread.id),
    forkCapability,
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
  const copied = copyForkSourceHistory(ctx.db, {
    sourceThreadId: thread.id,
    targetThreadId: forked.id,
    sourceSeqEnd: options?.sourceSeqEnd
  });
  const pluginSeed = Array.isArray(options?.agentContextSeed) ? options.agentContextSeed : [];
  const transcript = canCloneProviderSession(forkCapability)
    ? null
    : buildForkTranscriptSeed(copied);
  const seed = transcript ? [transcript, ...pluginSeed] : pluginSeed;
  if (seed.length > 0) {
    const inherited = readLastThreadExecution(ctx, thread.id);
    appendClientTurnRequested(ctx, {
      model: inherited.model ?? undefined,
      reasoningLevel: inherited.reasoningLevel ?? undefined,
      acpMode: inherited.acpMode ?? undefined,
      serviceTier: inherited.serviceTier,
      threadId: forked.id,
      prompt: [],
      promptInput: seed,
      permissionMode: threadPermissionMode(ctx, forked),
      kind: 'thread-start'
    });
  }
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, forked));
  emitPluginThreadEvent(ctx, {
    name: 'thread.created',
    threadId: forked.id,
    projectId: forked.projectId,
    providerId: forked.providerId
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
  try {
    await flushDeferredConversationMessages(ctx, threadId, async (payload) => {
      await sendConversationTurn(ctx, threadId, payload.input, payload.mode, payload.execution, { drain: true });
    }, options);
  } finally {
    const thread = getConversationThread(ctx.db, threadId);
    if (thread) ctx.hub.emit('threads:updated', conversationThreadView(ctx, thread));
  }
}

export async function sendHeldConversationMessage(
  ctx: ProductHttpContext,
  threadId: string,
  itemId: string
): Promise<void> {
  try {
    await sendDeferredConversationMessage(ctx, threadId, itemId, async (payload) => {
      await sendConversationTurn(ctx, threadId, payload.input, payload.mode, payload.execution, { drain: true });
    });
  } finally {
    const thread = getConversationThread(ctx.db, threadId);
    if (thread) ctx.hub.emit('threads:updated', conversationThreadView(ctx, thread));
  }
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
        projectId: next.projectId,
        providerId: next.providerId
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
  prompt: PromptInput[],
  mode: ThreadSendMode,
  execution?: {
    permissionMode?: PermissionMode;
    model?: string;
    reasoningLevel?: ReasoningLevel;
    serviceTier?: 'default' | 'fast';
    acpMode?: string;
    claudeCodePermissionMode?: 'plan';
    providerOptions?: Record<string, unknown>;
  },
  clientRequestId?: string,
  drain = false
): Promise<Parameters<ProductHttpContext['hostHub']['callHostOnlineRpc']>[0]['command']> {
  if (!thread.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const resume = await threadResumeFields(ctx, thread, execution?.permissionMode);
  return {
    type: 'turn.submit',
    threadId: thread.id,
    environmentId: thread.environmentId,
    input: prompt,
    mode,
    ...(resume ? { resume } : {}),
    ...(execution?.model ? { model: execution.model } : {}),
    ...(execution?.reasoningLevel ? { reasoningLevel: execution.reasoningLevel } : {}),
    ...(execution?.serviceTier ? { serviceTier: execution.serviceTier } : {}),
    ...(execution?.acpMode ? { acpMode: execution.acpMode } : {}),
    ...(execution?.claudeCodePermissionMode
      ? { claudeCodePermissionMode: execution.claudeCodePermissionMode }
      : {}),
    ...(execution?.providerOptions ? { providerOptions: execution.providerOptions } : {}),
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
  prompt: PromptInput[],
  execution?: {
    permissionMode?: PermissionMode;
    model?: string;
    reasoningLevel?: ReasoningLevel;
    serviceTier?: 'default' | 'fast';
    acpMode?: string;
    claudeCodePermissionMode?: 'plan';
    providerOptions?: Record<string, unknown>;
  },
  clientRequestId?: string
): Promise<Parameters<ProductHttpContext['hostHub']['callHostOnlineRpc']>[0]['command']> {
  if (!thread.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const environment = getEnvironment(ctx.db, thread.environmentId);
  const permissionMode = threadPermissionMode(ctx, thread, execution?.permissionMode);
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
    ...(execution?.serviceTier ? { serviceTier: execution.serviceTier } : {}),
    ...(execution?.acpMode ? { acpMode: execution.acpMode } : {}),
    ...(execution?.claudeCodePermissionMode
      ? { claudeCodePermissionMode: execution.claudeCodePermissionMode }
      : {}),
    ...(execution?.providerOptions ? { providerOptions: execution.providerOptions } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
    ...(fork?.sourceProviderThreadId ? { providerThreadId: fork.sourceProviderThreadId } : {}),
    ...(fork?.sourceProviderCheckpointId ? { providerCheckpointId: fork.sourceProviderCheckpointId } : {}),
    ...sessionTooling
  };
}
