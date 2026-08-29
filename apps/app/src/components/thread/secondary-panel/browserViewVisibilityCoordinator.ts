import type { DesktopBrowserApi } from '@zana-ai/zcc-desktop-contract';

export interface BrowserViewVisibilityCoordinator {
  show(tabId: string, syncBounds: () => void): void;
  hide(tabId: string): void;
  release(tabId: string): void;
}

interface BrowserViewRecord {
  tabId: string;
  threadId: string;
}

const browserViewRecords = new Map<string, BrowserViewRecord>();

export function createBrowserViewVisibilityCoordinator(
  desktopBrowser: DesktopBrowserApi
): BrowserViewVisibilityCoordinator {
  let visibleTabId: string | null = null;
  return {
    show(tabId, syncBounds) {
      if (visibleTabId !== null && visibleTabId !== tabId) {
        desktopBrowser.setVisible({ tabId: visibleTabId, visible: false });
      }
      visibleTabId = tabId;
      syncBounds();
      desktopBrowser.setVisible({ tabId, visible: true });
    },
    hide(tabId) {
      if (visibleTabId === tabId) {
        visibleTabId = null;
      }
      desktopBrowser.setVisible({ tabId, visible: false });
    },
    release(tabId) {
      if (visibleTabId === tabId) {
        visibleTabId = null;
      }
    }
  };
}

export function registerBrowserView(args: { tabId: string; threadId: string }): void {
  browserViewRecords.set(args.tabId, args);
}

export function destroyPersistedBrowserView(args: {
  desktopBrowser: DesktopBrowserApi;
  tabId: string;
}): void {
  args.desktopBrowser.setVisible({ tabId: args.tabId, visible: false });
  args.desktopBrowser.detach(args.tabId);
  browserViewRecords.delete(args.tabId);
}

export function destroyPersistedBrowserViewsForThread(args: {
  desktopBrowser: DesktopBrowserApi | null;
  threadId: string;
}): void {
  if (args.desktopBrowser === null) return;
  for (const record of [...browserViewRecords.values()]) {
    if (record.threadId === args.threadId) {
      destroyPersistedBrowserView({ desktopBrowser: args.desktopBrowser, tabId: record.tabId });
    }
  }
}

export function resetBrowserViewPersistence(): void {
  browserViewRecords.clear();
}
