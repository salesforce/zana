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
 * Convert the GitHub-rendered release-body HTML subset to markdown. Not a
 * general HTML parser — it only needs to round-trip what `docs/releases/*.md`
 * renders to; unknown tags are stripped to their text.
 */
export function htmlToMarkdown(html: string): string {
  let s = html.slice(0, MAX_RAW_CHARS);
  // Content that must never surface as text.
  s = s.replace(/<(script|style|template|iframe|object|svg)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Code blocks first, so their contents aren't treated as markup.
  const blocks: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, inner: string) => {
    const code = decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\n+$/, '');
    blocks.push('\n\n```\n' + code.replace(/```/g, '``​`') + '\n```\n\n');
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner.trim()}\n\n`);
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_m, attrs: string, inner: string) => {
    const href = safeHref(attr(attrs, 'href') ?? '');
    const text = inner.replace(/<[^>]*>/g, '').trim();
    return href && text ? `[${text}](${href})` : text;
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, inner: string) => (inner.trim() ? `**${inner.trim()}**` : ''));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, inner: string) => (inner.trim() ? `*${inner.trim()}*` : ''));
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (_m, inner: string) => '`' + inner.replace(/`/g, '') + '`');
  s = s.replace(/\s*<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(ul|ol)\s*>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n');
  s = s.replace(/<\/?(p|div|blockquote|section|table|tr)\b[^>]*>/gi, '\n\n');
  // Drop every remaining tag, then decode text entities.
  s = s.replace(/<[^>]*>/g, '');
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
  const md = looksLikeHtml(text) ? htmlToMarkdown(text) : decodeEntities(text.replace(/<[^>]*>/g, '')).trim();
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
