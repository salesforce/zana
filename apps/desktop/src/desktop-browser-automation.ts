import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { isAllowedBrowserUrl } from './desktop-browser-policy.js';
import type { DesktopBrowserViewManager } from './desktop-browser-view.js';

export interface BrowserAutomationCommandHost {
  open(args: { threadId: string; url: string; visible: boolean }): Promise<{ targetId: string; tabId: string }>;
  list(threadId?: string): Promise<Array<{ targetId: string; tabId: string; url: string; title: string | null }>>;
  snapshot(targetId: string): Promise<{
    targetId: string;
    tabId: string;
    url: string;
    title: string | null;
    dataUrl: string | null;
  }>;
  click(targetId: string, args: { selector?: string; x?: number; y?: number }): Promise<void>;
  type(targetId: string, args: { selector?: string; text: string }): Promise<void>;
  evaluate(targetId: string, script: string): Promise<unknown>;
  close(targetId: string): Promise<void>;
}

const pendingOpens = new Map<string, { threadId: string; tabId: string; targetId: string }>();

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
      pendingOpens.set(targetId, { threadId, tabId, targetId });
      const payload = { threadId, tabId, targetId, url };
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
    async list() {
      return manager.listAutomationTargets();
    },
    async snapshot(targetId) {
      return manager.snapshotAutomationTarget(targetId);
    },
    async click(targetId, args) {
      await manager.clickAutomationTarget(targetId, args);
    },
    async type(targetId, args) {
      await manager.typeAutomationTarget(targetId, args);
    },
    async evaluate(targetId, script) {
      return manager.evaluateAutomationTarget(targetId, script);
    },
    async close(targetId) {
      manager.closeAutomationTarget(targetId);
      pendingOpens.delete(targetId);
    }
  };
}

export function peekPendingBrowserOpen(targetId: string): {
  threadId: string;
  tabId: string;
  targetId: string;
} | null {
  return pendingOpens.get(targetId) ?? null;
}
