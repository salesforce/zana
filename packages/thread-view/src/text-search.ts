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

const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const INLINE_CODE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/gu;

/** Visible text of a markdown run that holds no code: syntax goes, labels stay. */
function markdownProseText(text: string): string {
  // Escaped characters are literal: park them so no rule below reads them as syntax.
  const escaped: string[] = [];
  return text
    .replace(/\\([!-/:-@[-`{-~])/gu, (_, char: string) => `\uE000${escaped.push(char) - 1}\uE001`)
    .replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*$/gmu, "")
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/gu, "")
    .replace(/\[([^\]\n]*)\](?:\([^)\n]*\)|\[[^\]\n]*\])/gu, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/giu, "$1")
    .replace(/^ {0,3}#{1,6}[ \t]+/gmu, "")
    .replace(/^ {0,3}(?:>[ \t]?)+/gmu, "")
    .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gmu, "")
    .replace(/^ {0,3}(?:[-*_][ \t]*){3,}$/gmu, "")
    .replace(/^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*(?::?-+:?[ \t]*)?$/gmu, "")
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/gu, "$2")
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gu, "$1$2")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, "$1$2")
    .replace(/\uE000(\d+)\uE001/gu, (_, index: string) => escaped[Number(index)]!);
}

/**
 * The text a markdown message shows once rendered, so a match count agrees
 * with what the reader sees: link and emphasis syntax, heading, quote and
 * list markers, table rules and images (which render as pictures) are
 * dropped; code keeps its literal text. It approximates the renderer (raw
 * HTML, math and diagrams are left as written); where the two disagree the
 * renderer marks the row instead of a range.
 */
export function threadSearchMarkdownText(markdown: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (prose.length === 0) return;
    const run = prose.join("\n");
    let last = 0;
    for (const match of run.matchAll(INLINE_CODE)) {
      out.push(markdownProseText(run.slice(last, match.index)), match[2]!);
      last = match.index + match[0].length;
    }
    out.push(markdownProseText(run.slice(last)), "\n");
    prose = [];
  };
  for (const line of markdown.split("\n")) {
    const marker = line.match(FENCE)?.[1];
    if (fence !== null) {
      const closes = marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length
        && line.trim().length === marker.length;
      if (closes) fence = null;
      else out.push(line, "\n");
      continue;
    }
    if (marker !== undefined) {
      flush();
      fence = marker;
      continue;
    }
    prose.push(line);
  }
  flush();
  // Every line above was pushed with its newline; the last one has none.
  return out.join("").slice(0, -1);
}
