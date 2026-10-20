// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import type { PluginViewHost } from '../window/plugin-view-host.js';
import type { ThreadViewHost } from '../window/thread-view-host.js';

export function registerWindowsIpc(): void {
  
  ctx.safeHandle(
    IPC.windows.openProject,
    (projectId: string) => {
      // Trust gate (CLAUDE.md #1): ctx.openProjectWindow re-validates the
      // renderer-supplied id against the store before opening a window.
      ctx.openProjectWindow(projectId);
      return true;
    },
    () => false
  );
}

/**
 * Plugin view windows. Trust gate (CLAUDE.md #1): main parses every
 * renderer-supplied target and path itself (window/plugin-view-host.ts) before
 * it opens, closes or navigates a window.
 */
export function registerPluginViewIpc(
  safeHandle: (channel: string, handler: (...args: any[]) => unknown, fallback: () => unknown) => void,
  views: Pick<PluginViewHost, 'open' | 'close' | 'list' | 'showPath'>
): void {
  safeHandle(IPC.windows.openPluginView, (target: unknown) => views.open(target), () => false);
  safeHandle(IPC.windows.closePluginView, (target: unknown) => views.close(target), () => false);
  safeHandle(IPC.windows.listPluginViews, () => views.list(), () => []);
  safeHandle(IPC.windows.showInMain, (path: unknown) => views.showPath(path), () => false);
}

/**
 * Thread view windows. Trust gate (CLAUDE.md #1): main parses every
 * renderer-supplied target itself (window/thread-view-host.ts) before it opens
 * or closes a window.
 */
export function registerThreadViewIpc(
  safeHandle: (channel: string, handler: (...args: any[]) => unknown, fallback: () => unknown) => void,
  views: Pick<ThreadViewHost, 'open' | 'close' | 'list'>
): void {
  safeHandle(IPC.windows.openThreadView, (target: unknown) => views.open(target), () => false);
  safeHandle(IPC.windows.closeThreadView, (target: unknown) => views.close(target), () => false);
  safeHandle(IPC.windows.listThreadViews, () => views.list(), () => []);
}
