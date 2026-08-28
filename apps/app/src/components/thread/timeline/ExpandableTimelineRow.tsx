import { ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { TimelineWorkGlyph } from './TimelineWorkGlyph.js';
import type { TimelineWorkRowGlyph } from '@zana-ai/zcc-thread-view';
import {
  resolveExpansionLatch,
  type ManualExpansionOverride
} from './expansion-latch.js';

export function ExpandableTimelineRow({
  open,
  autoExpanded = false,
  terminalAutoExpanded = false,
  forceExpanded = false,
  dim,
  testId,
  status,
  rowId,
  summary,
  children,
  expandable = true,
  glyph,
  onToggle
}: {
  open?: boolean;
  autoExpanded?: boolean;
  terminalAutoExpanded?: boolean;
  forceExpanded?: boolean;
  dim?: boolean;
  testId?: string;
  status?: string;
  rowId?: string;
  summary: ReactNode;
  children?: ReactNode;
  expandable?: boolean;
  glyph?: TimelineWorkRowGlyph | null;
  onToggle?: (open: boolean) => void;
}) {
  const [manualExpansionOverride, setManualExpansionOverride] =
    useState<ManualExpansionOverride>(null);
  const [terminalLatch, setTerminalLatch] = useState(terminalAutoExpanded);
  useEffect(() => {
    if (terminalAutoExpanded) setTerminalLatch(true);
  }, [terminalAutoExpanded]);

  const controlled = typeof onToggle === 'function';
  const isExpanded = controlled
    ? Boolean(open)
    : resolveExpansionLatch({
      expandable,
      forceExpanded: forceExpanded || open === true,
      autoExpanded,
      terminalAutoExpanded,
      terminalLatch,
      manualOverride: manualExpansionOverride
    });

  const className = [
    'thread-timeline-work',
    dim ? 'is-dim' : '',
    isExpanded ? 'is-open' : ''
  ].filter(Boolean).join(' ');
  const header = (
    <>
      {glyph ? <TimelineWorkGlyph name={glyph} /> : null}
      {summary}
    </>
  );

  if (!expandable) {
    return (
      <article
        className={className}
        data-testid={testId}
        data-status={status}
        data-row-id={rowId}
      >
        <div className="thread-timeline-work-header">{header}</div>
      </article>
    );
  }

  return (
    <article
      className={className}
      data-testid={testId}
      data-status={status}
      data-row-id={rowId}
    >
      <button
        type="button"
        className="thread-timeline-work-header"
        aria-expanded={isExpanded}
        onClick={() => {
          const next = !isExpanded;
          if (controlled) onToggle?.(next);
          else setManualExpansionOverride(next);
        }}
      >
        <ChevronRight size={12} className="thread-timeline-work-chevron" aria-hidden="true" />
        {header}
      </button>
      {children != null ? (
        <div className="thread-timeline-work-detail" hidden={!isExpanded}>
          {children}
        </div>
      ) : null}
    </article>
  );
}
