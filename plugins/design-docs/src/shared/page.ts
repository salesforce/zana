/**
 * How a rendered HTML page names the files of its design doc.
 *
 * A page renders inside an opaque-origin frame, so relative URLs have nothing
 * real to resolve against. The bundler gives the page a `<base>` on a reserved
 * origin that can never load (`.invalid`, RFC 2606); the page runtime turns
 * requests and links on that origin back into doc paths and asks the host.
 */
import type { PageProblem } from './frame-protocol.js';
import { MAX_FILES_PER_DOC } from './limits.js';
import { normalizeDocPath } from './paths.js';

export const PAGE_ORIGIN = 'https://doc.invalid';

/** Files under this folder fall back to the plugin's bundled site kit. */
export const KIT_DIR = 'zcc-kit';

/** What the kit ships; an exported site gets a copy of each. */
export const KIT_FILES = ['site.css', 'site.js'] as const;

/** Bytes of data: URLs (images, fonts) one render inlines; the rest load on demand. */
export const PAGE_ASSET_BUDGET = 12 * 1024 * 1024;

/** The plugin RPC endpoint refuses request bodies over 1 MB; stay under it. */
export const MAX_RPC_PAYLOAD_BYTES = 960 * 1024;

export interface PageDependency {
  path: string;
  revision: number;
}

export interface PageBundle {
  html: string;
  /** Files the render read and the revision it saw; re-render when one changes. */
  deps: PageDependency[];
  /** Doc paths the page references that do not exist. */
  missing: string[];
  /** What the preview cannot do that the published site would. */
  warnings: string[];
  /** The page brings its own CSS, so the host theme should stay out of it. */
  styled: boolean;
}

/** A page as the `renderPage` RPC returns it. */
export interface RenderedPage extends PageBundle {
  docId: string;
  path: string;
  /** Revision of the saved page, or null for a draft of a new file. */
  revision: number | null;
}

/** The doc changed under a render: the page was saved again, a file it read changed, or a missing file appeared. */
export function renderIsStale(
  page: Pick<RenderedPage, 'path' | 'revision' | 'deps' | 'missing'>,
  files: readonly PageDependency[],
  draft: boolean
): boolean {
  const revisions = new Map(files.map((file) => [file.path, file.revision]));
  if (!draft && page.revision !== (revisions.get(page.path) ?? null)) return true;
  if (page.deps.some((dep) => (revisions.get(dep.path) ?? 0) !== dep.revision)) return true;
  return page.missing.some((path) => revisions.has(path));
}

/**
 * A render's dependencies plus the files its page fetched while it ran (data
 * for charts, a script's own `fetch`), with the revision each had then.
 */
export function withFetched(deps: readonly PageDependency[], fetched: ReadonlyMap<string, number>): PageDependency[] {
  const all = [...deps];
  const seen = new Set(deps.map((dep) => dep.path));
  for (const [path, revision] of fetched) {
    if (all.length >= MAX_FILES_PER_DOC) break;
    if (!seen.has(path)) all.push({ path, revision });
  }
  return all;
}

/**
 * What the panel saw when it ran a saved page, sent back so agents can read
 * it: the page's own problems (script errors, blocked actions; the bundler's
 * missing files and warnings the server works out itself) and the open
 * comments whose quoted text the page did not show.
 */
export interface PageRenderReport {
  path: string;
  revision: number;
  /** From the render, so the server can tell when the doc has moved on. */
  deps: PageDependency[];
  missing: string[];
  problems: PageProblem[];
  unanchored: string[];
}

/** JSON that can sit in a `<script type="application/json">` without ending it. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function pageUrl(path: string): string {
  return `${PAGE_ORIGIN}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** `<base href>` for a page: its own folder on the page origin. */
export function pageBaseHref(entryPath: string): string {
  const slash = entryPath.lastIndexOf('/');
  return slash < 0 ? `${PAGE_ORIGIN}/` : `${pageUrl(entryPath.slice(0, slash))}/`;
}

export interface PageTarget {
  path: string;
  /** `#fragment` without the hash, or null. */
  hash: string | null;
}

/**
 * The doc file a page URL names, or null when it is not on the page origin or
 * not a valid doc path. A folder URL names its `index.html`.
 */
export function pageTargetOf(url: string): PageTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== PAGE_ORIGIN) return null;
  let path: string;
  try {
    path = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
  if (!path || parsed.pathname.endsWith('/')) path = path ? `${path}/index.html` : 'index.html';
  try {
    path = normalizeDocPath(path);
  } catch {
    return null;
  }
  return { path, hash: parsed.hash ? decodeHash(parsed.hash.slice(1)) : null };
}

function decodeHash(hash: string): string {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}
