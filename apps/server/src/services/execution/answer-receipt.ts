import type { ExecutionRecord } from './store.js';

/** The parts of `answerBlockerByCoordinator`'s result the receipt reads. */
interface AnswerResult {
  ok: boolean;
  pending?: boolean;
  notified?: boolean;
  resumeRequested?: boolean;
  delivery?: { id?: string };
  value?: unknown;
}

/**
 * Compact reply for `execution.work.answer`. The full record is too large for a
 * coordinator to read on a long run, so the receipt only confirms the delivery.
 * Returns undefined when the result is not a usable success, so the caller keeps
 * the existing reply (a failure is never turned into a receipt).
 */
export function answerReceipt(result: AnswerResult, blockerId: string) {
  const record = result.value as ExecutionRecord | undefined;
  if (!result.ok || !record || typeof record !== 'object' || !('id' in record)) return undefined;
  return {
    ok: true as const,
    executionId: record.id,
    blockerId,
    deliveryId: result.delivery?.id ?? null,
    pending: result.pending === true,
    notified: result.notified === true,
    resumeRequested: result.resumeRequested === true,
    state: record.state
  };
}
