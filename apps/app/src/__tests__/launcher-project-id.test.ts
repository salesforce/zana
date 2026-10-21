import { beforeAll, describe, expect, it } from 'vitest';

describe('useUi launcherProjectId', () => {
  // Cold transform of store.ts can exceed the default timeout under suite load.
  beforeAll(async () => {
    await import('../store.js');
  }, 20_000);

  it('records the project a launcher was opened for and clears it on close or a generic open', async () => {
    const { useUi } = await import('../store.js');
    useUi.getState().setLauncherOpen(true, 'remote-1');
    expect(useUi.getState()).toMatchObject({ launcherOpen: true, launcherProjectId: 'remote-1' });
    useUi.getState().setLauncherOpen(false);
    expect(useUi.getState()).toMatchObject({ launcherOpen: false, launcherProjectId: null });
    useUi.getState().setLauncherOpen(true, 'remote-1');
    useUi.getState().setLauncherOpen(true);
    expect(useUi.getState()).toMatchObject({ launcherOpen: true, launcherProjectId: null });
  });
});
