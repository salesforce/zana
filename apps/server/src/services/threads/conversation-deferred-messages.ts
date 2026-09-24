import {
  DEFERRED_THREAD_MESSAGE_CAP,
  countActiveConversationTurns,
  countDeferredThreadMessages,
  createDeferredThreadMessage,
  deleteDeferredThreadMessage,
  deleteDeferredThreadMessagesForThread,
  getConversationThread,
  getDeferredThreadMessage,
  isThreadQueueAutoSendPaused,
  listDueDeferredThreadMessages,
  listRetryableDeferredThreadMessages,
  retryDeferredThreadMessage,
  postponeDeferredThreadRetry,
  markDeferredThreadMessageDispatching,
  markDeferredThreadMessageFailed,
  pauseDeferredThreadMessagesForThread,
  requeueDeferredThreadMessagesForThread,
  resumeDeferredThreadMessagesForThread,
  type DeferredThreadMessageRow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { PermissionMode, ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ThreadSendMode } from './conversation-dispatch-checkpoint.js';
import { canDispatch } from './conversation-dispatch-checkpoint.js';
import { findOpenConversationTurn } from './conversation-host-recovery.js';

export interface DeferredSendPayload {
  kind: 'send';
  input: unknown;
  mode: ThreadSendMode;
  execution?: { permissionMode?: PermissionMode; model?: string; reasoningLevel?: ReasoningLevel; serviceTier?: 'default' | 'fast'; acpMode?: string };
  senderThreadId?: string;
}

function isDeferredSendPayload(value: unknown): value is DeferredSendPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as { kind?: unknown; input?: unknown; mode?: unknown };
  return record.kind === 'send';
}

export function parseDeferredSendPayload(row: DeferredThreadMessageRow): DeferredSendPayload {
  const parsed: unknown = JSON.parse(row.payload);
  if (!isDeferredSendPayload(parsed)) {
    throw new Error(`malformed deferred thread message ${row.id}`);
  }
  return parsed;
}

export function deferConversationSend(
  ctx: ProductHttpContext,
  args: {
    threadId: string;
    input: unknown;
    mode: ThreadSendMode;
    execution?: { permissionMode?: PermissionMode; model?: string; reasoningLevel?: ReasoningLevel; serviceTier?: 'default' | 'fast'; acpMode?: string };
    senderThreadId?: string;
    sendAfter?: number | null;
    paused?: boolean;
    groupBoundaryId?: string | null;
  }
): DeferredThreadMessageRow {
  if (countDeferredThreadMessages(ctx.db, args.threadId) >= DEFERRED_THREAD_MESSAGE_CAP) {
    throw new ThreadCreateError(
      409,
      'deferred_queue_full',
      'Too many messages are waiting for this thread. Answer the pending question first.'
    );
  }
  return createDeferredThreadMessage(ctx.db, {
    threadId: args.threadId,
    kind: 'send',
    payload: JSON.stringify({
      kind: 'send',
      input: args.input,
      mode: args.mode,
      ...(args.execution ? { execution: args.execution } : {}),
      ...(args.senderThreadId ? { senderThreadId: args.senderThreadId } : {})
    } satisfies DeferredSendPayload),
    sendAfter: args.sendAfter ?? null,
    paused: args.paused === true || isThreadQueueAutoSendPaused(ctx.db, args.threadId),
    groupBoundaryId: args.groupBoundaryId ?? null
  });
}

export function pauseConversationQueue(ctx: ProductHttpContext, threadId: string): number {
  return pauseDeferredThreadMessagesForThread(ctx.db, threadId);
}

export function resumeConversationQueue(ctx: ProductHttpContext, threadId: string): number {
  return resumeDeferredThreadMessagesForThread(ctx.db, threadId);
}

export function dropDeferredConversationMessages(ctx: ProductHttpContext, threadId: string): void {
  deleteDeferredThreadMessagesForThread(ctx.db, threadId);
}

export function dropDeferredConversationMessage(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string,
  itemId: string
): void {
  if (!getConversationThread(ctx.db, threadId)) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!deleteDeferredThreadMessage(ctx.db, { id: itemId, threadId })) {
    throw new ThreadCreateError(404, 'unknown-queued-send', 'queued send was not found');
  }
}

export function conversationQueueIsPaused(ctx: ProductHttpContext, threadId: string): boolean {
  return isThreadQueueAutoSendPaused(ctx.db, threadId);
}

function hostOnline(ctx: ProductHttpContext, hostId: string): boolean {
  return ctx.hostHub.connectedHostIds?.().includes(hostId) === true;
}

/** Retry only failures known to precede acceptance, never an ambiguous timeout/disconnect. */
export function isRetryableDeferredFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message, delivery } = error as { code?: string; message?: string; delivery?: string };
  if (error instanceof ThreadCreateError) return ['already_active', 'host_unavailable', 'awaiting_user_interaction'].includes(code ?? '');
  if (code === 'host-unavailable' && /\bis not connected\b/.test(message ?? '')) return true;
  return delivery === 'rejected' && ['already_active', 'already-active', 'busy', 'temporarily_unavailable'].includes(code ?? '');
}

/** Recheck admission before reviving a failed row; a timer never resumes a paused queue. */
export async function retryDueConversationSends(
  ctx: ProductHttpContext,
  flush: (threadId: string) => Promise<void>,
  now = Date.now()
): Promise<void> {
  const groups = new Map<string, DeferredThreadMessageRow[]>();
  for (const row of listRetryableDeferredThreadMessages(ctx.db, now)) {
    const group = groups.get(row.threadId) ?? [];
    group.push(row);
    groups.set(row.threadId, group);
  }
  for (const [threadId, rows] of groups) {
    const row = rows[0]!;
    const thread = getConversationThread(ctx.db, row.threadId);
    if (!thread) continue;
    const decision = canDispatch({
      archived: Boolean(thread.archivedAt),
      queuePaused: isThreadQueueAutoSendPaused(ctx.db, row.threadId),
      pendingInteraction: ctx.pendingInteractions.hasPendingThreadInteraction(row.threadId),
      hostOnline: hostOnline(ctx, thread.hostId),
      sendAfter: row.sendAfter,
      liveActiveCount: countActiveConversationTurns(ctx.db),
      threadActive: thread.status === 'active' || thread.status === 'starting'
        || findOpenConversationTurn(ctx.db, row.threadId) != null,
      now
    });
    if (decision.kind !== 'allow') {
      for (const candidate of rows) postponeDeferredThreadRetry(ctx.db, candidate, now);
      continue;
    }
    let claimed = false;
    for (const candidate of rows) if (retryDeferredThreadMessage(ctx.db, candidate, now)) claimed = true;
    if (claimed) await flush(threadId);
  }
}

function groupedFlushPrefix(rows: DeferredThreadMessageRow[]): DeferredThreadMessageRow[] {
  const first = rows[0];
  if (!first) return [];
  if (!first.groupBoundaryId) return [first];
  const grouped = [first];
  for (const row of rows.slice(1)) {
    if (row.groupBoundaryId !== first.groupBoundaryId) break;
    grouped.push(row);
  }
  return grouped;
}

function mergeDeferredSendPayloads(rows: DeferredThreadMessageRow[]): DeferredSendPayload {
  const payloads = rows.map(parseDeferredSendPayload);
  const first = payloads[0]!;
  if (payloads.length === 1) return first;
  const input = payloads.flatMap((payload) => (Array.isArray(payload.input) ? payload.input : [payload.input]));
  return { ...first, input };
}

export interface FlushDeferredResult {
  flushed: number;
  delayed?: string;
}

export interface FlushDeferredOptions {
  force?: boolean;
  /** Host reconnect fan-out only — per-thread idle/Send now ignore the global cap. */
  enforceConcurrencyCap?: boolean;
}

function forceFlushError(reason: string): ThreadCreateError {
  if (reason === 'pending-interaction') {
    return new ThreadCreateError(
      409,
      'awaiting_user_interaction',
      'Thread is awaiting user interaction. Resolve the pending interaction before sending another prompt.'
    );
  }
  if (reason === 'host-offline') {
    return new ThreadCreateError(502, 'host_unavailable', 'Host daemon is not connected');
  }
  if (reason === 'thread-archived') {
    return new ThreadCreateError(409, 'archived', 'Thread is archived');
  }
  if (reason === 'unknown-thread') {
    return new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  return new ThreadCreateError(409, reason.replace(/-/g, '_'), 'Could not send queued messages');
}

/** Explicitly send one row without resuming, regrouping, or retrying its neighbors. */
export async function sendDeferredConversationMessage(
  ctx: ProductHttpContext,
  threadId: string,
  itemId: string,
  deliver: (payload: DeferredSendPayload) => Promise<void>
): Promise<void> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) throw forceFlushError('unknown-thread');
  if (thread.archivedAt) throw forceFlushError('thread-archived');
  if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) throw forceFlushError('pending-interaction');
  if (!hostOnline(ctx, thread.hostId)) throw forceFlushError('host-offline');
  const row = getDeferredThreadMessage(ctx.db, { id: itemId, threadId });
  if (!row) throw new ThreadCreateError(404, 'unknown-queued-send', 'queued send was not found');
  // Auto-drain and repeated clicks compete for the same atomic claim. Never
  // reclaim an in-flight row: that can submit the same prompt twice.
  if (!markDeferredThreadMessageDispatching(ctx.db, { id: itemId, threadId, retryFailed: true })) {
    throw new ThreadCreateError(409, 'queued-send-dispatching', 'This message is already being sent');
  }
  try {
    await deliver(parseDeferredSendPayload(row));
    deleteDeferredThreadMessage(ctx.db, { id: itemId, threadId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'dispatch-failed';
    markDeferredThreadMessageFailed(ctx.db, { id: itemId, threadId, reason, retryable: isRetryableDeferredFailure(error) });
    throw error instanceof ThreadCreateError ? error : new ThreadCreateError(502, 'dispatch-failed', reason);
  }
}

/**
 * Deliver held sends in arrival order once the thread is no longer blocked.
 * Stops at the first delay or failed dispatch. Failed rows stay failed on
 * auto-drain. The separate bounded retry sweep revives safe transient failures.
 * Force / Send now requeues them. Manual stop
 * leaves rows paused until an explicit resume.
 */
export async function flushDeferredConversationMessages(
  ctx: ProductHttpContext,
  threadId: string,
  deliver: (payload: DeferredSendPayload) => Promise<void>,
  options: FlushDeferredOptions = {}
): Promise<FlushDeferredResult> {
  if (options.force) {
    resumeDeferredThreadMessagesForThread(ctx.db, threadId);
    requeueDeferredThreadMessagesForThread(ctx.db, threadId);
  }
  const live = getConversationThread(ctx.db, threadId);
  if (!live) {
    if (options.force) throw forceFlushError('unknown-thread');
    return { flushed: 0 };
  }
  if (live.archivedAt) {
    if (options.force) throw forceFlushError('thread-archived');
    return { flushed: 0 };
  }
  if (!options.force && isThreadQueueAutoSendPaused(ctx.db, threadId)) {
    return { flushed: 0, delayed: 'queue-paused' };
  }
  if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) {
    if (options.force) throw forceFlushError('pending-interaction');
    return { flushed: 0, delayed: 'pending-interaction' };
  }

  let flushed = 0;
  for (;;) {
    const due = listDueDeferredThreadMessages(ctx.db, { threadId });
    const prefix = groupedFlushPrefix(due);
    if (prefix.length === 0) return { flushed };
    if (!options.force && isThreadQueueAutoSendPaused(ctx.db, threadId)) {
      return { flushed, delayed: 'queue-paused' };
    }
    if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) {
      if (options.force) throw forceFlushError('pending-interaction');
      return { flushed, delayed: 'pending-interaction' };
    }
    const live = getConversationThread(ctx.db, threadId);
    if (!live || live.archivedAt) return { flushed };
    const first = prefix[0]!;
    // Dispatch marks the thread active before the host's turn-start event arrives.
    // Keep the next message queued through that gap as well.
    const threadBusy = live.status === 'active' || live.status === 'starting'
      || findOpenConversationTurn(ctx.db, threadId) != null;
    const decision = canDispatch({
      archived: Boolean(live.archivedAt),
      queuePaused: options.force ? false : isThreadQueueAutoSendPaused(ctx.db, threadId),
      pendingInteraction: ctx.pendingInteractions.hasPendingThreadInteraction(threadId),
      hostOnline: hostOnline(ctx, live.hostId),
      sendAfter: options.force ? null : first.sendAfter,
      liveActiveCount: options.enforceConcurrencyCap ? countActiveConversationTurns(ctx.db) : 0,
      threadActive: options.force ? false : threadBusy
    });
    if (decision.kind === 'delay') {
      if (options.force) throw forceFlushError(decision.reason);
      return { flushed, delayed: decision.reason };
    }
    if (decision.kind === 'reject') {
      for (const row of prefix) {
        markDeferredThreadMessageFailed(ctx.db, {
          id: row.id,
          threadId,
          reason: decision.reason
        });
      }
      if (options.force) throw forceFlushError(decision.reason);
      return { flushed, delayed: decision.reason };
    }
    const claimed: DeferredThreadMessageRow[] = [];
    for (const row of prefix) {
      if (!markDeferredThreadMessageDispatching(ctx.db, { id: row.id, threadId })) continue;
      claimed.push(row);
    }
    if (claimed.length === 0) return { flushed };
    try {
      await deliver(mergeDeferredSendPayloads(claimed));
      for (const row of claimed) deleteDeferredThreadMessage(ctx.db, { id: row.id, threadId });
      flushed += claimed.length;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'dispatch-failed';
      for (const row of claimed) {
        markDeferredThreadMessageFailed(ctx.db, { id: row.id, threadId, reason, retryable: isRetryableDeferredFailure(error) });
      }
      if (options.force) {
        throw error instanceof ThreadCreateError
          ? error
          : new ThreadCreateError(502, 'dispatch-failed', reason);
      }
      return { flushed, delayed: 'dispatch-failed' };
    }
  }
}
