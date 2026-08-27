/**
 * Thread secondary panel chrome: header toggle, Info, Hide, New Tab, and
 * in-app browser. Nested `/threads/:id` URLs cannot use `page.goto` against the
 * built renderer: index.html loads scripts with relative `./assets/...` URLs,
 * so a full navigation to `/threads/x` 404s the bundle. Drive the SPA from `/`
 * with history + popstate instead.
 */
import { test, expect } from './fixtures/app.js';

test('thread secondary panel opens Info, hides, and shows New Tab actions', async ({ app }) => {
  const { window } = app;
  const crashed = window.getByRole('heading', { name: 'Renderer crashed' });
  if (await crashed.count()) {
    throw new Error(`renderer crash: ${await window.locator('pre').innerText()}`);
  }
  await expect(window.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 20_000 });
  await window.evaluate(() => {
    window.history.pushState({}, '', '/threads/e2e-panel');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
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
  await expect(window.getByTestId('thread-info-storage')).toBeVisible();

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
  await expect(browser).toBeVisible();
  await browser.click();
  await expect(window.getByTestId('thread-browser-tab')).toBeVisible();
  await expect(window.getByTestId('thread-browser-tab')).not.toContainText('https://example.com');
  const address = window.getByTestId('thread-browser-address');
  await expect(address).toBeVisible();
  await expect(window.getByTestId('browser-tab-nav-bar')).toBeVisible();
  await expect(window.getByTestId('thread-browser-newtab')).toBeVisible();
  await address.fill('github.com');
  await address.press('Enter');
  await expect(address).toHaveValue(/github\.com/);
  await window.evaluate(() => {
    window.dispatchEvent(new CustomEvent('zcc:open-in-app-browser', {
      detail: { url: 'https://example.com/docs' }
    }));
  });
  await expect(window.getByTestId('thread-browser-tab')).toBeVisible();
});
