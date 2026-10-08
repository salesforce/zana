/**
 * File-path and media-type rules for files inside a design doc.
 *
 * A design doc is a small virtual file tree. Paths are relative POSIX paths
 * owned by the plugin's own store, never host filesystem paths, so the only
 * job here is to keep them canonical: no traversal, no absolute paths, no
 * hidden or empty segments, and a bounded length/depth.
 */

export const MAX_PATH_LENGTH = 160;
export const MAX_PATH_DEPTH = 10;

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;

export type FileKind = 'markdown' | 'html' | 'mermaid' | 'svg' | 'image' | 'font' | 'code' | 'text';

export class DesignDocPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignDocPathError';
  }
}

/**
 * Normalise a caller-supplied path, or throw `DesignDocPathError`.
 * Backslashes and a leading `./` are tolerated because agents produce them;
 * everything else that is not a plain relative path is rejected.
 */
export function normalizeDocPath(raw: unknown): string {
  if (typeof raw !== 'string') throw new DesignDocPathError('path must be a string');
  let value = raw.trim().replace(/\\/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  if (!value) throw new DesignDocPathError('path is required');
  if (value.startsWith('/')) throw new DesignDocPathError('path must be relative to the design doc');
  if (value.length > MAX_PATH_LENGTH) {
    throw new DesignDocPathError(`path must be at most ${MAX_PATH_LENGTH} characters`);
  }
  const segments = value.split('/');
  if (segments.length > MAX_PATH_DEPTH) {
    throw new DesignDocPathError(`path must be at most ${MAX_PATH_DEPTH} levels deep`);
  }
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new DesignDocPathError('path must not contain "." or ".." segments');
    }
    if (!SEGMENT_PATTERN.test(segment) || segment.endsWith(' ') || segment.endsWith('.')) {
      throw new DesignDocPathError(
        `invalid path segment ${JSON.stringify(segment)}: use letters, digits, ".", "_", "-" or spaces, starting with a letter or digit`
      );
    }
  }
  return segments.join('/');
}

export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  mmd: 'mermaid',
  mermaid: 'mermaid',
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  txt: 'text'
};

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon'
};

const FONT_MEDIA_TYPES: Record<string, string> = {
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf'
};

/** Extensions shown as syntax-highlighted code rather than plain text. */
const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  sql: 'sql',
  sh: 'bash',
  css: 'css',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  xml: 'xml',
  cls: 'apex',
  apex: 'apex'
};

export function fileKindOf(path: string): FileKind {
  const ext = extensionOf(path);
  const kind = KIND_BY_EXTENSION[ext];
  if (kind) return kind;
  if (CODE_LANGUAGE_BY_EXTENSION[ext]) return 'code';
  return 'text';
}

export function codeLanguageOf(path: string): string {
  return CODE_LANGUAGE_BY_EXTENSION[extensionOf(path)] ?? '';
}

/** Binary files are stored base64-encoded; everything else is UTF-8 text. */
export function isBinaryKind(kind: FileKind): boolean {
  return kind === 'image' || kind === 'font';
}

export function imageMediaTypeOf(path: string): string | null {
  return IMAGE_MEDIA_TYPES[extensionOf(path)] ?? null;
}

const TEXT_MEDIA_TYPES: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  xml: 'application/xml',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain'
};

/** Content type for serving a doc file to a page; text files carry a UTF-8 charset. */
export function mediaTypeOf(path: string): string {
  const ext = extensionOf(path);
  const binary = IMAGE_MEDIA_TYPES[ext] ?? FONT_MEDIA_TYPES[ext];
  if (binary) return binary;
  return `${TEXT_MEDIA_TYPES[ext] ?? 'text/plain'};charset=utf-8`;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolve a link or image reference found in `fromPath` to a doc path, or
 * null when it points outside the doc (a URL, an anchor, or `..` past root).
 */
export function resolveDocLink(fromPath: string, href: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('//') || SCHEME.test(raw)) return null;
  const target = raw.split(/[?#]/, 1)[0]!;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // Keep the raw text; an invalid escape is just an unusual file name.
  }
  const base = decoded.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!base.length) return null;
      base.pop();
      continue;
    }
    base.push(segment);
  }
  return base.length ? base.join('/') : null;
}

/** Sort paths so a folder's files precede its subfolders, both alphabetically. */
export function comparePaths(a: string, b: string): number {
  const as = a.split('/');
  const bs = b.split('/');
  const shared = Math.min(as.length, bs.length);
  for (let index = 0; index < shared; index += 1) {
    const aLeaf = index === as.length - 1;
    const bLeaf = index === bs.length - 1;
    if (as[index] === bs[index]) continue;
    if (aLeaf !== bLeaf) return aLeaf ? -1 : 1;
    return as[index]!.localeCompare(bs[index]!, undefined, { sensitivity: 'base', numeric: true });
  }
  return as.length - bs.length;
}
