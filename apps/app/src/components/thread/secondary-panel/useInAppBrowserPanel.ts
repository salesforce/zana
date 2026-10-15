import { useEffect, useRef } from 'react';
import { getDesktopBrowserApi } from '../../../lib/desktop-browser.js';
import { getBrowserUrlHost } from '../../../lib/browser-url.js';
import {
  inAppBrowserEventMatchesOwner,
  OPEN_IN_APP_BROWSER_EVENT
} from '../../../lib/in-app-browser-link-preference.js';
import { subscribeProductEvent } from '../../../lib/product-ws.js';
import { appendThreadRecentItem } from './threadRecentItems.js';
import type { ClosableSecondaryTab } from './threadSecondaryPanelState.js';

interface PanelCommands {
  state: { tabs: readonly ClosableSecondaryTab[] };
  addTab: (tab: Omit<ClosableSecondaryTab, 'id'> & { id?: string }) => void;
  closeTab: (tabId: string) => void;
}

export function useInAppBrowserPanel(ownerId: string, panel: PanelCommands): void {
  const addTabRef = useRef(panel.addTab);
  addTabRef.current = panel.addTab;
  const tabsRef = useRef(panel.state.tabs);
  tabsRef.current = panel.state.tabs;
  const closeTabRef = useRef(panel.closeTab);
  closeTabRef.current = panel.closeTab;

  useEffect(() => {
    const api = getDesktopBrowserApi();
    if (!api) return;
    const openUrl = (url: string, extras?: { id?: string; automationTargetId?: string }) => {
      const title = getBrowserUrlHost(url) || 'Browser';
      addTabRef.current({
        id: extras?.id,
        kind: 'browser',
        title,
        url,
        automationTargetId: extras?.automationTargetId
      });
      if (url) {
        appendThreadRecentItem(ownerId, { kind: 'browser', url, title });
      }
    };
    const unsubScoped = api.onScopedOpenTab?.((request) => {
      // Native popup events reach every pane; their source tab identifies the
      // owning panel. An unrelated thread must not open a copy of the page.
      if (!tabsRef.current.some((tab) => tab.kind === 'browser' && tab.id === request.tabId)) return;
      // Adopt the actual popup without reloading its initial URL: it may already
      // have navigated from about:blank while this event crossed IPC.
      if (request.openedTabId) openUrl('', { id: request.openedTabId });
      else openUrl(request.url);
    });
    const unsubOpen = unsubScoped ? null : api.onOpenTab((request) => {
      openUrl(request.url);
    });
    const unsubAuto = api.onAutomationOpen?.((request) => {
      if (request.threadId !== ownerId) return;
      openUrl(request.url, { id: request.tabId, automationTargetId: request.targetId });
    });
    const removeClosed = ({ tabId }: { tabId: string }) => {
      if (tabsRef.current.some((tab) => tab.kind === 'browser' && tab.id === tabId)) {
        closeTabRef.current(tabId);
      }
    };
    const unsubClosed = api.onClosed?.(removeClosed);
    let disposed = false;
    void api.getClosedTabs?.().then((tabs) => {
      if (!disposed) for (const tab of tabs) removeClosed(tab);
    }).catch(() => { /* A disconnected desktop can reconcile on the next mount. */ });
    return () => {
      disposed = true;
      unsubScoped?.();
      unsubOpen?.();
      unsubAuto?.();
      unsubClosed?.();
    };
  }, [ownerId]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string; ownerId?: string }>).detail;
      if (!detail?.url) return;
      if (!inAppBrowserEventMatchesOwner(detail.ownerId, ownerId)) return;
      event.preventDefault();
      addTabRef.current({
        kind: 'browser',
        title: getBrowserUrlHost(detail.url) || 'Browser',
        url: detail.url
      });
      appendThreadRecentItem(ownerId, {
        kind: 'browser',
        url: detail.url,
        title: getBrowserUrlHost(detail.url) || null
      });
    };
    window.addEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpen);
  }, [ownerId]);

  useEffect(() => {
    return subscribeProductEvent<{ threadId?: string; url?: string }>('threads:browser', (payload) => {
      if (!payload?.url) return;
      if (payload.threadId && payload.threadId !== ownerId) return;
      addTabRef.current({
        kind: 'browser',
        title: getBrowserUrlHost(payload.url) || 'Browser',
        url: payload.url
      });
      appendThreadRecentItem(ownerId, {
        kind: 'browser',
        url: payload.url,
        title: getBrowserUrlHost(payload.url) || null
      });
    });
  }, [ownerId]);
}
