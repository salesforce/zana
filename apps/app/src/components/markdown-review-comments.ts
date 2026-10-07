import { closesFence, parseFenceOpen, type OpenFence } from './markdown-block-scan.js';

export const REVIEW_COMMENT_OPEN = /^ {0,3}:::comment\{/u;
const HEADER = /^ {0,3}:::comment\{((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^{}"'\r\n])*)\}[ \t]*\r?$/u;
const CLOSE = /^ {0,3}:::[ \t]*\r?$/u;

export interface ReviewComment {
  start: number;
  end: number;
  title: string;
  file: string;
  lines: string;
  lineNumber: number | null;
  priority: string | null;
  body: string;
}

function attributes(raw: string): Record<string, string> | null {
  const result: Record<string, string> = Object.create(null);
  const pattern = /\s*([\w-]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s"'{}]+))/gy;
  let cursor = 0;
  while (cursor < raw.trimEnd().length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(raw);
    if (!match) return null;
    result[match[1]] = (match[2] ?? match[3] ?? match[4]).replace(/\\([\\"'])/gu, '$1');
    cursor = pattern.lastIndex;
  }
  return result;
}

/** Parse top-level review containers; fenced/indented examples stay literal.
 * An unclosed container includes the live tail so its body can stream in place.
 */
export function parseReviewComments(text: string): ReviewComment[] {
  const comments: ReviewComment[] = [];
  let fence: OpenFence | null = null;
  let active: { comment: ReviewComment; bodyStart: number } | null = null;
  const finish = (bodyEnd: number, end: number) => {
    if (!active) return;
    active.comment.body = text.slice(active.bodyStart, bodyEnd).trim();
    active.comment.end = end;
    comments.push(active.comment);
    active = null;
  };
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline + 1;
    const line = text.slice(start, newline < 0 ? end : newline);
    if (fence) {
      if (closesFence(line, fence)) fence = null;
    } else {
      const nextFence = parseFenceOpen(line);
      if (nextFence) {
        fence = nextFence;
      } else if (active && CLOSE.test(line)) {
        finish(start, end);
      } else {
        const header = HEADER.exec(line);
        const attrs = header ? attributes(header[1]) : null;
        if (attrs?.title?.trim()) {
          finish(start, start);
          const lines = attrs.lines?.trim() ?? '';
          const range = /^(\d+)(?:-(\d+))?$/u.exec(lines);
          const first = range ? Number(range[1]) : 0;
          const last = range?.[2] ? Number(range[2]) : first;
          active = {
            bodyStart: end,
            comment: {
              start, end, title: attrs.title.trim(), file: attrs.file?.trim() ?? '', lines,
              lineNumber: Number.isSafeInteger(first) && first > 0 && Number.isSafeInteger(last) && last >= first ? first : null,
              priority: /^p[0-3]$/iu.test(attrs.priority ?? '') ? attrs.priority.toUpperCase() : null,
              body: ''
            }
          };
        }
      }
    }
    start = end;
  }
  finish(text.length, text.length);
  return comments;
}
