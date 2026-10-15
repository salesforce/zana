import { type ReactNode, useEffect, useRef } from 'react';
import { Bot, PanelRight } from 'lucide-react';
import { getDesktopBrowserApi } from '../../lib/desktop-browser.js';
import { getBrowserUrlHost } from '../../lib/browser-url.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { PanelAgentTab } from '../../components/thread/secondary-panel/PanelAgentTab.js';
import { onPluginPanelAgentRequest } from '../../plugins/plugin-panel-agent.js';
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
  subPath,
  scopeId,
  launchers = true,
  children
}: {
  pluginId: string;
  panelPath: string;
  /** The page's own route below the panel; recorded as the agent's starting view. */
  subPath?: string;
  /** Keeps a separate panel per scope (a project tab's project) for the same page. */
  scopeId?: string;
  /**
   * The floating show-panel / ask-agent buttons. Without them the panel opens
   * only when the page asks (`navigate.openPanelAgent`), so a page with its own
   * right-hand chrome is left as it was.
   */
  launchers?: boolean;
  children: ReactNode;
}) {
  if (getDesktopBrowserApi() === null) return children;
  return (
    <PluginPanelBrowserHost pluginId={pluginId} panelPath={panelPath} subPath={subPath} scopeId={scopeId} launchers={launchers}>
      {children}
    </PluginPanelBrowserHost>
  );
}

function PluginPanelBrowserHost({
  pluginId,
  panelPath,
  subPath,
  scopeId,
  launchers,
  children
}: {
  pluginId: string;
  panelPath: string;
  subPath?: string;
  scopeId?: string;
  launchers: boolean;
  children: ReactNode;
}) {
  const ownerId = pluginPanelBrowserOwnerId(pluginId, scopeId ? `${panelPath}@${scopeId}` : panelPath);
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
  // The page asked to show a conversation (`navigate.openPanelAgent`); an open
  // tab for it is focused, not duplicated. A draft prefills the composer so the
  // user picks the harness before anything starts.
  const { addTab, openAgentDraft } = panel;
  useEffect(
    () => onPluginPanelAgentRequest(pluginId, (target) => {
      if ('draft' in target) {
        openAgentDraft({ title: target.title ?? 'Agent', draft: target.draft, projectId: target.projectId, view: target.view });
      }
      else addTab({ kind: 'agent', title: target.title ?? 'Agent', threadId: target.threadId });
    }),
    [addTab, openAgentDraft, pluginId]
  );

  let panelBody = null;
  if (closable?.kind === 'agent') {
    const tabId = closable.id;
    // The draft names what it is about; otherwise the page's own route does.
    const view = closable.draftView ?? subPath;
    panelBody = (
      <PanelAgentTab
        // A replaced draft remounts the composer so it seeds the new text.
        key={`${tabId}:${closable.draftRevision ?? 0}`}
        threadId={closable.threadId}
        draft={closable.draft}
        draftProjectId={closable.draftProjectId}
        pluginPanel={{ pluginId, panel: panelPath, ...(view ? { view } : {}) }}
        onCreated={(threadId) => panel.patchTab(tabId, { threadId, draft: undefined, draftProjectId: undefined, draftView: undefined })}
        onOpenConversation={({ id, title }) => {
          // Reopening a conversation already in a tab focuses it, not a duplicate.
          const open = panel.state.tabs.find((tab) => tab.kind === 'agent' && tab.threadId === id);
          if (open) panel.activateTab(open.id);
          else panel.patchTab(tabId, { threadId: id, ...(title ? { title } : {}) });
        }}
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
        {panelOpen || !launchers ? null : (
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
