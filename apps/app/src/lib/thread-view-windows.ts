import { useSyncExternalStore } from 'react';
import type { ThreadViewTarget } from '@zana-ai/zcc-desktop-contract';
import { hasDesktopBridge } from './app-surface.js';
import { product } from './product-client.js';

/**
 * Which threads are open in their own window, mirrored from main. A thread
 * open in a thread view window is not mounted in other windows: they show a
 * placeholder instead, so one window owns its timeline and side panel.
 */
const EMPTY: ThreadViewTarget[] = [];
let views: ThreadViewTarget[] = EMPTY;
let version = 0;
let started = false;
const listeners = new Set<() => void>();

function publish(next: readonly ThreadViewTarget[]): void {
  views = next.length ? next.map((view) => ({ ...view })) : EMPTY;
  version += 1;
  for (const listener of listeners) listener();
}

/** Mirrors main's open set for the renderer's lifetime. App init calls it once; later calls do nothing. */
export function startThreadViewMirror(): void {
  if (started || !hasDesktopBridge()) return;
  started = true;
  // One subscription for the renderer's lifetime; it ends with the page.
  product.windows.onThreadViewsChanged((next) => publish(next));
  const requested = version;
  void product.windows
    .listThreadViews()
    .then((next) => {
      // A push that landed while the list was in flight is newer.
      if (version === requested) publish(next);
    })
    .catch(() => {});
}

export function subscribeThreadViews(listener: () => void): () => void {
  startThreadViewMirror();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listOpenThreadViews(): ThreadViewTarget[] {
  return views;
}

export function useThreadViewWindows(): ThreadViewTarget[] {
  return useSyncExternalStore(subscribeThreadViews, listOpenThreadViews, listOpenThreadViews);
}

/** One window per thread, whatever project opened it. */
export function isThreadViewOpen(open: readonly ThreadViewTarget[], threadId: string): boolean {
  return open.some((view) => view.threadId === threadId);
}

/** Open the thread in its own window, or focus the window that already shows it. */
export function openThreadViewWindow(target: ThreadViewTarget): Promise<boolean> {
  if (!hasDesktopBridge()) return Promise.resolve(false);
  return product.windows.openThreadView(target).catch(() => false);
}

/** Close the thread's window so the thread shows in the main window again. */
export function closeThreadViewWindow(target: ThreadViewTarget): Promise<boolean> {
  if (!hasDesktopBridge()) return Promise.resolve(false);
  return product.windows.closeThreadView(target).catch(() => false);
}

/** Test seam: forget mirrored state between tests. */
export function resetThreadViewWindowsForTest(): void {
  views = EMPTY;
  version = 0;
  started = false;
  listeners.clear();
}
