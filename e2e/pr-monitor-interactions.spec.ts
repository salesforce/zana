import { mkdirSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import { DEFAULT_PR_MONITOR_SETTINGS, type MonitoredPr } from '../plugins/pr-monitor/lib/types.js';

// Use the real plugin/IPC/storage and built renderer; gh stays offline so this
// interaction regression never touches the developer's GitHub account.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "Offline interaction fixture" >&2\nexit 1\n', { mode: 0o700 });
    await use({ PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, GH_CONFIG_DIR: join(home, 'gh') });
  },
});

test('PR Monitor mouse clicks open details and nested actions keep their own focus', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const win = app.window;
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'pr-monitor' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'pr-monitor')?.status
  ), { timeout: 30_000 }).toMatch(/running|needs-configuration/);

  const projectPath = join(home, 'pr-fixture-project');
  mkdirSync(projectPath, { recursive: true });
  const projectId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectPath);
  const now = Date.now();
  const pr: MonitoredPr = {
    url: 'https://github.com/acme/long-repository-name/pull/42', repo: 'acme/long-repository-name', number: 42,
    title: 'Keep PR card clicks and nested controls working', status: 'failed', checks: [{ name: 'Integration tests', state: 'FAILURE' }],
    mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
    body: 'Details remain readable. '.repeat(100), headRefName: 'fix/pr-card-clicks', baseRefName: 'main',
    addedAt: now, lastChecked: now, lastStatusChange: now, lastSeenAt: 0, source: 'manual',
  };
  await win.evaluate(async ({ pr, settings }) => {
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'settings', value: settings });
    const prs = [pr, ...(['green', 'pending', 'review-required'] as const).map((status, i) => ({
      ...pr, url: pr.url.replace('/42', `/${43 + i}`), number: 43 + i, status,
      title: `Review layout for ${status}`, lastSeenAt: Date.now(), body: 'A compact description.',
    }))];
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'prs', value: Object.fromEntries(prs.map((p) => [p.url, p])) });
  }, { pr, settings: { ...DEFAULT_PR_MONITOR_SETTINGS, autoSyncEnabled: false, authorDiscovered: true, orgDiscovered: true } });
  const nav = win.getByRole('button', { name: /^PR Monitor/ });
  await expect(nav).toBeVisible();
  const support = win.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible()) await support.getByRole('button', { name: 'Dismiss' }).click();
  await nav.click();

  const card = win.locator('.prm-board-card').filter({ hasText: pr.title });
  await expect(card).toBeVisible();
  await card.locator('.prm-board-card-title').click();
  const dialog = win.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog.getByText('Description preview', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Read full description on GitHub' })).toBeAttached();
  const bounds = await dialog.boundingBox();
  const viewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  await expect.poll(() => win.evaluate(async () => {
    const prs = await window.cc.pluginApps.callRpc('pr-monitor', 'listPrs') as MonitoredPr[];
    return prs[0].lastSeenAt;
  })).toBeGreaterThan(0);

  const close = dialog.getByRole('button', { name: 'Close PR details' });
  await win.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await win.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Dismiss', exact: true })).toBeFocused();
  await win.keyboard.press('Tab');
  await expect(close).toBeFocused();

  const project = dialog.getByRole('button', { name: /Not associated with a project/ });
  await project.click();
  const picker = win.getByRole('menu', { name: 'Associate a project' });
  await expect(picker).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(project).toBeFocused();
  await project.click();
  await picker.getByRole('menuitem', { name: 'pr-fixture-project', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Associated with pr-fixture-project/ })).toBeVisible();
  await expect.poll(() => win.evaluate(async () => {
    const prs = await window.cc.pluginApps.callRpc('pr-monitor', 'listPrs') as MonitoredPr[];
    return prs[0].projectId;
  })).toBe(projectId);
  await win.evaluate((id) => window.cc.projects.update(id, { name: 'Renamed PR project' }), projectId);
  const renamedProject = dialog.getByRole('button', { name: /Associated with Renamed PR project/ });
  await expect(renamedProject).toBeVisible({ timeout: 10_000 });
  const addedPath = join(home, 'added-while-monitor-open');
  mkdirSync(addedPath, { recursive: true });
  await win.evaluate((path) => window.cc.projects.add(path), addedPath);
  await renamedProject.click();
  await expect(picker.getByRole('menuitem', { name: 'added-while-monitor-open', exact: true })).toBeVisible({ timeout: 10_000 });
  await win.keyboard.press('Escape');
  await dialog.locator('.prm-modal-body').evaluate((element) => { element.scrollTop = 0; });
  await expect(dialog.getByRole('button', { name: 'Expand preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Expand preview' }).click();
  await expect(dialog.getByRole('button', { name: 'Collapse preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Collapse preview' }).click();
  for (const theme of ['dark', 'light']) {
    await win.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(30, 30, 30)');
    await win.screenshot({ path: testInfo.outputPath(`pr-details-${theme}.png`) });
  }
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await win.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(card).toBeFocused();

  const favorite = card.getByRole('button', { name: 'Favorite', exact: true });
  await favorite.focus();
  await win.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'Unfavorite', exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  const select = card.getByRole('checkbox');
  await select.focus();
  await win.keyboard.press('Space');
  await expect(select).toBeChecked();
  await expect(dialog).toBeHidden();
  await select.click();
  await card.locator('.prm-board-card-title').click();
  await expect(dialog).toBeVisible();
  await close.click();
  await expect(dialog).toBeHidden();
  await win.screenshot({ path: testInfo.outputPath('pr-board.png') });
  const add = win.getByRole('button', { name: 'Add PR', exact: true });
  await add.click();
  const addDialog = win.getByRole('dialog', { name: 'Add PR' });
  await expect(addDialog).toBeFocused();
  await expect(addDialog.getByText('No connected repositories.', { exact: false })).toBeVisible();
  await expect(addDialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await win.keyboard.press('Shift+Tab');
  await expect(addDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await win.screenshot({ path: testInfo.outputPath('pr-add-empty.png') });
  await win.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await card.locator('.prm-board-card-title').click();
  await app.electron.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().startsWith('devtools:'))!;
    main.webContents.setZoomFactor(1);
    main.setMinimumSize(480, 360);
    main.setContentSize(620, 520);
  });
  await expect.poll(() => win.evaluate(() => innerWidth)).toBe(620);
  await expect(close).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Open on GitHub', exact: true })).toBeVisible();
  await expect(dialog.locator('.prm-modal-body')).toHaveCSS('overflow-x', 'hidden');
  await win.screenshot({ path: testInfo.outputPath('pr-details-narrow.png') });
  await win.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});


test('PR Monitor settings dialogs fit the window and share keyboard, theme, and scroll behavior', async ({ app }, testInfo) => {
  test.setTimeout(150_000);
  const win = app.window;
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'pr-monitor' }))).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((plugin) => plugin.id === 'pr-monitor')?.status
  )).toMatch(/running|needs-configuration/);
  await win.evaluate(async (defaults) => {
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'settings', value: {
      ...defaults, autoSyncEnabled: false, authorDiscovered: true, orgDiscovered: true,
      organizations: [{ host: 'github.com', login: 'acme', apiBaseUrl: 'https://api.github.com' }],
      repositories: [{ host: 'github.com', owner: 'acme', repo: 'long-repository-name', orgLogin: 'acme', active: true, createdAt: Date.now() }],
    } });
  }, DEFAULT_PR_MONITOR_SETTINGS);
  const support = win.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible()) await support.getByRole('button', { name: 'Dismiss' }).click();
  await win.getByRole('button', { name: /^PR Monitor/ }).click();
  await win.locator('.prm-header').getByRole('button', { name: 'Settings', exact: true }).click();
  await win.locator('.prm-settings-nav').getByRole('button', { name: 'Repositories' }).click();
  await expect(win.locator('.prm-repo-card')).toBeVisible();

  const edit = win.getByRole('button', { name: 'Edit Repository', exact: true });
  await edit.click();
  const dialog = win.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName(/Repository Settings/);
  await expect(dialog).toBeFocused();
  // A real narrow Electron window exposes both clipping and host grid regressions.
  await app.electron.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().startsWith('devtools:'))!;
    main.webContents.setZoomFactor(1);
    main.setMinimumSize(480, 360);
    main.setContentSize(620, 520);
  });
  await expect.poll(() => win.evaluate(() => innerWidth)).toBe(620);
  for (const theme of ['dark', 'light']) {
    await win.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    for (const section of ['General', 'Status', 'Notifications']) {
      await dialog.getByRole('button', { name: section, exact: true }).click();
      await expect(dialog.getByRole('button', { name: section, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(dialog.getByRole('button', { name: 'Save Settings', exact: true })).toBeVisible();
      const geometry = await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const body = element.querySelector('.prm-modal-body')!;
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight,
          overflow: element.scrollWidth > element.clientWidth, scroll: getComputedStyle(body).overflowY };
      });
      expect(geometry.x).toBeGreaterThanOrEqual(0);
      expect(geometry.y).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.width);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
      expect(geometry.overflow).toBe(false);
      expect(geometry.scroll).toBe('auto');
      await win.screenshot({ path: testInfo.outputPath(`repo-${section.toLowerCase()}-${theme}.png`) });
    }
  }
  await win.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await app.electron.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().startsWith('devtools:'))!.setContentSize(1200, 850);
  });
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await win.screenshot({ path: testInfo.outputPath('pr-repositories.png') });
  for (const [trigger, title] of [
    ['Add repository manually', 'Add repository'],
    ['Suggested for you', 'Suggested for you'],
    ['Browse Repositories', 'Browse repositories'],
    ['Test Connection', 'Connection Test Results'],
    ['Delete Repository', 'Delete repository?'],
  ]) {
    const button = win.getByRole('button', { name: trigger, exact: true });
    await button.click();
    await expect(dialog).toHaveAccessibleName(new RegExp(title.replace('?', '\\?'), 'i'));
    await expect(dialog).toBeFocused();
    await expect(dialog.locator('.prm-loading')).toHaveCount(0);
    await win.screenshot({ path: testInfo.outputPath(`pr-${trigger.toLowerCase().replaceAll(' ', '-')}.png`) });
    await win.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  }
  await win.locator('.prm-settings-nav').getByRole('button', { name: 'Organizations' }).click();
  await win.getByRole('button', { name: /How to add/ }).click();
  await expect(dialog).toHaveAccessibleName('Adding & removing organizations');
  await dialog.getByRole('button', { name: 'Got it' }).click();
  await win.getByRole('button', { name: 'Delete organization', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Delete organization?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});
