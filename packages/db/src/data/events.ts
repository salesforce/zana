import type { ZccDatabase } from '../connection.js';
import { createEventId } from '../ids.js';

export interface ThreadEventRow {
  id: string;
  threadId: string;
  sequence: number;
  kind: string;
  payload: unknown;
  createdAt: number;
}

interface ThreadEventSqlRow {
  id: string;
  thread_id: string;
  sequence: number;
  kind: string;
  payload: string;
  created_at: number;
}

function toEvent(row: ThreadEventSqlRow): ThreadEventRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    sequence: row.sequence,
    kind: row.kind,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.created_at
  };
}

export function nextEventSequence(db: ZccDatabase, threadId: string): number {
  const row = db.sqlite.prepare(
    'SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM thread_events WHERE thread_id = ?'
  ).get(threadId) as { max_sequence: number };
  return row.max_sequence + 1;
}

/** Server assigns the durable sequence. The host never supplies one. */
export function appendThreadEvent(
  db: ZccDatabase,
  input: { threadId: string; kind: string; payload?: unknown }
): ThreadEventRow {
  const now = Date.now();
  const id = createEventId();
  const sequence = nextEventSequence(db, input.threadId);
  db.sqlite.prepare(
    `INSERT INTO thread_events (id, thread_id, sequence, kind, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.threadId, sequence, input.kind, JSON.stringify(input.payload ?? {}), now);
  const row = db.sqlite.prepare('SELECT * FROM thread_events WHERE id = ?').get(id) as ThreadEventSqlRow;
  return toEvent(row);
}

export function listThreadEvents(db: ZccDatabase, threadId: string): ThreadEventRow[] {
  return (db.sqlite.prepare(
    'SELECT * FROM thread_events WHERE thread_id = ? ORDER BY sequence'
  ).all(threadId) as ThreadEventSqlRow[]).map(toEvent);
}

const THREAD_OUTPUT_MAX_CHARS = 256 * 1024;
const THREAD_OUTPUT_EVENT_CAP = 2000;

/** Bounded PTY replay tail, newest events first, trimmed to 256 KiB. */
export function threadOutputTail(db: ZccDatabase, threadId: string): string {
  const rows = db.sqlite.prepare(
    `SELECT payload FROM thread_events
     WHERE thread_id = ? AND kind = 'terminal.output'
     ORDER BY sequence DESC
     LIMIT ?`
  ).all(threadId, THREAD_OUTPUT_EVENT_CAP) as Array<{ payload: string }>;
  const chunks: string[] = [];
  let remaining = THREAD_OUTPUT_MAX_CHARS;
  for (const row of rows) {
    let data = '';
    try {
      const parsed = JSON.parse(row.payload) as { data?: unknown };
      if (typeof parsed.data === 'string') data = parsed.data;
    } catch {
      continue;
    }
    if (!data) continue;
    if (data.length >= remaining) {
      chunks.push(data.slice(data.length - remaining));
      break;
    }
    chunks.push(data);
    remaining -= data.length;
  }
  return chunks.reverse().join('');
}
