import {
  applyConversationThreadLifecycleEvent,
  type ApplyConversationThreadLifecycleEventOutcome,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { ThreadLifecycleEvent } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { conversationThreadView } from './conversation-thread-view.js';

const idleFlushInFlight = new Set<string>();

export function applyLoggedConversationLifecycleEvent(
  ctx: ProductHttpContext,
  args: {
    threadId: string;
    event: ThreadLifecycleEvent;
  }
): ApplyConversationThreadLifecycleEventOutcome {
  const outcome = applyConversationThreadLifecycleEvent(ctx.db, {
    threadId: args.threadId,
    event: args.event
  });
  if (!outcome.applied) {
    console.info(
      JSON.stringify({
        msg: 'Thread lifecycle event not applied',
        threadId: args.threadId,
        event: args.event.type,
        reason: outcome.reason,
        detail: outcome.detail
      })
    );
    return outcome;
  }
  ctx.hub.emit('threads:updated', conversationThreadView(ctx, outcome.thread));
  if (outcome.thread.status === 'idle' || outcome.thread.status === 'error') {
    void import('./conversation-child-notifications.js')
      .then(({ notifyParentOfChildTurn }) => notifyParentOfChildTurn(ctx, outcome.thread))
      .catch(() => undefined);
  }
  if (outcome.thread.status === 'idle') {
    scheduleConversationIdleFlush(ctx, outcome.thread.id);
  }
  return outcome;
}

export function scheduleConversationIdleFlush(ctx: ProductHttpContext, threadId: string): void {
  if (idleFlushInFlight.has(threadId)) return;
  idleFlushInFlight.add(threadId);
  void import('./conversation-lifecycle.js')
    .then(({ flushHeldConversationSends }) => flushHeldConversationSends(ctx, threadId))
    .catch(() => undefined)
    .finally(() => {
      idleFlushInFlight.delete(threadId);
    });
}

export function appliedConversationThread(
  outcome: ApplyConversationThreadLifecycleEventOutcome,
  fallback: ConversationThreadRow
): ConversationThreadRow {
  return outcome.applied ? outcome.thread : fallback;
}
