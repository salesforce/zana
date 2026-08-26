import { useEffect, type ReactNode } from 'react';
import { PanelRight } from 'lucide-react';
import type { AgentState, SessionStats, TerminalSession } from '@zana-ai/zcc-domain/product';
import { AgentDetailPanel } from './AgentDetailPanel.js';
import { AgentDiffPanel } from './AgentDiffPanel.js';
import { useSessionStats } from './AgentInsights.js';
import { ThreadSecondaryPanel } from './thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from './thread/secondary-panel/ThreadNewTabPage.js';
import { ThreadFilePreviewTab } from './thread/secondary-panel/ThreadFilePreviewTab.js';
import { ThreadBrowserTab } from './thread/secondary-panel/ThreadBrowserTab.js';
import { ThreadPluginTab } from './thread/secondary-panel/ThreadPluginTab.js';
import { useSecondaryPanel } from './thread/secondary-panel/useThreadSecondaryPanel.js';
import {
  activeClosableTab,
  activePinnedView
} from './thread/secondary-panel/threadSecondaryPanelState.js';

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
  const panel = useSecondaryPanel(session.id, { defaultOpen: true });
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
        allowSidecarTerminal={false}
        onOpenFile={(path, title) => panel.addTab({ kind: 'file-preview', title, path })}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: 'https://example.com' })}
        onOpenPlugin={(moduleId, title) => panel.addTab({ kind: 'plugin', title, moduleId })}
      />
    );
  } else if (closable?.kind === 'file-preview' && closable.path) {
    panelBody = <ThreadFilePreviewTab path={closable.path} />;
  } else if (closable?.kind === 'browser') {
    panelBody = (
      <ThreadBrowserTab
        initialUrl={closable.url ?? 'https://example.com'}
        onUrlChange={(url) => panel.patchTab(closable.id, { url })}
      />
    );
  } else if (closable?.kind === 'plugin' && closable.moduleId) {
    panelBody = <ThreadPluginTab moduleId={closable.moduleId} projectId={projectId} />;
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
        </ThreadSecondaryPanel>
      ) : null}
      </div>
    </section>
  );
}
