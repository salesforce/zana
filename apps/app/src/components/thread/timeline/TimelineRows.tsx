import { buildTimelineRowTitle, findActiveLatestBundleId, type ThreadTimelineViewRow, type TimelineTitle } from '@zana-ai/zcc-thread-view';
import { ExpandableTimelineRow } from './ExpandableTimelineRow.js';
import { ConversationRow } from './ConversationRow.js';
import { TimelineTitleView } from './TimelineTitleView.js';
import { WorkRowBody } from './WorkRowBody.js';
import {
  collectTimelineAutoExpansionRowIds,
  isAutoExpandedRow,
  isRowExpandable
} from './timeline-auto-expand.js';
import { isPastWorkRow } from './timeline-title.js';
import type { TimelineTitleActionHandler, TimelineTitleLinkHandler } from './TimelineTitleView.js';

const TITLE_OPTIONS = { summaryStyle: 'bundle' as const, workStyle: 'default' as const };

function systemRowLabel(row: Extract<ThreadTimelineViewRow, { kind: 'system' }>): string {
  if (row.systemKind === 'operation' && row.operationKind === 'thread-provisioning') {
    return row.title?.trim() || 'Provisioned thread';
  }
  return row.detail ? `${row.title} — ${row.detail}` : row.title;
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
}

export function TimelineRows(props: TimelineRowsProps) {
  const { rows, unreadRowId } = props;
  const activeLatestBundleId = findActiveLatestBundleId(rows);
  return (
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
            <TimelineRowView {...props} row={row} title={title} />
          </div>
        );
      })}
    </>
  );
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
  threadId
}: TimelineRowsProps & { row: ThreadTimelineViewRow; title: TimelineTitle }) {
  const autoOpen = isAutoExpandedRow(row.id, expansion);
  const dim = isPastWorkRow(row) && !autoOpen && !(row.kind === 'bundle-summary' && findActiveLatestBundleId([row]) === row.id);
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
    threadId
  };

  if (row.kind === 'conversation') {
    return <ConversationRow row={row} onCopy={onCopy} />;
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
      <div className="thread-timeline-turn" data-row-id={row.id}>
        <TimelineRows rows={row.children ?? []} {...nestedProps} />
      </div>
    );
  }

  const nested = row.kind === 'work' && row.workKind === 'delegation'
    ? <TimelineRows rows={row.childRows} {...nestedProps} />
    : row.kind === 'bundle-summary' || row.kind === 'step-summary'
      ? <TimelineRows rows={row.children} {...nestedProps} />
      : null;

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

  return (
    <ExpandableTimelineRow
      testId="thread-work-row"
      rowId={row.id}
      status={'status' in row ? row.status : undefined}
      dim={dim}
      open={autoOpen || (pending && !awaitingUser)}
      expandable={expandable && hasBody}
      summary={summary}
    >
      {body}
      {nested}
    </ExpandableTimelineRow>
  );
}
