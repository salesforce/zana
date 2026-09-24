import {
  listConversationThreadEvents,
  type ConversationThreadEventRow,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { ThreadEvent, ThreadActivityState } from '@zana-ai/zcc-domain/thread-runtime';
import {
  EMPTY_THREAD_ACTIVITY,
  extractThreadTimelineActivePlanTurn,
  threadActivityFromEvents,
  type ThreadEventWithMeta
} from '@zana-ai/zcc-thread-view';
import type { ProductHttpContext } from '../../http/product-context.js';
import { planCommandForProvider } from './thread-provider-catalog.js';

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

function withActivePlanModeCount(
  activity: ThreadActivityState,
  events: readonly ThreadEventWithMeta[],
  thread: Pick<ConversationThreadRow, 'providerId' | 'status'>
): ThreadActivityState {
  const planTurn = extractThreadTimelineActivePlanTurn({
    events,
    planCommand: planCommandForProvider(thread.providerId),
    providerId: thread.providerId,
    threadStatus: thread.status
  });
  const activePlanModeCount = planTurn ? 1 : 0;
  if (activity.activePlanModeCount === activePlanModeCount) return activity;
  return { ...activity, activePlanModeCount };
}

/** Cached activity rollup keyed by threadId + maxSeq. */
export function threadActivityForConversation(
  ctx: ProductHttpContext,
  thread: Pick<ConversationThreadRow, 'id' | 'providerId' | 'status'>,
  maxSeq: number
): ThreadActivityState {
  const cached = activityCache.get(thread.id);
  if (cached && cached.maxSeq === maxSeq) return cached.activity;
  if (maxSeq <= 0) {
    return remember(thread.id, { maxSeq, activity: EMPTY_THREAD_ACTIVITY });
  }
  const events = eventsFromRows(listConversationThreadEvents(ctx.db, thread.id));
  const activity = withActivePlanModeCount(threadActivityFromEvents(events), events, thread);
  return remember(thread.id, { maxSeq, activity });
}
