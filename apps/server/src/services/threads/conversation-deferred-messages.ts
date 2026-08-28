import {
  DEFERRED_THREAD_MESSAGE_CAP,
  countDeferredThreadMessages,
  createDeferredThreadMessage,
  deleteDeferredThreadMessage,
  deleteDeferredThreadMessagesForThread,
  listDeferredThreadMessages,
  type DeferredThreadMessageRow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ThreadSendMode } from './conversation-lifecycle.js';

export interface DeferredSendPayload {
  kind: 'send';
  input: unknown;
  mode: ThreadSendMode;
  execution?: { model?: string; reasoningLevel?: ReasoningLevel };
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
    execution?: { model?: string; reasoningLevel?: ReasoningLevel };
  }
): void {
  if (countDeferredThreadMessages(ctx.db, args.threadId) >= DEFERRED_THREAD_MESSAGE_CAP) {
    throw new ThreadCreateError(
      409,
      'deferred_queue_full',
      'Too many messages are waiting for this thread. Answer the pending question first.'
    );
  }
  createDeferredThreadMessage(ctx.db, {
    threadId: args.threadId,
    kind: 'send',
    payload: JSON.stringify({
      kind: 'send',
      input: args.input,
      mode: args.mode,
      ...(args.execution ? { execution: args.execution } : {})
    } satisfies DeferredSendPayload)
  });
}

export function dropDeferredConversationMessages(ctx: ProductHttpContext, threadId: string): void {
  deleteDeferredThreadMessagesForThread(ctx.db, threadId);
}

/**
 * Deliver held sends in arrival order once the thread is no longer blocked.
 * Stops if a later interaction appears or a send fails.
 */
export async function flushDeferredConversationMessages(
  ctx: ProductHttpContext,
  threadId: string,
  deliver: (payload: DeferredSendPayload) => Promise<void>
): Promise<void> {
  if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) return;
  for (const row of listDeferredThreadMessages(ctx.db, threadId)) {
    if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) return;
    if (!deleteDeferredThreadMessage(ctx.db, { id: row.id, threadId })) continue;
    try {
      await deliver(parseDeferredSendPayload(row));
    } catch {
      createDeferredThreadMessage(ctx.db, {
        threadId,
        kind: row.kind,
        payload: row.payload
      });
      return;
    }
  }
}
