import {
  listConversationThreadEvents,
  type ConversationThreadEventRow
} from '@zana-ai/zcc-db';
import type { ThreadEvent, ThreadActivityState } from '@zana-ai/zcc-domain/thread-runtime';
import {
  EMPTY_THREAD_ACTIVITY,
  threadActivityFromEvents,
  type ThreadEventWithMeta
} from '@zana-ai/zcc-thread-view';
import type { ProductHttpContext } from '../../http/product-context.js';

const ACTIVITY_CACHE_CAP = 256;
const activityCache = new Map<string, { maxSeq: number; activity: ThreadActivityState }>();

export function resetThreadActivityCache(): void {
  activityCache.clear();
}

function isThreadEvent(value: unknown): value is ThreadEvent {
  return Boolean(
    value
    && typeof value === 'object'
    && 'type' in value
    && 'threadId' in value
    && 'scope' in value
    && (value as { scope?: { kind?: unknown } }).scope
    && typeof (value as { scope: { kind?: unknown } }).scope.kind === 'string'
  );
}

function eventsFromRows(rows: ConversationThreadEventRow[]): ThreadEventWithMeta[] {
  return rows.flatMap((row) => {
    const event = isThreadEvent(row.payload)
      ? row.payload
      : isThreadEvent((row.payload as { event?: unknown } | null)?.event)
        ? (row.payload as { event: ThreadEvent }).event
        : null;
    if (!event) return [];
    return [{
      event,
      meta: { id: row.id, seq: row.sequence, createdAt: row.createdAt }
    }];
  });
}

function remember(
  threadId: string,
  entry: { maxSeq: number; activity: ThreadActivityState }
): ThreadActivityState {
  if (activityCache.has(threadId)) activityCache.delete(threadId);
  activityCache.set(threadId, entry);
  while (activityCache.size > ACTIVITY_CACHE_CAP) {
    const oldest = activityCache.keys().next().value;
    if (oldest === undefined) break;
    activityCache.delete(oldest);
  }
  return entry.activity;
}

/** Cached activity rollup keyed by threadId + maxSeq. */
export function threadActivityForConversation(
  ctx: ProductHttpContext,
  threadId: string,
  maxSeq: number
): ThreadActivityState {
  const cached = activityCache.get(threadId);
  if (cached && cached.maxSeq === maxSeq) return cached.activity;
  if (maxSeq <= 0) {
    return remember(threadId, { maxSeq, activity: EMPTY_THREAD_ACTIVITY });
  }
  const activity = threadActivityFromEvents(
    eventsFromRows(listConversationThreadEvents(ctx.db, threadId))
  );
  return remember(threadId, { maxSeq, activity });
}
