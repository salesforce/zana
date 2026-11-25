/**
 * Inline-code span scanner for markdown prose.
 *
 * Replaces the regex /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/gu, which CodeQL flags
 * (js/polynomial-redos): on a long run of backticks it retried every start
 * position and every shorter opener, rescanning to the end each time.
 *
 * Semantics (identical to the regex): at a backtick, the opener is the rest of
 * the backtick run from that position (a shorter opener never matches because
 * content must start with a non-backtick). The span closes at the first later
 * maximal backtick run of exactly the same length. When no such run exists the
 * scan retries one backtick further in, with a shorter opener.
 */
export interface InlineCodeSpan {
  /** Index of the first opening backtick. */
  index: number;
  /** Length of the whole span, delimiters included. */
  length: number;
  /** Text between the delimiters. */
  content: string;
}

interface BacktickRun {
  start: number;
  end: number;
}

function collectRuns(text: string): BacktickRun[] {
  const runs: BacktickRun[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) !== 96) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < text.length && text.charCodeAt(i) === 96) i += 1;
    runs.push({ start, end: i });
  }
  return runs;
}

/** Index of the first entry in `starts` (ascending) that is greater than `after`. */
function firstAfter(starts: readonly number[], after: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid]! > after) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function scanInlineCode(text: string): InlineCodeSpan[] {
  const runs = collectRuns(text);
  if (runs.length < 2) return [];
  // Start offsets of every maximal run, grouped by run length.
  const startsByLength = new Map<number, number[]>();
  for (const run of runs) {
    const length = run.end - run.start;
    const starts = startsByLength.get(length);
    if (starts) starts.push(run.start);
    else startsByLength.set(length, [run.start]);
  }

  const spans: InlineCodeSpan[] = [];
  let consumedTo = 0;
  for (const run of runs) {
    if (run.start < consumedTo) continue;
    // Content must start with a non-backtick right after the run.
    if (run.end >= text.length) break;
    let matched = false;
    for (let start = run.start; start < run.end && !matched; start += 1) {
      const openerLength = run.end - start;
      const starts = startsByLength.get(openerLength);
      if (!starts) continue;
      const next = firstAfter(starts, run.end);
      if (next >= starts.length) continue;
      const closer = starts[next]!;
      spans.push({
        index: start,
        length: closer + openerLength - start,
        content: text.slice(run.end, closer)
      });
      consumedTo = closer + openerLength;
      matched = true;
    }
  }
  return spans;
}
