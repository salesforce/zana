import { apiJson } from './fetch-with-app-surface.js';

export const CONVERSATION_READ_TIMEOUT_MS = 15_000;
/** A timed-out read is retried this many times before the view shows the error. */
export const CONVERSATION_READ_RETRIES = 1;
export const CONVERSATION_READ_TIMEOUT_MESSAGE = 'The server is taking too long to load this conversation. Please retry.';

/** Bound both headers and body reads, so a stalled request cannot lock out Retry. */
async function readOnce<T>(path: string, signal: AbortSignal | undefined, timeoutError: Error): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(timeoutError);
  }, CONVERSATION_READ_TIMEOUT_MS);
  try {
    return await apiJson<T>(path, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** GET reads are idempotent: a transient server stall gets one fresh attempt before the user sees an error. */
export async function readConversationJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const timeoutError = new Error(CONVERSATION_READ_TIMEOUT_MESSAGE);
    try {
      return await readOnce<T>(path, signal, timeoutError);
    } catch (error) {
      if (error !== timeoutError || attempt >= CONVERSATION_READ_RETRIES) throw error;
    }
  }
}
