import type { ZccDatabase } from '../connection.js';

export const ASSISTANT_PREVIEW_CHARS = 4000;
export const ASSISTANT_PREVIEW_EVENT_LIMIT = 512;
export const PREVIEW_VERSION_THREAD_LIMIT = 100;

export interface ConversationPreviewVersion {
  threadId: string;
  eventSequence: number | null;
  interactionId: string | null;
}

/** Indexed revision probes in one bounded read; never load event JSON to check freshness. */
export function getConversationPreviewVersions(db: ZccDatabase, threadIds: readonly string[]): ConversationPreviewVersion[] {
  const ids = [...new Set(threadIds)].slice(0, PREVIEW_VERSION_THREAD_LIMIT);
  if (ids.length === 0) return [];
  // Interaction payloads are immutable; a different current pending id also
  // invalidates the cache when an interaction changes without a new event.
  return db.sqlite.prepare(`SELECT value AS threadId,
    (SELECT sequence FROM thread_events WHERE thread_id = value ORDER BY sequence DESC LIMIT 1) AS eventSequence,
    (SELECT id FROM pending_interactions WHERE thread_id = value AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1) AS interactionId
    FROM json_each(?)`).all(JSON.stringify(ids)) as ConversationPreviewVersion[];
}

/** Latest root-turn evidence only: never reuse an older failure after a new turn. */
export function getConversationFailurePreview(db: ZccDatabase, threadId: string): string | undefined {
  const row = db.sqlite.prepare(`WITH candidates AS MATERIALIZED (
      SELECT COALESCE(json_extract(payload, '$.event'), payload) AS event, sequence FROM thread_events
      WHERE thread_id = ? AND type IN (
        'turn/started', 'turn.started', 'turn/completed', 'turn.completed', 'system/error', 'provider/error'
      ) ORDER BY sequence DESC LIMIT ${ASSISTANT_PREVIEW_EVENT_LIMIT}
    ), root AS (
      SELECT json_extract(event, '$.scope.turnId') AS turn_id, sequence FROM candidates
      WHERE json_extract(event, '$.type') = 'turn/started'
        AND COALESCE(json_extract(event, '$.parentToolCallId'), '') = ''
      ORDER BY sequence DESC LIMIT 1
    ), latest AS (
      SELECT event FROM candidates
      WHERE json_extract(event, '$.type') IN ('turn/completed', 'system/error', 'provider/error')
        AND COALESCE(json_extract(event, '$.parentToolCallId'), '') = ''
        AND ((SELECT sequence FROM root) IS NULL OR sequence >= (SELECT sequence FROM root))
        AND (json_extract(event, '$.scope.turnId') IS NULL
          OR json_extract(event, '$.scope.turnId') = (SELECT turn_id FROM root))
      ORDER BY sequence DESC LIMIT 1
    ), failure AS (
      SELECT CASE WHEN json_extract(event, '$.type') = 'turn/completed'
        THEN json_extract(event, '$.error.message') ELSE json_extract(event, '$.message') END AS message
      FROM latest WHERE
        (json_extract(event, '$.type') = 'turn/completed' AND json_extract(event, '$.status') = 'failed'
          AND json_type(event, '$.error.message') = 'text')
        OR (json_extract(event, '$.type') IN ('system/error', 'provider/error')
          AND COALESCE(json_extract(event, '$.willRetry'), 0) = 0
          AND json_extract(event, '$.reconnectAttempt') IS NULL
          AND json_type(event, '$.message') = 'text')
    ) SELECT substr(message, 1, ?) AS text FROM failure WHERE typeof(message) = 'text'
  `).get(threadId, ASSISTANT_PREVIEW_CHARS) as { text: string } | undefined;
  return row?.text.trim() || undefined;
}

/** Seek completed assistant text without loading tool output or the transcript. */
export function getConversationAssistantPreview(
  db: ZccDatabase,
  threadId: string,
  turnId: string | null,
  beforeTime: number
): { text: string; truncated: boolean } | undefined {
  if (!turnId) return undefined;
  // Both envelopes occur in persisted provider history. Bound the selected text
  // in SQLite before it crosses into V8; a message itself can be very large.
  const row = db.sqlite.prepare(`WITH candidates AS MATERIALIZED (
      SELECT payload, sequence, created_at FROM thread_events
      WHERE thread_id = ? AND type = 'item/completed'
      ORDER BY sequence DESC LIMIT ${ASSISTANT_PREVIEW_EVENT_LIMIT}
    ) SELECT substr(
      COALESCE(json_extract(payload, '$.item.text'), json_extract(payload, '$.event.item.text')), 1, ?
    ) AS text FROM candidates
    WHERE created_at <= ?
      AND COALESCE(json_extract(payload, '$.scope.turnId'), json_extract(payload, '$.event.scope.turnId')) = ?
      AND COALESCE(json_extract(payload, '$.item.type'), json_extract(payload, '$.event.item.type')) = 'agentMessage'
      AND COALESCE(json_extract(payload, '$.parentToolCallId'), json_extract(payload, '$.event.parentToolCallId'), '') = ''
      AND length(trim(COALESCE(json_extract(payload, '$.item.text'), json_extract(payload, '$.event.item.text'), ''))) > 0
    ORDER BY sequence DESC LIMIT 1`).get(threadId, ASSISTANT_PREVIEW_CHARS + 1, beforeTime, turnId) as { text: string } | undefined;
  if (!row) return undefined;
  return { text: row.text.slice(0, ASSISTANT_PREVIEW_CHARS), truncated: row.text.length > ASSISTANT_PREVIEW_CHARS };
}
