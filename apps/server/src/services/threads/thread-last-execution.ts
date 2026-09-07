import { listConversationThreadEventsWindow } from '@zana-ai/zcc-db';
import { reasoningLevelSchema, type ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';

const LAST_EXECUTION_SCAN_CAP = 80;

export interface ThreadLastExecution {
  model: string | null;
  reasoningLevel: ReasoningLevel | null;
  acpMode: string | null;
}

export function readLastThreadExecution(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string
): ThreadLastExecution {
  const rows = listConversationThreadEventsWindow(ctx.db, threadId, { limit: LAST_EXECUTION_SCAN_CAP });
  // model/reasoning come from the NEWEST turn. acpMode comes from the newest turn
  // that actually RECORDED a role: a follow-up carrying no role (e.g. an agent
  // tell or plan resume) doesn't change the running mode, so it must not blank
  // the picker — the last explicitly-chosen role stays current.
  let newest: { model: string | null; reasoningLevel: ReasoningLevel | null } | null = null;
  let acpMode: string | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const payload = rows[index]?.payload;
    if (!payload || typeof payload !== 'object' || !('type' in payload)) continue;
    if ((payload as { type?: unknown }).type !== 'client/turn/requested') continue;
    const execution = (payload as { execution?: unknown }).execution;
    if (!execution || typeof execution !== 'object') continue;
    if (!newest) {
      const model = (execution as { model?: unknown }).model;
      const reasoning = reasoningLevelSchema.safeParse((execution as { reasoningLevel?: unknown }).reasoningLevel);
      newest = {
        model: typeof model === 'string' && model.trim() ? model : null,
        reasoningLevel: reasoning.success ? reasoning.data : null
      };
    }
    if (acpMode === null) {
      const mode = (execution as { acpMode?: unknown }).acpMode;
      if (typeof mode === 'string' && mode.trim()) acpMode = mode;
    }
    if (newest && acpMode !== null) break;
  }
  return { model: newest?.model ?? null, reasoningLevel: newest?.reasoningLevel ?? null, acpMode };
}
