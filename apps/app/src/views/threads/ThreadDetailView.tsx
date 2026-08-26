import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Maximize2, Minimize2, PanelRight, X } from 'lucide-react';
import type { ActiveThinking, ThreadTimelineGoal, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { ThreadContextWindowUsage, TimelineRow } from '@zana-ai/zcc-server-contract';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { product } from '../../lib/product-client.js';
import { ThreadCommandComposer } from '../../components/ThreadCommandComposer.js';
import { ThreadTimeline } from '../../components/thread/ThreadTimeline.js';
import { ThreadDiffPanel } from '../../components/thread/ThreadDiffPanel.js';
import { ThreadWorkspaceBanner } from '../../components/thread/ThreadWorkspaceBanner.js';
import { isBusyThreadStatus, timelineRowsAwaitUser } from '../../components/thread/thread-timeline-model.js';
import { ThreadDetailHeading } from '../../components/thread/timeline/ThreadBanners.js';
import { ThreadDetailOverflow } from '../../components/thread/ThreadDetailOverflow.js';
import { getProjectWorkspaceRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { pendingChildThreads, useThreads } from '../../thread-store.js';
import { ThreadPendingInteractionBanner } from '../../components/thread/pending-interactions/ThreadPendingInteractionBanner.js';
import { ChildThreadPendingBanners } from '../../components/thread/pending-interactions/ChildThreadPendingBanners.js';
import { useOpenPendingInteractions } from '../../components/thread/pending-interactions/useOpenPendingInteractions.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadInfoContent } from '../../components/thread/secondary-panel/ThreadInfoContent.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { ThreadFilePreviewTab } from '../../components/thread/secondary-panel/ThreadFilePreviewTab.js';
import { ThreadBrowserTab } from '../../components/thread/secondary-panel/ThreadBrowserTab.js';
import { ThreadTerminalTab } from '../../components/thread/secondary-panel/ThreadTerminalTab.js';
import { ThreadPluginTab } from '../../components/thread/secondary-panel/ThreadPluginTab.js';
import { copyText } from '../../components/thread/secondary-panel/threadSecondaryPanelLogic.js';
import { useThreadSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import {
  activeClosableTab,
  activePinnedView
} from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';

const INITIAL_SEGMENT_LIMIT = 200;

export function ThreadDetailView() {
  const { threadId } = useParams<{ threadId: string }>();
  if (!threadId) return null;
  return <ThreadDetail threadId={threadId} />;
}

export function ThreadDetail({
  threadId,
  embedded = false,
  onClose,
  fullScreen = false,
  onToggleFullScreen
}: {
  threadId: string;
  embedded?: boolean;
  /** When set, this surface is hosted in the thread inspector modal. */
  onClose?: () => void;
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
}) {
  const navigate = useNavigate();
  const route = useRouteState();
  const upsertThread = useThreads((s) => s.upsert);
  const threads = useThreads((s) => s.threads);
  const childThreads = useMemo(
    () => pendingChildThreads(threads, threadId),
    [threadId, threads]
  );
  const pendingInteractions = useOpenPendingInteractions(threadId);
  const panel = useThreadSecondaryPanel(threadId);
  const [title, setTitle] = useState('Thread');
  const [status, setStatus] = useState('starting');
  const [cwd, setCwd] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [isWorktree, setIsWorktree] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [threadProviderId, setThreadProviderId] = useState<string | null>(null);
  const [threadModel, setThreadModel] = useState<string | null>(null);
  const [threadReasoning, setThreadReasoning] = useState<string | null>(null);
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [thinking, setThinking] = useState<ActiveThinking | null>(null);
  const [todos, setTodos] = useState<ThreadTimelinePendingTodos | null>(null);
  const [goal, setGoal] = useState<ThreadTimelineGoal | null>(null);
  const [workflows, setWorkflows] = useState<TimelineViewWorkflowWorkRow[]>([]);
  const [promptMode, setPromptMode] = useState<{ mode: string; prompt?: string } | null>(null);
  const [contextWindow, setContextWindow] = useState<ThreadContextWindowUsage | null>(null);
  const [lastReadSeq, setLastReadSeq] = useState<number | null>(null);
  const [hasOlderRows, setHasOlderRows] = useState(false);
  const [segmentLimit, setSegmentLimit] = useState(INITIAL_SEGMENT_LIMIT);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [diffPath, setDiffPath] = useState<string | null>(null);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    let poll: number | null = null;
    let gen = 0;
    const refresh = async () => {
      const my = ++gen;
      try {
        const [detail, timeline] = await Promise.all([
          product.threads.get(threadId),
          product.threads.timeline(threadId, { segmentLimit })
        ]);
        if (cancelled || my !== gen) return;
        const thread = detail.thread as {
          id?: string;
          title?: string | null;
          status?: string;
          cwd?: string | null;
          projectId?: string;
          hostId?: string;
          environmentId?: string | null;
          providerId?: string;
          createdAt?: number;
          branchName?: string | null;
          isWorktree?: boolean;
          archivedAt?: number | null;
          model?: string | null;
          reasoningLevel?: string | null;
        };
        const nextStatus = thread.status ?? timeline.status;
        setTitle(thread.title?.trim() || 'Thread');
        setStatus(nextStatus);
        setCwd(typeof thread.cwd === 'string' ? thread.cwd : null);
        setProjectId(typeof thread.projectId === 'string' ? thread.projectId : null);
        setEnvironmentId(typeof thread.environmentId === 'string' ? thread.environmentId : null);
        setIsWorktree(thread.isWorktree ?? false);
        setBranchName(thread.branchName ?? null);
        setThreadProviderId(typeof thread.providerId === 'string' ? thread.providerId : null);
        setThreadModel(typeof thread.model === 'string' ? thread.model : null);
        setThreadReasoning(typeof thread.reasoningLevel === 'string' ? thread.reasoningLevel : null);
        setRows((timeline.rows as TimelineRow[]) ?? []);
        setThinking((timeline.activeThinking as ActiveThinking | null) ?? null);
        setTodos((timeline.pendingTodos as ThreadTimelinePendingTodos | null) ?? null);
        setGoal((timeline.goal as ThreadTimelineGoal | null) ?? null);
        setWorkflows((timeline.activeWorkflows as TimelineViewWorkflowWorkRow[]) ?? []);
        setPromptMode((timeline.activePromptMode as { mode: string; prompt?: string } | null) ?? null);
        setContextWindow((timeline.contextWindowUsage as ThreadContextWindowUsage | null) ?? null);
        setLastReadSeq(typeof timeline.lastReadSeq === 'number' ? timeline.lastReadSeq : null);
        setHasOlderRows(Boolean(timeline.timelinePage?.hasOlderRows));
        if (thread.id) {
          upsertThread({
            id: thread.id,
            projectId: thread.projectId ?? '',
            hostId: thread.hostId ?? '',
            environmentId: thread.environmentId ?? null,
            providerId: thread.providerId ?? '',
            status: nextStatus,
            title: thread.title ?? null,
            createdAt: thread.createdAt ?? Date.now(),
            cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
            branchName: thread.branchName ?? null,
            isWorktree: thread.isWorktree ?? false,
            archivedAt: thread.archivedAt ?? null,
            parentThreadId: (thread as { parentThreadId?: string | null }).parentThreadId ?? null,
            hasPendingInteraction: Boolean((thread as { hasPendingInteraction?: boolean }).hasPendingInteraction)
          });
        }
        if (!isBusyThreadStatus(nextStatus) && poll !== null) {
          window.clearInterval(poll);
          poll = null;
        }
      } catch {
        /* keep last */
      } finally {
        if (!cancelled) setLoadingOlder(false);
      }
    };
    void refresh();
    poll = window.setInterval(() => {
      if (cancelled) {
        if (poll !== null) window.clearInterval(poll);
        return;
      }
      void refresh();
    }, 400);
    const stopUpdated = product.threads.onUpdated(() => void refresh());
    const stopEvents = product.threads.onEvent((payload) => {
      if (payload && typeof payload === 'object' && 'threadId' in payload
        && (payload as { threadId: string }).threadId === threadId) {
        void refresh();
      }
    });
    return () => {
      cancelled = true;
      if (poll !== null) window.clearInterval(poll);
      stopUpdated();
      stopEvents();
    };
  }, [segmentLimit, threadId, upsertThread]);

  const markRead = useCallback(() => {
    if (!threadId) return;
    void product.threads.read(threadId).then((body) => {
      const seq = (body.thread as { lastReadSeq?: number }).lastReadSeq;
      if (typeof seq === 'number') setLastReadSeq(seq);
    }).catch(() => undefined);
  }, [threadId]);

  const openDiff = useCallback((path?: string | null) => {
    setDiffPath(path ?? null);
    panel.selectPin('diff');
  }, [panel]);

  const startPanelTerminal = useCallback(async () => {
    if (!projectId) return;
    const created = await product.terminals.create({
      projectId,
      profile: 'shell',
      cwd: cwd ?? undefined,
      cols: 80,
      rows: 24
    });
    if (created.ok) {
      panel.addTab({ kind: 'terminal', title: 'Terminal', sessionId: created.value.id });
    }
  }, [cwd, panel, projectId]);

  const pin = activePinnedView(panel.state);
  const closable = activeClosableTab(panel.state);
  const panelOpen = panel.state.isOpen;
  const viewClass = [
    'thread-detail-view',
    embedded ? 'thread-detail-view--embedded' : '',
    onClose ? 'thread-detail-view--modal' : '',
    panelOpen ? 'is-secondary-open' : '',
    panel.state.isMaximized ? 'is-secondary-maximized' : ''
  ].filter(Boolean).join(' ');

  let panelBody = null;
  if (pin === 'info') {
    panelBody = (
      <ThreadInfoContent
        threadId={threadId}
        projectId={projectId}
        isWorktree={isWorktree}
        cwd={cwd}
        branchName={branchName}
        environmentId={environmentId}
        model={threadModel}
        reasoningLevel={threadReasoning}
        providerId={threadProviderId}
      />
    );
  } else if (pin === 'diff' && environmentId) {
    panelBody = (
      <ThreadDiffPanel
        environmentId={environmentId}
        path={diffPath}
        embedded
        onClose={() => panel.selectPin('info')}
      />
    );
  } else if (closable?.kind === 'new-tab') {
    panelBody = (
      <ThreadNewTabPage
        projectId={projectId}
        cwd={cwd}
        onOpenFile={(path, title) => panel.addTab({ kind: 'file-preview', title, path })}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: 'https://example.com' })}
        onStartTerminal={() => { void startPanelTerminal(); }}
        onOpenPlugin={(moduleId, title) => panel.addTab({ kind: 'plugin', title, moduleId })}
      />
    );
  } else if (closable?.kind === 'file-preview' && closable.path) {
    panelBody = <ThreadFilePreviewTab threadId={threadId} path={closable.path} />;
  } else if (closable?.kind === 'browser') {
    panelBody = (
      <ThreadBrowserTab
        initialUrl={closable.url ?? 'https://example.com'}
        onUrlChange={(url) => panel.patchTab(closable.id, { url })}
      />
    );
  } else if (closable?.kind === 'terminal' && closable.sessionId && projectId) {
    panelBody = <ThreadTerminalTab sessionId={closable.sessionId} projectId={projectId} />;
  } else if (closable?.kind === 'plugin' && closable.moduleId) {
    panelBody = <ThreadPluginTab moduleId={closable.moduleId} projectId={projectId} />;
  } else if (pin === 'diff') {
    panelBody = <p className="thread-detail-empty">No environment is attached to this thread.</p>;
  }

  const awaitingUser = pendingInteractions.length > 0 || timelineRowsAwaitUser(rows);

  return (
    <section
      className={viewClass}
      data-testid="thread-detail"
      data-embedded={embedded ? 'true' : undefined}
      style={panelOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="thread-detail-main">
        <header className="thread-detail-header">
          <ThreadDetailHeading
            title={title}
            status={status}
            waitingOnUser={awaitingUser}
            thinking={thinking}
            overflow={
              <ThreadDetailOverflow
                threadId={threadId}
                title={title}
                status={status}
                projectId={projectId}
                onRenamed={setTitle}
                onUnread={() => setLastReadSeq(0)}
              />
            }
          />
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
            {onToggleFullScreen ? (
              <button
                type="button"
                className="icon-btn"
                onClick={onToggleFullScreen}
                aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
                title={fullScreen ? 'Exit full screen' : 'Full screen'}
                data-testid="thread-modal-fullscreen"
              >
                {fullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            ) : null}
            {onClose ? (
              <button
                type="button"
                className="icon-btn"
                onClick={onClose}
                aria-label="Close"
                data-testid="thread-modal-close"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </header>
        <div className="thread-detail-body">
          <div className="thread-detail-column">
            <ThreadTimeline
              threadId={threadId}
              rows={rows}
              status={status}
              waitingOnUser={awaitingUser}
              thinking={thinking}
              todos={todos}
              goal={goal}
              activeWorkflows={workflows}
              activePromptMode={promptMode}
              lastReadSeq={lastReadSeq}
              hasOlderRows={hasOlderRows}
              loadingOlder={loadingOlder}
              onLoadOlder={() => {
                setLoadingOlder(true);
                setSegmentLimit((current) => current + INITIAL_SEGMENT_LIMIT);
              }}
              onReachedBottom={markRead}
              onCopy={(text) => {
                void copyText(text);
              }}
              onTitleAction={(action) => {
                if (action.kind === 'open-file-diff') openDiff(action.path);
              }}
              onTitleLink={(link) => {
                if (link.kind === 'thread') {
                  navigate(getThreadRoutePath(
                    link.threadId,
                    route.isProjectWorkspace ? route.focusedProjectId : undefined
                  ));
                }
              }}
              onOpenDiff={(path) => openDiff(path)}
            />
            <ThreadWorkspaceBanner
              environmentId={environmentId}
              onOpenDiff={(path) => openDiff(path)}
            />
            <div className="thread-composer-dock">
              <ChildThreadPendingBanners childThreads={childThreads} projectId={projectId} />
              {pendingInteractions.map((interaction) => (
                <ThreadPendingInteractionBanner
                  key={interaction.id}
                  interaction={interaction}
                  threadId={threadId}
                />
              ))}
              <ThreadCommandComposer
                threadId={threadId}
                status={status}
                sendBlocked={pendingInteractions.length > 0}
                environmentLabel={isWorktree ? 'This checkout' : 'Local'}
                contextWindowUsage={contextWindow}
                providerId={threadProviderId ?? undefined}
                model={threadModel}
                reasoningLevel={threadReasoning}
                onOpenExplorer={projectId ? () => navigate(getProjectWorkspaceRoutePath(projectId, 'explorer')) : undefined}
              />
            </div>
          </div>
        </div>
      </div>
      {panelOpen ? (
        <ThreadSecondaryPanel
          state={panel.state}
          showDiffPin={Boolean(environmentId)}
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
    </section>
  );
}
