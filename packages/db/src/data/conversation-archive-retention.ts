import type { ZccDatabase } from '../connection.js';
import { PRUNE_KIND } from './conversation-pruning-sql.js';

export const ARCHIVED_CONVERSATION_COMPACTION_BATCH_SIZE = 64;

// An archived thread keeps only its conversation: prompts, assistant
// messages, turn boundaries, errors and interruptions, questions to the user,
// and thread identity/plugin state. Every tool, reasoning, delegation and
// background item goes, along with these logs and snapshots.
export const ARCHIVED_CONVERSATION_LOG_TYPES = [
  'provider/unhandled', 'provider/rateLimits/updated', 'provider/warning',
  'thread/tokenUsage/updated', 'thread/contextWindowUsage/updated',
  'turn/diff/updated', 'turn/plan/updated', 'system/operation', 'system/permissionGrant/lifecycle'
] as const;
export const ARCHIVED_CONVERSATION_KEPT_ITEM_KINDS = ['agentMessage', 'userMessage'] as const;

const list = (values: readonly string[]) => values.map(value => `'${value}'`).join(', ');
// An item whose kind cannot be read is kept rather than guessed at.
const IS_LOG = `CASE
  WHEN type IN (${list(ARCHIVED_CONVERSATION_LOG_TYPES)}) THEN 1
  WHEN type IN ('item/started', 'item/completed') THEN COALESCE(${PRUNE_KIND} NOT IN (${list(ARCHIVED_CONVERSATION_KEPT_ITEM_KINDS)}), 0)
  WHEN type LIKE 'item/%' THEN type <> 'item/agentMessage/delta'
  ELSE 0 END`;
const TIP = 'SELECT MAX(sequence) AS tip FROM thread_events WHERE thread_id = ?';

export interface ArchivedConversationCompactionResult { threadId: string | null; scanned: number; removed: number }

function step(db: ZccDatabase): ArchivedConversationCompactionResult {
  const cursor = db.sqlite.prepare("SELECT thread_id, sequence FROM conversation_history_maintenance WHERE key = 'archive'")
    .get() as { thread_id: string; sequence: number } | undefined ?? { thread_id: '', sequence: 0 };
  const save = (threadId: string, sequence: number) => db.sqlite.prepare(`INSERT INTO conversation_history_maintenance
    (key, thread_id, sequence) VALUES ('archive', ?, ?) ON CONFLICT(key) DO UPDATE SET thread_id = excluded.thread_id, sequence = excluded.sequence`)
    .run(threadId, sequence);
  // A negative sequence marks a finished visit; discovery resumes after that thread.
  let threadId = cursor.thread_id;
  let sequence = cursor.sequence;
  const eligible = (id: string) => db.sqlite.prepare('SELECT 1 FROM threads WHERE id = ? AND archived_at IS NOT NULL').get(id);
  if (threadId === '' || sequence < 0 || !eligible(threadId)) {
    const next = db.sqlite.prepare(`SELECT t.id, COALESCE(c.compacted_through, 0) AS done FROM threads t
      LEFT JOIN conversation_archive_compactions c ON c.thread_id = t.id
      WHERE t.archived_at IS NOT NULL AND t.id > ?
        AND (c.thread_id IS NULL OR c.compacted_through < (SELECT MAX(sequence) FROM thread_events e WHERE e.thread_id = t.id))
      ORDER BY t.id LIMIT 1`).get(threadId) as { id: string; done: number } | undefined;
    if (!next) { save('', 0); return { threadId: null, scanned: 0, removed: 0 }; }
    threadId = next.id;
    sequence = next.done;
  }
  const tip = (db.sqlite.prepare(TIP).get(threadId) as { tip: number | null }).tip ?? 0;
  // The newest event anchors the thread's sequence, so it is never removed.
  const rows = db.sqlite.prepare(`SELECT id, sequence, ${IS_LOG} AS log FROM thread_events
    WHERE thread_id = ? AND sequence > ? AND sequence < ? ORDER BY sequence LIMIT ?`)
    .all(threadId, sequence, tip, ARCHIVED_CONVERSATION_COMPACTION_BATCH_SIZE) as { id: string; sequence: number; log: number }[];
  const remove = db.sqlite.prepare('DELETE FROM thread_events WHERE id = ?');
  let removed = 0;
  for (const row of rows) if (row.log) removed += remove.run(row.id).changes;
  sequence = rows.at(-1)?.sequence ?? sequence;
  const finished = rows.length < ARCHIVED_CONVERSATION_COMPACTION_BATCH_SIZE;
  if (finished) {
    db.sqlite.prepare(`INSERT INTO conversation_archive_compactions (thread_id, compacted_through, compacted_at) VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET compacted_through = excluded.compacted_through, compacted_at = excluded.compacted_at`)
      .run(threadId, tip, Date.now());
  }
  save(threadId, finished ? -1 : sequence);
  return { threadId, scanned: rows.length, removed };
}

/** Advance archived-thread compaction by one bounded batch. `threadId` is null once a cycle finds nothing left to do. */
export function compactArchivedConversations(db: ZccDatabase): ArchivedConversationCompactionResult {
  const timeout = db.sqlite.pragma('busy_timeout', { simple: true }) as number;
  db.sqlite.pragma('busy_timeout = 0');
  try { return db.transaction(() => step(db)); }
  finally { db.sqlite.pragma(`busy_timeout = ${timeout}`); }
}

/** Return up to `pages` free pages to the filesystem. Only databases created with incremental auto-vacuum can do so. */
export function reclaimFreeDatabasePages(db: ZccDatabase, pages = 64): number {
  if (db.sqlite.pragma('auto_vacuum', { simple: true }) !== 2) return 0;
  const free = db.sqlite.pragma('freelist_count', { simple: true }) as number;
  if (free === 0) return 0;
  db.sqlite.pragma(`incremental_vacuum(${Math.max(1, Math.floor(pages))})`);
  return free - (db.sqlite.pragma('freelist_count', { simple: true }) as number);
}
