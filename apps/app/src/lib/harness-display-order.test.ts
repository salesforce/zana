import { describe, expect, it } from 'vitest';
import { sortHarnessDisplayRows } from './harness-display-order';

type Row = { id: string; name: string };
const sort = (rows: readonly Row[]) => sortHarnessDisplayRows(rows, (r) => r.name, (r) => r.id);
const ids = (rows: readonly Row[]) => rows.map((r) => r.id);

describe('sortHarnessDisplayRows', () => {
  it('sorts the current harness names alphabetically from any input order', () => {
    const names = ['Agentforce Code', 'Claude Code', 'Codex', 'Cursor', 'Grok Build', 'Mastra Code', 'OpenCode', 'PI'];
    const rows = names.map((name) => ({ id: name.toLowerCase(), name }));
    expect(sort([...rows].reverse()).map((r) => r.name)).toEqual(names);
    expect(sort([rows[3]!, rows[7]!, rows[0]!, rows[5]!, rows[1]!, rows[6]!, rows[2]!, rows[4]!]).map((r) => r.name)).toEqual(names);
  });

  it('orders numbers naturally', () => {
    expect(sort([{ id: 'a', name: 'Harness 10' }, { id: 'b', name: 'Harness 2' }]).map((r) => r.name)).toEqual([
      'Harness 2',
      'Harness 10'
    ]);
  });

  it('ignores case and accents in the name and lets the id decide ties deterministically', () => {
    const a = { id: 'b-id', name: 'Café' };
    const b = { id: 'a-id', name: 'cafe' };
    expect(ids(sort([a, b]))).toEqual(['a-id', 'b-id']);
    expect(ids(sort([b, a]))).toEqual(['a-id', 'b-id']);
  });

  it('keeps exact duplicates in input order', () => {
    const first = { id: 'x', name: 'Same' };
    const second = { id: 'x', name: 'Same' };
    const out = sort([first, second]);
    expect(out[0]).toBe(first);
    expect(out[1]).toBe(second);
  });

  it('returns a copy and accepts frozen input without mutating it', () => {
    const rows = Object.freeze([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]);
    const out = sort(rows);
    expect(out).not.toBe(rows);
    expect(ids(rows)).toEqual(['b', 'a']);
    expect(ids(out)).toEqual(['a', 'b']);
  });

  it('handles empty and single-element input', () => {
    expect(sort([])).toEqual([]);
    const only = { id: 'a', name: 'A' };
    expect(sort([only])).toEqual([only]);
  });
});
