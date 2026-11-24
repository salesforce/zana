/**
 * Three shell fixes, driven through the built app:
 * - the macOS Window menu is the app's windowsMenu (AppKit lists open windows);
 * - a per-project window has Back, which shows all projects in the same window;
 * - in the prompt composer Shift+Enter adds a bullet and leaves an empty one.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true }
});

test('Window menu carries the windows role so macOS lists open windows', async ({ app }) => {
  const menu = await app.electron.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.items.find((entry) => entry.label === 'Window');
    return item ? { role: item.role, nested: item.submenu?.items.map((entry) => entry.role ?? entry.label) ?? [] } : null;
  });
  const fileItems = await app.electron.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.items.find(entry => entry.label === 'File')?.submenu?.items.map(entry => entry.label));
  expect(fileItems).toEqual(expect.arrayContaining(['New Window', 'New Tab', 'Reopen Closed Tab']));
  expect(fileItems).not.toContain('New Claude Tab');
  expect(menu).not.toBeNull();
  expect(String(menu!.role).toLowerCase()).toBe('window');
  expect(menu!.nested.map((role) => String(role).toLowerCase())).not.toContain('window');
  const created = app.electron.waitForEvent('window');
  await app.electron.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!.items.find(entry => entry.label === 'File')!.submenu!.items
      .find(entry => entry.label === 'New Window')!;
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  await expect((await created).locator('.sidebar--global')).toBeVisible();
});

test('a project window has Back, which shows all projects in the same window', async ({ app }, testInfo) => {
  const { window, home, electron } = app;
  await dismissConsentOverlays(window);
  const path = join(home, 'Back Target');
  mkdirSync(path);
  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);

  const title = 'Keep this chat tab open';
  await window.evaluate(async ({ projectId, title }) => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, title, input: title, providerId: 'fake' }) });
    if (!response.ok) throw new Error(await response.text());
  }, { projectId, title });

  await window.getByTestId('nav-inbox').click();
  const originalUrl = window.url();
  expect(await window.evaluate(() => window.cc.windows.openNew('unknown-project-id'))).toBe(false);
  expect(await window.evaluate(() => window.cc.windows.leaveProject('projects'))).toBe(false);
  async function newWindow(from: Page) {
    const next = electron.waitForEvent('window', { predicate: page => page !== from });
    await from.getByRole('button', { name: 'New Window', exact: true }).click();
    const page = await next;
    await dismissConsentOverlays(page);
    return page;
  }

  const global = await newWindow(window);
  await expect(global.locator('.sidebar--global')).toBeVisible();
  await global.getByRole('button', { name: 'Open Back Target', exact: true }).click();
  const scoped = await newWindow(global);
  await expect(scoped).toHaveURL(new RegExp(`projectId=${projectId}`));
  const another = await newWindow(scoped);
  await expect(another.locator('.project-scoped-nav')).toBeVisible();
  await another.locator('.project-scoped-nav').getByRole('link', { name: 'Settings' }).click();
  await another.getByTestId('project-nav-back').click();
  await expect(another).toHaveURL(/\/settings(?:\/[^?]*)?$/);
  await expect(scoped.locator('.project-scoped-nav')).toBeVisible();
  const tab = scoped.getByTestId('application-tabs').getByRole('tab', { name: new RegExp(title) });
  await scoped.getByTestId('project-thread-row').filter({ hasText: title }).click();
  await expect(tab).toBeVisible();
  await scoped.getByTestId('project-nav-back').click();
  await expect(scoped).toHaveURL(/\/agents$/);
  await expect(scoped.locator('.sidebar--global')).toBeVisible();
  await expect(tab).toBeVisible();
  await scoped.reload();
  await expect(tab).toBeVisible();
  await expect(scoped.locator('.sidebar--global')).toBeVisible();
  await expect(global.locator('.project-scoped-nav')).toBeVisible();
  await expect(window).toHaveURL(originalUrl);
  await window.evaluate(() => window.cc.menubar.open('scheduler'));
  await expect(window).toHaveURL(/\/scheduler$/);
  await expect(scoped).toHaveURL(/\/agents$/);
  await expect(another).toHaveURL(/\/settings(?:\/[^?]*)?$/);
  await tab.click();
  await expect(scoped.getByTestId('thread-detail')).toContainText(title);
  await scoped.screenshot({ path: testInfo.outputPath('project-window-back.png') });
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
