/**
 * A small line diff for "what changed in this revision". Bounded on purpose:
 * past `MAX_DIFF_LINES` changed lines it returns null and the UI offers the
 * full revision instead of freezing the renderer.
 */

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

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
