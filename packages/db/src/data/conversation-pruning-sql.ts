// Shared by expression indexes and their queries: SQLite requires matching
// expressions to seek metadata without materializing a history payload in V8.
function field(path: string): string {
  return `CASE WHEN json_valid(payload) THEN COALESCE(json_extract(payload, '$.event.${path}'), json_extract(payload, '$.${path}')) END`;
}
function fieldType(path: string): string {
  return `CASE WHEN json_valid(payload) THEN COALESCE(json_type(payload, '$.event.${path}'), json_type(payload, '$.${path}')) END`;
}

export const PRUNE_TURN = field('scope.turnId');
export const PRUNE_ITEM = `COALESCE(${field('itemId')}, ${field('item.id')})`;
export const PRUNE_PARENT = `COALESCE(${field('item.parentToolCallId')}, ${field('parentToolCallId')})`;
export const PRUNE_KIND = field('item.type');
export const PRUNE_CAPACITY = field('contextWindowUsage.modelContextWindow');
export const PRUNE_FINAL_OUTPUT = `CASE ${PRUNE_KIND}
  WHEN 'commandExecution' THEN ${fieldType('item.aggregatedOutput')} = 'text'
  WHEN 'agentMessage' THEN ${fieldType('item.text')} = 'text' AND length(${field('item.text')}) > 0
  WHEN 'reasoning' THEN CASE WHEN ${fieldType('item.summary')} = 'array' AND ${fieldType('item.content')} = 'array'
    THEN COALESCE(length(json_extract(${field('item.summary')}, '$[0]')), 0) > 0
      OR COALESCE(length(json_extract(${field('item.content')}, '$[0]')), 0) > 0 ELSE 0 END
  ELSE 0 END`;
export const PRUNE_DELTA_TYPES = [
  'item/agentMessage/delta', 'item/commandExecution/outputDelta',
  'item/reasoning/summaryTextDelta', 'item/reasoning/textDelta'
] as const;
export const PRUNE_DELTA_LIST = PRUNE_DELTA_TYPES.map(type => `'${type}'`).join(', ');
export const qualifyPruningSql = (sql: string, alias: string) => sql.replace(/\bpayload\b/g, `${alias}.payload`);
export const PRUNE_ROOT_USAGE = `NOT EXISTS (SELECT 1 FROM thread_events nested INDEXED BY thread_events_nested_turn_idx
  WHERE nested.thread_id = candidate.thread_id AND ${qualifyPruningSql(PRUNE_TURN, 'nested')} = ${qualifyPruningSql(PRUNE_TURN, 'candidate')}
    AND nested.type = 'turn/started' AND ${qualifyPruningSql(PRUNE_PARENT, 'nested')} IS NOT NULL)`;

export const CONVERSATION_PRUNING_INDEXES = [
  'CREATE INDEX thread_events_type_thread_seq_idx ON thread_events(type, thread_id, sequence)',
  `CREATE INDEX thread_events_delta_candidates_idx ON thread_events(thread_id, sequence) WHERE type IN (${PRUNE_DELTA_LIST})`,
  `CREATE INDEX thread_events_delta_identity_idx ON thread_events(
    thread_id, ${PRUNE_TURN}, ${PRUNE_ITEM}, ${PRUNE_PARENT}, type, sequence
  ) WHERE type IN (${PRUNE_DELTA_LIST})`,
  `CREATE INDEX thread_events_completed_identity_idx ON thread_events(
    thread_id, ${PRUNE_TURN}, ${PRUNE_ITEM}, ${PRUNE_PARENT}, ${PRUNE_KIND}, ${PRUNE_FINAL_OUTPUT}, sequence
  ) WHERE type = 'item/completed'`,
  `CREATE INDEX thread_events_background_identity_idx ON thread_events(
    thread_id, ${PRUNE_ITEM}, ${PRUNE_PARENT}, type, ${PRUNE_KIND}, sequence
  ) WHERE type IN ('item/backgroundTask/progress', 'item/backgroundTask/completed')`,
  `CREATE INDEX thread_events_nested_turn_idx ON thread_events(thread_id, ${PRUNE_TURN})
    WHERE type = 'turn/started' AND ${PRUNE_PARENT} IS NOT NULL`,
  `CREATE INDEX thread_events_context_capacity_idx ON thread_events(thread_id, sequence)
    WHERE type = 'thread/contextWindowUsage/updated' AND ${PRUNE_CAPACITY} IS NOT NULL`
];

export const CONVERSATION_PRUNING_POLICY_NAMES = ['rate-limits', 'context-usage', 'token-usage', 'deltas', 'background'] as const;
/** Policy value of the per-thread "events changed" marker the insert trigger coalesces. */
export const CONVERSATION_PRUNING_PENDING = 'pending';

/**
 * Migration 31: a change queue so idle pruning visits only threads whose events
 * changed since a policy's last clean visit, instead of every thread holding an
 * event of the policy's type. Triggers (not call-site hooks) keep every writer
 * covered, including raw inserts from other connections. The bootstrap queues
 * existing history once; a policy added later needs its own bootstrap migration.
 * Idempotent, like migration 29, so lineage repairs can replay it safely.
 */
export const CONVERSATION_PRUNING_WORK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversation_pruning_work (
    policy TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    PRIMARY KEY (policy, thread_id)
  ) WITHOUT ROWID`,
  'CREATE INDEX IF NOT EXISTS conversation_pruning_work_thread_idx ON conversation_pruning_work(thread_id)',
  // ON CONFLICT DO NOTHING (unlike OR IGNORE) is not overridden by the firing statement's own conflict clause.
  `CREATE TRIGGER IF NOT EXISTS conversation_pruning_event_inserted AFTER INSERT ON thread_events
    BEGIN
      INSERT INTO conversation_pruning_work (policy, thread_id) VALUES ('pending', NEW.thread_id)
        ON CONFLICT (policy, thread_id) DO NOTHING;
    END`,
  // Archiving makes superseded-or-not rate-limit snapshots prunable without any new event.
  `CREATE TRIGGER IF NOT EXISTS conversation_pruning_thread_archived AFTER UPDATE OF archived_at ON threads
    WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
    BEGIN
      INSERT INTO conversation_pruning_work (policy, thread_id) VALUES ('rate-limits', NEW.id)
        ON CONFLICT (policy, thread_id) DO NOTHING;
    END`,
  `INSERT INTO conversation_pruning_work (policy, thread_id)
    SELECT policy.name, threads.id FROM threads
    CROSS JOIN (SELECT 'rate-limits' AS name UNION ALL SELECT 'context-usage' UNION ALL SELECT 'token-usage'
      UNION ALL SELECT 'deltas' UNION ALL SELECT 'background') AS policy
    WHERE EXISTS (SELECT 1 FROM thread_events WHERE thread_events.thread_id = threads.id)
    ON CONFLICT (policy, thread_id) DO NOTHING`
];
