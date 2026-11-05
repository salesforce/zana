const BLOCKED_SCHEMES = /^(https?|mailto|tel|data|javascript|blob):/iu;
const PATH_LINE_PREFIX = /^(?:file|path)\s*:\s+/iu;
const PREVIEW_PATH_LINE_CAP = 8;
const PREVIEW_PATH_CAP = 3;
const INLINE_FILE_EXT = /\.[A-Za-z][A-Za-z0-9]{0,11}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
export const INVALID_LOCAL_FILE_HREF = '#invalid-local-file-link';

function fileBaseName(path: string): string {
  return path.split(/[/\\]/u).pop() ?? path;
}

function looksLikeFilePath(path: string): boolean {
  if (!path || path.includes('..')) return false;
  return /\.[A-Za-z0-9]{1,12}$/u.test(fileBaseName(path));
}

function looksLikeInlineFileCode(path: string): boolean {
  if (!path || path.includes('..') || /\s/u.test(path)) return false;
  return INLINE_FILE_EXT.test(fileBaseName(path));
}

function stripPathDecorators(raw: string): string {
  return raw.trim().replace(/^`+|`+$/gu, '').replace(/^\*+|\*+$/gu, '');
}

function unwrapLabeledPathLine(line: string): string {
  const stripped = stripPathDecorators(line).replace(/^#{1,6}\s+/u, '');
  const labeled = PATH_LINE_PREFIX.exec(stripped);
  return labeled ? stripped.slice(labeled[0].length).trim() : stripped;
}

/** Classification only: invalid local links must also be intercepted instead of navigated. */
export function isLocalFileMarkdownHref(href: string | undefined): boolean {
  const value = href?.trim();
  if (!value || CONTROL_CHARACTERS.test(href ?? '') || value.startsWith('#')
    || value.startsWith('//') || BLOCKED_SCHEMES.test(value)) return false;
  if (/^(?:file:|\/?[a-z]:|\\\\)/iu.test(value)) return true;
  const path = (value.split('#')[0] ?? '').replace(/:\d+$/u, '');
  // Bare names are ambiguous with domains; only an explicit line marker opts them into preview.
  if (!/[/\\]/u.test(path) && !/(?::\d+(?:#.*)?|#L\d+)$/u.test(value)) return false;
  // A colon anywhere else may be an obfuscated URL scheme, never a local filename.
  return !path.includes(':') && /\.[a-z0-9]{1,12}$/iu.test(fileBaseName(path));
}

export interface MarkdownFileTarget {
  path: string;
  lineNumber: number | null;
}

function splitFileLine(href: string): MarkdownFileTarget | null {
  const [destination = '', fragment = ''] = href.split('#');
  let rawPath = destination;
  const suffix = /:(\d+)$/u.exec(rawPath);
  const line = /^L(\d+)$/u.exec(fragment)?.[1] ?? suffix?.[1];
  const lineNumber = line === undefined ? null : Number(line);
  if (lineNumber !== null && (!Number.isSafeInteger(lineNumber) || lineNumber <= 0)) return null;
  if (suffix) rawPath = rawPath.slice(0, -suffix[0].length);
  return { path: rawPath, lineNumber };
}

function decodeFilePath(encodedPath: string): string | null {
  if (/%2f|%5c/iu.test(encodedPath)) return null;
  const path = decodeURIComponent(encodedPath);
  return CONTROL_CHARACTERS.test(path) || path.split(/[/\\]/u).includes('..') ? null : path;
}

function normalizeFileDestination(rawPath: string): string | null {
  const fileUrl = /^file:/iu.test(rawPath);
  try {
    // Validate before URL parsing, which would otherwise collapse dot segments.
    const encodedPath = fileUrl ? (rawPath.replace(/^file:\/\//iu, '').split('?')[0] ?? '') : rawPath;
    const decodedPath = decodeFilePath(encodedPath);
    if (decodedPath === null) return null;
    let path = decodedPath;
    if (fileUrl) {
      const url = new URL(rawPath);
      if (url.hostname && url.hostname !== 'localhost') return null;
      path = decodeURIComponent(url.pathname);
    }
    path = path.replace(/\\/gu, '/').replace(/^\/([a-z]:\/)/iu, '$1');
    if (!path || path.startsWith('//') || /^[a-z]:(?!\/)/iu.test(path)) return null;
    if (!fileUrl && !looksLikeFilePath(path)) return null;
    return path;
  } catch {
    return null;
  }
}

/** Parse link syntax only. The server resolver and content reader authorize every access. */
export function parseLocalFileMarkdownTarget(href: string | undefined): MarkdownFileTarget | null {
  if (!href || !isLocalFileMarkdownHref(href)) return null;
  const target = splitFileLine(href.trim());
  if (!target) return null;
  const path = normalizeFileDestination(target.path);
  return path ? { path, lineNumber: target.lineNumber } : null;
}

export function parseLocalFileMarkdownHref(href: string | undefined): string | null {
  return parseLocalFileMarkdownTarget(href)?.path ?? null;
}

interface FileLinkNode {
  type?: string;
  url?: string;
  children?: FileLinkNode[];
}

/** Normalize native drive separators before Markdown URI encoding turns them into %5C. */
export function remarkLocalFileLinks() {
  const visit = (node: FileLinkNode): void => {
    if ((node.type === 'link' || node.type === 'definition') && node.url
      && /^(?:\/?[a-z]:[/\\]|file:)/iu.test(node.url)) {
      node.url = node.url.replace(/\\/gu, '/');
    }
    node.children?.forEach(visit);
  };
  return visit;
}

/**
 * Whether a Preview control may be offered for `path`. Relative safe paths stay
 * workspace-relative; absolute paths qualify only when contained by a known
 * root. Shell-dynamic, home-relative and traversal paths never qualify. The
 * server remains the authority on the actual read.
 */
export function isPreviewableConversationPath(
  path: string,
  previewRoots: readonly string[] = []
): boolean {
  if (!path || /[$`\0]/u.test(path) || path.startsWith('~')) return false;
  const segments = path.split(/[/\\]/u);
  if (segments.includes('..')) return false;
  if (!path.startsWith('/') && !/^[a-z]:[\\/]/iu.test(path)) return true;
  const slashed = path.replace(/\\/gu, '/');
  const windows = /^[a-z]:\//iu.test(slashed);
  const fold = (value: string) => (windows ? value.toLowerCase() : value);
  return previewRoots.some((root) => {
    const normalized = root.replace(/\\/gu, '/').replace(/\/+$/u, '');
    return normalized.length > 0 && fold(slashed).startsWith(`${fold(normalized)}/`);
  });
}

/** Workspace-relative paths an assistant dump or attachment can open in the side-panel preview. */
export function conversationFilePreviewPaths(
  text: string,
  extraPaths: readonly string[] = []
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | null | undefined, discovered = false) => {
    if (!raw || out.length >= PREVIEW_PATH_CAP) return;
    const path = parseLocalFileMarkdownHref(unwrapLabeledPathLine(raw));
    if (!path || !/[/\\]/u.test(path) || seen.has(path)) return;
    // Free text needs a path-shaped prefix before whitespace can mean a filename.
    if (discovered && /\s/u.test(path) && !/^(?:\/|\.\/|[a-z]:[\\/])/iu.test(path)) return;
    seen.add(path);
    out.push(path);
  };
  for (const path of extraPaths) add(path);
  for (const line of text.split(/\r?\n/u).slice(0, PREVIEW_PATH_LINE_CAP)) {
    const candidate = unwrapLabeledPathLine(line);
    if (!candidate || candidate.startsWith('```')) continue;
    add(candidate, true);
    if (out.length >= PREVIEW_PATH_CAP) break;
  }
  return out;
}

/**
 * Inline ``code`` that looks like a workspace file (bare `notes.md` or
 * `src/foo.ts`). Stricter than {@link parseLocalFileMarkdownHref}: letter-starting
 * extension, no spaces, no `..`. Used to turn gold chips into file-preview opens.
 */
export function parseInlineFileCodePath(text: string | undefined): string | null {
  if (!text || /[\r\n]/u.test(text)) return null;
  const path = stripPathDecorators(text);
  if (!path || path.startsWith('#') || BLOCKED_SCHEMES.test(path)) return null;
  return looksLikeInlineFileCode(path) ? path : null;
}

/**
 * Map a bare filename onto a known workspace path only when its basename is
 * unambiguous. Slash paths and unmatched names pass through as-is.
 */
export function resolveThreadFilePreviewPath(
  token: string,
  knownPaths: readonly string[] = []
): string | null {
  const parsed = parseInlineFileCodePath(token);
  if (!parsed) return null;
  if (/[/\\]/u.test(parsed)) return parsed;
  const base = fileBaseName(parsed);
  const matches = [...new Set(knownPaths
    .filter((path) => path && fileBaseName(path) === base)
    .map((path) => path.replace(/\\/gu, '/').replace(/^(\.\/)+/u, '')))];
  if (matches.length === 1) return matches[0]!;
  return parsed;
}
