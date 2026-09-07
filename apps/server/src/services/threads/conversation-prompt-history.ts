import { listConversationThreadEventsWindow, type ConversationThreadEventRow } from '@zana-ai/zcc-db';
import {
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
    if (!part || typeof part !== 'object') return [];
    const row = part as { type?: unknown; text?: unknown };
    if (row.type !== 'text' || typeof row.text !== 'string' || !row.text.trim()) return [];
    return [{ type: 'text' as const, text: row.text, mentions: [] as [] }];
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
