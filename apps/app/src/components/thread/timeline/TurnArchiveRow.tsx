import { useEffect, useState } from 'react';
import { buildTimelineViewRows, type ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { product } from '../../../lib/product-client.js';
import { ExpandableTimelineRow } from './ExpandableTimelineRow.js';
import { TimelineRows } from './TimelineRows.js';
import type { TimelineTitle } from '@zana-ai/zcc-thread-view';
import { TimelineTitleView } from './TimelineTitleView.js';
import type { TimelineTitleActionHandler, TimelineTitleLinkHandler } from './TimelineTitleView.js';
import type { collectTimelineAutoExpansionRowIds } from './timeline-auto-expand.js';
import { StencilLines } from '../../ui/Skeleton.js';

export function TurnArchiveRow({
  row,
  title,
  now,
  dim,
  expansion,
  unreadRowId,
  onCopy,
  onTitleAction,
  onTitleLink,
  onOpenDiff,
  threadId,
  streamingAssistantMessageId,
  forceExpandedRowIds,
  projectId,
  parentThreadId,
  threadIdle,
  onFork
}: {
  row: Extract<ThreadTimelineViewRow, { kind: 'turn' }>;
  title: TimelineTitle;
  now: number;
  dim?: boolean;
  expansion: ReturnType<typeof collectTimelineAutoExpansionRowIds>;
  unreadRowId?: string | null;
  onCopy?: (text: string) => void;
  onTitleAction?: TimelineTitleActionHandler;
  onTitleLink?: TimelineTitleLinkHandler;
  onOpenDiff?: (path: string) => void;
  threadId?: string;
  streamingAssistantMessageId?: string | null;
  forceExpandedRowIds?: ReadonlySet<string>;
  projectId?: string | null;
  parentThreadId?: string | null;
  threadIdle?: boolean;
  onFork?: (sourceSeqEnd?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<ThreadTimelineViewRow[] | null>(row.children);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setChildren(row.children);
  }, [row.children]);

  useEffect(() => {
    if (!open || children !== null || !threadId) return;
    let cancelled = false;
    setLoading(true);
    void product.threads.timelineTurnSummaryDetails(threadId, {
      turnId: row.turnId,
      sourceSeqStart: String(row.sourceSeqStart),
      sourceSeqEnd: String(row.sourceSeqEnd)
    }).then((body) => {
      if (cancelled) return;
      setChildren(buildTimelineViewRows((body.rows as TimelineRow[]) ?? []));
    }).catch(() => {
      if (!cancelled) setChildren([]);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [children, open, row.sourceSeqEnd, row.sourceSeqStart, row.turnId, threadId]);

  return (
    <ExpandableTimelineRow
      testId="thread-turn-summary"
      rowId={row.id}
      status={row.status}
      dim={dim}
      open={open || forceExpandedRowIds?.has(row.id) === true}
      expandable
      onToggle={setOpen}
      summary={(
        <TimelineTitleView
          title={title}
          now={now}
          onAction={onTitleAction}
          onLink={onTitleLink}
        />
      )}
    >
      {loading ? (
        <div data-testid="thread-turn-loading">
          <StencilLines label="Loading turn" widths={['70%', '55%', '40%']} />
        </div>
      ) : children && children.length > 0 ? (
        <TimelineRows
          rows={children}
          now={now}
          expansion={expansion}
          unreadRowId={unreadRowId}
          onCopy={onCopy}
          onTitleAction={onTitleAction}
          onTitleLink={onTitleLink}
          onOpenDiff={onOpenDiff}
          threadId={threadId}
          nested
          compactActivityIntents
        streamingAssistantMessageId={streamingAssistantMessageId}
        forceExpandedRowIds={forceExpandedRowIds}
        projectId={projectId}
        parentThreadId={parentThreadId}
        threadIdle={threadIdle}
        onFork={onFork}
      />
      ) : open ? (
        <p className="thread-timeline-system">No details</p>
      ) : null}
    </ExpandableTimelineRow>
  );
}
