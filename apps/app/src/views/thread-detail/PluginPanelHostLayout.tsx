import { type ReactNode, useRef } from 'react';
import { PanelRight } from 'lucide-react';
import { getDesktopBrowserApi } from '../../lib/desktop-browser.js';
import { getBrowserUrlHost } from '../../lib/browser-url.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { useSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import {
  activeClosableTab
} from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';

export function pluginPanelBrowserOwnerId(pluginId: string, panelPath: string): string {
  return `plugin-panel:${pluginId}:${panelPath}`;
}

export function PluginPanelHostLayout({
  pluginId,
  panelPath,
  children
}: {
  pluginId: string;
  panelPath: string;
  children: ReactNode;
}) {
  if (getDesktopBrowserApi() === null) return children;
  return (
    <PluginPanelBrowserHost pluginId={pluginId} panelPath={panelPath}>
      {children}
    </PluginPanelBrowserHost>
  );
}

function PluginPanelBrowserHost({
  pluginId,
  panelPath,
  children
}: {
  pluginId: string;
  panelPath: string;
  children: ReactNode;
}) {
  const ownerId = pluginPanelBrowserOwnerId(pluginId, panelPath);
  const viewRef = useRef<HTMLDivElement>(null);
  const panel = useSecondaryPanel(ownerId, {
    getContainerWidthPx: () => viewRef.current?.clientWidth ?? 0
  });
  const closable = activeClosableTab(panel.state);
  const panelOpen = panel.state.isOpen;

  let panelBody = null;
  if (closable?.kind === 'new-tab') {
    panelBody = (
      <ThreadNewTabPage
        projectId={null}
        cwd={null}
        threadId={ownerId}
        allowSidecarTerminal={false}
        onOpenFile={() => undefined}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: '' })}
        onOpenPlugin={() => undefined}
      />
    );
  }

  return (
    <div
      ref={viewRef}
      className={`plugin-panel-host-layout${panelOpen ? ' is-secondary-open' : ''}`}
      data-testid="plugin-panel-host-layout"
      style={panelOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="split-plugin-main">
        {children}
        {panelOpen ? null : (
          <button
            type="button"
            className="icon-btn plugin-panel-host-show"
            title="Show right panel"
            aria-label="Show right panel"
            data-testid="plugin-panel-secondary-show"
            onClick={panel.open}
          >
            <PanelRight size={14} />
          </button>
        )}
      </div>
      {panelOpen ? (
        <ThreadSecondaryPanel
          state={panel.state}
          showInfoPin={false}
          showDiffPin={false}
          showPlanPin={false}
          onSelectInfo={() => undefined}
          onSelectDiff={() => undefined}
          onNewTab={panel.openNewTab}
          onCloseTab={panel.closeTab}
          onActivateTab={panel.activateTab}
          onToggleMaximized={panel.toggleMaximized}
          onHide={panel.close}
          onResize={panel.setWidth}
        >
          {panelBody}
          <BrowserTabDeck
            browserTabs={panel.state.tabs.filter((tab) => tab.kind === 'browser')}
            activeBrowserTabId={closable?.kind === 'browser' ? closable.id : null}
            canShowNativeBrowserView={panelOpen}
            threadId={ownerId}
            onUpdate={({ tabId, url, title }) => {
              const nextTitle = title && title.length > 0 ? title : getBrowserUrlHost(url) || 'Browser';
              panel.patchTab(tabId, { url, title: nextTitle });
            }}
          />
        </ThreadSecondaryPanel>
      ) : null}
    </div>
  );
}
