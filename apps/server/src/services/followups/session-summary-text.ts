/**
 * Pure text helpers for the `builtin:session-summary` reply and for session
 * titles, shared by every place that renders a session summary into the inbox.
 */

const SENTINEL_WINDOW = 6;
const UNFINISHED_RE = /^unfinished:\s*(yes|no)\s*$/i;
const ASKS_USER_RE = /^asks the user:\s*(yes|no)\s*$/i;

const TITLE_MAX = 80;
const LEFT_ITEM_MAX = 90;
const SUMMARY_MAX = 2_400;

/** The summary reply split into its Markdown body and the two closing sentinel lines. */
export interface ParsedSessionSummary {
  body: string;
  unfinished: boolean;
  asksUser: boolean;
  /** True only when both sentinel lines were found. */
  sentinels: boolean;
}

/**
 * Split the model's reply into the Markdown body and its `Unfinished:` / `Asks the user:` sentinels,
 * looking only at the last few non-empty lines. A missing `Unfinished` line counts as unfinished
 * (losing work is worse than one dismissible note); a missing `Asks the user` line counts as no.
 */
export function parseSessionSummary(text: string): ParsedSessionSummary {
  const lines = text.split('\n');
  const tail: number[] = [];
  for (let i = lines.length - 1; i >= 0 && tail.length < SENTINEL_WINDOW; i--) {
    if (lines[i].trim()) tail.push(i);
  }
  let unfinished: boolean | undefined;
  let asksUser: boolean | undefined;
  const drop = new Set<number>();
  // tail runs from the last line backwards, so the last sentinel of each kind wins.
  for (const i of tail) {
    const line = lines[i].trim();
    const u = UNFINISHED_RE.exec(line);
    const a = ASKS_USER_RE.exec(line);
    if (u) {
      drop.add(i);
      unfinished ??= u[1].toLowerCase() === 'yes';
    } else if (a) {
      drop.add(i);
      asksUser ??= a[1].toLowerCase() === 'yes';
    }
  }
  const body = lines.filter((_, i) => !drop.has(i)).join('\n').trimEnd();
  return {
    body,
    unfinished: unfinished ?? true,
    asksUser: asksUser ?? false,
    sentinels: unfinished !== undefined && asksUser !== undefined
  };
}

/** Keep `text` as is when it fits, otherwise cut at the last line break within `max` and add `…`. */
export function trimAtLineBoundary(text: string, max = SUMMARY_MAX): string {
  if (text.length <= max) return text;
  const lineEnd = text.lastIndexOf('\n', max);
  return `${text.slice(0, lineEnd > 0 ? lineEnd : max)}\n…`;
}

/** A session title without the slash-command tags a resumed History conversation carries. */
export function cleanSessionTitle(raw: string): string {
  const clean = raw
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean;
}

/** The first bullet under the "Left / next" heading, without its marker or bold, or null. */
export function firstLeftItem(body: string): string | null {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => /left\s*\/\s*next/i.test(l) && !/^\s*[-*•]\s/.test(l));
  if (start === -1) return null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (!bullet) return null;
    const item = bullet[1].replace(/\*\*|__/g, '').trim();
    if (!item) return null;
    return item.length > LEFT_ITEM_MAX ? `${item.slice(0, LEFT_ITEM_MAX - 1)}…` : item;
  }
  return null;
}
