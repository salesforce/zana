import { useEffect, useMemo, useRef } from 'react';
import { getDesktopBrowserApi } from '../../../lib/desktop-browser.js';
import { BrowserTabContent } from './BrowserTabContent.js';
import {
  createBrowserViewVisibilityCoordinator,
  destroyPersistedBrowserView
} from './browserViewVisibilityCoordinator.js';
import type { ClosableSecondaryTab } from './threadSecondaryPanelState.js';

export interface BrowserTabDeckProps {
  browserTabs: readonly ClosableSecondaryTab[];
  activeBrowserTabId: string | null;
  canShowNativeBrowserView: boolean;
  threadId: string;
  onUpdate: (args: { tabId: string; url: string; title: string | null }) => void;
  onStopAutomation?: (targetId: string) => void;
}

export function buildBrowserTabIdSet(browserTabs: readonly ClosableSecondaryTab[]): ReadonlySet<string> {
  return new Set(browserTabs.map((tab) => tab.id));
}

export function selectActiveBrowserTab(
  browserTabs: readonly ClosableSecondaryTab[],
  activeBrowserTabId: string | null
): ClosableSecondaryTab | null {
  if (activeBrowserTabId === null) return null;
  return browserTabs.find((tab) => tab.id === activeBrowserTabId) ?? null;
}

export function BrowserTabDeck({
  browserTabs,
  activeBrowserTabId,
  canShowNativeBrowserView,
  threadId,
  onUpdate,
  onStopAutomation
}: BrowserTabDeckProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const previousTabIdsRef = useRef<{ tabIds: ReadonlySet<string>; threadId: string } | null>(null);
  const visibilityCoordinator = useMemo(
    () => desktopBrowser === null ? null : createBrowserViewVisibilityCoordinator(desktopBrowser),
    [desktopBrowser]
  );

  useEffect(() => {
    const tabIds = buildBrowserTabIdSet(browserTabs);
    const previous = previousTabIdsRef.current;
    if (desktopBrowser !== null && previous !== null && previous.threadId === threadId) {
      for (const tabId of previous.tabIds) {
        if (!tabIds.has(tabId)) {
          destroyPersistedBrowserView({ desktopBrowser, tabId });
        }
      }
    }
    previousTabIdsRef.current = { tabIds, threadId };
  }, [browserTabs, desktopBrowser, threadId]);

  const activeBrowserTab = selectActiveBrowserTab(browserTabs, activeBrowserTabId);
  if (activeBrowserTab === null) return null;

  return (
    <BrowserTabContent
      key={activeBrowserTab.id}
      tabId={activeBrowserTab.id}
      initialUrl={activeBrowserTab.url ?? ''}
      canShowNativeBrowserView={canShowNativeBrowserView}
      visibilityCoordinator={visibilityCoordinator}
      threadId={threadId}
      automationTargetId={activeBrowserTab.automationTargetId}
      onUpdate={onUpdate}
      onStopAutomation={onStopAutomation}
    />
  );
}
