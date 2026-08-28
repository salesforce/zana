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
import type { ReactNode } from 'react';
import { ExpandableTimelineRow } from './ExpandableTimelineRow.js';
import { ConversationRow } from './ConversationRow.js';
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
import type { TimelineTitleActionHandler, TimelineTitleLinkHandler } from './TimelineTitleView.js';

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
  now: number;
  expansion: ReturnType<typeof collectTimelineAutoExpansionRowIds>;
  unreadRowId?: string | null;
  onCopy?: (text: string) => void;
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
}

export function TimelineRows(props: TimelineRowsProps) {
  const { rows, unreadRowId, nested } = props;
  const activeLatestBundleId = findActiveLatestBundleId(rows);
  const list = (
    <>
      {rows.map((row) => {
        const title = buildTimelineRowTitle(row, {
          ...TITLE_OPTIONS,
          isActiveLatestBundle: row.kind === 'bundle-summary' && row.id === activeLatestBundleId
        });
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
              {...props}
              row={row}
              title={title}
              activeLatestBundleId={activeLatestBundleId}
            />
          </div>
        );
      })}
    </>
  );
  if (nested) {
    return <div className="thread-timeline-nested">{list}</div>;
  }
  return list;
}

function TimelineRowView({
  row,
  title,
  now,
  expansion,
  unreadRowId,
  onCopy,
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
  onFork
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
      onAction={onTitleAction}
      onLink={onTitleLink}
    />
  );
  const nestedProps = {
    now,
    expansion,
    unreadRowId,
    onCopy,
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
    onFork
  };

  if (row.kind === 'conversation') {
    return (
      <ConversationRow
        row={row}
        onCopy={onCopy}
        threadId={threadId}
        projectId={projectId}
        parentThreadId={parentThreadId}
        threadIdle={threadIdle}
        streaming={row.role === 'assistant' && row.id === streamingAssistantMessageId}
        onFork={onFork}
      />
    );
  }

  if (row.kind === 'system') {
    return (
      <p
        className={`thread-timeline-system${dim ? ' is-dim' : ''}`}
        data-testid="thread-system-row"
        data-row-id={row.id}
        data-status={row.status ?? undefined}
      >
        {systemRowLabel(row)}
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
                <TimelineTitleView title={entry.title} now={now} onAction={onTitleAction} onLink={onTitleLink} />
              </div>
            </article>
          ))}
        </>
      );
    }
  }

  const nestedList = row.kind === 'work' && row.workKind === 'delegation'
    ? <TimelineRows rows={row.childRows} nested {...nestedProps} />
    : row.kind === 'bundle-summary' || row.kind === 'step-summary'
      ? <TimelineRows rows={row.children} nested {...nestedProps} />
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

  const pending = 'status' in row && row.status === 'pending';
  const awaitingUser = row.kind === 'work'
    && (row.workKind === 'question' || row.workKind === 'approval');
  const expandable = isRowExpandable(row);
  const hasBody = Boolean(body) || Boolean(nested);
  const glyph = row.kind === 'work' ? workRowGlyph(row) : null;

  return (
    <ExpandableTimelineRow
      testId="thread-work-row"
      rowId={row.id}
      status={'status' in row ? row.status : undefined}
      dim={dim}
      autoExpanded={autoOpen || (pending && !awaitingUser)}
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
