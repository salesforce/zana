import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });
test.setTimeout(120_000);

const readConfig = (win: import('@playwright/test').Page) =>
  win.evaluate(() => window.cc.config.get());

test('Composer launch mode is seeded and mirrored into AppConfig', async ({ app }) => {
  const win = app.window;
  await dismissConsentOverlays(win);

  // Seed once: a fresh config with no mirror picks up the stored/default mode.
  await expect.poll(async () => (await readConfig(win)).composerDefaultLaunchMode).toBe('thread');

  const group = win.getByRole('group', { name: 'Launch mode' }).first();
  await group.getByRole('button', { name: 'CLI Agent' }).click();
  await expect.poll(async () => (await readConfig(win)).composerDefaultLaunchMode).toBe('agent');
  await expect.poll(async () => (await readConfig(win)).composerLastTransportMode).toBe('agent');

  // Team overwrites the default but never the last transport mode.
  const team = group.getByRole('button', { name: /^Team/ });
  if (await team.count()) {
    await team.click();
    await expect.poll(async () => (await readConfig(win)).composerDefaultLaunchMode).toBe('team');
    expect((await readConfig(win)).composerLastTransportMode).toBe('agent');
  }

  // Main rejects invalid enum values from the renderer.
  await win.evaluate(() => window.cc.config.set({ composerDefaultLaunchMode: 'bogus' as never, squadDefaultTransport: 'nope' as never }));
  const after = await readConfig(win);
  expect(after.composerDefaultLaunchMode).not.toBe('bogus');
  expect(after.squadDefaultTransport).toBeUndefined();
});
