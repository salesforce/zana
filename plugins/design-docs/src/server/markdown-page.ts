/**
 * Markdown design-doc files as standalone browser pages.
 *
 * The page carries no script: markdown is parsed on the server, raw HTML in it
 * is dropped, links are rewritten to the plugin's own routes, relative images
 * are inlined and the result is sanitized last. A sanitizer miss therefore has
 * nothing to run, and `MD_PAGE_CSP` (see `pages.ts`) enforces that.
 */
import { Buffer } from 'node:buffer';
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { PAGE_ASSET_BUDGET } from '../shared/page.js';
import { fileKindOf, isRenderableMarkdownPath, resolveDocLink } from '../shared/paths.js';
import { assetDataUrl, type PageSource } from './page-bundle.js';
import { DesignDocError } from './store.js';

/** Largest markdown file the browser view renders; the parser is synchronous and recursive. */
export const MAX_MARKDOWN_BYTES = 512 * 1024;

/** Deepest block-quote or list nesting the browser view renders. */
export const MAX_MARKDOWN_NESTING = 100;

export interface MarkdownRenderContext {
  /** Server-resolved id of the doc; never read from markdown. */
  docId: string;
  /** Doc path of the markdown file, the base for its relative links. */
  path: string;
  /** Plugin HTTP prefix links point at, e.g. `/api/v1/plugins/design-docs/http`. */
  endpoint: string;
  /** Reads a doc file, or null when it does not exist. */
  read(path: string): PageSource | null;
  /** Bytes of data: URLs the render may inline. */
  assetBudget?: number;
}

/** The slice of a hast node these transforms touch. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Only these open a nesting level; `*`, `_` and `-` runs are thematic breaks or emphasis, not nesting. */
const NESTING_RUN = new RegExp(`>{${MAX_MARKDOWN_NESTING + 1},}|\\[{${MAX_MARKDOWN_NESTING + 1},}`);
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const QUOTE_PREFIX = /^[ \t]*((?:>[ \t]*)+)/;
const DEEP_LIST_ITEM = /^[ \t]{200,}(?:[-*+]|\d+[.)])[ \t]/;

/** Throws `limit` for a file too large or nested too deeply to render safely. */
export function checkMarkdownLimits(source: string): void {
  if (Buffer.byteLength(source, 'utf8') > MAX_MARKDOWN_BYTES) {
    throw new DesignDocError('limit', `markdown over ${MAX_MARKDOWN_BYTES / 1024} KB is not rendered in the browser view`);
  }
  const tooDeep = () => new DesignDocError('limit', `markdown nested more than ${MAX_MARKDOWN_NESTING} levels deep is not rendered in the browser view`);
  let fence: string | null = null;
  for (const line of source.split('\n')) {
    const opener = line.match(FENCE)?.[1];
    if (fence) {
      // Code inside a fence is literal and cannot nest.
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
      continue;
    }
    if (opener) {
      fence = opener;
      continue;
    }
    if (NESTING_RUN.test(line)) throw tooDeep();
    const quote = line.match(QUOTE_PREFIX);
    if (quote && quote[1]!.split('>').length - 1 > MAX_MARKDOWN_NESTING) throw tooDeep();
    if (DEEP_LIST_ITEM.test(line)) throw tooDeep();
  }
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** A GitHub-style heading slug: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text: string): string {
  const slug = text.toLowerCase().trim().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
  return slug || 'section';
}

function walk(root: HastNode, visit: (node: HastNode) => void): void {
  const stack: HastNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    visit(node);
    if (node.children) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
}

const HEADING = /^h[1-6]$/;

function addHeadingIds(root: HastNode): void {
  const seen = new Map<string, number>();
  const taken = new Set<string>();
  walk(root, (node) => {
    if (node.type !== 'element' || !node.tagName || !HEADING.test(node.tagName)) return;
    const base = slugify(textOf(node));
    let count = seen.get(base) ?? 0;
    let id = count ? `${base}-${count}` : base;
    // A suffixed id may collide with a heading that is literally "a-1".
    while (taken.has(id)) id = `${base}-${++count}`;
    seen.set(base, count + 1);
    taken.add(id);
    node.properties = { ...node.properties, id };
  });
}

const SAFE_LINK = /^(?:https?:|mailto:)/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]*$/i;

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The route URL for a doc path: pages for HTML and markdown, raw files for the rest. */
function docUrl(ctx: MarkdownRenderContext, target: string, raw: string): string {
  const route = isRenderableMarkdownPath(target) || fileKindOf(target) === 'html' ? 'page' : 'file';
  const query = new URLSearchParams({ doc: ctx.docId, path: target });
  const hash = raw.indexOf('#');
  const fragment = hash >= 0 ? raw.slice(hash + 1) : '';
  return `${ctx.endpoint}/${route}?${query.toString()}${fragment ? `#${encodeURIComponent(decoded(fragment))}` : ''}`;
}

/** The href to keep, or null to drop it and leave the link text inert. */
function rewriteHref(ctx: MarkdownRenderContext, href: string): string | null {
  const raw = href.trim();
  if (raw.startsWith('#') || SAFE_LINK.test(raw)) return raw;
  const target = resolveDocLink(ctx.path, raw);
  return target ? docUrl(ctx, target, raw) : null;
}

/** The image source to keep, or null to replace the image with its alt text. */
function rewriteSrc(ctx: MarkdownRenderContext, src: string, budget: { left: number }): string | null {
  const raw = src.trim();
  if (/^https:/i.test(raw) || DATA_IMAGE.test(raw)) return raw;
  if (raw.startsWith('//') || ANY_SCHEME.test(raw)) return null;
  const target = resolveDocLink(ctx.path, raw);
  if (!target) return null;
  const file = ctx.read(target);
  if (!file || (file.kind !== 'image' && file.kind !== 'svg')) return null;
  const url = assetDataUrl(file);
  if (!url || url.length > budget.left) return null;
  budget.left -= url.length;
  return url;
}

function rewriteReferences(root: HastNode, ctx: MarkdownRenderContext): void {
  const budget = { left: ctx.assetBudget ?? PAGE_ASSET_BUDGET };
  walk(root, (node) => {
    if (node.type !== 'element' || !node.properties) return;
    if (node.tagName === 'a' && typeof node.properties.href === 'string') {
      const href = rewriteHref(ctx, node.properties.href);
      if (href === null) delete node.properties.href;
      else node.properties.href = href;
    } else if (node.tagName === 'img') {
      const src = typeof node.properties.src === 'string' ? rewriteSrc(ctx, node.properties.src, budget) : null;
      if (src !== null) {
        node.properties.src = src;
        return;
      }
      const alt = typeof node.properties.alt === 'string' ? node.properties.alt : '';
      node.type = 'text';
      node.value = alt;
      delete node.tagName;
      delete node.properties;
    }
  });
}

/**
 * The page has no script, so DOM clobbering has nothing to act on and ids stay
 * as written: fragment links need the plain heading slug.
 */
const SCHEMA: SanitizeOptions = {
  ...defaultSchema,
  clobberPrefix: '',
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'], src: ['https', 'data'] }
};

/** Markdown to sanitized HTML. Raw HTML in the source is dropped, not rendered. */
export function renderMarkdownBody(source: string, ctx: MarkdownRenderContext): string {
  checkMarkdownLimits(source);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(() => (tree: HastNode) => {
      addHeadingIds(tree);
      rewriteReferences(tree, ctx);
    })
    .use(rehypeSanitize, SCHEMA)
    .use(rehypeStringify);
  return String(processor.processSync(source));
}

/** Used when the site kit is unavailable; the page still reads cleanly. */
export const FALLBACK_CSS =
  'body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:2rem 1rem;background:Canvas;color:CanvasText}' +
  'main{max-width:46rem;margin:0 auto}a{color:LinkText}hr{border:0;border-top:1px solid GrayText}';

/** Task lists, code, tables and images, on top of whichever base stylesheet the page carries. */
const PAGE_CSS =
  ':root{color-scheme:light dark}' +
  'main img{max-width:100%;height:auto}' +
  'main pre{overflow:auto;padding:.75rem 1rem;border-radius:6px;background:color-mix(in srgb,currentColor 8%,transparent)}' +
  'main code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}' +
  'main table{display:block;overflow-x:auto;max-width:100%;border-collapse:collapse}' +
  'main th,main td{padding:.35rem .7rem;border:1px solid color-mix(in srgb,currentColor 22%,transparent)}' +
  'main ul.contains-task-list{list-style:none;padding-left:1.25rem}' +
  'main .task-list-item input{margin-right:.5rem}' +
  'main blockquote{margin-left:0;padding-left:1rem;border-left:3px solid color-mix(in srgb,currentColor 30%,transparent)}';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A complete, script-free HTML document for one markdown file. `css` is the site kit stylesheet, when there is one. */
export function markdownPageHtml(source: string, ctx: MarkdownRenderContext, css: string | null): string {
  const body = renderMarkdownBody(source, ctx);
  const styles = `${css ?? FALLBACK_CSS}\n${PAGE_CSS}`.replace(/<\/style/gi, '<\\/style');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(ctx.path)}</title><style>${styles}</style></head>` +
    `<body><main class="narrow">${body}</main></body></html>`
  );
}
