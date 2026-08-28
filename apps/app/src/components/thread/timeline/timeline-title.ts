import {
  durationToCompactString,
  type TimelineTitleDecoration
} from '@zana-ai/zcc-thread-view';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';

export function decorationText(decoration: TimelineTitleDecoration, now: number): string | null {
  if (decoration.kind === 'duration') {
    const elapsed = (decoration.completedAt ?? now) - decoration.startedAt;
    if (elapsed <= 1000 && decoration.completedAt == null) return null;
    const compact = durationToCompactString(elapsed);
    return compact ? compact : null;
  }
  if (decoration.kind === 'status') return decoration.status;
  if (decoration.kind === 'summary-status') {
    const parts = [];
    if (decoration.errorCount > 0) {
      parts.push(`${decoration.errorCount} ${decoration.errorCount === 1 ? 'error' : 'errors'}`);
    }
    if (decoration.interruptedCount > 0) {
      parts.push(
        `${decoration.interruptedCount} ${decoration.interruptedCount === 1 ? 'interrupted' : 'interrupted'}`
      );
    }
    return parts.join(', ') || null;
  }
  if (decoration.kind === 'diff-stats') return `+${decoration.added} −${decoration.removed}`;
  return null;
}

export function decorationClass(decoration: TimelineTitleDecoration): string {
  if (decoration.kind === 'status' && decoration.status === 'error' && decoration.emphasis) {
    return 'thread-timeline-title-deco is-error';
  }
  if (decoration.kind === 'summary-status' && decoration.errorCount > 0) {
    return 'thread-timeline-title-deco is-error';
  }
  return 'thread-timeline-title-deco';
}

export function titleSegmentClass(segment: {
  em?: boolean;
  shimmer?: boolean;
  truncate?: boolean;
  accent?: string;
}): string {
  return [
    segment.em ? 'is-em' : '',
    segment.shimmer ? 'is-shimmer' : '',
    segment.truncate ? 'is-truncate' : '',
    segment.accent ? `accent-${segment.accent}` : ''
  ].filter(Boolean).join(' ');
}

export function isPastWorkRow(row: { kind: string; status?: string }): boolean {
  if (row.kind === 'step-summary' || row.kind === 'turn') return true;
  if (row.kind === 'bundle-summary') return row.status === 'completed';
  if (row.kind === 'work' || row.kind === 'system') {
    return row.status === 'completed';
  }
  return false;
}

export function pastRowDimClassName(args: {
  row: ThreadTimelineViewRow;
  activeLatestBundleId: string | null;
  autoOpen: boolean;
}): boolean {
  const { row, activeLatestBundleId, autoOpen } = args;
  if (autoOpen) return false;
  if (row.kind === 'conversation') return false;
  if (row.kind === 'bundle-summary' && row.id === activeLatestBundleId) return false;
  if (row.kind === 'work' && (row.status === 'error' || row.status === 'interrupted' || row.status === 'pending')) {
    return false;
  }
  if (row.kind === 'system' && (row.status === 'error' || row.status === 'pending')) return false;
  return isPastWorkRow(row);
}
