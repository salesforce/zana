import type { DispatchAdmissionMainDecision, DispatchAdmissionMainRequest } from '@zana-ai/zcc-contracts/runtime';
import type { ProductHttpContext } from '../http/product-context.js';
import { admissionRefusal, admitDispatch } from '../services/threads/dispatch-service.js';

/**
 * Admit one PTY dispatch Electron-main is about to forward. Main asserted the
 * identity; this only asks the plugins. A PTY cannot hold input for later, so a
 * wait is returned as such for main to refuse, and any failure is a reject. A
 * missing context (service not created yet, or stopped) is a reject, so a
 * dispatch never slips through while the plugin service is down.
 */
export async function admitMainOwnedDispatch(
  ctx: ProductHttpContext | undefined,
  request: DispatchAdmissionMainRequest
): Promise<DispatchAdmissionMainDecision> {
  if (!ctx) return { action: 'reject', message: 'Plugin dispatch admission unavailable' };
  try {
    const outcome = await admitDispatch(ctx, {
      projectId: request.projectId,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      surface: 'pty',
      entry: request.entry,
      origin: request.origin,
      ...(request.prompt ? { prompt: { text: request.prompt.text, truncated: request.prompt.truncated } } : {})
    });
    const refusal = admissionRefusal(outcome);
    if (!refusal) return { action: 'proceed' };
    return refusal.code === 'dispatch_rejected'
      ? { action: 'reject', message: refusal.message.slice(0, 1024) || 'Dispatch rejected' }
      : { action: 'wait', reason: refusal.message.slice(0, 1024) || 'Dispatch is waiting' };
  } catch {
    return { action: 'reject', message: 'Plugin dispatch admission unavailable' };
  }
}
