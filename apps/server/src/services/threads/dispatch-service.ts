import { randomUUID } from 'node:crypto';
import {
  clearDispatchAdmissionGeneration,
  getDispatchAdmissionGeneration,
  recordDispatchAdmissionWait
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { DispatchAdmissionContract, DispatchAdmissionDecision } from '@zana-ai/zcc-domain';

const DISPATCH_ADMISSION_TIMEOUT_MS = 10_000;

/** Resolved wait state a caller can persist alongside a deferred send for a later CAS override. */
export interface DispatchAdmissionOutcome {
  decision: DispatchAdmissionDecision;
  generation: number;
  pluginId?: string;
}

/** Host-resolved identity of one dispatch; core adds the id and generation. */
export type DispatchAdmissionRequest = Omit<DispatchAdmissionContract, 'dispatchId' | 'generation'>;

/**
 * Fold an outcome for a caller that cannot hold the send for later (a create,
 * a fork, a PTY input). A wait is a refusal there: nothing is recorded and no
 * override can release it. Returns null when the dispatch may proceed.
 */
export function admissionRefusal(outcome: DispatchAdmissionOutcome): { code: 'dispatch_rejected' | 'dispatch_waiting'; message: string } | null {
  const { decision } = outcome;
  if (decision.action === 'reject') return { code: 'dispatch_rejected', message: decision.message };
  if (decision.action === 'wait') return { code: 'dispatch_waiting', message: decision.reason };
  return null;
}

export async function admitDispatch(
  ctx: ProductHttpContext,
  request: DispatchAdmissionRequest,
  assertCurrent?: () => void
): Promise<DispatchAdmissionOutcome> {
  if (!ctx.plugins) return { decision: { action: 'proceed' }, generation: 1 };
  // Only a thread can carry a persisted wait generation; a session or a not-yet-created
  // target admits statelessly at generation 1.
  const threadId = request.threadId;
  const current = threadId ? getDispatchAdmissionGeneration(ctx.db, threadId) : undefined;
  const generation = current?.generation ?? 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decision = await Promise.race([
      ctx.plugins.admitDispatch({ ...request, generation, dispatchId: randomUUID() }),
      new Promise<DispatchAdmissionDecision>((resolve) => {
        timer = setTimeout(() => resolve({ action: 'reject', message: 'Plugin dispatch admission timed out' }), DISPATCH_ADMISSION_TIMEOUT_MS);
      })
    ]);
    assertCurrent?.();
    if (decision.action === 'wait' && threadId) {
      const recorded = recordDispatchAdmissionWait(ctx.db, {
        threadId,
        overrideable: decision.overrideable,
        reason: decision.reason
      });
      return { decision, generation: recorded.generation, pluginId: decision.pluginId };
    }
    if (threadId && (decision.action === 'proceed' || decision.action === 'reject')) {
      // A reject must drop any earlier recorded wait too, or a stale
      // overrideable generation from before the reject survives and can
      // still be Send-now'd through after the reject.
      clearDispatchAdmissionGeneration(ctx.db, threadId);
    }
    return { decision, generation, ...(decision.action === 'wait' ? { pluginId: decision.pluginId } : {}) };
  } catch {
    // Cancellation must propagate without recording/clearing a later send's admission.
    assertCurrent?.();
    // A failed admission cannot prove that all plugin vetoes were reviewed.
    if (threadId) clearDispatchAdmissionGeneration(ctx.db, threadId);
    return { decision: { action: 'reject', message: 'Plugin dispatch admission unavailable' }, generation };
  } finally {
    // Timeout wins over any late plugin response; it cannot record a wait.
    if (timer) clearTimeout(timer);
  }
}
