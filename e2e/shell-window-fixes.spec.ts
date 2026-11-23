/**
 * Three shell fixes, driven through the built app:
 * - the macOS Window menu is the app's windowsMenu (AppKit lists open windows);
 * - a per-project window has Back, which shows all projects in the main window;
 * - in the prompt composer Shift+Enter adds a bullet and leaves an empty one.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, dismissConsentOverlays, isAppRendererUrl } from './fixtures/app.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true }
});

test('Window menu carries the windows role so macOS lists open windows', async ({ app }) => {
  const menu = await app.electron.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.items.find((entry) => entry.label === 'Window');
    return item ? { role: item.role, nested: item.submenu?.items.map((entry) => entry.role ?? entry.label) ?? [] } : null;
  });
  expect(menu).not.toBeNull();
  expect(String(menu!.role).toLowerCase()).toBe('window');
  expect(menu!.nested.map((role) => String(role).toLowerCase())).not.toContain('window');
});

test('a project window has Back, which shows all projects in the main window', async ({ app }, testInfo) => {
  const { window, home, electron } = app;
  await dismissConsentOverlays(window);
  const path = join(home, 'Back Target');
  mkdirSync(path);
  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);

  await window.evaluate((id) => window.cc.windows.openProject(id), projectId);
  let projectWindow: Page | undefined;
  await expect.poll(() => {
    projectWindow = electron.windows().find((page) => page !== window && isAppRendererUrl(page.url()));
    return Boolean(projectWindow);
  }, { timeout: 20_000 }).toBe(true);
  const scoped = projectWindow!;
  await expect(scoped.locator('.project-scoped-nav')).toBeVisible({ timeout: 30_000 });
  const back = scoped.getByTestId('project-nav-back');
  await expect(back).toBeVisible();
  await scoped.screenshot({ path: testInfo.outputPath('project-window-back.png') });

  await back.click();
  await expect(window).toHaveURL(/\/agents$/);
  // The project window stays locked to its project.
  await expect(scoped).toHaveURL(new RegExp(`projectId=${projectId}`));
  await expect(scoped.locator('.project-scoped-nav')).toBeVisible();
});

test('Shift+Enter adds a bullet in the prompt and ends the list from an empty one', async ({ app }, testInfo) => {
  const { window, home } = app;
  await dismissConsentOverlays(window);
  const path = join(home, 'Bullet Target');
  mkdirSync(path);
  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);
  await window.evaluate((id) => {
    history.pushState({}, '', `/projects/${encodeURIComponent(id)}/threads/new`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  const editor = window.getByTestId('new-thread-view').locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();

  await window.keyboard.type('- first');
  await window.keyboard.press('Shift+Enter');
  await window.keyboard.type('second');
  await expect(editor.locator('ul > li')).toHaveCount(2);
  await expect(editor.locator('ul > li').nth(1)).toHaveText('second');

  await window.keyboard.press('Shift+Enter');
  await window.keyboard.press('Shift+Enter');
  await window.keyboard.type('after');
  await expect(editor.locator('ul > li')).toHaveCount(2);
  await expect(editor.locator(':scope > p').last()).toHaveText('after');
  // The prompt was never sent by any of those keys.
  await expect(window).toHaveURL(/\/threads\/new/);
  await window.screenshot({ path: testInfo.outputPath('prompt-bullets.png') });
});
