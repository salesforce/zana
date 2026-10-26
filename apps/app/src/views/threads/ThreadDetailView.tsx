import { subscribeProductReconnect } from '../../lib/product-ws.js';
import { ArchivedThreadBanner } from '../../components/history/ArchivedThreadBanner.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PanelBottom, PanelRight } from 'lucide-react';
import type { ActiveThinking, ThreadTimelineGoal, ThreadTimelineModelFallback, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import { mergeTimelinePages, type ThreadContextWindowUsage, type TimelineRow } from '@zana-ai/zcc-server-contract';
import { type TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { product } from '../../lib/product-client.js';
import { ThreadCommandComposer } from '../../components/ThreadCommandComposer.js';
import { useMobileThreadActionsTarget, useMobileThreadControlsTarget, useMobileThreadTitleTarget } from '../../components/useMobileThreadTitleTarget.js';
import { ThreadTimeline } from '../../components/thread/ThreadTimeline.js';
import { ThreadDiffPanel } from '../../components/thread/ThreadDiffPanel.js';
import { ThreadWorkspaceBanner } from '../../components/thread/ThreadWorkspaceBanner.js';
import {
  composerVisibleTodos,
  timelineHasInFlightRetry,
  timelineRowsAwaitUser
} from '../../components/thread/thread-timeline-model.js';
import { ThreadDetailActions, ThreadDetailHeading, ThreadPromptModeCard, ThreadStatusBadge, ThreadTodoCard } from '../../components/thread/timeline/ThreadBanners.js';
import {
  BackgroundCommandsCard,
  ModelFallbackCard,
  PromptContextBanner,
  QueuedMessagesCard
} from '../../components/thread/timeline/ComposerStackCards.js';
import { ThreadDetailOverflow } from '../../components/thread/ThreadDetailOverflow.js';
import { DetachedThread, useThreadDetached } from '../../components/thread/DetachedThread.js';
import { ThreadDetailSearch } from '../../components/thread/ThreadDetailSearch.js';
import { createCoalescedRunner } from '../../lib/coalesced-runner.js';
import { createThreadRefreshScheduler } from './thread-detail-refresh.js';
import { getThreadRoutePath } from '../../lib/route-paths.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { useCompactLayout } from '../../hooks/useCompactLayout.js';
import { useHosts } from '../../hooks/useHosts.js';
import { sessionLocation } from '../../lib/session-location.js';
import { pendingChildThreads, useThreads, type ThreadListItem } from '../../thread-store.js';
import { useData } from '../../store.js';
import { useThreadFindTarget } from '../../lib/use-thread-find-target.js';
import { ThreadPendingInteractionBanner } from '../../components/thread/pending-interactions/ThreadPendingInteractionBanner.js';
import { pendingInteractionSendBlockedHint } from '../../components/thread/pending-interactions/pending-interaction-formatting.js';
import { ChildThreadPendingBanners } from '../../components/thread/pending-interactions/ChildThreadPendingBanners.js';
import {
  isOpenThreadEvent,
  useOpenPendingInteractions
} from '../../components/thread/pending-interactions/useOpenPendingInteractions.js';
import { ThreadSecondaryPanel, type ThreadPanelToolKind } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { useOptionalPaneContext, usePaneSecondaryPanelRegistration } from '../thread-detail/PaneContext.js';
import { SplitPaneHeaderActions } from '../thread-detail/SplitPaneHeaderActions.js';
import { ThreadInfoContent } from '../../components/thread/secondary-panel/ThreadInfoContent.js';
import { ThreadPlanPanel, type DurablePlanPanelView } from '../../components/thread/secondary-panel/ThreadPlanPanel.js';
import { planFileTabTitle, resolveThreadPlanDocument, isLivePlanFilePath } from '../../components/thread/secondary-panel/thread-plan-document.js';
import { timelinePlanExecution } from '../../components/thread/timeline/plan-execution-card.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { ThreadFilePreviewTab } from '../../components/thread/secondary-panel/ThreadFilePreviewTab.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { ThreadTerminalTab } from '../../components/thread/secondary-panel/ThreadTerminalTab.js';
import { DockedTerminalTab } from '../../components/thread/secondary-panel/DockedTerminalTab.js';
import { useThreadToolDock } from '../../components/thread/secondary-panel/useThreadToolDock.js';
import { clampDockHeight, isDockPinnedView, resolveToolDock, type ToolDockSide } from '../../components/thread/secondary-panel/threadToolDock.js';
import '../../components/thread/secondary-panel/thread-tool-dock.css';
import { ThreadPluginTab } from '../../components/thread/secondary-panel/ThreadPluginTab.js';
import { ThreadExplorerTab } from '../../components/thread/secondary-panel/ThreadExplorerTab.js';
import { ThreadInboxTab } from '../../components/thread/secondary-panel/ThreadInboxTab.js';
import { PluginThreadHeaderActions } from '../../plugins/PluginThreadHeaderActions.js';
import { ThreadPanelOwnerProvider } from '../../plugins/thread-panel-owner.js';
import type { ThreadChatMessageAction } from '@zana-ai/zcc-plugin-sdk/app';
import { copyText } from '../../components/thread/secondary-panel/threadSecondaryPanelLogic.js';
import { useThreadSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import { useInAppBrowserPanel } from '../../components/thread/secondary-panel/useInAppBrowserPanel.js';
import { useDesktopBrowserReveal } from '../../lib/use-desktop-browser-reveal.js';
import {
  dispatchThreadOpenFile,
  useThreadOpenFileSignal
} from '../../components/thread/secondary-panel/useThreadOpenFileSignal.js';
import { useThreadOpenTerminalSignal } from '../../components/thread/secondary-panel/useThreadOpenTerminalSignal.js';
import { appendThreadRecentItem, tabInputFromRecentItem } from '../../components/thread/secondary-panel/threadRecentItems.js';
import {
  activeClosableTab,
  activePinnedView,
  uniqueTabSuffix,
  type ThreadSecondaryPanelState
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
  findTimelineMessageAtSequence,
  type TimelineSearchHit
} from '../../components/thread/timeline/thread-search.js';
import { useThreadSearch } from './useThreadSearch.js';
import {
  loadThreadDetailProgressively,
  resolveThreadDetailStatus,
  resolveTimelinePollRows,
  shouldClearPlaceholderStartingStatus,
  threadDetailLoadError
} from './thread-detail-load.js';

const TIMELINE_SEGMENT_LIMIT = 20;

export function ThreadDetailView() {
  const { threadId } = useParams<{ threadId: string }>();
  if (!threadId) return null;
  return <ThreadDetail key={threadId} threadId={threadId} />;
}

type ThreadDetailProps = Parameters<typeof ThreadDetailBody>[0];

/**
 * A thread open in its own window runs only there; every other host shows a
 * placeholder, so one window owns its timeline and side panel.
 */
export function ThreadDetail(props: ThreadDetailProps) {
  const detached = useThreadDetached(props.threadId);
  const projectId = useThreads((s) => s.threads.find((row) => row.id === props.threadId)?.projectId ?? null);
  if (detached) return <DetachedThread threadId={props.threadId} projectId={projectId} />;
  return <ThreadDetailBody {...props} />;
}

function ThreadDetailBody({
  threadId,
  timelineEnabled = true,
  embedded = false,
  showSecondaryPanel = !embedded,
  mobileTitleInShell = false,
  modal = false,
  leadingContent,
  messageActions,
  includePluginMessageActions = true
}: {
  threadId: string;
  timelineEnabled?: boolean;
  embedded?: boolean;
  /**
   * Render the right-hand secondary panel and its "Show right panel" toggle.
   * Defaults to off when `embedded` (plugin-hosted chats are too narrow);
   * hosts with room for it, like the Agents List view, opt back in.
   */
  showSecondaryPanel?: boolean;
  /** A focused mobile list detail shares the shell header while retaining its list. */
  mobileTitleInShell?: boolean;
  /** Hosted in the thread inspector modal; dialog close/fullscreen live on the modal header. */
  modal?: boolean;
  leadingContent?: ReactNode;
  messageActions?: readonly ThreadChatMessageAction[];
  includePluginMessageActions?: boolean;
}) {
  const navigate = useNavigate();
  const route = useRouteState();
  const upsertThread = useThreads((s) => s.upsert);
  const childThreads = useThreads(useShallow(({ threads }) => pendingChildThreads(threads, threadId)));
  const pendingInteractions = useOpenPendingInteractions(threadId);
  const pane = useOptionalPaneContext();
  const mobileHeaderInShell = !modal && pane?.isFocused !== false
    && (mobileTitleInShell || (!embedded && route.threadId === threadId));
  const mobileTitleTarget = useMobileThreadTitleTarget(mobileHeaderInShell);
  const mobileActionsTarget = useMobileThreadActionsTarget(mobileHeaderInShell);
  const mobileControlsTarget = useMobileThreadControlsTarget(mobileHeaderInShell);
  const compact = useCompactLayout();
  const hostedSecondary = pane?.secondaryPanelHost != null;
  const viewRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const panel = useThreadSecondaryPanel(threadId, {
    modal,
    getContainerWidthPx: () => viewRef.current?.clientWidth ?? 0
  });
  const dockEnabled = useData(s => s.dockableThreadToolsEnabled) === true && !compact && showSecondaryPanel;
  const toolDock = useThreadToolDock(threadId, panel.state, dockEnabled);
  const [draggedTool, setDraggedTool] = useState<string | null>(null);
  useEffect(() => { setDraggedTool(null); }, [threadId, dockEnabled]);
  const moveTool = (id: string, side: ToolDockSide) => {
    toolDock.move(id, side);
    if (side === 'right') {
      if (isDockPinnedView(id)) panel.selectPin(id);
      else panel.activateTab(id);
    }
    setDraggedTool(null);
  };
  const activateTool = (id: string) => {
    if (dockEnabled && toolDock.dock.bottomIds.includes(id)) {
      toolDock.update(current => ({ ...current, bottomActiveId: id, collapsed: false }));
    } else if (dockEnabled) {
      toolDock.update(current => ({ ...current, rightActiveId: id }));
    }
    if (isDockPinnedView(id)) panel.selectPin(id);
    else panel.activateTab(id);
  };
  const addDockTab = (side: ToolDockSide) => {
    const id = `new-tab:${uniqueTabSuffix(globalThis.crypto?.randomUUID?.bind(globalThis.crypto))}`;
    if (side === 'bottom') toolDock.update(current => ({ ...current, bottomIds: [...current.bottomIds, id], bottomActiveId: id, collapsed: false }));
    panel.addTab({ id, kind: 'new-tab', title: 'New Tab' });
  };
  const dockProps = (side: ToolDockSide) => dockEnabled ? {
    side,
    dragging: Boolean(draggedTool),
    onMove: (id: string) => moveTool(id, side === 'right' ? 'bottom' : 'right'),
    onDragStart: (event: import('react').DragEvent, id: string) => {
      event.dataTransfer.setData('application/x-zcc-thread-tool', id);
      event.dataTransfer.effectAllowed = 'move';
      setDraggedTool(id);
    },
    onDragEnd: () => setDraggedTool(null),
    onDragOver: (event: import('react').DragEvent) => { if (draggedTool) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } },
    onDrop: (event: import('react').DragEvent) => { if (draggedTool) { event.preventDefault(); moveTool(draggedTool, side); } },
    ...(side === 'bottom' ? {
      collapsed: toolDock.dock.collapsed,
      onToggleCollapsed: () => toolDock.update(current => ({ ...current, collapsed: !current.collapsed, maximized: false })),
      heightPx: toolDock.dock.heightPx,
      onHeight: (height: number) => toolDock.update(current => ({ ...current, heightPx: clampDockHeight(height) }))
    } : {})
  } : undefined;
  useInAppBrowserPanel(threadId, panel);
  useDesktopBrowserReveal({
    threadId,
    isFocused: pane?.isFocused !== false,
    browserTabs: panel.state.tabs.filter((tab) => tab.kind === 'browser'),
    activateTab: activateTool,
    addTab: (tab) => panel.addTab(tab)
  });
  const [title, setTitle] = useState('Agent');
  const [status, setStatus] = useState('starting');
  const [cwd, setCwd] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const project = useData((s) => (projectId ? s.projects.find((row) => row.id === projectId) ?? null : null));
  const [hostId, setHostId] = useState<string | undefined>();
  const hosts = useHosts();
  const executionLocation = sessionLocation(hostId, project ?? undefined, hosts);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [isWorktree, setIsWorktree] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [archivedAt, setArchivedAt] = useState<number | null>(null);
  const [threadProviderId, setThreadProviderId] = useState<string | null>(null);
  const [threadModel, setThreadModel] = useState<string | null>(null);
  const [threadReasoning, setThreadReasoning] = useState<string | null>(null);
  const [threadServiceTier, setThreadServiceTier] = useState<string | null>(null);
  const [threadAcpMode, setThreadAcpMode] = useState<string | null>(null);
  const [threadPermissionMode, setThreadPermissionMode] = useState<{ threadId: string; mode: string | null } | null>(null);
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [olderCursor, setOlderCursor] = useState<{ anchorSeq: number; anchorId: string } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderCursorRef = useRef(olderCursor);
  const loadedOlderRef = useRef(false);
  const historyGeneration = useRef(0);
  const [thinking, setThinking] = useState<ActiveThinking | null>(null);
  const [todos, setTodos] = useState<ThreadTimelinePendingTodos | null>(null);
  const [goal, setGoal] = useState<ThreadTimelineGoal | null>(null);
  const [workflows, setWorkflows] = useState<TimelineViewWorkflowWorkRow[]>([]);
  const [backgroundCommands, setBackgroundCommands] = useState<TimelineViewWorkflowWorkRow[]>([]);
  const [modelFallback, setModelFallback] = useState<ThreadTimelineModelFallback | null>(null);
  const [parentThreadId, setParentThreadId] = useState<string | null>(null);
  const [originKind, setOriginKind] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<{ mode: string; prompt?: string } | null>(null);
  const [executionModeRequested, setExecutionModeRequested] = useState<string | null>(null);
  const [durablePlan, setDurablePlan] = useState<(DurablePlanPanelView & { filePath?: string | null }) | null>(null);
  const [contextWindow, setContextWindow] = useState<ThreadContextWindowUsage | null>(null);
  const [lastReadSeq, setLastReadSeq] = useState<number | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [todoExpanded, setTodoExpanded] = useState(false);
  const inFlightRetry = timelineHasInFlightRetry(rows);
  const [planExitPending, setPlanExitPending] = useState(false);
  const [planAction, setPlanAction] = useState<{ id: number; threadId: string; kind: 'revise' | 'implement'; revision: number } | null>(null);
  const [planActionPending, setPlanActionPending] = useState(false);
  const [optimisticRow, setOptimisticRow] = useState<TimelineRow | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [stoppingAnchorAt, setStoppingAnchorAt] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchFocusRequest = useThreadFindTarget({
    viewRef,
    mainRef,
    embedded,
    modal,
    paneFocused: pane?.isFocused !== false,
    onOpenCollapsed: mobileControlsTarget ? () => setMobileSearchOpen(true) : undefined
  });
  const [linkParams] = useSearchParams();
  const linkSequence = Number(linkParams.get('message'));
  const linkLoads = useRef(0);
  const lastLinkCursor = useRef<string | null>(null);
  const [searchHit, setSearchHit] = useState<TimelineSearchHit | null>(null);
  // A find-in-thread search ends the message link's highlight until the link changes.
  const linkDismissed = useRef(false);
  useEffect(() => { linkLoads.current = 0; lastLinkCursor.current = null; linkDismissed.current = false; setSearchHit(null); }, [threadId, linkSequence]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rowsRef = useRef<TimelineRow[]>([]);
  const maxSeqRef = useRef(0);
  const loadedRef = useRef(false);
  const loadedThreadRef = useRef<string | null>(null);
  const olderLoadRef = useRef<AbortController | null>(null);
  const hadThreadRecordRef = useRef(false);
  const runLoadRef = useRef<() => void>(() => {});
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
  useThreadOpenTerminalSignal({
    threadId,
    environmentId,
    projectId,
    cwd,
    panel
  });

  const displayRows = useMemo(() => {
    const withOptimistic = mergeOptimisticTimelineRows(rows, optimisticRow);
    return mergePendingStopRow(withOptimistic, { threadId, isStopping, stoppingAnchorAt });
  }, [isStopping, optimisticRow, rows, stoppingAnchorAt, threadId]);


  useEffect(() => {
    const onOptimistic = (event: Event) => {
      const detail = (event as CustomEvent<{
        threadId?: string;
        text?: string | null;
        imagePaths?: string[];
      }>).detail;
      if (detail?.threadId !== threadId) return;
      const imagePaths = detail.imagePaths ?? [];
      if (detail.text == null && imagePaths.length === 0) {
        setOptimisticRow(null);
        return;
      }
      setOptimisticRow(buildOptimisticUserTimelineRow({
        threadId,
        text: detail.text ?? '',
        localImagePaths: imagePaths
      }));
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
    if (!threadId || !timelineEnabled) return;
    let cancelled = false;
    let activeLoad: AbortController | null = null;
    // Visibility changes keep the loaded page and cursor. Reveal catches up
    // through the same delta path; only a different thread resets its history.
    if (loadedThreadRef.current !== threadId) {
      loadedThreadRef.current = threadId;
      rowsRef.current = [];
      maxSeqRef.current = 0;
      loadedRef.current = false;
      historyGeneration.current++;
      loadedOlderRef.current = false;
      olderCursorRef.current = null;
      setOlderCursor(null);
      setLoadingOlder(false);
      hadThreadRecordRef.current = false;
      setTimelineLoading(true);
      setLoadError(null);
      setArchivedAt(null);
      setExecutionModeRequested(null);
    }

    const applyTimeline = (
      timeline: Awaited<ReturnType<typeof product.threads.timeline>>,
      nextRows: TimelineRow[]
    ) => {
      const nextTip = typeof timeline.maxSeq === 'number' ? timeline.maxSeq : 0;
      if (nextTip < maxSeqRef.current) loadedOlderRef.current = false;
      if (loadedOlderRef.current) {
        const floor = Math.min(...nextRows.map(row => row.sourceSeqStart));
        nextRows = mergeTimelinePages(rowsRef.current.filter(row => row.sourceSeqStart < floor), nextRows);
      } else {
        olderCursorRef.current = timeline.timelinePage?.hasOlderRows ? timeline.timelinePage.olderCursor : null;
        setOlderCursor(olderCursorRef.current);
      }
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
      const execution = timeline.executionMode as { requested?: string | null } | null | undefined;
      setExecutionModeRequested(execution?.requested ?? null);
      setDurablePlan((timeline.durablePlan as (DurablePlanPanelView & { filePath?: string | null }) | null) ?? null);
      setContextWindow((timeline.contextWindowUsage as ThreadContextWindowUsage | null) ?? null);
      setLastReadSeq(typeof timeline.lastReadSeq === 'number' ? timeline.lastReadSeq : null);
      return nextRows;
    };

    const loadTimeline = async (forceFull: boolean, signal: AbortSignal): Promise<{
      timeline: Awaited<ReturnType<typeof product.threads.timeline>>;
      nextRows: TimelineRow[];
    }> => {
      const useDelta = !forceFull && loadedRef.current;
      const timeline = await product.threads.timeline(threadId, {
        segmentLimit: TIMELINE_SEGMENT_LIMIT,
        afterSequence: useDelta ? String(maxSeqRef.current) : undefined,
        includeNestedRows: 'false',
        summaryOnly: 'true'
      }, { signal });
      const resolved = resolveTimelinePollRows({
        prevRows: rowsRef.current,
        prevMaxSeq: maxSeqRef.current,
        useDelta,
        timeline
      });
      if (resolved.kind === 'stale') return loadTimeline(true, signal);
      return { timeline, nextRows: resolved.rows };
    };

    const applyThreadRecord = (
      detail: Awaited<ReturnType<typeof product.threads.get>>,
      timeline: Awaited<ReturnType<typeof product.threads.timeline>> | null
    ) => {
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
        acpMode?: string | null;
        serviceTier?: string | null;
        permissionMode?: string | null;
        parentThreadId?: string | null;
        visibility?: ThreadListItem['visibility'];
        originKind?: unknown;
        hasPendingInteraction?: boolean;
        updatedAt?: number;
        runtime?: ThreadListItem['runtime'] & { displayStatus?: string };
      };
      const nextStatus = resolveThreadDetailStatus(thread, timeline?.status);
      setTitle(thread.title?.trim() || 'Agent');
      if (nextStatus) setStatus(nextStatus);
      setCwd(typeof thread.cwd === 'string' ? thread.cwd : null);
      setProjectId(typeof thread.projectId === 'string' ? thread.projectId : null);
      setHostId(thread.hostId);
      setEnvironmentId(typeof thread.environmentId === 'string' ? thread.environmentId : null);
      setIsWorktree(thread.isWorktree ?? false);
      setBranchName(thread.branchName ?? null);
      setArchivedAt(thread.archivedAt ?? null);
      setThreadProviderId(typeof thread.providerId === 'string' ? thread.providerId : null);
      setThreadModel(typeof thread.model === 'string' ? thread.model : null);
      setThreadReasoning(typeof thread.reasoningLevel === 'string' ? thread.reasoningLevel : null);
      setThreadServiceTier(typeof thread.serviceTier === 'string' ? thread.serviceTier : null);
      setThreadAcpMode(typeof thread.acpMode === 'string' ? thread.acpMode : null);
      setThreadPermissionMode({ threadId, mode: typeof thread.permissionMode === 'string' ? thread.permissionMode : null });
      setParentThreadId(thread.parentThreadId ?? null);
      setOriginKind(typeof thread.originKind === 'string' ? thread.originKind : null);
      hadThreadRecordRef.current = true;
      if (thread.id) {
        const existing = useThreads.getState().threads.find((row) => row.id === thread.id);
        upsertThread({
          id: thread.id,
          projectId: thread.projectId ?? '',
          hostId: thread.hostId ?? '',
          environmentId: thread.environmentId ?? null,
          providerId: thread.providerId ?? '',
          status: nextStatus || thread.status || 'starting',
          title: thread.title ?? null,
          createdAt: thread.createdAt ?? Date.now(),
          cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
          branchName: thread.branchName ?? null,
          isWorktree: thread.isWorktree ?? false,
          archivedAt: thread.archivedAt ?? null,
          parentThreadId: thread.parentThreadId ?? null,
          visibility: thread.visibility,
          hasPendingInteraction: Boolean(thread.hasPendingInteraction),
          lastReadSeq: typeof timeline?.lastReadSeq === 'number' ? timeline.lastReadSeq : existing?.lastReadSeq ?? null,
          maxSeq: typeof timeline?.maxSeq === 'number' ? timeline.maxSeq : existing?.maxSeq ?? 0,
          updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt : undefined,
          runtime: thread.runtime
        });
      }
    };

    const runner = createCoalescedRunner(async () => {
      const request = new AbortController();
      activeLoad = request;
      const [detailOutcome, timelineOutcome] = await loadThreadDetailProgressively(
        product.threads.get(threadId, { signal: request.signal }),
        loadTimeline(false, request.signal),
        {
          onDetail: (detail, result) => {
            if (!cancelled && !request.signal.aborted) applyThreadRecord(detail, result?.timeline ?? null);
          },
          onTimeline: (result, detail) => {
            if (cancelled || request.signal.aborted) return;
            setTimelineLoading(false);
            applyTimeline(result.timeline, result.nextRows);
            if (detail) {
              applyThreadRecord(detail, result.timeline);
            } else if (result.timeline.status) {
              setStatus(result.timeline.status);
            }
          },
          onTimelineError: (error) => {
            if (cancelled || request.signal.aborted) return;
            setTimelineLoading(false);
            setLoadError(threadDetailLoadError(error));
          }
        }
      );
      activeLoad = null;
      if (cancelled || request.signal.aborted) return;
      const detailFailed = detailOutcome.status === 'rejected';
      const timelineFailed = timelineOutcome.status === 'rejected';
      if (detailFailed || timelineFailed) {
        const reason = timelineFailed
          ? (timelineOutcome as PromiseRejectedResult).reason
          : (detailOutcome as PromiseRejectedResult).reason;
        setLoadError(threadDetailLoadError(reason));
        if (shouldClearPlaceholderStartingStatus(hadThreadRecordRef.current, detailFailed, timelineFailed)) {
          setStatus('');
        }
      } else {
        setLoadError(null);
      }
    });
    runLoadRef.current = () => {
      // Background refreshes keep the last failure visible until recovery.
      // Only an explicit retry replaces it with the loading state.
      if (!loadedRef.current) {
        setTimelineLoading(true);
        setLoadError(null);
      }
      activeLoad?.abort();
      runner.run();
    };
    const refreshScheduler = createThreadRefreshScheduler(runner.run);
    const scheduleDelta = refreshScheduler.schedule;
    runner.run();
    const stopReconnect = subscribeProductReconnect(scheduleDelta);
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
      historyGeneration.current++;
      cancelled = true;
      activeLoad?.abort();
      olderLoadRef.current?.abort();
      olderLoadRef.current = null;
      setLoadingOlder(false);
      runLoadRef.current = () => {};
      runner.dispose();
      refreshScheduler.dispose();
      stopUpdated();
      stopEvents();
      stopReconnect();
    };
  }, [threadId, upsertThread, timelineEnabled]);

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
    if (dockEnabled) toolDock.update(current => current.bottomIds.includes('diff')
      ? { ...current, bottomActiveId: 'diff', collapsed: false }
      : { ...current, rightActiveId: 'diff' });
    panel.selectPin('diff');
  }, [panel, dockEnabled, toolDock.update]);

  const appendDockTool = useCallback((side: ToolDockSide, input: { kind: 'terminal' | 'browser' | 'explorer'; title: string; sessionId?: string; url?: string }) => {
    const id = `${input.kind}:${uniqueTabSuffix(globalThis.crypto?.randomUUID?.bind(globalThis.crypto))}`;
    toolDock.update(current => side === 'bottom'
      ? { ...current, bottomIds: [...current.bottomIds, id], bottomActiveId: id, collapsed: false }
      : { ...current, rightActiveId: id });
    // Direct additions append to their chosen dock, even if the other dock has
    // a selected launcher. Only launches from that launcher consume its slot.
    panel.selectPin('info');
    panel.addTab({ ...input, id });
  }, [panel, toolDock.update]);

  const startPanelTerminal = useCallback(async (command: string | null = null, side?: ToolDockSide) => {
    if (!projectId) throw new Error('The thread project is still loading.');
    const created = await product.terminals.create({
      projectId,
      profile: 'shell',
      hostId,
      workspace: environmentId ? { kind: 'reuse', environmentId } : undefined,
      cwd: cwd ?? undefined,
      cols: 80,
      rows: 24,
      prompt: command ?? undefined,
      title: command?.slice(0, 200) ?? 'Terminal'
    });
    if (!created.ok) throw new Error(created.message ?? 'Could not open terminal');
    const tab = { kind: 'terminal' as const, title: created.value.title, sessionId: created.value.id };
    if (side) appendDockTool(side, tab);
    else panel.addTab(tab);
  }, [cwd, panel, projectId, hostId, environmentId, appendDockTool]);

  const addTool = (side: ToolDockSide, kind: ThreadPanelToolKind) => {
    if (kind === 'terminal') void startPanelTerminal(null, side).catch(error => setLoadError(threadDetailLoadError(error)));
    else appendDockTool(side, kind === 'browser' ? { kind, title: 'Browser', url: '' } : { kind, title: 'Explorer' });
  };

  const panelOpen = hostedSecondary || !showSecondaryPanel ? false : panel.state.isOpen;
  const bounded = embedded || pane?.isBoundedPane === true;
  const planDocument = resolveThreadPlanDocument({
    promptMode,
    pendingInteractions,
    durablePlan
  });
  const dockPanels = resolveToolDock(toolDock.dock, panel.state, [
    'info', ...(environmentId ? ['diff' as const] : []), ...(planDocument ? ['plan' as const] : [])
  ]);

  const viewClass = [
    'thread-detail-view',
    bounded ? 'thread-detail-view--embedded' : '',
    dockEnabled ? 'has-tool-dock' : '',
    modal ? 'thread-detail-view--modal' : '',
    pane?.isSplitPane ? 'thread-detail-view--split-pane' : '',
    pane?.isFocused === false ? 'is-pane-inactive' : '',
    panelOpen ? 'is-secondary-open' : '',
    !hostedSecondary && showSecondaryPanel && panel.state.isMaximized ? 'is-secondary-maximized' : ''
  ].filter(Boolean).join(' ');

  const renderPanelBody = (state: ThreadSecondaryPanelState) => {
  const pin = activePinnedView(state);
  const closable = activeClosableTab(state);
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
  } else if (pin === 'diff' && environmentId) {
    panelBody = (
      <ThreadDiffPanel
        environmentId={environmentId}
        path={diffPath}
        embedded
        onClose={() => activateTool('info')}
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
        onOpenInbox={() => panel.addTab({ kind: 'inbox', title: 'Inbox' })}
        onStartTerminal={() => { void startPanelTerminal().catch(error => setLoadError(threadDetailLoadError(error))); }}
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
    const livePlan = closable.kind === 'file-preview' && isLivePlanFilePath(closable.path, durablePlan?.filePath)
      ? durablePlan
      : null;
    panelBody = (
      <ThreadFilePreviewTab
        threadId={threadId}
        previewRevision={closable.previewRevision}
        path={closable.path}
        openerKey={closable.openerKey}
        projectId={projectId}
        storage={closable.kind === 'storage-preview'}
        lineNumber={closable.lineNumber ?? null}
        livePlan={livePlan}
        planDocument={livePlan ? {
          markdown: planDocument?.markdown ?? livePlan.markdown,
          filePath: null,
          prompt: null,
          source: 'durable'
        } : null}
        todos={todos}
      />
    );
  } else if (closable?.kind === 'browser') {
    panelBody = null;
  } else if (closable?.kind === 'terminal' && closable.sessionId && projectId) {
    panelBody = dockEnabled ? <DockedTerminalTab sessionId={closable.sessionId} /> : <ThreadTerminalTab sessionId={closable.sessionId} projectId={projectId} />;
  } else if (closable?.kind === 'explorer') {
    panelBody = <ThreadExplorerTab projectId={projectId} scope={projectId && hostId ? { projectId, hostId, ...(environmentId ? { environmentId } : {}) } : undefined} checkoutPath={cwd ?? undefined} />;
  } else if (closable?.kind === 'inbox') {
    panelBody = <ThreadInboxTab projectId={projectId} />;
  } else if (closable?.kind === 'plugin' && closable.moduleId) {
    panelBody = (
      <ThreadPluginTab
        moduleId={closable.moduleId}
        projectId={projectId}
        threadId={threadId}
        actionId={closable.actionId}
        params={closable.params}
        layout={closable.layout}
        surface="thread"
        tabId={closable.id}
      />
    );
  } else if (pin === 'diff') {
    panelBody = <p className="thread-detail-empty">No environment is attached to this agent.</p>;
  } else if (pin === 'plan') {
    const document = planDocument ?? { markdown: null, filePath: null, prompt: null, source: 'empty' as const };
    panelBody = (
      <ThreadPlanPanel
        document={document}
        onRevise={() => setPlanAction({ id: Date.now(), threadId, kind: 'revise', revision: durablePlan?.revision ?? 0 })}
        onImplement={() => setPlanAction({ id: Date.now(), threadId, kind: 'implement', revision: durablePlan?.revision ?? 0 })}
        actionsDisabled={Boolean(archivedAt) || (status !== 'idle' && status !== 'error') || pendingInteractions.length > 0 || inFlightRetry}
        actionPending={planActionPending}
        durablePlan={durablePlan}
        todos={todos}
        onOpenFile={(path) => {
          appendThreadRecentItem(threadId, { kind: 'file', source: 'workspace', path });
          panel.addTab({ kind: 'file-preview', title: planFileTabTitle(path), path });
        }}
      />
    );
  }

  return panelBody;
  };
  const renderToolPanel = (state: ThreadSecondaryPanelState, side: ToolDockSide) => {
    const closable = activeClosableTab(state);
    const pins = dockEnabled ? (side === 'right' ? dockPanels.rightPins : dockPanels.bottomPins) : ['info', 'diff', 'plan'];
    return (
        <ThreadSecondaryPanel
          state={state}
          dock={dockProps(side)}
          showInfoPin={pins.includes('info')}
          showDiffPin={pins.includes('diff') && Boolean(environmentId)}
          showPlanPin={pins.includes('plan') && Boolean(planDocument)}
          onSelectInfo={() => activateTool('info')}
          onSelectDiff={() => activateTool('diff')}
          onSelectPlan={() => activateTool('plan')}
          onNewTab={() => dockEnabled ? addDockTab(side) : panel.openNewTab()}
          onAddTool={dockEnabled ? kind => addTool(side, kind) : undefined}
          canAddBrowser={hasDesktopBridge()}
          onCloseTab={panel.closeTab}
          onActivateTab={activateTool}
          onToggleMaximized={side === 'bottom' ? () => toolDock.update(current => ({ ...current, maximized: !current.maximized, collapsed: false })) : panel.toggleMaximized}
          onHide={panel.close}
          onResize={panel.setWidth}
        >
          {renderPanelBody(state)}
          <BrowserTabDeck
            browserTabs={panel.state.tabs.filter((tab) => tab.kind === 'browser')}
            activeBrowserTabId={closable?.kind === 'browser' ? closable.id : null}
            canShowNativeBrowserView={state.isOpen && !(side === 'bottom' && (toolDock.dock.collapsed || panel.state.isMaximized)) && !draggedTool && (modal || hostedSecondary || pane?.isFocused !== false)}
            threadId={threadId}
            onUpdate={({ tabId, url, title: nextTitle }) => {
              const resolvedTitle = nextTitle && nextTitle.length > 0 ? nextTitle : getBrowserUrlHost(url) || 'Browser';
              panel.patchTab(tabId, { url, title: resolvedTitle });
              if (url) appendThreadRecentItem(threadId, { kind: 'browser', url, title: resolvedTitle });
            }}
            onStopAutomation={(targetId) => {
              void getDesktopBrowserApi()?.releaseControl?.(
                panel.state.tabs.find((row) => row.automationTargetId === targetId)?.id ?? targetId
              );
              void getDesktopBrowserApi()?.stopAutomation?.(targetId);
              const tab = panel.state.tabs.find((row) => row.automationTargetId === targetId);
              if (tab) panel.patchTab(tab.id, { automationTargetId: null });
            }}
          />
        </ThreadSecondaryPanel>
  );
  };
  const secondaryPanelNode: ReactNode = panel.state.isOpen ? renderToolPanel(dockEnabled ? dockPanels.right : panel.state, 'right') : null;

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

  const loadOlderHistory = async () => {
    const cursor = olderCursorRef.current;
    if (!threadId || !timelineEnabled || !cursor || loadingOlder) return;
    const generation = historyGeneration.current;
    const controller = new AbortController();
    olderLoadRef.current = controller;
    setLoadingOlder(true);
    try {
      const body = await product.threads.timeline(threadId, {
        segmentLimit: TIMELINE_SEGMENT_LIMIT, beforeAnchorId: cursor.anchorId, beforeAnchorSeq: cursor.anchorSeq,
        includeNestedRows: 'false', summaryOnly: 'true'
      }, { signal: controller.signal });
      if (generation !== historyGeneration.current || olderCursorRef.current?.anchorId !== cursor.anchorId) return;
      const merged = mergeTimelinePages(body.rows as TimelineRow[], rowsRef.current);
      if (JSON.stringify(merged).length > 32 * 1024 * 1024) {
        setLoadError('This view has reached its history limit. Reload the conversation to return to recent messages.');
        return;
      }
      loadedOlderRef.current = true;
      rowsRef.current = merged;
      setRows(merged);
      olderCursorRef.current = body.timelinePage?.hasOlderRows ? body.timelinePage.olderCursor : null;
      setOlderCursor(olderCursorRef.current);
    } catch (error) {
      if (generation === historyGeneration.current) setLoadError(threadDetailLoadError(error));
    } finally {
      if (olderLoadRef.current === controller) olderLoadRef.current = null;
      if (generation === historyGeneration.current) setLoadingOlder(false);
    }
  };

  const search = useThreadSearch({
    threadId,
    rows: displayRows,
    hasOlder: olderCursor !== null,
    olderCursorKey: olderCursor?.anchorId ?? null,
    loadingOlder,
    loadOlder: () => { void loadOlderHistory(); }
  });
  const searchQuery = search.query;
  const submitSearch = useCallback((needle: string, direction?: 'next' | 'previous') => {
    linkDismissed.current = true;
    setSearchHit(null);
    search.submit(needle, direction);
  }, [search.submit]);
  // The box shows the counter and highlights only for the query it reflects.
  const searchActive = searchQuery !== '' && searchDraft.trim() === searchQuery;
  const timelineTarget = searchQuery ? (searchActive ? search.current : null) : searchHit;
  const forceExpandedRowIds = useMemo(() => {
    if (!timelineTarget) return undefined;
    return new Set([...timelineTarget.ancestorIds, timelineTarget.id]);
  }, [timelineTarget]);

  useEffect(() => {
    if (!timelineEnabled) return;
    if (!Number.isSafeInteger(linkSequence) || linkSequence <= 0 || searchQuery || linkDismissed.current) return;
    const hit = findTimelineMessageAtSequence(displayRows, linkSequence);
    if (hit) { setSearchHit(previous => previous?.id === hit.id ? previous : hit); return; }
    if (olderCursor && !loadingOlder && linkLoads.current < 100 && olderCursor.anchorId !== lastLinkCursor.current) {
      lastLinkCursor.current = olderCursor.anchorId;
      linkLoads.current++;
      void loadOlderHistory();
    }
  }, [displayRows, linkSequence, olderCursor, loadingOlder, searchQuery, timelineEnabled]);

  const exitPlanMode = useCallback(() => {
    if (!threadId || planExitPending) return;
    setPlanExitPending(true);
    void product.threads.cancelPlan(threadId).catch(() => undefined).finally(() => {
      setPlanExitPending(false);
    });
  }, [planExitPending, threadId]);

  const overflow = (
    <ThreadDetailOverflow
      threadId={threadId}
      title={title}
      status={status}
      inFlightRetry={inFlightRetry}
      projectId={projectId}
      onRenamed={setTitle}
      onUnread={() => setLastReadSeq(0)}
      onSearch={mobileControlsTarget ? () => setMobileSearchOpen(true) : undefined}
      extraActions={mobileControlsTarget ? <div className="mobile-menu-labeled"><PluginThreadHeaderActions threadId={threadId} projectId={projectId} /></div> : undefined}
    />
  );

  return (
    <ThreadPanelOwnerProvider ownerId={threadId}>
    <section
      ref={viewRef}
      className={viewClass}
      data-testid="thread-detail"
      data-embedded={embedded ? 'true' : undefined}
      style={panelOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="thread-detail-split">
      <div className={dockEnabled ? "thread-tool-main" : "thread-tool-main--legacy"}>
      <div ref={mainRef} className="thread-detail-main">
        <header className="thread-detail-header" data-title-in-shell={Boolean(mobileTitleTarget) || undefined} data-controls-in-shell={Boolean(mobileControlsTarget) || undefined}>
          <ThreadDetailHeading
            title={title}
            titleTarget={mobileTitleTarget}
            overflowTarget={mobileActionsTarget}
            draggable={Boolean(pane?.beginPaneDrag)}
            onPointerDown={
              pane?.beginPaneDrag
                ? (event) => pane.beginPaneDrag?.(event, title)
                : undefined
            }
            overflow={mobileControlsTarget ? null : overflow}
            agent={{
              providerId: threadProviderId,
              model: threadModel,
              projectName: project?.name ?? null,
              machineName: executionLocation.machineName,
              machineRemote: executionLocation.remote,
              branchName
            }}
          />
          <ThreadDetailActions target={mobileControlsTarget}>
            {(!mobileControlsTarget || mobileSearchOpen) && <ThreadDetailSearch
              mobileHeader={Boolean(mobileControlsTarget)}
              autoFocus={Boolean(mobileControlsTarget)}
              focusRequest={searchFocusRequest}
              onClose={() => setMobileSearchOpen(false)}
              value={searchDraft}
              onChange={setSearchDraft}
              onSubmit={submitSearch}
              matchIndex={searchActive && !search.pending ? search.index : undefined}
              matchCount={searchActive && !search.pending ? search.matches.length : undefined}
              partial={searchActive && search.partial}
            />}
            <ThreadStatusBadge status={status} waitingOnUser={awaitingUser} thinking={thinking} />
            {!mobileControlsTarget && <PluginThreadHeaderActions threadId={threadId} projectId={projectId} />}
            <SplitPaneHeaderActions />
            {dockEnabled ? <button type="button" className="icon-btn"
              aria-label={dockPanels.bottom.isOpen && !toolDock.dock.collapsed ? 'Hide bottom panel' : 'Show bottom panel'}
              title={dockPanels.bottom.isOpen && !toolDock.dock.collapsed ? 'Hide bottom panel' : 'Show bottom panel'}
              aria-pressed={dockPanels.bottom.isOpen && !toolDock.dock.collapsed}
              onClick={() => !dockPanels.bottom.isOpen ? addDockTab('bottom')
                : toolDock.update(current => ({ ...current, collapsed: !current.collapsed, maximized: false }))}><PanelBottom size={14} /></button> : null}
            {!panel.state.isOpen && showSecondaryPanel ? (
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
            {mobileControlsTarget ? overflow : null}
          </ThreadDetailActions>
        </header>
        <div className="thread-detail-body">
          <div className="thread-detail-column">
            {leadingContent ? (
              <div className="thread-chat-leading" data-testid="thread-chat-leading-content">
                {leadingContent}
              </div>
            ) : null}
            <ThreadTimeline
              threadId={threadId}
              rows={displayRows}
              status={status}
              waitingOnUser={awaitingUser}
              thinking={thinking}
              goal={goal}
              loading={timelineLoading}
              hasOlder={olderCursor !== null}
              loadingOlder={loadingOlder}
              onLoadOlder={loadOlderHistory}
              loadError={loadError}
              onRetryLoad={() => runLoadRef.current()}
              activeWorkflows={workflows}
              planExecution={timelinePlanExecution(threadId, durablePlan)}
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
                  const nextProjectId = route.isProjectFocused ? route.focusedProjectId : projectId;
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
              searchHitRowId={timelineTarget?.id ?? null}
              search={searchActive ? {
                query: searchQuery,
                occurrence: search.current?.occurrence ?? -1,
                navigation: search.navigation
              } : undefined}
              onFork={(sourceSeqEnd) => {
                void product.threads.fork(threadId, sourceSeqEnd != null ? { sourceSeqEnd } : undefined).then((forked) => {
                  if (forked.ok && forked.value?.id) {
                    navigate(getThreadRoutePath(
                      forked.value.id,
                      route.isProjectFocused ? route.focusedProjectId : projectId ?? undefined
                    ));
                  }
                });
              }}
              messageActions={messageActions}
              includePluginMessageActions={includePluginMessageActions}
            />
            <div className="thread-composer-dock">
              {!compact && <PromptContextBanner
                threadId={threadId}
                branchName={branchName}
                isWorktree={isWorktree}
                parentThreadId={parentThreadId}
                originKind={originKind}
                childCount={childThreads.length}
                environmentId={environmentId}
              />}
              <QueuedMessagesCard threadId={threadId} />
              <ModelFallbackCard fallback={modelFallback} />
              <BackgroundCommandsCard threadId={threadId} commands={backgroundCommands} workflows={workflows} />
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
                isExitPending={planExitPending}
                onOpenPlan={() => activateTool('plan')}
                onExitPlanMode={exitPlanMode}
              />
              <ThreadTodoCard
                todos={composerVisibleTodos(todos, durablePlan?.tasks.length ?? 0)}
                isExpanded={todoExpanded}
                onToggle={() => setTodoExpanded((value) => !value)}
              />
              {!compact && <ThreadWorkspaceBanner
                environmentId={environmentId}
                onOpenDiff={(path) => openDiff(path)}
              />}
              {archivedAt ? <ArchivedThreadBanner key={threadId} threadId={threadId} onRestored={() => { setArchivedAt(null); runLoadRef.current(); }} /> : <ThreadCommandComposer
                threadId={threadId}
                onRunTerminal={startPanelTerminal}
                project={project ?? undefined}
                autoFocus={!embedded && pane?.isFocused !== false && pendingInteractions.length === 0}
                status={status}
                inFlightRetry={inFlightRetry}
                sendBlocked={pendingInteractions.length > 0}
                sendBlockedHint={pendingInteractionSendBlockedHint(pendingInteractions)}
                environmentLabel={isWorktree ? 'Worktree' : 'Local'}
                contextWindowUsage={contextWindow}
                providerId={threadProviderId ?? undefined}
                model={threadModel}
                reasoningLevel={threadReasoning}
                serviceTier={threadServiceTier}
                acpMode={threadAcpMode}
                permissionMode={threadPermissionMode?.threadId === threadId ? threadPermissionMode.mode : null}
                executionModeRequested={executionModeRequested}
                planAction={planAction}
                onPlanActionPending={setPlanActionPending}
                onPlanActionHandled={() => setPlanAction(null)}
              />}
            </div>
          </div>
        </div>
      </div>
      {dockEnabled ? (dockPanels.bottom.isOpen ? renderToolPanel(dockPanels.bottom, 'bottom') : draggedTool ? <div
        className="thread-tool-drop-hint is-dragging"
        onDragOver={dockProps('bottom')?.onDragOver} onDrop={dockProps('bottom')?.onDrop}
        data-testid="thread-bottom-drop-target">
        <span>Dock below conversation</span>
      </div> : null) : null}
      </div>
      {draggedTool ? <div className="thread-tool-drag-shield" aria-hidden="true" /> : null}
      {dockEnabled && draggedTool && !panel.state.isOpen ? <div className="thread-tool-hidden-right-target"
        onDragOver={dockProps('right')?.onDragOver} onDrop={dockProps('right')?.onDrop}>Dock in right panel</div> : null}
      {hostedSecondary || !showSecondaryPanel ? null : secondaryPanelNode}
      </div>
    </section>
    </ThreadPanelOwnerProvider>
  );
}
