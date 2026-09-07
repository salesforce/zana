import type { ConversationThreadRow } from '@zana-ai/zcc-db';
import type { ThreadRuntimeDisplayStatus } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ThreadSendMode } from './conversation-dispatch-checkpoint.js';
import { resolveConversationRuntimeState } from './conversation-runtime-display.js';
import type { ProductHttpContext } from '../../http/product-context.js';

export function ensureConversationThreadIsWritable(thread: ConversationThreadRow): void {
  if (thread.archivedAt) {
    throw new ThreadCreateError(409, 'archived', 'Thread is archived');
  }
  if (thread.status === 'stopping') {
    throw new ThreadCreateError(409, 'stopping', 'Thread is stopping');
  }
}

export function resolveConversationSendMode(
  thread: ConversationThreadRow,
  requestedMode: ThreadSendMode
): 'start' | 'auto' | 'steer' {
  if (requestedMode === 'start') {
    if (thread.status === 'active') {
      throw new ThreadCreateError(409, 'already_active', 'Thread is already active');
    }
    return 'start';
  }
  if (requestedMode === 'steer' || requestedMode === 'steer-if-active') {
    if (thread.status === 'active') return 'steer';
    if (thread.status === 'idle') return 'start';
    throw new ThreadCreateError(409, 'not_active', 'Thread is not active');
  }
  if (requestedMode === 'queue-if-active') {
    // Drain/"Send now" while a turn is still live should follow up, not 409.
    // Non-drain sends never reach here: sendConversationTurn queues first.
    if (thread.status === 'active' || thread.status === 'starting') return 'auto';
    return 'start';
  }
  if (thread.status === 'active') return 'auto';
  return 'start';
}

export function isGhostActiveRuntimeDisplay(displayStatus: ThreadRuntimeDisplayStatus): boolean {
  return displayStatus === 'host-reconnecting' || displayStatus === 'waiting-for-host';
}

export function ensureRuntimeCanAcceptActiveSend(
  ctx: Pick<ProductHttpContext, 'db' | 'hostHub'>,
  thread: ConversationThreadRow,
  resolvedMode: 'start' | 'auto' | 'steer'
): void {
  if (thread.status !== 'active') return;
  const runtime = resolveConversationRuntimeState(ctx, thread);
  if (runtime.displayStatus === 'active') return;
  if (resolvedMode === 'steer') {
    throw new ThreadCreateError(502, 'host_unavailable', 'Host daemon is not connected');
  }
}

export function shouldQueueGhostActiveSend(
  ctx: Pick<ProductHttpContext, 'db' | 'hostHub'>,
  thread: ConversationThreadRow,
  requestedMode: ThreadSendMode
): boolean {
  if (thread.status !== 'active') return false;
  const runtime = resolveConversationRuntimeState(ctx, thread);
  if (!isGhostActiveRuntimeDisplay(runtime.displayStatus)) return false;
  return requestedMode === 'auto' || requestedMode === 'queue-if-active' || requestedMode === 'start';
}
