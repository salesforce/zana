import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({
  e2e: true,
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { classicSessionViewEnabled: false, threadTabsEnabled: false, agentsBoardView: 'board', sponsorPromptDismissed: true }
});

for (const surface of ['thread', 'cli'] as const) {
  test(`${surface} inspector displays the native browser, reloads, and restores after overlays`, async ({ app }, testInfo) => {
    const { window, electron, home } = app;
    let version = 1;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      response.end(`<html><head><title>Inspector preview</title></head><body style="background:#e0f2fe;color:#123;padding:24px"><h1>Browser version ${version}</h1></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local server port');
    const url = `http://127.0.0.1:${address.port}/`;
    try {
      const path = join(home, 'browser-project');
      mkdirSync(path);
      const title = `Browser ${surface} inspector`;
      const fakeCli = join(path, 'browser-agent.cjs');
      writeFileSync(fakeCli, `#!${process.execPath}\nif (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }\nprocess.stdin.resume(); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
      const ownerId = await window.evaluate(async ({ path, title, surface, fakeCli }) => {
        const project = await window.cc.projects.add(path);
        if (!project.ok) throw new Error(project.message);
        if (surface === 'cli') {
          await window.cc.config.set({ claudeBinary: fakeCli });
          const result = await window.cc.terminals.create({ projectId: project.value.id, profile: 'claude', title, cols: 80, rows: 24 });
          if (!result.ok) throw new Error(result.message);
          return result.value.id;
        }
        const response = await fetch('/api/v1/threads', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title, input: 'Hello' })
        });
        if (!response.ok) throw new Error(await response.text());
        const body = await response.json();
        return (body.value ?? body.thread).id as string;
      }, { path, title, surface, fakeCli });
      await window.getByTestId('nav-agents').click();
      const card = window.locator('.agent-card').filter({ hasText: title });
      await card.getByRole('button', { name: 'Follow this agent', exact: true }).click();
      await card.click();
      const modal = window.getByTestId(surface === 'thread' ? 'thread-modal' : 'agent-terminal-modal');
      await expect(modal).toBeVisible();
      await modal.getByTestId('thread-secondary-show').click();
      await openThreadToolLauncher(modal);
      await modal.getByTestId('thread-new-tab-browser').click();
      const location = modal.getByTestId('thread-browser-address');
      await location.fill(url);
      const loadedTabId = window.evaluate((url) => new Promise<string>((resolve) => {
        const off = window.cc.browser.onState((state) => {
          if (state.url !== url || state.isLoading) return;
          off();
          resolve(state.tabId);
        });
      }), url);
      await location.press('Enter');
      const browserTabId = await loadedTabId;

      const nativeWindow = await electron.browserWindow(window);
      const nativeState = () => nativeWindow.evaluate(async (win, url) => {
        const view = win.contentView.children.find((child) =>
          'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url
        ) as Electron.WebContentsView | undefined;
        if (!view) return null;
        const text = await view.webContents.executeJavaScript('document.querySelector("h1")?.textContent');
        return { visible: view.getVisible(), text, bounds: view.getBounds() };
      }, url);
      const expectPage = async (visible: boolean) => {
        await expect.poll(nativeState).toMatchObject({ visible, text: `Browser version ${version}` });
      };
      await expectPage(true);
      await expect(modal.getByTestId('thread-browser-newtab')).toHaveCount(0);
      const bounds = (await nativeState())!.bounds;
      expect(bounds.width).toBeGreaterThan(100);
      expect(bounds.height).toBeGreaterThan(100);

      version = 2;
      await modal.getByRole('button', { name: 'Reload', exact: true }).click();
      await expectPage(true);
      version = 3;
      await location.press('Enter');
      await expectPage(true);

      // A real nested confirmation must hide the native child (which otherwise
      // composites above renderer dialogs), then restore the existing document.
      await window.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.id = 'browser-overlay-probe';
        overlay.className = 'consent-overlay';
        overlay.innerHTML = '<div role="dialog" aria-modal="true">Nested confirmation</div>';
        document.body.append(overlay);
      });
      await expectPage(false);
      await expect(modal.getByTestId('thread-browser-newtab')).toHaveCount(0);
      await window.evaluate(() => { document.getElementById('browser-overlay-probe')!.hidden = true; });
      await expectPage(true);
      await window.evaluate(() => { document.getElementById('browser-overlay-probe')!.remove(); });

      // Exercise the inspector's fullscreen layout without making the isolated
      // fixture steal OS focus: the renderer control changes this optimistically.
      await modal.getByRole('button', { name: 'Full screen', exact: true }).click();
      await expect(modal).toHaveClass(/is-fullscreen/);
      await expectPage(true);
      await modal.getByRole('button', { name: 'Exit full screen', exact: true }).click();
      await expect(modal).not.toHaveClass(/is-fullscreen/);
      await expectPage(true);
      const png = await nativeWindow.evaluate(async (win, url) => {
        const view = win.contentView.children.find((child) =>
          'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url
        ) as Electron.WebContentsView;
        return (await view.webContents.capturePage()).toPNG().toString('base64');
      }, url);
      writeFileSync(testInfo.outputPath(`${surface}-browser.png`), Buffer.from(png, 'base64'));

      await modal.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(modal).toHaveCount(0);
      await expectPage(false);

      if (surface === 'thread') {
        // Mount the SAME tab twice: a full-page thread with its inspector above
        // it. Background cleanup/resizes must not hide or reposition the owner.
        await window.evaluate(({ id, browserTabId, url }) => {
          // Seed the shared tab identity explicitly: this test concerns native
          // placement in two hosts, independently of server tab persistence.
          localStorage.setItem(`zcc.secondaryPanel.${id}`, JSON.stringify({
            version: 1, isOpen: true, isMaximized: false, widthPx: 352, activeId: browserTabId,
            tabs: [{ id: browserTabId, kind: 'browser', title: 'Inspector preview', url }]
          }));
          history.pushState({}, '', `/threads/${id}`);
          dispatchEvent(new PopStateEvent('popstate'));
        }, { id: ownerId, browserTabId, url });
        await expect(window.getByTestId('thread-detail')).toBeVisible();
        await expect(window.getByTestId('thread-browser-address')).toHaveValue(url);
        await expectPage(true);
        await window.locator('.titlebar-fav').click();
        await window.locator('.favorites-row').filter({ hasText: title }).click();
        await expect(modal).toBeVisible();
        await expectPage(true);
        await modal.getByTestId('inspector-resize-se').press('ArrowLeft');
        await expectPage(true);
        await modal.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(modal).toHaveCount(0);
        await expectPage(true);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
}
