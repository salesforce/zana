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

/** One grouped lookup for roster unread math. Empty input skips the query. */
export function maxConversationEventSequenceByThreadIds(
  db: ZccDatabase,
  threadIds: readonly string[]
): Record<string, number> {
  if (threadIds.length === 0) return {};
  const placeholders = threadIds.map(() => '?').join(',');
  const rows = db.sqlite.prepare(
    `SELECT thread_id AS threadId, MAX(sequence) AS maxSequence
     FROM thread_events
     WHERE thread_id IN (${placeholders})
     GROUP BY thread_id`
  ).all(...threadIds) as { threadId: string; maxSequence: number }[];
  const out: Record<string, number> = {};
  for (const row of rows) out[row.threadId] = row.maxSequence;
  return out;
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

export function deleteConversationThreadEventsAfter(
  db: ZccDatabase,
  threadId: string,
  sequence: number
): number {
  const result = db.sqlite.prepare(
    'DELETE FROM thread_events WHERE thread_id = ? AND sequence > ?'
  ).run(threadId, sequence);
  return Number(result.changes ?? 0);
}

export function remapConversationEventPayloadThreadId(
  payload: unknown,
  threadId: string
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (!('threadId' in payload)) return payload;
  return { ...payload, threadId };
}

export function copyConversationThreadEvents(
  db: ZccDatabase,
  input: {
    targetThreadId: string;
    rows: readonly ConversationThreadEventRow[];
  }
): ConversationThreadEventRow[] {
  if (input.rows.length === 0) return [];
  return db.transaction(() => {
    const copied: ConversationThreadEventRow[] = [];
    let sequence = nextConversationEventSequence(db, input.targetThreadId);
    const insert = db.sqlite.prepare(
      `INSERT INTO thread_events (id, thread_id, sequence, type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const now = Date.now();
    for (const row of input.rows) {
      const id = createEventId();
      const payload = remapConversationEventPayloadThreadId(row.payload, input.targetThreadId);
      insert.run(id, input.targetThreadId, sequence, row.type, JSON.stringify(payload ?? {}), now);
      copied.push({
        id,
        threadId: input.targetThreadId,
        sequence,
        type: row.type,
        payload,
        createdAt: now
      });
      sequence += 1;
    }
    return copied;
  });
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
