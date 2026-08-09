import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { createHighlighter, type Highlighter } from 'shiki';

/**
 * Docs are synced from the parent repo into ./content/docs/ by
 * scripts/sync-docs.mjs (run via the predev/prebuild npm hooks) so the website
 * is self-contained — the Docker build context is only website/. Edit the DOCS
 * allowlist in scripts/sync-docs.mjs to publish a doc; this module just reads
 * the generated manifest + markdown, then renders it with heading anchors and
 * extracts a table of contents for the docs UI.
 */
export interface DocMeta {
  slug: string;
  title: string;
  group: string;
}

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface RenderedDoc {
  html: string;
  toc: TocItem[];
}

const CONTENT_DIR = join(process.cwd(), 'content', 'docs');
const MANIFEST = join(CONTENT_DIR, '_manifest.json');

/** Read the generated manifest (sync, at module load — used by static params). */
export const DOCS: DocMeta[] = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf-8')) as DocMeta[])
  : [];

export function getDoc(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}

/**
 * Build-time syntax highlighter. Created ONCE (module singleton) and reused
 * across every code block on every doc — creating one per block would reload
 * grammars + themes on each call. Dual-theme (github-light + github-dark): shiki
 * emits both colors as inline styles + CSS custom props so a single build serves
 * both site themes; globals.css toggles them off [data-theme]. Highlighting runs
 * server-side only, so there is zero client runtime cost.
 */
const HL_THEMES = ['github-light', 'github-dark'] as const;
// Languages actually used across our synced docs (+ a few safe extras). Anything
// not in this set falls back to plaintext rather than throwing.
const HL_LANGS = ['bash', 'shellscript', 'json', 'jsonc', 'typescript', 'tsx', 'javascript', 'css', 'markdown'];
// Fence-tag → loaded grammar. Tags not present here render as plaintext (e.g.
// `text`, `mermaid` — a diagram DSL we don't tokenize).
const LANG_ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  bash: 'bash',
  shellscript: 'shellscript',
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'jsonc',
  css: 'css',
  md: 'markdown',
  markdown: 'markdown'
};

let highlighterPromise: Promise<Highlighter> | undefined;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [...HL_THEMES], langs: HL_LANGS });
  }
  return highlighterPromise;
}

function resolveLang(infostring: string | undefined): string {
  const tag = (infostring || '').match(/\S*/)?.[0]?.toLowerCase() ?? '';
  return LANG_ALIASES[tag] ?? 'text';
}

/**
 * Rewrite a markdown link href for the PUBLIC site. The synced docs come from the
 * repo and contain relative links written for the repo tree (`./other-doc.md`,
 * `../packages/...`) plus links to internal docs that are NOT published here.
 * Left verbatim these 404. Policy:
 *   - in-page anchors (`#x`) and absolute URLs (`http(s)://`, `mailto:`) → keep.
 *   - `./slug.md` / `../x/slug.md` (+optional `#anchor`) where `slug` is a
 *     PUBLISHED doc → rewrite to `/docs/slug/[#anchor]`.
 *   - anything else (unpublished internal doc, a repo path like
 *     `../packages/extension-sdk/src`) → return null, and the caller renders the
 *     link's text as plain text instead of a broken anchor.
 */
/** Escape a string for safe use inside a double-quoted HTML attribute. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rewriteDocHref(href: string): string | null {
  if (!href) return null;
  if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith('#')) return href;

  const [path, anchor] = href.split('#');
  const mdMatch = /(?:^|\/)([^/]+)\.md$/.exec(path);
  if (mdMatch) {
    const slug = mdMatch[1];
    if (DOCS.some((d) => d.slug === slug)) {
      return `/docs/${slug}/${anchor ? `#${anchor}` : ''}`;
    }
  }
  // Unknown/unpublished target — drop the link (caller renders plain text).
  return null;
}

/** Prev/next in manifest order — powers the doc pager. */
export function getDocSiblings(slug: string): { prev?: DocMeta; next?: DocMeta } {
  const i = DOCS.findIndex((d) => d.slug === slug);
  if (i === -1) return {};
  return { prev: DOCS[i - 1], next: DOCS[i + 1] };
}

/** Stable slug for a heading, deduped within a document. */
export function slugifyHeadings() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base =
      text
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-') || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/**
 * Render a doc's markdown to HTML. A custom renderer:
 *   - gives h2/h3 stable ids + a hover anchor link (deep-linkable),
 *   - wraps <pre> blocks in a .code-wrap with a copy button (hydrated client-side),
 * and collects a TOC (h2 + h3) for the right-hand rail.
 */
export async function renderDoc(meta: DocMeta): Promise<RenderedDoc> {
  const raw = await readFile(join(CONTENT_DIR, `${meta.slug}.md`), 'utf-8');
  const toc: TocItem[] = [];
  const slugify = slugifyHeadings();
  // Await the shared highlighter ONCE here (renderDoc is async); shiki's
  // codeToHtml is then synchronous, so it can be called from marked's sync
  // `code` renderer below.
  const highlighter = await getHighlighter();

  const renderer = new marked.Renderer();

  // marked v12 uses positional renderer args: heading(html, level, raw).
  renderer.heading = (text: string, level: number, rawText: string) => {
    const plain = (rawText || text).replace(/<[^>]+>/g, '');
    const id = slugify(plain);
    if (level === 2 || level === 3) {
      toc.push({ id, text: plain, level: level as 2 | 3 });
    }
    const anchor =
      level === 2 || level === 3
        ? `<a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a>`
        : '';
    return `<h${level} id="${id}">${text}${anchor}</h${level}>\n`;
  };

  // code(code, infostring, escaped) — `code` is the raw source string. Tokenize
  // with shiki (dual-theme) and wrap in .code-wrap with the copy button. Shiki's
  // rendered text content equals the source, so DocsEnhancer's `code.innerText`
  // still copies the raw source. Unknown/absent langs render as plaintext.
  renderer.code = (code: string, infostring: string | undefined) => {
    const lang = resolveLang(infostring);
    const highlighted = highlighter.codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false // emit CSS vars for both themes; globals.css picks one
    });
    return `<div class="code-wrap"><button class="code-copy" type="button" aria-label="Copy code">Copy</button>${highlighted}</div>\n`;
  };

  // link(href, title, text) — rewrite repo-relative links for the public site;
  // drop links whose target isn't published here (render their text plain) so
  // no doc ships a 404. External URLs get rel/target for safety.
  renderer.link = (href: string, title: string | null | undefined, text: string) => {
    const resolved = rewriteDocHref(href);
    // Defense-in-depth: marked already escapes the title, but we build the
    // attribute by hand — escape the quote/angle chars so a title can never
    // break out of the attribute regardless of upstream behavior.
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    if (resolved === null) {
      return text; // neutralize — plain text, no broken anchor
    }
    const external = /^https?:/i.test(resolved);
    const extAttr = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${resolved}"${titleAttr}${extAttr}>${text}</a>`;
  };

  const html = marked.parse(raw, { async: false, renderer }) as string;
  return { html, toc };
}

/** Docs grouped for the sidebar, preserving manifest order. */
export function docsByGroup(): { group: string; items: DocMeta[] }[] {
  const groups: { group: string; items: DocMeta[] }[] = [];
  for (const d of DOCS) {
    let g = groups.find((x) => x.group === d.group);
    if (!g) {
      g = { group: d.group, items: [] };
      groups.push(g);
    }
    g.items.push(d);
  }
  return groups;
}
