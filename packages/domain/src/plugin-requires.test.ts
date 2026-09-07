import { describe, expect, it } from 'vitest';
import { formatPluginRequireCycle, parsePluginRequires, sortPluginsByRequires } from './plugin-requires.js';

describe('sortPluginsByRequires', () => {
  it('loads providers before dependents', () => {
    const { ordered, cycles } = sortPluginsByRequires([
      { id: 'beta', requires: ['alpha'] },
      { id: 'alpha', requires: [] },
      { id: 'gamma', requires: ['beta'] }
    ]);
    expect(ordered.map((row) => row.id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(cycles).toEqual([]);
  });

  it('ignores missing required ids when ordering', () => {
    const { ordered, cycles } = sortPluginsByRequires([
      { id: 'beta', requires: ['missing'] },
      { id: 'alpha', requires: [] }
    ]);
    expect(ordered.map((row) => row.id)).toEqual(['alpha', 'beta']);
    expect(cycles).toEqual([]);
  });

  it('reports a two-plugin cycle', () => {
    const { ordered, cycles } = sortPluginsByRequires([
      { id: 'alpha', requires: ['beta'] },
      { id: 'beta', requires: ['alpha'] }
    ]);
    expect(ordered).toEqual([]);
    expect(cycles).toHaveLength(2);
    expect(formatPluginRequireCycle(cycles[0]!.cycle)).toMatch(/alpha|beta/);
  });

  it('reports a self-require as a cycle', () => {
    const { ordered, cycles } = sortPluginsByRequires([{ id: 'alpha', requires: ['alpha'] }]);
    expect(ordered).toEqual([]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.cycle).toEqual(['alpha', 'alpha']);
  });
});

describe('parsePluginRequires', () => {
  it('dedupes and trims ids', () => {
    expect(parsePluginRequires(['alpha', ' alpha ', 'beta'])).toEqual(['alpha', 'beta']);
  });

  it('rejects invalid ids and oversized lists', () => {
    expect(() => parsePluginRequires(['Alpha'])).toThrow(/plugin ids/);
    expect(() => parsePluginRequires(Array.from({ length: 17 }, (_, i) => `p${i}`))).toThrow(
      /at most 16/
    );
  });
});
