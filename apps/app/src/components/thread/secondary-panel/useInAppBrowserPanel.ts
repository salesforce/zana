import { useEffect, useRef } from 'react';
import { getDesktopBrowserApi } from '../../../lib/desktop-browser.js';
import { getBrowserUrlHost } from '../../../lib/browser-url.js';
import { OPEN_IN_APP_BROWSER_EVENT } from '../../../lib/in-app-browser-link-preference.js';
import { appendThreadRecentItem } from './threadRecentItems.js';
import type { ClosableSecondaryTab } from './threadSecondaryPanelState.js';

interface PanelCommands {
  addTab: (tab: Omit<ClosableSecondaryTab, 'id'> & { id?: string }) => void;
}

export function useInAppBrowserPanel(ownerId: string, panel: PanelCommands): void {
  const addTabRef = useRef(panel.addTab);
  addTabRef.current = panel.addTab;

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
      openUrl(request.url);
    });
    const unsubOpen = unsubScoped ? null : api.onOpenTab((request) => {
      openUrl(request.url);
    });
    const unsubAuto = api.onAutomationOpen?.((request) => {
      if (request.threadId !== ownerId) return;
      openUrl(request.url, { id: request.tabId, automationTargetId: request.targetId });
    });
    return () => {
      unsubScoped?.();
      unsubOpen?.();
      unsubAuto?.();
    };
  }, [ownerId]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string; ownerId?: string }>).detail;
      if (!detail?.url) return;
      if (detail.ownerId && detail.ownerId !== ownerId) return;
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
}
