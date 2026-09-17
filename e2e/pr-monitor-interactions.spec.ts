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
  await win.screenshot({ path: testInfo.outputPath('pr-details.png') });
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
});
