import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { Bot, PanelRight } from 'lucide-react';
import { useCompactLayout } from '../../hooks/useCompactLayout.js';
import { getBrowserUrlHost } from '../../lib/browser-url.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { PanelAgentTab } from '../../components/thread/secondary-panel/PanelAgentTab.js';
import { ThreadPluginTab } from '../../components/thread/secondary-panel/ThreadPluginTab.js';
import { onPluginPanelAgentRequest } from '../../plugins/plugin-panel-agent.js';
import { onPluginPanelToolRequest, PLUGIN_PAGE_PANEL_OWNER_PREFIX, PluginPagePanelProvider } from '../../plugins/plugin-page-panel.js';
import { useSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import {
  activeClosableTab
} from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';

export function pluginPanelOwnerId(pluginId: string, panelPath: string): string {
  return `${PLUGIN_PAGE_PANEL_OWNER_PREFIX}${pluginId}:${panelPath}`;
}

export function PluginPanelHostLayout({
  pluginId,
  panelPath,
  subPath,
  scopeId,
  separateWindow = false,
  children
}: {
  pluginId: string;
  panelPath: string;
  /** The page's own route below the panel; recorded as the agent's starting view. */
  subPath?: string;
  /** Keeps a separate panel per scope (a project tab's project) for the same page. */
  scopeId?: string;
  /** Shown in its own window: keeps a panel apart from the main window's panel for the same page. */
  separateWindow?: boolean;
  children: ReactNode;
}) {
  return (
    <PluginPageSidePanelHost key={JSON.stringify([pluginId, panelPath, scopeId, separateWindow])} pluginId={pluginId} panelPath={panelPath} subPath={subPath} scopeId={scopeId} separateWindow={separateWindow}>
      {children}
    </PluginPageSidePanelHost>
  );
}

function PluginPageSidePanelHost({
  pluginId,
  panelPath,
  subPath,
  scopeId,
  separateWindow,
  children
}: {
  pluginId: string;
  panelPath: string;
  subPath?: string;
  scopeId?: string;
  separateWindow: boolean;
  children: ReactNode;
}) {
  // Windows share no live panel state, so each keeps its own saved one (the last writer would win otherwise).
  const ownerId = pluginPanelOwnerId(pluginId, `${scopeId ? `${panelPath}@${scopeId}` : panelPath}${separateWindow ? '#window' : ''}`);
  const viewRef = useRef<HTMLDivElement>(null);
  const compact = useCompactLayout();
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
  const { activateTab, addTab, openAgentDraft, openPluginTool, openNewTab } = panel;
  // This panel has no Info / Diff / Plan pins: when the shown tab closes, the last tab left takes over.
  const fallbackTabId = panelOpen && !closable ? panel.state.tabs.at(-1)?.id : undefined;
  useEffect(() => {
    if (fallbackTabId) activateTab(fallbackTabId);
    else if (panelOpen && !closable) openNewTab();
  }, [activateTab, closable, fallbackTabId, openNewTab, panelOpen]);
  // The page's own side-panel tools (`navigate.openPanelTool`, `'plugin-page'` scope).
  const page = useMemo(() => ({ pluginId, page: panelPath }), [pluginId, panelPath]);
  useEffect(
    () => onPluginPanelToolRequest(page, (target) => openPluginTool({ pluginId, ...target })),
    [openPluginTool, page, pluginId]
  );
  useEffect(
    () => onPluginPanelAgentRequest(pluginId, (target) => {
      if ('draft' in target) {
        openAgentDraft({ title: target.title ?? 'Agent', draft: target.draft, projectId: target.projectId, view: target.view });
      }
      else addTab({ kind: 'agent', title: target.title ?? 'Agent', threadId: target.threadId });
    }, page),
    [addTab, openAgentDraft, page, pluginId]
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
        projectId={scopeId}
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
  } else if (closable?.kind === 'plugin' && closable.moduleId === pluginId && closable.actionId) {
    // Only this page's plugin; a stored tab naming another plugin is not mounted here.
    panelBody = (
      <ThreadPluginTab
        key={closable.id}
        moduleId={pluginId}
        projectId={scopeId ?? null}
        actionId={closable.actionId}
        params={closable.params}
        layout={closable.layout}
        surface="plugin-page"
        page={page}
        tabId={closable.id}
      />
    );
  } else if (closable?.kind === 'new-tab') {
    panelBody = (
      <ThreadNewTabPage
        projectId={null}
        cwd={null}
        threadId={ownerId}
        allowSidecarTerminal={false}
        panelScope="plugin-page"
        page={page}
        onOpenFile={() => undefined}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: '' })}
        onOpenAgent={newAgent}
        onOpenPlugin={(moduleId, title, options) => {
          if (moduleId === pluginId && options?.actionId) {
            openPluginTool({ pluginId, actionId: options.actionId, title, params: options.params ?? null, layout: options.layout });
          }
        }}
      />
    );
  }

  return (
    <div
      ref={viewRef}
      className={`plugin-panel-host-layout${panelOpen ? ' is-secondary-open' : ''}${panelOpen && panel.state.isMaximized ? ' is-secondary-maximized' : ''}${compact ? ' is-compact' : ''}`}
      data-testid="plugin-panel-host-layout"
      style={panelOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="split-plugin-main">
        <PluginPagePanelProvider page={page} open={panelOpen}>{children}</PluginPagePanelProvider>
      </div>
      {panelOpen ? null : (
        <div className="plugin-panel-host-launchers" role="toolbar" aria-label="Side panel">
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
