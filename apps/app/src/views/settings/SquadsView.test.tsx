import { describe, expect, it, vi } from 'vitest';

vi.mock('@/store', () => ({
  useTeams: () => [],
  useData: () => [],
  useUi: () => vi.fn(),
  usePersonas: () => []
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/components/SquadEditor', () => ({ SquadEditor: () => null }));

import { runTeamLaunchExclusive, menuIndexForKey, menuTabIndex } from '@/views/settings/SquadsView';

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

describe('SquadsPanel launch guard', () => {
  it('suppresses a concurrent launch and permits another after completion', async () => {
    const inFlight = { current: false };
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const launch = vi.fn().mockReturnValueOnce(firstPending).mockResolvedValueOnce(undefined);

    const first = runTeamLaunchExclusive(inFlight, launch);
    const duplicate = runTeamLaunchExclusive(inFlight, launch);

    await expect(duplicate).resolves.toBeUndefined();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(inFlight.current).toBe(true);

    releaseFirst();
    await first;
    expect(inFlight.current).toBe(false);

    await runTeamLaunchExclusive(inFlight, launch);
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
