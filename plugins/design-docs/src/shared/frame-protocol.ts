/**
 * How a rendered page and the app talk. The page runtime reads its config
 * from a JSON block in the page; in the app's preview frame it then hands the
 * app one end of a MessageChannel (`PAGE_HELLO`) and all traffic flows over
 * that port, out of reach of the page's own `message` listeners.
 *
 * The page runs the doc's scripts, so the app treats everything it sends as
 * untrusted: `parseFromPage` checks shapes and bounds sizes, and the app never
 * does more for a page than a static host would.
 */
import { MAX_QUOTE_LENGTH } from './limits.js';
import type { FileKind } from './paths.js';

export const PAGE_CONFIG_ID = 'dd-page';
export const PAGE_FILES_ID = 'dd-files';
export const PAGE_HELLO = 'dd-page-hello';

export interface PageConfig {
  mode: 'frame' | 'standalone';
  docId: string;
  path: string;
  /** Standalone: plugin HTTP prefix (`/api/v1/plugins/<id>/http`) for links to other doc files. */
  endpoint?: string;
  /** Standalone: every doc path, so a folder link finds its `index.html`. */
  files?: string[];
  missing?: string[];
  warnings?: string[];
  /** Frame: fragment to open the page at, without the `#`. */
  hash?: string | null;
  /** Frame: where the reader was before the page re-rendered. */
  scroll?: { x: number; y: number } | null;
  /** Frame: open comment quotes to paint. */
  quotes?: string[];
  /** Frame: `localStorage` the page wrote before it re-rendered. */
  storage?: Record<string, string>;
}

export interface PageFile {
  kind: FileKind;
  encoding: 'utf8' | 'base64';
  content: string;
}

export type PageProblemKind = 'error' | 'missing' | 'blocked';

export interface PageProblem {
  kind: PageProblemKind;
  message: string;
  /** Doc file (or `page.html (inline script 2)`) the problem came from. */
  source?: string;
  line?: number;
}

export interface PageRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type FromPage =
  | { type: 'ready' }
  | { type: 'fetch'; id: number; path: string }
  /** `redirect`: the page's own `<meta http-equiv=refresh>`, not the reader. */
  | { type: 'navigate'; path: string; hash: string | null; newTab: boolean; redirect: boolean }
  | { type: 'open'; url: string }
  | { type: 'problem'; problem: PageProblem }
  | { type: 'selection'; text: string; rect: PageRect | null }
  | { type: 'anchors'; found: string[]; missing: string[] }
  | { type: 'focused'; quote: string; found: boolean }
  | { type: 'scroll'; x: number; y: number }
  /** The page moved to another fragment of itself, so a re-render can reopen it there. */
  | { type: 'hash'; hash: string | null }
  | { type: 'storage'; entries: Record<string, string> };

export type ToPage =
  | { type: 'file'; id: number; file: PageFile | null }
  | { type: 'highlight'; quotes: string[] }
  | { type: 'focus'; quote: string }
  | { type: 'clear-selection' };

export const MAX_PAGE_PROBLEMS = 50;
export const MAX_PAGE_STORAGE_CHARS = 256 * 1024;
const MAX_PATH_CHARS = 1_000;
const MAX_URL_CHARS = 4_000;
const MAX_MESSAGE_CHARS = 500;
const MAX_QUOTES = 500;
const PROBLEM_KINDS = new Set<PageProblemKind>(['error', 'missing', 'blocked']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function clipped(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function quotes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_QUOTES) return null;
  return value.every((entry) => typeof entry === 'string' && entry.length <= MAX_QUOTE_LENGTH) ? (value as string[]) : null;
}

function rect(value: unknown): PageRect | null | undefined {
  if (value === null) return null;
  const box = record(value);
  if (!box) return undefined;
  const [top, left, bottom, right] = [box.top, box.left, box.bottom, box.right].map(finite);
  return top === null || left === null || bottom === null || right === null ? undefined : { top: top!, left: left!, bottom: bottom!, right: right! };
}

function storageEntries(value: unknown): Record<string, string> | null {
  const entries = record(value);
  if (!entries) return null;
  let size = 0;
  for (const [key, item] of Object.entries(entries)) {
    if (typeof item !== 'string') return null;
    size += key.length + item.length;
    if (size > MAX_PAGE_STORAGE_CHARS) return null;
  }
  return { ...(entries as Record<string, string>) };
}

/** A problem a page reported, checked and bounded; null if malformed. */
export function parsePageProblem(value: unknown): PageProblem | null {
  const problem = record(value);
  const kind = problem?.kind as PageProblemKind;
  const body = clipped(problem?.message, MAX_MESSAGE_CHARS);
  if (!problem || !PROBLEM_KINDS.has(kind) || !body) return null;
  const source = clipped(problem.source, MAX_PATH_CHARS);
  const line = finite(problem.line);
  return { kind, message: body, ...(source ? { source } : {}), ...(line !== null && line > 0 ? { line: Math.floor(line) } : {}) };
}

/** A message from a page, checked and bounded; null for anything else. */
export function parseFromPage(data: unknown): FromPage | null {
  const message = record(data);
  if (!message) return null;
  switch (message.type) {
    case 'ready':
      return { type: 'ready' };
    case 'fetch': {
      const path = text(message.path, MAX_PATH_CHARS);
      return Number.isSafeInteger(message.id) && (message.id as number) >= 0 && path !== null ? { type: 'fetch', id: message.id as number, path } : null;
    }
    case 'navigate': {
      const path = text(message.path, MAX_PATH_CHARS);
      const hash = message.hash === null ? null : text(message.hash, MAX_URL_CHARS);
      if (path === null || (hash === null && message.hash !== null) || typeof message.newTab !== 'boolean') return null;
      return { type: 'navigate', path, hash, newTab: message.newTab, redirect: message.redirect === true };
    }
    case 'open': {
      const url = text(message.url, MAX_URL_CHARS);
      return url === null ? null : { type: 'open', url };
    }
    case 'problem': {
      const problem = parsePageProblem(message.problem);
      return problem ? { type: 'problem', problem } : null;
    }
    case 'selection': {
      const selected = clipped(message.text, MAX_QUOTE_LENGTH);
      const box = rect(message.rect);
      return selected === null || box === undefined ? null : { type: 'selection', text: selected, rect: box };
    }
    case 'anchors': {
      const found = quotes(message.found);
      const missing = quotes(message.missing);
      return found && missing ? { type: 'anchors', found, missing } : null;
    }
    case 'focused': {
      const quote = text(message.quote, MAX_QUOTE_LENGTH);
      return quote === null || typeof message.found !== 'boolean' ? null : { type: 'focused', quote, found: message.found };
    }
    case 'scroll': {
      const x = finite(message.x);
      const y = finite(message.y);
      return x === null || y === null ? null : { type: 'scroll', x, y };
    }
    case 'hash': {
      const hash = message.hash === null ? null : text(message.hash, MAX_URL_CHARS);
      return hash === null && message.hash !== null ? null : { type: 'hash', hash };
    }
    case 'storage': {
      const entries = storageEntries(message.entries);
      return entries ? { type: 'storage', entries } : null;
    }
    default:
      return null;
  }
}

/** True for the page runtime's first message, which carries its port. */
export function isPageHello(data: unknown): boolean {
  return record(data)?.dd === PAGE_HELLO;
}
