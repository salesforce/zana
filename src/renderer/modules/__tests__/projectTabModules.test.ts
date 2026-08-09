import { describe, it, expect } from 'vitest';
import type { AppModule } from '@shared/module-api';
import { selectProjectTabModules } from '../index';

/**
 * `selectProjectTabModules` is the generic filter+sort behind the per-project
 * extension tabs: only modules that declared `projectTab` AND ship a `panel`
 * qualify, sorted ascending by `projectTab.order` (default 100) then by id.
 * No extension id is named — the contract is data-driven (Rule 6).
 */
function mod(id: string, extra: Partial<AppModule> = {}): AppModule {
  const Panel = () => null;
  return { id, title: id, icon: 'Box', panel: Panel, ...extra } as AppModule;
}

describe('selectProjectTabModules', () => {
  it('keeps only modules that declared projectTab and have a panel', () => {
    const mods = [
      mod('a'), // no projectTab → excluded
      mod('b', { projectTab: {} }), // opted in → included
      mod('c', { projectTab: { order: 1 }, panel: undefined }) // no panel → excluded
    ];
    expect(selectProjectTabModules(mods).map((m) => m.id)).toEqual(['b']);
  });

  it('sorts by order (default 100) then by id', () => {
    const mods = [
      mod('zeta', { projectTab: { order: 50 } }),
      mod('alpha', { projectTab: {} }), // default order 100
      mod('beta', { projectTab: { order: 100 } }), // tie with alpha → id breaks tie
      mod('early', { projectTab: { order: 10 } })
    ];
    expect(selectProjectTabModules(mods).map((m) => m.id)).toEqual([
      'early', // 10
      'zeta', // 50
      'alpha', // 100, id 'alpha' < 'beta'
      'beta' // 100
    ]);
  });

  it('returns an empty array when nothing opts in', () => {
    expect(selectProjectTabModules([mod('a'), mod('b')])).toEqual([]);
  });
});
