import type { ZccDatabase } from '../connection.js';
import { createDeferredThreadMessageId } from '../ids.js';

export const DEFERRED_THREAD_MESSAGE_CAP = 50;

export interface DeferredThreadMessageRow {
  id: string;
  threadId: string;
  kind: string;
  payload: string;
  createdAt: number;
}

interface DeferredThreadMessageSqlRow {
  id: string;
  thread_id: string;
  kind: string;
  payload: string;
  created_at: number;
}

function toRow(row: DeferredThreadMessageSqlRow): DeferredThreadMessageRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.created_at
  };
}

export function createDeferredThreadMessage(
  db: ZccDatabase,
  input: { threadId: string; kind: string; payload: string }
): DeferredThreadMessageRow {
  const row: DeferredThreadMessageRow = {
    id: createDeferredThreadMessageId(),
    threadId: input.threadId,
    kind: input.kind,
    payload: input.payload,
    createdAt: Date.now()
  };
  db.sqlite.prepare(
    `INSERT INTO deferred_thread_messages (id, thread_id, kind, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(row.id, row.threadId, row.kind, row.payload, row.createdAt);
  return row;
}

export function countDeferredThreadMessages(db: ZccDatabase, threadId: string): number {
  const row = db.sqlite.prepare(
    'SELECT COUNT(*) AS count FROM deferred_thread_messages WHERE thread_id = ?'
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
