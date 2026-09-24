import type { ZccDatabase } from '@zana-ai/zcc-db';
import type { ThreadHistoryPage, ThreadHistoryQuery, ThreadHistoryRow } from '@zana-ai/zcc-domain/product';

export const THREAD_HISTORY_PAGE_SIZE = 40;

/** History reads are independent of the live roster, and never expose hidden runs. */
export function conversationHistory(db: ZccDatabase, query: ThreadHistoryQuery, providers: readonly { id: string; displayName: string }[] = []): ThreadHistoryPage {
  const offset = Number.isSafeInteger(query.offset) && query.offset! >= 0 ? Math.min(query.offset!, 100_000) : 0;
  const clauses = ["t.visibility = 'visible'"];
  const params: unknown[] = [];
  if (query.projectId) { clauses.push('t.project_id = ?'); params.push(query.projectId); }
  if (query.archived === 'archived') clauses.push('t.archived_at IS NOT NULL');
  if (query.archived === 'active') clauses.push('t.archived_at IS NULL');
  const needle = query.query?.trim().slice(0, 200);
  if (needle) {
    const pattern = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push(`(t.title LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM thread_events e WHERE e.thread_id = t.id
      AND (e.type = 'client/turn/requested' OR (e.type = 'item/completed'
        AND COALESCE(json_extract(e.payload, '$.event.item.type'), json_extract(e.payload, '$.item.type')) IN ('userMessage', 'assistantMessage', 'agentMessage')))
      AND e.payload LIKE ? ESCAPE '\\' LIMIT 1))`);
    params.push(pattern, pattern);
  }
  const rows = db.sqlite.prepare(`SELECT t.id, t.project_id AS projectId, t.provider_id AS providerId,
    t.title, t.updated_at AS updatedAt, t.archived_at AS archivedAt,
    CASE WHEN env.id IS NULL OR env.status IN ('destroyed', 'destroying', 'failed') THEN 'The original environment is unavailable.'
      ELSE NULL END AS unavailableReason
    FROM threads t LEFT JOIN environments env ON env.id = t.environment_id
    WHERE ${clauses.join(' AND ')} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, THREAD_HISTORY_PAGE_SIZE + 1, offset) as Array<ThreadHistoryRow & { unavailableReason: string | null }>;
  return {
    rows: rows.slice(0, THREAD_HISTORY_PAGE_SIZE).map(({ unavailableReason, ...row }) => ({
      ...row, providerLabel: providers.find((provider) => provider.id === row.providerId)?.displayName, ...(unavailableReason ? { unavailableReason } : {})
    })),
    ...(rows.length > THREAD_HISTORY_PAGE_SIZE ? { nextOffset: offset + THREAD_HISTORY_PAGE_SIZE } : {})
  };
}
