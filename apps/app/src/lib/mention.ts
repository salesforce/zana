/**
 * `@`-mention detection — the pure core behind the composer's file-insert
 * popover. Given the textarea's current `value` and caret offset, decide whether
 * the caret currently sits inside an active `@token`, and if so return the token
 * text and the offset of its `@`.
 *
 * No I/O, no React — so it's trivially unit-testable and runs identically
 * wherever the composer lives. The UI layer (PromptComposer) owns the file list,
 * fuzzy ranking, popover, and the actual splice; this module owns only "is there
 * a mention here, and what is its query?".
 *
 * A mention is active when, scanning left from the caret:
 *   - we hit an `@` before a tab or newline, AND
 *   - that `@` is at the very start or is itself preceded by whitespace
 *     (so an `a@b` email or a `foo@` mid-word never triggers).
 * Ordinary spaces stay in the query so titles like "Hello world" match.
 * Tabs and newlines still end the mention.
 *
 * The query may be empty (caret right after a bare `@`), which is a valid state
 * the UI uses to show the project's most-recent / top files.
 */

export interface MentionMatch {
  /** Text between the `@` and the caret (may be empty). */
  query: string;
  /** Offset of the `@` in the value; the splice replaces `[start, caret)`. */
  start: number;
}

/** Tabs and newlines end the mention; ordinary spaces do not. */
const END_RE = /[\t\n\r]/;
/** Word-boundary check for the character before `@`. */
const WS_RE = /\s/;

/**
 * Detect an active `@`-mention at `caret` within `value`. Returns `null` when
 * the caret is not inside a mention token.
 */
export function detectMention(value: string, caret: number): MentionMatch | null {
  if (caret < 0 || caret > value.length) return null;
  // Scan left from the caret looking for the `@` that opens the token.
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === '@') {
      const before = i > 0 ? value[i - 1] : '';
      // The `@` must start a word: at string start or after whitespace.
      if (before !== '' && !WS_RE.test(before)) return null;
      return { query: value.slice(i + 1, caret), start: i };
    }
    if (END_RE.test(ch)) return null;
    i--;
  }
  return null;
}

/**
 * Splice a chosen value in place of the `@query` token, ensuring exactly one
 * space follows so the next word doesn't fuse onto it. Returns the new text plus
 * the caret offset to restore (just past the inserted token + its space).
 *
 * `insert` is the raw text to drop in (e.g. a posix `rel` path); the leading `@`
 * is preserved so the result reads `@src/foo.ts `. Any whitespace already at the
 * caret is collapsed into that single space rather than doubled.
 */
export function applyMention(
  value: string,
  match: MentionMatch,
  caret: number,
  insert: string
): { value: string; caret: number } {
  const before = value.slice(0, match.start);
  const after = value.slice(caret).replace(/^\s+/, ''); // absorb existing gap
  const token = `@${insert} `;
  return { value: before + token + after, caret: before.length + token.length };
}
