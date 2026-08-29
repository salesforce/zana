import { listConversationThreadEventsWindow } from '@zana-ai/zcc-db';
import { reasoningLevelSchema, type ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';

const LAST_EXECUTION_SCAN_CAP = 80;

export interface ThreadLastExecution {
  model: string | null;
  reasoningLevel: ReasoningLevel | null;
}

export function readLastThreadExecution(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string
): ThreadLastExecution {
  const rows = listConversationThreadEventsWindow(ctx.db, threadId, { limit: LAST_EXECUTION_SCAN_CAP });
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const payload = rows[index]?.payload;
    if (!payload || typeof payload !== 'object' || !('type' in payload)) continue;
    if ((payload as { type?: unknown }).type !== 'client/turn/requested') continue;
    const execution = (payload as { execution?: unknown }).execution;
    if (!execution || typeof execution !== 'object') continue;
    const model = (execution as { model?: unknown }).model;
    const reasoning = reasoningLevelSchema.safeParse((execution as { reasoningLevel?: unknown }).reasoningLevel);
    return {
      model: typeof model === 'string' && model.trim() ? model : null,
      reasoningLevel: reasoning.success ? reasoning.data : null
    };
  }
  return { model: null, reasoningLevel: null };
}
