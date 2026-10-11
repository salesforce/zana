import type { ZccDatabase } from '@zana-ai/zcc-db';
import {
  isNotificationLevel,
  isOwnNotificationLevel,
  type NotificationLevel,
  type OwnNotificationLevel
} from '@zana-ai/zcc-domain';

/**
 * Per-thread notification levels live in the existing `thread_plugin_metadata`
 * table under this reserved owner id. Plugin ids start with a letter or digit
 * (`isPluginId`), so no plugin can read or write this row, and `ON DELETE
 * CASCADE` on `thread_id` removes a level with its thread. SQLite transactions
 * serialize the read-modify-write; only non-default levels are stored.
 */
export const NOTIFICATION_METADATA_OWNER = '__thread_notifications__';
/** Retention cap on stored overrides (rows exist only for threads that set one). */
export const MAX_NOTIFICATION_OVERRIDES = 2_000;
const LOOKUP_BATCH = 500;

export class NotificationLimitError extends Error {
  constructor(max: number) {
    super(`at most ${max} threads can have their own notification level; set some back to Default first`);
    this.name = 'NotificationLimitError';
  }
}

export interface NotificationLevelStore {
  getOwn(threadId: string): OwnNotificationLevel;
  /** Own levels (non-default only) for the given threads. */
  ownLevels(threadIds: readonly string[]): Map<string, NotificationLevel>;
  setOwn(threadId: string, level: OwnNotificationLevel): void;
  count(): number;
}

function parseLevel(metadataJson: string): NotificationLevel | null {
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    const level = parsed && typeof parsed === 'object' ? (parsed as { level?: unknown }).level : undefined;
    return isNotificationLevel(level) ? level : null;
  } catch {
    return null;
  }
}

export function createNotificationLevelStore(
  db: ZccDatabase,
  options: { maxOverrides?: number } = {}
): NotificationLevelStore {
  const maxOverrides = options.maxOverrides ?? MAX_NOTIFICATION_OVERRIDES;

  function count(): number {
    const row = db.sqlite
      .prepare('SELECT COUNT(*) AS n FROM thread_plugin_metadata WHERE plugin_id = ?')
      .get(NOTIFICATION_METADATA_OWNER) as { n: number };
    return row.n;
  }

  function ownLevels(threadIds: readonly string[]): Map<string, NotificationLevel> {
    const levels = new Map<string, NotificationLevel>();
    for (let start = 0; start < threadIds.length; start += LOOKUP_BATCH) {
      const batch = threadIds.slice(start, start + LOOKUP_BATCH);
      const marks = batch.map(() => '?').join(', ');
      const rows = db.sqlite
        .prepare(
          `SELECT thread_id, metadata_json FROM thread_plugin_metadata
            WHERE plugin_id = ? AND thread_id IN (${marks})`
        )
        .all(NOTIFICATION_METADATA_OWNER, ...batch) as Array<{ thread_id: string; metadata_json: string }>;
      for (const row of rows) {
        const level = parseLevel(row.metadata_json);
        if (level !== null) levels.set(row.thread_id, level);
      }
    }
    return levels;
  }

  function hasRow(threadId: string): boolean {
    return (
      db.sqlite
        .prepare('SELECT 1 AS n FROM thread_plugin_metadata WHERE thread_id = ? AND plugin_id = ?')
        .get(threadId, NOTIFICATION_METADATA_OWNER) !== undefined
    );
  }

  return {
    getOwn(threadId) {
      return ownLevels([threadId]).get(threadId) ?? 'inherit';
    },
    ownLevels,
    count,
    setOwn(threadId, level) {
      if (!isOwnNotificationLevel(level)) throw new Error('invalid notification level');
      db.transaction(() => {
        if (level === 'inherit') {
          db.sqlite
            .prepare('DELETE FROM thread_plugin_metadata WHERE thread_id = ? AND plugin_id = ?')
            .run(threadId, NOTIFICATION_METADATA_OWNER);
          return;
        }
        if (!hasRow(threadId) && count() >= maxOverrides) {
          // Archived threads are rarely revisited: reclaim their overrides first. Not an archived
          // ancestor of a thread still in use, though: its level caps that thread, and dropping a
          // muted parent's override would start notifications from its running children.
          db.sqlite
            .prepare(
              `WITH RECURSIVE in_use_ancestors(id) AS (
                 SELECT parent_thread_id FROM threads
                  WHERE archived_at IS NULL AND parent_thread_id IS NOT NULL
                 UNION
                 SELECT t.parent_thread_id FROM threads t JOIN in_use_ancestors a ON t.id = a.id
                  WHERE t.parent_thread_id IS NOT NULL
               )
               DELETE FROM thread_plugin_metadata
                WHERE plugin_id = ?
                  AND thread_id IN (SELECT id FROM threads WHERE archived_at IS NOT NULL)
                  AND thread_id NOT IN (SELECT id FROM in_use_ancestors)`
            )
            .run(NOTIFICATION_METADATA_OWNER);
          if (count() >= maxOverrides) throw new NotificationLimitError(maxOverrides);
        }
        db.sqlite
          .prepare(
            `INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json)
             VALUES (?, ?, ?)
             ON CONFLICT(thread_id, plugin_id) DO UPDATE SET metadata_json = excluded.metadata_json`
          )
          .run(threadId, NOTIFICATION_METADATA_OWNER, JSON.stringify({ level }));
      });
    }
  };
}
