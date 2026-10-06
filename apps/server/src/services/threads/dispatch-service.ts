import { randomUUID } from 'node:crypto';
import {
  clearDispatchAdmissionGeneration,
  getDispatchAdmissionGeneration,
  recordDispatchAdmissionWait
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { DispatchAdmissionDecision } from '@zana-ai/zcc-domain';

const DISPATCH_ADMISSION_TIMEOUT_MS = 10_000;

/** Resolved wait state a caller can persist alongside a deferred send for a later CAS override. */
export interface DispatchAdmissionOutcome {
  decision: DispatchAdmissionDecision;
  generation: number;
  pluginId?: string;
}

export async function admitDispatch(
  ctx: ProductHttpContext,
  request: { threadId: string; projectId: string }
): Promise<DispatchAdmissionOutcome> {
  if (!ctx.plugins) return { decision: { action: 'proceed' }, generation: 1 };
  const current = getDispatchAdmissionGeneration(ctx.db, request.threadId);
  const generation = current?.generation ?? 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decision = await Promise.race([
      ctx.plugins.admitDispatch({ ...request, generation, dispatchId: randomUUID() }),
      new Promise<DispatchAdmissionDecision>((resolve) => {
        timer = setTimeout(() => resolve({ action: 'reject', message: 'Plugin dispatch admission timed out' }), DISPATCH_ADMISSION_TIMEOUT_MS);
      })
    ]);
    if (decision.action === 'wait') {
      const recorded = recordDispatchAdmissionWait(ctx.db, {
        threadId: request.threadId,
        overrideable: decision.overrideable,
        reason: decision.reason
      });
      return { decision, generation: recorded.generation, pluginId: decision.pluginId };
    }
    if (decision.action === 'proceed' || decision.action === 'reject') {
      // A reject must drop any earlier recorded wait too, or a stale
      // overrideable generation from before the reject survives and can
      // still be Send-now'd through after the reject.
      clearDispatchAdmissionGeneration(ctx.db, request.threadId);
    }
    return { decision, generation };
  } catch {
    // A failed admission cannot prove that all plugin vetoes were reviewed.
    clearDispatchAdmissionGeneration(ctx.db, request.threadId);
    return { decision: { action: 'reject', message: 'Plugin dispatch admission unavailable' }, generation };
  } finally {
    // Timeout wins over any late plugin response; it cannot record a wait.
    if (timer) clearTimeout(timer);
  }
}
