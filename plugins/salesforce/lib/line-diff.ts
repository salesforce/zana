/**
 * Bounded line diff for Studio edit proposals. Ported from plugins/design-docs/src/app/diff.ts and extended with
 * hunk grouping + hunk application so the playground can accept/reject each change independently.
 * Isomorphic: no node imports (also bundled into the playground iframe).
 */

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

/** Past this many changed lines on either side the diff gives up (returns null) instead of freezing the renderer. */
export const MAX_DIFF_LINES = 1500;

export function lineDiff(before: string, after: string, maxLines = MAX_DIFF_LINES): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length > maxLines || midB.length > maxLines) return null;

  // LCS table over the changed middle only.
  const width = midB.length + 1;
  const table = new Uint32Array((midA.length + 1) * width);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        midA[i] === midB[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ type: 'same', text: midA[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      middle.push({ type: 'del', text: midA[i]! });
      i += 1;
    } else {
      middle.push({ type: 'add', text: midB[j]! });
      j += 1;
    }
  }
  while (i < midA.length) middle.push({ type: 'del', text: midA[i++]! });
  while (j < midB.length) middle.push({ type: 'add', text: midB[j++]! });

  return [
    ...a.slice(0, start).map((text) => ({ type: 'same' as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ type: 'same' as const, text }))
  ];
}

export type DiffHunk = { type: 'lines'; lines: DiffLine[] } | { type: 'gap'; count: number };

/** Keep `context` unchanged lines around each change; fold the rest into gaps. */
export function foldDiff(lines: DiffLine[], context = 3): DiffHunk[] {
  const keep = new Uint8Array(lines.length);
  lines.forEach((line, index) => {
    if (line.type === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep[k] = 1;
  });
  const hunks: DiffHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    if (keep[index]) {
      const run: DiffLine[] = [];
      while (index < lines.length && keep[index]) run.push(lines[index++]!);
      hunks.push({ type: 'lines', lines: run });
    } else {
      let count = 0;
      while (index < lines.length && !keep[index]) {
        count += 1;
        index += 1;
      }
      hunks.push({ type: 'gap', count });
    }
  }
  return hunks;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === 'add') added += 1;
    else if (line.type === 'del') removed += 1;
  }
  return { added, removed };
}

/** One contiguous change: `oldLines` (base) are replaced by `newLines`. `baseStart` is 1-based in the base text. */
export interface ChangeHunk {
  index: number;
  baseStart: number;
  oldLines: string[];
  newLines: string[];
}

/** Groups a line diff into independent change hunks. Returns null when the diff is too large. */
export function computeHunks(base: string, proposed: string, maxLines = MAX_DIFF_LINES): ChangeHunk[] | null {
  const diff = lineDiff(base, proposed, maxLines);
  if (!diff) return null;
  const hunks: ChangeHunk[] = [];
  let baseLine = 1;
  let open: ChangeHunk | null = null;
  for (const row of diff) {
    if (row.type === 'same') {
      open = null;
      baseLine += 1;
      continue;
    }
    if (!open) {
      open = { index: hunks.length, baseStart: baseLine, oldLines: [], newLines: [] };
      hunks.push(open);
    }
    if (row.type === 'del') {
      open.oldLines.push(row.text);
      baseLine += 1;
    } else {
      open.newLines.push(row.text);
    }
  }
  return hunks;
}

/** Line offset a hunk's acceptance adds to everything after it. */
export function hunkDelta(hunk: ChangeHunk): number {
  return hunk.newLines.length - hunk.oldLines.length;
}

/** 1-based start line of hunk `i` in the *current* text (base + the hunks accepted so far). */
export function currentHunkStart(hunks: readonly ChangeHunk[], i: number, accepted: ReadonlySet<number>): number {
  let start = hunks[i]!.baseStart;
  for (let j = 0; j < i; j += 1) if (accepted.has(hunks[j]!.index)) start += hunkDelta(hunks[j]!);
  return start;
}

/** Base text with only the `accepted` hunks (by index) applied. */
export function applyHunks(base: string, hunks: readonly ChangeHunk[], accepted: ReadonlySet<number>): string {
  const lines = base.split('\n');
  let shift = 0;
  for (const hunk of hunks) {
    if (!accepted.has(hunk.index)) continue;
    lines.splice(hunk.baseStart - 1 + shift, hunk.oldLines.length, ...hunk.newLines);
    shift += hunkDelta(hunk);
  }
  return lines.join('\n');
}

/** A text edit in 1-based line/column coordinates (Monaco-compatible range). */
export interface LineTextEdit {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

/**
 * The editor edit that applies one hunk to the current text. `lineLength(n)` returns the length of 1-based line n;
 * `lineCount` is the number of lines in the current text.
 */
export function hunkEdit(hunk: ChangeHunk, start: number, lineCount: number, lineLength: (line: number) => number): LineTextEdit {
  const oldCount = hunk.oldLines.length;
  const text = hunk.newLines.join('\n');
  const lastOld = start + oldCount - 1;
  if (oldCount === 0) {
    // Pure insertion before `start`.
    if (start > lineCount) {
      return { startLine: lineCount, startColumn: lineLength(lineCount) + 1, endLine: lineCount, endColumn: lineLength(lineCount) + 1, text: `\n${text}` };
    }
    return { startLine: start, startColumn: 1, endLine: start, endColumn: 1, text: `${text}\n` };
  }
  if (lastOld < lineCount) {
    // A line follows the replaced range: swallow its newline.
    return hunk.newLines.length === 0
      ? { startLine: start, startColumn: 1, endLine: lastOld + 1, endColumn: 1, text: '' }
      : { startLine: start, startColumn: 1, endLine: lastOld, endColumn: lineLength(lastOld) + 1, text };
  }
  // The hunk reaches the last line of the text.
  if (hunk.newLines.length === 0 && start > 1) {
    return { startLine: start - 1, startColumn: lineLength(start - 1) + 1, endLine: lastOld, endColumn: lineLength(lastOld) + 1, text: '' };
  }
  return { startLine: start, startColumn: 1, endLine: lastOld, endColumn: lineLength(lastOld) + 1, text };
}

/** Stable signature used to keep rejected hunks rejected when the proposal is re-diffed after a foreign edit. */
export function hunkSignature(hunk: ChangeHunk): string {
  return `${hunk.oldLines.join('\n')}\u0000${hunk.newLines.join('\n')}`;
}
