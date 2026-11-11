import { afterEach, expect, it, vi } from 'vitest';

const surface = vi.hoisted(() => ({ desktop: false }));
vi.mock('./app-surface.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./app-surface.js')>()),
  hasDesktopBridge: () => surface.desktop
}));

const load = async () => {
  vi.resetModules();
  return (await import('./product-client.js')).product;
};

afterEach(() => {
  surface.desktop = false;
  vi.unstubAllGlobals();
});

it('keeps scheduled Team review and Team preview unavailable away from an owner desktop', async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sharedProductServices: false })));
  const product = await load();

  await expect(product.scheduler.previewTeamLaunch('schedule-1')).resolves.toEqual({
    ok: false, code: 'unavailable', message: 'scheduled Squad review requires the desktop app'
  });
  await expect(product.scheduler.runReviewedTeamNow('schedule-1', 'token')).resolves.toEqual({
    ok: false, code: 'unavailable', message: 'scheduled Squad review requires the desktop app'
  });
  await expect(product.teams.preview({} as never)).resolves.toEqual({
    ok: false, code: 'UNAVAILABLE', message: 'Launch preview requires a connected host'
  });
});

it('uses native named-check settings only in an owner desktop and releases no-op browser listeners', async () => {
  const namedChecks = { get: vi.fn(), set: vi.fn(), onChanged: vi.fn(() => vi.fn()) };
  vi.stubGlobal('window', { cc: { namedChecks } });
  surface.desktop = true;
  const product = await load();
  expect(product.namedChecks).toBe(namedChecks);

  surface.desktop = false;
  const browserProduct = await load();
  await expect(browserProduct.namedChecks.get({ kind: 'global' })).rejects.toThrow('Named checks require owner desktop window');
  await expect(browserProduct.namedChecks.set({ kind: 'global' }, [])).rejects.toThrow('Named checks require owner desktop window');
  expect(browserProduct.namedChecks.onChanged(vi.fn())).toBeTypeOf('function');
});
