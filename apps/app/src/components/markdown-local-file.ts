const BLOCKED_SCHEMES = /^(https?|mailto|tel|data|javascript|blob):/iu;

function looksLikeFilePath(path: string): boolean {
  if (!path || path.includes('..')) return false;
  const base = path.split(/[/\\]/u).pop() ?? '';
  return /\.[A-Za-z0-9]{1,12}$/u.test(base);
}

export function parseLocalFileMarkdownHref(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || BLOCKED_SCHEMES.test(trimmed)) return null;
  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed);
      if (url.host && url.host !== 'localhost' && url.hostname !== '') return null;
      const path = decodeURIComponent(url.pathname);
      return looksLikeFilePath(path) ? path : path || null;
    } catch {
      return null;
    }
  }
  const path = trimmed.split('#')[0] ?? trimmed;
  if (path.startsWith('/') && !path.startsWith('//') && looksLikeFilePath(path)) return path;
  if ((/^\.{0,2}\//u.test(path) || /^[\w.-]+\/[\w./-]+$/u.test(path)) && looksLikeFilePath(path)) {
    return path;
  }
  return null;
}
