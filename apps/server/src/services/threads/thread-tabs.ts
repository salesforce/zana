import { getConversationThread, getThreadTabs, replaceThreadTabs } from '@zana-ai/zcc-db';
import {
  threadTabsSchema,
  updateThreadTabsRequestSchema,
  type ThreadTab,
  type ThreadTabsResponse
} from '@zana-ai/zcc-server-contract';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';

function parseStoredTabs(tabsJson: string): ThreadTab[] {
  try {
    const parsed = threadTabsSchema.safeParse(JSON.parse(tabsJson) as unknown);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function getConversationThreadTabs(
  ctx: ProductHttpContext,
  threadId: string
): ThreadTabsResponse {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const row = getThreadTabs(ctx.db, threadId);
  if (!row) return { revision: 0, tabs: [] };
  return { revision: row.revision, tabs: parseStoredTabs(row.tabsJson) };
}

export function updateConversationThreadTabs(
  ctx: ProductHttpContext,
  threadId: string,
  body: unknown
): ThreadTabsResponse {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const parsed = updateThreadTabsRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ThreadCreateError(400, 'invalid-request', 'invalid thread tabs payload');
  }
  const tabsJson = JSON.stringify(parsed.data.tabs);
  const replaced = replaceThreadTabs(ctx.db, {
    threadId,
    expectedRevision: parsed.data.expectedRevision,
    tabsJson
  });
  if (replaced === 'conflict') {
    throw new ThreadCreateError(409, 'revision_conflict', 'Thread tabs were updated elsewhere');
  }
  const result = { revision: replaced.revision, tabs: parsed.data.tabs };
  ctx.hub.emit('threads:tabs', {
    type: 'thread-tabs',
    threadId,
    projectId: thread.projectId,
    revision: result.revision,
    tabs: result.tabs
  });
  return result;
}
