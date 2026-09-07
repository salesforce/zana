import {
  archiveConversationThread,
  getConversationThread,
  listConversationThreadsByProject,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { conversationThreadView } from './conversation-create.js';

const LIVE_CHILD_STATUSES = new Set(['starting', 'active', 'stopping']);

export function listConversationChildThreads(
  ctx: ProductHttpContext,
  threadId: string
): ConversationThreadRow[] {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  return listConversationThreadsByProject(ctx.db, thread.projectId, true, { includeHidden: true })
    .filter((row) => row.parentThreadId === threadId);
}

export function conversationChildSummary(ctx: ProductHttpContext, threadId: string) {
  const children = listConversationChildThreads(ctx, threadId);
  const live = children.filter((row) => !row.archivedAt && LIVE_CHILD_STATUSES.has(row.status));
  return {
    total: children.length,
    live: live.length,
    archived: children.filter((row) => Boolean(row.archivedAt)).length,
    byStatus: {
      idle: children.filter((row) => row.status === 'idle' && !row.archivedAt).length,
      error: children.filter((row) => row.status === 'error' && !row.archivedAt).length,
      starting: live.filter((row) => row.status === 'starting').length,
      active: live.filter((row) => row.status === 'active').length,
      stopping: live.filter((row) => row.status === 'stopping').length
    }
  };
}

export function archiveAllConversationChildren(
  ctx: ProductHttpContext,
  threadId: string,
  confirm = false
) {
  const children = listConversationChildThreads(ctx, threadId).filter((row) => !row.archivedAt);
  const live = children.filter((row) => LIVE_CHILD_STATUSES.has(row.status));
  if (live.length > 0 && !confirm) {
    throw new ThreadCreateError(
      409,
      'children_live',
      'Live child threads are still running. Pass confirm=1 to archive them anyway.'
    );
  }
  const archived: string[] = [];
  for (const child of children) {
    const next = archiveConversationThread(ctx.db, child.id);
    if (next) {
      archived.push(next.id);
      ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
    }
  }
  return { ok: true as const, archivedCount: archived.length, ids: archived };
}
