import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('modern thread work holds the native power blocker and respects the setting', async ({ app }) => {
  // Record real Electron blocker calls; keep the native implementation in use.
  await app.electron.evaluate(({ powerSaveBlocker }) => {
    const ids = new Set<number>();
    const start = powerSaveBlocker.start.bind(powerSaveBlocker);
    const stop = powerSaveBlocker.stop.bind(powerSaveBlocker);
    powerSaveBlocker.start = (type) => { const id = start(type); ids.add(id); return id; };
    powerSaveBlocker.stop = (id) => { stop(id); ids.delete(id); };
    (globalThis as any).__threadPowerIds = ids;
  });
  const held = () => app.electron.evaluate(({ powerSaveBlocker }) =>
    [...(globalThis as any).__threadPowerIds as Set<number>].some(id => powerSaveBlocker.isStarted(id)));
  const { window } = app;
  await window.evaluate(() => window.cc.config.set({ keepAwakeWhileWorking: true, sponsorPromptDismissed: true }));
  await window.getByTestId('nav-home').click();
  const home = window.locator('.thread-command-composer').first();
  await expect(home.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await home.getByTestId('thread-command-input').fill('delay:60000 keep working while the display sleeps');
  await home.getByTestId('thread-command-send').click();
  const detail = window.getByTestId('thread-detail');
  await expect(detail).toBeVisible({ timeout: 60_000 });
  await expect(window.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect.poll(held).toBe(true);

  await window.evaluate(() => window.cc.config.set({ keepAwakeWhileWorking: false }));
  await expect.poll(held).toBe(false);
  await window.evaluate(() => window.cc.config.set({ keepAwakeWhileWorking: true }));
  await expect.poll(held).toBe(true);

  await window.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(detail.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Send');
  // Unit tests cover the 90s release grace. Toggle off to release immediately,
  // then re-enable: a stopped thread must no longer count as working.
  await window.evaluate(() => window.cc.config.set({ keepAwakeWhileWorking: false }));
  await expect.poll(held).toBe(false);
  // Wait for the coalesced runtime snapshot to reflect the completed stop.
  await expect.poll(async () => {
    await window.evaluate(() => window.cc.config.set({ keepAwakeWhileWorking: true }));
    const active = await held();
    await window.evaluate(() => window.cc.config.set({ keepAwakeWhileWorking: false }));
    return active;
  }).toBe(false);
  await window.evaluate(() => window.cc.config.set({ keepAwakeWhileWorking: true }));
});
