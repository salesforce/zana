import type { ZccDatabase } from '../connection.js';
import { createDeferredThreadMessageId } from '../ids.js';

export const DEFERRED_THREAD_MESSAGE_CAP = 50;

export type NextTurnSendStatus = 'queued' | 'dispatching' | 'failed';

export interface DeferredThreadMessageRow {
  id: string;
  threadId: string;
  kind: string;
  payload: string;
  createdAt: number;
  status: NextTurnSendStatus;
  paused: boolean;
  sendAfter: number | null;
  failureReason: string | null;
  groupBoundaryId: string | null;
  updatedAt: number;
}

interface DeferredThreadMessageSqlRow {
  id: string;
  thread_id: string;
  kind: string;
  payload: string;
  created_at: number;
  status?: string | null;
  paused?: number | null;
  send_after?: number | null;
  failure_reason?: string | null;
  group_boundary_id?: string | null;
  updated_at?: number | null;
}

function toStatus(value: string | null | undefined): NextTurnSendStatus {
  if (value === 'dispatching' || value === 'failed') return value;
  return 'queued';
}

function toRow(row: DeferredThreadMessageSqlRow): DeferredThreadMessageRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.created_at,
    status: toStatus(row.status),
    paused: Number(row.paused ?? 0) === 1,
    sendAfter: row.send_after ?? null,
    failureReason: row.failure_reason ?? null,
    groupBoundaryId: row.group_boundary_id ?? null,
    updatedAt: row.updated_at ?? row.created_at
  };
}

export function createDeferredThreadMessage(
  db: ZccDatabase,
  input: {
    threadId: string;
    kind: string;
    payload: string;
    sendAfter?: number | null;
    paused?: boolean;
    groupBoundaryId?: string | null;
  }
): DeferredThreadMessageRow {
  const now = Date.now();
  const row: DeferredThreadMessageRow = {
    id: createDeferredThreadMessageId(),
    threadId: input.threadId,
    kind: input.kind,
    payload: input.payload,
    createdAt: now,
    status: 'queued',
    paused: input.paused === true,
    sendAfter: input.sendAfter ?? null,
    failureReason: null,
    groupBoundaryId: input.groupBoundaryId ?? null,
    updatedAt: now
  };
  db.sqlite.prepare(
    `INSERT INTO deferred_thread_messages (
       id, thread_id, kind, payload, created_at, status, paused, send_after, failure_reason, group_boundary_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.threadId,
    row.kind,
    row.payload,
    row.createdAt,
    row.status,
    row.paused ? 1 : 0,
    row.sendAfter,
    row.failureReason,
    row.groupBoundaryId,
    row.updatedAt
  );
  return row;
}

export function countDeferredThreadMessages(db: ZccDatabase, threadId: string): number {
  const row = db.sqlite.prepare(
    `SELECT COUNT(*) AS count FROM deferred_thread_messages
      WHERE thread_id = ? AND status IN ('queued', 'dispatching')`
  ).get(threadId) as { count: number };
  return row.count;
}

/** Oldest first so delivery preserves arrival order. */
export function listDeferredThreadMessages(
  db: ZccDatabase,
  threadId: string
): DeferredThreadMessageRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM deferred_thread_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC, rowid ASC`
  ).all(threadId) as DeferredThreadMessageSqlRow[]).map(toRow);
}

export function listDueDeferredThreadMessages(
  db: ZccDatabase,
  args: { threadId?: string; now?: number } = {}
): DeferredThreadMessageRow[] {
  const now = args.now ?? Date.now();
  const sql = args.threadId
    ? `SELECT * FROM deferred_thread_messages
        WHERE thread_id = ? AND status = 'queued' AND paused = 0
          AND (send_after IS NULL OR send_after <= ?)
        ORDER BY created_at ASC, rowid ASC`
    : `SELECT * FROM deferred_thread_messages
        WHERE status = 'queued' AND paused = 0
          AND (send_after IS NULL OR send_after <= ?)
        ORDER BY created_at ASC, rowid ASC`;
  const rows = args.threadId
    ? db.sqlite.prepare(sql).all(args.threadId, now)
    : db.sqlite.prepare(sql).all(now);
  return (rows as DeferredThreadMessageSqlRow[]).map(toRow);
}

export function isThreadQueueAutoSendPaused(db: ZccDatabase, threadId: string): boolean {
  const row = db.sqlite.prepare(
    `SELECT COUNT(*) AS count FROM deferred_thread_messages
      WHERE thread_id = ? AND status = 'queued' AND paused = 1`
  ).get(threadId) as { count: number };
  return row.count > 0;
}

export function pauseDeferredThreadMessagesForThread(db: ZccDatabase, threadId: string): number {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET paused = 1, updated_at = ?
      WHERE thread_id = ? AND status = 'queued'`
  ).run(Date.now(), threadId);
  return Number(result.changes ?? 0);
}

export function resumeDeferredThreadMessagesForThread(db: ZccDatabase, threadId: string): number {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET paused = 0, updated_at = ?
      WHERE thread_id = ? AND status = 'queued'`
  ).run(Date.now(), threadId);
  return Number(result.changes ?? 0);
}

export function markDeferredThreadMessageFailed(
  db: ZccDatabase,
  args: { id: string; threadId: string; reason: string }
): boolean {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET status = 'failed', failure_reason = ?, updated_at = ?
      WHERE id = ? AND thread_id = ?`
  ).run(args.reason, Date.now(), args.id, args.threadId);
  return Number(result.changes ?? 0) > 0;
}

export function markDeferredThreadMessageDispatching(
  db: ZccDatabase,
  args: { id: string; threadId: string }
): boolean {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET status = 'dispatching', updated_at = ?
      WHERE id = ? AND thread_id = ? AND status = 'queued'`
  ).run(Date.now(), args.id, args.threadId);
  return Number(result.changes ?? 0) > 0;
}

export function deleteDeferredThreadMessage(
  db: ZccDatabase,
  args: { id: string; threadId: string }
): boolean {
  const result = db.sqlite.prepare(
    'DELETE FROM deferred_thread_messages WHERE id = ? AND thread_id = ?'
  ).run(args.id, args.threadId);
  return Number(result.changes ?? 0) > 0;
}

export function deleteDeferredThreadMessagesForThread(db: ZccDatabase, threadId: string): number {
  const result = db.sqlite.prepare(
    'DELETE FROM deferred_thread_messages WHERE thread_id = ?'
  ).run(threadId);
  return Number(result.changes ?? 0);
}

/** Send now / force flush: revive failed and stuck dispatching rows. */
export function requeueDeferredThreadMessagesForThread(db: ZccDatabase, threadId: string): number {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET status = 'queued', paused = 0, failure_reason = NULL, updated_at = ?
      WHERE thread_id = ? AND status IN ('failed', 'dispatching')`
  ).run(Date.now(), threadId);
  return Number(result.changes ?? 0);
}

export function countActiveConversationTurns(db: ZccDatabase): number {
  const row = db.sqlite.prepare(
    `SELECT COUNT(*) AS count FROM threads
      WHERE archived_at IS NULL AND status IN ('starting', 'active')`
  ).get() as { count: number };
  return row.count;
}
