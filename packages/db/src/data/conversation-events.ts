import type { ZccDatabase } from '../connection.js';
import { createEventId } from '../ids.js';
import { conversationPreviewPayloadSql, prepareConversationOutput, storeConversationOutput } from './conversation-output.js';
import { PRUNE_CAPACITY, PRUNE_ROOT_USAGE } from './conversation-pruning-sql.js';

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

// A row-count limit alone is not a memory bound: a single tool output can be
// tens of MiB, and workspace diff snapshots can accumulate to GiB per thread.
export const CONVERSATION_EVENT_READ_MAX_BYTES = 16 * 1024 * 1024;
export const CONVERSATION_EVENT_READ_MAX_ROWS = 50_000;

export class ConversationHistoryReadLimitError extends Error {
  readonly status = 413;
  readonly code = 'history-read-too-large';
  constructor() {
    super('This history request is too large. Read a smaller event window. Your conversation is preserved.');
    this.name = 'ConversationHistoryReadLimitError';
  }
}

interface EventReadOptions {
  requireComplete?: boolean;
  messageItem?: { turnId: string; itemId: string };
  inlineOutputChars?: number;
  maxBytes?: number;
  /** Keep sequence/cursor metadata without loading payloads the caller ignores. */
  omitPayloadTypes?: readonly string[];
  /** Message outlines need message items, not complete tool-result bodies. */
  onlyItemTypes?: readonly string[];
  beforeSeq?: number;
  afterSeq?: number;
}

function readEvents(
  db: ZccDatabase,
  threadId: string,
  opts: EventReadOptions & { limit?: number; beforeSeq?: number; afterSeq?: number; type?: string; latest?: boolean }
): ConversationThreadEventRow[] {
  const omitted = opts.omitPayloadTypes ?? [];
  const omittedConditions = omitted.length ? [`type IN (${omitted.map(() => '?').join(',')})`] : [];
  const omittedValues = [...omitted];
  if (opts.onlyItemTypes !== undefined) {
    const itemType = `COALESCE(json_extract(payload, '$.item.type'), json_extract(payload, '$.event.item.type'), '')`;
    omittedConditions.push(`(type IN ('item/started', 'item/completed') AND ${opts.onlyItemTypes.length
      ? `${itemType} NOT IN (${opts.onlyItemTypes.map(() => '?').join(',')})` : '1'})`);
    omittedValues.push(...opts.onlyItemTypes);
  }
  const omittedCondition = omittedConditions.join(' OR ') || '0';
  const payloadSql = opts.inlineOutputChars === undefined ? 'payload' : conversationPreviewPayloadSql(opts.inlineOutputChars);
  const maxBytes = Math.max(1, Math.min(CONVERSATION_EVENT_READ_MAX_BYTES, opts.maxBytes ?? CONVERSATION_EVENT_READ_MAX_BYTES));
  const predicates = ['thread_id = ?'];
  const values: Array<string | number> = [...omittedValues, ...omittedValues, threadId];
  if (opts.messageItem) {
    predicates.push(`type IN ('item/agentMessage/delta', 'item/started', 'item/completed')`,
      `COALESCE(json_extract(payload, '$.scope.turnId'), json_extract(payload, '$.event.scope.turnId')) = ?`,
      `COALESCE(json_extract(payload, '$.itemId'), json_extract(payload, '$.event.itemId'), json_extract(payload, '$.item.id'), json_extract(payload, '$.event.item.id')) = ?`);
    values.push(opts.messageItem.turnId, opts.messageItem.itemId);
  }
  if (opts.type !== undefined) { predicates.push('type = ?'); values.push(opts.type); }
  if (opts.beforeSeq !== undefined) { predicates.push('sequence < ?'); values.push(opts.beforeSeq); }
  if (opts.afterSeq !== undefined) { predicates.push('sequence > ?'); values.push(opts.afterSeq); }
  const limit = Math.min(CONVERSATION_EVENT_READ_MAX_ROWS + 1, Math.max(1, Math.floor(opts.limit ?? CONVERSATION_EVENT_READ_MAX_ROWS + 1)));
  // CASE prevents even one oversized string crossing the native SQLite/V8
  // boundary. Iterate and parse one row at a time rather than retaining both
  // an unbounded array of JSON strings and its parsed copy via .all().map().
  const statement = db.sqlite.prepare(`SELECT id, thread_id, sequence, type, created_at,
    CASE WHEN ${omittedCondition} THEN 2 ELSE length(CAST(${payloadSql} AS BLOB)) END AS payload_bytes,
    CASE WHEN ${omittedCondition} THEN '{}'
      WHEN length(CAST(${payloadSql} AS BLOB)) <= ${CONVERSATION_EVENT_READ_MAX_BYTES} THEN ${payloadSql} ELSE NULL END AS payload
    FROM thread_events WHERE ${predicates.join(' AND ')}
    ORDER BY sequence ${opts.latest ? 'DESC' : 'ASC'} LIMIT ?`);
  const result: ConversationThreadEventRow[] = [];
  let bytes = 0;
  for (const row of statement.iterate(...values, limit) as Iterable<ConversationThreadEventSqlRow & { payload_bytes: number }>) {
    if (row.payload == null || result.length >= CONVERSATION_EVENT_READ_MAX_ROWS
      || (bytes + row.payload_bytes > maxBytes && (result.length > 0 || opts.limit === undefined))) {
      // A window can stop early; its oldest retained sequence is the cursor.
      // Whole-history callers must never receive a silently incomplete history.
      if (opts.limit !== undefined && !opts.requireComplete && result.length > 0) break;
      throw new ConversationHistoryReadLimitError();
    }
    result.push(toEvent(row));
    bytes += row.payload_bytes;
  }
  return opts.latest ? result.reverse() : result;
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

/** Indexed tip seeks avoid scanning every event in each roster thread. */
export function maxConversationEventSequenceByThreadIds(
  db: ZccDatabase,
  threadIds: readonly string[]
): Record<string, number> {
  if (threadIds.length === 0) return {};
  const out: Record<string, number> = {};
  const unique = [...new Set(threadIds)];
  // Keep parameter counts bounded even for internal/plugin callers.
  for (let offset = 0; offset < unique.length; offset += 500) {
    const batch = unique.slice(offset, offset + 500);
    const rows = db.sqlite.prepare(
      `WITH requested(thread_id) AS (VALUES ${batch.map(() => '(?)').join(',')})
       SELECT thread_id AS threadId, (
         SELECT sequence FROM thread_events
         WHERE thread_id = requested.thread_id ORDER BY sequence DESC LIMIT 1
       ) AS maxSequence FROM requested`
    ).all(...batch) as { threadId: string; maxSequence: number | null }[];
    for (const row of rows) if (row.maxSequence !== null) out[row.threadId] = row.maxSequence;
  }
  return out;
}

export function appendConversationThreadEvent(
  db: ZccDatabase,
  input: { threadId: string; type: string; payload?: unknown }
): ConversationThreadEventRow {
  const now = Date.now();
  const id = createEventId();
  const prepared = prepareConversationOutput(input.type, input.payload ?? {}, now);
  return db.transaction(() => {
    const sequence = nextConversationEventSequence(db, input.threadId);
    db.sqlite.prepare(
    `INSERT INTO thread_events (id, thread_id, sequence, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, input.threadId, sequence, input.type, JSON.stringify(prepared.payload), now);
    if (prepared.output) storeConversationOutput(db, id, prepared.output);
    return { id, threadId: input.threadId, sequence, type: input.type, payload: prepared.payload, createdAt: now };
  });
}

export function listConversationThreadEvents(
  db: ZccDatabase,
  threadId: string,
  opts: EventReadOptions = {}
): ConversationThreadEventRow[] {
  return readEvents(db, threadId, opts);
}

/** Poll one matching event in SQL, never materialize the preceding transcript. */
export function getConversationThreadEventAfter(
  db: ZccDatabase, threadId: string, type: string, afterSeq: number
): ConversationThreadEventRow | null {
  return readEvents(db, threadId, { type, afterSeq, limit: 1 })[0] ?? null;
}

export function countConversationThreadEvents(db: ZccDatabase, threadId: string): number {
  const row = db.sqlite.prepare(
    'SELECT COUNT(*) AS count FROM thread_events WHERE thread_id = ?'
  ).get(threadId) as { count: number };
  return row.count;
}

/** Request boundaries are hints; an oversized group can span several bounded pages. */
export function conversationTimelineWindowStart(db: ZccDatabase, threadId: string, beforeSeq: number, groups: number): number {
  const hints = db.sqlite.prepare(`SELECT sequence FROM thread_events WHERE thread_id = ?
    AND type = 'client/turn/requested' AND sequence < ? ORDER BY sequence DESC LIMIT ?`)
    .all(threadId, beforeSeq, groups) as { sequence: number }[];
  return hints.length < groups ? 1 : hints[hints.length - 1]!.sequence;
}

export function hasConversationEventsBefore(db: ZccDatabase, threadId: string, sequence: number): boolean {
  return Boolean(db.sqlite.prepare('SELECT 1 FROM thread_events WHERE thread_id = ? AND sequence < ? LIMIT 1').get(threadId, sequence));
}

export function conversationEventCursorExists(db: ZccDatabase, threadId: string, sequence: number): boolean {
  return Boolean(db.sqlite.prepare('SELECT 1 FROM thread_events WHERE thread_id = ? AND sequence = ? LIMIT 1').get(threadId, sequence));
}

export function conversationTimelineHeadEvents(db: ZccDatabase, threadId: string): ConversationThreadEventRow[] {
  // Usage may omit capacity or belong to a nested turn. Seek capacity separately
  // and inspect only bounded metadata windows before loading the root witnesses.
  const usageSequences = new Set<number>();
  for (const [type, capacity] of [
    ['thread/contextWindowUsage/updated', false], ['thread/contextWindowUsage/updated', true], ['thread/tokenUsage/updated', false]
  ] as const) {
    const rows = db.sqlite.prepare(`SELECT sequence, ${PRUNE_ROOT_USAGE} AS is_root FROM thread_events candidate
      INDEXED BY ${capacity ? 'thread_events_context_capacity_idx' : 'thread_events_thread_type_seq_idx'}
      WHERE thread_id = ? AND type = '${type}' ${capacity ? `AND ${PRUNE_CAPACITY} IS NOT NULL` : ''}
      ORDER BY sequence DESC LIMIT 32`).all(threadId) as { sequence: number; is_root: number }[];
    const root = rows.find(row => row.is_root);
    if (root) usageSequences.add(root.sequence);
  }
  return ['thread/goal/updated', 'thread/goal/cleared', 'turn/plan/updated', 'provider/modelFallback']
    .flatMap(type => readEvents(db, threadId, { type, latest: true, limit: 1 }))
    .concat([...usageSequences].flatMap(sequence => readEvents(db, threadId, { afterSeq: sequence - 1, beforeSeq: sequence + 1, limit: 1 })))
    .sort((a, b) => a.sequence - b.sequence);
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
      db.sqlite.prepare(`INSERT INTO conversation_event_outputs (event_id, output_path, value, expires_at)
        SELECT ?, output_path, value, expires_at FROM conversation_event_outputs WHERE event_id = ? AND expires_at > ?`)
        .run(id, row.id, now);
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
  opts: { limit: number; beforeSeq?: number; type?: string } & EventReadOptions
): ConversationThreadEventRow[] {
  return readEvents(db, threadId, { ...opts, latest: true });
}

/** Resolve turn ancestry independently of how much output followed its start. */
export function getConversationTurnStart(
  db: ZccDatabase,
  threadId: string,
  turnId: string
): ConversationThreadEventRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM thread_events
      WHERE thread_id = ? AND type = 'turn/started'
        AND COALESCE(json_extract(payload, '$.event.scope.turnId'), json_extract(payload, '$.scope.turnId')) = ?
      ORDER BY sequence DESC LIMIT 1`
  ).get(threadId, turnId) as ConversationThreadEventSqlRow | undefined;
  return row ? toEvent(row) : null;
}
