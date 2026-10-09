import { type ReactNode, useRef } from 'react';
import { Bot, PanelRight } from 'lucide-react';
import { getDesktopBrowserApi } from '../../lib/desktop-browser.js';
import { getBrowserUrlHost } from '../../lib/browser-url.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { PanelAgentTab } from '../../components/thread/secondary-panel/PanelAgentTab.js';
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
  const newAgent = () => panel.addTab({ kind: 'agent', title: 'Agent' });
  // Return to the latest conversation rather than stacking blank composers.
  const showAgent = () => {
    const latest = panel.state.tabs.filter((tab) => tab.kind === 'agent').at(-1);
    if (latest) panel.activateTab(latest.id);
    else newAgent();
  };

  let panelBody = null;
  if (closable?.kind === 'agent') {
    const tabId = closable.id;
    panelBody = (
      <PanelAgentTab
        key={tabId}
        threadId={closable.threadId}
        pluginPanel={{ pluginId, panel: panelPath }}
        onCreated={(threadId) => panel.patchTab(tabId, { threadId })}
      />
    );
  } else if (closable?.kind === 'new-tab') {
    panelBody = (
      <ThreadNewTabPage
        projectId={null}
        cwd={null}
        threadId={ownerId}
        allowSidecarTerminal={false}
        onOpenFile={() => undefined}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: '' })}
        onOpenAgent={newAgent}
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
          <div className="plugin-panel-host-launchers">
            <button
              type="button"
              className="icon-btn"
              title="Show right panel"
              aria-label="Show right panel"
              data-testid="plugin-panel-secondary-show"
              onClick={panel.open}
            >
              <PanelRight size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Ask an agent"
              aria-label="Ask an agent"
              data-testid="plugin-panel-agent-show"
              onClick={showAgent}
            >
              <Bot size={14} />
            </button>
          </div>
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
