import { useEffect, type ReactNode } from 'react';
import { PanelRight } from 'lucide-react';
import type { AgentState, SessionStats, TerminalSession } from '@zana-ai/zcc-domain/product';
import { AgentDetailPanel } from './AgentDetailPanel.js';
import { AgentDiffPanel } from './AgentDiffPanel.js';
import { useSessionStats } from './AgentInsights.js';
import { ThreadSecondaryPanel } from './thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from './thread/secondary-panel/ThreadNewTabPage.js';
import { ThreadFilePreviewTab } from './thread/secondary-panel/ThreadFilePreviewTab.js';
import { BrowserTabDeck } from './thread/secondary-panel/BrowserTabDeck.js';
import { ThreadPluginTab } from './thread/secondary-panel/ThreadPluginTab.js';
import { ThreadExplorerTab } from './thread/secondary-panel/ThreadExplorerTab.js';
import { useSecondaryPanel } from './thread/secondary-panel/useThreadSecondaryPanel.js';
import { useInAppBrowserPanel } from './thread/secondary-panel/useInAppBrowserPanel.js';
import { appendThreadRecentItem, tabInputFromRecentItem } from './thread/secondary-panel/threadRecentItems.js';
import {
  activeClosableTab,
  activePinnedView
} from './thread/secondary-panel/threadSecondaryPanelState.js';
import { getDesktopBrowserApi } from '../lib/desktop-browser.js';
import { getBrowserUrlHost } from '../lib/browser-url.js';

/**
 * Legacy-agent inspector split: live PTY on the left, the same secondary-panel
 * chrome threads use on the right (Info / Diff / extra tabs). Hide/show,
 * resize, and maximize are the thread chrome — not AgentDetailPanel's rail.
 *
 * Sidecar "Start terminal" is omitted: TerminalSurface can portal the live grid
 * to only one anchor, and the agent modal/monitor anchors outrank the thread
 * panel terminal.
 */

export function agentWriteScope(stats: SessionStats | null): Set<string> | null {
  if (!stats) return null;
  return new Set(stats.files.filter((file) => file.op !== 'R').map((file) => file.path));
}

export function AgentSessionView({
  session,
  projectId,
  projectName,
  projectColor,
  projectRemote = false,
  state,
  terminalAnchorId,
  footer,
  showProject = false,
  showIdentity = false,
  cohort = null,
  background = false,
  heartbeat = null,
  stats: providedStats,
  maxFiles,
  maxQueue,
  stageChrome,
  stageOverlay,
  focusDiffKey = 0,
  modal = false
}: {
  session: TerminalSession;
  projectId: string;
  projectName: string;
  projectColor?: string;
  projectRemote?: boolean;
  state: AgentState;
  terminalAnchorId: string;
  footer?: ReactNode;
  showProject?: boolean;
  showIdentity?: boolean;
  cohort?: { teamName: string; role: string } | null;
  background?: boolean;
  heartbeat?: { checked: boolean; onToggle: () => void } | null;
  stats?: SessionStats | null;
  maxFiles?: number;
  maxQueue?: number;
  stageChrome?: ReactNode;
  stageOverlay?: ReactNode;
  focusDiffKey?: number;
  modal?: boolean;
}) {
  const panel = useSecondaryPanel(modal ? `${session.id}:modal` : session.id, { defaultOpen: !modal });
  useInAppBrowserPanel(modal ? `${session.id}:modal` : session.id, panel);
  const exited = session.status === 'exited';
  const loadedStats = useSessionStats(session.id, projectId, exited, providedStats === undefined);
  const stats = providedStats ?? loadedStats;
  const writeScope = agentWriteScope(stats);

  useEffect(() => {
    if (!focusDiffKey) return;
    panel.selectPin('diff');
    // selectPin is re-created each render; the nonce is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDiffKey]);

  const pin = activePinnedView(panel.state);
  const closable = activeClosableTab(panel.state);
  const panelOpen = panel.state.isOpen;
  const viewClass = [
    'thread-detail-view',
    'agent-session-view',
    modal ? 'thread-detail-view--modal' : '',
    panelOpen ? 'is-secondary-open' : '',
    panel.state.isMaximized ? 'is-secondary-maximized' : ''
  ].filter(Boolean).join(' ');

  let panelBody: ReactNode = null;
  if (pin === 'info') {
    panelBody = (
      <AgentDetailPanel
        variant="embedded"
        collapsible={false}
        showIdentity={showIdentity}
        session={session}
        projectId={projectId}
        projectName={projectName}
        projectColor={projectColor}
        state={state}
        showProject={showProject}
        cohort={cohort}
        background={background}
        heartbeat={heartbeat}
        maxFiles={maxFiles}
        maxQueue={maxQueue}
        stats={stats}
      />
    );
  } else if (pin === 'diff') {
    panelBody = (
      <AgentDiffPanel
        cwd={session.cwd}
        isRemote={projectRemote}
        exited={exited}
        scope={writeScope}
      />
    );
  } else if (closable?.kind === 'new-tab') {
    panelBody = (
      <ThreadNewTabPage
        projectId={projectId}
        cwd={session.cwd}
        threadId={session.id}
        allowSidecarTerminal={false}
        onOpenFile={(path, title) => {
          appendThreadRecentItem(session.id, { kind: 'file', source: 'workspace', path });
          panel.addTab({ kind: 'file-preview', title, path });
        }}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: '' })}
        onOpenExplorer={() => panel.addTab({ kind: 'explorer', title: 'Explorer' })}
        onOpenPlugin={(moduleId, title, options) => {
          appendThreadRecentItem(session.id, { kind: 'plugin', moduleId, actionId: options?.actionId, title });
          panel.addTab({
            kind: 'plugin',
            title,
            moduleId,
            actionId: options?.actionId,
            params: options?.params ?? null,
            layout: options?.layout
          });
        }}
        onOpenRecent={(item) => panel.addTab(tabInputFromRecentItem(item))}
      />
    );
  } else if ((closable?.kind === 'file-preview' || closable?.kind === 'storage-preview') && closable.path) {
    panelBody = (
      <ThreadFilePreviewTab
        threadId={session.id}
        path={closable.path}
        openerKey={closable.openerKey}
        projectId={projectId}
        storage={closable.kind === 'storage-preview'}
      />
    );
  } else if (closable?.kind === 'browser') {
    panelBody = null;
  } else if (closable?.kind === 'plugin' && closable.moduleId) {
    panelBody = (
      <ThreadPluginTab
        moduleId={closable.moduleId}
        projectId={projectId}
        actionId={closable.actionId}
        params={closable.params}
        layout={closable.layout}
      />
    );
  } else if (closable?.kind === 'explorer') {
    panelBody = <ThreadExplorerTab projectId={projectId} />;
  } else if (closable?.kind === 'terminal') {
    panelBody = (
      <p className="thread-detail-empty">
        A sidecar terminal cannot share this inspector with the live agent session.
      </p>
    );
  }

  return (
    <section
      className={viewClass}
      data-testid="agent-session-view"
      style={panelOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="thread-detail-split">
      <div className="thread-detail-main agent-session-main">
        <header className="thread-detail-header">
          <div className="thread-detail-heading">
            <h1>{session.title}</h1>
          </div>
          <div className="thread-detail-actions">
            {!panelOpen ? (
              <button
                type="button"
                className="icon-btn"
                title="Show right panel"
                aria-label="Show right panel"
                data-testid="thread-secondary-show"
                onClick={panel.open}
              >
                <PanelRight size={14} />
              </button>
            ) : null}
          </div>
        </header>
        {stageChrome}
        <div className="agent-session-terminal" id={terminalAnchorId} />
        {stageOverlay}
      </div>
      {panelOpen ? (
        <ThreadSecondaryPanel
          state={panel.state}
          showDiffPin
          footer={footer}
          onSelectInfo={() => panel.selectPin('info')}
          onSelectDiff={() => panel.selectPin('diff')}
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
            canShowNativeBrowserView={panelOpen && !modal}
            threadId={session.id}
            onUpdate={({ tabId, url, title }) => {
              const nextTitle = title && title.length > 0 ? title : getBrowserUrlHost(url) || 'Browser';
              panel.patchTab(tabId, { url, title: nextTitle });
              if (url) appendThreadRecentItem(session.id, { kind: 'browser', url, title: nextTitle });
            }}
            onStopAutomation={(targetId) => {
              void getDesktopBrowserApi()?.stopAutomation?.(targetId);
              const tab = panel.state.tabs.find((row) => row.automationTargetId === targetId);
              if (tab) panel.patchTab(tab.id, { automationTargetId: null });
            }}
          />
        </ThreadSecondaryPanel>
      ) : null}
      </div>
    </section>
  );
}
