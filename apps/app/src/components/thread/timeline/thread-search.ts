import { countThreadSearchMatches, threadSearchMarkdownText, threadSearchPattern, type ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import { stripAnsi } from './ansi-output.js';

export interface TimelineSearchHit {
  id: string;
  ancestorIds: string[];
}

/** A match the outline found in a message's full text, possibly not loaded yet. */
export interface TimelineSearchOutlineMatch {
  id: string;
  seq: number;
  count: number;
}

/** One occurrence of the query: the `occurrence`-th match inside row `id`. */
export interface TimelineSearchMatch extends TimelineSearchHit {
  occurrence: number;
  /** In a page older than the loaded rows; reaching it loads earlier history. */
  unloaded?: true;
}

/**
 * The text a row contributes to find-in-thread, in the order it is shown:
 * a message's visible markdown text (as the server counts it), a system
 * row's title and detail, and tool output without ANSI codes. Row chrome
 * (work titles, buttons, file names) is not searched; the renderer marks the
 * same parts with `data-thread-search-content` so highlights agree.
 */
export function timelineRowSearchText(row: ThreadTimelineViewRow): string {
  if (row.kind === 'conversation') return threadSearchMarkdownText(row.text);
  const bits: string[] = [];
  if ('title' in row && typeof row.title === 'string') bits.push(row.title);
  if ('detail' in row && typeof row.detail === 'string') bits.push(row.detail);
  if ('output' in row && typeof row.output === 'string') bits.push(stripAnsi(row.output));
  return bits.join('\n');
}

function childRows(row: ThreadTimelineViewRow): readonly ThreadTimelineViewRow[] {
  if (row.kind === 'turn' || row.kind === 'bundle-summary' || row.kind === 'step-summary') {
    return row.children ?? [];
  }
  if (row.kind === 'work' && row.workKind === 'delegation') return row.childRows;
  return [];
}

function collectRowIds(rows: readonly ThreadTimelineViewRow[], ids: Set<string>): Set<string> {
  for (const row of rows) {
    ids.add(row.id);
    collectRowIds(childRows(row), ids);
  }
  return ids;
}

function sourceSeqRange(row: ThreadTimelineViewRow): [number, number] | null {
  const start = (row as { sourceSeqStart?: unknown }).sourceSeqStart;
  const end = (row as { sourceSeqEnd?: unknown }).sourceSeqEnd;
  return typeof start === 'number' && typeof end === 'number' ? [start, end] : null;
}

/**
 * Every occurrence of `query`, in reading order (oldest first).
 *
 * Loaded rows are counted from their own text, collapsed ones included. The
 * outline adds messages the renderer does not hold: those in older pages
 * (`unloaded`, counted only while earlier history remains) and those inside a
 * completed turn whose detail is fetched on expand (placed under that turn).
 */
export function collectTimelineSearchMatches(
  rows: readonly ThreadTimelineViewRow[],
  query: string,
  options: { outlineMatches?: readonly TimelineSearchOutlineMatch[]; hasOlder?: boolean } = {}
): TimelineSearchMatch[] {
  const pattern = threadSearchPattern(query);
  if (!pattern) return [];
  const loadedIds = collectRowIds(rows, new Set());
  const pending = (options.outlineMatches ?? []).filter((match) => !loadedIds.has(match.id));
  const matches: TimelineSearchMatch[] = [];
  const push = (id: string, count: number, ancestorIds: string[], unloaded = false) => {
    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      matches.push(unloaded ? { id, ancestorIds, occurrence, unloaded: true } : { id, ancestorIds, occurrence });
    }
  };
  if (options.hasOlder && pending.length > 0) {
    const firstSeq = rows.reduce((first, row) => Math.min(first, sourceSeqRange(row)?.[0] ?? first), Number.POSITIVE_INFINITY);
    for (const match of pending) {
      if (match.seq < firstSeq) push(match.id, match.count, [], true);
    }
  }
  const visit = (level: readonly ThreadTimelineViewRow[], ancestors: string[]) => {
    for (const row of level) {
      push(row.id, countThreadSearchMatches(timelineRowSearchText(row), pattern), ancestors);
      const range = row.kind === 'turn' && row.children === null ? sourceSeqRange(row) : null;
      if (range) {
        for (const match of pending) {
          if (match.seq >= range[0] && match.seq <= range[1]) push(match.id, match.count, [...ancestors, row.id]);
        }
        continue;
      }
      const nested = childRows(row);
      if (nested.length > 0) visit(nested, [...ancestors, row.id]);
    }
  };
  visit(rows, []);
  return matches;
}

export function timelineContainsRowId(rows: readonly ThreadTimelineViewRow[], id: string): boolean {
  for (const row of rows) {
    if (row.id === id) return true;
    if (timelineContainsRowId(childRows(row), id)) return true;
  }
  return false;
}

export function findTimelineMessageAtSequence(rows: readonly ThreadTimelineViewRow[], sequence: number, ancestors: string[] = []): TimelineSearchHit | null {
  for (const row of rows) {
    const nested = findTimelineMessageAtSequence(childRows(row), sequence, [...ancestors,row.id]);
    if (nested) return nested;
    if (row.kind === 'conversation' && row.sourceSeqStart <= sequence && row.sourceSeqEnd >= sequence) return {id:row.id, ancestorIds:ancestors};
  }
  return null;
}
