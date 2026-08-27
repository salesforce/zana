/**
 * Thread secondary panel chrome: header toggle, Info, Hide, and New Tab.
 * Desktop-gated actions (browser webview, embedded terminal) are asserted
 * when those controls are present in the Electron shell.
 */
import { test, expect } from './fixtures/app.js';

test('thread secondary panel opens Info, hides, and shows New Tab actions', async ({ app }) => {
  const { window } = app;
  const current = window.url();
  if (/^https?:\/\//.test(current)) {
    await window.goto(`${new URL(current).origin}/threads/e2e-panel`);
  } else {
    await window.evaluate(() => {
      window.history.pushState({}, '', '/threads/e2e-panel');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  }
  await expect(window.getByTestId('thread-detail')).toBeVisible({ timeout: 15_000 });

  const show = window.getByTestId('thread-secondary-show');
  await expect(show).toBeVisible();
  await show.click();
  await expect(window.getByTestId('thread-secondary-panel')).toBeVisible();
  await expect(window.getByTestId('thread-info-environment')).toBeVisible();
  const directory = window.getByTestId('thread-info-directory');
  if (await directory.count()) {
    await expect(directory).toBeVisible();
  }

  await window.getByTestId('thread-secondary-hide').click();
  await expect(window.getByTestId('thread-secondary-show')).toBeVisible();
  await expect(window.getByTestId('thread-secondary-panel')).toHaveCount(0);

  await window.getByTestId('thread-secondary-show').click();
  await window.getByTestId('thread-secondary-new-tab').click();
  await expect(window.getByTestId('thread-new-tab-page')).toBeVisible();
  await expect(window.getByTestId('thread-new-tab-terminal')).toBeVisible();

  const explorer = window.getByTestId('thread-new-tab-explorer');
  if (await explorer.count()) {
    await explorer.click();
    await expect(window.getByTestId('thread-explorer-tab')).toBeVisible();
    await window.getByTestId('thread-secondary-new-tab').click();
    await expect(window.getByTestId('thread-new-tab-page')).toBeVisible();
  }

  const browser = window.getByTestId('thread-new-tab-browser');
  if (await browser.count()) {
    await browser.click();
    await expect(window.getByTestId('thread-browser-tab')).toBeVisible();
  }
});
