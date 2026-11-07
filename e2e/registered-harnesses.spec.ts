import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test('registered harnesses use the real provider registry and link to their owning plugins', async ({ app }, testInfo) => {
  const win = app.window;
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-harness').click();
  const list = win.getByTestId('registered-harness-list');
  const expectLiveRegistry = async () => {
    let registered: { providers: Array<{ id: string; displayName: string; pluginId: string }> };
    // Plugins register asynchronously during boot. Compare a fresh registry
    // snapshot at each checkpoint instead of freezing the first partial roster.
    await expect(async () => {
      registered = await win.evaluate(async () => {
        const response = await fetch('/api/v1/threads/providers');
        if (!response.ok) throw new Error(`Provider registry failed: ${response.status}`);
        return response.json();
      });
      expect(registered.providers.length).toBeGreaterThan(0);
      await expect(list.locator(':scope > .registered-harness')).toHaveCount(registered.providers.length, { timeout: 1_000 });
      const names = [...registered.providers].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)).map(provider => provider.displayName);
      await expect(list.locator('h4')).toHaveText(names, { timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    return registered!;
  };
  const registered = await expectLiveRegistry();
  const first = [...registered.providers].sort((a, b) => a.displayName.localeCompare(b.displayName))[0];
  const row = list.locator(`[data-provider-id="${first.id}"]`);
  await row.getByRole('button', { name: `Browse ${first.displayName} models` }).click();
  await expect(row.getByText(`${first.displayName} models`, { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Reload models' })).toBeVisible();
  await row.getByRole('button', { name: `Browse ${first.displayName} models` }).click();
  await win.getByRole('searchbox', { name: 'Search installed harnesses' }).fill('no-matching-provider');
  await expect(list).toContainText('No harnesses match your search.');
  await win.getByRole('searchbox', { name: 'Search installed harnesses' }).fill('');
  await expectLiveRegistry();
  await win.getByRole('searchbox', { name: 'Search installed harnesses' }).blur();
  // Hidden Electron windows throttle animation frames. Wake the native compositor
  // before capturing the reset search state.
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('reset-search.png'));
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('real-registry.png'));
  await row.getByRole('link', { name: /^From / }).click();
  await expect(win).toHaveURL(new RegExp(`/extensions/plugins/${first.pluginId}`));
  const contributions = win.getByTestId('plugin-includes');
  await expect(contributions.getByRole('heading', { name: 'Adds to Zana' })).toBeVisible();
  await contributions.getByRole('link', { name: first.displayName, exact: true }).click();
  await expect(win).toHaveURL(/\/settings\/harness/);
  await expect(win.getByTestId('registered-harness-list')).toBeVisible();
  await win.setViewportSize({ width: 800, height: 800 });
  await expect.poll(() => win.locator('.settings-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
