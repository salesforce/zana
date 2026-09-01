import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Maximize2, Minimize2, PanelRight, X } from 'lucide-react';
import type { ActiveThinking, ThreadTimelineGoal, ThreadTimelineModelFallback, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import { applyTimelineDelta, type ThreadContextWindowUsage, type TimelineDelta, type TimelineRow } from '@zana-ai/zcc-server-contract';
import { buildTimelineViewRows, type TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { product } from '../../lib/product-client.js';
import { ThreadCommandComposer } from '../../components/ThreadCommandComposer.js';
import { ThreadTimeline } from '../../components/thread/ThreadTimeline.js';
import { ThreadDiffPanel } from '../../components/thread/ThreadDiffPanel.js';
import { ThreadWorkspaceBanner } from '../../components/thread/ThreadWorkspaceBanner.js';
import {
  timelineHasInFlightRetry,
  timelineRowsAwaitUser
} from '../../components/thread/thread-timeline-model.js';
import { ThreadDetailHeading, ThreadPromptModeCard, ThreadStatusBadge, ThreadTodoCard } from '../../components/thread/timeline/ThreadBanners.js';
import {
  BackgroundCommandsCard,
  ModelFallbackCard,
  PromptContextBanner,
  QueuedMessagesCard
} from '../../components/thread/timeline/ComposerStackCards.js';
import { ThreadDetailOverflow } from '../../components/thread/ThreadDetailOverflow.js';
import { ThreadDetailSearch } from '../../components/thread/ThreadDetailSearch.js';
import { createCoalescedRunner } from '../../lib/coalesced-runner.js';
import { getThreadRoutePath } from '../../lib/route-paths.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { pendingChildThreads, useThreads } from '../../thread-store.js';
import { useData } from '../../store.js';
import { composerRemoteToolsMark } from '../../components/composer-host-status.js';
import { ThreadPendingInteractionBanner } from '../../components/thread/pending-interactions/ThreadPendingInteractionBanner.js';
import { ChildThreadPendingBanners } from '../../components/thread/pending-interactions/ChildThreadPendingBanners.js';
import {
  isOpenThreadEvent,
  useOpenPendingInteractions
} from '../../components/thread/pending-interactions/useOpenPendingInteractions.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { useOptionalPaneContext, usePaneSecondaryPanelRegistration } from '../thread-detail/PaneContext.js';
import { ThreadInfoContent } from '../../components/thread/secondary-panel/ThreadInfoContent.js';
import { ThreadPlanPanel } from '../../components/thread/secondary-panel/ThreadPlanPanel.js';
import {
  planFileTabTitle,
  resolveThreadPlanDocument
} from '../../components/thread/secondary-panel/thread-plan-document.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { ThreadFilePreviewTab } from '../../components/thread/secondary-panel/ThreadFilePreviewTab.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { ThreadTerminalTab } from '../../components/thread/secondary-panel/ThreadTerminalTab.js';
import { ThreadPluginTab } from '../../components/thread/secondary-panel/ThreadPluginTab.js';
import { ThreadExplorerTab } from '../../components/thread/secondary-panel/ThreadExplorerTab.js';
import { PluginThreadHeaderActions } from '../../plugins/PluginThreadHeaderActions.js';
import { copyText } from '../../components/thread/secondary-panel/threadSecondaryPanelLogic.js';
import { useThreadSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import { useInAppBrowserPanel } from '../../components/thread/secondary-panel/useInAppBrowserPanel.js';
import {
  dispatchThreadOpenFile,
  useThreadOpenFileSignal
} from '../../components/thread/secondary-panel/useThreadOpenFileSignal.js';
import { appendThreadRecentItem, tabInputFromRecentItem } from '../../components/thread/secondary-panel/threadRecentItems.js';
import {
  activeClosableTab,
  activePinnedView
} from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';
import { getDesktopBrowserApi } from '../../lib/desktop-browser.js';
import { getBrowserUrlHost } from '../../lib/browser-url.js';
import {
  buildOptimisticUserTimelineRow,
  hasConfirmedStopRow,
  mergeOptimisticTimelineRows,
  mergePendingStopRow
} from '../../components/thread/timeline/optimistic-timeline-row.js';
import {
  THREAD_OPTIMISTIC_USER_EVENT,
  THREAD_STOP_REQUESTED_EVENT
} from '../../components/thread/timeline/thread-optimistic-events.js';
import {
  findDeepestTimelineSearchHit,
  type TimelineSearchHit
} from '../../components/thread/timeline/thread-search.js';

/** Safety cap (Rule 5). Large enough that a normal thread loads in one shot. */
const TIMELINE_SEGMENT_LIMIT = 10_000;
const TIMELINE_DELTA_DEBOUNCE_MS = 100;

export function ThreadDetailView() {
  const { threadId } = useParams<{ threadId: string }>();
  if (!threadId) return null;
  return <ThreadDetail key={threadId} threadId={threadId} />;
}

export function ThreadDetail({
  threadId,
  embedded = false,
  modal = false
}: {
  threadId: string;
  embedded?: boolean;
  /** Hosted in the thread inspector modal; dialog close/fullscreen live on the modal header. */
  modal?: boolean;
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
  const pane = useOptionalPaneContext();
  const hostedSecondary = pane?.secondaryPanelHost != null;
  const panel = useThreadSecondaryPanel(threadId);
  useInAppBrowserPanel(threadId, panel);
  const [title, setTitle] = useState('Agent');
  const [status, setStatus] = useState('starting');
  const [cwd, setCwd] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const project = useData((s) => (projectId ? s.projects.find((row) => row.id === projectId) ?? null : null));
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
  const [backgroundCommands, setBackgroundCommands] = useState<TimelineViewWorkflowWorkRow[]>([]);
  const [modelFallback, setModelFallback] = useState<ThreadTimelineModelFallback | null>(null);
  const [parentThreadId, setParentThreadId] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<{ mode: string; prompt?: string } | null>(null);
  const [contextWindow, setContextWindow] = useState<ThreadContextWindowUsage | null>(null);
  const [lastReadSeq, setLastReadSeq] = useState<number | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [todoExpanded, setTodoExpanded] = useState(false);
  const [planExitPending, setPlanExitPending] = useState(false);
  const [optimisticRow, setOptimisticRow] = useState<TimelineRow | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [stoppingAnchorAt, setStoppingAnchorAt] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHit, setSearchHit] = useState<TimelineSearchHit | null>(null);
  const rowsRef = useRef<TimelineRow[]>([]);
  const maxSeqRef = useRef(0);
  const loadedRef = useRef(false);
  useThreadOpenFileSignal({
    threadId,
    environmentId,
    openTab: (tab) => {
      if (tab.kind === 'file-preview' && tab.path) {
        appendThreadRecentItem(threadId, { kind: 'file', source: 'workspace', path: tab.path });
      } else if (tab.kind === 'storage-preview' && tab.path) {
        appendThreadRecentItem(threadId, { kind: 'file', source: 'thread-storage', path: tab.path });
      }
      panel.addTab(tab);
    }
  });

  const displayRows = useMemo(() => {
    const withOptimistic = mergeOptimisticTimelineRows(rows, optimisticRow);
    return mergePendingStopRow(withOptimistic, { threadId, isStopping, stoppingAnchorAt });
  }, [isStopping, optimisticRow, rows, stoppingAnchorAt, threadId]);

  const forceExpandedRowIds = useMemo(() => {
    if (!searchHit) return undefined;
    return new Set([...searchHit.ancestorIds, searchHit.id]);
  }, [searchHit]);

  useEffect(() => {
    const onOptimistic = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; text?: string | null }>).detail;
      if (detail?.threadId !== threadId) return;
      if (!detail.text) {
        setOptimisticRow(null);
        return;
      }
      setOptimisticRow(buildOptimisticUserTimelineRow({ threadId, text: detail.text }));
    };
    const onStop = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      if (detail?.threadId !== threadId) return;
      setIsStopping(true);
      setStoppingAnchorAt(Date.now());
    };
    window.addEventListener(THREAD_OPTIMISTIC_USER_EVENT, onOptimistic);
    window.addEventListener(THREAD_STOP_REQUESTED_EVENT, onStop);
    return () => {
      window.removeEventListener(THREAD_OPTIMISTIC_USER_EVENT, onOptimistic);
      window.removeEventListener(THREAD_STOP_REQUESTED_EVENT, onStop);
    };
  }, [threadId]);

  useEffect(() => {
    if (!optimisticRow) return;
    const stillShown = mergeOptimisticTimelineRows(rows, optimisticRow).some((row) => row.id === optimisticRow.id);
    if (!stillShown) setOptimisticRow(null);
  }, [optimisticRow, rows]);

  useEffect(() => {
    if (isStopping && hasConfirmedStopRow(rows)) setIsStopping(false);
  }, [isStopping, rows]);

  useEffect(() => {
    if (!searchHit || !searchQuery) return;
    const viewRows = buildTimelineViewRows(displayRows);
    const next = findDeepestTimelineSearchHit(viewRows, searchQuery);
    if (next && (next.id !== searchHit.id || next.ancestorIds.join() !== searchHit.ancestorIds.join())) {
      setSearchHit(next);
    }
  }, [displayRows, searchHit, searchQuery]);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    let debounceTimer: number | null = null;
    rowsRef.current = [];
    maxSeqRef.current = 0;
    loadedRef.current = false;

    const applyTimeline = (
      timeline: Awaited<ReturnType<typeof product.threads.timeline>>,
      nextRows: TimelineRow[]
    ) => {
      rowsRef.current = nextRows;
      maxSeqRef.current = typeof timeline.maxSeq === 'number' ? timeline.maxSeq : 0;
      loadedRef.current = true;
      setRows(nextRows);
      setThinking((timeline.activeThinking as ActiveThinking | null) ?? null);
      setTodos((timeline.pendingTodos as ThreadTimelinePendingTodos | null) ?? null);
      setGoal((timeline.goal as ThreadTimelineGoal | null) ?? null);
      setWorkflows((timeline.activeWorkflows as TimelineViewWorkflowWorkRow[]) ?? []);
      setBackgroundCommands((timeline.activeBackgroundCommands as TimelineViewWorkflowWorkRow[]) ?? []);
      setModelFallback((timeline.modelFallback as ThreadTimelineModelFallback | null) ?? null);
      setPromptMode((timeline.activePromptMode as { mode: string; prompt?: string } | null) ?? null);
      setContextWindow((timeline.contextWindowUsage as ThreadContextWindowUsage | null) ?? null);
      setLastReadSeq(typeof timeline.lastReadSeq === 'number' ? timeline.lastReadSeq : null);
      return nextRows;
    };

    const loadTimeline = async (forceFull: boolean): Promise<{
      timeline: Awaited<ReturnType<typeof product.threads.timeline>>;
      nextRows: TimelineRow[];
    }> => {
      const useDelta = !forceFull && loadedRef.current;
      const timeline = await product.threads.timeline(threadId, {
        segmentLimit: TIMELINE_SEGMENT_LIMIT,
        afterSequence: useDelta ? String(maxSeqRef.current) : undefined,
        includeNestedRows: 'false',
        summaryOnly: 'true'
      });
      if (useDelta && timeline.delta) {
        const merged = applyTimelineDelta(rowsRef.current, timeline.delta as TimelineDelta);
        if (merged == null) return loadTimeline(true);
        return { timeline, nextRows: merged };
      }
      if (useDelta && Array.isArray(timeline.rows) && timeline.rows.length === 0 && !timeline.delta) {
        return loadTimeline(true);
      }
      return { timeline, nextRows: (timeline.rows as TimelineRow[]) ?? [] };
    };

    const runner = createCoalescedRunner(async () => {
      try {
        const [detail, loaded] = await Promise.all([
          product.threads.get(threadId),
          loadTimeline(false)
        ]);
        if (cancelled) return;
        const timeline = loaded.timeline;
        const nextRows = applyTimeline(timeline, loaded.nextRows);
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
        setTitle(thread.title?.trim() || 'Agent');
        setStatus(nextStatus);
        setCwd(typeof thread.cwd === 'string' ? thread.cwd : null);
        setProjectId(typeof thread.projectId === 'string' ? thread.projectId : null);
        setEnvironmentId(typeof thread.environmentId === 'string' ? thread.environmentId : null);
        setIsWorktree(thread.isWorktree ?? false);
        setBranchName(thread.branchName ?? null);
        setThreadProviderId(typeof thread.providerId === 'string' ? thread.providerId : null);
        setThreadModel(typeof thread.model === 'string' ? thread.model : null);
        setThreadReasoning(typeof thread.reasoningLevel === 'string' ? thread.reasoningLevel : null);
        setParentThreadId((thread as { parentThreadId?: string | null }).parentThreadId ?? null);
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
            hasPendingInteraction: Boolean((thread as { hasPendingInteraction?: boolean }).hasPendingInteraction),
            lastReadSeq: typeof timeline.lastReadSeq === 'number' ? timeline.lastReadSeq : null,
            maxSeq: typeof timeline.maxSeq === 'number' ? timeline.maxSeq : 0,
            updatedAt: typeof (thread as { updatedAt?: number }).updatedAt === 'number'
              ? (thread as { updatedAt: number }).updatedAt
              : undefined
          });
        }
      } catch {
        /* keep last */
      }
    });
    const scheduleDelta = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        runner.run();
      }, TIMELINE_DELTA_DEBOUNCE_MS);
    };
    runner.run();
    const stopUpdated = product.threads.onUpdated((payload) => {
      if (payload && typeof payload === 'object' && 'id' in payload) {
        if ((payload as { id: unknown }).id === threadId) scheduleDelta();
        return;
      }
      scheduleDelta();
    });
    const stopEvents = product.threads.onEvent((payload) => {
      if (isOpenThreadEvent(payload, threadId)) scheduleDelta();
    });
    return () => {
      cancelled = true;
      runner.dispose();
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      stopUpdated();
      stopEvents();
    };
  }, [threadId, upsertThread]);

  const markRead = useCallback(() => {
    if (!threadId) return;
    void product.threads.read(threadId).then((body) => {
      const seq = (body.thread as { lastReadSeq?: number }).lastReadSeq;
      if (typeof seq !== 'number') return;
      setLastReadSeq(seq);
      const existing = useThreads.getState().threads.find((row) => row.id === threadId);
      if (existing) useThreads.getState().upsert({ ...existing, lastReadSeq: seq });
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
  const panelOpen = hostedSecondary ? false : panel.state.isOpen;
  const bounded = embedded || pane?.isBoundedPane === true;
  const planDocument = useMemo(
    () => resolveThreadPlanDocument({
      promptMode,
      pendingInteractions,
      rows
    }),
    [pendingInteractions, promptMode, rows]
  );
  const showPlanPin = planDocument !== null;
  const openedPlanPanel = useRef(false);

  useEffect(() => {
    if (!planDocument) {
      openedPlanPanel.current = false;
      if (pin === 'plan') panel.selectPin('info');
      return;
    }
    if (planDocument.source !== 'approval' || openedPlanPanel.current) return;
    openedPlanPanel.current = true;
    panel.selectPin('plan');
  }, [panel, pin, planDocument]);

  const viewClass = [
    'thread-detail-view',
    bounded ? 'thread-detail-view--embedded' : '',
    modal ? 'thread-detail-view--modal' : '',
    pane?.isSplitPane ? 'thread-detail-view--split-pane' : '',
    pane?.isFocused === false ? 'is-pane-inactive' : '',
    panelOpen ? 'is-secondary-open' : '',
    !hostedSecondary && panel.state.isMaximized ? 'is-secondary-maximized' : ''
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
        onOpenStorageFile={(path, title) => {
          appendThreadRecentItem(threadId, { kind: 'file', source: 'thread-storage', path });
          panel.addTab({ kind: 'storage-preview', title, path });
        }}
      />
    );
  } else if (pin === 'plan' && planDocument) {
    panelBody = (
      <ThreadPlanPanel
        document={planDocument}
        todos={todos}
        onOpenFile={(path) => panel.addTab({
          kind: 'file-preview',
          title: planFileTabTitle(path),
          path
        })}
      />
    );
  } else if (pin === 'diff' && environmentId) {
    panelBody = (
      <ThreadDiffPanel
        threadId={threadId}
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
        threadId={threadId}
        onOpenFile={(path, title) => {
          appendThreadRecentItem(threadId, { kind: 'file', source: 'workspace', path });
          panel.addTab({ kind: 'file-preview', title, path });
        }}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: '' })}
        onOpenExplorer={() => panel.addTab({ kind: 'explorer', title: 'Explorer' })}
        onStartTerminal={() => { void startPanelTerminal(); }}
        onOpenPlugin={(moduleId, title, options) => {
          appendThreadRecentItem(threadId, { kind: 'plugin', moduleId, actionId: options?.actionId, title });
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
        threadId={threadId}
        path={closable.path}
        openerKey={closable.openerKey}
        projectId={projectId}
        storage={closable.kind === 'storage-preview'}
      />
    );
  } else if (closable?.kind === 'browser') {
    panelBody = null;
  } else if (closable?.kind === 'terminal' && closable.sessionId && projectId) {
    panelBody = <ThreadTerminalTab sessionId={closable.sessionId} projectId={projectId} />;
  } else if (closable?.kind === 'explorer') {
    panelBody = <ThreadExplorerTab projectId={projectId} />;
  } else if (closable?.kind === 'plugin' && closable.moduleId) {
    panelBody = (
      <ThreadPluginTab
        moduleId={closable.moduleId}
        projectId={projectId}
        threadId={threadId}
        actionId={closable.actionId}
        params={closable.params}
        layout={closable.layout}
      />
    );
  } else if (pin === 'diff') {
    panelBody = <p className="thread-detail-empty">No environment is attached to this agent.</p>;
  }

  const secondaryPanelNode: ReactNode = panel.state.isOpen ? (
        <ThreadSecondaryPanel
          state={panel.state}
          showDiffPin={Boolean(environmentId)}
          showPlanPin={showPlanPin}
          onSelectInfo={() => panel.selectPin('info')}
          onSelectDiff={() => panel.selectPin('diff')}
          onSelectPlan={() => panel.selectPin('plan')}
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
            canShowNativeBrowserView={panel.state.isOpen && !modal && (hostedSecondary || pane?.isFocused !== false)}
            threadId={threadId}
            onUpdate={({ tabId, url, title: nextTitle }) => {
              const resolvedTitle = nextTitle && nextTitle.length > 0 ? nextTitle : getBrowserUrlHost(url) || 'Browser';
              panel.patchTab(tabId, { url, title: resolvedTitle });
              if (url) appendThreadRecentItem(threadId, { kind: 'browser', url, title: resolvedTitle });
            }}
            onStopAutomation={(targetId) => {
              void getDesktopBrowserApi()?.stopAutomation?.(targetId);
              const tab = panel.state.tabs.find((row) => row.automationTargetId === targetId);
              if (tab) panel.patchTab(tab.id, { automationTargetId: null });
            }}
          />
        </ThreadSecondaryPanel>
  ) : null;

  usePaneSecondaryPanelRegistration(
    hostedSecondary
      ? {
          contentKey: threadId,
          isOpen: panel.state.isOpen,
          panel: secondaryPanelNode,
          onToggle: () => {
            if (panel.state.isOpen) panel.close();
            else panel.open();
          }
        }
      : null
  );

  const awaitingUser = pendingInteractions.length > 0 || timelineRowsAwaitUser(rows);
  const inFlightRetry = timelineHasInFlightRetry(rows);

  const exitPlanMode = useCallback(() => {
    if (!threadId || planExitPending) return;
    setPlanExitPending(true);
    void product.threads.cancelPlan(threadId).catch(() => undefined).finally(() => {
      setPlanExitPending(false);
    });
  }, [planExitPending, threadId]);

  const runThreadSearch = useCallback((needle: string) => {
    setSearchQuery(needle);
    if (!needle) {
      setSearchHit(null);
      return;
    }
    const viewRows = buildTimelineViewRows(displayRows);
    void product.threads.conversationOutline(threadId).then((outline) => {
      setSearchHit(findDeepestTimelineSearchHit(viewRows, needle, outline.items));
    }).catch(() => {
      setSearchHit(findDeepestTimelineSearchHit(viewRows, needle));
    });
  }, [displayRows, threadId]);

  return (
    <section
      className={viewClass}
      data-testid="thread-detail"
      data-embedded={embedded ? 'true' : undefined}
      style={panelOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="thread-detail-split">
      <div className="thread-detail-main">
        <header className="thread-detail-header">
          <ThreadDetailHeading
            title={title}
            draggable={Boolean(pane?.beginPaneDrag)}
            onPointerDown={
              pane?.beginPaneDrag
                ? (event) => pane.beginPaneDrag?.(event, title)
                : undefined
            }
            overflow={
              <ThreadDetailOverflow
                threadId={threadId}
                title={title}
                status={status}
                inFlightRetry={inFlightRetry}
                projectId={projectId}
                onRenamed={setTitle}
                onUnread={() => setLastReadSeq(0)}
              />
            }
          />
          <div className="thread-detail-actions">
            <ThreadDetailSearch
              value={searchDraft}
              onChange={setSearchDraft}
              onSubmit={runThreadSearch}
            />
            <ThreadStatusBadge status={status} waitingOnUser={awaitingUser} thinking={thinking} />
            <PluginThreadHeaderActions threadId={threadId} projectId={projectId} />
            {pane?.onToggleMaximize ? (
              <button
                type="button"
                className="icon-btn"
                title={pane.isMaximized ? 'Restore pane' : 'Maximize pane'}
                aria-label={pane.isMaximized ? 'Restore pane' : 'Maximize pane'}
                data-testid="split-pane-maximize"
                onClick={pane.onToggleMaximize}
              >
                {pane.isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            ) : null}
            {pane?.onRequestClose ? (
              <button
                type="button"
                className="icon-btn"
                title="Close pane"
                aria-label="Close pane"
                data-testid="split-pane-close"
                onClick={pane.onRequestClose}
              >
                <X size={14} />
              </button>
            ) : null}
            {!panel.state.isOpen ? (
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
        <div className="thread-detail-body">
          <div className="thread-detail-column">
            <ThreadTimeline
              threadId={threadId}
              rows={displayRows}
              status={status}
              waitingOnUser={awaitingUser}
              thinking={thinking}
              goal={goal}
              activeWorkflows={workflows}
              lastReadSeq={lastReadSeq}
              onReachedBottom={markRead}
              onCopy={(text) => {
                void copyText(text);
              }}
              onTitleAction={(action) => {
                if (action.kind === 'open-file-diff') openDiff(action.path);
                if (action.kind === 'open-file-preview') dispatchThreadOpenFile(threadId, action.path);
              }}
              onTitleLink={(link) => {
                if (link.kind === 'thread') {
                  const nextProjectId = route.isProjectWorkspace ? route.focusedProjectId : projectId;
                  if (pane?.isSplitPane) {
                    pane.navigateInPane(link.threadId, nextProjectId ?? null);
                    return;
                  }
                  navigate(getThreadRoutePath(link.threadId, nextProjectId));
                }
              }}
              onOpenDiff={(path) => openDiff(path)}
              projectId={projectId}
              parentThreadId={parentThreadId}
              forceExpandedRowIds={forceExpandedRowIds}
              searchHitRowId={searchHit?.id ?? null}
              onFork={(sourceSeqEnd) => {
                void product.threads.fork(threadId, sourceSeqEnd != null ? { sourceSeqEnd } : undefined).then((forked) => {
                  if (forked.ok && forked.value?.id) {
                    navigate(getThreadRoutePath(
                      forked.value.id,
                      route.isProjectWorkspace ? route.focusedProjectId : projectId ?? undefined
                    ));
                  }
                });
              }}
            />
            <ThreadWorkspaceBanner
              environmentId={environmentId}
              onOpenDiff={(path) => openDiff(path)}
            />
            <div className="thread-composer-dock">
              <PromptContextBanner
                branchName={branchName}
                isWorktree={isWorktree}
                parentThreadId={parentThreadId}
                childCount={childThreads.length}
                environmentId={environmentId}
                onReview={() => openDiff()}
              />
              <QueuedMessagesCard threadId={threadId} />
              <ModelFallbackCard fallback={modelFallback} />
              <BackgroundCommandsCard commands={backgroundCommands} />
              <ChildThreadPendingBanners childThreads={childThreads} projectId={projectId} />
              {pendingInteractions.map((interaction) => (
                <ThreadPendingInteractionBanner
                  key={interaction.id}
                  interaction={interaction}
                  threadId={threadId}
                />
              ))}
              <ThreadPromptModeCard
                mode={promptMode}
                isExpanded={planExpanded}
                isExitPending={planExitPending}
                onToggle={() => {
                  setPlanExpanded((value) => !value);
                  if (showPlanPin) panel.selectPin('plan');
                }}
                onExitPlanMode={exitPlanMode}
              />
              <ThreadTodoCard
                todos={todos}
                isExpanded={todoExpanded}
                onToggle={() => setTodoExpanded((value) => !value)}
              />
              <ThreadCommandComposer
                threadId={threadId}
                project={project ?? undefined}
                autoFocus={!embedded && pane?.isFocused !== false && pendingInteractions.length === 0}
                status={status}
                inFlightRetry={inFlightRetry}
                sendBlocked={pendingInteractions.length > 0}
                environmentLabel={
                  composerRemoteToolsMark(project ?? undefined, threads.find((row) => row.id === threadId)?.hostId)
                    ?? (isWorktree ? 'This checkout' : 'Local')
                }
                contextWindowUsage={contextWindow}
                providerId={threadProviderId ?? undefined}
                model={threadModel}
                reasoningLevel={threadReasoning}
              />
            </div>
          </div>
        </div>
      </div>
      {hostedSecondary ? null : secondaryPanelNode}
      </div>
    </section>
  );
}
