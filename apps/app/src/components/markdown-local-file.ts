const BLOCKED_SCHEMES = /^(https?|mailto|tel|data|javascript|blob):/iu;
const PATH_LINE_PREFIX = /^(?:file|path)\s*:\s+/iu;
const PREVIEW_PATH_LINE_CAP = 8;
const PREVIEW_PATH_CAP = 3;

function looksLikeFilePath(path: string): boolean {
  if (!path || path.includes('..')) return false;
  const base = path.split(/[/\\]/u).pop() ?? '';
  return /\.[A-Za-z0-9]{1,12}$/u.test(base);
}

function stripPathDecorators(raw: string): string {
  return raw.trim().replace(/^`+|`+$/gu, '').replace(/^\*+|\*+$/gu, '');
}

function unwrapLabeledPathLine(line: string): string {
  const stripped = stripPathDecorators(line).replace(/^#{1,6}\s+/u, '');
  const labeled = PATH_LINE_PREFIX.exec(stripped);
  return labeled ? stripped.slice(labeled[0].length).trim() : stripped;
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

/** Workspace-relative paths an assistant dump or attachment can open in the side-panel preview. */
export function conversationFilePreviewPaths(
  text: string,
  extraPaths: readonly string[] = []
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    if (!raw || out.length >= PREVIEW_PATH_CAP) return;
    const path = parseLocalFileMarkdownHref(unwrapLabeledPathLine(raw));
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push(path);
  };
  for (const path of extraPaths) add(path);
  for (const line of text.split(/\r?\n/u).slice(0, PREVIEW_PATH_LINE_CAP)) {
    const candidate = unwrapLabeledPathLine(line);
    if (!candidate || candidate.startsWith('```')) continue;
    add(candidate);
    if (out.length >= PREVIEW_PATH_CAP) break;
  }
  return out;
}
