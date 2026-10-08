/**
 * Bundle one HTML page of a design doc into a single self-contained document
 * the preview frame can render. The frame has an opaque origin and the app's
 * Content-Security-Policy, so nothing can load from the doc by URL:
 *
 * - stylesheets (and their `@import`s) become `<style>` blocks, with images
 *   and fonts they reference inlined as data: URLs;
 * - scripts become inert `text/x-dd-script` blocks the page runtime runs as
 *   blob: scripts, in browser order;
 * - images, icons and posters become data: URLs, within a byte budget;
 * - a `<base>` on the reserved page origin lets the runtime map everything
 *   else (fetches, links, late images) back to doc paths.
 *
 * Pure apart from the `read` callback, so the RPC, the standalone page route
 * and tests share it.
 */
import { Buffer } from 'node:buffer';
import { attribute, escapeAttribute, isScriptType, prependToHead, scanTags, startTag, type HtmlAttribute, type HtmlTag } from '../shared/html-scan.js';
import { PAGE_ASSET_BUDGET, pageBaseHref, pageUrl, type PageBundle } from '../shared/page.js';
import { imageMediaTypeOf, mediaTypeOf, resolveDocLink, type FileKind } from '../shared/paths.js';

export interface PageSource {
  path: string;
  kind: FileKind;
  content: string;
  encoding: 'utf8' | 'base64';
  revision: number;
}

export interface BundleInput {
  entryPath: string;
  /** The page's HTML: the saved file, or an unsaved draft. */
  html: string;
  /** A doc file (or a site-kit file), or null when there is none. */
  read(path: string): PageSource | null;
  assetBudget?: number;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const MEDIA = /\.(?:mp4|m4v|webm|ogg|ogv|mov|mp3|m4a|wav|flac|aac)$/i;
const MAX_IMPORT_DEPTH = 8;
const MAX_WARNINGS = 40;

/** Attributes holding an image URL, by element. */
const IMAGE_ATTRIBUTES: Record<string, readonly string[]> = {
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  input: ['src'],
  video: ['poster'],
  image: ['href', 'xlink:href'],
  feimage: ['href', 'xlink:href']
};

/** One CSS token we care about, in priority order: comments and strings are skipped whole. */
const CSS_TOKENS =
  /\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')([^;]*);?|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'/gi;
/** Static `import … from './x.js'` / `import './x.js'` in a module. */
const RELATIVE_IMPORT = /(?:^|[;\n}])\s*import\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.{1,2}\/|\/)[^"']*["']/;

/** Text that can sit inside `<script>` without ending it or changing how it parses. */
export function escapeScriptText(code: string): string {
  return code.replace(/<(\/script|!--)/gi, '\\x3C$1');
}

function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

/** A data: URL for an image, SVG or font file; null for anything else. */
export function assetDataUrl(file: Pick<PageSource, 'path' | 'kind' | 'content' | 'encoding'>): string | null {
  if (file.kind === 'svg' && file.encoding === 'utf8') {
    return `data:image/svg+xml;base64,${Buffer.from(file.content, 'utf8').toString('base64')}`;
  }
  if (file.encoding !== 'base64') return null;
  if (file.kind === 'image') {
    const type = imageMediaTypeOf(file.path);
    return type ? `data:${type};base64,${file.content}` : null;
  }
  if (file.kind === 'font') return `data:${mediaTypeOf(file.path)};base64,${file.content}`;
  return null;
}

/** Wrap imported CSS in the conditions its `@import` carried. */
function withConditions(css: string, conditions: string): string {
  let rest = conditions.trim();
  if (!rest) return css;
  const opens: string[] = [];
  const layer = rest.match(/^layer(?:\(\s*([^)]*?)\s*\))?(?=\s|$)/i);
  if (layer) {
    opens.push(layer[1] ? `@layer ${layer[1]}` : '@layer');
    rest = rest.slice(layer[0].length).trim();
  }
  if (/^supports\(/i.test(rest)) {
    let depth = 0;
    let index = 'supports'.length;
    for (; index < rest.length; index += 1) {
      if (rest[index] === '(') depth += 1;
      else if (rest[index] === ')' && (depth -= 1) === 0) break;
    }
    opens.push(`@supports ${rest.slice('supports'.length, index + 1)}`);
    rest = rest.slice(index + 1).trim();
  }
  if (rest) opens.push(`@media ${rest}`);
  return `${opens.map((open) => `${open} {\n`).join('')}${css}\n${opens.map(() => '}').join('\n')}`;
}

/** Split a `srcset` into candidates; URLs may contain commas, descriptors may not. */
function srcsetCandidates(value: string): Array<{ url: string; descriptor: string }> {
  const candidates: Array<{ url: string; descriptor: string }> = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index]!)) index += 1;
    if (index >= value.length) break;
    let end = index;
    while (end < value.length && !/\s/.test(value[end]!)) end += 1;
    let url = value.slice(index, end);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      index = end;
    } else {
      let stop = end;
      let depth = 0;
      while (stop < value.length && (value[stop] !== ',' || depth > 0)) {
        if (value[stop] === '(') depth += 1;
        else if (value[stop] === ')') depth -= 1;
        stop += 1;
      }
      descriptor = value.slice(end, stop).trim();
      index = stop + 1;
    }
    candidates.push({ url, descriptor });
  }
  return candidates;
}

class PageBundler {
  private readonly files = new Map<string, PageSource | null>();
  private readonly assets = new Map<string, string | null>();
  private readonly missing = new Set<string>();
  private readonly warnings = new Set<string>();
  private assetBytes = 0;
  private overBudget = false;

  constructor(private readonly input: BundleInput) {}

  private read(path: string): PageSource | null {
    if (this.files.has(path)) return this.files.get(path)!;
    let file: PageSource | null = null;
    try {
      file = this.input.read(path);
    } catch {
      file = null;
    }
    this.files.set(path, file);
    if (!file && path !== this.input.entryPath) this.missing.add(path);
    return file;
  }

  private warn(message: string): void {
    if (this.warnings.size < MAX_WARNINGS) this.warnings.add(message);
  }

  /** A data: URL for a referenced image/SVG/font, or null (missing, not an asset, or over budget). */
  private asset(path: string): string | null {
    if (this.assets.has(path)) return this.assets.get(path)!;
    const file = this.read(path);
    let url = file ? assetDataUrl(file) : null;
    if (url) {
      const budget = this.input.assetBudget ?? PAGE_ASSET_BUDGET;
      if (this.assetBytes + url.length > budget) {
        if (!this.overBudget) {
          this.warn(`Some images and fonts load on demand: the page inlines at most ${Math.round(budget / (1024 * 1024))} MB of them.`);
          this.overBudget = true;
        }
        url = null;
      } else {
        this.assetBytes += url.length;
      }
    }
    this.assets.set(path, url);
    return url;
  }

  /** A URL as written in `fromPath`, rewritten to a data: URL or an absolute page URL; null to keep it. */
  private resolveUrl(fromPath: string, raw: string): string | null {
    const path = resolveDocLink(fromPath, raw);
    if (!path) return null;
    const inlined = this.asset(path);
    if (inlined) return inlined;
    const hash = raw.indexOf('#');
    return pageUrl(path) + (hash >= 0 ? raw.slice(hash) : '');
  }

  /** CSS from `fromPath` with its `@import`s inlined and its `url()`s resolved. */
  css(css: string, fromPath: string, stack: readonly string[] = [], hoisted: string[] = []): string {
    const processed = css.replace(CSS_TOKENS, (token: string, ...groups: Array<string | undefined>) => {
      if (token.startsWith('/*') || token.startsWith('"') || token.startsWith("'")) return token;
      if (token[0] === '@') {
        const target = groups[0] ?? groups[1] ?? groups[2] ?? groups[3] ?? groups[4] ?? '';
        const path = resolveDocLink(fromPath, target);
        if (!path) {
          if (EXTERNAL.test(target)) this.warn(`External stylesheet ${target} does not load in previews; add the file to the doc.`);
          hoisted.push(token.endsWith(';') ? token : `${token};`);
          return '';
        }
        if (stack.includes(path) || stack.length >= MAX_IMPORT_DEPTH) {
          this.warn(`${fromPath} imports ${path} in a cycle or too deeply; the import was skipped.`);
          return '';
        }
        const file = this.read(path);
        if (!file || file.encoding !== 'utf8') return '';
        const inner = this.css(file.content.replace(/@charset\s+["'][^"']*["']\s*;/gi, ''), path, [...stack, fromPath], hoisted);
        return withConditions(inner, groups[5] ?? '');
      }
      const target = (groups[6] ?? groups[7] ?? groups[8] ?? '').trim();
      const url = this.resolveUrl(fromPath, target);
      return url ? `url("${url}")` : token;
    });
    return stack.length || !hoisted.length ? processed : `${hoisted.join('\n')}\n${processed}`;
  }

  private srcset(value: string): string {
    return srcsetCandidates(value)
      .map(({ url, descriptor }) => `${this.resolveUrl(this.input.entryPath, url) ?? url}${descriptor ? ` ${descriptor}` : ''}`)
      .join(', ');
  }

  /** A `<link rel=stylesheet>` as an inline `<style>`; null to keep the tag. */
  private stylesheet(tag: HtmlTag, href: string): string | null {
    const path = resolveDocLink(this.input.entryPath, href);
    if (!path) {
      if (EXTERNAL.test(href)) this.warn(`External stylesheet ${href} does not load in previews; add the file to the doc.`);
      return null;
    }
    const file = this.read(path);
    if (!file || file.encoding !== 'utf8') return '';
    const kept = tag.attributes.filter((entry) => ['media', 'title', 'id', 'disabled'].includes(entry.name));
    const css = this.css(file.content, path);
    return `${startTag('style', [{ name: 'data-dd-href', value: path }, ...kept])}${escapeStyleText(css)}</style>`;
  }

  /** Any script the browser would run, as an inert block for the page runtime. */
  private script(tag: HtmlTag, inline: string): string | null {
    const type = (attribute(tag, 'type') ?? '').trim().toLowerCase();
    if (!isScriptType(type)) return null;
    // A module-capable browser skips these, and the runtime always is one.
    if (attribute(tag, 'nomodule') !== undefined) return '';
    const module = type === 'module';
    const marks: HtmlAttribute[] = [{ name: 'type', value: 'text/x-dd-script' }];
    if (module) marks.push({ name: 'data-dd-type', value: 'module' });
    const src = attribute(tag, 'src');
    if (src !== undefined && attribute(tag, 'async') !== undefined) marks.push({ name: 'data-dd-async', value: null });
    else if (src !== undefined && !module && attribute(tag, 'defer') !== undefined) marks.push({ name: 'data-dd-defer', value: null });
    const kept = tag.attributes.filter((entry) => entry.name.startsWith('data-') && !entry.name.startsWith('data-dd-'));
    let code = inline;
    let label = this.input.entryPath;
    if (src !== undefined) {
      const path = src ? resolveDocLink(this.input.entryPath, src) : null;
      if (!path) {
        if (src && EXTERNAL.test(src)) this.warn(`External script ${src} is blocked in previews; add the file to the doc.`);
        return null;
      }
      marks.push({ name: 'data-dd-src', value: path });
      const file = this.read(path);
      if (!file || file.encoding !== 'utf8') return `${startTag('script', [...marks, { name: 'data-dd-missing', value: null }, ...kept])}</script>`;
      code = escapeScriptText(file.content);
      label = path;
    }
    if (module && RELATIVE_IMPORT.test(code)) {
      this.warn(`${label} imports other modules; previews run each script on its own, so bundle modules into one file.`);
    }
    return `${startTag('script', [...marks, ...kept])}${code}</script>`;
  }

  /**
   * `<meta http-equiv=refresh>` to a doc page (the usual GitHub Pages
   * redirect) would navigate the frame away; hand it to the runtime instead.
   */
  private refresh(tag: HtmlTag): string | null {
    const match = (attribute(tag, 'content') ?? '').match(/^\s*(\d+(?:\.\d+)?)?\s*[;,]?\s*(?:url\s*=\s*)?(['"]?)(.*?)\2\s*$/i);
    const target = match?.[3] ? resolveDocLink(this.input.entryPath, match[3]) : null;
    if (!target) return null;
    const hash = match![3]!.indexOf('#');
    const url = pageUrl(target) + (hash >= 0 ? match![3]!.slice(hash) : '');
    return startTag('meta', [{ name: 'name', value: 'dd-refresh' }, { name: 'content', value: `${match![1] ?? '0'};${url}` }]);
  }

  /** Image attributes, `style="…url()…"` and other per-tag rewrites; null to keep the tag. */
  private attributes(tag: HtmlTag): string | null {
    const urlAttributes = IMAGE_ATTRIBUTES[tag.name] ?? [];
    let changed = false;
    const attributes = tag.attributes.map((entry) => {
      if (entry.value === null) return entry;
      let value: string | null = null;
      if (entry.name === 'style' && /url\(/i.test(entry.value)) value = this.css(entry.value, this.input.entryPath);
      else if (urlAttributes.includes(entry.name)) {
        value = entry.name === 'srcset' ? this.srcset(entry.value) : this.resolveUrl(this.input.entryPath, entry.value);
      }
      if (value === null || value === entry.value) return entry;
      changed = true;
      return { name: entry.name, value };
    });
    const src = attribute(tag, 'src');
    if ((tag.name === 'video' || tag.name === 'audio' || tag.name === 'source') && src && MEDIA.test(src.split(/[?#]/, 1)[0]!)) {
      this.warn('Audio and video do not play in previews.');
    }
    return changed ? startTag(tag.name, attributes, tag.selfClosing) : null;
  }

  run(): PageBundle {
    const { html, entryPath } = this.input;
    let output = '';
    let last = 0;
    let styled = false;
    const replace = (start: number, end: number, text: string | null) => {
      if (text === null) return;
      output += html.slice(last, start) + text;
      last = end;
    };
    for (const tag of scanTags(html)) {
      if (tag.name === 'base') {
        replace(tag.start, tag.end, '');
      } else if (tag.name === 'link') {
        const rel = (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const href = attribute(tag, 'href');
        if (rel.includes('stylesheet') && !rel.includes('alternate')) styled = true;
        if (!href) continue;
        if (rel.includes('stylesheet') && !rel.includes('alternate')) {
          replace(tag.start, tag.end, this.stylesheet(tag, href));
        } else if (rel.some((token) => token === 'icon' || token === 'apple-touch-icon' || token === 'mask-icon')) {
          const path = resolveDocLink(entryPath, href);
          const url = path ? this.asset(path) : null;
          if (url) {
            const attributes = tag.attributes.map((entry) => (entry.name === 'href' ? { name: 'href', value: url } : entry));
            replace(tag.start, tag.end, startTag('link', attributes));
          }
        } else if (rel.some((token) => ['preload', 'modulepreload', 'prefetch', 'prerender'].includes(token)) && resolveDocLink(entryPath, href)) {
          // The bundle already carries what this would fetch.
          replace(tag.start, tag.end, '');
        }
      } else if (tag.name === 'style' && tag.content) {
        styled = true;
        const css = this.css(html.slice(tag.content.start, tag.content.end), entryPath);
        replace(tag.start, tag.content.closeEnd, `${html.slice(tag.start, tag.end)}${escapeStyleText(css)}</style>`);
      } else if (tag.name === 'script' && tag.content) {
        replace(tag.start, tag.content.closeEnd, this.script(tag, html.slice(tag.content.start, tag.content.end)));
      } else if (tag.name === 'iframe') {
        if (resolveDocLink(entryPath, attribute(tag, 'src') ?? '')) {
          this.warn('Pages embedded with <iframe> do not render in previews; link to them instead.');
        }
      } else if (tag.name === 'meta' && (attribute(tag, 'http-equiv') ?? '').toLowerCase() === 'refresh') {
        replace(tag.start, tag.end, this.refresh(tag));
      } else if (!tag.content) {
        replace(tag.start, tag.end, this.attributes(tag));
      }
    }
    output += html.slice(last);
    output = prependToHead(output, `<base href="${escapeAttribute(pageBaseHref(entryPath))}">`);
    const deps = [...this.files]
      .filter((entry): entry is [string, PageSource] => entry[1] !== null)
      .map(([path, file]) => ({ path, revision: file.revision }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return { html: output, deps, missing: [...this.missing].sort(), warnings: [...this.warnings], styled };
  }
}

export function bundlePage(input: BundleInput): PageBundle {
  return new PageBundler(input).run();
}
