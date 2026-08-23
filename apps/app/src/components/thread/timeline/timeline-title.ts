import {
  durationToCompactString,
  type TimelineTitleDecoration
} from '@zana-ai/zcc-thread-view';

export function decorationText(decoration: TimelineTitleDecoration, now: number): string | null {
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
  if (row.kind === 'work' || row.kind === 'bundle-summary' || row.kind === 'step-summary') {
    return row.status === 'completed' || row.status === 'error' || row.status === 'interrupted';
  }
  if (row.kind === 'system') {
    return row.status === 'completed' || row.status === 'error' || row.status === 'interrupted';
  }
  return false;
}
