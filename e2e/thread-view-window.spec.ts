import { test, expect } from './fixtures/app.js';
import type { ElectronApplication, Page } from '@playwright/test';

// A thread moved into its own window: real BrowserWindow, real IPC, real
// product server. The fake provider keeps the thread running without network.
test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(120_000);

const isThreadWindow = (url: string) => url.includes('surface=thread-view');
const threadWindows = (electron: ElectronApplication) => electron.windows().filter((w) => !w.isClosed() && isThreadWindow(w.url()));
/** BrowserWindows main still holds for thread views (Playwright can lag behind a close). */
const liveThreadWindows = (electron: ElectronApplication) =>
  electron.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('surface=thread-view')).length);

async function waitForThreadWindow(electron: ElectronApplication): Promise<Page> {
  let view: Page | undefined;
  await expect.poll(() => (view = threadWindows(electron)[0]) ? 'open' : 'waiting', { timeout: 20_000 }).toBe('open');
  await view!.waitForSelector('#root', { timeout: 30_000 });
  return view!;
}

async function route(page: Page, path: string) {
  await page.evaluate((next) => { history.pushState({}, '', next); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
}

test('thread window: one owner, side panel, reuse, bring back and close', async ({ app }) => {
  const { window: main, electron } = app;
  const errors: string[] = [];
  main.on('pageerror', (error) => errors.push(`main: ${error.message}`));
  const title = 'Window probe';
  const { projectId, threadId } = await main.evaluate(async (threadTitle) => {
    const projects = await fetch('/api/v1/projects').then((response) => response.json()) as { projects: Array<{ id: string }> };
    const project = projects.projects[0]!.id;
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project, providerId: 'fake', title: threadTitle, input: 'delay:60000 window probe' })
    });
    if (!response.ok) throw new Error(await response.text());
    return { projectId: project, threadId: (await response.json()).thread.id as string };
  }, title);
  const threadPath = `/projects/${projectId}/threads/${threadId}`;
  await route(main, threadPath);
  await expect(main.getByTestId('thread-detail').first()).toBeVisible({ timeout: 15_000 });

  // Main refuses a target it cannot authorize.
  expect(await main.evaluate(() => window.cc.windows.openThreadView({ threadId: '../x' }))).toBe(false);
  expect(await main.evaluate(() => window.cc.windows.openThreadView({ threadId: 't1', projectId: 'nope' }))).toBe(false);

  // Open from the overflow menu.
  await main.getByTestId('thread-overflow-trigger').first().click();
  await main.getByTestId('thread-open-in-window').click();
  const view = await waitForThreadWindow(electron);
  view.on('pageerror', (error) => errors.push(`thread window: ${error.message}`));
  await expect(view.getByTestId('thread-view-window')).toHaveAttribute('data-thread-id', threadId);
  await expect(view.getByTestId('thread-view-title')).toContainText(title);
  await expect(view).toHaveTitle(new RegExp(`^${title} — `));
  const detail = view.getByTestId('thread-detail');
  await expect(detail).toBeVisible();
  // The thread window does not offer to open itself again.
  await view.getByTestId('thread-overflow-trigger').click();
  await expect(view.getByTestId('thread-overflow-menu')).toBeVisible();
  await expect(view.getByTestId('thread-open-in-window')).toHaveCount(0);
  await view.keyboard.press('Escape');

  // One live owner: main shows the placeholder instead of the thread.
  await expect(main.getByTestId('thread-detached')).toBeVisible();
  await expect(main.getByTestId('thread-detail')).toHaveCount(0);

  // The side panel works in the thread window.
  const panel = detail.getByTestId('thread-secondary-panel');
  if (!(await panel.isVisible())) await detail.getByTestId('thread-secondary-show').click();
  await expect(panel).toBeVisible();
  await detail.getByTestId('thread-secondary-hide').click();
  await expect(panel).toBeHidden();

  // Focus and a second open reuse the same window.
  await main.getByTestId('thread-detached-focus').click();
  expect(await main.evaluate((target) => window.cc.windows.openThreadView(target), { threadId, projectId })).toBe(true);
  await expect.poll(() => liveThreadWindows(electron)).toBe(1);
  expect(await main.evaluate(() => window.cc.windows.listThreadViews())).toEqual([{ threadId, projectId }]);

  // Bring back from the placeholder.
  await main.getByTestId('thread-detached-bring-back').click();
  await expect.poll(() => liveThreadWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect(main.getByTestId('thread-detail').first()).toBeVisible();
  await expect(main.getByTestId('thread-detached')).toHaveCount(0);

  // Bring back from the title bar after the main window moved on: main returns to the thread.
  expect(await main.evaluate((target) => window.cc.windows.openThreadView(target), { threadId, projectId })).toBe(true);
  const again = await waitForThreadWindow(electron);
  await expect(again.getByTestId('thread-detail')).toBeVisible();
  await route(main, `/projects/${projectId}`);
  await again.getByTestId('thread-view-bring-back').click();
  await expect.poll(() => liveThreadWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect.poll(() => main.evaluate(() => location.pathname)).toBe(threadPath);
  await expect(main.getByTestId('thread-detail').first()).toBeVisible();

  // The close-tab chord closes the window, which has no tabs of its own.
  expect(await main.evaluate((target) => window.cc.windows.openThreadView(target), { threadId, projectId })).toBe(true);
  const keyed = await waitForThreadWindow(electron);
  await expect(keyed.getByTestId('thread-detail')).toBeVisible();
  // The window closes on key-down, so the key-up can find the page gone.
  await keyed.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')
    .catch((error: Error) => { if (!/has been closed/.test(error.message)) throw error; });
  await expect.poll(() => liveThreadWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect(main.getByTestId('thread-detail').first()).toBeVisible();

  // Closing the window itself also hands the thread back.
  expect(await main.evaluate((target) => window.cc.windows.openThreadView(target), { threadId, projectId })).toBe(true);
  await waitForThreadWindow(electron);
  await expect(main.getByTestId('thread-detached')).toBeVisible();
  await electron.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('surface=thread-view')) w.close();
  });
  await expect.poll(() => liveThreadWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect(main.getByTestId('thread-detail').first()).toBeVisible();
  await expect(main.getByTestId('thread-detached')).toHaveCount(0);
  expect(await main.evaluate(() => window.cc.windows.listThreadViews())).toEqual([]);
  expect(errors).toEqual([]);
});
