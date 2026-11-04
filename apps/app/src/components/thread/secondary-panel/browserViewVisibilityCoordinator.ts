import type { DesktopBrowserApi } from '@zana-ai/zcc-desktop-contract';

export interface BrowserViewVisibilityCoordinator {
  owns(tabId: string): boolean;
  show(tabId: string, syncBounds: () => void): void;
  hide(tabId: string, preserveSnapshot?: boolean): void;
  release(tabId: string): void;
}

interface BrowserViewRecord {
  tabId: string;
  threadId: string;
}

const browserViewRecords = new Map<string, BrowserViewRecord>();
// A thread can be mounted in both its regular pane and an inspector. Only the
// foreground host may hide or reposition their shared native tab.
let visibleOwners = new WeakMap<DesktopBrowserApi, Map<string, symbol>>();

export function createBrowserViewVisibilityCoordinator(
  desktopBrowser: DesktopBrowserApi
): BrowserViewVisibilityCoordinator {
  let visibleTabId: string | null = null;
  const owner = Symbol('browser-view-host');
  let owners = visibleOwners.get(desktopBrowser);
  if (!owners) {
    owners = new Map();
    visibleOwners.set(desktopBrowser, owners);
  }
  const ownedTabs = owners;
  const hide = (tabId: string, preserveSnapshot = false) => {
    if (visibleTabId === tabId) visibleTabId = null;
    const currentOwner = ownedTabs.get(tabId);
    if (currentOwner !== undefined && currentOwner !== owner) return;
    ownedTabs.delete(tabId);
    desktopBrowser.setVisible({ tabId, visible: false, ...(preserveSnapshot ? { preserveSnapshot: true } : {}) });
  };
  return {
    owns: (tabId) => ownedTabs.get(tabId) === owner,
    show(tabId, syncBounds) {
      if (visibleTabId !== null && visibleTabId !== tabId) {
        hide(visibleTabId);
      }
      visibleTabId = tabId;
      ownedTabs.set(tabId, owner);
      syncBounds();
      desktopBrowser.setVisible({ tabId, visible: true });
    },
    hide,
    release(tabId) {
      if (visibleTabId === tabId) {
        visibleTabId = null;
      }
      if (ownedTabs.get(tabId) === owner) ownedTabs.delete(tabId);
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
  visibleOwners.get(args.desktopBrowser)?.delete(args.tabId);
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
  visibleOwners = new WeakMap();
}
