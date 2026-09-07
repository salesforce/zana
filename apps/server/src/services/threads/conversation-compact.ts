import { getConversationThread } from '@zana-ai/zcc-db';
import { createStandaloneBuiltinCompactCommandInput } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { sendConversationTurn } from './conversation-lifecycle.js';
import { getThreadProvider } from './thread-provider-catalog.js';

export async function compactConversation(ctx: ProductHttpContext, threadId: string): Promise<{ ok: true }> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (thread.status !== 'idle' && thread.status !== 'error') {
    throw new ThreadCreateError(409, 'not_idle', 'Compact is only available when the thread is idle');
  }
  const provider = getThreadProvider(thread.providerId);
  if (!provider?.capabilities.supportsManualCompaction) {
    throw new ThreadCreateError(409, 'unsupported', 'This provider does not support manual compaction');
  }
  await sendConversationTurn(
    ctx,
    threadId,
    createStandaloneBuiltinCompactCommandInput(),
    'start',
    undefined,
    { compact: true }
  );
  return { ok: true };
}
