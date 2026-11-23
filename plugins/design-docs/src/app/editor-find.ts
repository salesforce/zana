/** Pure helpers for find in the text editor: match offsets, and scrolling a match into view. */

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/gu;

/**
 * Start offsets of every case-insensitive, non-overlapping occurrence of
 * `query` in `text`. A regular expression (not `toLowerCase`) keeps offsets
 * valid for characters whose lower-case form has a different length.
 */
export function findMatchOffsets(text: string, query: string): number[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(REGEXP_SPECIALS, '\\$&'), 'giu');
  const offsets: number[] = [];
  for (const match of text.matchAll(pattern)) offsets.push(match.index);
  return offsets;
}

/** Next index in a ring of `count` matches; -1 when there are none. */
export function stepIndex(current: number, direction: 1 | -1, count: number): number {
  if (count === 0) return -1;
  return (Math.min(current, count - 1) + direction + count) % count;
}

const MIRRORED_STYLES = [
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
  'letterSpacing', 'wordSpacing', 'wordBreak', 'textTransform', 'textIndent', 'lineHeight', 'tabSize'
] as const;
const FALLBACK_LINE_HEIGHT = 20;
const MARKER = String.fromCharCode(0x200b);

/**
 * Vertical offset of the line holding `offset`, measured in an off-screen copy
 * of the textarea. The copy has the textarea's usable width (`clientWidth`:
 * without the scrollbar) and the whole text, with only a zero-width marker
 * inserted, so every line wraps exactly as it does in the textarea.
 */
function offsetTopOf(textarea: HTMLTextAreaElement, offset: number): { top: number; lineHeight: number } {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const name of MIRRORED_STYLES) mirror.style[name] = style[name];
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', boxSizing: 'border-box', border: '0',
    width: `${textarea.clientWidth}px`, whiteSpace: 'pre-wrap', overflowWrap: 'break-word'
  });
  const marker = document.createElement('span');
  marker.textContent = MARKER;
  mirror.append(textarea.value.slice(0, offset), marker, textarea.value.slice(offset));
  document.body.append(mirror);
  try {
    const lineHeight = Number.parseFloat(style.lineHeight) || FALLBACK_LINE_HEIGHT;
    return { top: marker.offsetTop, lineHeight };
  } finally {
    mirror.remove();
  }
}

/** The first match at or after `anchor` (the caret when find opened), wrapping to the first; -1 when there are none. */
export function nearestIndex(offsets: number[], anchor: number): number {
  if (offsets.length === 0) return -1;
  const found = offsets.findIndex((offset) => offset >= anchor);
  return found === -1 ? 0 : found;
}

/** Selects the match without taking focus, and scrolls the textarea so it is on screen (centred when it was not). */
export function revealMatch(textarea: HTMLTextAreaElement, start: number, length: number): void {
  textarea.setSelectionRange(start, start + length);
  const { top, lineHeight } = offsetTopOf(textarea, start);
  const visibleTop = textarea.scrollTop;
  const visibleBottom = visibleTop + textarea.clientHeight;
  if (top >= visibleTop && top + lineHeight <= visibleBottom) return;
  textarea.scrollTop = Math.max(0, top - (textarea.clientHeight - lineHeight) / 2);
}

export interface HighlightSegment {
  text: string;
  /** `current` is the match find is on; `match` any other painted match; absent for plain text. */
  hit?: 'current' | 'match';
}

/** Matches painted around the current one: a textarea can hold thousands, and only the ones near the view matter. */
export const MAX_PAINTED_MATCHES = 1500;
export const PAINT_WINDOW_CHARS = 30_000;

/**
 * The text split into plain and highlighted runs for the backdrop that sits
 * behind the textarea. Only matches within a window around the current one
 * are marked, and at most `MAX_PAINTED_MATCHES`, so a very common query
 * stays cheap; the text itself is always complete, so line wrapping matches.
 */
export function highlightSegments(text: string, offsets: number[], length: number, current: number): HighlightSegment[] {
  if (current < 0 || length === 0) return [{ text }];
  const center = offsets[current];
  const painted = offsets
    .map((offset, index) => ({ offset, index }))
    .filter(({ offset }) => Math.abs(offset - center) <= PAINT_WINDOW_CHARS)
    .slice(0, MAX_PAINTED_MATCHES);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const { offset, index } of painted) {
    if (offset > cursor) segments.push({ text: text.slice(cursor, offset) });
    segments.push({ text: text.slice(offset, offset + length), hit: index === current ? 'current' : 'match' });
    cursor = offset + length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
