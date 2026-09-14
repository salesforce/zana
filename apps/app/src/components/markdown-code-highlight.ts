import hljs from 'highlight.js/lib/common';

const HIGHLIGHT_CACHE_MAX_ENTRIES = 128;
const HIGHLIGHT_CACHE_MAX_CHARS = 4_000_000;
const HIGHLIGHT_CACHE_MAX_CODE_LENGTH = 128_000;

const highlightCache = new Map<string, { __html: string }>();
let highlightCacheChars = 0;

export interface HighlightMarkdownCodeArgs {
  code: string;
  language: string | null;
}

function highlightCacheKey({ code, language }: HighlightMarkdownCodeArgs): string {
  return language === null ? `:${code}` : `${language.length}:${language}:${code}`;
}

function highlightUncached({ code, language }: HighlightMarkdownCodeArgs): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return hljs.highlightAuto(code).value;
    }
  }
  try {
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(code: string): string {
  return code
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function highlightMarkdownCode(args: HighlightMarkdownCodeArgs): { __html: string } {
  if (args.code.length > HIGHLIGHT_CACHE_MAX_CODE_LENGTH) {
    return { __html: highlightUncached(args) };
  }
  const key = highlightCacheKey(args);
  const cached = highlightCache.get(key);
  if (cached !== undefined) {
    highlightCache.delete(key);
    highlightCache.set(key, cached);
    return cached;
  }
  const html = { __html: highlightUncached(args) };
  const entryChars = key.length + html.__html.length;
  if (entryChars > HIGHLIGHT_CACHE_MAX_CHARS) {
    return html;
  }
  highlightCache.set(key, html);
  highlightCacheChars += entryChars;
  for (const [oldestKey, oldestHtml] of highlightCache) {
    if (
      highlightCache.size <= HIGHLIGHT_CACHE_MAX_ENTRIES &&
      highlightCacheChars <= HIGHLIGHT_CACHE_MAX_CHARS
    ) {
      break;
    }
    highlightCache.delete(oldestKey);
    highlightCacheChars -= oldestKey.length + oldestHtml.__html.length;
  }
  return html;
}

export function languageFromMarkdownClassName(className: string | undefined): string | null {
  if (!className) return null;
  const match = className.match(/(?:^|\s)language-([^\s]+)/u);
  const language = match?.[1] ?? null;
  if (!language || language === 'mermaid') return null;
  return language;
}
