import {
  DEFERRED_THREAD_MESSAGE_CAP,
  clearLapsedDeferredEditHolds,
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
  claimDeferredThreadMessageGroup,
  markDeferredThreadMessageDispatching,
  holdDeferredThreadMessage,
  holdDeferredThreadMessageForEdit,
  markDeferredThreadMessageFailed,
  pauseDeferredThreadMessagesForThread,
  releaseDeferredThreadMessageEditHold,
  requeueDeferredThreadMessagesForThread,
  resumeDeferredThreadMessagesForThread,
  updateDeferredThreadMessagePayload,
  type ConversationThreadRow,
  type DeferredThreadMessageRow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { PermissionMode, ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ThreadSendMode } from './conversation-dispatch-checkpoint.js';
import { canDispatch } from './conversation-dispatch-checkpoint.js';
import { findOpenConversationTurn } from './conversation-host-recovery.js';
import { recoverConversationProviderThreadId } from './conversation-provider-identity.js';
import { conversationNextTurnItemView } from './conversation-next-turn.js';

export interface DeferredSendPayload {
  kind: 'send';
  input: unknown;
  mode: ThreadSendMode;
  execution?: { permissionMode?: PermissionMode; model?: string; reasoningLevel?: ReasoningLevel; serviceTier?: string; acpMode?: string };
  senderThreadId?: string;
  admission?: { generation: number; overrideable: boolean; reason: string; pluginId?: string };
}

/** Drain callers must retain their claimed row rather than enqueueing a replacement. */
export class DeferredAdmissionWait extends Error {
  constructor(readonly admission: NonNullable<DeferredSendPayload['admission']>) {
    super(admission.reason);
    this.name = 'DeferredAdmissionWait';
  }
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
    execution?: { permissionMode?: PermissionMode; model?: string; reasoningLevel?: ReasoningLevel; serviceTier?: string; acpMode?: string };
    senderThreadId?: string;
    sendAfter?: number | null;
    paused?: boolean;
    groupBoundaryId?: string | null;
    admission?: DeferredSendPayload['admission'];
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
      ...(args.senderThreadId ? { senderThreadId: args.senderThreadId } : {}),
      ...(args.admission ? { admission: args.admission } : {})
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

/** A queued-message editor renews its lease every quarter of this. */
export const DEFERRED_EDIT_HOLD_LEASE_MS = 120_000;
/** Bounds what one edit may write into the durable queue. */
export const MAX_QUEUED_EDIT_TEXT_CHARS = 100_000;

function requireQueuedThread(ctx: Pick<ProductHttpContext, 'db'>, threadId: string): void {
  if (!getConversationThread(ctx.db, threadId)) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
}

const unknownQueuedSend = () => new ThreadCreateError(404, 'unknown-queued-send', 'Queued message not found');
const queuedSendDispatching = () => new ThreadCreateError(409, 'queued-send-dispatching', 'Queued message is already being sent');

/**
 * Take or renew the editor's lease. The server picks the length (the client only
 * learns it), the row stays in the queue, and the lease lapses by itself.
 */
export function holdDeferredConversationMessageForEdit(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string,
  itemId: string,
  now = Date.now()
): { leaseMs: number; heldUntil: number } {
  requireQueuedThread(ctx, threadId);
  const heldUntil = now + DEFERRED_EDIT_HOLD_LEASE_MS;
  const outcome = holdDeferredThreadMessageForEdit(ctx.db, { id: itemId, threadId, heldUntil });
  if (outcome === 'not_found') throw unknownQueuedSend();
  if (outcome === 'claimed') throw queuedSendDispatching();
  return { leaseMs: DEFERRED_EDIT_HOLD_LEASE_MS, heldUntil };
}

/** Idempotent cancel; true means a lease was cleared and the queue should be re-attempted. */
export function releaseDeferredConversationMessageEditHold(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string,
  itemId: string
): boolean {
  requireQueuedThread(ctx, threadId);
  return releaseDeferredThreadMessageEditHold(ctx.db, { id: itemId, threadId });
}

function isTextPart(part: unknown): part is { type: 'text'; text: string; mentions?: unknown } {
  return !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'text';
}

/** Swap the message text for the edit, keeping attachments and every other payload field. */
function withEditedText(payload: DeferredSendPayload, text: string): DeferredSendPayload {
  if (!Array.isArray(payload.input)) return { ...payload, input: text };
  const parts: unknown[] = payload.input;
  const firstText = parts.find(isTextPart);
  const rest = parts.filter((part) => !isTextPart(part));
  if (text.trim().length === 0) return { ...payload, input: rest };
  // Mention offsets belong to the old text, so they cannot survive an edit.
  const replacement = { ...(firstText ?? {}), type: 'text', text, mentions: [] };
  if (!firstText) return { ...payload, input: [replacement, ...rest] };
  return { ...payload, input: parts.flatMap((part) => (part === firstText ? [replacement] : isTextPart(part) ? [] : [part])) };
}

/**
 * Save an edit: replaces the text, ends the lease and moves the revision in one
 * write, so the drain can only ever send the version the user last saved.
 */
export function saveDeferredConversationMessageEdit(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string,
  itemId: string,
  args: { text: string; expectedUpdatedAt?: number }
): { item: ReturnType<typeof conversationNextTurnItemView>; releasedEditHold: boolean } {
  requireQueuedThread(ctx, threadId);
  if (args.text.length > MAX_QUEUED_EDIT_TEXT_CHARS) {
    throw new ThreadCreateError(413, 'queued_message_too_long', 'Queued message is too long');
  }
  const row = getDeferredThreadMessage(ctx.db, { id: itemId, threadId });
  if (!row) throw unknownQueuedSend();
  let payload: DeferredSendPayload;
  try {
    payload = parseDeferredSendPayload(row);
  } catch {
    throw new ThreadCreateError(422, 'malformed-queued-send', 'Queued message cannot be edited');
  }
  const edited = withEditedText(payload, args.text);
  if (typeof edited.input === 'string' ? edited.input.trim().length === 0 : Array.isArray(edited.input) && edited.input.length === 0) {
    throw new ThreadCreateError(400, 'empty_queued_message', 'Queued message cannot be empty');
  }
  const result = updateDeferredThreadMessagePayload(ctx.db, {
    id: itemId, threadId, payload: JSON.stringify(edited),
    ...(args.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: args.expectedUpdatedAt } : {})
  });
  if (result.kind === 'not_found') throw unknownQueuedSend();
  if (result.kind === 'claimed') throw queuedSendDispatching();
  if (result.kind === 'stale') {
    throw new ThreadCreateError(409, 'queued-send-changed', 'Queued message changed; reopen it to edit the latest text');
  }
  return { item: conversationNextTurnItemView(result.row), releasedEditHold: result.releasedEditHold };
}

/**
 * Leases normally end by save/cancel. One that lapses (abandoned tab, quit app,
 * server restart) is cleared here so the row that was waiting on it drains.
 */
export async function wakeLapsedEditHolds(
  ctx: Pick<ProductHttpContext, 'db'>,
  flush: (threadId: string) => Promise<void>,
  now = Date.now()
): Promise<void> {
  for (const threadId of clearLapsedDeferredEditHolds(ctx.db, now)) {
    try { await flush(threadId); } catch { /* the next sweep or idle drain retries */ }
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

function isEditHeldGroup(rows: DeferredThreadMessageRow[], now: number): boolean {
  return rows.some((row) => row.editHeldUntil !== null && row.editHeldUntil > now);
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
  deliver: (payload: DeferredSendPayload) => Promise<void>,
  expectedUpdatedAt?: number
): Promise<void> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) throw forceFlushError('unknown-thread');
  if (thread.archivedAt) throw forceFlushError('thread-archived');
  if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) throw forceFlushError('pending-interaction');
  if (!hostOnline(ctx, thread.hostId)) throw forceFlushError('host-offline');
  const row = getDeferredThreadMessage(ctx.db, { id: itemId, threadId });
  if (!row) throw new ThreadCreateError(404, 'unknown-queued-send', 'queued send was not found');
  if (expectedUpdatedAt !== undefined && row.updatedAt !== expectedUpdatedAt) {
    throw new ThreadCreateError(409, 'queued-send-changed', 'Queued message changed; confirm again');
  }
  // Auto-drain and repeated clicks compete for the same atomic claim. Never
  // reclaim an in-flight row: that can submit the same prompt twice.
  if (!markDeferredThreadMessageDispatching(ctx.db, { id: itemId, threadId, retryFailed: true, overrideEditHold: true, ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}) })) {
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

export function isSteerSendMode(mode: ThreadSendMode | undefined): boolean {
  return mode === 'steer' || mode === 'steer-if-active';
}

/**
 * Steer held sends into the live turn, ahead of ordinary queued follow-ups.
 * A steer sent while the turn was still starting, or while the host was
 * reconnecting, waits here until a turn is live. If it cannot land, it is
 * demoted to an ordinary follow-up so the idle drain still delivers it.
 */
/** A steer has nowhere to land until the thread's first turn is starting on the host. */
export function awaitsSteerTarget(db: ProductHttpContext['db'], thread: ConversationThreadRow): boolean {
  if (thread.status === 'starting') return true;
  return thread.status === 'active'
    && thread.originKind !== 'fork'
    && !recoverConversationProviderThreadId(db, thread).providerThreadId;
}

export async function flushHeldConversationSteers(
  ctx: ProductHttpContext,
  threadId: string,
  deliver: (payload: DeferredSendPayload) => Promise<void>,
  now = Date.now()
): Promise<number> {
  const live = getConversationThread(ctx.db, threadId);
  if (!live || live.archivedAt || live.status !== 'active' || awaitsSteerTarget(ctx.db, live)) return 0;
  if (!hostOnline(ctx, live.hostId)) return 0;
  if (isThreadQueueAutoSendPaused(ctx.db, threadId)) return 0;
  if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) return 0;
  let flushed = 0;
  for (const row of listDueDeferredThreadMessages(ctx.db, { threadId, now })) {
    if (row.groupBoundaryId || (row.editHeldUntil !== null && row.editHeldUntil > now)) continue;
    const payload = parseDeferredSendPayload(row);
    if (!isSteerSendMode(payload.mode) || payload.admission) continue;
    if (!markDeferredThreadMessageDispatching(ctx.db, { id: row.id, threadId })) continue;
    try {
      await deliver(payload);
      deleteDeferredThreadMessage(ctx.db, { id: row.id, threadId });
      flushed += 1;
    } catch (error) {
      const demoted: DeferredSendPayload = error instanceof DeferredAdmissionWait
        ? { ...payload, admission: error.admission }
        : { ...payload, mode: 'queue-if-active' };
      holdDeferredThreadMessage(ctx.db, { id: row.id, threadId, payload: JSON.stringify(demoted) });
      if (error instanceof DeferredAdmissionWait) continue;
      return flushed;
    }
  }
  return flushed;
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
    // An open editor owns the first group until it saves, cancels or its lease
    // lapses. Rows behind it wait so the edited message still goes first. An
    // explicit Send now (force) is the user overriding their own edit.
    if (!options.force && isEditHeldGroup(prefix, Date.now())) return { flushed, delayed: 'edit-held' };
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
    // The durable claim covers admission, attachments and provider preparation,
    // before the thread itself becomes active. Concurrent drains must wait here.
    if (!claimDeferredThreadMessageGroup(ctx.db, {
      threadId, rows: prefix, ...(options.force ? { overrideEditHold: true } : {})
    })) return { flushed, delayed: 'dispatch-in-progress' };
    const claimed = prefix;
    try {
      await deliver(mergeDeferredSendPayloads(claimed));
      for (const row of claimed) deleteDeferredThreadMessage(ctx.db, { id: row.id, threadId });
      flushed += claimed.length;
    } catch (error) {
      if (error instanceof DeferredAdmissionWait) {
        ctx.db.transaction(() => {
          for (const row of claimed) {
            holdDeferredThreadMessage(ctx.db, {
              id: row.id, threadId,
              payload: JSON.stringify({ ...parseDeferredSendPayload(row), admission: error.admission })
            });
          }
        });
        return { flushed, delayed: 'plugin-wait' };
      }
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
