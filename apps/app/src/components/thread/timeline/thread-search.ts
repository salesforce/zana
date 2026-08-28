import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';

export interface TimelineSearchOutlineItem {
  id: string;
  preview: string;
}

export interface TimelineSearchHit {
  id: string;
  ancestorIds: string[];
}

function rowSearchText(row: ThreadTimelineViewRow): string {
  const bits: string[] = [row.kind];
  if ('text' in row && typeof row.text === 'string') bits.push(row.text);
  if ('title' in row && typeof row.title === 'string') bits.push(row.title);
  if ('detail' in row && typeof row.detail === 'string') bits.push(row.detail);
  if ('output' in row && typeof row.output === 'string') bits.push(row.output);
  return bits.join(' ');
}

function childRows(row: ThreadTimelineViewRow): readonly ThreadTimelineViewRow[] {
  if (row.kind === 'turn' || row.kind === 'bundle-summary' || row.kind === 'step-summary') {
    return row.children ?? [];
  }
  if (row.kind === 'work' && row.workKind === 'delegation') return row.childRows;
  return [];
}

function visitSearch(
  rows: readonly ThreadTimelineViewRow[],
  query: string,
  ancestors: string[],
  hits: TimelineSearchHit[]
): void {
  for (const row of rows) {
    const text = rowSearchText(row).toLowerCase();
    if (text.includes(query)) {
      hits.push({ id: row.id, ancestorIds: [...ancestors] });
    }
    const nested = childRows(row);
    if (nested.length > 0) visitSearch(nested, query, [...ancestors, row.id], hits);
  }
}

export function findDeepestTimelineSearchHit(
  rows: readonly ThreadTimelineViewRow[],
  query: string,
  outline: readonly TimelineSearchOutlineItem[] = []
): TimelineSearchHit | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const hits: TimelineSearchHit[] = [];
  visitSearch(rows, needle, [], hits);
  if (hits.length > 0) return hits[hits.length - 1] ?? null;
  const outlineHit = [...outline].reverse().find((item) => item.preview.toLowerCase().includes(needle));
  return outlineHit ? { id: outlineHit.id, ancestorIds: [] } : null;
}

export function timelineContainsRowId(rows: readonly ThreadTimelineViewRow[], id: string): boolean {
  for (const row of rows) {
    if (row.id === id) return true;
    if (timelineContainsRowId(childRows(row), id)) return true;
  }
  return false;
}
