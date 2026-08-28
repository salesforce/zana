import type { TimelineRow, TimelineUserConversationRow } from '@zana-ai/zcc-server-contract';

export const OPTIMISTIC_TIMELINE_ROW_ID_PREFIX = 'optimistic-user-';
export const PENDING_STOP_ROW_SUFFIX = ':pending-stop';

export function isOptimisticTimelineRowId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_TIMELINE_ROW_ID_PREFIX);
}

export function pendingStopRowId(threadId: string): string {
  return `${threadId}${PENDING_STOP_ROW_SUFFIX}`;
}

export function buildOptimisticUserTimelineRow(args: {
  threadId: string;
  text: string;
  now?: number;
  id?: string;
}): TimelineUserConversationRow {
  const now = args.now ?? Date.now();
  return {
    id: args.id ?? `${OPTIMISTIC_TIMELINE_ROW_ID_PREFIX}${args.threadId}-${now}`,
    threadId: args.threadId,
    turnId: null,
    sourceSeqStart: 0,
    sourceSeqEnd: 0,
    startedAt: now,
    createdAt: now,
    kind: 'conversation',
    role: 'user',
    text: args.text,
    attachments: null,
    initiator: 'user',
    senderThreadId: null,
    systemMessageKind: 'unlabeled',
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: 'message', status: 'pending' },
    mentions: []
  };
}

export function buildStopRequestedTimelineRow(args: {
  threadId: string;
  stoppingAnchorAt: number;
}): Extract<TimelineRow, { kind: 'system'; systemKind: 'operation' }> {
  return {
    id: pendingStopRowId(args.threadId),
    threadId: args.threadId,
    turnId: null,
    sourceSeqStart: 0,
    sourceSeqEnd: 0,
    startedAt: args.stoppingAnchorAt,
    createdAt: args.stoppingAnchorAt,
    kind: 'system',
    systemKind: 'operation',
    operationKind: 'thread-interrupted',
    title: 'Stop requested',
    detail: null,
    status: 'pending',
    completedAt: null
  };
}

export function hasConfirmedStopRow(rows: readonly TimelineRow[]): boolean {
  return rows.some((row) => (
    row.kind === 'system'
    && row.systemKind === 'operation'
    && row.operationKind === 'thread-interrupted'
    && row.id !== pendingStopRowId(row.threadId)
  ));
}

export function mergeOptimisticTimelineRows(
  serverRows: readonly TimelineRow[],
  optimistic: TimelineRow | null
): TimelineRow[] {
  if (!optimistic || !isOptimisticTimelineRowId(optimistic.id)) return [...serverRows];
  if (optimistic.kind !== 'conversation' || optimistic.role !== 'user') return [...serverRows];
  const matched = serverRows.some((row) => (
    row.kind === 'conversation'
    && row.role === 'user'
    && row.text === optimistic.text
  ));
  if (matched) return [...serverRows];
  return [...serverRows, optimistic];
}

export function mergePendingStopRow(
  rows: readonly TimelineRow[],
  args: { threadId: string; isStopping: boolean; stoppingAnchorAt: number }
): TimelineRow[] {
  if (!args.isStopping || hasConfirmedStopRow(rows)) return [...rows];
  return [...rows, buildStopRequestedTimelineRow(args)];
}
