/**
 * Pure runtime helpers for extensions (`@zana-ai/zcc-extension-sdk/helpers`). No
 * React, no Node, no core dependency — safe to import from either process.
 */

/**
 * Unwrap the case where an agent has wrapped its entire body in a single
 * triple-backtick fence — sometimes with NESTED inner fences. Nested
 * fences are invalid markdown (the parser closes the outer block at the
 * first inner fence, and the rest renders inconsistently), so a body that
 * was meant to be rich markdown ends up as raw `##`, `|`-tables and `**`.
 *
 * Strategy:
 *   1. Find the first fence line (after any leading preamble) and the
 *      last fence line.
 *   2. If they bracket essentially the whole body and the inner content
 *      contains obvious markdown structure (headings, tables, bold), the
 *      agent meant for us to render the inner as markdown — strip the
 *      outer fence pair AND any nested fences in between.
 *
 * This is intentionally aggressive: agents that wrap their reply in a
 * single fence trip on this case all the time, and the alternative (raw
 * tables and `##` rendered as plain text) is much worse than losing
 * legitimate-but-rare code-block formatting around nested examples.
 *
 * Returns the input unchanged when it doesn't match the wrapped-body shape.
 */
/** Parsed YAML-ish front-matter header: recognized fields + the body below it. */
export interface ParsedFrontMatter {
  meta: {
    id?: string;
    title?: string;
    summary?: string;
    tags?: string[];
    /** The `source:` field (agent | user | …). Named `source` here (vs. the
     *  store's `sourceKind`) to match the on-disk key exactly. */
    source?: string;
    createdAt?: number;
  };
  /** Everything after the closing fence. */
  body: string;
}

const FRONT_MATTER_FENCE = '---';
/** Upper bound on tags parsed from a header (DoS guard on hostile input). */
const MAX_FRONT_MATTER_TAGS = 64;

/**
 * Parse a leading `---`…`---` front-matter block off a markdown doc.
 *
 * Library docs authored by agents carry their metadata as a front-matter
 * header (so a fresh clone can rebuild the manifest from disk). react-markdown
 * has no notion of front-matter, so rendering the raw file turns that header
 * into a mangled bold blob: the opening `---` becomes a thematic break, the
 * `key: value` lines a paragraph, and the closing `---` a setext-H2 underline
 * that promotes the whole paragraph to a heading. Strip it before rendering,
 * and hand the recognized fields back so the caller can render a clean chip
 * header instead.
 *
 * This mirrors the store-side parser in `library-store.ts` (kept dependency-
 * free and deliberately tiny); the two must agree on the on-disk shape, so
 * they share this one implementation. Returns null when there's no header.
 */
export function parseFrontMatter(raw: string): ParsedFrontMatter | null {
  if (!raw.startsWith(`${FRONT_MATTER_FENCE}\n`)) return null;
  // Find the CLOSING fence: a `\n---` on its own line (followed by newline or
  // EOF). Scanning for the first `\n---` alone mis-fires when the body's own
  // first line is `---` (a horizontal rule), so skip non-fence hits.
  const needle = `\n${FRONT_MATTER_FENCE}`;
  let end = raw.indexOf(needle, FRONT_MATTER_FENCE.length);
  while (end >= 0) {
    const after = raw[end + needle.length];
    if (after === undefined || after === '\n' || after === '\r') break;
    end = raw.indexOf(needle, end + needle.length);
  }
  if (end < 0) return null;
  const block = raw.slice(FRONT_MATTER_FENCE.length + 1, end);
  const afterFence = raw.indexOf('\n', end + 1);
  const body = afterFence < 0 ? '' : raw.slice(afterFence + 1);

  const decode = (v: string): string => {
    const t = v.trim();
    if (t.startsWith('"')) {
      try {
        return JSON.parse(t) as string;
      } catch {
        return t;
      }
    }
    return t;
  };

  const meta: ParsedFrontMatter['meta'] = {};
  for (const line of block.split('\n')) {
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim();
    if (key === 'id') meta.id = decode(val);
    else if (key === 'title') meta.title = decode(val);
    else if (key === 'summary') meta.summary = decode(val);
    else if (key === 'source') meta.source = decode(val);
    else if (key === 'createdAt') {
      const n = Number(val);
      if (Number.isFinite(n)) meta.createdAt = n;
    } else if (key === 'tags') {
      const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
      if (inner) {
        meta.tags = inner
          .split(',')
          .slice(0, MAX_FRONT_MATTER_TAGS)
          .map((t) => decode(t))
          .filter((t) => t.length > 0);
      }
    }
  }
  return { meta, body };
}

export function unwrapBareFence(text: string): string {
  const lines = text.split(/\r?\n/);
  const fenceRe = /^```[a-zA-Z0-9_-]*\s*$/;
  let openLine = -1;
  let closeLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fenceRe.test(lines[i])) {
      if (openLine === -1) openLine = i;
      closeLine = i;
    }
  }
  if (openLine === -1 || closeLine === -1 || openLine === closeLine) return text;

  // Tolerate trailing whitespace after the closing fence but nothing else.
  for (let i = closeLine + 1; i < lines.length; i++) {
    if (lines[i].trim().length > 0) return text;
  }

  const head = lines.slice(0, openLine).join('\n').trimEnd();

  // Only rescue a body whose ENTIRE content is fenced. If the head already
  // contains block-level markdown (headings, tables, list items, rules), the
  // doc is already rendering as real markdown and the first/last-fence span is
  // almost certainly over-capturing — e.g. a legitimate code block plus a
  // stray, unmatched trailing fence, which would otherwise defeat the
  // trailing-content guard above and flatten the whole document. A genuine
  // wrapped body only ever has an inline preamble (a `**status line**`).
  const headHasBlockMarkdown = /(^|\n)\s*(#{1,6} |[-*] |\d+\. |\| |-{3,}\s*$|={3,}\s*$)/.test(
    head
  );
  if (headHasBlockMarkdown) return text;
  // Drop nested fence lines from the inner content too — they were closing
  // the (invalid) nested code blocks we're now flattening.
  const inner = lines
    .slice(openLine + 1, closeLine)
    .filter((l) => !fenceRe.test(l))
    .join('\n');

  // Only unwrap when the unwrapped body looks like real markdown. Without
  // this guard, we'd flatten legitimate code blocks too.
  const looksLikeMarkdown = /(^|\n)(#{1,6} |[-*] |\| .* \||\*\*[^*]+\*\*)/.test(inner);
  if (!looksLikeMarkdown) return text;
  return head ? `${head}\n\n${inner}` : inner;
}
