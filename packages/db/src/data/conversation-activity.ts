import {
  LOCAL_AGENT_TASK_TYPE,
  LOCAL_BASH_TASK_TYPE,
  LOCAL_SUBAGENT_TASK_TYPE,
  LOCAL_WORKFLOW_TASK_TYPE,
  type ThreadActivityState
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ZccDatabase } from '../connection.js';
import type { ConversationThreadEventRow } from './conversation-events.js';

// Match the server's event decoder, including older wrapped events. Do this in
// SQLite so command output, diffs and workflow snapshots never enter V8 merely
// to compute a badge. Each task event carries its complete current state.
const EVENT_JSON = `CASE
  WHEN json_type(payload, '$.type') = 'text'
    AND json_type(payload, '$.threadId') = 'text'
    AND json_type(payload, '$.scope.kind') = 'text' THEN payload
  WHEN json_type(payload, '$.event.type') = 'text'
    AND json_type(payload, '$.event.threadId') = 'text'
    AND json_type(payload, '$.event.scope.kind') = 'text' THEN json_extract(payload, '$.event')
  ELSE NULL END`;

// Latest row per task/delegation of one thread (bound to `thread_id = ?`).
const BACKGROUND_TASKS_CTE = `
    WITH events AS (
      SELECT id, sequence, created_at, type, ${EVENT_JSON} AS event FROM thread_events
      WHERE thread_id = ? AND type IN (
        'item/started', 'item/completed',
        'item/backgroundTask/progress', 'item/backgroundTask/completed',
        'item/delegation/progress', 'item/delegation/completed'
      )
    ), tasks AS (
      SELECT id, sequence, type, event,
        MIN(created_at) OVER (PARTITION BY json_extract(event, '$.item.id')) AS created_at,
        json_extract(event, '$.item.id') AS item_id,
        json_extract(event, '$.item.type') AS item_type,
        json_extract(event, '$.item.parentToolCallId') AS parent_call_id,
        CASE WHEN json_extract(event, '$.item.type') = 'delegation' THEN '${LOCAL_AGENT_TASK_TYPE}'
          ELSE json_extract(event, '$.item.taskType') END AS task_type,
        json_extract(event, '$.item.status') AS status,
        json_extract(event, '$.item.skipTranscript') AS skip_transcript,
        json_extract(event, '$.item') AS item,
        ROW_NUMBER() OVER (
          PARTITION BY json_extract(event, '$.item.id') ORDER BY sequence DESC
        ) AS rank
      FROM events WHERE json_extract(event, '$.item.type') IN ('backgroundTask', 'delegation')
    ), visible_tasks AS (
      SELECT * FROM tasks AS candidate
      WHERE rank = 1 AND status = 'pending' AND NOT COALESCE(skip_transcript, 0)
        AND (item_type != 'delegation' OR NOT EXISTS (
          SELECT 1 FROM tasks AS native
          WHERE native.rank = 1 AND native.item_type = 'backgroundTask'
            AND native.task_type IN ('${LOCAL_AGENT_TASK_TYPE}', '${LOCAL_SUBAGENT_TASK_TYPE}')
            AND native.status = 'pending' AND NOT COALESCE(native.skip_transcript, 0)
            AND native.parent_call_id = candidate.item_id
        ))
        AND (item_type != 'delegation' OR NOT EXISTS (
          SELECT 1 FROM tasks AS parent
          WHERE parent.rank = 1 AND parent.item_type = 'delegation'
            AND parent.status = 'pending'
            AND parent.item_id = candidate.parent_call_id
        ))
        AND (item_type != 'backgroundTask' OR task_type NOT IN ('${LOCAL_AGENT_TASK_TYPE}', '${LOCAL_SUBAGENT_TASK_TYPE}') OR NOT EXISTS (
          SELECT 1 FROM tasks AS spawning JOIN tasks AS parent ON parent.item_id = spawning.parent_call_id
          WHERE spawning.rank = 1 AND spawning.item_type = 'delegation'
            AND spawning.item_id = candidate.parent_call_id
            AND parent.rank = 1 AND parent.item_type = 'delegation' AND parent.status = 'pending'
        ))
    )`;

/** Upper bound on the running tasks returned for one thread. */
export const OPEN_BACKGROUND_TASK_LIMIT = 200;
const OPEN_BACKGROUND_TASK_SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The background task items still running in a thread, as their latest stored
 * item JSON. Uses the same rows as the activity counts, so every task a badge or
 * card shows is listed, however old the event that started it.
 */
export function listConversationOpenBackgroundTaskItems(db: ZccDatabase, threadId: string): unknown[] {
  const rows = db.sqlite.prepare(`${BACKGROUND_TASKS_CTE}
    SELECT item FROM visible_tasks ORDER BY sequence DESC LIMIT ?
  `).all(threadId, OPEN_BACKGROUND_TASK_LIMIT) as Array<{ item: string }>;
  return rows.map(row => JSON.parse(row.item) as unknown);
}

/** Latest open snapshots for the activity card, bounded by rows and bytes. */
export function listConversationOpenBackgroundTaskEvents(db: ZccDatabase, threadId: string): ConversationThreadEventRow[] {
  const rows = db.sqlite.prepare(`${BACKGROUND_TASKS_CTE}, bounded AS (
    SELECT id, sequence, type, event, created_at,
      SUM(length(CAST(event AS BLOB))) OVER (ORDER BY sequence DESC) AS payload_bytes
    FROM tasks WHERE rank = 1 AND status = 'pending' AND NOT COALESCE(skip_transcript, 0)
  ) SELECT id, sequence, type, event, created_at FROM bounded
    WHERE payload_bytes <= ? ORDER BY sequence DESC LIMIT ?
  `).all(threadId, OPEN_BACKGROUND_TASK_SNAPSHOT_MAX_BYTES, OPEN_BACKGROUND_TASK_LIMIT) as Array<{
    id: string; sequence: number; type: string; event: string; created_at: number;
  }>;
  return rows.map(row => ({
    id: row.id, threadId, sequence: row.sequence, type: row.type,
    payload: JSON.parse(row.event) as unknown, createdAt: row.created_at,
  })).reverse();
}

/** Fixed-size result, independent of transcript size and number of past tasks. */
export function getConversationThreadActivityCounts(
  db: ZccDatabase,
  threadId: string
): Omit<ThreadActivityState, 'activePlanModeCount'> {
  const tasks = db.sqlite.prepare(`${BACKGROUND_TASKS_CTE}
    SELECT
      COUNT(CASE WHEN task_type = ? THEN 1 END) AS activeWorkflowCount,
      COUNT(CASE WHEN task_type IN (?, ?) THEN 1 END) AS activeBackgroundAgentCount,
      COUNT(CASE WHEN task_type = ? THEN 1 END) AS activeBackgroundCommandCount
    FROM visible_tasks
  `).get(threadId, LOCAL_WORKFLOW_TASK_TYPE, LOCAL_AGENT_TASK_TYPE, LOCAL_SUBAGENT_TASK_TYPE, LOCAL_BASH_TASK_TYPE) as {
    activeWorkflowCount: number; activeBackgroundAgentCount: number; activeBackgroundCommandCount: number;
  };
  const goal = db.sqlite.prepare(`
    SELECT json_extract(${EVENT_JSON}, '$.type') AS type FROM thread_events
    WHERE thread_id = ? AND type IN ('thread/goal/updated', 'thread/goal/cleared')
      AND ${EVENT_JSON} IS NOT NULL
    ORDER BY sequence DESC LIMIT 1
  `).get(threadId) as { type: string } | undefined;
  return { ...tasks, activeGoalCount: goal?.type === 'thread/goal/updated' ? 1 : 0 };
}

export const ACTIVE_PLAN_INPUT_PAGE_SIZE = 64;

/**
 * Only unmatched accepted inputs can still be in Plan mode. Filter completed
 * turns/interruption in SQL and page backwards; callers can stop at the first
 * Plan input without reading any answer/tool output or retaining old requests.
 */
export function listConversationActiveTurnInputs(
  db: ZccDatabase,
  threadId: string,
  beforeSequence = Number.MAX_SAFE_INTEGER
): Array<{ sequence: number; events: ConversationThreadEventRow[] }> {
  const rows = db.sqlite.prepare(`
    WITH control AS MATERIALIZED (
      SELECT id, sequence, created_at, type, ${EVENT_JSON} AS event
      FROM thread_events WHERE thread_id = ? AND type IN (
        'client/turn/requested', 'turn/input/accepted', 'turn/completed', 'system/thread/interrupted'
      )
    )
    SELECT accepted.id, accepted.sequence, accepted.created_at, accepted.event AS accepted,
      request.id AS request_id, request.sequence AS request_sequence,
      request.created_at AS request_created_at, request.event AS request
    FROM control AS accepted
    JOIN control AS request ON request.id = (
      SELECT id FROM control
      WHERE type = 'client/turn/requested'
        AND json_extract(event, '$.requestId') = json_extract(accepted.event, '$.clientRequestId')
      ORDER BY sequence DESC LIMIT 1
    )
    WHERE accepted.type = 'turn/input/accepted' AND accepted.event IS NOT NULL
      AND accepted.sequence < ?
      AND accepted.sequence > COALESCE((
        SELECT MAX(sequence) FROM control WHERE type = 'system/thread/interrupted' AND event IS NOT NULL
      ), -1)
      AND NOT EXISTS (
        SELECT 1 FROM control AS completed WHERE completed.type = 'turn/completed'
          AND json_extract(completed.event, '$.scope.turnId') = json_extract(accepted.event, '$.scope.turnId')
      )
    ORDER BY accepted.sequence DESC LIMIT ?
  `).all(threadId, beforeSequence, ACTIVE_PLAN_INPUT_PAGE_SIZE) as Array<{
    id: string; sequence: number; created_at: number; accepted: string;
    request_id: string; request_sequence: number; request_created_at: number; request: string;
  }>;
  return rows.map(row => ({
    sequence: row.sequence,
    events: [
      { id: row.request_id, threadId, sequence: row.request_sequence, createdAt: row.request_created_at,
        type: 'client/turn/requested', payload: JSON.parse(row.request) },
      { id: row.id, threadId, sequence: row.sequence, createdAt: row.created_at,
        type: 'turn/input/accepted', payload: JSON.parse(row.accepted) }
    ]
  }));
}
