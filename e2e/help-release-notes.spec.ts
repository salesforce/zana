import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true, walkthroughCompleted: true } });

test('Help opens bundled release notes and navigates older releases', async ({ app }, testInfo) => {
  const page = app.window;
  const help = page.getByTestId('titlebar-help-toggle');
  await help.click();
  const menu = page.getByRole('dialog', { name: 'Help' });
  await expect(menu.getByRole('region', { name: 'Release notes' })).toBeVisible();
  const latest = menu.getByRole('button', { name: /Zana .+ Latest/ });
  await expect(latest).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('help-release-notes-menu.png') });
  await latest.click();
  await expect(menu).toHaveCount(0);
  const browser = page.getByRole('dialog', { name: 'Release notes' });
  const versions = browser.getByRole('navigation', { name: 'Releases' }).getByRole('button');
  const latestVersion = (await versions.first().innerText()).replace(/\s*Latest/, '').trim();
  await expect(browser.getByRole('article')).toHaveAttribute('aria-label', `Release ${latestVersion}`);
  const olderVersion = (await versions.nth(1).innerText()).trim();
  await versions.nth(1).click();
  await expect(browser.getByRole('article')).toHaveAttribute('aria-label', `Release ${olderVersion}`);
  await expect(versions.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(browser.getByRole('article').getByRole('heading').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('help-release-notes-browser.png') });
  await browser.getByRole('button', { name: 'Done' }).click();
  await expect(help).toBeFocused();
  await help.click();
  await menu.getByRole('button', { name: /All releases/ }).click();
  await expect(browser.getByRole('article')).toHaveAttribute('aria-label', `Release ${latestVersion}`);
  await page.keyboard.press('Escape');
  await expect(browser).toHaveCount(0);
  await expect(help).toBeFocused();
});
