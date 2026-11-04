import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

// The native browser view paints above the DOM; it must stay inside the side
// panel's border at the default 0.95 renderer zoom, or the separator vanishes.
test('thread browser view keeps the side panel separator visible', async ({ app }, testInfo) => {
  const { window: page, electron, home } = app;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Separator</title><body style="margin:0;background:#fff"><h1>Separator check</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    const root = join(home, 'browser-separator');
    mkdirSync(root);
    const threadId = await page.evaluate(async (root) => {
      const project = await window.cc.projects.add(root);
      if (!project.ok) throw new Error(project.message);
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Separator check' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return (body.thread ?? body.value).id as string;
    }, root);
    await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
    await expect(page.getByRole('heading', { name: 'Separator check', exact: true })).toBeVisible();

    const execute = (command: Record<string, unknown>) => electron.evaluate(async (_electron, { threadId, command }) => {
      const broker = (globalThis as { __zccDesktopBrowserBroker?: {
        listInstances(): Array<{ instanceId: string; generation: string }>;
        execute(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      } }).__zccDesktopBrowserBroker;
      if (!broker) throw new Error('Missing desktop broker');
      return broker.execute({ ...broker.listInstances()[0], threadId, ...command });
    }, { threadId, command });
    const tabId = 'browser:separator';
    await execute({ type: 'desktop.browser.create_tab', tabId, url, profile: { kind: 'automation', id: 'separator' }, presentation: 'hidden' });
    await execute({ type: 'desktop.browser.reveal_tab', tabId });
    await expect(page.getByTestId('thread-browser-tab')).toBeVisible();

    const nativeWindow = await electron.browserWindow(page);
    const viewBounds = () => nativeWindow.evaluate((win, url) => {
      const view = win.contentView.children.find(child => 'webContents' in child
        && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView | undefined;
      return view && view.getVisible() ? view.getBounds() : null;
    }, url);
    // Wait until the native view tracks the laid-out content box.
    await expect.poll(async () => (await viewBounds())?.width ?? 0).toBeGreaterThan(0);
    // Give layout a moment to settle, then compare in window pixels.
    await page.waitForTimeout(500);
    const native = (await viewBounds())!;
    const dom = await page.evaluate(() => {
      const panel = document.querySelector('.thread-secondary-panel')!.getBoundingClientRect();
      const content = document.querySelector('.thread-browser-view')!.getBoundingClientRect();
      return { panelLeft: panel.left, contentLeft: content.left, contentRight: content.right, contentBottom: content.bottom };
    });
    const zoom = await nativeWindow.evaluate(win => win.webContents.getZoomFactor());
    testInfo.annotations.push({ type: 'geometry', description: JSON.stringify({ zoom, native, dom }) });
    // The 1px border occupies [panelLeft, panelLeft + 1) CSS px.
    expect(native.x).toBeGreaterThanOrEqual(Math.ceil((dom.panelLeft + 1) * zoom) - 0);
    expect(native.x).toBeGreaterThanOrEqual(Math.ceil(dom.contentLeft * zoom));
    expect(native.x + native.width).toBeLessThanOrEqual(Math.floor(dom.contentRight * zoom));
    expect(native.y + native.height).toBeLessThanOrEqual(Math.floor(dom.contentBottom * zoom));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
