import { compareVersions } from '@zana-ai/zcc-extension-sdk';
import type { ReleaseNote } from '@zana-ai/zcc-domain/product';

/**
 * Pre-update release notes: turn electron-updater's `UpdateInfo.releaseNotes`
 * into the same `ReleaseNote[]` (markdown) shape the What's New modal renders
 * for bundled notes, so a user can read what an AVAILABLE version contains
 * before installing it — with no website round-trip. The notes come from the
 * release feed itself: the GitHub provider reads the release body (CI fills it
 * from `docs/releases/<version>.md`) out of the `releases.atom` feed as rendered
 * HTML; a `generic` feed carries whatever `latest-mac.yml` declares.
 *
 * The feed is remote content, so main normalizes it before the renderer sees it
 * (Rule 1): HTML is reduced to a small markdown subset (headings, paragraphs,
 * lists, emphasis, code, links) and every other tag is DROPPED, so no markup
 * ever reaches the renderer — `MarkdownContent` then renders it without raw HTML.
 * Bounded (Rule 5): at most {@link MAX_UPDATE_NOTES} versions, each capped at
 * {@link MAX_UPDATE_NOTE_CHARS}, within {@link MAX_UPDATE_NOTES_TOTAL_CHARS}
 * overall (older versions are dropped first). Never throws — malformed input yields `[]`.
 */

export const MAX_UPDATE_NOTES = 20;
export const MAX_UPDATE_NOTE_CHARS = 32 * 1024;
/** Budget across all versions — the status is re-serialized on each emit. */
export const MAX_UPDATE_NOTES_TOTAL_CHARS = 128 * 1024;
/** Raw input cap before parsing, so a hostile feed can't make us regex megabytes. */
const MAX_RAW_CHARS = 256 * 1024;

const VERSION_RE = /^[\w.+-]{1,64}$/;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…'
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Only http(s) links survive; anything else (javascript:, data:, relative) keeps just its text. */
function safeHref(raw: string): string | null {
  const href = decodeEntities(raw).trim();
  return /^https?:\/\//i.test(href) && !/[\s()<>]/.test(href) ? href : null;
}

function attr(tagAttrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tagAttrs);
  return m ? (m[2] ?? m[3] ?? '') : null;
}

/**
 * Drop every `<...>` span with one forward scan. A `<` that never closes stays
 * as text. The result can contain no `<`-to-`>` span: between two removed spans
 * the kept text has no `<` (it would have opened a span), so a removal can never
 * join two halves of a tag. Linear, unlike a lazy regex.
 */
function stripTags(text: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const open = text.indexOf('<', cursor);
    if (open < 0) break;
    const close = text.indexOf('>', open + 1);
    if (close < 0) break;
    out += text.slice(cursor, open);
    cursor = close + 1;
  }
  return out + text.slice(cursor);
}

interface ElementMatch {
  /** Lower-cased tag name. */
  name: string;
  /** Text between the tag name and the `>` of the opening tag (empty when not requested). */
  attrs: string;
  /** Text between the opening tag and its first matching closing tag. */
  inner: string;
}

/**
 * Replace each `<name ...>inner</name>` with `replace(match)`, first closing tag
 * wins, scanning left to right. Equivalent to
 * `/<(names)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi` (or without `[^>]*>` when
 * `needsOpenEnd` is false), but linear: a missing closer is searched for once
 * per tag name, because no later opener of that name can have one either, and a
 * missing `>` ends the scan for the same reason.
 */
function replaceElements(
  input: string,
  names: string,
  needsOpenEnd: boolean,
  replace: (match: ElementMatch) => string
): string {
  const opener = new RegExp(`<(${names})\\b`, 'gi');
  const closers = new Map<string, RegExp>();
  const exhausted = new Set<string>();
  let out = '';
  let cursor = 0;
  for (let found = opener.exec(input); found; found = opener.exec(input)) {
    const name = found[1]!.toLowerCase();
    if (exhausted.has(name)) continue;
    let bodyStart = found.index + found[0].length;
    let attrs = '';
    if (needsOpenEnd) {
      const gt = input.indexOf('>', bodyStart);
      if (gt < 0) break;
      attrs = input.slice(bodyStart, gt);
      bodyStart = gt + 1;
    }
    let closer = closers.get(name);
    if (!closer) {
      closer = new RegExp(`</${name}\\s*>`, 'gi');
      closers.set(name, closer);
    }
    closer.lastIndex = bodyStart;
    const closing = closer.exec(input);
    if (!closing) {
      exhausted.add(name);
      continue;
    }
    out += input.slice(cursor, found.index) + replace({ name, attrs, inner: input.slice(bodyStart, closing.index) });
    cursor = closing.index + closing[0].length;
    opener.lastIndex = cursor;
  }
  return out + input.slice(cursor);
}

/** Remove every `<!-- ... -->` comment; an unterminated one stays as text. */
function stripComments(input: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const open = input.indexOf('<!--', cursor);
    if (open < 0) break;
    const close = input.indexOf('-->', open + 4);
    if (close < 0) break;
    out += input.slice(cursor, open);
    cursor = close + 3;
  }
  return out + input.slice(cursor);
}

const MAX_STRIP_PASSES = 4;

/**
 * Remove script-like elements and comments. Removing one can join the halves of
 * another (`<scr<script></script>ipt>`), so repeat until nothing changes; if the
 * input is still changing after {@link MAX_STRIP_PASSES} passes it is hostile
 * nesting, so every remaining `<` is dropped instead.
 */
function stripHiddenContent(input: string): string {
  let current = input;
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass += 1) {
    const next = stripComments(replaceElements(current, 'script|style|template|iframe|object|svg', false, () => ''));
    if (next === current) return current;
    current = next;
  }
  return current.replace(/</g, '');
}

/**
 * Convert the GitHub-rendered release-body HTML subset to markdown. Not a
 * general HTML parser — it only needs to round-trip what `docs/releases/*.md`
 * renders to; unknown tags are stripped to their text.
 */
export function htmlToMarkdown(html: string): string {
  // Content that must never surface as text.
  let s = stripHiddenContent(html.slice(0, MAX_RAW_CHARS));
  // Code blocks first, so their contents aren't treated as markup.
  const blocks: string[] = [];
  s = replaceElements(s, 'pre', true, ({ inner }) => {
    const code = decodeEntities(stripTags(inner)).replace(/\n+$/, '');
    blocks.push('\n\n```\n' + code.replace(/```/g, '``​`') + '\n```\n\n');
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = replaceElements(s, 'h[1-6]', true, ({ name, inner }) => `\n\n${'#'.repeat(Number(name.slice(1)))} ${inner.trim()}\n\n`);
  s = replaceElements(s, 'a', true, ({ attrs, inner }) => {
    const href = safeHref(attr(attrs, 'href') ?? '');
    const text = stripTags(inner).trim();
    return href && text ? `[${text}](${href})` : text;
  });
  s = replaceElements(s, 'strong|b', true, ({ inner }) => (inner.trim() ? `**${inner.trim()}**` : ''));
  s = replaceElements(s, 'em|i', true, ({ inner }) => (inner.trim() ? `*${inner.trim()}*` : ''));
  s = replaceElements(s, 'code', true, ({ inner }) => '`' + inner.replace(/`/g, '') + '`');
  s = s.replace(/\s*<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(ul|ol)\s*>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n');
  s = s.replace(/<\/?(p|div|blockquote|section|table|tr)\b[^>]*>/gi, '\n\n');
  // Drop every remaining tag, then decode text entities.
  s = stripTags(s);
  s = decodeEntities(s);
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)] ?? '');
  return s
    .replace(/[ \t]+\n/g, (m) => (m.endsWith('  \n') ? '  \n' : '\n'))
    .replace(/\n- [ \t]*\n+/g, '\n- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeHtml(text: string): boolean {
  return /<\/?(p|h[1-6]|ul|ol|li|strong|em|a|code|pre|br|div)\b[^>]*>/i.test(text);
}

function toMarkdown(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.slice(0, MAX_RAW_CHARS);
  // A generic feed may already carry markdown; still strip any stray tags.
  const md = looksLikeHtml(text) ? htmlToMarkdown(text) : decodeEntities(stripTags(text)).trim();
  return md.length > MAX_UPDATE_NOTE_CHARS ? md.slice(0, MAX_UPDATE_NOTE_CHARS).trimEnd() + '\n\n…' : md;
}

/**
 * Normalize `UpdateInfo.releaseNotes` (`string | ReleaseNoteInfo[] | null`)
 * into `ReleaseNote[]`, newest first. A plain string is attributed to
 * `targetVersion`; array entries (from `fullChangelog`) keep their own versions.
 */
export function normalizeUpdateReleaseNotes(raw: unknown, targetVersion: string | undefined): ReleaseNote[] {
  try {
    const out: ReleaseNote[] = [];
    if (typeof raw === 'string') {
      const markdown = toMarkdown(raw);
      if (markdown && targetVersion && VERSION_RE.test(targetVersion)) out.push({ version: targetVersion, markdown });
    } else if (Array.isArray(raw)) {
      for (const entry of raw.slice(0, MAX_UPDATE_NOTES)) {
        if (!entry || typeof entry !== 'object') continue;
        const { version, note } = entry as { version?: unknown; note?: unknown };
        if (typeof version !== 'string') continue;
        const v = version.replace(/^v/i, '');
        if (!VERSION_RE.test(v)) continue;
        const markdown = toMarkdown(note);
        if (markdown) out.push({ version: v, markdown });
      }
    }
    out.sort((a, b) => compareVersions(b.version, a.version));
    let budget = MAX_UPDATE_NOTES_TOTAL_CHARS;
    return out.filter((note) => (budget -= note.markdown.length) >= 0);
  } catch {
    return [];
  }
}
