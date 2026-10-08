/**
 * Pure helpers that turn a design doc's files into something the host can
 * render: relative links and images resolved inside the doc, HTML pages
 * themed with Zana tokens, and code wrapped in safe fences.
 */
import type { DesignDocFile } from '../shared/contract.js';
import { prependToHead } from '../shared/html-scan.js';
import { codeLanguageOf, comparePaths, imageMediaTypeOf, resolveDocLink } from '../shared/paths.js';

export { resolveDocLink };

export interface DocLocation {
  docId: string | null;
  path: string | null;
}

/** Nav-panel sub-path: `<docId>` or `<docId>/<file path>`. */
export function parseSubPath(subPath: string | undefined | null): DocLocation {
  const segments = (subPath ?? '').split('/').filter(Boolean);
  const [docId, ...rest] = segments;
  return { docId: docId ?? null, path: rest.length ? rest.join('/') : null };
}

export function formatSubPath(location: DocLocation): string {
  if (!location.docId) return '';
  return location.path ? `${location.docId}/${location.path}` : location.docId;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** `data:` URL for an image or SVG file, or null for anything else. */
export function fileDataUrl(file: Pick<DesignDocFile, 'path' | 'kind' | 'content' | 'encoding'>): string | null {
  if (file.kind === 'svg') return `data:image/svg+xml;base64,${utf8ToBase64(file.content)}`;
  const mediaType = imageMediaTypeOf(file.path);
  if (file.kind === 'image' && mediaType && file.encoding === 'base64') return `data:${mediaType};base64,${file.content}`;
  return null;
}

const MARKDOWN_IMAGE = /(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function unwrap(target: string): string {
  return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
}

/** Relative image paths a markdown file references, in order, de-duplicated. */
export function referencedImages(fromPath: string, source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(MARKDOWN_IMAGE)) {
    const path = resolveDocLink(fromPath, unwrap(match[2]!));
    if (path) found.add(path);
  }
  return [...found];
}

/** Swap a markdown file's relative image references for the data URLs in `assets` (keyed by doc path). */
export function inlineImages(fromPath: string, source: string, assets: ReadonlyMap<string, string>): string {
  if (!assets.size) return source;
  return source.replace(MARKDOWN_IMAGE, (whole, open: string, target: string, title = '') => {
    const path = resolveDocLink(fromPath, unwrap(target));
    const url = path ? assets.get(path) : undefined;
    return url ? `${open}${url}${title})` : whole;
  });
}

/** A fence longer than any backtick run inside `content`, so code never closes it early. */
export function fenced(content: string, language: string): string {
  const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${content.replace(/\n$/, '')}\n${fence}`;
}

export function codeFence(path: string, content: string): string {
  return fenced(content, codeLanguageOf(path));
}

export const THEME_TOKENS = [
  '--bg-base',
  '--bg-panel',
  '--bg-elevated',
  '--bg-hover',
  '--bg-input',
  '--border',
  '--border-strong',
  '--text-primary',
  '--text-muted',
  '--text-dim',
  '--text-bright',
  '--accent',
  '--accent-blue',
  '--accent-gold',
  '--danger',
  '--success',
  '--font-mono'
] as const;

/** Read the host's current design tokens so HTML mockups match the app theme. */
export function readThemeTokens(root: Element | null = globalThis.document?.documentElement ?? null): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (!root || typeof getComputedStyle !== 'function') return tokens;
  const style = getComputedStyle(root);
  for (const name of THEME_TOKENS) {
    const value = style.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  const scheme = style.getPropertyValue('color-scheme').trim();
  if (scheme) tokens['color-scheme'] = scheme;
  return tokens;
}

const CSS_VALUE = /^[^<>{};]*$/;

/**
 * Theme an HTML page that brings no CSS of its own: the Zana tokens and a
 * neutral base style, first in the head.
 */
export function themedHtml(html: string, tokens: Record<string, string>): string {
  const declarations = Object.entries(tokens)
    .filter(([, value]) => CSS_VALUE.test(value))
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
  const base = `<style data-zcc-theme>:root { ${declarations} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`;
  return prependToHead(html, base);
}

export interface TreeFolder {
  kind: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}

export interface TreeFile<T> {
  kind: 'file';
  name: string;
  path: string;
  file: T;
}

export type TreeNode<T = { path: string }> = TreeFolder | TreeFile<T>;

/** Nest flat file paths into folders, files before subfolders, naturally sorted. */
export function buildTree<T extends { path: string }>(files: readonly T[]): Array<TreeNode<T>> {
  const root: Array<TreeNode<T>> = [];
  const folders = new Map<string, TreeFolder>();
  for (const file of [...files].sort((a, b) => comparePaths(a.path, b.path))) {
    const segments = file.path.split('/');
    let level = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const path = segments.slice(0, index + 1).join('/');
      let folder = folders.get(path);
      if (!folder) {
        folder = { kind: 'folder', name: segments[index]!, path, children: [] };
        folders.set(path, folder);
        level.push(folder);
      }
      level = folder.children as Array<TreeNode<T>>;
    }
    level.push({ kind: 'file', name: segments.at(-1)!, path: file.path, file });
  }
  return root;
}
