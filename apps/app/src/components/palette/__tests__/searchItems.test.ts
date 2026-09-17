import { describe, expect, it } from 'vitest';
import { searchPaletteItems, MAX_PALETTE_RESULTS } from '../searchItems.js';
import type { PaletteCategory, PaletteItem } from '../buildItems.js';

const item = (key: string, category: PaletteCategory = 'Projects', extra: Partial<PaletteItem> = {}): PaletteItem => ({
  key, label: key, category, icon: null, source: 'core', run: () => {}, ...extra
});
const run = (items: PaletteItem[], query = '', scope: Parameters<typeof searchPaletteItems>[2] = 'all') =>
  searchPaletteItems(items, query, scope, {}, 1000);

describe('palette search', () => {
  it('searches favorites across destination categories while leaving ordinary search intact', () => {
    const items = [item('Design project', 'Projects', { favorite: true }),
      item('Design thread', 'Threads', { favorite: true }), item('Design CLI', 'Tabs', { favorite: true }),
      item('Design command', 'Actions'), item('Design other', 'Threads')];
    expect(run(items, '', 'favorites').rows.map((row) => row.item.key)).toEqual(['Design project', 'Design thread', 'Design CLI']);
    expect(run(items, 'Design', 'favorites').total).toBe(3);
    expect(run(items, 'Design').total).toBe(5);
    expect(run(items, 'Design', 'threads').total).toBe(2);
  });

  it('does not bring unavailable favorites back through usage history', () => {
    const result = searchPaletteItems([item('plain')], '', 'favorites', { deleted: { count: 1, lastUsedAt: 1000 } }, 1000);
    expect(result).toEqual({ rows: [], total: 0, overflow: {} });
  });

  it('keeps landing categories together, caps long lists, and exposes all items through a filter', () => {
    const projects = Array.from({ length: 9 }, (_, i) => item(`Project ${i}`));
    const commands = Array.from({ length: 9 }, (_, i) => item(`Command ${i}`, 'Actions'));
    const result = run([...projects, ...commands]);
    expect(result.total).toBe(18);
    expect(result.rows).toHaveLength(11);
    expect(result.overflow).toEqual({ Projects: 4, Actions: 3 });
    expect(run([...projects, ...commands], '', 'projects').rows.map((r) => r.item)).toEqual(projects);
    expect(run([...projects, ...commands], 'Project').rows).toHaveLength(9);
  });

  it('shows only available recent items, in last-used order without duplicate rows', () => {
    const items = ['one', 'two', 'three', 'four', 'five', 'six'].map((key) => item(key));
    const recents = Object.fromEntries([...items, item('deleted')].map((entry, i) => [entry.key, { count: 1, lastUsedAt: i * 100 }]));
    const result = searchPaletteItems(items, '', 'all', recents, 1000);
    expect(result.rows.slice(0, 4).map((r) => [r.item.key, r.section])).toEqual([
      ['six', 'Recent'], ['five', 'Recent'], ['four', 'Recent'], ['three', 'Recent']
    ]);
    expect(result.rows).toHaveLength(6);
    expect(new Set(result.rows.map((r) => r.item.key)).size).toBe(6);
    expect(result.rows.some((r) => r.item.key === 'deleted')).toBe(false);
    const filtered = searchPaletteItems(items, '', 'projects', recents, 1000);
    expect(filtered.rows.every((r) => r.section === 'Projects')).toBe(true);
    expect(filtered.rows[0].item.key).toBe('six');
  });

  it.each([
    ['projects', 'Projects'], ['threads', 'Threads'], ['tabs', 'Tabs']
  ] as const)('limits %s to the selected category even when names match', (scope, category) => {
    const items = (['Projects', 'Threads', 'Tabs', 'Actions', 'Extensions'] as const).map((cat) => item(cat, cat, { label: 'Design' }));
    expect(run(items, 'Design', scope).rows.map((r) => r.item.category)).toEqual([category]);
    expect(run(items, '', scope).total).toBe(1);
  });

  it('includes plugin commands in Commands and keeps their source', () => {
    const items = [item('project'), item('core', 'Actions'), item('plugin', 'Extensions', { source: 'Example' })];
    expect(run(items, '', 'commands').rows.map((r) => r.item.key)).toEqual(['core', 'plugin']);
    expect(run(items, 'plugin', 'commands').rows[0].item.source).toBe('Example');
  });

  it('prioritizes label matches over metadata and highlights only the winning label', () => {
    const items = [item('other', 'Threads', { hint: 'Design' }), item('Design'), item('third', 'Actions', { keywords: ['Design'] })];
    const result = run(items, ' Design ');
    expect(result.rows.map((r) => r.item.key)).toEqual(['Design', 'other', 'third']);
    expect(result.rows[0].labelMatchIdx).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.rows[1].labelMatchIdx).toBeUndefined();
    expect(result.rows[2].labelMatchIdx).toBeUndefined();
  });

  it('keeps a matching label highlighted when metadata also matches', () => {
    const row = run([item('x a much longer b label', 'Threads', { hint: 'ab' })], 'ab').rows[0];
    expect(row).toBeDefined();
    expect(row.labelMatchIdx).toEqual([2, 16]);
  });

  it('uses recency only for ties and preserves source order for equal scores', () => {
    const items = [item('a', 'Threads', { label: 'Design' }), item('b', 'Threads', { label: 'Design' })];
    expect(run(items, 'Design').rows.map((r) => r.item.key)).toEqual(['a', 'b']);
    expect(searchPaletteItems(items, 'Design', 'all', { b: { count: 20, lastUsedAt: 1000 } }, 1000).rows[0].item.key).toBe('b');
  });

  it('bounds rendering for filtered and typed results without concealing the total', () => {
    const items = Array.from({ length: MAX_PALETTE_RESULTS + 25 }, (_, i) => item(`Design ${i}`));
    for (const result of [run(items, 'Design'), run(items, '', 'projects')]) {
      expect(result.rows).toHaveLength(MAX_PALETTE_RESULTS);
      expect(result.total).toBe(MAX_PALETTE_RESULTS + 25);
    }
  });

  it('handles empty catalogues, blank queries, absent metadata, and no matches', () => {
    expect(run([])).toEqual({ rows: [], total: 0, overflow: {} });
    expect(run([item('hello')], '   ').rows).toHaveLength(1);
    expect(run([item('hello')], 'xyz').rows).toEqual([]);
  });
});
