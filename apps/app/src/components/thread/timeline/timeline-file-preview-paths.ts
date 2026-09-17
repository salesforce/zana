import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';

/**
 * Reuse `previous` when contents match so memoized markdown does not remount
 * on every transcript tick while the path list is unchanged.
 */
export function reuseStringListIfEqual(
  previous: readonly string[] | undefined,
  next: readonly string[]
): readonly string[] {
  if (
    previous &&
    previous.length === next.length &&
    previous.every((value, index) => value === next[index])
  ) {
    return previous;
  }
  return next;
}

/**
 * Workspace paths from file-change / file-read rows, in timeline order so a
 * later write wins when resolving a bare `` `file.md` `` chip.
 */
export function collectTimelineFilePreviewPaths(
  rows: readonly ThreadTimelineViewRow[]
): string[] {
  const out: string[] = [];
  visit(rows, out);
  return out;
}

function visit(rows: readonly ThreadTimelineViewRow[], out: string[]): void {
  for (const row of rows) {
    if (row.kind === 'work') {
      if (row.workKind === 'file-change') {
        if (row.change.path) out.push(row.change.path);
        if (row.change.movePath) out.push(row.change.movePath);
      } else if (row.workKind === 'file-read' && row.path) {
        out.push(row.path);
      } else if (row.workKind === 'delegation') {
        visit(row.childRows, out);
      }
    } else if (row.kind === 'bundle-summary' || row.kind === 'step-summary') {
      visit(row.children, out);
    } else if (row.kind === 'turn' && row.children) {
      visit(row.children, out);
    }
  }
}
