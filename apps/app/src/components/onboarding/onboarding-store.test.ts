// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), changed: vi.fn(), off: vi.fn(), json: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { config: { get: api.get, set: api.set, onChanged: api.changed } } }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: api.json }));
import { loadOnboarding, openOnboarding, saveOnboarding, useOnboarding } from './onboarding-store.js';
const profile = { id: 'employees', organization: 'Example', question: 'Employee?', prerequisite: 'Connect.', marketplaceSource: 'path:/fixture' };
const progress = { version: 1 as const, profileId: profile.id, audience: 'general' as const, step: 'complete' as const };
beforeEach(() => {
  vi.resetAllMocks(); api.changed.mockReturnValue(api.off); api.json.mockResolvedValue({ profile }); api.get.mockResolvedValue({});
  api.set.mockImplementation(async patch => patch);
  useOnboarding.setState({ loaded: false, open: false, profile: null, progress: undefined, error: null });
});
it('offers setup to a fresh installation or an upgrade without a recorded choice', async () => {
  const loader = loadOnboarding(); await loader.ready;
  expect(useOnboarding.getState()).toMatchObject({ loaded: true, open: true, profile });
  loader.dispose(); expect(api.off).toHaveBeenCalledOnce();
});
it('does not re-prompt answered or skipped setup on a later launch', async () => {
  for (const saved of [progress, { ...progress, audience: 'undecided', step: 'welcome' }]) {
    api.get.mockResolvedValue({ onboarding: saved });
    const loader = loadOnboarding(); await loader.ready;
    expect(useOnboarding.getState().open).toBe(false); loader.dispose();
  }
  openOnboarding(); expect(useOnboarding.getState().open).toBe(true);
});
it('offers a newly configured distribution profile once', async () => {
  api.get.mockResolvedValue({ onboarding: { ...progress, profileId: 'other' } });
  const loader = loadOnboarding(); await loader.ready;
  expect(useOnboarding.getState().open).toBe(true); loader.dispose();
});
it('keeps newer config events when an initial read finishes late', async () => {
  let finish!: (value: object) => void;
  api.get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const loader = loadOnboarding();
  api.changed.mock.calls[0]![0]({ onboarding: progress });
  finish({}); await loader.ready;
  expect(useOnboarding.getState()).toMatchObject({ open: false, progress }); loader.dispose();
});
it('fences a late initial response after unmount', async () => {
  let finish!: (value: object) => void;
  api.get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const loader = loadOnboarding(); loader.dispose(); finish({}); await loader.ready;
  expect(useOnboarding.getState().loaded).toBe(false);
});
it('allows a distribution without employee onboarding', async () => {
  api.json.mockResolvedValue({ profile: null });
  const loader = loadOnboarding(); await loader.ready;
  expect(useOnboarding.getState()).toMatchObject({ loaded: true, open: false, profile: null }); loader.dispose();
});
it.each([new Error('offline'), 'broken metadata'])('exposes a recoverable load failure: %s', async error => {
  api.json.mockRejectedValue(error);
  const loader = loadOnboarding(); await loader.ready;
  expect(useOnboarding.getState()).toMatchObject({ loaded: true, open: false, error: expect.stringContaining('Settings') }); loader.dispose();
});
it('does not overwrite local progress or claim success when saving fails', async () => {
  api.set.mockRejectedValueOnce(new Error('Disk full'));
  await expect(saveOnboarding(progress)).rejects.toThrow('Disk full');
  expect(useOnboarding.getState().progress).toBeUndefined();
  await saveOnboarding(progress);
  expect(api.set).toHaveBeenLastCalledWith({ onboarding: progress, walkthroughCompleted: true, setupDismissed: true });
  expect(useOnboarding.getState().progress).toEqual(progress);
});
