import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { product } from './product-client.js';
import { useInboxAnswered, useUi } from '../store.js';

/**
 * Shared "respond to an execution blocker" flow — used by both the free-text
 * `ReplyBox` in InboxDetail.tsx and the structured `QuestionBlock` in
 * InboxQuestionBlock.tsx whenever an inbox entry is bound to a live execution
 * blocker (`entry.executionId` + `entry.blockerId` both set).
 *
 * Two bugs this fixes relative to the two near-duplicate call sites it
 * replaces:
 *  - `clientRequestId` is now DETERMINISTIC (`${executionId}:${blockerId}`,
 *    no `Date.now()` suffix) so a resubmit of the same blocker answer dedupes
 *    idempotently in main instead of minting a fresh id every attempt.
 *  - The `product.executionBoard.respond(...)` call is wrapped in try/catch:
 *    a thrown IPC rejection is caught, logged with the execution+blocker ids
 *    for diagnosis, and surfaced as an error toast instead of escaping the
 *    caller's submit handler (which previously left `sending` stuck `true`).
 *
 * Returns `true` iff the response was sent and the entry marked answered.
 * Callers still own their own local busy/sending flag — reset it themselves
 * (ideally in a `finally`) after calling this.
 */
export async function respondToInboxBlocker(entry: InboxEntry, reply: string): Promise<boolean> {
  const { executionId, blockerId } = entry;
  if (!executionId || !blockerId) return false;
  // Deterministic on purpose: a retry of the SAME blocker answer should reuse
  // the SAME clientRequestId so main's dedupe treats it as one idempotent
  // request, not a new one each attempt.
  const clientRequestId = `${executionId}:${blockerId}`;
  try {
    const result = await product.executionBoard.respond(
      entry.projectId,
      executionId,
      -1, // use latest stateVersion in main
      blockerId,
      clientRequestId,
      reply,
      true // explicit opt-in required for main to honor the -1 sentinel (see cc-api.ts)
    );
    if (result.ok) {
      useInboxAnswered.getState().markAnswered(entry.id);
      useUi.getState().pushToast('Response sent', 'info');
      return true;
    }
    useUi.getState().pushToast(result.message || 'Failed to send response', 'error');
    return false;
  } catch (err) {
    console.error('[inbox] executionBoard.respond failed', { executionId, blockerId, err });
    useUi.getState().pushToast(err instanceof Error ? err.message : 'Failed to send response', 'error');
    return false;
  }
}
