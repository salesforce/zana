export type MarkdownFileTarget =
  | { kind: 'file'; path: string; lineNumber: number | null }
  | { kind: 'invalid'; message: string };

const MAX_FILE_EXTENSION_LENGTH = 12;
const FILE_EXTENSION_SOURCE = String.raw`\.[a-z0-9]{1,${MAX_FILE_EXTENSION_LENGTH}}`;
const FILE_EXTENSION = new RegExp(`${FILE_EXTENSION_SOURCE}$`, 'iu');
const BARE_FILE_LINE = new RegExp(String.raw`^[^/:]+${FILE_EXTENSION_SOURCE}:[+-]?\d+$`, 'iu');
const LINE_FRAGMENT = /^L(?:[+-]?\d|$)/u;
const INVALID_TARGET: MarkdownFileTarget = {
  kind: 'invalid', message: 'Cannot preview this file link: the path or line number is invalid.'
};

function isFileCandidate(href: string): boolean {
  if (!href || href.startsWith('#') || href.startsWith('//')) return false;
  if (/^(?:file:|\/?[a-z]:)/iu.test(href)) return true;
  const bareLine = BARE_FILE_LINE.test(href);
  if (/^[a-z][a-z\d+.-]*:/iu.test(href) && !bareLine) return false;
  const path = href.split(/[?#]/u)[0]!;
  if (!FILE_EXTENSION.test(path) && !FILE_EXTENSION.test(path.replace(/:[^/]*$/u, ''))) return false;
  const hash = href.indexOf('#');
  return path.includes('/') || bareLine || (hash >= 0 && LINE_FRAGMENT.test(href.slice(hash + 1)));
}

function splitFileLine(href: string): { path: string; lineNumber: number | null } | null {
  const hash = href.indexOf('#');
  const fragment = hash < 0 ? '' : href.slice(hash + 1);
  let path = hash < 0 ? href : href.slice(0, hash);
  // Match a trailing colon segment without crossing separators or earlier colons.
  const candidate = /:([^/\\:]*)$/u.exec(path);
  // A complete filename keeps its colons, including report.v1:2026.md on POSIX.
  const suffix = !FILE_EXTENSION.test(path) && candidate
    && (FILE_EXTENSION.test(path.slice(0, candidate.index)) || /^[+-]?\d+$/u.test(candidate[1]!))
    ? candidate : null;
  const colonLine = suffix?.[1];
  const hashLine = LINE_FRAGMENT.test(fragment) ? fragment.slice(1) : undefined;
  if (colonLine !== undefined && hashLine !== undefined) return null;
  if (suffix) path = path.slice(0, suffix.index);
  const line = colonLine ?? hashLine;
  if (line === undefined) return { path, lineNumber: null };
  if (!/^[1-9]\d*$/u.test(line)) return null;
  const lineNumber = Number(line);
  return Number.isSafeInteger(lineNumber) ? { path, lineNumber } : null;
}

function decodeFilePath(raw: string): string | null {
  if (/[\u0000-\u001f\u007f?]/u.test(raw) || /%2f|%5c/iu.test(raw)) return null;
  const path = decodeURIComponent(raw);
  if (/[\u0000-\u001f\u007f]/u.test(path)) return null;
  const windows = /^\/?[a-z]:[\\/]/iu.test(path);
  if (/^\/?[a-z]:/iu.test(path) && !windows) return null;
  const normalized = windows ? path.replace(/^\//u, '').replace(/\\/gu, '/') : path;
  if (!normalized || normalized.split('/').includes('..')) return null;
  return normalized;
}

/** Classification is advisory. The thread resolver and content reader authorize every path. */
export function classifyMarkdownFileTarget(href: string | undefined): MarkdownFileTarget | null {
  const trimmed = href?.trim() ?? '';
  if (!isFileCandidate(trimmed)) return null;
  try {
    const target = splitFileLine(trimmed);
    if (!target) return INVALID_TARGET;
    let raw = target.path;
    if (/^file:/iu.test(raw)) {
      // Inspect the original path before URL parsing can normalize away traversal.
      const file = /^file:\/\/([^/\\]*)([/\\].*)$/iu.exec(raw);
      if (!file || (file[1] && file[1].toLowerCase() !== 'localhost')) return INVALID_TARGET;
      raw = file[2]!;
    }
    const path = decodeFilePath(raw);
    return path ? { kind: 'file', path, lineNumber: target.lineNumber } : INVALID_TARGET;
  } catch {
    return INVALID_TARGET;
  }
}
