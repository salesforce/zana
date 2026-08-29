import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS, renderDoc } from './docs';

/**
 * Build-time docs search index. Computed server-side (reads the synced markdown
 * in content/docs) and passed as a prop into the client ⌘K palette — no runtime
 * fetch, no server, no DB. The whole corpus is a handful of small docs, so the
 * embedded JSON is tiny.
 *
 * Each doc is split into SECTIONS keyed by its h2/h3 headings so a hit can deep
 * link to /docs/<slug>/#<heading-id>. Markdown is stripped to plain text and
 * each section body is capped so the index stays small.
 */
export interface SearchSection {
  /** heading id (matches lib/docs slugify) — '' for the doc intro before any h2/h3 */
  id: string;
  /** heading text, or the doc title for the intro section */
  heading: string;
  level: 1 | 2 | 3;
  /** plain-text body of the section, capped */
  body: string;
}

export interface SearchEntry {
  slug: string;
  title: string;
  group: string;
  sections: SearchSection[];
}

const CONTENT_DIR = join(process.cwd(), 'content', 'docs');
const MAX_BODY = 600;

/** Strip markdown syntax to readable plain text (best-effort, index-only). */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]*`/g, (m) => m.replace(/`/g, '')) // inline code → text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^\s{0,3}[-*+]\s+/gm, '') // list bullets
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // stray heading marks
    .replace(/[*_>#]/g, '') // emphasis / blockquote / hashes
    .replace(/\|/g, ' ') // table pipes
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split raw markdown into (heading-line, body-text) chunks at h2/h3 boundaries,
 * in document order. The FIRST chunk is the intro (text before any h2/h3). We
 * only carry the body text here — the canonical id/heading come from renderDoc's
 * TOC so anchors match the DOM exactly (headings may contain inline code that
 * marked strips differently than a naive regex would).
 */
function splitBodies(md: string): string[] {
  const lines = md.split('\n');
  const chunks: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const isHeading = !inFence && /^#{2,3}\s+/.test(line);
    if (isHeading) {
      chunks.push(stripMarkdown(buf.join('\n')).slice(0, MAX_BODY));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  chunks.push(stripMarkdown(buf.join('\n')).slice(0, MAX_BODY));
  return chunks;
}

/**
 * Build the full search index across every published doc. Async because it
 * renders each doc to reuse renderDoc's TOC (h2/h3 with DOM-exact ids), then
 * zips the body chunks onto it — chunk[0] is the intro, chunk[i+1] pairs with
 * toc[i] (same document order).
 */
export async function buildSearchIndex(): Promise<SearchEntry[]> {
  const out: SearchEntry[] = [];
  for (const d of DOCS) {
    let md = '';
    try {
      md = readFileSync(join(CONTENT_DIR, `${d.slug}.md`), 'utf-8');
    } catch {
      md = '';
    }
    const { toc } = await renderDoc(d);
    const bodies = splitBodies(md);
    const sections: SearchSection[] = [
      { id: '', heading: d.title, level: 1, body: bodies[0] ?? '' }
    ];
    toc.forEach((t, i) => {
      sections.push({ id: t.id, heading: t.text, level: t.level, body: bodies[i + 1] ?? '' });
    });
    out.push({
      slug: d.slug,
      title: d.title,
      group: d.group,
      // Keep any section with content OR a non-empty heading, so a body-less
      // heading (e.g. an h2 immediately followed by an h3) is still matchable
      // and deep-linkable by its heading text. The intro (level 1) always stays.
      sections: sections.filter((s) => s.body.length > 0 || s.heading.trim().length > 0 || s.level === 1)
    });
  }
  return out;
}
