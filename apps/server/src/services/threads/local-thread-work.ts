import type { ZccDatabase } from '@zana-ai/zcc-db';

/** One existence read, independent of menu visibility, pagination, and provider. */
export function hasLocalThreadWork(db: ZccDatabase, hostId: string): boolean {
  return db.sqlite.prepare(`
    SELECT 1 FROM threads
    WHERE host_id = ? AND status IN ('starting', 'active', 'stopping')
      AND NOT EXISTS (
        SELECT 1 FROM pending_interactions
        WHERE thread_id = threads.id AND status IN ('pending', 'resolving')
      )
    LIMIT 1
  `).get(hostId) !== undefined;
}
