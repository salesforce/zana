import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function ExpandableTimelineRow({
  open = false,
  dim,
  testId,
  status,
  rowId,
  summary,
  children,
  expandable = true
}: {
  open?: boolean;
  dim?: boolean;
  testId?: string;
  status?: string;
  rowId?: string;
  summary: ReactNode;
  children?: ReactNode;
  expandable?: boolean;
}) {
  const className = [
    'thread-timeline-work',
    dim ? 'is-dim' : '',
    open ? 'is-open' : ''
  ].filter(Boolean).join(' ');

  if (!expandable || !children) {
    return (
      <article
        className={className}
        data-testid={testId}
        data-status={status}
        data-row-id={rowId}
      >
        <div className="thread-timeline-work-header">{summary}</div>
      </article>
    );
  }

  return (
    <details
      className={className}
      data-testid={testId}
      data-status={status}
      data-row-id={rowId}
      open={open}
    >
      <summary className="thread-timeline-work-header">
        <ChevronRight size={12} className="thread-timeline-work-chevron" aria-hidden="true" />
        {summary}
      </summary>
      <div className="thread-timeline-work-detail">{children}</div>
    </details>
  );
}
