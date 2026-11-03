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

const DOC_SCHEME = /^doc:/i;
const DOC_REF = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface CrossDocLink {
  /** A doc slug or `dd_...` id; the server resolves and authorizes it. */
  docRef: string;
  /** Canonical path inside that doc, or null for the doc's entry file. */
  path: string | null;
  anchor: string | null;
}

/** Whether an href uses the cross-doc scheme at all (even if malformed). */
export function isCrossDocScheme(href: string): boolean {
  return DOC_SCHEME.test(href.trim());
}

const SHIELD_PREFIX = 'https://doc-link.invalid/?h=';

/**
 * The host Markdown renderer drops hrefs with unknown schemes, so `doc:` links
 * reach the DOM empty. Wrap them in an inert https href before rendering and
 * restore them on click with `unshieldCrossDocHref`. Leaves code fences and
 * inline code spans untouched.
 */
export function shieldCrossDocLinks(markdown: string): string {
  let fence: string | null = null;
  let previousBlank = true;
  let inIndentedCode = false;
  return markdown.split('\n').map((line) => {
    const blank = line.trim() === '';
    const wasBlank = previousBlank;
    previousBlank = blank;
    if (fence) {
      // A closing fence carries no info string: "``` js" inside an open fence stays content.
      const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      return line;
    }
    const indented = /^( {4}|\t)/.test(line);
    if (indented && (wasBlank || inIndentedCode)) {
      inIndentedCode = true;
      return line;
    }
    if (!blank) inIndentedCode = false;
    const mark = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (mark) {
      fence = mark;
      return line;
    }
    return splitInlineCode(line).map((part, index) => index % 2 === 1
      ? part
      : part.replace(/\]\(\s*(?:<(doc:[^>\n]*)>|(doc:[^)\s>]*))/gi, (_match, angled: string | undefined, bare: string | undefined) =>
        `](${SHIELD_PREFIX}${encodeURIComponent(angled ?? bare ?? '')}`)
    ).join('');
  }).join('\n');
}

/**
 * Split a line into alternating [text, code, text, code, ...] parts following
 * CommonMark backtick-run matching: a run of N backticks opens a code span that
 * closes at the next run of exactly N; an unmatched opener is literal text.
 */
function splitInlineCode(line: string): string[] {
  const parts: string[] = [];
  let text = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      text += line[i];
      i += 1;
      continue;
    }
    let end = i;
    while (line[end] === '`') end += 1;
    const run = end - i;
    let close = -1;
    let scan = end;
    while (scan < line.length) {
      if (line[scan] !== '`') {
        scan += 1;
        continue;
      }
      let runEnd = scan;
      while (line[runEnd] === '`') runEnd += 1;
      if (runEnd - scan === run) {
        close = runEnd;
        break;
      }
      scan = runEnd;
    }
    if (close < 0) {
      text += line.slice(i, end);
      i = end;
      continue;
    }
    parts.push(text, line.slice(i, close));
    text = '';
    i = close;
  }
  parts.push(text);
  return parts;
}

/** Inverse of `shieldCrossDocLinks` for one href; returns the input otherwise. */
export function unshieldCrossDocHref(href: string): string {
  if (!href.startsWith(SHIELD_PREFIX)) return href;
  return decodeSafely(href.slice(SHIELD_PREFIX.length)) ?? href;
}

function decodeSafely(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Parse `doc://<ref>/<path>#anchor` (or the shorthand `doc:<ref>/<path>`).
 * `doc://<ref>` alone targets the doc's entry file. Returns null for any other
 * href and for malformed ones (empty or `..` segments, bad escapes, bad ref).
 * Advisory only: the server re-validates and authorizes the target.
 */
export function parseCrossDocLink(href: string): CrossDocLink | null {
  const raw = href.trim();
  if (!DOC_SCHEME.test(raw)) return null;
  let rest = raw.slice(4);
  if (rest.startsWith('//')) rest = rest.slice(2);
  const hash = rest.indexOf('#');
  let anchor: string | null = null;
  if (hash >= 0) {
    anchor = decodeSafely(rest.slice(hash + 1)) || null;
    rest = rest.slice(0, hash);
  }
  const query = rest.indexOf('?');
  if (query >= 0) rest = rest.slice(0, query);
  const segments = rest.split('/');
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  const ref = decodeSafely(segments[0]!);
  if (ref === null || !DOC_REF.test(ref)) return null;
  if (segments.length === 1) return { docRef: ref, path: null, anchor };
  const decoded: string[] = [];
  for (const segment of segments.slice(1)) {
    const value = decodeSafely(segment);
    if (!value || value.includes('/') || value.includes('\\')) return null;
    decoded.push(value);
  }
  try {
    return { docRef: ref, path: normalizeDocPath(decoded.join('/')), anchor };
  } catch {
    return null;
  }
}

/**
 * Markdown link to a doc, ready to paste anywhere in Design Docs. Uses the id,
 * not the slug: an id names exactly one doc and resolves from any project. `path` defaults to the doc's entry file, so the link
 * can be turned into a relative one when it is pasted into the same doc.
 */
export function crossDocMarkdownLink(doc: { id: string; title: string; entryPath?: string }, path?: string): string {
  const target = path ?? doc.entryPath;
  const text = path ? (path.split('/').pop() ?? path) : doc.title;
  const label = text.replace(/[\\[\]]/g, '\\$&').replace(/\s+/g, ' ').trim() || doc.id;
  const suffix = target ? `/${target.split('/').map(encodeURIComponent).join('/')}` : '';
  return `[${label}](doc://${doc.id}${suffix})`;
}

/** `to` as a link from the folder of `fromPath`, e.g. `../diagrams/a.mmd`. */
export function relativeDocPath(fromPath: string, to: string): string {
  const base = fromPath.split('/').slice(0, -1);
  const target = to.split('/');
  let shared = 0;
  while (shared < base.length && shared < target.length - 1 && base[shared] === target[shared]) shared += 1;
  return [...base.slice(shared).map(() => '..'), ...target.slice(shared)].join('/');
}

/**
 * Pasted text that is exactly a markdown link to a file of this same doc,
 * rewritten as the relative link it should be (relative links survive export
 * and rename-free moves of the whole doc). Null when it is anything else.
 */
export function localizeDocLink(text: string, docId: string, fromPath: string): string | null {
  const match = text.trim().match(/^\[((?:[^\]\\]|\\.)*)\]\((doc:\/\/[^)\s]+)\)$/i);
  if (!match) return null;
  const link = parseCrossDocLink(match[2]!);
  if (!link || link.docRef !== docId || !link.path) return null;
  const relative = relativeDocPath(fromPath, link.path).split('/').map((part) => (part === '..' ? part : encodeURIComponent(part))).join('/');
  return `[${match[1]}](${relative}${link.anchor ? `#${encodeURIComponent(link.anchor)}` : ''})`;
}

/**
 * Names for incoming files that clash with `existing` paths (compared without
 * letter case): one shared number is appended before the extension, `a.md` ->
 * `a-2.md`, using the smallest number from 2 for which no renamed file collides
 * with an existing path or with another incoming file. Returns old -> new for the
 * clashing paths only; an empty map means nothing clashed.
 */
export function renameClashingPaths(incoming: readonly string[], existing: Iterable<string>): Map<string, string> {
  const taken = new Set([...existing].map((path) => path.toLowerCase()));
  const clashing = incoming.filter((path) => taken.has(path.toLowerCase()));
  const renames = new Map<string, string>();
  if (!clashing.length) return renames;
  const others = new Set(incoming.filter((path) => !taken.has(path.toLowerCase())).map((path) => path.toLowerCase()));
  const numbered = (path: string, n: number) => {
    const slash = path.lastIndexOf('/') + 1;
    const dot = path.lastIndexOf('.');
    return dot > slash ? `${path.slice(0, dot)}-${n}${path.slice(dot)}` : `${path}-${n}`;
  };
  for (let n = 2; ; n += 1) {
    const candidates = clashing.map((path) => numbered(path, n));
    const free = candidates.every((path) => !taken.has(path.toLowerCase()) && !others.has(path.toLowerCase()));
    if (free) {
      clashing.forEach((path, index) => renames.set(path, candidates[index]!));
      return renames;
    }
  }
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
