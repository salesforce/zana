import { useMemo, useState, type ReactNode } from 'react';
import {
  buildTimelineRowTitle,
  buildTimelineViewRows,
  durationToCompactString,
  findActiveLatestBundleId,
  type ThreadTimelineViewRow,
  type TimelineTitle,
  type TimelineTitleDecoration
} from '@zana-ai/zcc-thread-view';
import type { ActiveThinking, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { MarkdownContent } from '../MarkdownContent.js';
import { isBusyThreadStatus, visiblePendingTodos, workRowBody } from './thread-timeline-model.js';

const TITLE_OPTIONS = { summaryStyle: 'bundle' as const, workStyle: 'default' as const };

function decorationText(decoration: TimelineTitleDecoration, now: number): string | null {
  if (decoration.kind === 'duration') {
    const elapsed = (decoration.completedAt ?? now) - decoration.startedAt;
    const compact = durationToCompactString(elapsed);
    return compact ? compact : null;
  }
  if (decoration.kind === 'status') return decoration.status;
  if (decoration.kind === 'summary-status') {
    const parts = [];
    if (decoration.errorCount > 0) parts.push(`${decoration.errorCount} error`);
    if (decoration.interruptedCount > 0) parts.push(`${decoration.interruptedCount} interrupted`);
    return parts.join(', ') || null;
  }
  if (decoration.kind === 'diff-stats') return `+${decoration.added} −${decoration.removed}`;
  return null;
}

function TimelineTitleText({ title, now }: { title: TimelineTitle; now: number }) {
  return (
    <span className="thread-timeline-title">
      {title.segments.map((segment, index) => (
        <span
          key={`${segment.text}-${index}`}
          className={[
            segment.em ? 'is-em' : '',
            segment.shimmer ? 'is-shimmer' : '',
            segment.truncate ? 'is-truncate' : '',
            segment.accent ? `accent-${segment.accent}` : ''
          ].filter(Boolean).join(' ')}
        >
          {segment.text}
        </span>
      ))}
      {title.decorations.map((decoration, index) => {
        const text = decorationText(decoration, now);
        if (!text) return null;
        return (
          <span key={`${decoration.kind}-${index}`} className="thread-timeline-title-deco">
            {text}
          </span>
        );
      })}
    </span>
  );
}

function ConversationRow({
  row
}: {
  row: Extract<ThreadTimelineViewRow, { kind: 'conversation' }>;
}) {
  const testId = row.role === 'assistant' ? 'thread-assistant-text' : 'thread-user-text';
  return (
    <article className={`thread-timeline-row is-${row.role}`} data-testid={testId}>
      {row.text?.trim() ? <MarkdownContent text={row.text} /> : null}
    </article>
  );
}

function ExpandableWork({
  row,
  title,
  now,
  children
}: {
  row: ThreadTimelineViewRow;
  title: TimelineTitle;
  now: number;
  children?: ReactNode;
}) {
  const pending = 'status' in row && row.status === 'pending';
  const body = row.kind === 'work' ? workRowBody(row) : '';
  const nested = children ?? null;
  if (!body && !nested) {
    return (
      <article className="thread-timeline-work" data-testid="thread-work-row" data-status={'status' in row ? row.status : undefined}>
        <TimelineTitleText title={title} now={now} />
      </article>
    );
  }
  return (
    <details
      className="thread-timeline-work"
      data-testid="thread-work-row"
      data-status={'status' in row ? row.status : undefined}
      open={pending}
    >
      <summary>
        <TimelineTitleText title={title} now={now} />
      </summary>
      {body ? <pre className="thread-timeline-work-body">{body}</pre> : null}
      {nested}
    </details>
  );
}

function TimelineRows({
  rows,
  now
}: {
  rows: ThreadTimelineViewRow[];
  now: number;
}) {
  const activeLatestBundleId = findActiveLatestBundleId(rows);
  return (
    <>
      {rows.map((row) => {
        const title = buildTimelineRowTitle(row, {
          ...TITLE_OPTIONS,
          isActiveLatestBundle: row.kind === 'bundle-summary' && row.id === activeLatestBundleId
        });
        if (row.kind === 'conversation') {
          return <ConversationRow key={row.id} row={row} />;
        }
        if (row.kind === 'system') {
          return (
            <p key={row.id} className="thread-timeline-system" data-testid="thread-system-row">
              {row.title}{row.detail ? ` — ${row.detail}` : ''}
            </p>
          );
        }
        if (row.kind === 'turn') {
          return (
            <div key={row.id} className="thread-timeline-turn">
              <TimelineRows rows={row.children ?? []} now={now} />
            </div>
          );
        }
        if (row.kind === 'work' && row.workKind === 'delegation') {
          return (
            <ExpandableWork key={row.id} row={row} title={title} now={now}>
              <TimelineRows rows={row.childRows} now={now} />
            </ExpandableWork>
          );
        }
        if (row.kind === 'bundle-summary' || row.kind === 'step-summary') {
          return (
            <ExpandableWork key={row.id} row={row} title={title} now={now}>
              <TimelineRows rows={row.children} now={now} />
            </ExpandableWork>
          );
        }
        return <ExpandableWork key={row.id} row={row} title={title} now={now} />;
      })}
    </>
  );
}

export function ThreadTodoCard({ todos }: { todos: ThreadTimelinePendingTodos | null }) {
  const visible = visiblePendingTodos(todos);
  if (!visible) return null;
  const done = visible.items.filter((item) => item.status === 'completed').length;
  return (
    <section className="thread-todo-card" data-testid="thread-todos">
      <h2>{done}/{visible.items.length} complete</h2>
      <ul>
        {[...visible.items]
          .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'))
          .map((item) => (
            <li key={item.id} data-status={item.status}>{item.text}</li>
          ))}
      </ul>
    </section>
  );
}

export function ThreadWorkingIndicator({
  status,
  thinking
}: {
  status: string;
  thinking: ActiveThinking | null;
}) {
  if (!isBusyThreadStatus(status) && !thinking) return null;
  const label = thinking?.text?.trim() ? thinking.text : thinking ? 'Thinking…' : 'Working…';
  return (
    <p className="thread-working-indicator is-shimmer" data-testid="thread-thinking">
      {label}
    </p>
  );
}

export function ThreadTimeline({
  rows,
  status,
  thinking,
  todos
}: {
  rows: TimelineRow[];
  status: string;
  thinking: ActiveThinking | null;
  todos: ThreadTimelinePendingTodos | null;
}) {
  const [now] = useState(() => Date.now());
  const viewRows = useMemo(() => buildTimelineViewRows(rows), [rows]);
  return (
    <div className="thread-detail-timeline" data-testid="thread-timeline">
      {viewRows.length === 0 ? (
        <p className="thread-detail-empty">Waiting for the first turn…</p>
      ) : (
        <TimelineRows rows={viewRows} now={now} />
      )}
      <ThreadWorkingIndicator status={status} thinking={thinking} />
      <ThreadTodoCard todos={todos} />
    </div>
  );
}
