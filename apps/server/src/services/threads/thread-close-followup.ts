/**
 * Close-with-follow-up for conversation threads — the thread twin of
 * {@link CloseSummaryService.summarizeAndFollowUp}. Main reads the thread's own
 * outline (Rule 1: renderer only supplies the id), distills a paper trail, then
 * archives. Never throws out of the paper-trail step; archive errors propagate.
 */

import { getConversationThread } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { archiveConversation } from './conversation-lifecycle.js';
import { conversationOutline } from './conversation-timeline.js';

export function lastAssistantPreview(
  items: Array<{ role: 'user' | 'assistant'; preview: string }>
): string {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].role === 'assistant' && items[i].preview.trim()) {
      return items[i].preview.trim();
    }
  }
  return '';
}

export function canCloseThreadWithFollowup(thread: {
  archivedAt?: number | null;
}): boolean {
  return thread.archivedAt == null;
}

export async function closeConversationWithFollowup(
  ctx: ProductHttpContext,
  threadId: string
): Promise<{ ok: true; summarized: number; followedUp: number }> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!canCloseThreadWithFollowup(thread)) {
    throw new ThreadCreateError(409, 'already_archived', 'thread is already archived');
  }

  let summarized = 0;
  let followedUp = 0;
  try {
    const lastTurn = lastAssistantPreview(conversationOutline(ctx, threadId).items);
    const paper = await ctx.closeSummary.summarizeAndFollowUpFromLastTurn(thread.projectId, {
      sessionId: thread.id,
      title: thread.title?.trim() || 'Untitled agent',
      lastTurn
    });
    summarized = paper.summarized;
    followedUp = paper.followedUp;
  } catch {
    /* paper trail is a courtesy — never block the archive */
  }

  const archived = await archiveConversation(ctx, threadId);
  if (!archived) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  return { ok: true, summarized, followedUp };
}
