import {
  activityIntentTitleGlyph,
  buildTimelineActivityIntentTitles,
  buildTimelineRowTitle,
  findActiveLatestBundleId,
  hasTimelineExplorationIntent,
  workRowGlyph,
  type ThreadTimelineViewRow,
  type TimelineTitle,
  type TimelineViewWorkRow
} from '@zana-ai/zcc-thread-view';
import { isBackgroundAgentTaskType, isBackgroundCommandTaskType } from '@zana-ai/zcc-domain/thread-runtime';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TIMELINE_WINDOW_SIZE, windowTimelineRows } from './timeline-window.js';
import type { ThreadChatMessageAction } from '@zana-ai/zcc-plugin-sdk/app';
import { ExpandableTimelineRow } from './ExpandableTimelineRow.js';
import { ConversationRow } from './ConversationRow.js';
import { ThreadActivityLabel } from './ThreadActivityLabel.js';
import { TimelineTitleView } from './TimelineTitleView.js';
import { TimelineWorkGlyph } from './TimelineWorkGlyph.js';
import { TurnArchiveRow } from './TurnArchiveRow.js';
import { WorkRowBody } from './WorkRowBody.js';
import {
  collectTimelineAutoExpansionRowIds,
  isAutoExpandedRow,
  isNonExpandableSummary,
  isRowExpandable
} from './timeline-auto-expand.js';
import { pastRowDimClassName } from './timeline-title.js';
import { TimelineDetailScroll } from './TimelineDetailScroll.js';
import { isUserConversationRow, observeStickyUserPrompts, stickyTurnRanges } from './timeline-sticky-user.js';
import type { TimelineTitleActionHandler, TimelineTitleLinkHandler } from './TimelineTitleView.js';
import { visiblePlanExecution, type PlanExecutionView } from './plan-execution-card.js';
import {
  collectTimelineFilePreviewPaths,
  reuseStringListIfEqual
} from './timeline-file-preview-paths.js';

const TITLE_OPTIONS = { summaryStyle: 'bundle' as const, workStyle: 'default' as const };

function systemRowLabel(row: Extract<ThreadTimelineViewRow, { kind: 'system' }>): string {
  if (row.systemKind === 'operation' && row.operationKind === 'thread-provisioning') {
    return row.title?.trim() || 'Provisioned agent';
  }
  return row.detail ? `${row.title} — ${row.detail}` : row.title;
}

function shouldRenderCompactActivityIntentRows(
  row: ThreadTimelineViewRow
): row is Extract<TimelineViewWorkRow, { workKind: 'command' | 'tool' }> {
  return (
    row.kind === 'work'
    && (row.workKind === 'command' || row.workKind === 'tool')
    && row.approvalStatus === null
    && hasTimelineExplorationIntent(row)
  );
}

interface TimelineRowsProps {
  rows: ThreadTimelineViewRow[];
  now?: number;
  expansion: ReturnType<typeof collectTimelineAutoExpansionRowIds>;
  unreadRowId?: string | null;
  onCopy?: (text: string) => void;
  onMessageExpand?: () => void;
  onTitleAction?: TimelineTitleActionHandler;
  onTitleLink?: TimelineTitleLinkHandler;
  onOpenDiff?: (path: string) => void;
  threadId?: string;
  compactActivityIntents?: boolean;
  nested?: boolean;
  streamingAssistantMessageId?: string | null;
  forceExpandedRowIds?: ReadonlySet<string>;
  projectId?: string | null;
  parentThreadId?: string | null;
  threadIdle?: boolean;
  onFork?: (sourceSeqEnd?: number) => void;
  /** Present-tense bundle titles are only for an active scope. */
  scopeActive?: boolean;
  messageActions?: readonly ThreadChatMessageAction[];
  includePluginMessageActions?: boolean;
  planExecution?: PlanExecutionView | null;
  filePathHints?: readonly string[];
  targetRowId?: string | null;
  historyPage?: number;
  latestPageRequest?: number;
}

export function TimelineRows(props: TimelineRowsProps) {
  const { rows, unreadRowId, nested, scopeActive = false, planExecution } = props;
  const [pageAnchorId, setPageAnchorId] = useState<string | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const historyPageRef = useRef(props.historyPage);
  useLayoutEffect(() => { setPageAnchorId(null); }, [props.latestPageRequest]);
  useEffect(() => {
    if (historyPageRef.current === props.historyPage) return;
    historyPageRef.current = props.historyPage;
    setPageAnchorId(rows[0]?.id ?? null);
  }, [props.historyPage, rows]);
  const targetRootId = rows.find(row => row.id === props.targetRowId || props.forceExpandedRowIds?.has(row.id))?.id;
  const page = useMemo(() => windowTimelineRows(rows, TIMELINE_WINDOW_SIZE, {
    startId: pageAnchorId, keepId: targetRootId, isContextRow: nested ? undefined : isUserConversationRow
  }), [rows, pageAnchorId, targetRootId, nested]);
  const visibleRows = page.visible;
  useLayoutEffect(() => {
    if (nested || !windowRef.current) return;
    const pane = windowRef.current.closest<HTMLElement>('[data-testid="thread-timeline"]');
    if (pane) return observeStickyUserPrompts(pane);
  }, [visibleRows, nested]);
  const filePathHintsRef = useRef<readonly string[]>([]);
  const collectedPaths = useMemo(() => props.filePathHints ?? collectTimelineFilePreviewPaths(rows), [props.filePathHints, rows]);
  const filePathHints = reuseStringListIfEqual(
    filePathHintsRef.current,
    collectedPaths
  );
  filePathHintsRef.current = filePathHints;
  const rowProps = { ...props, filePathHints };
  const activeLatestBundleId = useMemo(() => findActiveLatestBundleId(rows), [rows]);
  const turns = useMemo(() => stickyTurnRanges(visibleRows), [visibleRows]);
  const titles = useMemo(() => new Map(visibleRows.map(row => [row.id, buildTimelineRowTitle(row, {
    ...TITLE_OPTIONS,
    isActiveLatestBundle: scopeActive && row.kind === 'bundle-summary' && row.id === activeLatestBundleId
  })])), [visibleRows, scopeActive, activeLatestBundleId]);
  const latestUserRowId = useMemo(() => {
    if (nested) return null;
    const allTurns = stickyTurnRanges(rows);
    return allTurns.length > 0 ? rows[allTurns[allTurns.length - 1]!.start]?.id : null;
  }, [nested, rows]);
  const latestPlan = visiblePlanExecution(planExecution);
  const renderItems = (slice: readonly ThreadTimelineViewRow[]) =>
    slice.map((row) => {
      const title = titles.get(row.id)!;
      return (
        <div
          key={row.id}
          className={`thread-timeline-item${row.kind === 'conversation' ? ` is-${row.role}` : ''}`}
        >
          {unreadRowId === row.id ? (
            <div className="thread-unread-divider" data-testid="thread-unread-divider">
              New
            </div>
          ) : null}
          <TimelineRowView
            {...rowProps}
            row={row}
            title={title}
            activeLatestBundleId={activeLatestBundleId}
            planExecution={row.id === latestUserRowId ? latestPlan : null}
          />
        </div>
      );
    });
  const list = (() => {
    if (turns.length === 0) return renderItems(visibleRows);
    const prefix = turns[0]!.start > 0 ? renderItems(visibleRows.slice(0, turns[0]!.start)) : null;
    return (
      <>
        {prefix}
        {turns.map((turn) => (
          <div key={`sticky-turn:${visibleRows[turn.start]!.id}`} className="thread-timeline-current-turn">
            {renderItems(visibleRows.slice(turn.start, turn.end))}
          </div>
        ))}
      </>
    );
  })();
  const boundedList = <>
    {page.hiddenCount > 0 && <button type="button" data-testid="timeline-earlier-page" onClick={() => {
      setPageAnchorId(rows[Math.max(0, page.hiddenCount - TIMELINE_WINDOW_SIZE)]!.id);
    }}>{nested ? 'Earlier details' : 'Earlier messages'}</button>}
    {list}
    {page.hiddenAfterCount > 0 && <button type="button" data-testid="timeline-later-page" onClick={() => {
      const start = rows.length - page.hiddenAfterCount;
      setPageAnchorId(start >= rows.length - TIMELINE_WINDOW_SIZE ? null : rows[start]!.id);
    }}>{nested ? 'Later details' : 'Later messages'}</button>}
  </>;
  if (nested) {
    return <div className="thread-timeline-nested">{boundedList}</div>;
  }
  return <div ref={windowRef} className="thread-timeline-window">{boundedList}</div>;
}

function TimelineRowView({
  row,
  title,
  now,
  expansion,
  unreadRowId,
  onCopy,
  onMessageExpand,
  onTitleAction,
  onTitleLink,
  onOpenDiff,
  threadId,
  compactActivityIntents = false,
  activeLatestBundleId,
  streamingAssistantMessageId,
  forceExpandedRowIds,
  projectId,
  parentThreadId,
  threadIdle,
  onFork,
  messageActions,
  includePluginMessageActions,
  planExecution,
  filePathHints,
  targetRowId
}: TimelineRowsProps & {
  row: ThreadTimelineViewRow;
  title: TimelineTitle;
  activeLatestBundleId: string | null;
}) {
  const autoOpen = isAutoExpandedRow(row.id, expansion);
  const dim = pastRowDimClassName({ row, activeLatestBundleId, autoOpen });
  const summary = (
    <TimelineTitleView
      title={title}
      now={now}
      live={threadIdle !== true}
      onAction={onTitleAction}
      onLink={onTitleLink}
    />
  );
  const nestedProps = {
    now,
    expansion,
    unreadRowId,
    onCopy,
    onMessageExpand,
    onTitleAction,
    onTitleLink,
    onOpenDiff,
    threadId,
    compactActivityIntents: true,
    streamingAssistantMessageId,
    forceExpandedRowIds,
    projectId,
    parentThreadId,
    threadIdle,
    onFork,
    messageActions,
    includePluginMessageActions,
    filePathHints,
    targetRowId
  };

  if (row.kind === 'conversation') {
    return (
      <ConversationRow
        row={row}
        onCopy={onCopy}
        onMessageExpand={onMessageExpand}
        forceExpanded={forceExpandedRowIds?.has(row.id) === true}
        threadId={threadId}
        projectId={projectId}
        parentThreadId={parentThreadId}
        threadIdle={threadIdle}
        streaming={row.role === 'assistant' && row.id === streamingAssistantMessageId}
        onFork={onFork}
        messageActions={messageActions}
        includePluginMessageActions={includePluginMessageActions}
        planExecution={planExecution}
        filePathHints={filePathHints}
      />
    );
  }

  if (row.kind === 'system') {
    const label = systemRowLabel(row);
    const isRunning = row.systemKind === 'operation' && row.status === 'pending';
    const isError = row.systemKind === 'error' || row.systemKind === 'reconnect';
    if (isError && row.detail) {
      return (
        <ExpandableTimelineRow
          dim={dim}
          testId="thread-system-row"
          status={row.status ?? undefined}
          rowId={row.id}
          expandable
          autoExpanded={row.systemKind === 'reconnect'}
          forceExpanded={forceExpandedRowIds?.has(row.id) === true}
          summary={
            <span className="thread-timeline-system-title" data-thread-search-content="">{row.title}</span>
          }
        >
          <pre className="thread-timeline-system-detail" data-thread-search-content="">{row.detail}</pre>
        </ExpandableTimelineRow>
      );
    }
    return (
      <p
        className={`thread-timeline-system${isRunning ? ' thread-working-indicator' : dim ? ' is-dim' : ''}`}
        data-testid="thread-system-row"
        data-row-id={row.id}
        data-status={row.status ?? undefined}
        data-thread-search-content=""
      >
        {isRunning ? <ThreadActivityLabel label={label} /> : label}
      </p>
    );
  }

  if (row.kind === 'turn') {
    return (
      <TurnArchiveRow
        row={row}
        title={title}
        now={now}
        dim={Boolean(dim)}
        expansion={expansion}
        unreadRowId={unreadRowId}
        onCopy={onCopy}
        onMessageExpand={onMessageExpand}
        onTitleAction={onTitleAction}
        onTitleLink={onTitleLink}
        onOpenDiff={onOpenDiff}
        threadId={threadId}
        streamingAssistantMessageId={streamingAssistantMessageId}
        forceExpandedRowIds={forceExpandedRowIds}
        projectId={projectId}
        parentThreadId={parentThreadId}
        threadIdle={threadIdle}
        onFork={onFork}
        messageActions={messageActions}
        includePluginMessageActions={includePluginMessageActions}
        filePathHints={filePathHints}
        targetRowId={targetRowId}
      />
    );
  }

  if (compactActivityIntents && shouldRenderCompactActivityIntentRows(row)) {
    const titles = buildTimelineActivityIntentTitles(row);
    if (titles.length > 0) {
      return (
        <>
          {titles.map((entry) => (
            <article
              key={entry.id}
              className={`thread-timeline-work is-compact${dim ? ' is-dim' : ''}`}
              data-testid="thread-work-row"
              data-row-id={entry.id}
            >
              <div className="thread-timeline-work-header">
                <TimelineWorkGlyph name={activityIntentTitleGlyph(entry)} />
                <TimelineTitleView title={entry.title} now={now} live={threadIdle !== true} onAction={onTitleAction} onLink={onTitleLink} />
              </div>
            </article>
          ))}
        </>
      );
    }
  }

  const nestedList = row.kind === 'work' && row.workKind === 'delegation'
    ? <TimelineRows rows={row.childRows} nested {...nestedProps} scopeActive={row.status === 'pending'} />
    : row.kind === 'bundle-summary' || row.kind === 'step-summary'
      ? <TimelineRows rows={row.children} nested {...nestedProps} scopeActive={false} />
      : null;
  const nestedStreaming = expansion.liveFrontierRowIds.has(row.id);
  const nested = capNestedList(row, nestedList, nestedStreaming);

  const body = row.kind === 'work'
    ? (
      <WorkRowBody
        row={row}
        threadId={threadId}
        onOpenDiff={onOpenDiff}
      />
    )
    : null;

  const expandable = isRowExpandable(row);
  const hasBody = Boolean(body) || Boolean(nested);
  const glyph = row.kind === 'work' ? workRowGlyph(row) : null;
  const backgroundTask =
    row.kind === 'work'
    && row.workKind === 'workflow'
    && (isBackgroundCommandTaskType(row.taskType) || isBackgroundAgentTaskType(row.taskType));

  return (
    <ExpandableTimelineRow
      testId={backgroundTask ? 'thread-background-task-row' : 'thread-work-row'}
      rowId={row.id}
      status={'status' in row ? row.status : undefined}
      dim={dim}
      autoExpanded={autoOpen}
      terminalAutoExpanded={expansion.terminalFrontierRowIds.has(row.id)}
      forceExpanded={forceExpandedRowIds?.has(row.id) === true}
      expandable={expandable && hasBody}
      summary={summary}
      glyph={glyph}
    >
      {body}
      {nested}
    </ExpandableTimelineRow>
  );
}

function capNestedList(
  row: ThreadTimelineViewRow,
  nestedList: ReactNode,
  streaming: boolean
): ReactNode {
  if (nestedList == null) return null;
  if (row.kind === 'work' && row.workKind === 'delegation') {
    return (
      <TimelineDetailScroll
        size="delegation"
        streaming={streaming}
        contentKey={`${row.id}:${row.childRows.length}`}
      >
        {nestedList}
      </TimelineDetailScroll>
    );
  }
  if (
    (row.kind === 'bundle-summary' || row.kind === 'step-summary')
    && isNonExpandableSummary(row.children)
  ) {
    return (
      <TimelineDetailScroll
        size="summary"
        streaming={streaming}
        contentKey={`${row.id}:${row.children.length}`}
      >
        {nestedList}
      </TimelineDetailScroll>
    );
  }
  return nestedList;
}
