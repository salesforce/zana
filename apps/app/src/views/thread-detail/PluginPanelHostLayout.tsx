import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, PanelRight } from 'lucide-react';
import { useCompactLayout } from '../../hooks/useCompactLayout.js';
import { getBrowserUrlHost } from '../../lib/browser-url.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { PanelAgentTab } from '../../components/thread/secondary-panel/PanelAgentTab.js';
import { ThreadPluginTab } from '../../components/thread/secondary-panel/ThreadPluginTab.js';
import { onPluginPanelAgentRequest, type PanelAgentTarget } from '../../plugins/plugin-panel-agent.js';
import { onPluginPanelToolRequest, onPluginPanelScopeRequest, getPluginPanelScope, type PanelToolTarget, PLUGIN_PAGE_PANEL_OWNER_PREFIX, PluginPagePanelProvider, type PluginPanelScope } from '../../plugins/plugin-page-panel.js';
import { useSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import {
  activeClosableTab
} from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';

export function pluginPanelOwnerId(pluginId: string, panelPath: string): string {
  return `${PLUGIN_PAGE_PANEL_OWNER_PREFIX}${pluginId}:${panelPath}`;
}

type PanelRequest = { kind: 'tool'; target: PanelToolTarget } | { kind: 'agent'; target: PanelAgentTarget };
type PanelController = { ownerId: string; dispatch: (request: PanelRequest) => void };

function pageOwnerId(pluginId: string, panelPath: string, projectId: string | undefined, resourceId: string | undefined, separateWindow: boolean): string {
  return resourceId
    ? pluginPanelOwnerId(pluginId, JSON.stringify([panelPath, projectId ?? null, resourceId]))
    : pluginPanelOwnerId(pluginId, `${projectId ? `${panelPath}@${projectId}` : panelPath}${separateWindow ? '#window' : ''}`);
}

export function PluginPanelHostLayout({
  pluginId,
  panelPath,
  subPath,
  scopeId,
  resourceId,
  separateWindow = false,
  children
}: {
  pluginId: string;
  panelPath: string;
  /** The page's own route below the panel; recorded as the agent's starting view. */
  subPath?: string;
  /** Keeps a separate panel per scope (a project tab's project) for the same page. */
  scopeId?: string;
  /** Dedicated resource windows keep the same workspace when attached or detached. */
  resourceId?: string;
  /** Shown in its own window: keeps a panel apart from the main window's panel for the same page. */
  separateWindow?: boolean;
  children: ReactNode;
}) {
  return (
    <PluginPageSidePanelHost key={JSON.stringify([pluginId, panelPath, scopeId, separateWindow])} pluginId={pluginId} panelPath={panelPath} subPath={subPath} scopeId={scopeId} resourceId={resourceId} separateWindow={separateWindow}>
      {children}
    </PluginPageSidePanelHost>
  );
}

function PluginPageSidePanelHost({
  pluginId, panelPath, subPath, scopeId, resourceId, separateWindow, children
}: {
  pluginId: string;
  panelPath: string;
  subPath?: string;
  scopeId?: string;
  resourceId?: string;
  separateWindow: boolean;
  children: ReactNode;
}) {
  const page = useMemo(() => ({ pluginId, page: panelPath }), [pluginId, panelPath]);
  const [resource, setResource] = useState<PluginPanelScope | null>(null);
  const [presentation, setPresentation] = useState({ isOpen: false, isMaximized: false, widthPx: 352 });
  useEffect(() => onPluginPanelScopeRequest(page, setResource), [page]);
  const selectedResourceId = resourceId ?? resource?.id;
  const resourceView = resourceId
    ? resource?.id === resourceId ? resource.view ?? resourceId : resourceId
    : resource?.view ?? resource?.id;
  // A layout resource id can be longer than the server's optional recorded
  // route. Keep that layout identity without sending an invalid agent binding.
  const assistantView = resourceView && resourceView.length <= 500 ? resourceView : undefined;
  const ownerId = pageOwnerId(pluginId, panelPath, scopeId, selectedResourceId, separateWindow);
  const viewRef = useRef<HTMLDivElement>(null);
  const compact = useCompactLayout();
  const controller = useRef<PanelController | null>(null);
  const pending = useRef<Array<{ ownerId: string; request: PanelRequest }>>([]);
  const connect = useMemo(() => (next: PanelController) => {
    controller.current = next;
    const queued = pending.current.filter(row => row.ownerId === next.ownerId);
    pending.current = pending.current.filter(row => row.ownerId !== next.ownerId);
    for (const row of queued) next.dispatch(row.request);
    return () => { if (controller.current === next) controller.current = null; };
  }, []);
  useEffect(() => {
    const dispatch = (request: PanelRequest) => {
      // Selection events are synchronous; React's scope render may still be
      // pending. Never let that interval send B's command to A's panel.
      const currentResource = resourceId ?? getPluginPanelScope(page)?.id;
      const targetOwner = pageOwnerId(pluginId, panelPath, scopeId, currentResource, separateWindow);
      if (controller.current?.ownerId === targetOwner) controller.current.dispatch(request);
      else pending.current = [...pending.current.slice(-49), { ownerId: targetOwner, request }];
    };
    const offTool = onPluginPanelToolRequest(page, target => dispatch({ kind: 'tool', target }));
    const offAgent = onPluginPanelAgentRequest(pluginId, target => dispatch({ kind: 'agent', target }), page);
    return () => { offTool(); offAgent(); };
  }, [page, pluginId, panelPath, scopeId, resourceId, separateWindow]);
  return (
    <div
      ref={viewRef}
      className={`plugin-panel-host-layout${presentation.isOpen ? ' is-secondary-open' : ''}${presentation.isOpen && presentation.isMaximized ? ' is-secondary-maximized' : ''}${compact ? ' is-compact' : ''}`}
      data-testid="plugin-panel-host-layout"
      data-panel-resource={selectedResourceId ?? ''}
      style={presentation.isOpen ? { ['--thread-secondary-width' as string]: `${presentation.widthPx}px` } : undefined}
    >
      <div className="split-plugin-main">
        <PluginPagePanelProvider page={page} open={presentation.isOpen}>{children}</PluginPagePanelProvider>
      </div>
      {/* Only the side panel changes ownership. The plugin editor and its live
          runners above retain their React identity when another resource opens. */}
      <PluginResourceSidePanel
        key={ownerId}
        ownerId={ownerId}
        pluginId={pluginId}
        panelPath={panelPath}
        scopeId={scopeId}
        resourceLabel={selectedResourceId?.split(/[\\/]/).at(-1)}
        subPath={assistantView ?? (selectedResourceId ? undefined : subPath)}
        page={page}
        viewRef={viewRef}
        onPresentation={setPresentation}
        connect={connect}
      />
    </div>
  );
}

function PluginResourceSidePanel({
  ownerId, pluginId, panelPath, scopeId, resourceLabel, subPath, page, viewRef, onPresentation, connect
}: {
  ownerId: string;
  resourceLabel?: string;
  pluginId: string;
  panelPath: string;
  scopeId?: string;
  subPath?: string;
  page: { pluginId: string; page: string };
  viewRef: { current: HTMLDivElement | null };
  connect: (controller: PanelController) => () => void;
  onPresentation: (state: { isOpen: boolean; isMaximized: boolean; widthPx: number }) => void;
}) {
  const panel = useSecondaryPanel(ownerId, {
    getContainerWidthPx: () => viewRef.current?.clientWidth ?? 0
  });
  const { isOpen, isMaximized, widthPx } = panel.state;
  useLayoutEffect(() => {
    onPresentation({ isOpen, isMaximized, widthPx });
  }, [isOpen, isMaximized, widthPx, onPresentation]);
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
  useEffect(() => connect({
    ownerId,
    dispatch: request => {
      if (request.kind === 'tool') openPluginTool({ pluginId, ...request.target });
      else {
        const target = request.target;
        if ('draft' in target) openAgentDraft({ title: target.title ?? 'Agent', draft: target.draft, projectId: target.projectId, view: target.view });
        else addTab({ kind: 'agent', title: target.title ?? 'Agent', threadId: target.threadId });
      }
    }
  }), [connect, ownerId, openPluginTool, pluginId, openAgentDraft, addTab]);

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
        resourceLabel={resourceLabel}
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
    <>
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
          onCloseTabs={panel.closeTabs}
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
    </>
  );
}
