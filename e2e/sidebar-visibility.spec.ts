import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { test, expect, isAppRendererUrl } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test('sidebar hides, opens, restores, and reorders destinations with persisted preferences', async ({ app }, testInfo) => {
  const win = app.window;
  const rail = win.locator('.sidebar--global');
  const scheduler = rail.getByTestId('nav-scheduler');
  const more = rail.getByRole('button', { name: 'More', exact: true });
  await expect(scheduler).toBeVisible();
  await scheduler.click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Hide from sidebar', exact: true }).click();
  await expect(scheduler).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect.poll(() => win.evaluate(async () => (await window.cc.config.get()).sidebarNavHidden)).toEqual(['scheduler']);

  await win.reload();
  await expect(scheduler).toHaveCount(0);
  await expect(rail.getByLabel('Sidebar utilities').getByRole('button', { name: 'More', exact: true })).toBeVisible();
  await more.click();
  const menuBox = await win.getByRole('menu', { name: 'Sidebar navigation options' }).boundingBox();
  const moreBox = await more.boundingBox();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(moreBox!.y);
  await win.getByRole('menuitem', { name: 'Scheduler', exact: true }).click();
  await expect(win).toHaveURL(/\/scheduler$/);
  await expect(scheduler).toHaveCount(0);
  await more.click();
  await win.getByRole('menuitem', { name: 'Customize navigation', exact: true }).click();
  const customize = win.getByRole('dialog', { name: 'Customize navigation' });
  await customize.getByRole('checkbox', { name: 'Show Scheduler in sidebar' }).check();
  await expect(scheduler).toBeVisible();
  const handle = customize.getByRole('button', { name: 'Reorder Scheduler', exact: true });
  const target = customize.getByRole('button', { name: 'Reorder Agents', exact: true });
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull(); expect(to).not.toBeNull();
  await win.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await win.mouse.down();
  await win.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 15 });
  await win.mouse.up();
  await expect.poll(() => win.evaluate(async () => {
    const order = (await window.cc.config.get()).sidebarNavOrder ?? [];
    return order.includes('scheduler') && order.indexOf('scheduler') < order.indexOf('agents');
  })).toBe(true);

  // A destination may arrive while the popup is open (plugin discovery). Its
  // resized content must remain in the viewport, including the final action.
  await customize.evaluate((node) => {
    const spacer = document.createElement('div');
    spacer.style.height = '180px';
    spacer.dataset.visibilityTestSpacer = '';
    node.querySelector('.sidebar-customize-list')!.append(spacer);
  });
  await expect(customize.getByRole('button', { name: 'Restore defaults', exact: true })).toBeInViewport();
  await customize.locator('[data-visibility-test-spacer]').evaluate((node) => node.remove());

  for (const theme of ['light', 'dark'] as const) {
    await win.evaluate((value) => window.cc.config.set({ theme: value }), theme);
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(customize).toBeInViewport();
    await captureElectronScreenshot(app.electron, win, testInfo.outputPath(`sidebar-customize-${theme}.png`));
  }
  await customize.getByRole('button', { name: 'Done', exact: true }).click();
  await more.click();
  await win.getByRole('menuitem', { name: 'Customize navigation', exact: true }).click();
  await customize.getByRole('checkbox', { name: 'Show Scheduler in sidebar' }).uncheck();
  await customize.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => win.evaluate(async () => (await window.cc.config.get()).sidebarNavHidden)).toEqual(['scheduler']);
  await win.reload();
  await expect(scheduler).toHaveCount(0);
  await more.click();
  await win.getByRole('menuitem', { name: 'Customize navigation', exact: true }).click();
  await customize.getByRole('checkbox', { name: 'Show Scheduler in sidebar' }).check();
  await customize.getByRole('button', { name: 'Done', exact: true }).click();
  const ids = await rail.locator('[data-sidebar-nav-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-sidebar-nav-id')));
  expect(ids.indexOf('scheduler')).toBeLessThan(ids.indexOf('agents'));
  await more.click();
  await win.getByRole('menuitem', { name: 'Customize navigation', exact: true }).click();
  await customize.getByRole('button', { name: 'Restore defaults' }).click();
  await customize.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => win.evaluate(async () => (await window.cc.config.get()).sidebarNavHidden)).toEqual([]);
  await expect(rail.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
});

test('project visibility is separate and synchronizes to another project window', async ({ app }) => {
  const win = app.window;
  const projectName = 'Sidebar visibility';
  const path = join(app.home, projectName);
  mkdirSync(path);
  const projectId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);
  const heading = win.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await win.locator('.sidebar-projects').getByRole('button', { name: `Open ${projectName}`, exact: true }).click();
  const rail = win.locator('.project-scoped-nav');
  await rail.getByTestId('project-nav-scheduler').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Hide from sidebar', exact: true }).click();
  await expect(rail.getByTestId('project-nav-scheduler')).toHaveCount(0);
  await expect.poll(() => win.evaluate(async () => (await window.cc.config.get()).projectSidebarNavHidden)).toEqual(['scheduler']);
  await win.evaluate((id) => window.cc.windows.openProject(id), projectId);
  let other: typeof win | undefined;
  await expect.poll(() => {
    other = app.electron.windows().find((page) => page !== win && isAppRendererUrl(page.url()));
    return Boolean(other);
  }).toBe(true);
  await expect(other!.locator('.project-scoped-nav')).toBeVisible();
  await expect(other!.getByTestId('project-nav-scheduler')).toHaveCount(0);
  await other!.getByRole('button', { name: 'More', exact: true }).click();
  await other!.getByRole('menuitem', { name: 'Customize navigation', exact: true }).click();
  await other!.getByRole('checkbox', { name: 'Show Scheduler in sidebar' }).check();
  await expect(rail.getByTestId('project-nav-scheduler')).toBeVisible();
  await other!.getByRole('button', { name: 'Done', exact: true }).click();
  await other!.close();
  await rail.getByRole('button', { name: 'Back to all projects', exact: true }).click();
  await expect(win.locator('.sidebar--global').getByTestId('nav-scheduler')).toBeVisible();
  expect((await win.evaluate(() => window.cc.config.get())).sidebarNavHidden ?? []).toEqual([]);
});

test('mobile customization stays above the drawer and Escape closes the popup first', async ({ app }) => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const paired = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Sidebar visibility' } });
    const { credential } = await paired.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    await page.goto(`${serverUrl}/agents`);
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await drawer.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(drawer.getByRole('searchbox', { name: 'Search plugins and tools' })).toBeVisible();
    await drawer.getByRole('button', { name: 'More', exact: true }).click();
    await drawer.getByRole('menuitem', { name: 'Customize navigation', exact: true }).click();
    const popup = drawer.getByRole('dialog', { name: 'Customize navigation', exact: true });
    const checkbox = popup.getByRole('checkbox', { name: 'Show Scheduler in sidebar' });
    await expect(popup).toBeVisible();
    await expect(popup).toBeInViewport();
    await checkbox.uncheck();
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'More', exact: true }).click();
    await drawer.getByRole('menuitem', { name: 'Scheduler', exact: true }).click();
    await expect(page).toHaveURL(`${serverUrl}/scheduler`);
    await expect(drawer).toHaveCount(0);
    await expect.poll(() => app.window.evaluate(async () => (await window.cc.config.get()).sidebarNavHidden)).toEqual(['scheduler']);
  } finally {
    await browser.close();
    await gateway.close();
  }
});
