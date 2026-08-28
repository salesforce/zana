export const THREAD_OPTIMISTIC_USER_EVENT = 'zcc-thread-optimistic-user';
export const THREAD_STOP_REQUESTED_EVENT = 'zcc-thread-stop-requested';

export function dispatchOptimisticUserMessage(threadId: string, text: string | null): void {
  if (typeof window === 'undefined' || !threadId) return;
  window.dispatchEvent(new CustomEvent(THREAD_OPTIMISTIC_USER_EVENT, {
    detail: { threadId, text }
  }));
}

export function dispatchThreadStopRequested(threadId: string): void {
  if (typeof window === 'undefined' || !threadId) return;
  window.dispatchEvent(new CustomEvent(THREAD_STOP_REQUESTED_EVENT, {
    detail: { threadId }
  }));
}
