/**
 * Find-in-thread matching, shared by the server outline (which counts matches
 * in messages the client has not loaded) and the renderer (which counts and
 * highlights loaded rows), so both sides agree on what one match is.
 *
 * Matching is case-insensitive and literal; matches do not overlap.
 */
export const THREAD_SEARCH_QUERY_MAX = 200;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A global, case-insensitive pattern for the trimmed query, or null when it is empty. */
export function threadSearchPattern(query: string): RegExp | null {
  const needle = query.trim().slice(0, THREAD_SEARCH_QUERY_MAX);
  if (!needle) return null;
  // `iu` folds case without changing string offsets, unlike toLowerCase().
  return new RegExp(escapeRegExp(needle), "giu");
}

/** Start/end offsets of every match of `pattern` in `text`. */
export function threadSearchRanges(
  text: string,
  pattern: RegExp,
): Array<[start: number, end: number]> {
  return Array.from(text.matchAll(pattern), (match): [number, number] => [
    match.index,
    match.index + match[0].length,
  ]);
}

export function countThreadSearchMatches(text: string, pattern: RegExp): number {
  let count = 0;
  for (const _ of text.matchAll(pattern)) count += 1;
  return count;
}
