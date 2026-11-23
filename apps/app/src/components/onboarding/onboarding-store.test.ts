// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), changed: vi.fn(), off: vi.fn(), json: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { config: { get: api.get, set: api.set, onChanged: api.changed } } }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: api.json }));
import { isOnboardingPending, loadIdentityHint, loadOnboarding, openOnboarding, saveOnboarding, setMinimized, setStep, useOnboarding } from './onboarding-store.js';
const profile = { id: 'employees', organization: 'Example', question: 'Employee?', prerequisite: 'Connect.', marketplaceSource: 'path:/fixture' };
const allSteps = { harness: 'done', workplace: 'skipped', bundle: 'skipped', advanced: 'done' } as const;
const progress = { version: 2 as const, profileId: profile.id, audience: 'general' as const, steps: allSteps, completedAt: '2026-01-01T00:00:00.000Z' };
const pending = { version: 2 as const, profileId: profile.id, audience: 'undecided' as const, steps: { harness: 'todo', workplace: 'todo', bundle: 'todo', advanced: 'todo' } as const };
beforeEach(() => {
  vi.resetAllMocks(); api.changed.mockReturnValue(api.off); api.json.mockResolvedValue({ profile }); api.get.mockResolvedValue({});
  api.set.mockImplementation(async patch => patch);
  useOnboarding.setState({ loaded: false, open: false, profile: null, progress: undefined, identityHint: undefined, error: null });
});
it('offers setup to a fresh installation or an upgrade without a recorded choice', async () => {
  const loader = loadOnboarding(); await loader.ready;
  expect(useOnboarding.getState()).toMatchObject({ loaded: true, open: true, profile });
  loader.dispose(); expect(api.off).toHaveBeenCalledOnce();
});
it('does not re-prompt completed setup, but keeps offering unfinished setup', async () => {
  api.get.mockResolvedValue({ onboarding: progress });
  let loader = loadOnboarding(); await loader.ready;
  expect(useOnboarding.getState().open).toBe(false); loader.dispose();
  api.get.mockResolvedValue({ onboarding: pending });
  loader = loadOnboarding(); await loader.ready;
  expect(useOnboarding.getState().open).toBe(true); loader.dispose();
  expect(isOnboardingPending(progress)).toBe(false); expect(isOnboardingPending(undefined)).toBe(true);
  useOnboarding.setState({ open: false, progress }); openOnboarding(); expect(useOnboarding.getState().open).toBe(true);
});
it('reopening restores a minimized panel and tolerates a failed save', async () => {
  useOnboarding.setState({ progress: { ...pending, minimized: true } });
  openOnboarding(); await vi.waitFor(() => expect(api.set).toHaveBeenCalled());
  expect(useOnboarding.getState().progress?.minimized).toBe(false);
  api.set.mockRejectedValueOnce(new Error('nope')); useOnboarding.setState({ progress: { ...pending, minimized: true } });
  expect(() => openOnboarding()).not.toThrow();
});
it('records steps, completes when settled and clears completion when reopened', async () => {
  useOnboarding.setState({ profile });
  await setStep('harness', 'done');
  expect(useOnboarding.getState().progress).toMatchObject({ version: 2, profileId: profile.id, audience: 'undecided', steps: { harness: 'done', workplace: 'todo' } });
  expect(useOnboarding.getState().progress).not.toHaveProperty('completedAt');
  for (const id of ['workplace', 'bundle', 'advanced'] as const) await setStep(id, 'skipped');
  expect(useOnboarding.getState().progress?.completedAt).toEqual(expect.any(String));
  await setStep('workplace', 'background');
  expect(useOnboarding.getState().progress).not.toHaveProperty('completedAt');
  await setMinimized(true);
  expect(useOnboarding.getState().progress?.minimized).toBe(true);
});
it('creates progress without a profile id when no distribution profile exists', async () => {
  await setStep('advanced', 'done');
  expect(useOnboarding.getState().progress).toMatchObject({ version: 2, audience: 'undecided', steps: { advanced: 'done' } });
  expect(useOnboarding.getState().progress).not.toHaveProperty('profileId');
});
it('loads the identity hint from main and degrades to no match', async () => {
  expect(await loadIdentityHint()).toEqual({ match: false }); expect(api.json).not.toHaveBeenCalled();
  useOnboarding.setState({ profile });
  api.json.mockResolvedValueOnce({ hint: { match: true, email: 'a@example.com' } });
  expect(await loadIdentityHint()).toEqual({ match: true, email: 'a@example.com' });
  expect(api.json).toHaveBeenCalledWith('/onboarding/identity-hint');
  expect(useOnboarding.getState().identityHint).toEqual({ match: true, email: 'a@example.com' });
  api.json.mockResolvedValueOnce({ hint: { match: true, extra: 1 } });
  expect(await loadIdentityHint()).toEqual({ match: false });
  api.json.mockRejectedValueOnce(new Error('offline'));
  expect(await loadIdentityHint()).toEqual({ match: false });
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
it('still opens setup for a fresh install without a distribution profile', async () => {
  api.json.mockResolvedValue({ profile: null });
  const loader = loadOnboarding(); await loader.ready;
  expect(useOnboarding.getState()).toMatchObject({ loaded: true, open: true, profile: null }); loader.dispose();
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
