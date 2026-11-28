import { mkdirSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { test as base, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import { DEFAULT_PR_MONITOR_SETTINGS, type MonitoredPr } from '../plugins/pr-monitor/lib/types.js';

// Real bundled plugin + storage + paired HTTP renderer. GitHub stays offline.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "Offline mobile fixture" >&2\nexit 1\n', { mode: 0o700 });
    await use({ PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, GH_CONFIG_DIR: join(home, 'gh'), ZCC_FAKE_PROVIDER: '1' });
  },
});
test.use({ initialConfig: { sponsorPromptDismissed: true } });

test('PR Monitor mobile list, filters and full-screen detail preserve the desktop board', async ({ app }, testInfo) => {
  test.setTimeout(120_000);
  const win = app.window;
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'pr-monitor' }))).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'pr-monitor')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const now = Date.now();
  const prs: MonitoredPr[] = (['failed', 'pending', 'review-required', 'green'] as const).map((status, i) => ({
    url: `https://github.com/acme/mobile-review/pull/${40 + i}`, repo: 'acme/mobile-review', number: 40 + i,
    title: i === 0 ? 'Keep pull request details comfortable to read on a small screen' : `Mobile layout for ${status}`,
    status, checks: [{ name: 'Mobile interaction tests', state: i === 0 ? 'FAILURE' : 'SUCCESS' }],
    body: 'PR details should use the whole screen and always have an easy return path. '.repeat(20),
    headRefName: 'fix/mobile-pr-monitor', baseRefName: 'main', author: { login: 'alex', name: 'Alex' },
    addedAt: now, lastChecked: now, lastStatusChange: now, lastSeenAt: 0, source: 'manual',
  }));
  await win.evaluate(async ({ prs, settings }) => {
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'settings', value: settings });
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'prs', value: Object.fromEntries(prs.map(pr => [pr.url, pr])) });
  }, { prs, settings: { ...DEFAULT_PR_MONITOR_SETTINGS, autoSyncEnabled: false, authorDiscovered: true, orgDiscovered: true } });
  await win.getByRole('button', { name: /^PR Monitor/ }).click();
  await expect(win.locator('.prm-board-card')).toHaveCount(4);
  await expect(win.locator('.prm-mobile-list')).toHaveCount(0);

  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(win.url()).origin, publicUrl: url, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${url}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'PR Monitor mobile test' } });
    const credential = await pair.json();
    expect((await context.request.post(`${url}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(url);
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await drawer.getByRole('button', { name: 'Tools', exact: true }).click();
    // The HTTP client's initial plugin catalogue hydrates separately from the desktop.
    await expect(drawer.getByText('PR Monitor', { exact: true })).toBeVisible({ timeout: 30_000 });
    await drawer.getByText('PR Monitor', { exact: true }).click();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('.prm-mobile-card')).toHaveCount(4);
      await expect(page.locator('.prm-board')).toHaveCount(0);
      expect((await page.locator('.prm-header').boundingBox())!.height).toBeLessThan(80);
      expect(await page.locator('.prm-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-pr-list.png`) });
      const filtersTrigger = page.getByRole('button', { name: 'Filters', exact: true });
      await filtersTrigger.click();
      const filters = page.getByRole('dialog', { name: 'Filter pull requests' });
      expect((await filters.boundingBox())!.width).toBe(width);
      expect((await filters.boundingBox())!.height).toBe(844);
      await filters.getByLabel('Status', { exact: true }).selectOption('failed');
      await filters.getByLabel('Sort by', { exact: true }).selectOption('favorites');
      await expect(filters.getByLabel('Order')).toBeDisabled();
      await filters.getByLabel('Sort by', { exact: true }).selectOption('status');
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-pr-filters.png`) });
      await filters.getByRole('button', { name: 'Show 1 pull request', exact: true }).click();
      await expect(filtersTrigger).toBeFocused();
      await expect(page.locator('.prm-mobile-card')).toHaveCount(1);
      const card = page.locator('.prm-mobile-card').first();
      const bounds = (await card.boundingBox())!;
      expect(bounds.width).toBeGreaterThan(width - 40);
      await card.click();
      const detail = page.getByRole('dialog');
      expect((await detail.boundingBox())!.width).toBe(width);
      expect((await detail.boundingBox())!.height).toBe(844);
      expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await expect(detail.getByRole('button', { name: 'Close PR details' })).toBeVisible();
      await expect(detail.getByText(prs[0].title, { exact: true })).toBeVisible();
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-pr-details.png`) });
      await detail.getByRole('button', { name: 'Close PR details' }).click();
      await expect(card).toBeFocused();
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await page.getByRole('searchbox', { name: 'Search PRs' }).fill('not-a-matching-pr');
      await expect(page.getByText('No PRs match the current filter')).toBeVisible();
      await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'PR Monitor actions' }).click();
    const actions = page.getByRole('dialog', { name: 'PR Monitor actions' });
    await expect(actions.getByRole('button', { name: 'Add PR', exact: true })).toBeVisible();
    await actions.getByRole('button', { name: 'Open Sync & Filter picker' }).click();
    const repoFilter = page.getByRole('menu', { name: 'Sync & Filter' });
    expect((await repoFilter.boundingBox())!.width).toBe(390);
    await expect(repoFilter.getByRole('menuitemcheckbox', { name: 'All repositories' })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('390-pr-repositories.png') });
    await repoFilter.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'PR Monitor actions' })).toBeFocused();
    await page.getByRole('button', { name: 'PR Monitor actions' }).click();
    await actions.getByRole('button', { name: 'Add PR', exact: true }).click();
    await expect(actions).toHaveCount(0);
    const add = page.getByRole('dialog');
    expect((await add.boundingBox())!.width).toBe(390);
    await add.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'PR Monitor actions' }).click();
    await actions.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(actions).toHaveCount(0);
    await expect(page.locator('.prm-settings-body')).toBeVisible();
    expect(await page.locator('.prm-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('390-pr-settings.png') });
    await page.getByRole('button', { name: 'PRs', exact: true }).click();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('390-pr-dark.png') });
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filter pull requests' }).getByLabel('Status', { exact: true }).selectOption('failed');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.prm-board-card')).toHaveCount(4);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.prm-mobile-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('.prm-mobile-card')).toHaveCount(4);
    await expect(page.getByRole('heading', { name: 'Renderer crashed' })).toHaveCount(0);
    await expect(win.locator('.prm-board-card')).toHaveCount(4);
  } finally { await browser.close(); await gateway.close(); }
});
