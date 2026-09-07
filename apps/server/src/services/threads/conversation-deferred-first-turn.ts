import {
  getConversationThread,
  listConversationThreadEventsWindow,
  type ConversationThreadEventRow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';

export interface DeferredFirstTurnContext {
  input: unknown[];
  requestSequence: number;
}

export function getLeadingAgentOnlyInput(input: unknown[]): unknown[] {
  const visibleIndex = input.findIndex((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
    return (item as { visibility?: unknown }).visibility !== 'agent-only';
  });
  return input.slice(0, visibleIndex === -1 ? input.length : visibleIndex);
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function isSeedOrUndeliveredRetry(
  payload: Record<string, unknown>,
  threadStatus: string | undefined
): boolean {
  const target = payload.target && typeof payload.target === 'object'
    ? payload.target as { kind?: unknown }
    : null;
  const kind = typeof target?.kind === 'string' ? target.kind : '';
  const source = typeof payload.source === 'string' ? payload.source : '';
  if (source === 'spawn' && kind === 'thread-start') return true;
  return source === 'tell' && kind === 'new-turn' && threadStatus === 'error';
}

function lastTurnRequest(rows: ConversationThreadEventRow[]): ConversationThreadEventRow | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.type === 'client/turn/requested') return row;
  }
  return null;
}

export function resolveDeferredFirstTurnContext(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string
): DeferredFirstTurnContext | null {
  const thread = getConversationThread(ctx.db, threadId);
  const rows = listConversationThreadEventsWindow(ctx.db, threadId, { limit: 400 });
  const request = lastTurnRequest(rows);
  if (!request) return null;
  const payload = payloadRecord(request.payload);
  if (!payload) return null;
  const input = Array.isArray(payload.input) ? payload.input : [];
  const leading = getLeadingAgentOnlyInput(input);
  if (leading.length === 0 || !isSeedOrUndeliveredRetry(payload, thread?.status)) return null;
  const startedAfter = rows.some((row) => (
    row.sequence > request.sequence
    && (row.type === 'turn/started' || row.type === 'turn/input/accepted')
  ));
  if (startedAfter) return null;
  return { input: leading, requestSequence: request.sequence };
}

export function prependDeferredFirstTurnContext(
  input: unknown,
  context: DeferredFirstTurnContext | null
): unknown {
  if (!context) return input;
  if (Array.isArray(input)) return [...context.input, ...input];
  return input;
}
