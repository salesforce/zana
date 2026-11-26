/**
 * "Automatically settle safe peer changes" lives in Design Docs → Settings → Peers, not in the global plugin
 * settings. It persists in the plugin's own storage and survives a renderer reload.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

async function installDesignDocs(win: Page) {
  const existing = await win.evaluate(async () => (await window.cc.pluginApps.list()).some((plugin) => plugin.id === 'design-docs'));
  if (!existing) {
    expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }))).toMatchObject({ ok: true });
  }
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((plugin) => plugin.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');
}

test('the safe peer changes toggle lives in Settings → Peers and persists', async ({ app }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await installDesignDocs(win);

  // Gone from the global plugin settings.
  const global = await win.evaluate(() => window.cc.pluginApps.getSettings('design-docs'));
  expect(Object.keys(global.descriptors ?? {})).not.toContain('autoConverge');

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
  await win.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Peers', exact: true }).click();
  const toggle = win.getByRole('switch', { name: /settle safe peer changes/i });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('design-docs', 'autoConverge', {}))).toEqual({ enabled: true });

  // Survives a renderer reload.
  await win.reload();
  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
  await win.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Peers', exact: true }).click();
  await expect(win.getByRole('switch', { name: /settle safe peer changes/i })).toBeChecked();

  await expect(win.getByRole('switch', { name: /settle safe peer changes/i })).toBeEnabled();
  await win.getByRole('switch', { name: /settle safe peer changes/i }).uncheck();
  await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('design-docs', 'autoConverge', {}))).toEqual({ enabled: false });
});
