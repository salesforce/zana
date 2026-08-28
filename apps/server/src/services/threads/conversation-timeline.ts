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
  buildThreadTimelineTurnDetailsFromEvents,
  extractThreadTimelineActivePlanTurn,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type ThreadEventWithMeta
} from '@zana-ai/zcc-thread-view';
import { planCommandForProvider } from './thread-provider-catalog.js';
import type { ThreadEvent } from '@zana-ai/zcc-domain/thread-runtime';
import { computeTimelineRowDelta, type TimelineRow } from '@zana-ai/zcc-server-contract';
import { ThreadCreateError } from '../../http/thread-create.js';
import { previewTimelineResponseOutputs } from './timeline-output-preview.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  outlinePreview,
  parseNonNegativeInt,
  parsePositiveInt,
  parseTimelineSegmentLimit
} from './thread-path-confine.js';
import { getThreadReadSeq } from './thread-reads.js';

export interface TimelineQuery {
  segmentLimit?: string | null;
  beforeAnchorSeq?: string | null;
  beforeAnchorId?: string | null;
  afterSequence?: string | null;
  includeNestedRows?: string | null;
  summaryOnly?: string | null;
}

const LATEST_ROWS_CACHE_CAP = 64;
const latestRowsCache = new Map<string, { maxSeq: number; rows: TimelineRow[] }>();

function latestRowsCacheKey(threadId: string, segmentLimit: number, includeNestedRows: boolean): string {
  return `${threadId}:${segmentLimit}:${includeNestedRows ? 'nested' : 'summary'}`;
}

function rememberLatestRows(key: string, entry: { maxSeq: number; rows: TimelineRow[] }): void {
  if (latestRowsCache.has(key)) latestRowsCache.delete(key);
  latestRowsCache.set(key, entry);
  while (latestRowsCache.size > LATEST_ROWS_CACHE_CAP) {
    const oldest = latestRowsCache.keys().next().value;
    if (oldest === undefined) break;
    latestRowsCache.delete(oldest);
  }
}

export function resetTimelineLatestRowsCache(): void {
  latestRowsCache.clear();
}

function parseBooleanFlag(raw: string | null | undefined): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
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
  },
  options: {
    includeNestedRows: boolean;
    turnMessageDetail: 'full' | 'summary';
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
        includeNestedRows: options.includeNestedRows,
        includeProviderUnhandledOperations: includeProviderUnhandledOperations(ctx),
        isLatestPage: page.kind === 'latest',
        providerId: thread.providerId,
        threadStatus: thread.status,
        threadName: thread.title ?? '',
        turnMessageDetail: options.turnMessageDetail,
        workspaceRoot: environment?.path ?? null,
        planCommand: planCommandForProvider(thread.providerId)
      }
    });
    const projectedRows = options.includeNestedRows
      ? timeline.rows
      : previewTimelineResponseOutputs({ rows: timeline.rows }).rows;
    return {
      threadId: thread.id,
      status: thread.status,
      events: rows,
      rows: projectedRows,
      goal: timeline.goal,
      pendingTodos: timeline.pendingTodos,
      activePromptMode: timeline.activePromptMode,
      activeThinking: timeline.activeThinking,
      activeWorkflows: timeline.activeWorkflows,
      activeBackgroundCommands: timeline.activeBackgroundCommands,
      modelFallback: timeline.modelFallback,
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
  const afterSequence = parseNonNegativeInt(query.afterSequence ?? null);
  const includeNestedRows = parseBooleanFlag(query.includeNestedRows) ?? false;
  const summaryOnly = parseBooleanFlag(query.summaryOnly) ?? true;
  const turnMessageDetail = summaryOnly ? 'summary' : 'full';
  const total = countConversationThreadEvents(ctx.db, threadId);
  const rows = beforeSeq != null
    ? listConversationThreadEventsWindow(ctx.db, threadId, { limit: segmentLimit, beforeSeq })
    : listConversationThreadEventsWindow(ctx.db, threadId, { limit: segmentLimit });
  const oldest = rows[0];
  const hasOlderRows = beforeSeq != null
    ? (oldest ? oldest.sequence > 1 : total > 0)
    : total > rows.length;
  const page = {
    kind: (beforeSeq != null ? 'older' : 'latest') as 'latest' | 'older',
    segmentLimit,
    hasOlderRows,
    olderCursor: oldest ? { anchorSeq: oldest.sequence, anchorId: oldest.id } : null
  };
  const full = projectTimeline(ctx, thread, rows, page, { includeNestedRows, turnMessageDetail });
  if (page.kind !== 'latest') return full;
  const cacheKey = latestRowsCacheKey(threadId, segmentLimit, includeNestedRows);
  const previous = afterSequence === undefined ? undefined : latestRowsCache.get(cacheKey);
  const delta = previous !== undefined && previous.maxSeq === afterSequence
    ? computeTimelineRowDelta(previous.rows, full.rows)
    : undefined;
  rememberLatestRows(cacheKey, { maxSeq: full.maxSeq, rows: full.rows });
  if (delta === undefined) return full;
  return { ...full, rows: [], delta };
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

export function conversationTimelineTurnSummaryDetails(
  ctx: ProductHttpContext,
  threadId: string,
  query: { turnId: string; sourceSeqStart: string; sourceSeqEnd: string }
) {
  const thread = requireThread(ctx, threadId);
  const sourceSeqStart = parseNonNegativeInt(query.sourceSeqStart) ?? 0;
  const sourceSeqEnd = parseNonNegativeInt(query.sourceSeqEnd) ?? 0;
  const events = storedEventsToMeta(listConversationThreadEvents(ctx.db, threadId));
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  const result = buildThreadTimelineTurnDetailsFromEvents({
    events,
    options: {
      includeProviderUnhandledOperations: includeProviderUnhandledOperations(ctx),
      threadStatus: thread.status,
      threadName: thread.title ?? '',
      workspaceRoot: environment?.path ?? null,
      sourceSeqStart,
      sourceSeqEnd
    }
  });
  if (result.kind === 'matched' || result.kind === 'ungrouped') {
    return { rows: result.rows };
  }
  return { rows: [] };
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
      workspaceRoot: environment?.path ?? null,
      planCommand: planCommandForProvider(thread.providerId)
    }
  });
  return {
    items: conversationItemsFromRows(timeline.rows),
    maxSeq: rows[rows.length - 1]?.sequence ?? 0
  };
}

export function resolveActivePlanTurn(ctx: ProductHttpContext, thread: ConversationThreadRow) {
  const events = storedEventsToMeta(listConversationThreadEvents(ctx.db, thread.id));
  return extractThreadTimelineActivePlanTurn({
    events,
    planCommand: planCommandForProvider(thread.providerId),
    providerId: thread.providerId,
    threadStatus: thread.status
  });
}
