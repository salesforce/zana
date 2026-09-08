import { listVisibleConversationThreads } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { conversationThreadView, conversationThreadViews } from './conversation-create.js';

const THREAD_SEARCH_SCAN_CAP = 200;
const THREAD_SEARCH_RESULT_CAP = 25;

function haystackForThread(ctx: ProductHttpContext, thread: ReturnType<typeof conversationThreadView>): string {
  return [thread.title, thread.id, thread.providerId, thread.projectId].filter(Boolean).join(' ').toLowerCase();
}

export function searchConversationThreads(ctx: ProductHttpContext, query: string, projectId?: string | null) {
  const needle = query.trim().toLowerCase();
  if (!needle) return { threads: [] as ReturnType<typeof conversationThreadView>[] };
  const scanned = listVisibleConversationThreads(ctx.db, { limit: THREAD_SEARCH_SCAN_CAP })
    .filter((row) => !projectId || row.projectId === projectId);
  const views = conversationThreadViews(ctx, scanned);
  const matches = views.filter((thread) => haystackForThread(ctx, thread).includes(needle));
  return { threads: matches.slice(0, THREAD_SEARCH_RESULT_CAP) };
}

export function resolveConversationMentions(ctx: ProductHttpContext, query: string, projectId?: string | null) {
  return searchConversationThreads(ctx, query, projectId);
}
