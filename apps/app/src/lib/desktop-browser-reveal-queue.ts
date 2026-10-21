import type { DesktopBrowserRevealRequest } from "@zana-ai/zcc-desktop-contract";
import { getDesktopBrowserApi } from "./desktop-browser";

/** Threads with an unconsumed reveal; the oldest is dropped beyond this. */
const MAX_PENDING_THREADS = 32;

// Latest reveal per thread, in arrival order. A reveal for a thread that is not
// focused waits here until that thread's view takes it, so it is shown the next
// time the user opens the thread instead of being lost.
const pending = new Map<string, DesktopBrowserRevealRequest>();
const listeners = new Set<() => void>();
let started = false;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function startDesktopBrowserRevealQueue(): void {
  if (started) return;
  const api = getDesktopBrowserApi();
  if (!api?.onReveal) return;
  started = true;
  // One subscription each for the renderer's lifetime; they end with the page.
  api.onReveal((request) => {
    pending.delete(request.threadId);
    pending.set(request.threadId, request);
    if (pending.size > MAX_PENDING_THREADS) {
      const oldest = pending.keys().next().value;
      if (oldest !== undefined) pending.delete(oldest);
    }
    notify();
  });
  api.onClosed?.((tab) => {
    for (const [threadId, request] of pending)
      if (request.tabId === tab.tabId) pending.delete(threadId);
  });
}

export function subscribeDesktopBrowserReveals(listener: () => void): () => void {
  startDesktopBrowserRevealQueue();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Removes and returns the thread's pending reveal, if any. */
export function takeDesktopBrowserReveal(
  threadId: string,
): DesktopBrowserRevealRequest | null {
  const request = pending.get(threadId) ?? null;
  pending.delete(threadId);
  return request;
}

/** Puts back a reveal its view could not finish, unless a newer one arrived. */
export function returnDesktopBrowserReveal(
  request: DesktopBrowserRevealRequest,
): void {
  if (!pending.has(request.threadId)) pending.set(request.threadId, request);
}

export function resetDesktopBrowserRevealQueueForTest(): void {
  pending.clear();
  listeners.clear();
  started = false;
}
