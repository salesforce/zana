import { historyQueryWorker } from './history-query-worker.js';
import type { ZccDatabase } from '@zana-ai/zcc-db';
import type { ThreadHistoryPage, ThreadHistoryQuery, ThreadHistoryRow } from '@zana-ai/zcc-domain/product';

export const THREAD_HISTORY_PAGE_SIZE = 40;

/** History reads are independent of the live roster, and never expose hidden runs. */
function historyQuery(query: ThreadHistoryQuery) {
  const offset = Number.isSafeInteger(query.offset) && query.offset! >= 0 ? Math.min(query.offset!, 100_000) : 0;
  const clauses = ["t.visibility = 'visible'"];
  const params: unknown[] = [];
  if (query.projectId) { clauses.push('t.project_id = ?'); params.push(query.projectId); }
  if (query.archived === 'archived') clauses.push('t.archived_at IS NOT NULL');
  if (query.archived === 'active') clauses.push('t.archived_at IS NULL');
  const needle = query.query?.trim().slice(0, 200);
  const pattern = needle ? `%${needle.replace(/[\\%_]/g, '\\$&')}%` : '';
  const snippetSql = needle ? `(SELECT json_object('sequence', e.sequence, 'payload', json(e.payload)) FROM thread_events e
    WHERE e.thread_id = t.id AND length(CAST(e.payload AS BLOB)) <= 262144
    AND (e.type = 'client/turn/requested' OR (e.type = 'item/completed'
      AND COALESCE(json_extract(e.payload, '$.event.item.type'), json_extract(e.payload, '$.item.type')) IN ('userMessage','assistantMessage','agentMessage')))
    AND e.payload LIKE ? ESCAPE '\\' ORDER BY e.sequence DESC LIMIT 1) AS matchingPayload,` : '';
  if (needle) {
    const pattern = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push(`(t.title LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM thread_events e WHERE e.thread_id = t.id
      AND (e.type = 'client/turn/requested' OR (e.type = 'item/completed'
        AND COALESCE(json_extract(e.payload, '$.event.item.type'), json_extract(e.payload, '$.item.type')) IN ('userMessage', 'assistantMessage', 'agentMessage')))
      AND e.payload LIKE ? ESCAPE '\\' LIMIT 1))`);
    params.push(pattern, pattern);
  }
  const sql = `SELECT ${snippetSql} t.id, t.project_id AS projectId, t.provider_id AS providerId,
    t.title, t.updated_at AS updatedAt, t.archived_at AS archivedAt,
    CASE WHEN env.id IS NULL OR env.status IN ('destroyed', 'destroying', 'failed') THEN 'The original environment is unavailable.'
      ELSE NULL END AS unavailableReason
    FROM threads t LEFT JOIN environments env ON env.id = t.environment_id
    WHERE ${clauses.join(' AND ')} ORDER BY ${needle ? 'CASE WHEN instr(lower(t.title), lower(?)) > 0 THEN 0 ELSE 1 END,' : ''} t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`;
  return { sql, params: [...(needle ? [pattern] : []), ...params, ...(needle ? [needle] : []), THREAD_HISTORY_PAGE_SIZE + 1, offset], offset };
}

function formatHistory(rows: Array<ThreadHistoryRow & { unavailableReason: string | null; matchingPayload?: string | null }>, offset: number, providers: readonly { id: string; displayName: string }[], query?: string): ThreadHistoryPage {
  return {
    rows: rows.slice(0, THREAD_HISTORY_PAGE_SIZE).map(({ unavailableReason, matchingPayload, ...row }) => ({
      ...row, ...(matchingPayload ? matchedMessage(matchingPayload, query ?? '') : {}), providerLabel: providers.find((provider) => provider.id === row.providerId)?.displayName, ...(unavailableReason ? { unavailableReason } : {})
    })),
    ...(rows.length > THREAD_HISTORY_PAGE_SIZE ? { nextOffset: offset + THREAD_HISTORY_PAGE_SIZE } : {})
  };
}

export function conversationHistory(db: ZccDatabase, query: ThreadHistoryQuery, providers: readonly { id: string; displayName: string }[] = []): ThreadHistoryPage {
  const { sql, params, offset } = historyQuery(query);
  const rows = db.sqlite.prepare(sql).all(...params) as Array<ThreadHistoryRow & { unavailableReason: string | null }>;
  return formatHistory(rows, offset, providers, query.query);
}

/** Expensive search uses a read-only connection in a bounded worker, with identical filters. */
export async function conversationHistoryAsync(db: ZccDatabase, query: ThreadHistoryQuery, providers: readonly { id: string; displayName: string }[] = []): Promise<ThreadHistoryPage> {
  if (!query.query?.trim() || db.file === ':memory:') return conversationHistory(db, query, providers);
  const { sql, params, offset } = historyQuery(query);
  const rows = await historyQueryWorker<ThreadHistoryRow & { unavailableReason: string | null }>(db.file, sql, params);
  return formatHistory(rows, offset, providers, query.query);
}

function matchedMessage(serialized: string, query: string): Pick<ThreadHistoryRow,'matchingMessage'> {
  try {
    const {sequence, payload} = JSON.parse(serialized);
    const texts = (value: unknown): string[] => {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(texts);
      if (value && typeof value === 'object') {
        const part = value as {text?:unknown;content?:unknown};
        return [...texts(part.text), ...texts(part.content)];
      }
      return [];
    };
    const text = texts(payload.input ?? payload.prompt ?? payload.event?.item ?? payload.item).join('\n');
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0 || !Number.isSafeInteger(sequence)) return {};
    const start = Math.max(0, at - 80);
    return {matchingMessage:{sequence, text:(start ? '…' : '') + text.slice(start,start+240) + (text.length > start+240 ? '…' : '')}};
  } catch { return {}; }
}
