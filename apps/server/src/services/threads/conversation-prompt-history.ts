import { pathLooksRuntimeReadable } from '../projects/attachments.js';
import { historyQueryWorker } from './history-query-worker.js';
import { listConversationThreadEventsWindow, listUserPromptHistory, userPromptHistoryQuery, formatUserPromptHistoryRows, type StoredPromptHistoryRow, type ConversationThreadEventRow } from '@zana-ai/zcc-db';
import {
  promptInputSchema,
  PROMPT_HISTORY_ENTRY_LIMIT,
  takeVisiblePromptHistoryEntries,
  type PromptHistoryEntry
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { getConversationThread } from '@zana-ai/zcc-db';

const SCAN_CAP = 400;

function promptInputFromPayload(payload: unknown): PromptHistoryEntry['input'] | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { type?: unknown; input?: unknown; event?: { input?: unknown } };
  const input = Array.isArray(record.input) ? record.input : Array.isArray(record.event?.input) ? record.event.input : null;
  if (!input) return null;
  const parts = input.flatMap((part) => {
    const parsed = promptInputSchema.safeParse(part);
    return parsed.success ? [parsed.data] : [];
  });
  return parts.length > 0 ? parts : null;
}

function entriesFromRows(rows: ConversationThreadEventRow[]): PromptHistoryEntry[] {
  const collected: PromptHistoryEntry[] = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.type !== 'client/turn/requested' && row.type !== 'turn/input/accepted') continue;
    const input = promptInputFromPayload(row.payload);
    if (!input) continue;
    collected.push({ id: String(row.sequence), createdAt: row.createdAt, input });
  }
  return takeVisiblePromptHistoryEntries({ entries: collected, limit: PROMPT_HISTORY_ENTRY_LIMIT });
}

export function conversationPromptHistory(
  ctx: ProductHttpContext,
  threadId: string
): { entries: PromptHistoryEntry[] } {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const rows = listConversationThreadEventsWindow(ctx.db, threadId, { limit: SCAN_CAP });
  return { entries: entriesFromRows(rows) };
}

export interface PagedPromptHistoryEntry extends PromptHistoryEntry {
  threadId: string; projectId: string; hostId: string; sequence: number;
}
export async function pagedConversationPromptHistory(ctx: Pick<ProductHttpContext, 'db'>, args: {
  scope: 'thread' | 'project' | 'all'; threadId?: string; projectId?: string; cursor?: string; query?: string;
}) {
  if ((args.scope === 'thread' && !args.threadId) || (args.scope === 'project' && !args.projectId)) {
    throw new ThreadCreateError(400, 'invalid_scope', 'Select a thread or project for this history scope');
  }
  let before: { createdAt: number; id: string } | undefined;
  if (args.cursor) {
    try {
      if (args.cursor.length > 512) throw new Error();
      const parsed: unknown = JSON.parse(Buffer.from(args.cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || typeof parsed[1] !== 'string' || parsed[1].length > 100) throw new Error();
      before = { createdAt: parsed[0], id: parsed[1] };
    } catch { throw new ThreadCreateError(400, 'invalid_cursor', 'Invalid prompt history cursor'); }
  }
  if (args.scope === 'thread' && !getConversationThread(ctx.db, args.threadId!)) throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  const options = {
    ...(args.scope === 'thread' ? { threadId: args.threadId } : {}),
    ...(args.scope === 'project' ? { projectId: args.projectId } : {}), before, query: args.query
  };
  const query = userPromptHistoryQuery(options);
  const page = args.query?.trim() && ctx.db.file !== ':memory:'
    ? formatUserPromptHistoryRows(await historyQueryWorker<Omit<StoredPromptHistoryRow, 'payload'> & { payload: string }>(ctx.db.file, query.sql, query.params), query.limit)
    : listUserPromptHistory(ctx.db, options);
  const entries: PagedPromptHistoryEntry[] = page.rows.flatMap(row => {
    const input = promptInputFromPayload(row.payload);
    return input ? [{ id: row.id, createdAt: row.createdAt, input: input.map(part => part.type === 'localImage' || part.type === 'localFile' ? { ...part, ...(pathLooksRuntimeReadable(part.path) ? { hostId: row.hostId } : { sourceProjectId: row.projectId }) } : part), threadId: row.threadId, projectId: row.projectId, hostId: row.hostId, sequence: row.sequence }] : [];
  });
  return { entries, nextCursor: page.next ? Buffer.from(JSON.stringify([page.next.createdAt, page.next.id])).toString('base64url') : null };
}
