import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({
  e2e: true,
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { classicSessionViewEnabled: false, agentsBoardView: 'board', sponsorPromptDismissed: true }
});

test('opening a thread replaces the old inspector so its browser reveal is visible', async ({ app }) => {
  const { window, electron, home } = app;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Revealed preview</title><h1>Live browser preview</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    const projectPath = join(home, 'browser-thread-open');
    mkdirSync(projectPath);
    const [, targetId] = await window.evaluate(async path => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      const ids: string[] = [];
      for (const title of ['Previous inspector', 'Preview owner']) {
        const response = await fetch('/api/v1/threads', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title, input: 'Hello' })
        });
        if (!response.ok) throw new Error(await response.text());
        ids.push((await response.json()).value.id);
      }
      return ids;
    }, projectPath);
    await window.getByTestId('nav-agents').click();
    await window.locator('.agent-card[data-kind="thread"]').filter({ hasText: 'Previous inspector' }).click();
    const modal = window.getByTestId('thread-modal');
    await expect(modal).toHaveAttribute('aria-label', 'Previous inspector');

    const execute = (command: Record<string, unknown>) => electron.evaluate(async (_electron, { threadId, command }) => {
      const broker = (globalThis as { __zccDesktopBrowserBroker?: {
        listInstances(): Array<{ instanceId: string; generation: string }>;
        execute(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      } }).__zccDesktopBrowserBroker;
      if (!broker) throw new Error('Missing desktop broker');
      return broker.execute({ ...broker.listInstances()[0], threadId, ...command });
    }, { threadId: targetId, command });
    const tabId = 'browser:thread-open-preview';
    await execute({ type: 'desktop.browser.create_tab', tabId, url,
      profile: { kind: 'automation', id: 'thread-open-preview' }, presentation: 'hidden' });
    // A background reveal must keep the current inspector in place and wait.
    await execute({ type: 'desktop.browser.reveal_tab', tabId });
    await expect(modal).toHaveAttribute('aria-label', 'Previous inspector');
    expect((await execute({ type: 'desktop.browser.list_tabs' })).tabs).toEqual([
      expect.objectContaining({ tabId, presentation: 'hidden' })
    ]);

    // This is the same ProductHub event used by `zcc thread open`. It must
    // replace the visible inspector, rather than navigate underneath it.
    await window.evaluate(async threadId => {
      const response = await fetch(`/api/v1/threads/${threadId}/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      });
      if (!response.ok) throw new Error(await response.text());
    }, targetId);
    await expect(modal).toHaveAttribute('aria-label', 'Preview owner');
    await expect(window.getByTestId('thread-modal')).toHaveCount(1);
    // The background reveal waited for its thread, so opening it shows the tab.
    await expect(modal.getByTestId('thread-browser-tab')).toBeVisible();
    await expect(modal.getByTestId('thread-browser-address')).toHaveValue(url);

    const nativeWindow = await electron.browserWindow(window);
    const nativeVisible = () => nativeWindow.evaluate(async (win, url) => {
      const view = win.contentView.children.find(child => 'webContents' in child
        && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView | undefined;
      return view ? { visible: view.getVisible(), text: await view.webContents.executeJavaScript('document.querySelector("h1")?.textContent') } : null;
    }, url);
    await expect.poll(nativeVisible).toEqual({ visible: true, text: 'Live browser preview' });

    await modal.getByTestId('thread-modal-close').click();
    await expect(modal).toHaveCount(0);
    await expect.poll(nativeVisible).toMatchObject({ visible: false });
    // Closing the foreground inspector must not expose a second copy of the
    // target thread left behind by the open event.
    await expect(window.getByTestId('thread-detail')).toHaveCount(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
