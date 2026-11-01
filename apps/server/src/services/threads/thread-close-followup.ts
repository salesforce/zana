/**
 * Close-with-follow-up for conversation threads — the thread twin of
 * {@link CloseSummaryService.summarizeAndFollowUp}. Main reads the thread's own
 * outline (Rule 1: renderer only supplies the id), distills a paper trail, then
 * archives. Never throws out of the paper-trail step; archive errors propagate.
 */

import { getConversationThread } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { CloseSummaryFailure } from '../followups/close-summary.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { archiveConversation } from './conversation-lifecycle.js';
import { conversationOutline } from './conversation-timeline.js';
import { threadWrapUps, type ThreadWrapUpStart } from './thread-wrap-up.js';

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
): Promise<{
  ok: true;
  summarized: number;
  followedUp: number;
  failures?: CloseSummaryFailure[];
  wrappingUp?: true;
  /** The thread already waits on the user, so it was left open and the inbox says why. */
  keptOpen?: 'asks-you';
}> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!canCloseThreadWithFollowup(thread)) {
    throw new ThreadCreateError(409, 'already_archived', 'thread is already archived');
  }

  // "Wrap up before closing" (Experimental): the thread wraps up in the background and is archived
  // when it finishes. If it cannot be asked (host offline, send failed, any error) it falls through to today's close.
  let started: ThreadWrapUpStart = 'fallback';
  try {
    if (ctx.config.getConfig().closeWrapUpEnabled === true) started = await threadWrapUps(ctx).request(thread);
  } catch (err) {
    // Fall through to today's close, but leave a trace of why the wrap-up did not run.
    console.warn(
      `[thread-close-followup] thread=${threadId.slice(0, 8)} wrap-up could not start, closing now: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (started === 'wrapping-up') return { ok: true, summarized: 0, followedUp: 0, wrappingUp: true };
  if (started === 'kept-open') return { ok: true, summarized: 0, followedUp: 0, keptOpen: 'asks-you' };

  let summarized = 0;
  let followedUp = 0;
  let failures: CloseSummaryFailure[] | undefined;
  try {
    const lastTurn = lastAssistantPreview(conversationOutline(ctx, threadId).items);
    const paper = await ctx.closeSummary.summarizeAndFollowUpFromLastTurn(thread.projectId, {
      sessionId: thread.id,
      title: thread.title?.trim() || 'Untitled agent',
      lastTurn
    });
    summarized = paper.summarized;
    followedUp = paper.followedUp;
    failures = paper.failures;
  } catch {
    /* paper trail is a courtesy — never block the archive */
  }

  const archived = await archiveConversation(ctx, threadId);
  if (!archived) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  return failures && failures.length > 0
    ? { ok: true, summarized, followedUp, failures }
    : { ok: true, summarized, followedUp };
}
