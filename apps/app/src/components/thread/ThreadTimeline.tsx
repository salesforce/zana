import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  buildTimelineViewRows,
  type ThreadTimelineViewRow,
  type TimelineTitleAction,
  type TimelineTitleLink,
  type TimelineViewWorkflowWorkRow
} from '@zana-ai/zcc-thread-view';
import type { ActiveThinking, ThreadTimelineGoal, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { ThreadContextWindowUsage, TimelineRow } from '@zana-ai/zcc-server-contract';
import { isBusyThreadStatus } from './thread-timeline-model.js';
import { collectTimelineAutoExpansionRowIds } from './timeline/timeline-auto-expand.js';
import { firstUnreadRowId, isNearBottom, shouldStickToBottom } from './timeline/timeline-scroll.js';
import {
  ThreadContextChip,
  ThreadGoalBanner,
  ThreadPromptModeChip,
  ThreadTodoCard,
  ThreadWorkflowChips,
  ThreadWorkingIndicator
} from './timeline/ThreadBanners.js';
import { TimelineRows } from './timeline/TimelineRows.js';

export interface ThreadTimelineProps {
  rows: TimelineRow[];
  status: string;
  thinking: ActiveThinking | null;
  todos: ThreadTimelinePendingTodos | null;
  goal?: ThreadTimelineGoal | null;
  activeWorkflows?: TimelineViewWorkflowWorkRow[] | null;
  activePromptMode?: { mode: string; prompt?: string } | null;
  contextWindowUsage?: ThreadContextWindowUsage | null;
  lastReadSeq?: number | null;
  hasOlderRows?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  onReachedBottom?: () => void;
  onCopy?: (text: string) => void;
  onTitleAction?: (action: TimelineTitleAction) => void;
  onTitleLink?: (link: TimelineTitleLink) => void;
  onOpenDiff?: (path: string) => void;
  onAnswer?: (text: string) => void;
  threadId?: string;
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
  todos,
  goal,
  activeWorkflows,
  activePromptMode,
  contextWindowUsage,
  lastReadSeq,
  hasOlderRows,
  loadingOlder,
  onLoadOlder,
  onReachedBottom,
  onCopy,
  onTitleAction,
  onTitleLink,
  onOpenDiff,
  onAnswer,
  threadId
}: ThreadTimelineProps) {
  const [now] = useState(() => Date.now());
  const paneRef = useRef<HTMLDivElement>(null);
  const [pinnedAway, setPinnedAway] = useState(false);
  const viewRows = useMemo(() => buildTimelineViewRows(rows), [rows]);
  const expansion = useMemo(
    () => collectTimelineAutoExpansionRowIds({
      rows: viewRows,
      scopeActive: isBusyThreadStatus(status)
    }),
    [status, viewRows]
  );
  const unreadRowId = useMemo(
    () => firstUnreadRowId(flattenForUnread(viewRows), lastReadSeq),
    [lastReadSeq, viewRows]
  );
  const busy = isBusyThreadStatus(status);

  const stick = shouldStickToBottom({ isBusy: busy, userPinnedAway: pinnedAway });

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || !stick) return;
    pane.scrollTop = pane.scrollHeight;
  }, [stick, viewRows, thinking, todos]);

  const onScroll = useCallback(() => {
    const pane = paneRef.current;
    if (!pane) return;
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

  return (
    <div className="thread-detail-timeline-shell">
      <div className="thread-banner-stack">
        <ThreadGoalBanner goal={goal} />
        <div className="thread-banner-row">
          <ThreadPromptModeChip mode={activePromptMode} />
          <ThreadContextChip usage={contextWindowUsage} />
        </div>
        <ThreadWorkflowChips workflows={activeWorkflows} />
      </div>
      <div
        className="thread-detail-timeline"
        data-testid="thread-timeline"
        ref={paneRef}
        onScroll={onScroll}
      >
        {hasOlderRows ? (
          <button
            type="button"
            className="thread-load-older"
            data-testid="thread-load-older"
            disabled={loadingOlder}
            onClick={() => onLoadOlder?.()}
          >
            {loadingOlder ? 'Loading…' : 'Load older'}
          </button>
        ) : null}
        {viewRows.length === 0 ? (
          <p className="thread-detail-empty">Waiting for the first turn…</p>
        ) : (
          <TimelineRows
            rows={viewRows}
            now={now}
            expansion={expansion}
            unreadRowId={unreadRowId}
            onCopy={onCopy}
            onTitleAction={onTitleAction}
            onTitleLink={onTitleLink}
            onOpenDiff={onOpenDiff}
            onAnswer={onAnswer}
            threadId={threadId}
          />
        )}
        <ThreadWorkingIndicator status={status} thinking={thinking} />
        <ThreadTodoCard todos={todos} />
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

export { ThreadTodoCard, ThreadWorkingIndicator } from './timeline/ThreadBanners.js';
