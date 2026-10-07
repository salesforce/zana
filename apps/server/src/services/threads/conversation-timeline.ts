import {
  countConversationThreadEvents,
  getConversationThread,
  getEnvironment,
  listConversationThreadEvents,
  listConversationThreadEventsWindow,
  conversationTimelineWindowStart,
  conversationEventCursorExists,
  hasConversationEventsBefore,
  nextConversationEventSequence,
  hydrateConversationOutputs,
  conversationTimelineHeadEvents,
  type ConversationThreadEventRow,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import {
  buildThreadTimelineFromEvents,
  buildThreadTimelineTurnDetailsFromEvents,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type ThreadEventWithMeta
} from '@zana-ai/zcc-thread-view';
import { planCommandForProvider } from './thread-provider-catalog.js';
import type { ThreadEvent } from '@zana-ai/zcc-domain/thread-runtime';
import {
  computeTimelineRowDelta,
  retainLatestTimelineWindow,
  type TimelineRow
} from '@zana-ai/zcc-server-contract';
import { ThreadCreateError } from '../../http/thread-create.js';
import { cachedConversationOutline } from './conversation-outline-cache.js';
import { previewTimelineResponseOutputs } from './timeline-output-preview.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  outlinePreview,
  parseNonNegativeInt,
  parsePositiveInt,
  parseTimelineSegmentLimit
} from './thread-path-confine.js';
import { getThreadReadSeq } from './thread-reads.js';
import { getDurableThreadPlanView } from './conversation-plan.js';
import { getThreadExecutionState } from '@zana-ai/zcc-db';
import { isPlanExecutionMode } from './conversation-execution-mode.js';
import { conversationNextTurnView } from './conversation-next-turn.js';
import { activePlanTurnForConversation } from './conversation-thread-activity.js';
import { decodeHistoryCursor, encodeHistoryCursor, pageTimelineRows, TIMELINE_PAGE_BYTES } from './timeline-content-page.js';

export interface TimelineQuery {
  segmentLimit?: string | null;
  beforeAnchorSeq?: string | null;
  beforeAnchorId?: string | null;
  afterSequence?: string | null;
  includeNestedRows?: string | null;
  summaryOnly?: string | null;
}

const LATEST_ROWS_CACHE_CAP = 64;
const LATEST_ROWS_CACHE_BYTES = 32 * 1024 * 1024;
// Diff snapshots never produce timeline rows. Drop their payload in SQLite,
// before crossing into V8; filtering in the projector is already too late.
const TIMELINE_EVENT_READ = { omitPayloadTypes: ['turn/diff/updated'], inlineOutputChars: 32_768, maxBytes: TIMELINE_PAGE_BYTES };
const latestRowsCache = new Map<string, { maxSeq: number; rows: TimelineRow[]; bytes: number }>();
let latestRowsCacheBytes = 0;

function latestRowsCacheKey(threadId: string, segmentLimit: number, includeNestedRows: boolean): string {
  return `${threadId}:${segmentLimit}:${includeNestedRows ? 'nested' : 'summary'}`;
}

function rememberLatestRows(key: string, entry: { maxSeq: number; rows: TimelineRow[] }): void {
  latestRowsCacheBytes -= latestRowsCache.get(key)?.bytes ?? 0;
  latestRowsCache.delete(key);
  const bytes = Buffer.byteLength(JSON.stringify(entry.rows));
  if (bytes > LATEST_ROWS_CACHE_BYTES) return;
  latestRowsCache.set(key, { ...entry, bytes });
  latestRowsCacheBytes += bytes;
  while (latestRowsCache.size > LATEST_ROWS_CACHE_CAP || latestRowsCacheBytes > LATEST_ROWS_CACHE_BYTES) {
    const oldest = latestRowsCache.keys().next().value;
    if (oldest === undefined) break;
    latestRowsCacheBytes -= latestRowsCache.get(oldest)!.bytes;
    latestRowsCache.delete(oldest);
  }
}

export function resetTimelineLatestRowsCache(): void {
  latestRowsCache.clear();
  latestRowsCacheBytes = 0;
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
  const cfg = ctx.config?.getConfig?.();
  return cfg?.showDiagnosticEvents === true
    || cfg?.showUnhandledProviderEvents === true
    || process.env.NODE_ENV === 'development';
}

function requireThread(ctx: ProductHttpContext, threadId: string) {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  return thread;
}

function withBoundaryMessageContext(ctx: ProductHttpContext, threadId: string, rows: ConversationThreadEventRow[], tip: number) {
  // A raw window may start halfway through a streamed message. Fetch that
  // item's bounded context, rather than presenting only its most recent deltas.
  const first = storedEventsToMeta(rows).find(({ event }) => event.type === 'item/agentMessage/delta');
  if (!first || first.event.type !== 'item/agentMessage/delta' || !('turnId' in first.event.scope)) return rows;
  const context = listConversationThreadEventsWindow(ctx.db, threadId, {
    ...TIMELINE_EVENT_READ, limit: 50_001, maxBytes: 16 * 1024 * 1024, requireComplete: true, beforeSeq: tip + 1,
    messageItem: { turnId: first.event.scope.turnId, itemId: first.event.itemId }
  });
  const byId = new Map(context.map(row => [row.id, row]));
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
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
    const durablePlan = getDurableThreadPlanView(ctx.db, thread.id);
    const execution = getThreadExecutionState(ctx.db, thread.id);
    const requestedPlan = isPlanExecutionMode(execution?.requestedMode);
    const effectivePlan = isPlanExecutionMode(execution?.effectiveMode);
    const nativePlanMode = requestedPlan
      && (execution?.effectiveMode == null || effectivePlan);
    const activePromptMode = timeline.activePromptMode ?? (
      nativePlanMode
        ? { mode: 'plan' as const, providerId: thread.providerId, prompt: '' }
        : null
    );
    return {
      threadId: thread.id,
      status: thread.status,
      // In-process callers (tests) may inspect the window; the HTTP handler
      // strips this so the renderer never parses thousands of raw events.
      events: rows,
      rows: projectedRows,
      goal: timeline.goal,
      pendingTodos: timeline.pendingTodos,
      durablePlan,
      activePromptMode,
      executionMode: execution
        ? {
          requested: execution.requestedMode,
          effective: execution.effectiveMode,
          mismatch: Boolean(
            execution.requestedMode
            && execution.effectiveMode
            && execution.requestedMode !== execution.effectiveMode
          )
        }
        : null,
      activeThinking: timeline.activeThinking,
      activeWorkflows: timeline.activeWorkflows,
      activeBackgroundCommands: timeline.activeBackgroundCommands,
      modelFallback: timeline.modelFallback,
      contextWindowUsage: timeline.contextWindowUsage,
      nextTurn: conversationNextTurnView(ctx, thread.id),
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
  const surface = `timeline:${includeNestedRows}:${summaryOnly}`;
  const cursor = decodeHistoryCursor(query.beforeAnchorId, threadId, surface);
  const tip = cursor?.tip ?? nextConversationEventSequence(ctx.db, threadId) - 1;
  if (cursor && (beforeSeq !== cursor.start || !conversationEventCursorExists(ctx.db, threadId, cursor.start))) {
    throw new ThreadCreateError(400, 'invalid-history-cursor', 'This history page is no longer available. Reload the conversation.');
  }
  const end = cursor?.beforeLeaf ? cursor.end : beforeSeq ?? tip + 1;
  const start = cursor?.beforeLeaf ? cursor.start : conversationTimelineWindowStart(ctx.db, threadId, end, segmentLimit);
  const rows = listConversationThreadEventsWindow(ctx.db, threadId, {
    ...TIMELINE_EVENT_READ, limit: 50_000, beforeSeq: end, afterSeq: start - 1
  });
  const oldest = rows[0];
  const hasOlderRows = !!oldest && hasConversationEventsBefore(ctx.db, threadId, oldest.sequence);
  const page = {
    kind: (beforeSeq != null ? 'older' : 'latest') as 'latest' | 'older',
    segmentLimit,
    hasOlderRows,
    olderCursor: oldest && hasOlderRows ? { anchorSeq: oldest.sequence, anchorId: encodeHistoryCursor({
      threadId, surface, start: oldest.sequence, end, tip
    }) } : null
  };
  const full = projectTimeline(ctx, thread, withBoundaryMessageContext(ctx, threadId, rows, tip), page, { includeNestedRows, turnMessageDetail });
  if (page.kind === 'latest') {
    // Old goal/usage snapshots must not widen the history window just to keep
    // the header current. Their projection never contributes historical rows.
    const headRows = conversationTimelineHeadEvents(ctx.db, threadId);
    if (headRows.length) {
      const head = projectTimeline(ctx, thread, headRows, { kind: 'latest', segmentLimit: 1, hasOlderRows: false, olderCursor: null },
        { includeNestedRows: false, turnMessageDetail: 'summary' });
      full.goal = head.goal;
      full.contextWindowUsage = head.contextWindowUsage ?? full.contextWindowUsage;
      full.pendingTodos = full.pendingTodos ?? head.pendingTodos;
      full.modelFallback = head.modelFallback ?? full.modelFallback;
    }
  }
  const content = pageTimelineRows(full.rows, cursor?.beforeLeaf);
  full.rows = content.rows;
  full.maxSeq = tip;
  if (content.start > 0 && oldest) {
    full.timelinePage.hasOlderRows = true;
    full.timelinePage.olderCursor = { anchorSeq: oldest.sequence, anchorId: encodeHistoryCursor({
      threadId, surface, start: oldest.sequence, end, tip, beforeLeaf: content.start
    }) };
  }
  if (page.kind !== 'latest') return full;
  const cacheKey = latestRowsCacheKey(threadId, segmentLimit, includeNestedRows);
  const cached = latestRowsCache.get(cacheKey);
  const retained = retainLatestTimelineWindow(cached, { maxSeq: full.maxSeq, rows: full.rows });
  const previous = afterSequence === undefined ? undefined : cached;
  const delta = previous !== undefined && previous.maxSeq === afterSequence
    ? computeTimelineRowDelta(previous.rows, retained.rows as TimelineRow[])
    : undefined;
  rememberLatestRows(cacheKey, { maxSeq: retained.maxSeq, rows: retained.rows as TimelineRow[] });
  if (delta === undefined) return { ...full, rows: retained.rows as TimelineRow[] };
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
}>): Array<{
  id: string;
  role: 'user' | 'assistant';
  preview: string;
  attachmentSummary: { imageCount: number; fileCount: number } | null;
}> {
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
  query: { turnId: string; sourceSeqStart: string; sourceSeqEnd: string; beforeCursor?: string }
) {
  const thread = requireThread(ctx, threadId);
  const sourceSeqStart = parseNonNegativeInt(query.sourceSeqStart) ?? 0;
  const sourceSeqEnd = parseNonNegativeInt(query.sourceSeqEnd) ?? 0;
  if (!query.turnId || sourceSeqStart > sourceSeqEnd) throw new ThreadCreateError(400, 'invalid-input', 'Invalid turn history range');
  const surface = `details:${query.turnId}:${sourceSeqStart}:${sourceSeqEnd}`;
  const cursor = decodeHistoryCursor(query.beforeCursor, threadId, surface);
  if (query.beforeCursor && !cursor) throw new ThreadCreateError(400, 'invalid-history-cursor', 'Invalid turn history cursor');
  if (cursor && !conversationEventCursorExists(ctx.db, threadId, cursor.start)) throw new ThreadCreateError(400, 'invalid-history-cursor', 'Reload the turn history');
  const end = cursor ? (cursor.beforeLeaf ? cursor.end : cursor.start) : sourceSeqEnd + 1;
  const rows = listConversationThreadEventsWindow(ctx.db, threadId, {
    ...TIMELINE_EVENT_READ,
    limit: 50_000,
    afterSeq: cursor?.beforeLeaf ? cursor.start - 1 : Math.max(-1, sourceSeqStart - 1),
    beforeSeq: end
  });
  const events = storedEventsToMeta(hydrateConversationOutputs(ctx.db,
    withBoundaryMessageContext(ctx, threadId, rows, sourceSeqEnd), TIMELINE_PAGE_BYTES));
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  const result = buildThreadTimelineTurnDetailsFromEvents({
    events,
    options: {
      includeProviderUnhandledOperations: includeProviderUnhandledOperations(ctx),
      threadStatus: thread.status,
      threadName: thread.title ?? '',
      workspaceRoot: environment?.path ?? null,
      sourceSeqStart: rows[0]?.sequence ?? sourceSeqStart,
      sourceSeqEnd: rows.at(-1)?.sequence ?? sourceSeqEnd
    }
  });
  let detailRows = result.kind === 'matched' || result.kind === 'ungrouped' ? result.rows : [];
  if (result.kind === 'missing-match') {
    const projected = projectTimeline(ctx, thread, rows, { kind: 'older', segmentLimit: 1, hasOlderRows: false, olderCursor: null },
      { includeNestedRows: true, turnMessageDetail: 'full' });
    detailRows = projected.rows.flatMap(row => row.kind === 'turn' ? row.turnId === query.turnId ? row.children ?? [] : [] : [row]);
  }
  const content = pageTimelineRows(detailRows, cursor?.beforeLeaf);
  const start = rows[0]?.sequence;
  const older = start !== undefined && (content.start > 0 || (start > Math.max(1, sourceSeqStart)
    && listConversationThreadEventsWindow(ctx.db, threadId, { ...TIMELINE_EVENT_READ, limit: 1, beforeSeq: start, afterSeq: sourceSeqStart - 1 }).length > 0));
  return { rows: content.rows, olderCursor: older ? encodeHistoryCursor({
    threadId, surface, start: start!, end, tip: sourceSeqEnd, ...(content.start > 0 ? { beforeLeaf: content.start } : {})
  }) : null };
}

export function conversationOutline(ctx: ProductHttpContext, threadId: string) {
  const thread = requireThread(ctx, threadId);
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  const project = () => {
    const rows = listConversationThreadEvents(ctx.db, threadId, {
      omitPayloadTypes: ['turn/diff/updated', 'item/commandExecution/outputDelta'],
      onlyItemTypes: ['agentMessage', 'userMessage']
    });
    const events = storedEventsToMeta(rows);
    const timeline = buildThreadTimelineFromEvents({
      acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
      contextWindowEvents: events,
      events,
      options: {
        includeDebugRawEvents: false,
        includeNestedRows: false,
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
  };
  // The main-owned database and authorized thread are resolved before reuse.
  return cachedConversationOutline(ctx.db, threadId, JSON.stringify([
    thread.providerId, thread.status, thread.title, environment?.path, includeProviderUnhandledOperations(ctx), planCommandForProvider(thread.providerId)
  ]), project);
}

export function resolveActivePlanTurn(ctx: ProductHttpContext, thread: ConversationThreadRow) {
  return activePlanTurnForConversation(ctx, thread);
}
