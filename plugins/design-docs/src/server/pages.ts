/**
 * Rendered HTML pages of a design doc: the bundle the in-app frame shows, and
 * standalone pages served over plugin HTTP so a doc opens like the site it
 * will become (the system browser, the in-app browser, `zcc design-docs
 * preview`).
 *
 * A standalone page carries everything it needs: its CSP sandbox gives it an
 * opaque origin, so the plugin's own routes would refuse its fetches. Files
 * the page may fetch at run time ride along in a JSON pack the page runtime
 * reads; links to other doc files navigate to these same routes.
 */
import { Buffer } from 'node:buffer';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { PluginHttpRequest, PluginHttpResponse } from '@zana-ai/zcc-plugin-sdk/server';
import { PAGE_CONFIG_ID, PAGE_FILES_ID, type PageConfig, type PageFile } from '../shared/frame-protocol.js';
import { prependToHead } from '../shared/html-scan.js';
import { MAX_TEXT_FILE_BYTES } from '../shared/limits.js';
import { KIT_DIR, PAGE_ORIGIN, scriptJson, type RenderedPage } from '../shared/page.js';
import { comparePaths, fileKindOf, imageMediaTypeOf, isBinaryKind, mediaTypeOf, normalizeDocPath } from '../shared/paths.js';
import { bundlePage, escapeScriptText, type PageSource } from './page-bundle.js';
import { DesignDocError, type DesignDocStore } from './store.js';

/** A site-kit file by its path inside the kit, or null. */
export type KitReader = (path: string) => PageSource | null;

export const NO_KIT: KitReader = () => null;

const MAX_KIT_CACHE = 200;

/** Bytes of other doc files a standalone page carries for its fetches. */
export const STANDALONE_PACK_BUDGET = 8 * 1024 * 1024;

/**
 * Reads the plugin's bundled site kit. Paths come from page markup, so each
 * one is normalised and must resolve (symlinks included) inside the kit.
 */
export function createKitReader(kitDir: string): KitReader {
  const cache = new Map<string, PageSource | null>();
  let root: string | null | undefined;
  const load = (raw: string): PageSource | null => {
    let path: string;
    try {
      path = normalizeDocPath(raw);
    } catch {
      return null;
    }
    if (root === undefined) {
      try {
        root = realpathSync(kitDir);
      } catch {
        root = null;
      }
    }
    if (!root) return null;
    try {
      const target = realpathSync(join(root, path));
      if (!target.startsWith(root + sep)) return null;
      const stat = statSync(target);
      if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) return null;
      const kind = fileKindOf(path);
      const binary = isBinaryKind(kind);
      const content = readFileSync(target, binary ? 'base64' : 'utf8');
      return { path: `${KIT_DIR}/${path}`, kind, content, encoding: binary ? 'base64' : 'utf8', revision: 0 };
    } catch {
      return null;
    }
  };
  return (path) => {
    if (cache.has(path)) return cache.get(path)!;
    const file = load(path);
    if (cache.size < MAX_KIT_CACHE) cache.set(path, file);
    return file;
  };
}

/** Doc files by path, with `zcc-kit/…` falling back to the kit when the doc has no such file. */
export function docPageReader(store: DesignDocStore, docId: string, kit: KitReader): (path: string) => PageSource | null {
  return (path) => {
    try {
      const file = store.readFile(docId, path);
      return { path: file.path, kind: file.kind, content: file.content, encoding: file.encoding, revision: file.revision };
    } catch (error) {
      if (!(error instanceof DesignDocError) || (error.code !== 'not_found' && error.code !== 'invalid')) throw error;
    }
    return path.startsWith(`${KIT_DIR}/`) ? kit(path.slice(KIT_DIR.length + 1)) : null;
  };
}

export interface RenderPageInput {
  doc: string;
  /** Defaults to the doc's entry file. */
  path?: string;
  /** Unsaved HTML to render in place of the saved file. */
  draft?: string;
}

export type { RenderedPage };

function pagePath(raw: string): string {
  try {
    return normalizeDocPath(raw);
  } catch (error) {
    throw new DesignDocError('invalid', (error as Error).message);
  }
}

export function renderPage(store: DesignDocStore, kit: KitReader, input: RenderPageInput): RenderedPage {
  const doc = store.summary(input.doc);
  const path = pagePath(input.path ?? doc.entryPath);
  if (fileKindOf(path) !== 'html') throw new DesignDocError('invalid', `${path} is not an HTML page`);
  if (input.draft !== undefined && Buffer.byteLength(input.draft, 'utf8') > MAX_TEXT_FILE_BYTES) {
    throw new DesignDocError('limit', `the draft of ${path} is larger than a doc file may be`);
  }
  const read = docPageReader(store, doc.id, kit);
  const saved = read(path);
  if (input.draft === undefined && (!saved || saved.revision === 0)) throw new DesignDocError('not_found', `${path} not found in ${doc.slug}`);
  const html = input.draft ?? saved!.content;
  const bundle = bundlePage({ entryPath: path, html, read });
  return { docId: doc.id, path, revision: saved && saved.revision > 0 ? saved.revision : null, ...bundle };
}

export interface StandaloneOptions {
  endpoint: string;
  /** Source of the page runtime. */
  runtime: string;
  packBudget?: number;
}

/** Doc files a page may fetch: everything the bundle did not inline, text before binaries, within the budget. */
export function packFiles(files: readonly PageSource[], page: RenderedPage, budget = STANDALONE_PACK_BUDGET): Record<string, PageFile> {
  const inlined = new Set([page.path, ...page.deps.map((dep) => dep.path)]);
  const candidates = files
    .filter((file) => !inlined.has(file.path))
    .sort((a, b) => Number(a.encoding === 'base64') - Number(b.encoding === 'base64') || comparePaths(a.path, b.path));
  const pack: Record<string, PageFile> = {};
  let used = 0;
  for (const file of candidates) {
    const size = file.content.length + file.path.length;
    if (used + size > budget) continue;
    used += size;
    pack[file.path] = { kind: file.kind, encoding: file.encoding, content: file.content };
  }
  return pack;
}

export function standalonePageHtml(store: DesignDocStore, kit: KitReader, input: RenderPageInput, options: StandaloneOptions): string {
  const page = renderPage(store, kit, { doc: input.doc, path: input.path });
  const files = store.readAllFiles(page.docId);
  const config: PageConfig = {
    mode: 'standalone',
    docId: page.docId,
    path: page.path,
    endpoint: options.endpoint,
    files: files.map((file) => file.path),
    missing: page.missing,
    warnings: page.warnings
  };
  const pack = packFiles(files, page, options.packBudget);
  const head =
    `<script type="application/json" id="${PAGE_CONFIG_ID}">${scriptJson(config)}</script>` +
    `<script type="application/json" id="${PAGE_FILES_ID}">${scriptJson(pack)}</script>` +
    `<script>${escapeScriptText(options.runtime)}</script>`;
  return prependToHead(page.html, head);
}

// ── HTTP ──────────────────────────────────────────────────────────────────

/**
 * Standalone pages run the doc's scripts, in a sandbox: an opaque origin with
 * no access to the app, its cookies or its API, and network reach limited to
 * what a published page would have.
 */
export const PAGE_CSP = [
  'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox',
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob: https:',
  'font-src data:',
  'connect-src https:',
  "form-action 'none'",
  `base-uri ${PAGE_ORIGIN}`,
  "frame-ancestors 'none'"
].join('; ');

/** Raw doc files never run anything, SVG included. */
export const FILE_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'";

const COMMON_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // Other sites may not embed these as images or scripts.
  'cross-origin-resource-policy': 'same-origin'
};

export interface PageRouteDeps {
  store: DesignDocStore;
  kit: KitReader;
  endpoint: string;
  runtime(): string;
}

function errorResponse(error: unknown): PluginHttpResponse {
  const code = error instanceof DesignDocError ? error.code : null;
  const status = code === 'not_found' ? 404 : code === 'invalid' || code === 'limit' ? 400 : 500;
  const message = code ? (error as Error).message : 'The page could not be rendered.';
  return { status, body: `${message}\n`, headers: { ...COMMON_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': FILE_CSP } };
}

function queryValue(request: PluginHttpRequest, key: string): string | undefined {
  const value = request.query[key];
  return typeof value === 'string' && value ? value : undefined;
}

function requiredQuery(request: PluginHttpRequest, key: string): string {
  const value = queryValue(request, key);
  if (!value) throw new DesignDocError('invalid', `${key} is required`);
  return value;
}

/** Content type for a raw doc file: images, fonts and SVG as themselves, everything else as plain text. */
export function rawFileType(path: string): string {
  const kind = fileKindOf(path);
  if (kind === 'image') return imageMediaTypeOf(path) ?? 'application/octet-stream';
  if (kind === 'font') return mediaTypeOf(path);
  if (kind === 'svg') return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

export function createPageRoutes(deps: PageRouteDeps) {
  const page = (doc: string, path: string | undefined): PluginHttpResponse => ({
    status: 200,
    body: standalonePageHtml(deps.store, deps.kit, { doc, path }, { endpoint: deps.endpoint, runtime: deps.runtime() }),
    headers: { ...COMMON_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP }
  });

  return {
    /** `GET /page?doc=<id|slug>[&path=<page>]` */
    page(request: PluginHttpRequest): PluginHttpResponse {
      try {
        return page(requiredQuery(request, 'doc'), queryValue(request, 'path'));
      } catch (error) {
        return errorResponse(error);
      }
    },

    /** `GET /file?doc=<id|slug>&path=<file>`: what a link to a non-page file opens. */
    file(request: PluginHttpRequest): PluginHttpResponse {
      try {
        const doc = requiredQuery(request, 'doc');
        const path = pagePath(requiredQuery(request, 'path'));
        if (fileKindOf(path) === 'html') return page(doc, path);
        const summary = deps.store.summary(doc);
        const file = docPageReader(deps.store, summary.id, deps.kit)(path);
        if (!file) throw new DesignDocError('not_found', `${path} not found in ${summary.slug}`);
        return {
          status: 200,
          body: file.encoding === 'base64' ? new Uint8Array(Buffer.from(file.content, 'base64')) : file.content,
          headers: { ...COMMON_HEADERS, 'content-type': rawFileType(path), 'content-security-policy': FILE_CSP }
        };
      } catch (error) {
        return errorResponse(error);
      }
    }
  };
}

/** Plugin HTTP prefix for a plugin id, as the product server mounts it. */
export function pluginHttpEndpoint(pluginId: string): string {
  return `/api/v1/plugins/${encodeURIComponent(pluginId)}/http`;
}

/** Absolute URL of a standalone page. */
export function standalonePageUrl(serverUrl: string, endpoint: string, docId: string, path: string): string {
  const url = new URL(`${endpoint}/page`, serverUrl);
  url.searchParams.set('doc', docId);
  url.searchParams.set('path', path);
  return url.href;
}

/** Where the product server listens, for URLs printed to the user. */
export function productServerUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.ZCC_SERVER_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = env.ZCC_SERVER_PORT && /^\d+$/.test(env.ZCC_SERVER_PORT) ? env.ZCC_SERVER_PORT : '8780';
  return `http://127.0.0.1:${port}`;
}

/**
 * The page runtime's source, read once. Without it a page still renders,
 * its scripts just do not run.
 */
export function createRuntimeSource(path: string, warn: (message: string) => void = () => {}): () => string {
  let source: string | null = null;
  return () => {
    if (source !== null) return source;
    let read: string;
    try {
      read = readFileSync(path, 'utf8');
    } catch (error) {
      warn(`page runtime unavailable: ${(error as Error).message}`);
      return '';
    }
    source = read;
    return read;
  };
}
