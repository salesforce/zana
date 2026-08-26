import {
  countConversationThreadEvents,
  getConversationThread,
  getEnvironment,
  listConversationThreadEvents,
  listConversationThreadEventsWindow,
  type ConversationThreadEventRow,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import {
  buildThreadTimelineFromEvents,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type ThreadEventWithMeta
} from '@zana-ai/zcc-thread-view';
import type { ThreadEvent } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import {
  DEFAULT_TIMELINE_SEGMENT_LIMIT,
  outlinePreview,
  parsePositiveInt,
  parseTimelineSegmentLimit
} from './thread-path-confine.js';
import { getThreadReadSeq } from './thread-reads.js';

export interface TimelineQuery {
  segmentLimit?: string | null;
  beforeAnchorSeq?: string | null;
  beforeAnchorId?: string | null;
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

function includeProviderUnhandledOperations(ctx: ProductHttpContext): boolean {
  return ctx.config?.getConfig?.().showUnhandledProviderEvents === true
    || process.env.NODE_ENV === 'development';
}

function requireThread(ctx: ProductHttpContext, threadId: string) {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  return thread;
}

function projectTimeline(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow,
  rows: ConversationThreadEventRow[],
  page: {
    kind: 'latest' | 'older';
    segmentLimit: number;
    hasOlderRows: boolean;
    olderCursor: { anchorSeq: number; anchorId: string } | null;
  }
) {
  const events = storedEventsToMeta(rows);
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  const maxSeq = rows[rows.length - 1]?.sequence
    ?? countConversationThreadEvents(ctx.db, thread.id);
  try {
    const timeline = buildThreadTimelineFromEvents({
      acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
      contextWindowEvents: events,
      events,
      options: {
        includeDebugRawEvents: false,
        includeNestedRows: true,
        includeProviderUnhandledOperations: includeProviderUnhandledOperations(ctx),
        isLatestPage: page.kind === 'latest',
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
      contextWindowUsage: timeline.contextWindowUsage,
      lastReadSeq: getThreadReadSeq(ctx.dataDir, thread.id),
      maxSeq,
      timelinePage: {
        kind: page.kind,
        segmentLimit: page.segmentLimit,
        returnedSegmentCount: rows.length,
        hasOlderRows: page.hasOlderRows,
        olderCursor: page.olderCursor
      }
    };
  } catch (error) {
    throw new ThreadCreateError(500, 'timeline-failed', error instanceof Error ? error.message : 'timeline failed');
  }
}

export function conversationTimeline(
  ctx: ProductHttpContext,
  threadId: string,
  query: TimelineQuery = {}
) {
  const thread = requireThread(ctx, threadId);
  const segmentLimit = parseTimelineSegmentLimit(query.segmentLimit ?? null);
  const beforeSeq = parsePositiveInt(query.beforeAnchorSeq ?? null);
  const total = countConversationThreadEvents(ctx.db, threadId);
  const rows = beforeSeq != null
    ? listConversationThreadEventsWindow(ctx.db, threadId, { limit: segmentLimit, beforeSeq })
    : listConversationThreadEventsWindow(ctx.db, threadId, { limit: segmentLimit });
  const oldest = rows[0];
  const hasOlderRows = beforeSeq != null
    ? (oldest ? oldest.sequence > 1 : total > 0)
    : total > rows.length;
  return projectTimeline(ctx, thread, rows, {
    kind: beforeSeq != null ? 'older' : 'latest',
    segmentLimit,
    hasOlderRows,
    olderCursor: oldest ? { anchorSeq: oldest.sequence, anchorId: oldest.id } : null
  });
}

export function conversationItemsFromRows(rows: Array<{
  kind: string;
  id: string;
  role?: 'user' | 'assistant';
  text?: string;
  attachments?: {
    webImages: number;
    localImages: number;
    localFiles: number;
  } | null;
  children?: Array<{
    kind: string;
    id: string;
    role?: 'user' | 'assistant';
    text?: string;
    attachments?: {
      webImages: number;
      localImages: number;
      localFiles: number;
    } | null;
  }> | null;
}>) {
  return rows.flatMap((row) => {
    if (row.kind !== 'conversation') {
      if (row.kind === 'turn') {
        return conversationItemsFromRows(row.children ?? []);
      }
      return [];
    }
    return [{
      id: row.id,
      role: row.role ?? 'assistant',
      preview: outlinePreview(row.text ?? ''),
      attachmentSummary: row.attachments
        ? {
          imageCount: row.attachments.webImages + row.attachments.localImages,
          fileCount: row.attachments.localFiles
        }
        : null
    }];
  });
}

export function conversationOutline(ctx: ProductHttpContext, threadId: string) {
  const thread = requireThread(ctx, threadId);
  const rows = listConversationThreadEvents(ctx.db, threadId);
  const events = storedEventsToMeta(rows);
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  const timeline = buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: events,
    events,
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeProviderUnhandledOperations: includeProviderUnhandledOperations(ctx),
      isLatestPage: true,
      providerId: thread.providerId,
      threadStatus: thread.status,
      threadName: thread.title ?? '',
      turnMessageDetail: 'full',
      workspaceRoot: environment?.path ?? null
    }
  });
  return {
    items: conversationItemsFromRows(timeline.rows),
    maxSeq: rows[rows.length - 1]?.sequence ?? 0
  };
}
