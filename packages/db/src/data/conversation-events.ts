import type { ZccDatabase } from '../connection.js';
import { createEventId } from '../ids.js';

export interface ConversationThreadEventRow {
  id: string;
  threadId: string;
  sequence: number;
  type: string;
  payload: unknown;
  createdAt: number;
}

interface ConversationThreadEventSqlRow {
  id: string;
  thread_id: string;
  sequence: number;
  type: string;
  payload: string;
  created_at: number;
}

function toEvent(row: ConversationThreadEventSqlRow): ConversationThreadEventRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    sequence: row.sequence,
    type: row.type,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.created_at
  };
}

export function nextConversationEventSequence(db: ZccDatabase, threadId: string): number {
  const row = db.sqlite.prepare(
    'SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM thread_events WHERE thread_id = ?'
  ).get(threadId) as { max_sequence: number };
  return row.max_sequence + 1;
}

export function appendConversationThreadEvent(
  db: ZccDatabase,
  input: { threadId: string; type: string; payload?: unknown }
): ConversationThreadEventRow {
  const now = Date.now();
  const id = createEventId();
  const sequence = nextConversationEventSequence(db, input.threadId);
  db.sqlite.prepare(
    `INSERT INTO thread_events (id, thread_id, sequence, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.threadId, sequence, input.type, JSON.stringify(input.payload ?? {}), now);
  const row = db.sqlite.prepare('SELECT * FROM thread_events WHERE id = ?').get(id) as ConversationThreadEventSqlRow;
  return toEvent(row);
}

export function listConversationThreadEvents(
  db: ZccDatabase,
  threadId: string
): ConversationThreadEventRow[] {
  return (db.sqlite.prepare(
    'SELECT * FROM thread_events WHERE thread_id = ? ORDER BY sequence'
  ).all(threadId) as ConversationThreadEventSqlRow[]).map(toEvent);
}

export function countConversationThreadEvents(db: ZccDatabase, threadId: string): number {
  const row = db.sqlite.prepare(
    'SELECT COUNT(*) AS count FROM thread_events WHERE thread_id = ?'
  ).get(threadId) as { count: number };
  return row.count;
}

export function listConversationThreadEventsWindow(
  db: ZccDatabase,
  threadId: string,
  opts: { limit: number; beforeSeq?: number }
): ConversationThreadEventRow[] {
  const limit = Math.max(1, Math.floor(opts.limit));
  if (opts.beforeSeq != null) {
    return (db.sqlite.prepare(
      `SELECT * FROM thread_events
        WHERE thread_id = ? AND sequence < ?
        ORDER BY sequence DESC
        LIMIT ?`
    ).all(threadId, opts.beforeSeq, limit) as ConversationThreadEventSqlRow[])
      .map(toEvent)
      .reverse();
  }
  return (db.sqlite.prepare(
    `SELECT * FROM thread_events
      WHERE thread_id = ?
      ORDER BY sequence DESC
      LIMIT ?`
  ).all(threadId, limit) as ConversationThreadEventSqlRow[])
    .map(toEvent)
    .reverse();
}
