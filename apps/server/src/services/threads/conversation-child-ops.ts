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

function isVisibleFork(row: ConversationThreadRow): boolean {
  return row.originKind === 'fork' && row.visibility === 'visible';
}

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

/**
 * Descendants to archive with a parent: spawned children and hidden forks,
 * at any depth. Visible forks stay live. Archived intermediaries are walked
 * so their live grandchildren are still collected; they are not re-archived.
 */
export function collectConversationArchiveDescendants(
  ctx: Pick<ProductHttpContext, 'db'>,
  root: ConversationThreadRow
): ConversationThreadRow[] {
  const pending: { thread: ConversationThreadRow; expanded: boolean }[] = [
    { thread: root, expanded: false }
  ];
  const visited = new Set<string>();
  const threads: ConversationThreadRow[] = [];
  const projectThreads = listConversationThreadsByProject(
    ctx.db,
    root.projectId,
    true,
    { includeHidden: true }
  );

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    const { thread, expanded } = entry;
    if (expanded) {
      if (thread.id !== root.id && thread.archivedAt === null) {
        threads.push(thread);
      }
      continue;
    }
    if (visited.has(thread.id)) continue;
    visited.add(thread.id);
    pending.push({ thread, expanded: true });
    const descendants = projectThreads.filter(
      (row) => row.parentThreadId === thread.id && !isVisibleFork(row)
    );
    for (const descendant of descendants.reverse()) {
      pending.push({ thread: descendant, expanded: false });
    }
  }
  return threads;
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
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const descendants = collectConversationArchiveDescendants(ctx, thread);
  const live = descendants.filter((row) => LIVE_CHILD_STATUSES.has(row.status));
  if (live.length > 0 && !confirm) {
    throw new ThreadCreateError(
      409,
      'children_live',
      'Live child threads are still running. Pass confirm=1 to archive them anyway.'
    );
  }
  const archived: string[] = [];
  for (const child of descendants) {
    const next = archiveConversationThread(ctx.db, child.id);
    if (next) {
      archived.push(next.id);
      ctx.hub.emit('threads:updated', conversationThreadView(ctx, next));
    }
  }
  return { ok: true as const, archivedCount: archived.length, ids: archived };
}
