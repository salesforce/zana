import {
  archiveConversationThread,
  createConversationThread,
  getConversationThread,
  getEnvironment,
  updateConversationThreadStatus,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { conversationThreadView, flattenThreadInput } from './conversation-create.js';
import { appendClientTurnRequested } from './client-turn-requested.js';
import { destroyEnvironmentIfIdle } from '../environments/environment-cleanup.js';
import {
  bridgeLaunchForProvider,
  permissionModeForLaunchProfile
} from './thread-provider-catalog.js';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export type ThreadSendMode = 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';

export async function sendConversationTurn(
  ctx: ProductHttpContext,
  threadId: string,
  input: unknown,
  mode: ThreadSendMode = 'auto'
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!thread.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const prompt = flattenThreadInput(input).map((part) => part.trim()).filter((part) => part.length > 0);
  if (prompt.length === 0) {
    throw new ThreadCreateError(400, 'invalid-input', 'input is required');
  }
  appendClientTurnRequested(ctx, {
    threadId: thread.id,
    prompt,
    kind: 'new-turn'
  });
  updateConversationThreadStatus(ctx.db, thread.id, 'active');
  await ctx.hostHub.callHostOnlineRpc({
    hostId: thread.hostId,
    command: {
      type: 'turn.submit',
      threadId: thread.id,
      environmentId: thread.environmentId,
      input: prompt,
      mode
    }
  });
  const next = getConversationThread(ctx.db, thread.id) ?? thread;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  return next;
}

export async function stopConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
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
  return next;
}

export async function resumeConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<ConversationThreadRow> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!thread.environmentId || !thread.providerThreadId) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  const environment = getEnvironment(ctx.db, thread.environmentId);
  const dataDir = join(ctx.dataDir, 'thread-bridges', thread.providerId);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  await ctx.hostHub.callHostOnlineRpc({
    hostId: thread.hostId,
    command: {
      type: 'thread.resume',
      threadId: thread.id,
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      providerId: thread.providerId,
      providerThreadId: thread.providerThreadId,
      cwd: environment?.path ?? undefined,
      bridgeLaunch: bridgeLaunchForProvider(thread.providerId, dataDir),
      permissionMode: permissionModeForLaunchProfile(thread.providerId)
    }
  });
  const next = updateConversationThreadStatus(ctx.db, thread.id, 'idle') ?? thread;
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
  return next;
}

export async function archiveConversation(
  ctx: ProductHttpContext,
  threadId: string
): Promise<boolean> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) return false;
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
  return forked;
}
