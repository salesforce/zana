import {
  archiveConversationThread,
  createConversationThread,
  getConversationThread,
  getEnvironment,
  updateConversationThreadStatus,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import { conversationThreadView, flattenThreadInput } from './conversation-create.js';
import { resolveActivePlanTurn } from './conversation-timeline.js';
import { emitPluginThreadEvent } from '../../plugins/thread-events.js';
import { appendClientTurnRequested } from './client-turn-requested.js';
import { recoverConversationProviderThreadId } from './conversation-provider-identity.js';
import { destroyEnvironmentIfIdle } from '../environments/environment-cleanup.js';
import {
  bridgeLaunchForProvider,
  permissionModeForLaunchProfile
} from './thread-provider-catalog.js';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ThreadResumeFields } from '@zana-ai/zcc-contracts/host-rpc';

export type ThreadSendMode = 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';

export async function sendConversationTurn(
  ctx: ProductHttpContext,
  threadId: string,
  input: unknown,
  mode: ThreadSendMode = 'auto',
  execution?: { model?: string; reasoningLevel?: ReasoningLevel }
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const live = recoverConversationProviderThreadId(ctx.db, thread);
  if (!live.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) {
    throw new ThreadCreateError(
      409,
      'awaiting_user_interaction',
      'Thread is awaiting user interaction. Resolve the pending interaction before sending another prompt.'
    );
  }
  const prompt = flattenThreadInput(input).map((part) => part.trim()).filter((part) => part.length > 0);
  if (prompt.length === 0) {
    throw new ThreadCreateError(400, 'invalid-input', 'input is required');
  }
  const clientRequestId = appendClientTurnRequested(ctx, {
    threadId: live.id,
    prompt,
    promptInput: input,
    kind: 'new-turn',
    model: execution?.model,
    reasoningLevel: execution?.reasoningLevel
  });
  updateConversationThreadStatus(ctx.db, live.id, 'active');
  try {
    try {
      await submitTurnOnHost(ctx, live, prompt, mode, execution, clientRequestId);
    } catch (error) {
      if (!isUnknownThreadHostError(error)) throw error;
      const current = recoverConversationProviderThreadId(
        ctx.db,
        getConversationThread(ctx.db, live.id) ?? live
      );
      await resumeConversationOnHost(ctx, current);
      await submitTurnOnHost(ctx, current, prompt, mode, execution, clientRequestId);
    }
  } catch (error) {
    failActiveConversationTurn(ctx, live);
    throw error;
  }
  const next = getConversationThread(ctx.db, live.id) ?? live;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  if (prompt[0] && next.originKind !== 'fork') ctx.threadTitleNamer?.request(next.id, prompt[0]);
  emitPluginThreadEvent(ctx, {
    name: 'thread.active',
    threadId: next.id,
    projectId: next.projectId
  });
  return next;
}

function failActiveConversationTurn(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow
): void {
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

export async function stopConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  ctx.pendingInteractions.interruptPendingInteractionsForThreadIds({
    threadIds: [thread.id],
    reason: 'thread-stopped'
  });
  updateConversationThreadStatus(ctx.db, thread.id, 'stopping');
  try {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: thread.hostId,
      command: { type: 'thread.stop', threadId: thread.id }
    });
  } catch {
    /* Host may already have dropped the runtime. */
  }
  const next = updateConversationThreadStatus(ctx.db, thread.id, 'idle') ?? thread;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  emitPluginThreadEvent(ctx, {
    name: 'thread.idle',
    threadId: next.id,
    projectId: next.projectId
  });
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
  await ctx.hostHub.callHostOnlineRpc({
    hostId: thread.hostId,
    command: {
      type: 'thread.plan.cancel',
      threadId: thread.id,
      expectedTurnId: activePlanTurn.turnId
    }
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
  const next = updateConversationThreadStatus(ctx.db, live.id, 'idle') ?? live;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  return next;
}

export async function archiveConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<boolean> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) return false;
  ctx.pendingInteractions.interruptPendingInteractionsForThreadIds({
    threadIds: [thread.id],
    reason: 'thread-deleted'
  });
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
  if (thread.environmentId) await destroyEnvironmentIfIdle(ctx, thread.environmentId);
  return true;
}

export async function forkConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!thread.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const forked = createConversationThread(ctx.db, {
    projectId: thread.projectId,
    hostId: thread.hostId,
    environmentId: thread.environmentId,
    providerId: thread.providerId,
    title: thread.title ? `${thread.title} (fork)` : 'Forked thread',
    status: 'idle',
    parentThreadId: thread.id,
    originKind: 'fork'
  });
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

function isUnknownThreadHostError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code: unknown }).code === 'unknown_thread'
  );
}

function threadResumeFields(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow
): ThreadResumeFields | undefined {
  if (!thread.providerThreadId) return undefined;
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : undefined;
  const dataDir = join(ctx.dataDir, 'thread-bridges', thread.providerId);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    projectId: thread.projectId,
    providerId: thread.providerId,
    providerThreadId: thread.providerThreadId,
    cwd: environment?.path ?? undefined,
    bridgeLaunch: bridgeLaunchForProvider(thread.providerId, dataDir),
    permissionMode: permissionModeForLaunchProfile(thread.providerId)
  };
}

async function submitTurnOnHost(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow,
  prompt: string[],
  mode: ThreadSendMode,
  execution?: { model?: string; reasoningLevel?: ReasoningLevel },
  clientRequestId?: string
): Promise<void> {
  if (!thread.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const resume = threadResumeFields(ctx, thread);
  await ctx.hostHub.callHostOnlineRpc({
    hostId: thread.hostId,
    command: {
      type: 'turn.submit',
      threadId: thread.id,
      environmentId: thread.environmentId,
      input: prompt,
      mode,
      ...(resume ? { resume } : {}),
      ...(execution?.model ? { model: execution.model } : {}),
      ...(execution?.reasoningLevel ? { reasoningLevel: execution.reasoningLevel } : {}),
      ...(clientRequestId ? { clientRequestId } : {})
    }
  });
}

async function resumeConversationOnHost(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow
): Promise<void> {
  if (!thread.environmentId || !thread.providerThreadId) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  const resume = threadResumeFields(ctx, thread);
  if (!resume) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  await ctx.hostHub.callHostOnlineRpc({
    hostId: thread.hostId,
    command: {
      type: 'thread.resume',
      threadId: thread.id,
      environmentId: thread.environmentId,
      ...resume
    }
  });
}
