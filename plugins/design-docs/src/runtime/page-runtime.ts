/**
 * Runs first in every rendered page of a design doc, in the app's preview
 * frame and in standalone pages alike. The bundler turned the page's scripts
 * into inert `text/x-dd-script` blocks and gave it a `<base>` on the reserved
 * page origin. This runtime:
 *
 * - runs those blocks once the page is parsed, as blob: scripts in browser
 *   order (classic, then deferred and module, then async), and in the frame
 *   binds the on* attributes the app's CSP blocks;
 * - answers fetches, XHRs, late images, links, `window.open` and refreshes
 *   that name doc files, from the standalone page's file pack or by asking
 *   the app;
 * - stands in for the storage and cookies an opaque origin does not have;
 * - in the frame, reports problems, selections and scroll to the app, and
 *   paints open comment quotes with the CSS Highlight API.
 *
 * The page's scripts share this realm and can undo any of it; that is fine,
 * the app trusts nothing the page sends (see `frame-protocol.ts`).
 */
import { COMMENT_HIGHLIGHT, FOCUS_HIGHLIGHT, findQuoteRanges, paintRanges } from '../app/highlight.js';
import {
  MAX_PAGE_PROBLEMS,
  MAX_PAGE_STORAGE_CHARS,
  PAGE_CONFIG_ID,
  PAGE_FILES_ID,
  PAGE_HELLO,
  type FromPage,
  type PageConfig,
  type PageFile,
  type PageProblem,
  type ToPage
} from '../shared/frame-protocol.js';
import { MAX_QUOTE_LENGTH } from '../shared/limits.js';
import { PAGE_ORIGIN, pageTargetOf, pageUrl, type PageTarget } from '../shared/page.js';
import { fileKindOf, mediaTypeOf } from '../shared/paths.js';

export type PageWindow = Window & typeof globalThis;

/** The part of the Navigation API's `navigate` event the runtime reads. */
type NavigateEvent = Event & {
  destination?: { url?: string };
  hashChange?: boolean;
  navigationType?: string;
  formData?: unknown;
  downloadRequest?: string | null;
};

export interface RuntimeOptions {
  /** Where a script's code loads from: a blob: URL unless a test says otherwise. */
  scriptUrl?(code: string): string;
  /** Leave a standalone page: follow a link, a redirect, or open a tab. */
  go?(url: string, how: 'assign' | 'replace' | 'tab'): void;
}

export interface PageRuntime {
  readonly config: PageConfig;
  readonly problems: readonly PageProblem[];
  /** A doc file the page asked for, or null when there is none. */
  load(path: string): Promise<PageFile | null>;
}

/** What the page's scripts (and the scripts this runtime adds) can reach on `window.__ddPage`. */
export interface PageHooks {
  bind(index: number, handler: (this: Element, event: Event) => unknown): void;
  ready(): void;
}

const SCRIPT_BLOCK = 'script[type="text/x-dd-script"]';
const FETCH_TIMEOUT_MS = 30_000;
const PAINT_DELAY_MS = 250;
const STORAGE_DELAY_MS = 400;
const REPORT_DELAY_MS = 150;
/** `<body onload>` and friends listen on the window. */
const WINDOW_EVENTS = /^(load|unload|beforeunload|resize|scroll|hashchange|popstate|message|pageshow|pagehide|online|offline|storage|focus|blur|error)$/;
/** URLs the app may open for a page, in a browser of the reader's choosing. */
const OPENABLE = /^(https?|mailto):$/;

const HIGHLIGHT_CSS =
  `::highlight(${COMMENT_HIGHLIGHT}) { background-color: rgba(212, 160, 23, 0.28); text-decoration: underline 2px rgb(212, 160, 23); }\n` +
  `::highlight(${FOCUS_HIGHLIGHT}) { background-color: rgba(212, 160, 23, 0.55); }`;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isPageFile(value: unknown): value is PageFile {
  const file = record(value);
  return !!file && typeof file.content === 'string' && (file.encoding === 'utf8' || file.encoding === 'base64') && typeof file.kind === 'string';
}

/** Read, then drop, one of the JSON blocks the page carries: the page should look like itself. */
function takeJson(doc: Document, id: string): unknown {
  const block = doc.getElementById(id);
  if (!block) return null;
  block.remove();
  try {
    return JSON.parse(block.textContent ?? '');
  } catch {
    return null;
  }
}

export function readPageConfig(doc: Document): PageConfig {
  const raw = record(takeJson(doc, PAGE_CONFIG_ID)) ?? {};
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined);
  const scroll = record(raw.scroll);
  const config: PageConfig = {
    mode: raw.mode === 'standalone' ? 'standalone' : 'frame',
    docId: typeof raw.docId === 'string' ? raw.docId : '',
    path: typeof raw.path === 'string' ? raw.path : ''
  };
  if (typeof raw.endpoint === 'string') config.endpoint = raw.endpoint;
  if (strings(raw.files)) config.files = strings(raw.files);
  if (strings(raw.missing)) config.missing = strings(raw.missing);
  if (strings(raw.quotes)) config.quotes = strings(raw.quotes);
  if (typeof raw.hash === 'string') config.hash = raw.hash;
  if (scroll && Number.isFinite(scroll.x) && Number.isFinite(scroll.y)) config.scroll = { x: scroll.x as number, y: scroll.y as number };
  const storage = record(raw.storage);
  if (storage) config.storage = Object.fromEntries(Object.entries(storage).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  return config;
}

export function readPack(doc: Document): Map<string, PageFile> {
  const pack = new Map<string, PageFile>();
  for (const [path, file] of Object.entries(record(takeJson(doc, PAGE_FILES_ID)) ?? {})) {
    if (isPageFile(file)) pack.set(path, file);
  }
  return pack;
}

export function decodeBase64(content: string): Uint8Array<ArrayBuffer> {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function fileBody(file: PageFile): string | Uint8Array<ArrayBuffer> {
  return file.encoding === 'base64' ? decodeBase64(file.content) : file.content;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** True for a link or `window.open` target that leaves this browsing context. */
export function opensNewTab(target: string | null | undefined): boolean {
  return !!target && !['_self', '_parent', '_top'].includes(target.trim().toLowerCase());
}

/** In-memory `Storage` for a page whose opaque origin has none. */
export class MemoryStorage {
  readonly #items: Map<string, string>;
  readonly #changed: () => void;

  constructor(seed: Record<string, string> = {}, changed: () => void = () => {}) {
    this.#items = new Map(Object.entries(seed));
    this.#changed = changed;
  }

  get length(): number {
    return this.#items.size;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#items.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#items.set(String(key), String(value));
    this.#changed();
  }

  removeItem(key: string): void {
    if (this.#items.delete(String(key))) this.#changed();
  }

  clear(): void {
    if (!this.#items.size) return;
    this.#items.clear();
    this.#changed();
  }

  entries(): Record<string, string> {
    return Object.fromEntries(this.#items);
  }
}

/** Give the page a working `localStorage`/`sessionStorage` when reading it throws; returns the stand-in. */
export function ensureStorage(
  win: object,
  name: 'localStorage' | 'sessionStorage',
  seed?: Record<string, string>,
  changed?: () => void
): MemoryStorage | null {
  try {
    if ((win as Record<string, Storage>)[name]) return null;
  } catch {
    // An opaque origin: fall through to the stand-in.
  }
  const storage = new MemoryStorage(seed, changed);
  try {
    Object.defineProperty(win, name, { configurable: true, enumerable: true, get: () => storage });
  } catch {
    return null;
  }
  return storage;
}

/** Give the page a cookie jar for this page view when `document.cookie` throws. */
export function ensureCookies(doc: object): boolean {
  try {
    void (doc as Document).cookie;
    return false;
  } catch {
    // An opaque origin: fall through to the stand-in.
  }
  const jar = new Map<string, string>();
  Object.defineProperty(doc, 'cookie', {
    configurable: true,
    get: () => [...jar].map(([key, value]) => (key ? `${key}=${value}` : value)).join('; '),
    set: (raw: string) => {
      const [pair = '', ...attributes] = String(raw).split(';');
      const eq = pair.indexOf('=');
      const key = eq < 0 ? '' : pair.slice(0, eq).trim();
      const value = (eq < 0 ? pair : pair.slice(eq + 1)).trim();
      const expired = attributes.some((attribute) => {
        const [name = '', setting = ''] = attribute.split('=').map((part) => part.trim());
        if (name.toLowerCase() === 'max-age') return Number(setting) <= 0;
        return name.toLowerCase() === 'expires' && Date.parse(setting) <= Date.now();
      });
      if (expired) jar.delete(key);
      else jar.set(key, value);
    }
  });
  return true;
}

/** Run `run` once things settle for `delay` ms. */
function debounce(win: PageWindow, delay: number, run: () => void): () => void {
  let timer: number | undefined;
  return () => {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      timer = undefined;
      run();
    }, delay);
  };
}

/** Run `run` at most once per `delay` ms, after the latest call; a page that never settles still gets runs. */
function throttle(win: PageWindow, delay: number, run: () => void): () => void {
  let timer: number | undefined;
  return () => {
    if (timer !== undefined) return;
    timer = win.setTimeout(() => {
      timer = undefined;
      run();
    }, delay);
  };
}

/** Define `name` on one object, shadowing whatever its prototype has. */
function override(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
}

interface HandlerEntry {
  element: Element;
  name: string;
  type: string;
  code: string;
  target: EventTarget;
  listener?: EventListener;
}

export function startPageRuntime(win: PageWindow, options: RuntimeOptions = {}): PageRuntime {
  const doc = win.document;
  const config = readPageConfig(doc);
  const pack = readPack(doc);
  const frame = config.mode === 'frame';
  const files = config.files ? new Set(config.files) : null;
  const problems: PageProblem[] = [];
  const seenProblems = new Set<string>();
  /** Script URL → the doc file or inline block it runs. */
  const labels = new Map<string, string>();
  const nativeOpen = win.open;

  // ── The app, over a private port ────────────────────────────────────────
  let port: MessagePort | null = null;
  if (frame && win.parent && win.parent !== win && typeof win.MessageChannel === 'function') {
    const channel = new win.MessageChannel();
    port = channel.port1;
    win.parent.postMessage({ dd: PAGE_HELLO }, '*', [channel.port2]);
  }
  const post = (message: FromPage) => {
    try {
      port?.postMessage(message);
    } catch {
      // The app went away mid-render; nothing to tell.
    }
  };

  const report = (problem: PageProblem) => {
    const key = [problem.kind, problem.message, problem.source ?? '', problem.line ?? ''].join('\u0000');
    if (seenProblems.has(key) || problems.length >= MAX_PAGE_PROBLEMS) return;
    seenProblems.add(key);
    problems.push(problem);
    if (port) post({ type: 'problem', problem });
    // The console already shows errors; say what only the runtime knows.
    else if (problem.kind !== 'error') win.console?.warn?.(`[design doc] ${problem.source ? `${problem.source}: ` : ''}${problem.message}`);
  };

  const labelOf = (url: string | undefined): string => {
    if (!url) return config.path;
    return labels.get(url) ?? (url.startsWith('dd:') ? safeDecode(url.slice(3)) : config.path);
  };

  win.addEventListener('error', (event) => {
    if (!(event instanceof win.ErrorEvent)) return;
    report({ kind: 'error', message: event.message || 'Script error', source: labelOf(event.filename), ...(event.lineno ? { line: event.lineno } : {}) });
  });
  win.addEventListener('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    report({ kind: 'error', message: `Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`, source: config.path });
  });
  doc.addEventListener('securitypolicyviolation', (event) => {
    // The runtime answers these itself: on* attributes in the frame, doc files everywhere.
    if ((frame && event.effectiveDirective === 'script-src-attr') || event.blockedURI.startsWith(PAGE_ORIGIN)) return;
    const blocked = event.blockedURI || 'inline code';
    report({
      kind: 'blocked',
      message: `The preview's sandbox blocked ${blocked} (${event.effectiveDirective || event.violatedDirective})`,
      source: labelOf(event.sourceFile),
      ...(event.lineNumber ? { line: event.lineNumber } : {})
    });
  });

  // ── Doc files ───────────────────────────────────────────────────────────
  /** A URL as the page resolves it: a doc target; null on the page origin but naming no doc file; undefined elsewhere. */
  const absoluteUrl = (raw: string): URL | null => {
    try {
      return new URL(raw, doc.baseURI);
    } catch {
      return null;
    }
  };
  const docTarget = (raw: string): PageTarget | null | undefined => {
    const url = absoluteUrl(raw);
    return url?.origin === PAGE_ORIGIN ? pageTargetOf(url.href) : undefined;
  };

  let nextRequest = 0;
  const pending = new Map<number, (file: PageFile | null) => void>();
  const load = (path: string): Promise<PageFile | null> => {
    if (!frame) return Promise.resolve(pack.get(path) ?? null);
    if (!port) return Promise.resolve(null);
    const id = nextRequest++;
    return new Promise((resolve) => {
      const timer = win.setTimeout(() => settle(null), FETCH_TIMEOUT_MS);
      const settle = (file: PageFile | null) => {
        win.clearTimeout(timer);
        pending.delete(id);
        resolve(file);
      };
      pending.set(id, settle);
      post({ type: 'fetch', id, path });
    });
  };
  /** A doc file without waiting, when the page carries it; undefined when only the app has it. */
  const loadNow = (path: string): PageFile | null | undefined => (frame ? undefined : (pack.get(path) ?? null));

  const reportMissing = (path: string, what: string) => {
    const leftOut = !frame && files?.has(path);
    report({
      kind: 'missing',
      message: leftOut
        ? `${what} ${path}, which this standalone page left out to stay small; open the doc in Zana to load it`
        : `${what} ${path}, which is not a file in this doc`,
      source: config.path
    });
  };

  const response = (path: string, file: PageFile | null, head: boolean): Response => {
    const result = file
      ? new win.Response(head ? null : fileBody(file), { status: 200, statusText: 'OK', headers: { 'content-type': mediaTypeOf(path) } })
      : new win.Response(head ? null : 'Not found', { status: 404, statusText: 'Not Found', headers: { 'content-type': 'text/plain;charset=utf-8' } });
    override(result, 'url', pageUrl(path));
    return result;
  };

  const nativeFetch = win.fetch;
  if (typeof nativeFetch === 'function') {
    win.fetch = function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const raw = typeof input === 'object' && input && 'url' in input ? input.url : String(input);
      const target = docTarget(raw);
      if (target === undefined) return nativeFetch.call(win, input, init);
      const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        report({ kind: 'blocked', message: `A ${method} request to ${target?.path ?? raw} has nowhere to go: published pages are static`, source: config.path });
        return Promise.resolve(new win.Response(null, { status: 405, statusText: 'Method Not Allowed' }));
      }
      if (!target) return Promise.resolve(response('', null, method === 'HEAD'));
      return load(target.path).then((file) => {
        if (!file) reportMissing(target.path, 'The page fetched');
        return response(target.path, file, method === 'HEAD');
      });
    } as typeof win.fetch;
  }

  installRequests(win, { docTarget, load, loadNow, reportMissing, report, source: config.path });

  // ── Storage and cookies ────────────────────────────────────────────────
  let local: MemoryStorage | null = null;
  const storageChanged = throttle(win, STORAGE_DELAY_MS, () => {
    const entries = local?.entries() ?? {};
    const size = Object.entries(entries).reduce((total, [key, value]) => total + key.length + value.length, 0);
    if (size <= MAX_PAGE_STORAGE_CHARS) post({ type: 'storage', entries });
  });
  local = ensureStorage(win, 'localStorage', config.storage, frame ? storageChanged : undefined);
  ensureStorage(win, 'sessionStorage');
  ensureCookies(doc);

  // ── Leaving the page ────────────────────────────────────────────────────
  const go =
    options.go ??
    ((url: string, how: 'assign' | 'replace' | 'tab') => {
      if (how === 'tab') nativeOpen?.call(win, url, '_blank', 'noopener');
      else win.location[how](url);
    });

  const standaloneUrl = (target: PageTarget): string => {
    let path = target.path;
    // A static host serves `runs/a` as `runs/a/index.html` when that is all there is.
    if (files && !files.has(path) && files.has(`${path}/index.html`)) path = `${path}/index.html`;
    const url = new URL(`${config.endpoint ?? ''}/${fileKindOf(path) === 'html' ? 'page' : 'file'}`, win.location.href);
    url.searchParams.set('doc', config.docId);
    url.searchParams.set('path', path);
    if (target.hash !== null) url.hash = target.hash;
    return url.href;
  };

  const scrollToFragment = (hash: string) => {
    if (!hash || hash.toLowerCase() === 'top') {
      win.scrollTo(0, 0);
      return;
    }
    (doc.getElementById(hash) ?? doc.getElementsByName(hash)[0])?.scrollIntoView?.();
  };

  const goToHash = (hash: string) => {
    if (safeDecode(win.location.hash.slice(1)) !== hash) win.location.hash = hash;
    else scrollToFragment(hash);
  };

  const navigate = (target: PageTarget, { newTab = false, redirect = false } = {}) => {
    if (target.path === config.path && !newTab && target.hash !== null && !redirect) {
      goToHash(target.hash);
      return;
    }
    if (frame) post({ type: 'navigate', path: target.path, hash: target.hash, newTab, redirect });
    else go(standaloneUrl(target), newTab ? 'tab' : redirect ? 'replace' : 'assign');
  };

  win.open = function open(url?: string | URL, target?: string, features?: string): WindowProxy | null {
    if (url !== undefined && String(url) !== '') {
      const link = docTarget(String(url));
      if (link) {
        navigate(link, { newTab: target === undefined || opensNewTab(target) });
        return null;
      }
      if (link === null) {
        report({ kind: 'missing', message: `window.open(${String(url)}) names no file in this doc`, source: config.path });
        return null;
      }
      const absolute = frame ? absoluteUrl(String(url)) : null;
      if (absolute && OPENABLE.test(absolute.protocol)) {
        post({ type: 'open', url: absolute.href });
        return null;
      }
    }
    return nativeOpen.call(win, url, target, features);
  } as typeof win.open;

  // ── Scripts ─────────────────────────────────────────────────────────────
  const scriptUrl =
    options.scriptUrl ??
    ((code: string) => win.URL.createObjectURL(new win.Blob([code], { type: 'text/javascript' })));

  const addScript = (code: string, label: string, extra: { module?: boolean; async?: boolean; attributes?: readonly Attr[] } = {}) => {
    const script = doc.createElement('script');
    for (const attribute of extra.attributes ?? []) script.setAttribute(attribute.name, attribute.value);
    if (extra.module) script.type = 'module';
    // `async = false` keeps insertion order; pending scripts also hold the load event.
    script.async = !!extra.async;
    const url = scriptUrl(`${code}\n//# sourceURL=dd:${encodeURIComponent(label)}`);
    labels.set(url, label);
    if (url.startsWith('blob:')) script.addEventListener('load', () => win.URL.revokeObjectURL(url), { once: true });
    script.src = url;
    (doc.head ?? doc.documentElement).appendChild(script);
  };

  // Scripts run after the page is parsed, so replay DOMContentLoaded for listeners they add.
  // An async script may add one later still; in a browser it could have run first, so it gets one too.
  let parsed = false;
  let readied = false;
  const lateReady: Array<{ target: EventTarget; listener: EventListenerOrEventListenerObject }> = [];
  for (const target of [doc, win] as EventTarget[]) {
    const add = target.addEventListener;
    override(target, 'addEventListener', function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, more?: AddEventListenerOptions | boolean) {
      if (type === 'DOMContentLoaded' && parsed && listener) {
        lateReady.push({ target, listener });
        if (readied) win.setTimeout(fireReady, 0);
        return;
      }
      add.call(this, type, listener, more);
    });
  }
  const fireReady = () => {
    for (const { target, listener } of lateReady.splice(0)) {
      const event = new win.Event('DOMContentLoaded');
      try {
        if (typeof listener === 'function') listener.call(target, event);
        else listener.handleEvent(event);
      } catch (error) {
        win.console?.error?.(error);
      }
    }
  };

  // on* attributes: the frame's CSP blocks them, so each becomes its own script (one typo does not break the rest).
  const handlers: HandlerEntry[] = [];
  const bound = new WeakMap<Element, Record<string, HandlerEntry>>();
  const bindHandlers = (element: Element) => {
    let entries = bound.get(element);
    if (!entries) bound.set(element, (entries = {}));
    for (const name of Object.keys(entries)) {
      const entry = entries[name]!;
      if (element.getAttribute(name) === entry.code) continue;
      if (entry.listener) entry.target.removeEventListener(entry.type, entry.listener);
      delete entries[name];
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (!/^on[a-z]+$/.test(name) || entries[name]) continue;
      const type = name.slice(2);
      const entry: HandlerEntry = {
        element,
        name,
        type,
        code: attribute.value,
        target: element === doc.body && WINDOW_EVENTS.test(type) ? win : element
      };
      entries[name] = entry;
      handlers.push(entry);
      addScript(`window.__ddPage.bind(${handlers.length - 1}, function (event) {\n${entry.code}\n});`, `${config.path} (${name} on <${element.localName}>)`);
    }
  };
  const bindTree = (node: Node) => {
    if (node.nodeType !== 1) return;
    bindHandlers(node as Element);
    for (const element of (node as Element).querySelectorAll('*')) bindHandlers(element);
  };

  const hooks: PageHooks = {
    bind(index, handler) {
      const entry = handlers[index];
      // The attribute changed again before this script ran.
      if (!entry || bound.get(entry.element)?.[entry.name] !== entry) return;
      entry.listener = function (event: Event) {
        if (handler.call(entry.target as Element, event) === false) event.preventDefault();
      };
      entry.target.addEventListener(entry.type, entry.listener);
    },
    ready() {
      if (readied) return;
      readied = true;
      fireReady();
      if (!frame) return;
      restoreView();
      paint();
      post({ type: 'ready' });
    }
  };
  Object.defineProperty(win, '__ddPage', { value: Object.freeze(hooks) });

  const runBlocks = () => {
    const ordered: Array<() => void> = [];
    const deferred: Array<() => void> = [];
    const later: Array<() => void> = [];
    let inline = 0;
    for (const block of doc.querySelectorAll<HTMLScriptElement>(SCRIPT_BLOCK)) {
      if (block.hasAttribute('data-dd-missing')) continue;
      const label = block.getAttribute('data-dd-src') ?? `${config.path} (inline script ${(inline += 1)})`;
      const module = block.getAttribute('data-dd-type') === 'module';
      const async = block.hasAttribute('data-dd-async');
      const attributes = [...block.attributes].filter((entry) => entry.name.startsWith('data-') && !entry.name.startsWith('data-dd-'));
      const run = () => addScript(block.textContent ?? '', label, { module, async, attributes });
      if (async) later.push(run);
      else if (module || block.hasAttribute('data-dd-defer')) deferred.push(run);
      else ordered.push(run);
    }
    for (const run of [...ordered, ...deferred]) run();
    addScript('window.__ddPage.ready();', 'design doc runtime');
    for (const run of later) run();
  };

  // ── Links, forms and redirects ──────────────────────────────────────────
  /**
   * Take over an event's default action unless the page prevents it. The
   * decision waits until the page's own handlers ran: at the window, or as
   * soon as one stops the event from getting there.
   */
  const claims = new WeakMap<Event, () => void>();
  const intercept = (event: Event, action: () => void) => {
    const nativePrevent = event.preventDefault;
    let claimed = false;
    let pagePrevented = false;
    const claim = () => {
      if (claimed || event.defaultPrevented) return;
      claimed = true;
      override(event, 'preventDefault', () => {
        pagePrevented = true;
        nativePrevent.call(event);
      });
      nativePrevent.call(event);
      win.setTimeout(() => {
        if (!pagePrevented) action();
      }, 0);
    };
    for (const name of ['stopPropagation', 'stopImmediatePropagation'] as const) {
      const stop = event[name];
      override(event, name, () => {
        claim();
        stop.call(event);
      });
    }
    claims.set(event, claim);
  };

  /** In the frame the app knows every doc file; a standalone page checks its list. */
  const canOpen = (target: PageTarget) => frame || !files || files.has(target.path) || files.has(`${target.path}/index.html`);

  const linkAction = (event: MouseEvent): (() => void) | null => {
    if (event.button !== (event.type === 'auxclick' ? 1 : 0)) return null;
    const anchor = (event.target as Element | null)?.closest?.('a, area');
    const raw = anchor?.getAttribute('href') ?? anchor?.getAttribute('xlink:href');
    if (!anchor || raw === null || raw === undefined) return null;
    const href = raw.trim();
    const newTab =
      event.type === 'auxclick' || event.metaKey || event.ctrlKey || event.shiftKey || opensNewTab(anchor.getAttribute('target')) || anchor.hasAttribute('download');
    // Against the page-origin `<base>` these would name another page; they mean this one.
    if (href.startsWith('#')) return () => navigate({ path: config.path, hash: safeDecode(href.slice(1)) }, { newTab });
    if (!href) return () => navigate({ path: config.path, hash: null }, { newTab });
    const url = absoluteUrl(href);
    if (!url) return null;
    if (url.protocol === 'javascript:') {
      return frame ? () => addScript(safeDecode(url.href.slice('javascript:'.length)), `${config.path} (javascript: link)`) : null;
    }
    if (url.origin === PAGE_ORIGIN) {
      const target = pageTargetOf(url.href);
      if (!target) return () => report({ kind: 'missing', message: `The link to ${href} names no file in this doc`, source: config.path });
      return () => {
        if (canOpen(target)) navigate(target, { newTab });
        else reportMissing(target.path, 'A link points to');
      };
    }
    if (frame && OPENABLE.test(url.protocol)) return () => post({ type: 'open', url: url.href });
    return null;
  };

  const onActivate = (event: MouseEvent) => {
    const action = linkAction(event);
    if (action) intercept(event, action);
  };
  win.addEventListener('click', onActivate, true);
  win.addEventListener('auxclick', onActivate, true);
  const formBlocked = () =>
    report({ kind: 'blocked', message: 'A form tried to submit; published pages are static, so handle submit in a script', source: config.path });
  win.addEventListener('submit', (event) => intercept(event, formBlocked), true);
  for (const type of ['click', 'auxclick', 'submit']) win.addEventListener(type, (event) => claims.get(event)?.());

  // A script that sets `location` (or calls `form.submit()`) would leave for
  // the page origin, which never loads. The Navigation API lets us catch it.
  (win as { navigation?: EventTarget }).navigation?.addEventListener('navigate', (raw) => {
    const event = raw as NavigateEvent;
    if (!event.cancelable || event.hashChange || event.downloadRequest || event.navigationType === 'traverse' || event.navigationType === 'reload') return;
    const url = absoluteUrl(event.destination?.url ?? '');
    if (!url) return;
    if (url.origin !== PAGE_ORIGIN) {
      if (frame && OPENABLE.test(url.protocol)) {
        event.preventDefault();
        post({ type: 'open', url: url.href });
      }
      return;
    }
    event.preventDefault();
    const target = pageTargetOf(url.href);
    if (event.formData) formBlocked();
    else if (!target) report({ kind: 'missing', message: `The page tried to open ${url.href}, which names no file in this doc`, source: config.path });
    else if (canOpen(target)) navigate(target, { redirect: event.navigationType === 'replace' });
    else reportMissing(target.path, 'The page tried to open');
  });

  // ── Late images ─────────────────────────────────────────────────────────
  const imageUrls = new Map<string, Promise<string | null>>();
  const fixImage = (image: HTMLImageElement) => {
    const raw = image.getAttribute('src');
    const target = raw ? docTarget(raw) : undefined;
    if (!target) return;
    let url = imageUrls.get(target.path);
    if (!url) {
      url = load(target.path).then((file) => (file ? win.URL.createObjectURL(new win.Blob([fileBody(file)], { type: mediaTypeOf(target.path) })) : null));
      imageUrls.set(target.path, url);
    }
    void url.then((blob) => {
      if (!blob) reportMissing(target.path, 'An image shows');
      else if (image.getAttribute('src') === raw) image.src = blob;
    });
  };
  const fixImages = (node: Node) => {
    if (node.nodeType !== 1) return;
    if ((node as Element).localName === 'img') fixImage(node as HTMLImageElement);
    for (const image of (node as Element).querySelectorAll('img[src]')) fixImage(image as HTMLImageElement);
  };

  // ── Comments: selections, quotes, scroll ────────────────────────────────
  let quotes = config.quotes ?? [];
  const owner = {};
  let anchors = '';
  const root = () => doc.body ?? doc.documentElement;
  function paint() {
    if (!frame) return;
    const ranges = quotes.length ? findQuoteRanges(root(), quotes) : new Map<string, Range>();
    paintRanges(COMMENT_HIGHLIGHT, owner, [...ranges.values()]);
    const found = quotes.filter((quote) => ranges.has(quote));
    const missing = quotes.filter((quote) => !ranges.has(quote));
    const key = JSON.stringify([found, missing]);
    if (key === anchors) return;
    anchors = key;
    post({ type: 'anchors', found, missing });
  }
  const schedulePaint = throttle(win, PAINT_DELAY_MS, paint);

  const focusQuote = (quote: string) => {
    const range = findQuoteRanges(root(), [quote]).get(quote);
    if (range) {
      range.startContainer.parentElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      paintRanges(FOCUS_HIGHLIGHT, owner, [range]);
      win.setTimeout(() => paintRanges(FOCUS_HIGHLIGHT, owner, []), 1800);
    }
    post({ type: 'focused', quote, found: !!range });
  };

  let selected = '';
  const reportSelection = () => {
    const selection = win.getSelection();
    const text = selection && !selection.isCollapsed && selection.rangeCount ? selection.toString().trim().slice(0, MAX_QUOTE_LENGTH) : '';
    if (!text) {
      if (selected) post({ type: 'selection', text: '', rect: null });
      selected = '';
      return;
    }
    selected = text;
    const box = selection!.getRangeAt(0).getBoundingClientRect();
    post({ type: 'selection', text, rect: { top: box.top, left: box.left, bottom: box.bottom, right: box.right } });
  };
  const reportScroll = throttle(win, REPORT_DELAY_MS, () => {
    post({ type: 'scroll', x: win.scrollX, y: win.scrollY });
    if (selected) reportSelection();
  });

  function restoreView() {
    const scroll = config.scroll;
    if (scroll) {
      win.scrollTo(scroll.x, scroll.y);
      win.addEventListener('load', () => win.scrollTo(scroll.x, scroll.y), { once: true });
    } else if (config.hash) {
      scrollToFragment(config.hash);
    }
  }

  if (frame) {
    if (config.hash) {
      // Before any script reads `location.hash`; without a navigation or `hashchange`.
      try {
        win.history.replaceState(win.history.state, '', `${win.location.href.split('#')[0]}#${encodeURI(config.hash)}`);
      } catch {
        // Some documents cannot rewrite their URL; the page opens at the top.
      }
    }
    const style = doc.createElement('style');
    style.setAttribute('data-dd-runtime', '');
    style.textContent = HIGHLIGHT_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
    doc.addEventListener('selectionchange', debounce(win, REPORT_DELAY_MS, reportSelection));
    win.addEventListener('scroll', reportScroll, { passive: true });
    const reportHash = () => post({ type: 'hash', hash: win.location.hash ? safeDecode(win.location.hash.slice(1)) : null });
    win.addEventListener('hashchange', reportHash);
    win.addEventListener('popstate', reportHash);
    if (port) {
      port.onmessage = (event: MessageEvent) => {
        const message = record(event.data) as ToPage | null;
        if (message?.type === 'file') pending.get(message.id)?.(isPageFile(message.file) ? message.file : null);
        else if (message?.type === 'highlight' && Array.isArray(message.quotes)) {
          quotes = message.quotes.filter((quote): quote is string => typeof quote === 'string');
          paint();
        } else if (message?.type === 'focus' && typeof message.quote === 'string') focusQuote(message.quote);
        else if (message?.type === 'clear-selection') win.getSelection()?.removeAllRanges();
      };
    }
  } else {
    for (const path of config.missing ?? []) report({ kind: 'missing', message: `The page uses ${path}, which is not a file in this doc`, source: config.path });
  }

  // ── Once the page is parsed ─────────────────────────────────────────────
  const start = () => {
    parsed = true;
    if (frame) bindTree(doc.documentElement);
    fixImages(doc.documentElement);
    runBlocks();
    const refresh = doc.querySelector('meta[name="dd-refresh"]')?.getAttribute('content')?.match(/^(\d+(?:\.\d+)?);(.+)$/);
    const redirect = refresh ? docTarget(refresh[2]!) : undefined;
    if (redirect) win.setTimeout(() => navigate(redirect, { redirect: true }), Number(refresh![1]) * 1000);
    new win.MutationObserver((records) => {
      let textChanged = false;
      for (const entry of records) {
        if (entry.type === 'attributes') {
          const name = entry.attributeName ?? '';
          if (frame && name.startsWith('on')) bindHandlers(entry.target as Element);
          if (name === 'src' && (entry.target as Element).localName === 'img') fixImage(entry.target as HTMLImageElement);
          continue;
        }
        textChanged = true;
        entry.addedNodes.forEach((node) => {
          if (frame) bindTree(node);
          fixImages(node);
        });
      }
      // Ranges survive restyling; only new or changed text can move a quote.
      if (textChanged && quotes.length) schedulePaint();
    }).observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  return { config, problems, load };
}

interface RequestDeps {
  docTarget(raw: string): PageTarget | null | undefined;
  load(path: string): Promise<PageFile | null>;
  loadNow(path: string): PageFile | null | undefined;
  reportMissing(path: string, what: string): void;
  report(problem: PageProblem): void;
  source: string;
}

/**
 * `XMLHttpRequest` for doc files. A request elsewhere is the browser's own;
 * one for a doc file never reaches the network, and the instance carries the
 * result on own properties shadowing the native getters.
 */
/** The state a doc-file request shadows on its instance. */
const STATE = ['readyState', 'status', 'statusText', 'responseText', 'response', 'responseURL', 'responseXML'];

function installRequests(win: PageWindow, deps: RequestDeps): void {
  const Native = win.XMLHttpRequest;
  if (typeof Native !== 'function') return;
  const nativeOpen = Native.prototype.open as (...args: unknown[]) => void;

  class PageRequest extends Native {
    #doc: { path: string | null; method: string; aborted: boolean; type: string } | null = null;
    #sync = false;

    open(...args: [string, string | URL, boolean?, (string | null)?, (string | null)?]): void {
      const [method, url, async] = args;
      const target = deps.docTarget(String(url));
      if (target === undefined) {
        if (this.#doc) for (const name of STATE) delete (this as Record<string, unknown>)[name];
        this.#doc = null;
        nativeOpen.apply(this, args);
        return;
      }
      if (async === false && deps.loadNow(target?.path ?? '') === undefined) {
        deps.report({ kind: 'blocked', message: `A synchronous request for ${target?.path ?? String(url)} cannot be answered in previews; make it async`, source: deps.source });
        throw new DOMException('Synchronous requests for doc files are not supported here', 'InvalidAccessError');
      }
      this.#doc = { path: target?.path ?? null, method: String(method).toUpperCase(), aborted: false, type: '' };
      this.#set({ readyState: 1, status: 0, statusText: '', responseText: '', response: '', responseURL: '', responseXML: null });
      this.#sync = async === false;
      this.#fire('readystatechange');
    }

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      const request = this.#doc;
      if (!request) {
        super.send(body);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        deps.report({ kind: 'blocked', message: `A ${request.method} request to ${request.path} has nowhere to go: published pages are static`, source: deps.source });
        this.#finish(null, 405);
        return;
      }
      if (!request.path) {
        this.#finish(null, 404);
        return;
      }
      const path = request.path;
      if (this.#sync) {
        this.#finish(deps.loadNow(path) ?? null, undefined, path);
        return;
      }
      void deps.load(path).then((file) => {
        if (!request.aborted) this.#finish(file, undefined, path);
      });
    }

    setRequestHeader(name: string, value: string): void {
      if (!this.#doc) super.setRequestHeader(name, value);
    }

    overrideMimeType(mime: string): void {
      if (!this.#doc) super.overrideMimeType(mime);
    }

    getResponseHeader(name: string): string | null {
      if (!this.#doc) return super.getResponseHeader(name);
      return name.toLowerCase() === 'content-type' && this.#doc.type ? this.#doc.type : null;
    }

    getAllResponseHeaders(): string {
      if (!this.#doc) return super.getAllResponseHeaders();
      return this.#doc.type ? `content-type: ${this.#doc.type}\r\n` : '';
    }

    abort(): void {
      if (!this.#doc) {
        super.abort();
        return;
      }
      if (this.#doc.aborted) return;
      this.#doc.aborted = true;
      this.#set({ readyState: 0, status: 0 });
      this.#fire('abort');
      this.#fire('loadend');
    }

    #finish(file: PageFile | null, status?: number, path?: string): void {
      const request = this.#doc!;
      const code = status ?? (file ? 200 : 404);
      if (!file && path) deps.reportMissing(path, 'The page requested');
      request.type = file && path ? mediaTypeOf(path) : '';
      const head = request.method === 'HEAD';
      const text = head ? '' : file?.encoding === 'utf8' ? file.content : file ? '' : code === 404 ? 'Not found' : '';
      const bytes = (): Uint8Array<ArrayBuffer> => (file ? (fileBody(file) as Uint8Array<ArrayBuffer>) : new Uint8Array(0));
      let response: unknown = text;
      if (this.responseType === 'json') {
        try {
          response = JSON.parse(text);
        } catch {
          response = null;
        }
      } else if (this.responseType === 'arraybuffer') {
        response = file?.encoding === 'base64' && !head ? bytes().buffer : new TextEncoder().encode(text).buffer;
      } else if (this.responseType === 'blob') {
        response = new win.Blob([file?.encoding === 'base64' && !head ? bytes() : text], { type: request.type });
      } else if (this.responseType === 'document') {
        response = null;
      }
      const statusText = code === 200 ? 'OK' : code === 404 ? 'Not Found' : 'Method Not Allowed';
      this.#set({ readyState: 4, status: code, statusText, responseText: text, response, responseURL: path ? pageUrl(path) : '' });
      this.#fire('readystatechange');
      const size = text.length || (file && !head ? bytes().length : 0);
      this.#fire('load', size);
      this.#fire('loadend', size);
    }

    #set(values: Record<string, unknown>): void {
      for (const [name, value] of Object.entries(values)) Object.defineProperty(this, name, { configurable: true, get: () => value });
    }

    #fire(type: string, size = 0): void {
      const event =
        type === 'readystatechange' || typeof win.ProgressEvent !== 'function'
          ? new win.Event(type)
          : new win.ProgressEvent(type, { lengthComputable: size > 0, loaded: size, total: size });
      this.dispatchEvent(event);
    }
  }

  win.XMLHttpRequest = PageRequest as typeof XMLHttpRequest;
}
