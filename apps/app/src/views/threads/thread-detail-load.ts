import {
  applyTimelineDelta,
  retainLatestTimelineWindow,
  type TimelineDelta,
  type TimelineRow
} from '@zana-ai/zcc-server-contract';

export const THREAD_DETAIL_LOAD_ERROR = 'Could not load the conversation.';

export function threadDetailLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return THREAD_DETAIL_LOAD_ERROR;
}

export function resolveThreadDetailStatus(
  thread: { runtime?: { displayStatus?: string }; status?: string } | null | undefined,
  timelineStatus?: string
): string {
  return thread?.runtime?.displayStatus || thread?.status || timelineStatus || '';
}

export function shouldClearPlaceholderStartingStatus(
  hadThreadRecord: boolean,
  detailFailed: boolean,
  timelineFailed: boolean
): boolean {
  return !hadThreadRecord && detailFailed && timelineFailed;
}

export function resolveTimelinePollRows(args: {
  prevRows: readonly TimelineRow[];
  prevMaxSeq: number;
  useDelta: boolean;
  timeline: {
    delta?: TimelineDelta | { upsertRows: unknown[]; rowOrder?: string[] };
    rows?: unknown[] | null;
    maxSeq?: number;
  };
}): { kind: 'rows'; rows: TimelineRow[] } | { kind: 'stale' } {
  const nextMaxSeq = typeof args.timeline.maxSeq === 'number' ? args.timeline.maxSeq : args.prevMaxSeq;
  if (args.useDelta && args.timeline.delta) {
    const merged = applyTimelineDelta(args.prevRows, args.timeline.delta as TimelineDelta);
    if (merged == null) return { kind: 'stale' };
    return {
      kind: 'rows',
      rows: retainLatestTimelineWindow(
        { maxSeq: args.prevMaxSeq, rows: args.prevRows },
        { maxSeq: nextMaxSeq, rows: merged }
      ).rows as TimelineRow[]
    };
  }
  if (args.useDelta && Array.isArray(args.timeline.rows) && args.timeline.rows.length === 0 && !args.timeline.delta) {
    return { kind: 'stale' };
  }
  const nextRows = (args.timeline.rows as TimelineRow[] | null | undefined) ?? [];
  return {
    kind: 'rows',
    rows: retainLatestTimelineWindow(
      { maxSeq: args.prevMaxSeq, rows: args.prevRows },
      { maxSeq: nextMaxSeq, rows: nextRows }
    ).rows as TimelineRow[]
  };
}
