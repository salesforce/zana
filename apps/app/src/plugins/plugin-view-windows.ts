import { useSyncExternalStore } from 'react';
import type { PluginViewTarget } from '@zana-ai/zcc-desktop-contract';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { product } from '../lib/product-client.js';

/**
 * Which plugin project tabs are open in their own window, mirrored from main.
 * A tab open in a view window is not mounted in other windows: they show a
 * placeholder instead, so one window owns the tab's live state.
 */
const EMPTY: PluginViewTarget[] = [];
let views: PluginViewTarget[] = EMPTY;
let version = 0;
let started = false;
const listeners = new Set<() => void>();

function publish(next: readonly PluginViewTarget[]): void {
  views = next.length ? next.map((view) => ({ ...view })) : EMPTY;
  version += 1;
  for (const listener of listeners) listener();
}

/** Mirrors main's open set for the renderer's lifetime. App init calls it once; later calls do nothing. */
export function startPluginViewMirror(): void {
  if (started || !hasDesktopBridge()) return;
  started = true;
  // One subscription for the renderer's lifetime; it ends with the page.
  product.windows.onPluginViewsChanged((next) => publish(next));
  const requested = version;
  void product.windows
    .listPluginViews()
    .then((next) => {
      // A push that landed while the list was in flight is newer.
      if (version === requested) publish(next);
    })
    .catch(() => {});
}

export function subscribePluginViews(listener: () => void): () => void {
  startPluginViewMirror();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listOpenPluginViews(): PluginViewTarget[] {
  return views;
}

export function usePluginViewWindows(): PluginViewTarget[] {
  return useSyncExternalStore(subscribePluginViews, listOpenPluginViews, listOpenPluginViews);
}

export function isPluginViewOpen(
  open: readonly PluginViewTarget[],
  target: PluginViewTarget
): boolean {
  return open.some(
    (view) =>
      view.pluginId === target.pluginId &&
      view.tabId === target.tabId &&
      view.projectId === target.projectId &&
      view.resourceId === target.resourceId
  );
}

/** Open the tab in its own window, or focus the window that already shows it. */
export function openPluginViewWindow(target: PluginViewTarget): Promise<boolean> {
  if (!hasDesktopBridge()) return Promise.resolve(false);
  return product.windows.openPluginView(target).catch(() => false);
}

/** Close the tab's window so the tab shows in the main window again. */
export function closePluginViewWindow(target: PluginViewTarget): Promise<boolean> {
  if (!hasDesktopBridge()) return Promise.resolve(false);
  return product.windows.closePluginView(target).catch(() => false);
}

/** Ask main to show an in-app path in the main window and bring it forward. */
export function showInMainWindow(path: string): Promise<boolean> {
  if (!hasDesktopBridge()) return Promise.resolve(false);
  return product.windows.showInMain(path).catch(() => false);
}

/** Test seam: forget mirrored state between tests. */
export function resetPluginViewWindowsForTest(): void {
  views = EMPTY;
  version = 0;
  started = false;
  listeners.clear();
}
