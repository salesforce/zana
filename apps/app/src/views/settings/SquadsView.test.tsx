import { describe, expect, it, vi } from 'vitest';

vi.mock('@/store', () => ({
  useTeams: () => [],
  useData: () => [],
  useUi: () => vi.fn(),
  usePersonas: () => []
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/components/SquadEditor', () => ({ SquadEditor: () => null }));

import { menuIndexForKey, menuTabIndex } from '@/views/settings/SquadsView';

describe('SquadsPanel project menu keyboard navigation', () => {
  it('supports arrows plus Home and End with wrapping', () => {
    expect(menuIndexForKey('ArrowDown', 0, 3)).toBe(1);
    expect(menuIndexForKey('ArrowDown', 2, 3)).toBe(0);
    expect(menuIndexForKey('ArrowUp', 0, 3)).toBe(2);
    expect(menuIndexForKey('Home', 2, 3)).toBe(0);
    expect(menuIndexForKey('End', 0, 3)).toBe(2);
  });

  it('uses one roving tab stop for menu items', () => {
    expect([0, 1, 2].map((index) => menuTabIndex(index, 1))).toEqual([-1, 0, -1]);
  });
});

