import type { ZccDatabase } from '../connection.js';
import {
  CONVERSATION_PRUNING_PENDING, CONVERSATION_PRUNING_POLICY_NAMES, PRUNE_CAPACITY, PRUNE_DELTA_LIST, PRUNE_FINAL_OUTPUT,
  PRUNE_ITEM, PRUNE_KIND, PRUNE_PARENT, PRUNE_TURN, PRUNE_ROOT_USAGE, qualifyPruningSql as qualified
} from './conversation-pruning-sql.js';

// Adapted from BB's usage/rate-limit/resolved-item pruning policies (MIT).
export const CONVERSATION_PRUNING_BATCH_SIZE = 32;
export const CONVERSATION_PRUNING_POLICIES = CONVERSATION_PRUNING_POLICY_NAMES;
export type ConversationPruningPolicy = typeof CONVERSATION_PRUNING_POLICIES[number];
interface Cursor {
  policy: ConversationPruningPolicy; thread_id: string; sequence: number;
  upper_sequence: number; phase: number; root_id: string | null; capacity_id: string | null;
}
interface Candidate { id: string; sequence: number; is_root: number; has_capacity: number }
const TYPES = {
  'rate-limits': 'provider/rateLimits/updated', 'context-usage': 'thread/contextWindowUsage/updated',
  'token-usage': 'thread/tokenUsage/updated', background: 'item/backgroundTask/progress'
} as const;
const highWaterGuard = 'candidate.sequence < (SELECT MAX(sequence) FROM thread_events WHERE thread_id = candidate.thread_id)';
const sameItem = (alias: string, turn = true) => `${alias}.thread_id = candidate.thread_id
  ${turn ? `AND ${qualified(PRUNE_TURN, alias)} = ${qualified(PRUNE_TURN, 'candidate')}` : ''}
  AND ${qualified(PRUNE_ITEM, alias)} = ${qualified(PRUNE_ITEM, 'candidate')}
  AND ${qualified(PRUNE_PARENT, alias)} IS ${qualified(PRUNE_PARENT, 'candidate')}`;

const deltaDelete = `DELETE FROM thread_events AS candidate WHERE candidate.id = ? AND ${highWaterGuard}
  AND EXISTS (SELECT 1 FROM thread_events earlier INDEXED BY thread_events_delta_identity_idx
    WHERE ${sameItem('earlier')} AND earlier.type IN (${PRUNE_DELTA_LIST})
      AND earlier.type = candidate.type AND earlier.sequence < candidate.sequence)
  AND EXISTS (SELECT 1 FROM thread_events final INDEXED BY thread_events_completed_identity_idx
    WHERE ${sameItem('final')} AND final.type = 'item/completed'
      AND ${qualified(PRUNE_KIND, 'final')} = CASE candidate.type
        WHEN 'item/agentMessage/delta' THEN 'agentMessage'
        WHEN 'item/commandExecution/outputDelta' THEN 'commandExecution' ELSE 'reasoning' END
      AND ${qualified(PRUNE_FINAL_OUTPUT, 'final')} = 1 AND final.sequence > candidate.sequence)`;
const backgroundDelete = `DELETE FROM thread_events AS candidate WHERE candidate.id = ? AND ${highWaterGuard}
  AND ${qualified(PRUNE_KIND, 'candidate')} = 'backgroundTask'
  AND (EXISTS (SELECT 1 FROM thread_events newer INDEXED BY thread_events_background_identity_idx
    WHERE ${sameItem('newer', false)} AND newer.type IN ('item/backgroundTask/progress', 'item/backgroundTask/completed')
      AND newer.type = 'item/backgroundTask/progress' AND ${qualified(PRUNE_KIND, 'newer')} = 'backgroundTask'
      AND newer.sequence > candidate.sequence)
    OR EXISTS (SELECT 1 FROM thread_events final INDEXED BY thread_events_background_identity_idx
    WHERE ${sameItem('final', false)} AND final.type IN ('item/backgroundTask/progress', 'item/backgroundTask/completed')
      AND final.type = 'item/backgroundTask/completed' AND ${qualified(PRUNE_KIND, 'final')} = 'backgroundTask'
      AND final.sequence > candidate.sequence))`;

const PENDING_MARKERS = `FROM conversation_pruning_work WHERE policy = '${CONVERSATION_PRUNING_PENDING}'`;
const PENDING_BATCH = `SELECT thread_id ${PENDING_MARKERS} ORDER BY thread_id LIMIT ${CONVERSATION_PRUNING_BATCH_SIZE}`;

/** Fan a bounded batch of event-changed threads out to every policy's queue. An idle pass only reads. */
function drainPendingWork(db: ZccDatabase) {
  if (!db.sqlite.prepare(`SELECT 1 ${PENDING_MARKERS} LIMIT 1`).get()) return;
  db.sqlite.prepare(`INSERT INTO conversation_pruning_work (policy, thread_id)
    SELECT policy.value, pending.thread_id FROM (${PENDING_BATCH}) AS pending, json_each(?) AS policy WHERE true
    ON CONFLICT (policy, thread_id) DO NOTHING`).run(JSON.stringify(CONVERSATION_PRUNING_POLICIES));
  db.sqlite.prepare(`DELETE FROM conversation_pruning_work
    WHERE policy = '${CONVERSATION_PRUNING_PENDING}' AND thread_id IN (${PENDING_BATCH})`).run();
}

function advance(db: ZccDatabase, policy: ConversationPruningPolicy) {
  drainPendingWork(db);
  const usage = policy === 'context-usage' || policy === 'token-usage';
  const filter = policy === 'deltas' ? `type IN (${PRUNE_DELTA_LIST})` : `type = '${TYPES[policy]}'`;
  const index = policy === 'deltas' ? 'thread_events_delta_candidates_idx' : 'thread_events_type_thread_seq_idx';
  const cursor = db.sqlite.prepare('SELECT * FROM conversation_event_pruning_cursors WHERE policy = ?').get(policy) as Cursor | undefined
    ?? { policy, thread_id: '', sequence: 0, upper_sequence: 0, phase: 0, root_id: null, capacity_id: null };
  const initial = JSON.stringify(cursor);
  // An idle pass changes nothing, so it must not take the write lock or touch the WAL.
  const save = () => { if (JSON.stringify(cursor) !== initial) db.sqlite.prepare(`INSERT INTO conversation_event_pruning_cursors
    (policy, thread_id, sequence, upper_sequence, phase, root_id, capacity_id) VALUES (@policy, @thread_id, @sequence, @upper_sequence, @phase, @root_id, @capacity_id)
    ON CONFLICT(policy) DO UPDATE SET thread_id=excluded.thread_id, sequence=excluded.sequence,
      upper_sequence=excluded.upper_sequence, phase=excluded.phase, root_id=excluded.root_id, capacity_id=excluded.capacity_id`).run(cursor); };
  const resetVisit = () => { cursor.sequence = 0; cursor.phase = 0; cursor.root_id = null; cursor.capacity_id = null; };
  if (cursor.upper_sequence === 0) {
    // Only threads whose events changed since this policy's last visit are queued. Claiming the row
    // here, atomically with the cursor, means any later write re-queues the thread for another visit.
    const next = db.sqlite.prepare(`SELECT thread_id FROM conversation_pruning_work
      WHERE policy = ? AND thread_id > ? ORDER BY thread_id LIMIT 1`).get(policy, cursor.thread_id) as { thread_id: string } | undefined;
    resetVisit();
    cursor.thread_id = next?.thread_id ?? '';
    if (!next) { save(); return { policy, threadId: null, scanned: 0, removed: 0 }; }
    db.sqlite.prepare('DELETE FROM conversation_pruning_work WHERE policy = ? AND thread_id = ?').run(policy, next.thread_id);
    cursor.upper_sequence = (db.sqlite.prepare('SELECT MAX(sequence) AS seq FROM thread_events WHERE thread_id = ?').get(next.thread_id) as { seq: number | null }).seq ?? 0;
    // Its events were all removed since it was queued: nothing to scan.
    if (cursor.upper_sequence === 0) { save(); return { policy, threadId: next.thread_id, scanned: 0, removed: 0 }; }
  }
  // Rewind/deletion may remove a keeper between discovery and deletion. Restart
  // discovery before discarding any older snapshots in that case.
  if (usage && cursor.phase === 1) {
    const keeper = db.sqlite.prepare(`SELECT 1 FROM thread_events WHERE id = ? AND thread_id = ? AND ${filter}`);
    if ([cursor.root_id, cursor.capacity_id].some(id => id !== null && !keeper.get(id, cursor.thread_id))) {
      resetVisit(); save(); return { policy, threadId: cursor.thread_id, scanned: 0, removed: 0 };
    }
  }
  const rows = db.sqlite.prepare(`SELECT id, sequence,
    ${usage && cursor.phase === 0 ? `${PRUNE_ROOT_USAGE} AS is_root, ${qualified(PRUNE_CAPACITY, 'candidate')} IS NOT NULL AS has_capacity` : '0 AS is_root, 0 AS has_capacity'}
    FROM thread_events candidate INDEXED BY ${index}
    WHERE ${filter} AND thread_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence LIMIT ?`)
    .all(cursor.thread_id, cursor.sequence, cursor.upper_sequence, CONVERSATION_PRUNING_BATCH_SIZE) as Candidate[];
  let removed = 0;
  if (usage && cursor.phase === 0) {
    for (const row of rows) if (row.is_root) {
      cursor.root_id = row.id;
      if (policy === 'context-usage' && row.has_capacity) cursor.capacity_id = row.id;
    }
  } else {
    const statement = policy === 'deltas' ? deltaDelete : policy === 'background' ? backgroundDelete
      : usage ? `DELETE FROM thread_events AS candidate WHERE id = ? AND ${highWaterGuard}
          AND id IS NOT @root AND id IS NOT @capacity`
      : `DELETE FROM thread_events AS candidate WHERE id = ? AND ${highWaterGuard}
          AND (EXISTS (SELECT 1 FROM threads WHERE id = candidate.thread_id AND archived_at IS NOT NULL)
            OR EXISTS (SELECT 1 FROM thread_events newer WHERE newer.thread_id = candidate.thread_id
              AND newer.type = 'provider/rateLimits/updated' AND newer.sequence > candidate.sequence))`;
    const remove = db.sqlite.prepare(statement);
    for (const row of rows) removed += (usage
      ? remove.run({ root: cursor.root_id, capacity: cursor.capacity_id }, row.id)
      : remove.run(row.id)).changes;
  }
  // A usage thread with no usage events at all has no keepers to find and nothing to delete.
  const noUsage = cursor.sequence === 0 && rows.length === 0;
  cursor.sequence = rows.at(-1)?.sequence ?? cursor.sequence;
  if (rows.length < CONVERSATION_PRUNING_BATCH_SIZE || cursor.sequence >= cursor.upper_sequence) {
    if (usage && cursor.phase === 0 && !noUsage) { cursor.phase = 1; cursor.sequence = 0; }
    else { cursor.upper_sequence = 0; resetVisit(); }
  }
  save();
  return { policy, threadId: cursor.thread_id, scanned: rows.length, removed };
}

/** Every policy advances at most 32 indexed candidates, in one atomic visit, and only for threads whose
 * events changed since its last visit (`conversation_pruning_work`), so an idle pass costs O(1), not O(threads).
 * Metadata and keeper IDs are the only values read into JavaScript. */
export function maintainConversationEventHistory(db: ZccDatabase, policy?: ConversationPruningPolicy) {
  const timeout = db.sqlite.pragma('busy_timeout', { simple: true }) as number;
  db.sqlite.pragma('busy_timeout = 0');
  try {
    return db.transaction(() => (policy ? [policy] : CONVERSATION_PRUNING_POLICIES).map(value => advance(db, value)));
  } finally { db.sqlite.pragma(`busy_timeout = ${timeout}`); }
}
