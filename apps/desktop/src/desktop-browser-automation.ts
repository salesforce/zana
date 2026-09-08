import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { isAllowedBrowserUrl } from './desktop-browser-policy.js';
import {
  assertAutomationTargetThread,
  filterAutomationTargetsForThread,
  forgetPendingAutomationTab,
  HIDDEN_AUTOMATION_VIEW_BOUNDS,
  pickLiveBrowserWindow,
  rememberPendingAutomationTab,
  shouldBroadcastAutomationOpen
} from './desktop-browser-thread-scope.js';
import type { DesktopBrowserViewManager } from './desktop-browser-view.js';

export interface BrowserAutomationCommandHost {
  open(args: { threadId: string; url: string; visible: boolean }): Promise<{ targetId: string; tabId: string }>;
  list(threadId?: string): Promise<Array<{ targetId: string; tabId: string; url: string; title: string | null }>>;
  snapshot(targetId: string, threadId?: string): Promise<{
    targetId: string;
    tabId: string;
    url: string;
    title: string | null;
    dataUrl: string | null;
  }>;
  click(targetId: string, args: { selector?: string; x?: number; y?: number }, threadId?: string): Promise<void>;
  type(targetId: string, args: { selector?: string; text: string }, threadId?: string): Promise<void>;
  evaluate(targetId: string, script: string, threadId?: string): Promise<unknown>;
  close(targetId: string, threadId?: string): Promise<void>;
}

const pendingOpens = new Map<string, { threadId: string; tabId: string; targetId: string }>();
const threadByTarget = new Map<string, string>();

function rememberTarget(targetId: string, threadId: string, tabId: string): void {
  const previous = pendingOpens.get(targetId);
  if (previous?.tabId && previous.tabId !== tabId) {
    forgetPendingAutomationTab(previous.tabId);
  }
  pendingOpens.set(targetId, { threadId, tabId, targetId });
  threadByTarget.set(targetId, threadId);
  rememberPendingAutomationTab(tabId);
}

function forgetTarget(targetId: string): void {
  const previous = pendingOpens.get(targetId);
  if (previous?.tabId) forgetPendingAutomationTab(previous.tabId);
  pendingOpens.delete(targetId);
  threadByTarget.delete(targetId);
}

export function bindAutomationTargetThread(targetId: string, threadId: string, tabId = ''): void {
  rememberTarget(targetId, threadId, tabId);
}

export function unbindAutomationTargetThread(targetId: string): void {
  forgetTarget(targetId);
}

export function createDesktopBrowserAutomationHost(
  manager: DesktopBrowserViewManager
): BrowserAutomationCommandHost {
  return {
    async open({ threadId, url, visible }) {
      if (url.length > 0 && !isAllowedBrowserUrl(url)) {
        throw new Error('URL is not allowed');
      }
      const targetId = `browser-auto:${randomUUID()}`;
      const tabId = `browser:${randomUUID()}`;
      rememberTarget(targetId, threadId, tabId);
      const payload = { threadId, tabId, targetId, url };
      if (!shouldBroadcastAutomationOpen(visible)) {
        const hostWindow = pickLiveBrowserWindow(BrowserWindow.getAllWindows());
        if (hostWindow === null) {
          forgetTarget(targetId);
          throw new Error('No connected app window can host a hidden browser tab. Is the desktop app open?');
        }
        try {
          manager.attach({
            hostWindow,
            request: {
              tabId,
              url,
              bounds: { ...HIDDEN_AUTOMATION_VIEW_BOUNDS },
              visible: false
            }
          });
          const ok = manager.registerAutomationTarget({
            tabId,
            targetId,
            hostWebContentsId: hostWindow.webContents.id
          });
          if (!ok) {
            manager.detach({ hostWindow, tabId });
            throw new Error('Failed to attach a hidden browser tab');
          }
          return { targetId, tabId };
        } catch (err) {
          forgetTarget(targetId);
          throw err;
        }
      }
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(IPC.browser.automationOpen, payload);
        }
      }
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const listed = manager.listAutomationTargets().find((row) => row.targetId === targetId);
        if (listed) return { targetId, tabId };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { targetId, tabId };
    },
    async list(threadId) {
      return filterAutomationTargetsForThread(manager.listAutomationTargets(), threadByTarget, threadId);
    },
    async snapshot(targetId, threadId) {
      assertAutomationTargetThread(targetId, threadByTarget, threadId);
      return manager.snapshotAutomationTarget(targetId);
    },
    async click(targetId, args, threadId) {
      assertAutomationTargetThread(targetId, threadByTarget, threadId);
      await manager.clickAutomationTarget(targetId, args);
    },
    async type(targetId, args, threadId) {
      assertAutomationTargetThread(targetId, threadByTarget, threadId);
      await manager.typeAutomationTarget(targetId, args);
    },
    async evaluate(targetId, script, threadId) {
      assertAutomationTargetThread(targetId, threadByTarget, threadId);
      return manager.evaluateAutomationTarget(targetId, script);
    },
    async close(targetId, threadId) {
      assertAutomationTargetThread(targetId, threadByTarget, threadId);
      manager.closeAutomationTarget(targetId);
      forgetTarget(targetId);
    }
  };
}

export { isPendingAutomationTab } from './desktop-browser-thread-scope.js';

export function peekPendingBrowserOpen(targetId: string): {
  threadId: string;
  tabId: string;
  targetId: string;
} | null {
  return pendingOpens.get(targetId) ?? null;
}
