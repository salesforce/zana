import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { isBusyThreadStatus, timelineRowsAwaitUser } from './thread-timeline-model.js';
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
  shouldStickToBottom
} from './timeline/timeline-scroll.js';
import {
  ThreadGoalBanner,
  ThreadWorkflowChips,
  ThreadWorkingIndicator
} from './timeline/ThreadBanners.js';
import { TimelineRows } from './timeline/TimelineRows.js';
import {
  olderHistoryAction,
  retainTerminalExpansionIds,
  windowTimelineRows
} from './timeline/timeline-window.js';

export interface ThreadTimelineProps {
  rows: TimelineRow[];
  status: string;
  thinking: ActiveThinking | null;
  goal?: ThreadTimelineGoal | null;
  activeWorkflows?: TimelineViewWorkflowWorkRow[] | null;
  lastReadSeq?: number | null;
  hasOlderRows?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
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
  hasOlderRows,
  loadingOlder,
  onLoadOlder,
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
  searchHitRowId
}: ThreadTimelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const [retainedTerminalIds, setRetainedTerminalIds] = useState<string[]>([]);
  const [showAllWindow, setShowAllWindow] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollbarIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pinnedAway, setPinnedAway] = useState(false);
  const viewRows = useMemo(() => buildTimelineViewRows(rows), [rows]);
  const awaitingUser = waitingOnUser || timelineRowsAwaitUser(rows);
  const expansion = useMemo(
    () => collectTimelineAutoExpansionRowIds({
      rows: viewRows,
      scopeActive: isBusyThreadStatus(status) && !awaitingUser
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
  const windowed = useMemo(
    () => windowTimelineRows(viewRows, undefined, {
      showAll: showAllWindow,
      keepId: searchHitRowId
    }),
    [searchHitRowId, showAllWindow, viewRows]
  );
  const unreadRowId = useMemo(
    () => firstUnreadRowId(flattenForUnread(viewRows), lastReadSeq),
    [lastReadSeq, viewRows]
  );
  const busy = isBusyThreadStatus(status);
  const streamingAssistantMessageId = useMemo(
    () => (busy ? findStreamingAssistantMessageId(viewRows) : null),
    [busy, viewRows]
  );
  const contentKey = streamingContentKey
    ?? streamingContentIdentity(viewRows, streamingAssistantMessageId, thinking?.updatedAt);
  const stick = shouldStickToBottom({
    isBusy: busy,
    streaming: streamingAssistantMessageId !== null,
    userPinnedAway: pinnedAway
  });

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || !stick) return;
    pane.scrollTop = pane.scrollHeight;
  }, [stick, viewRows, thinking, contentKey]);

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
    setPinnedAway(!near);
    if (near) onReachedBottom?.();
    if (pane.scrollTop <= 24 && hasOlderRows && !loadingOlder) onLoadOlder?.();
  }, [hasOlderRows, loadingOlder, onLoadOlder, onReachedBottom]);

  const scrollToBottom = () => {
    const pane = paneRef.current;
    if (!pane) return;
    pane.scrollTop = pane.scrollHeight;
    setPinnedAway(false);
    onReachedBottom?.();
  };

  const olderAction = olderHistoryAction({
    hiddenCount: windowed.hiddenCount,
    hasOlderRows: Boolean(hasOlderRows),
    loadingOlder: Boolean(loadingOlder)
  });
  const revealOlderHistory = () => {
    if (olderAction.kind === 'show-earlier') {
      setShowAllWindow(true);
      return;
    }
    setShowAllWindow(true);
    onLoadOlder?.();
  };

  return (
    <div className="thread-detail-timeline-shell">
      <div className="thread-banner-stack">
        <ThreadGoalBanner goal={goal} />
        <ThreadWorkflowChips workflows={activeWorkflows} />
      </div>
      <div
        className="thread-detail-timeline thread-scrollbar"
        data-testid="thread-timeline"
        ref={paneRef}
        onScroll={onScroll}
      >
        {olderAction.kind === 'show-earlier' ? (
          <button
            type="button"
            className="thread-load-older"
            data-testid="thread-show-earlier"
            onClick={revealOlderHistory}
          >
            Show earlier ({olderAction.hiddenCount})
          </button>
        ) : olderAction.kind === 'load-older' ? (
          <button
            type="button"
            className="thread-load-older"
            data-testid="thread-load-older"
            disabled={olderAction.loading}
            onClick={revealOlderHistory}
          >
            {olderAction.loading ? 'Loading…' : 'Load older'}
          </button>
        ) : null}
        {viewRows.length === 0 ? (
          <p className="thread-detail-empty">Waiting for the first turn…</p>
        ) : (
          <TimelineRows
            rows={windowed.visible}
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
          />
        )}
        <ThreadWorkingIndicator status={status} thinking={thinking} waitingOnUser={awaitingUser} />
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
