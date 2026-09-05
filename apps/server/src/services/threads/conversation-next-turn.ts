import {
  isThreadQueueAutoSendPaused,
  listDeferredThreadMessages,
  type DeferredThreadMessageRow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';

function textFromDeferredPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { input?: unknown };
    const input = parsed.input;
    if (typeof input === 'string') return input.trim();
    if (!Array.isArray(input)) return '';
    return input
      .flatMap((part) => {
        if (!part || typeof part !== 'object') return [];
        if ((part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
          return [(part as { text: string }).text];
        }
        return [];
      })
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

export function conversationNextTurnItemView(row: DeferredThreadMessageRow) {
  return {
    id: row.id,
    status: row.status,
    paused: row.paused,
    sendAfter: row.sendAfter,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    text: textFromDeferredPayload(row.payload)
  };
}

export function conversationNextTurnView(ctx: Pick<ProductHttpContext, 'db'>, threadId: string) {
  const items = listDeferredThreadMessages(ctx.db, threadId)
    .filter((row) => row.status === 'queued' || row.status === 'failed')
    .map(conversationNextTurnItemView);
  return {
    paused: isThreadQueueAutoSendPaused(ctx.db, threadId),
    items
  };
}
