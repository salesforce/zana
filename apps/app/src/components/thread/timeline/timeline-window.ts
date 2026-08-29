export const TIMELINE_WINDOW_SIZE = 200;
export const TERMINAL_EXPANSION_RETENTION = 24;

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
