import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  buildTimelineViewRows,
  type ThreadTimelineViewRow,
  type TimelineTitleAction,
  type TimelineTitleLink,
  type TimelineViewWorkflowWorkRow
} from '@zana-ai/zcc-thread-view';
import type { ActiveThinking, ThreadTimelineGoal } from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import type { ThreadChatMessageAction } from '@zana-ai/zcc-plugin-sdk/app';
import type { PlanExecutionTask } from './timeline/plan-execution-card.js';
import { showOngoingThreadWork, timelineHasRunningWork, timelineRowsAwaitUser } from './thread-timeline-model.js';
import { collectTimelineAutoExpansionRowIds } from './timeline/timeline-auto-expand.js';
import {
  findStreamingAssistantMessageId,
  streamingContentIdentity
} from './timeline/streaming-assistant.js';
import {
  clearTransientScrollbarScrolling,
  firstUnreadRowId,
  isNearBottom,
  markTransientScrollbarScrolling,
  pinScrollToBottom,
  shouldStickToBottom
} from './timeline/timeline-scroll.js';
import {
  ThreadGoalBanner,
  ThreadHostDisconnectedBanner,
  ThreadTimelineLoadError,
  ThreadWorkflowChips,
  ThreadWorkingIndicator
} from './timeline/ThreadBanners.js';
import { TimelineRows } from './timeline/TimelineRows.js';
import { retainTerminalExpansionIds } from './timeline/timeline-window.js';
import { THREAD_MESSAGE_SENT_EVENT } from './timeline/thread-optimistic-events.js';

export interface ThreadTimelineProps {
  rows: TimelineRow[];
  status: string;
  thinking: ActiveThinking | null;
  goal?: ThreadTimelineGoal | null;
  activeWorkflows?: TimelineViewWorkflowWorkRow[] | null;
  lastReadSeq?: number | null;
  onReachedBottom?: () => void;
  onCopy?: (text: string) => void;
  onTitleAction?: (action: TimelineTitleAction) => void;
  onTitleLink?: (link: TimelineTitleLink) => void;
  onOpenDiff?: (path: string) => void;
  threadId?: string;
  waitingOnUser?: boolean;
  streamingContentKey?: string;
  projectId?: string | null;
  parentThreadId?: string | null;
  onFork?: (sourceSeqEnd?: number) => void;
  forceExpandedRowIds?: ReadonlySet<string>;
  searchHitRowId?: string | null;
  messageActions?: readonly ThreadChatMessageAction[];
  includePluginMessageActions?: boolean;
  planExecution?: { title: string; tasks: readonly PlanExecutionTask[] } | null;
  loadError?: string | null;
  onRetryLoad?: () => void;
}

function flattenForUnread(rows: ThreadTimelineViewRow[]): Array<{ id: string; sourceSeqStart?: number }> {
  const out: Array<{ id: string; sourceSeqStart?: number }> = [];
  const visit = (list: ThreadTimelineViewRow[]) => {
    for (const row of list) {
      if (row.kind === 'turn') {
        visit(row.children ?? []);
        continue;
      }
      out.push({ id: row.id, sourceSeqStart: row.sourceSeqStart });
      if (row.kind === 'work' && row.workKind === 'delegation') visit(row.childRows);
      if (row.kind === 'bundle-summary' || row.kind === 'step-summary') visit(row.children);
    }
  };
  visit(rows);
  return out;
}

export function ThreadTimeline({
  rows,
  status,
  thinking,
  goal,
  activeWorkflows,
  lastReadSeq,
  onReachedBottom,
  onCopy,
  onTitleAction,
  onTitleLink,
  onOpenDiff,
  threadId,
  waitingOnUser = false,
  streamingContentKey,
  projectId,
  parentThreadId,
  onFork,
  forceExpandedRowIds,
  searchHitRowId,
  messageActions,
  includePluginMessageActions,
  planExecution,
  loadError = null,
  onRetryLoad
}: ThreadTimelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const [retainedTerminalIds, setRetainedTerminalIds] = useState<string[]>([]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const paneRef = useRef<HTMLDivElement>(null);
  const lastPinnedTopRef = useRef<number | null>(null);
  const scrollbarIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pinnedAway, setPinnedAway] = useState(false);
  const [initialOpen, setInitialOpen] = useState(true);
  const viewRows = useMemo(() => buildTimelineViewRows(rows), [rows]);
  const awaitingUser = waitingOnUser || timelineRowsAwaitUser(rows);
  const expansion = useMemo(
    () => collectTimelineAutoExpansionRowIds({
      rows: viewRows,
      scopeActive: showOngoingThreadWork(status, awaitingUser)
    }),
    [awaitingUser, status, viewRows]
  );
  useEffect(() => {
    setRetainedTerminalIds((current) => retainTerminalExpansionIds(current, expansion.terminalFrontierRowIds));
  }, [expansion.terminalFrontierRowIds]);
  const expansionWithRetention = useMemo(() => ({
    liveFrontierRowIds: expansion.liveFrontierRowIds,
    terminalFrontierRowIds: new Set([
      ...expansion.terminalFrontierRowIds,
      ...retainedTerminalIds
    ])
  }), [expansion.liveFrontierRowIds, expansion.terminalFrontierRowIds, retainedTerminalIds]);
  const unreadRowId = useMemo(
    () => firstUnreadRowId(flattenForUnread(viewRows), lastReadSeq),
    [lastReadSeq, viewRows]
  );
  const busy = showOngoingThreadWork(status);
  const streamingAssistantMessageId = useMemo(
    () => (busy ? findStreamingAssistantMessageId(viewRows) : null),
    [busy, viewRows]
  );
  const contentKey = streamingContentKey
    ?? streamingContentIdentity(viewRows, streamingAssistantMessageId, thinking?.updatedAt);
  const stick = !searchHitRowId && shouldStickToBottom({
    isBusy: busy,
    streaming: streamingAssistantMessageId !== null,
    userPinnedAway: pinnedAway,
    initialOpen
  });
  const pin = useCallback(() => {
    const pane = paneRef.current;
    if (!pane) return;
    pinScrollToBottom(pane);
    lastPinnedTopRef.current = pane.scrollTop;
  }, []);

  useLayoutEffect(() => {
    setInitialOpen(true);
    setPinnedAway(false);
  }, [threadId]);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || !stick) return;
    pin();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(pin);
    // The mobile keyboard and composer options resize the viewport, not its rows.
    observer.observe(pane);
    for (const child of pane.children) observer.observe(child);
    return () => observer.disconnect();
  }, [stick, viewRows, thinking, contentKey, pin]);

  useEffect(() => {
    if (!threadId) return;
    const onSend = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId: string }>).detail;
      if (detail?.threadId !== threadId) return;
      setPinnedAway(false);
      setInitialOpen(true);
      pin();
    };
    window.addEventListener(THREAD_MESSAGE_SENT_EVENT, onSend);
    return () => window.removeEventListener(THREAD_MESSAGE_SENT_EVENT, onSend);
  }, [threadId, pin]);

  useEffect(() => {
    if (!searchHitRowId) return;
    const pane = paneRef.current;
    if (!pane) return;
    const el = pane.querySelector(`[data-row-id="${CSS.escape(searchHitRowId)}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.classList.add('thread-timeline-search-hit');
    el.scrollIntoView({ block: 'center' });
    const timer = window.setTimeout(() => {
      el.classList.remove('thread-timeline-search-hit');
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [searchHitRowId, viewRows]);

  useEffect(() => () => {
    clearTransientScrollbarScrolling(paneRef.current, scrollbarIdleRef);
  }, []);

  const onScroll = useCallback(() => {
    const pane = paneRef.current;
    if (!pane) return;
    markTransientScrollbarScrolling(pane, scrollbarIdleRef);
    const near = isNearBottom(pane);
    // Android may deliver our own scroll event after new rows have increased
    // scrollHeight. The unchanged position is not a user scrollback gesture.
    if (!near && lastPinnedTopRef.current !== null
      && Math.abs(pane.scrollTop - lastPinnedTopRef.current) < 1) return;
    setPinnedAway(!near);
    if (!near) setInitialOpen(false);
    if (near) onReachedBottom?.();
  }, [onReachedBottom]);

  const scrollToBottom = () => {
    const pane = paneRef.current;
    if (!pane) return;
    pin();
    setPinnedAway(false);
    setInitialOpen(true);
    onReachedBottom?.();
  };

  return (
    <div className="thread-detail-timeline-shell">
      <div className="thread-banner-stack">
        <ThreadGoalBanner goal={goal} />
        <ThreadTimelineLoadError message={loadError} onRetry={onRetryLoad} />
        <ThreadWorkflowChips workflows={activeWorkflows} />
      </div>
      <div
        className="thread-detail-timeline thread-scrollbar"
        data-testid="thread-timeline"
        ref={paneRef}
        onScroll={onScroll}
      >
        {viewRows.length === 0 ? (
          <p className="thread-detail-empty">Waiting for the first turn…</p>
        ) : (
          <TimelineRows
            rows={viewRows}
            now={now}
            expansion={expansionWithRetention}
            unreadRowId={unreadRowId}
            onCopy={onCopy}
            onTitleAction={onTitleAction}
            onTitleLink={onTitleLink}
            onOpenDiff={onOpenDiff}
            threadId={threadId}
            streamingAssistantMessageId={streamingAssistantMessageId}
            forceExpandedRowIds={forceExpandedRowIds}
            projectId={projectId}
            parentThreadId={parentThreadId}
            threadIdle={!busy && !awaitingUser}
            onFork={onFork}
            scopeActive={busy && !awaitingUser}
            messageActions={messageActions}
            includePluginMessageActions={includePluginMessageActions}
            planExecution={planExecution}
          />
        )}
        <ThreadHostDisconnectedBanner status={status} />
        <ThreadWorkingIndicator
          status={status}
          thinking={thinking}
          waitingOnUser={awaitingUser}
          hasRunningWork={timelineHasRunningWork(rows)}
        />
      </div>
      {pinnedAway ? (
        <button
          type="button"
          className="thread-scroll-bottom"
          data-testid="thread-scroll-bottom"
          aria-label="Scroll to bottom"
          onClick={scrollToBottom}
        >
          <ChevronDown size={16} />
        </button>
      ) : null}
    </div>
  );
}

export { ThreadTodoCard, ThreadPromptModeCard, ThreadWorkingIndicator } from './timeline/ThreadBanners.js';
