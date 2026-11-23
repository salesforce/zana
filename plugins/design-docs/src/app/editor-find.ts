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
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'tabSize'
] as const;
const FALLBACK_LINE_HEIGHT = 20;

/** Vertical offset of the line holding `offset`, measured in an off-screen copy of the textarea. */
function offsetTopOf(textarea: HTMLTextAreaElement, offset: number): { top: number; lineHeight: number } {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const name of MIRRORED_STYLES) mirror.style[name] = style[name];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  const marker = document.createElement('span');
  marker.textContent = '.';
  mirror.append(textarea.value.slice(0, offset), marker);
  document.body.append(mirror);
  try {
    const lineHeight = Number.parseFloat(style.lineHeight) || FALLBACK_LINE_HEIGHT;
    return { top: marker.offsetTop, lineHeight };
  } finally {
    mirror.remove();
  }
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
