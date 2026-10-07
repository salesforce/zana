import type { ZccDatabase } from '../connection.js';

export interface PromptHistoryCursor { createdAt: number; id: string }
export interface StoredPromptHistoryRow {
  id: string; threadId: string; projectId: string; hostId: string;
  sequence: number; createdAt: number; payload: unknown;
}
export function userPromptHistoryQuery(options: {
  threadId?: string; projectId?: string; before?: PromptHistoryCursor; limit?: number; query?: string;
}) {
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 30) || 30));
  const clauses = ["t.visibility = 'visible'", "e.type = 'client/turn/requested'", "COALESCE(json_extract(e.payload, '$.initiator'), 'user') = 'user'", "json_extract(e.payload, '$.senderThreadId') IS NULL"];
  const values: unknown[] = [];
  if (options.threadId) { clauses.push('e.thread_id = ?'); values.push(options.threadId); }
  if (options.projectId) { clauses.push('t.project_id = ?'); values.push(options.projectId); }
  if (options.before) { clauses.push('(e.created_at < ? OR (e.created_at = ? AND e.id < ?))'); values.push(options.before.createdAt, options.before.createdAt, options.before.id); }
  if (options.query?.trim()) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(e.payload, '$.input'), '[]')) AS part WHERE json_extract(part.value, '$.type') = 'text' AND instr(lower(json_extract(part.value, '$.text')), lower(?)) > 0)");
    values.push(options.query.trim().slice(0, 200));
  }
  const sql = `SELECT e.id, e.thread_id AS threadId, t.project_id AS projectId, t.host_id AS hostId,
    e.sequence, e.created_at AS createdAt, CASE WHEN length(CAST(e.payload AS BLOB)) <= 262144 THEN e.payload ELSE '{}' END AS payload
    FROM thread_events e JOIN threads t ON t.id = e.thread_id
    WHERE ${clauses.join(' AND ')} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`;
  return { sql, params: [...values, limit + 1], limit };
}
export function formatUserPromptHistoryRows(raw: Iterable<Omit<StoredPromptHistoryRow, 'payload'> & { payload: string }>, limit: number) {
  const rows: StoredPromptHistoryRow[] = [];
  let bytes = 0;
  let next: PromptHistoryCursor | null = null;
  for (const row of raw) {
    if (rows.length >= limit || bytes + row.payload.length > 2_097_152) {
      const previous = rows.at(-1);
      next = previous ? { createdAt: previous.createdAt, id: previous.id } : null;
      break;
    }
    bytes += row.payload.length;
    rows.push({ ...row, payload: JSON.parse(row.payload) as unknown });
  }
  return { rows, next };
}

export function listUserPromptHistory(db: ZccDatabase, options: Parameters<typeof userPromptHistoryQuery>[0]) {
  const query = userPromptHistoryQuery(options);
  return formatUserPromptHistoryRows(db.sqlite.prepare(query.sql).iterate(...query.params) as Iterable<Omit<StoredPromptHistoryRow, 'payload'> & { payload: string }>, query.limit);
}
