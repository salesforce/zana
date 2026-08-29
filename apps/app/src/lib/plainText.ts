/**
 * Flatten a single line of markdown source to plain, scannable text.
 *
 * The inbox sidebar preview and the saved-report title both derive their text
 * from freeform markdown `comments`. They live in plain-text slots (a truncated
 * one-liner, a filename), so raw markdown syntax leaks in verbatim — e.g.
 * `**Update available — v1.0.1**` rendered a trailing `**`, and `` `npm run dev` ``
 * kept its backticks. This strips the markup instead of just the *leading*
 * block markers, so paired inline emphasis (`**bold**`, `` `code` ``, `_em_`,
 * `~~strike~~`) and links unwrap fully.
 *
 * Deliberately a lightweight text sweep, NOT a markdown parse: it runs on the
 * hot list-render path and only needs to be right for the first line of a
 * comment, never to reconstruct structure.
 */
export function mdToPlainText(input: string): string {
  let s = input.trim();
  if (!s) return '';

  // Leading block markers: heading #, blockquote >, list bullet -/*/+, and any
  // mix of surrounding whitespace.
  s = s.replace(/^[#>\s]*[-*+]?\s+/, '');

  // Images ![alt](url) → alt, then links [text](url) → text. Images first so the
  // link rule doesn't eat the leading `!`.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Inline code: drop the backtick fences, keep the content. Handles ``double``
  // fences too.
  s = s.replace(/`+([^`]*)`+/g, '$1');

  // Paired emphasis / strikethrough — longest markers first so `**` isn't left
  // half-stripped by the `*` rule.
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/_([^_]+)_/g, '$1');

  // Any orphan markers left by unbalanced source (a lone `**`, stray backtick).
  s = s.replace(/[*_~`]+/g, '');

  // Collapse the whitespace a stripped marker may have straddled.
  return s.replace(/\s+/g, ' ').trim();
}
