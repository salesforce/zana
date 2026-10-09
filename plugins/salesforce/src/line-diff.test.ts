import { describe, expect, it } from 'vitest';
import { applyHunks, computeHunks, currentHunkStart, diffStats, foldDiff, hunkDelta, hunkEdit, hunkSignature, lineDiff, type LineTextEdit } from '../lib/line-diff.js';

function applyEdit(text: string, e: LineTextEdit): string {
  const lines = text.split('\n');
  const offset = (line: number, col: number) => lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  return text.slice(0, offset(e.startLine, e.startColumn)) + e.text + text.slice(offset(e.endLine, e.endColumn));
}
const lens = (text: string) => { const l = text.split('\n'); return { count: l.length, len: (n: number) => l[n - 1]!.length }; };

describe('lineDiff / fold / stats', () => {
  it('diffs, folds and counts', () => {
    const d = lineDiff('a\nb\nc\nd\ne\nf\ng\nh\ni', 'a\nb\nX\nd\ne\nf\ng\nh\ni')!;
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
    expect(foldDiff(d, 1).map(h => h.type)).toEqual(['gap', 'lines', 'gap']);
    expect(foldDiff(d, 0).map(h => h.type)).toEqual(['gap', 'lines', 'gap']);
    expect(lineDiff('a\nb\nc', 'x\ny\nz', 2)).toBeNull();
    expect(lineDiff('a\nb\nc', 'a\nc')!.filter(l => l.type === 'del')).toHaveLength(1);
    expect(lineDiff('a', 'a\nb\nc')!.filter(l => l.type === 'add')).toHaveLength(2);
  });
});

describe('hunks', () => {
  const base = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8';
  const proposed = 'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nl9';
  it('groups changes and returns null when too large', () => {
    const hunks = computeHunks(base, proposed)!;
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ baseStart: 2, oldLines: ['l2'], newLines: ['L2'] });
    expect(hunks[1]).toMatchObject({ baseStart: 9, oldLines: [], newLines: ['l9'] });
    expect(hunkDelta(hunks[1]!)).toBe(1);
    expect(computeHunks('a\nb\nc', 'x\ny\nz', 1)).toBeNull();
    expect(computeHunks('same', 'same')).toEqual([]);
    expect(hunkSignature(hunks[0]!)).not.toBe(hunkSignature(hunks[1]!));
  });
  it('applies subsets and tracks shifted starts', () => {
    const hunks = computeHunks('a\nb\nc\nd\ne', 'a\nb\nB1\nB2\nc\nd\nE')!;
    expect(applyHunks('a\nb\nc\nd\ne', hunks, new Set())).toBe('a\nb\nc\nd\ne');
    expect(applyHunks('a\nb\nc\nd\ne', hunks, new Set([0, 1]))).toBe('a\nb\nB1\nB2\nc\nd\nE');
    expect(applyHunks('a\nb\nc\nd\ne', hunks, new Set([1]))).toBe('a\nb\nc\nd\nE');
    expect(currentHunkStart(hunks, 1, new Set([0]))).toBe(hunks[1]!.baseStart + 2);
    expect(currentHunkStart(hunks, 1, new Set())).toBe(hunks[1]!.baseStart);
  });
  it.each([
    ['replace middle', 'a\nb\nc', 'a\nB\nc'],
    ['insert middle', 'a\nb', 'a\nx\nb'],
    ['insert at end', 'a\nb', 'a\nb\nc'],
    ['insert at start', 'a\nb', 'z\na\nb'],
    ['delete middle', 'a\nb\nc', 'a\nc'],
    ['delete last', 'a\nb\nc', 'a\nb'],
    ['delete first', 'a\nb\nc', 'b\nc'],
    ['delete all', 'a\nb', ''],
    ['replace last', 'a\nb', 'a\nQ'],
    ['trailing newline', 'a\n', 'a\nb\n']
  ])('hunkEdit produces the same text as applyHunks: %s', (_n, from, to) => {
    const hunks = computeHunks(from, to)!;
    let text = from;
    // Apply bottom-up so the original coordinates stay valid.
    for (const hunk of [...hunks].reverse()) {
      const { count, len } = lens(text);
      text = applyEdit(text, hunkEdit(hunk, hunk.baseStart, count, len));
    }
    expect(text).toBe(to);
    expect(applyHunks(from, hunks, new Set(hunks.map(h => h.index)))).toBe(to);
  });
});
