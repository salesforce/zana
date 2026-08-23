import {
  getConversationThread,
  getEnvironment,
  listConversationThreadEvents,
  type ConversationThreadEventRow
} from '@zana-ai/zcc-db';
import {
  buildThreadTimelineFromEvents,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type ThreadEventWithMeta
} from '@zana-ai/zcc-thread-view';
import type { ThreadEvent } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';

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

export function storedEventsToMeta(rows: ConversationThreadEventRow[]): ThreadEventWithMeta[] {
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

export function conversationTimeline(ctx: ProductHttpContext, threadId: string) {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const rows = listConversationThreadEvents(ctx.db, threadId);
  const events = storedEventsToMeta(rows);
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  try {
    const timeline = buildThreadTimelineFromEvents({
      acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
      contextWindowEvents: events,
      events,
      options: {
        includeDebugRawEvents: false,
        includeNestedRows: true,
        includeProviderUnhandledOperations: false,
        isLatestPage: true,
        providerId: thread.providerId,
        threadStatus: thread.status,
        threadName: thread.title ?? '',
        turnMessageDetail: 'full',
        workspaceRoot: environment?.path ?? null
      }
    });
    return {
      threadId: thread.id,
      status: thread.status,
      events: rows,
      rows: timeline.rows,
      goal: timeline.goal,
      pendingTodos: timeline.pendingTodos,
      activePromptMode: timeline.activePromptMode,
      activeThinking: timeline.activeThinking,
      activeWorkflows: timeline.activeWorkflows,
      contextWindowUsage: timeline.contextWindowUsage
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'timeline projection failed';
    throw new ThreadCreateError(500, 'timeline-projection-failed', message);
  }
}
