/** Top-level rows kept in the live transcript before "Load older" / Show earlier. */
export const TIMELINE_WINDOW_SIZE = 200;
export const TERMINAL_EXPANSION_RETENTION = 24;

export type OlderHistoryAction =
  | { kind: 'none' }
  | { kind: 'show-earlier'; hiddenCount: number }
  | { kind: 'load-older'; loading: boolean };

/**
 * One control at the top of the transcript: reveal already-loaded rows first,
 * then fetch an older server page. Two stacked buttons made "Load older"
 * look like it only uncovered a handful of rows.
 */
export function olderHistoryAction(opts: {
  hiddenCount: number;
  hasOlderRows: boolean;
  loadingOlder: boolean;
}): OlderHistoryAction {
  if (opts.hiddenCount > 0) return { kind: 'show-earlier', hiddenCount: opts.hiddenCount };
  if (opts.hasOlderRows) return { kind: 'load-older', loading: opts.loadingOlder };
  return { kind: 'none' };
}

export function retainTerminalExpansionIds(
  previous: readonly string[],
  incoming: Iterable<string>,
  cap = TERMINAL_EXPANSION_RETENTION
): string[] {
  const next = [...previous];
  for (const id of incoming) {
    if (!next.includes(id)) next.push(id);
  }
  return next.slice(Math.max(0, next.length - cap));
}

export function windowTimelineRows<T extends { id: string }>(
  rows: readonly T[],
  windowSize = TIMELINE_WINDOW_SIZE,
  options: { showAll?: boolean; keepId?: string | null } = {}
): { visible: readonly T[]; hiddenCount: number } {
  if (options.showAll || rows.length <= windowSize) {
    return { visible: rows, hiddenCount: 0 };
  }
  let start = rows.length - windowSize;
  if (options.keepId) {
    const index = rows.findIndex((row) => row.id === options.keepId);
    if (index < 0) return { visible: rows, hiddenCount: 0 };
    if (index < start) start = index;
  }
  return { visible: rows.slice(start), hiddenCount: start };
}
