import {
  appendConversationThreadEvent,
  getConversationThread,
  listConversationThreadEventsWindow,
  listConversationThreadsForHost,
  type ConversationThreadEventRow,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  backgroundTaskItemStatus,
  isSettledBackgroundTaskStatus,
  LOCAL_WORKFLOW_TASK_TYPE,
  threadEventBackgroundTaskItemSchema,
  type ThreadEventBackgroundTaskItem
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHub } from '../../http/product-hub.js';

/** Newest-event window: workflows can outlive the turn that started them. */
export const BACKGROUND_TASK_EVENT_SCAN_CAP = 200;

export interface OpenBackgroundTaskItem {
  threadId: string;
  environmentId: string | null;
  providerThreadId: string;
  item: ThreadEventBackgroundTaskItem;
}

interface SettleDanglingBackgroundTasksDeps {
  db: ZccDatabase;
  hub: ProductHub;
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function parseStoredBackgroundTaskItem(payload: unknown): ThreadEventBackgroundTaskItem | null {
  const record = payloadRecord(payload);
  if (!record) return null;
  const parsed = threadEventBackgroundTaskItemSchema.safeParse(record.item);
  return parsed.success ? parsed.data : null;
}

function providerThreadIdOf(payload: unknown, fallback: string): string {
  const record = payloadRecord(payload);
  return typeof record?.providerThreadId === 'string' && record.providerThreadId.trim()
    ? record.providerThreadId.trim()
    : fallback;
}

/**
 * Walk the newest event window in sequence order and keep items that started
 * (or progressed) as a background task without a later completed row.
 */
export function listOpenBackgroundTaskItemsForThread(
  db: ZccDatabase,
  thread: ConversationThreadRow
): OpenBackgroundTaskItem[] {
  const rows = listConversationThreadEventsWindow(db, thread.id, { limit: BACKGROUND_TASK_EVENT_SCAN_CAP });
  const open = new Map<string, OpenBackgroundTaskItem>();
  const fallbackProviderThreadId = thread.providerThreadId ?? '';
  for (const row of rows) {
    if (
      row.type !== 'item/started'
      && row.type !== 'item/backgroundTask/progress'
      && row.type !== 'item/backgroundTask/completed'
    ) {
      continue;
    }
    const item = parseStoredBackgroundTaskItem(row.payload);
    if (!item) continue;
    if (row.type === 'item/backgroundTask/completed') {
      open.delete(item.id);
      continue;
    }
    if (row.type === 'item/started' && item.type !== 'backgroundTask') continue;
    open.set(item.id, {
      threadId: thread.id,
      environmentId: thread.environmentId,
      providerThreadId: providerThreadIdOf(row.payload, fallbackProviderThreadId),
      item
    });
  }
  return [...open.values()];
}

export function listOpenBackgroundTaskItemsForHost(
  db: ZccDatabase,
  hostId: string
): OpenBackgroundTaskItem[] {
  const items: OpenBackgroundTaskItem[] = [];
  for (const thread of listConversationThreadsForHost(db, hostId)) {
    items.push(...listOpenBackgroundTaskItemsForThread(db, thread));
  }
  return items;
}

export function countActiveWorkflowsForThread(db: ZccDatabase, thread: ConversationThreadRow): number {
  return listOpenBackgroundTaskItemsForThread(db, thread).filter((row) => {
    return row.item.taskType === LOCAL_WORKFLOW_TASK_TYPE
      && !isSettledBackgroundTaskStatus(row.item.taskStatus);
  }).length;
}

function emitStored(hub: ProductHub, stored: ConversationThreadEventRow): void {
  hub.emit('threads:event', {
    threadId: stored.threadId,
    sequence: stored.sequence,
    kind: 'thread.event',
    type: stored.type,
    payload: stored.payload
  });
}

function appendDanglingBackgroundTaskCompletions(
  db: ZccDatabase,
  rows: readonly OpenBackgroundTaskItem[]
): ConversationThreadEventRow[] {
  const stored: ConversationThreadEventRow[] = [];
  for (const row of rows) {
    const taskStatus = isSettledBackgroundTaskStatus(row.item.taskStatus)
      ? row.item.taskStatus
      : 'stopped';
    const payload = {
      type: 'item/backgroundTask/completed' as const,
      threadId: row.threadId,
      providerThreadId: row.providerThreadId,
      item: {
        ...row.item,
        status: backgroundTaskItemStatus(taskStatus),
        taskStatus
      }
    };
    stored.push(appendConversationThreadEvent(db, {
      threadId: row.threadId,
      type: payload.type,
      payload
    }));
  }
  return stored;
}

/**
 * Server backstop for lost-daemon cases: persist terminal rows for still-open
 * background tasks. Already-finished snapshots keep their status; genuinely
 * open items become interrupted/stopped. Idempotent.
 */
export function settleDanglingBackgroundTasks(
  deps: SettleDanglingBackgroundTasksDeps,
  args: { hostId: string }
): void {
  const rows = listOpenBackgroundTaskItemsForHost(deps.db, args.hostId);
  if (rows.length === 0) return;
  const stored = deps.db.transaction(() => appendDanglingBackgroundTaskCompletions(deps.db, rows));
  for (const row of stored) emitStored(deps.hub, row);
}

export function settleDanglingBackgroundTasksForStoppedThread(
  deps: SettleDanglingBackgroundTasksDeps,
  args: { threadId: string }
): void {
  const thread = getConversationThread(deps.db, args.threadId);
  if (!thread) return;
  const rows = listOpenBackgroundTaskItemsForThread(deps.db, thread);
  if (rows.length === 0) return;
  const stored = deps.db.transaction(() => appendDanglingBackgroundTaskCompletions(deps.db, rows));
  for (const row of stored) emitStored(deps.hub, row);
}
