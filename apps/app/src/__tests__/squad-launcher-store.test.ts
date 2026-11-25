import { describe, expect, it } from 'vitest';

const { useUi } = await import('../store.js');

describe('openSquadLauncher', () => {
  it('opens the launcher with the project and Squad, and clears both on close', () => {
    useUi.getState().openSquadLauncher('p1', 't1');
    expect(useUi.getState()).toMatchObject({ launcherOpen: true, launcherProjectId: 'p1', launcherTeamId: 't1' });
    useUi.getState().setLauncherOpen(false);
    expect(useUi.getState()).toMatchObject({ launcherOpen: false, launcherProjectId: null, launcherTeamId: null });
  });

  it('a generic open does not inherit a previous Squad', () => {
    useUi.getState().openSquadLauncher('p1', 't1');
    useUi.getState().setLauncherOpen(true, 'p2');
    expect(useUi.getState()).toMatchObject({ launcherProjectId: 'p2', launcherTeamId: null });
    useUi.getState().setLauncherOpen(false);
  });
});
