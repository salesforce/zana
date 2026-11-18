import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { Bot, PanelRight } from 'lucide-react';
import { useCompactLayout } from '../../hooks/useCompactLayout.js';
import { PanelAgentTab } from '../../components/thread/secondary-panel/PanelAgentTab.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { useSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import { activeClosableTab } from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';

/** Only the project page owns this panel; embedded Explorer trees stay unwrapped. */
export function ExplorerPanelLayout({ projectId, children }: { projectId: string; children: ReactNode }) {
  return <ProjectExplorerPanel key={projectId} projectId={projectId}>{children}</ProjectExplorerPanel>;
}

function ProjectExplorerPanel({ projectId, children }: { projectId: string; children: ReactNode }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const compact = useCompactLayout();
  const ownerId = `project-explorer:${projectId}`;
  const panel = useSecondaryPanel(ownerId, {
    getContainerWidthPx: () => viewRef.current?.clientWidth || 1200
  });
  const active = activeClosableTab(panel.state);
  const { addTab, activateTab, close } = panel;
  const newAgent = useCallback(() => {
    addTab({ kind: 'agent', title: 'Agent' });
  }, [addTab]);
  const showAgent = () => {
    const latest = panel.state.tabs.filter(tab => tab.kind === 'agent').at(-1);
    if (latest) activateTab(latest.id);
    else newAgent();
  };
  const showPanel = () => {
    if (active?.kind === 'agent') panel.open();
    else showAgent();
  };
  // Closing the last conversation returns to the rail. If an inactive tab is
  // left, show it instead of leaving the panel on its unused Info pin.
  useEffect(() => {
    if (!panel.state.isOpen || active?.kind === 'agent') return;
    const latest = panel.state.tabs.filter(tab => tab.kind === 'agent').at(-1);
    if (latest) activateTab(latest.id);
    else close();
  }, [panel.state.isOpen, panel.state.tabs, active, activateTab, close]);

  return (
    <div
      ref={viewRef}
      className={`plugin-panel-host-layout${panel.state.isOpen ? ' is-secondary-open' : ''}${panel.state.isOpen && panel.state.isMaximized ? ' is-secondary-maximized' : ''}${compact ? ' is-compact' : ''}`}
      data-testid="explorer-panel-layout"
      style={panel.state.isOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="split-plugin-main">{children}</div>
      {!panel.state.isOpen ? (
        <div className="plugin-panel-host-launchers" role="toolbar" aria-label="Side panel">
          <button type="button" className="icon-btn" title="Show right panel" aria-label="Show right panel" onClick={showPanel}>
            <PanelRight size={14} />
          </button>
          <button type="button" className="icon-btn" title="Ask an agent" aria-label="Ask an agent" onClick={showAgent}>
            <Bot size={14} />
          </button>
        </div>
      ) : (
        <ThreadSecondaryPanel
          state={panel.state}
          showInfoPin={false}
          showDiffPin={false}
          showPlanPin={false}
          onSelectInfo={() => undefined}
          onSelectDiff={() => undefined}
          onNewTab={newAgent}
          onCloseTab={panel.closeTab}
          onCloseTabs={panel.closeTabs}
          onActivateTab={activateTab}
          onToggleMaximized={panel.toggleMaximized}
          onHide={close}
          onResize={panel.setWidth}
        >
          {active?.kind === 'agent' ? (
            <PanelAgentTab
              key={active.id}
              threadId={active.threadId}
              projectId={projectId}
              draftSessionKey={JSON.stringify([ownerId, active.id])}
              onCreated={threadId => panel.patchTab(active.id, { threadId })}
            />
          ) : null}
        </ThreadSecondaryPanel>
      )}
    </div>
  );
}
