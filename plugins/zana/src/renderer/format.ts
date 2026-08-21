/**
 * Pure string/date formatting helpers for the Tickets view (C3).
 *
 * These are intentionally SDK-free, side-effect-free, host-free: pure string and
 * date operations only. They are safe to lift out of the legacy panel because
 * they touch neither the module bus nor the `'zana'` id (Rule 6).
 *
 * `shortId` is the canonical implementation in `ticketColumns.ts`; it is
 * re-exported here so callers have a single `tickets/format` import surface
 * without forking a second copy of the helper.
 */

export { shortId } from './ticketColumns';

/**
 * Doc-metadata date formatting (created/updated dates in the Docs reading-list).
 * Mirrors the legacy panel's doc formatter (`ZanaPanel.tsx:126-135`): a compact
 * `Mon D, YYYY` form with no time component. Empty string for missing/invalid.
 */
export function fmtDateTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Derive a short plain-text preview from a markdown doc body: strip the common
 * markdown syntax (headings, emphasis, code fences/spans, link syntax, images,
 * blockquotes, list bullets), collapse whitespace, and clip to ~180 chars. This
 * is intentionally lightweight — it gives docs a readable excerpt, not a faithful
 * render (the modal does the real rendering). Lifted from `ZanaPanel.tsx:144-166`.
 */
export function excerptFromMarkdown(md: string, max = 180): string {
  if (!md) return '';
  let text = md;
  // Drop fenced code blocks entirely (their contents make poor previews).
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/~~~[\s\S]*?~~~/g, ' ');
  // Images: ![alt](url) → alt
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links: [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Inline code, emphasis, strikethrough markers.
  text = text.replace(/[`*_~]+/g, '');
  // Leading heading hashes, blockquote markers, list bullets, table pipes.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, '');
  text = text.replace(/\|/g, ' ');
  // Collapse all runs of whitespace to single spaces.
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
