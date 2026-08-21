import type { Terminal } from '@xterm/xterm';

const URL_RE = /https?:\/\/[\w.-]+(?::\d+)?(?:\/[^\s"'<>)\]]*)?/g;

// How far back from the bottom of the scrollback we'll inspect. Most dev
// servers reprint their URL recently, and walking the whole 1000+ row buffer
// every 2s is wasteful.
const MAX_ROWS_SCANNED = 600;

export function scrapeUrls(term: Terminal): string[] {
  const buf = term.buffer.active;
  const len = buf.length;
  const start = Math.max(0, len - MAX_ROWS_SCANNED);

  // First pass: stitch wrapped rows back into logical lines. xterm sets
  // `isWrapped: true` on a row that is a continuation of the previous row.
  // Without stitching, a long URL like
  //   http://localhost:3000/very/long/path
  // that wraps across two physical rows is split mid-char and never matches.
  const logical: string[] = [];
  for (let i = start; i < len; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && logical.length > 0) {
      logical[logical.length - 1] += text;
    } else {
      logical.push(text);
    }
  }

  // Second pass: walk newest-first so the freshest URL wins on dedupe.
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = logical.length - 1; i >= 0 && out.length < 20; i--) {
    const text = logical[i];
    if (!text || text.indexOf('http') === -1) continue;
    const matches = text.match(URL_RE);
    if (!matches) continue;
    for (const raw of matches) {
      // Trim trailing punctuation that humans don't include in URLs but
      // terminals often print right after one (".", ",", ")", "]", "'").
      let url = raw.replace(/[.,)\]'"]+$/g, '');
      // Canonicalize: a bare "http://host[:port]" and "http://host[:port]/"
      // point at the same resource — strip the lone trailing slash so we
      // don't show both as separate entries.
      url = url.replace(/^(https?:\/\/[^/]+)\/$/, '$1');
      if (!seen.has(url)) {
        seen.add(url);
        out.push(url);
        if (out.length >= 20) break;
      }
    }
  }
  return out;
}
