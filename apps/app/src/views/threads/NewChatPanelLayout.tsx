import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanelRight } from 'lucide-react';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { useData } from '../../store.js';
import { useCompactLayout } from '../../hooks/useCompactLayout.js';
import { useOptionalPaneContext } from '../thread-detail/PaneContext.js';
import { product } from '../../lib/product-client.js';
import { getBrowserUrlHost } from '../../lib/browser-url.js';
import { ThreadPanelOwnerProvider, agentSessionPanelOwnerId } from '../../plugins/thread-panel-owner.js';
import { ThreadSecondaryPanel, type ThreadPanelToolKind } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { ThreadFilePreviewTab } from '../../components/thread/secondary-panel/ThreadFilePreviewTab.js';
import { ThreadExplorerTab } from '../../components/thread/secondary-panel/ThreadExplorerTab.js';
import { ThreadInboxTab } from '../../components/thread/secondary-panel/ThreadInboxTab.js';
import { ThreadPluginTab } from '../../components/thread/secondary-panel/ThreadPluginTab.js';
import { DockedTerminalTab } from '../../components/thread/secondary-panel/DockedTerminalTab.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { useSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import { useInAppBrowserPanel } from '../../components/thread/secondary-panel/useInAppBrowserPanel.js';
import { tabInputFromRecentItem } from '../../components/thread/secondary-panel/threadRecentItems.js';
import { activeClosableTab, emptySecondaryPanelState, persistSecondaryPanelState } from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';
import { registerBrowserView } from '../../components/thread/secondary-panel/browserViewVisibilityCoordinator.js';
import { useThreadOpenFileSignal } from '../../components/thread/secondary-panel/useThreadOpenFileSignal.js';
import './new-chat-panel-layout.css';

export interface NewChatPanelLaunchHandlers {
  onCreated: (threadId: string) => void;
  onAgentCreated: (session: TerminalSession) => void;
}

/** A draft owns its tools until a successful launch moves them to the agent. */
interface NewChatPanelLayoutProps {
  scopeId: string;
  project?: Project;
  hostId?: string;
  children: (handlers: NewChatPanelLaunchHandlers) => ReactNode;
}

export function NewChatPanelLayout(props: NewChatPanelLayoutProps) {
  const [generation, setGeneration] = useState(0);
  return <DraftChatPanel key={generation} {...props} onHandoff={() => setGeneration(value => value + 1)} />;
}

function DraftChatPanel({ scopeId, project, hostId, children, onHandoff }: NewChatPanelLayoutProps & { onHandoff: () => void }) {
  const ownerId = `new-chat:${scopeId}`;
  const viewRef = useRef<HTMLDivElement>(null);
  const compact = useCompactLayout();
  const pane = useOptionalPaneContext();
  const panel = useSecondaryPanel(ownerId, { getContainerWidthPx: () => viewRef.current?.clientWidth ?? 0 });
  const panelStateRef = useRef(panel.state);
  panelStateRef.current = panel.state;
  useInAppBrowserPanel(ownerId, panel);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  useEffect(() => () => { generationRef.current++; }, []);
  const handedOff = useRef(false);
  const closable = activeClosableTab(panel.state);
  const open = panel.state.isOpen;
  useThreadOpenFileSignal({ threadId: ownerId, environmentId: project?.path ?? null, openTab: panel.addTab });

  const handoff = (destination: string, browserOwner = destination) => {
    // Write before navigation: the destination hook restores on its first render.
    // Creation is async; include panel edits made while the launch was pending.
    const current = panelStateRef.current;
    persistSecondaryPanelState(destination, current);
    for (const tab of current.tabs) {
      if (tab.kind === 'browser') registerBrowserView({ tabId: tab.id, threadId: browserOwner });
    }
    handedOff.current = true;
    generationRef.current++;
    // The CLI inspector may open over this still-mounted page. Start a fresh
    // draft, leaving no second host for the transferred native tools.
    persistSecondaryPanelState(ownerId, emptySecondaryPanelState());
    onHandoff();
  };

  const startTerminal = async () => {
    if (!project) return;
    const startGeneration = generationRef.current;
    try {
      setError(null);
      const created = await product.terminals.create({ projectId: project.id, hostId, profile: 'shell', cols: 80, rows: 24, title: 'Terminal' });
      if (!created.ok) throw new Error(created.message || 'Could not open terminal');
      // A pending shell must never arrive in the next draft after a launch.
      if (generationRef.current !== startGeneration) {
        await product.terminals.close(created.value.id);
        return;
      }
      panel.addTab({ kind: 'terminal', title: created.value.title, sessionId: created.value.id });
    } catch (reason) {
      if (generationRef.current === startGeneration) setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const addTool = (kind: ThreadPanelToolKind) => {
    if (kind === 'terminal') void startTerminal();
    else panel.addTab(kind === 'browser' ? { kind, title: 'Browser', url: '' } : { kind, title: 'Explorer' });
  };
  const openFile = (path: string, title: string) => panel.addTab({ kind: 'file-preview', title, path });

  let body: ReactNode = null;
  if (closable?.kind === 'new-tab' || !closable) {
    body = <ThreadNewTabPage
      projectId={project?.id ?? null} cwd={project?.path ?? null} threadId={ownerId}
      allowSidecarTerminal={Boolean(project)} onStartTerminal={() => { void startTerminal(); }}
      onOpenFile={openFile}
      onOpenBrowser={() => addTool('browser')}
      onOpenExplorer={() => addTool('explorer')}
      onOpenInbox={() => panel.addTab({ kind: 'inbox', title: 'Inbox' })}
      onOpenPlugin={(moduleId, title, options) => panel.addTab({ kind: 'plugin', moduleId, title, ...options })}
      onOpenRecent={item => panel.addTab(tabInputFromRecentItem(item))}
    />;
  } else if (closable.kind === 'file-preview' && closable.path) {
    body = <ThreadFilePreviewTab path={closable.path} projectId={project?.id ?? null} previewRevision={closable.previewRevision} openerKey={closable.openerKey} lineNumber={closable.lineNumber ?? null} />;
  } else if (closable.kind === 'explorer') {
    body = <ThreadExplorerTab projectId={project?.id ?? null} />;
  } else if (closable.kind === 'inbox') {
    body = <ThreadInboxTab projectId={project?.id ?? null} />;
  } else if (closable.kind === 'terminal' && closable.sessionId) {
    body = <DockedTerminalTab sessionId={closable.sessionId} />;
  } else if (closable.kind === 'plugin' && closable.moduleId) {
    body = <ThreadPluginTab moduleId={closable.moduleId} projectId={project?.id ?? null} actionId={closable.actionId} params={closable.params} layout={closable.layout} surface="thread" tabId={closable.id} />;
  }

  return <ThreadPanelOwnerProvider ownerId={ownerId}>
    <div ref={viewRef} data-testid="new-chat-panel-layout" className={`new-chat-panel-layout${open ? ' is-secondary-open' : ''}${open && panel.state.isMaximized ? ' is-secondary-maximized' : ''}${compact ? ' is-compact' : ''}`}
      style={open ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}>
      <div className="new-chat-panel-main">{children({ onCreated: handoff, onAgentCreated: session => handoff(agentSessionPanelOwnerId(session.id, !useData.getState().classicSessionViewEnabled), session.id) })}</div>
      {!open && <div className="new-chat-panel-launchers" role="toolbar" aria-label="Side panel">
        <button type="button" className="icon-btn" title="Show right panel" aria-label="Show right panel" data-testid="thread-secondary-show" onClick={() => {
          if (closable) panel.open(); else panel.openNewTab();
        }}><PanelRight size={14} /></button>
      </div>}
      {open && <ThreadSecondaryPanel state={panel.state} showInfoPin={false} showDiffPin={false} showPlanPin={false}
        onSelectInfo={() => undefined} onSelectDiff={() => undefined} onNewTab={panel.openNewTab}
        onAddTool={project ? addTool : undefined}
        onCloseTab={panel.closeTab} onCloseTabs={panel.closeTabs} onActivateTab={panel.activateTab}
        onToggleMaximized={panel.toggleMaximized} onHide={panel.close} onResize={panel.setWidth}>
        {error && <p role="alert" className="thread-detail-empty">{error}</p>}
        {body}
        <BrowserTabDeck browserTabs={panel.state.tabs.filter(tab => tab.kind === 'browser')}
          activeBrowserTabId={closable?.kind === 'browser' ? closable.id : null}
          canShowNativeBrowserView={open && pane?.isFocused !== false} threadId={ownerId}
          onUpdate={({ tabId, url, title }) => {
            if (!handedOff.current) panel.patchTab(tabId, { url, title: title || getBrowserUrlHost(url) || 'Browser' });
          }} />
      </ThreadSecondaryPanel>}
    </div>
  </ThreadPanelOwnerProvider>;
}
