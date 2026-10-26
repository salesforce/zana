import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, dismissConsentOverlays, isAppRendererUrl } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true }, isolateBundledCatalog: true });
test.setTimeout(180_000);

async function route(page: Page, path: string) {
  await page.evaluate(next => { history.pushState({}, '', next); dispatchEvent(new PopStateEvent('popstate')); }, path);
}

test('thread tabs: default, project context, drafts, close safety, settings, reload and scoped windows', async ({ app }, testInfo) => {
  const { window: page, electron, home } = app;
  await dismissConsentOverlays(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const paths = ['Interface', 'Website'].map(name => join(home, name));
  paths.forEach(path => mkdirSync(path));
  const threads = await page.evaluate(async (roots) => {
    const result: Array<{ id: string; projectId: string }> = [];
    for (const [index, root] of roots.entries()) {
      const project = await window.cc.projects.add(root);
      if (!project.ok) throw new Error(project.message);
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title: index === 0 ? 'Navigation experiment' : 'Landing page', input: 'delay:60000 tab safety probe' }) });
      if (!response.ok) throw new Error(await response.text());
      result.push({ id: (await response.json()).thread.id, projectId: project.value.id });
    }
    return result;
  }, paths);
  const [first, second] = threads;
  const strip = page.getByTestId('titlebar-thread-tabs');
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('tab')).toHaveCount(0);
  await route(page, '/agents');
  await page.locator('.agent-card[data-kind="thread"]').filter({ hasText: 'Navigation experiment' }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${first!.id}$`));
  await expect(page.getByTestId('thread-modal')).toHaveCount(0);
  const detail = page.getByTestId('thread-detail').first();
  await expect(detail).toBeVisible();
  const input = detail.getByTestId('thread-command-input');
  await input.fill('Keep my unsent navigation notes');
  await route(page, `/threads/${second!.id}`);
  await expect(strip.getByRole('tab')).toHaveCount(2);
  await expect(strip.getByRole('tab', { name: /Navigation experiment/ })).toContainText('Interface');
  await expect(strip.getByRole('tab', { name: /Landing page/ })).toContainText('Website');
  await strip.getByRole('tab', { name: /Navigation experiment/ }).click();
  await expect(input).toHaveText('Keep my unsent navigation notes');
  await expect(strip.getByRole('tab', { name: /Navigation experiment/ })).toHaveAttribute('aria-selected', 'true');

  await strip.getByRole('button', { name: 'Close tab: Navigation experiment', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${second!.id}$`));
  await expect(strip.getByRole('tab')).toHaveCount(1);
  const stillRunning = await page.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, first!.id);
  expect(stillRunning.archivedAt).toBeNull();
  expect(stillRunning.status).toBe('active');
  await strip.getByLabel('All open threads').click();
  await strip.getByRole('button', { name: 'Reopen closed tab' }).click();
  await expect(input).toHaveText('Keep my unsent navigation notes');

  // Native titlebar controls remain clear in both themes.
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(value => window.cc.config.set({ theme: value }), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const geometry = await page.evaluate(() => {
      const tabs = document.querySelector('.titlebar-threads')!.getBoundingClientRect();
      const history = document.querySelector('.sidebar-trigger-overlay')?.getBoundingClientRect();
      const help = document.querySelector('.titlebar-help')!.getBoundingClientRect();
      return { left: tabs.left, right: tabs.right, historyRight: history?.right ?? 0, helpLeft: help.left };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.historyRight);
    expect(geometry.right).toBeLessThanOrEqual(geometry.helpLeft);
    await captureElectronScreenshot(electron, page, testInfo.outputPath(`thread-tabs-${theme}.png`));
  }

  await route(page, '/settings/experimental');
  const toggle = page.getByRole('switch', { name: 'Thread tabs', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(strip).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await window.cc.config.get()).threadTabsEnabled)).toBe(false);
  await page.reload();
  await expect(strip).toHaveCount(0);
  await route(page, '/settings/experimental');
  // Disabling the experiment restores the existing inspector click behavior.
  await route(page, '/agents');
  await page.locator('.agent-card[data-kind="thread"]').filter({ hasText: 'Navigation experiment' }).click();
  await expect(page.getByTestId('thread-modal')).toBeVisible();
  await expect(page).toHaveURL(/\/agents$/);
  await page.getByTestId('thread-modal-close').click();
  await route(page, '/settings/experimental');
  await page.getByRole('switch', { name: 'Thread tabs', exact: true }).click();
  await expect(strip.getByRole('tab')).toHaveCount(2);
  await strip.getByRole('tab', { name: /Landing page/ }).click();
  await page.reload();
  await expect(strip.getByRole('tab')).toHaveCount(2);

  // A dedicated project window has an independent, project-scoped strip.
  await page.evaluate(id => window.cc.windows.openProject(id), first!.projectId);
  let projectWindow: Page | undefined;
  await expect.poll(() => {
    projectWindow = electron.windows().find(candidate => candidate !== page && isAppRendererUrl(candidate.url()));
    return Boolean(projectWindow);
  }).toBe(true);
  const scoped = projectWindow!;
  // Wait for the new window's boot-time route restoration before navigating.
  await expect(scoped.getByTestId('titlebar-thread-tabs')).toBeVisible();
  await expect(scoped.getByTestId('project-nav-agents')).toBeVisible();
  await route(scoped, `/projects/${first!.projectId}/threads/${first!.id}`);
  const scopedStrip = scoped.getByTestId('titlebar-thread-tabs');
  await expect(scopedStrip.getByRole('tab')).toHaveCount(1);
  await expect(scopedStrip).toContainText('Interface');
  await expect(scopedStrip).not.toContainText('Website');
  await scopedStrip.getByRole('button', { name: 'New thread', exact: true }).click();
  await expect(scoped).toHaveURL(new RegExp(`/projects/${first!.projectId}/threads/new`));
  await expect(strip.getByRole('tab')).toHaveCount(2);

  // Opening a new tab beyond the visible strip scrolls it into view. Overflow
  // stays searchable without overlapping native window or utility controls.
  await electron.evaluate(({ BrowserWindow }, url) => {
    BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)!.setSize(980, 800);
  }, page.url());
  const overflowIds = await page.evaluate(async projectId => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, providerId: 'fake', title: `Overflow ${i}`, input: 'Hello' }) });
      if (!response.ok) throw new Error(await response.text());
      ids.push((await response.json()).thread.id);
    }
    return ids;
  }, first!.projectId);
  for (const id of overflowIds) await route(page, `/threads/${id}`);
  await expect(strip.getByRole('tab', { name: /Overflow 3/ })).toBeInViewport();
  await strip.getByLabel('All open threads').click();
  await expect(strip.locator('.titlebar-threads-popover')).toBeInViewport();
  await strip.getByRole('textbox', { name: 'Find an open thread' }).fill('Landing');
  await strip.locator('.titlebar-threads-results').getByRole('button', { name: /Landing page/ }).click();
  await expect(strip.getByRole('tab', { name: /Landing page/ })).toBeInViewport();
  await captureElectronScreenshot(electron, page, testInfo.outputPath('thread-tabs-narrow.png'));
  expect(errors).toEqual([]);
});

test('the thread switcher appears above native browser content and restores the same page', async ({ app }) => {
  const { window: page, electron } = app;
  await dismissConsentOverlays(page);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<h1>Thread tabs browser probe</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local server port');
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    const id = await page.evaluate(async () => {
      const { projects } = await (await fetch('/api/v1/projects')).json();
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: projects[0].id, providerId: 'fake', title: 'Browser tab', input: 'Hello' }) });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).thread.id;
    });
    await route(page, `/threads/${id}`);
    const detail = page.getByTestId('thread-detail');
    await expect(detail).toBeVisible();
    if (!(await detail.getByTestId('thread-secondary-panel').isVisible())) await detail.getByTestId('thread-secondary-show').click();
    await openThreadToolLauncher(detail);
    await detail.getByTestId('thread-new-tab-browser').click();
    const location = detail.getByTestId('thread-browser-address');
    await location.fill(url);
    await location.press('Enter');
    const native = await electron.browserWindow(page);
    const nativeState = () => native.evaluate(async (win, targetUrl) => {
      const view = win.contentView.children.find(child => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === targetUrl) as Electron.WebContentsView | undefined;
      if (!view) return null;
      const marker = await view.webContents.executeJavaScript('window.threadTabProbe ??= Math.random()');
      return { visible: view.getVisible(), marker };
    }, url);
    await expect.poll(nativeState).toMatchObject({ visible: true });
    const before = await nativeState();
    const strip = page.getByTestId('titlebar-thread-tabs');
    await strip.getByLabel('All open threads').click();
    await expect(strip.getByRole('textbox', { name: 'Find an open thread' })).toBeVisible();
    await expect.poll(nativeState).toMatchObject({ visible: false, marker: before!.marker });
    await page.keyboard.press('Escape');
    await expect.poll(nativeState).toMatchObject({ visible: true, marker: before!.marker });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
