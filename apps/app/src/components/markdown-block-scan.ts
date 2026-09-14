export interface OpenFence {
  char: string;
  length: number;
}

export const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;
export const LIST_MARKER_PATTERN = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u;
export const INDENTED_CONTINUATION_PATTERN = /^(?: {2,}|\t)/u;
export const MATH_DELIMITER = '$$';
const MARKDOWN_BLANK_LINE_PATTERN = /^[ \t]*$/u;
const MARKDOWN_PIECE_START_PATTERN = /^\S/u;

export function parseFenceOpen(line: string): OpenFence | null {
  const match = line.match(FENCE_PATTERN);
  if (match === null) {
    return null;
  }
  const marker = match[1] ?? '';
  return { char: marker[0] ?? '`', length: marker.length };
}

export function closesFence(line: string, fence: OpenFence): boolean {
  const match = line.match(FENCE_PATTERN);
  if (match === null) {
    return false;
  }
  const marker = match[1] ?? '';
  if (marker[0] !== fence.char || marker.length < fence.length) {
    return false;
  }
  return line.slice(match[0].length).trim().length === 0;
}

export function countOccurrences(line: string, needle: string): number {
  let count = 0;
  let index = line.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = line.indexOf(needle, index + needle.length);
  }
  return count;
}

export function isBlankLine(line: string): boolean {
  return MARKDOWN_BLANK_LINE_PATTERN.test(line);
}

export function isListLike(line: string): boolean {
  return LIST_MARKER_PATTERN.test(line) || INDENTED_CONTINUATION_PATTERN.test(line);
}

export function markdownHasGlobalConstructs(text: string): boolean {
  return text.includes('[^') || /(^|\n)\[[^\]]+\]:/u.test(text);
}

/**
 * Offsets where a new top-level block starts after a blank line. Used to split
 * a settled assistant document into independently memoizable pieces.
 */
export function findMarkdownPieceCandidates(body: string): readonly number[] {
  const candidates: number[] = [];
  let fence: OpenFence | null = null;
  let mathOpen = false;
  let previousLineBlank = false;
  let lastNonBlankLine: string | null = null;
  let lineStart = 0;
  while (lineStart < body.length) {
    const newline = body.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? body.length : newline;
    const line = body.slice(lineStart, lineEnd);
    const blank = isBlankLine(line);
    if (fence !== null) {
      if (closesFence(line, fence)) {
        fence = null;
      }
    } else if (mathOpen) {
      if (countOccurrences(line, MATH_DELIMITER) % 2 === 1) {
        mathOpen = false;
      }
    } else if (!blank) {
      if (
        previousLineBlank &&
        lastNonBlankLine !== null &&
        MARKDOWN_PIECE_START_PATTERN.test(line) &&
        !(isListLike(lastNonBlankLine) && LIST_MARKER_PATTERN.test(line))
      ) {
        candidates.push(lineStart);
      }
      const nextFence = parseFenceOpen(line);
      if (nextFence !== null) {
        fence = nextFence;
      } else if (countOccurrences(line, MATH_DELIMITER) % 2 === 1) {
        mathOpen = true;
      }
    }
    if (!blank) {
      lastNonBlankLine = line;
    }
    previousLineBlank = blank;
    lineStart = newline === -1 ? body.length : newline + 1;
  }
  return candidates;
}
