import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

for (const scenario of ['background', 'split-pane', 'recover-read-error', 'refresh-existing', 'clear-line', 'opener-scope'] as const) {
  test.describe(scenario, () => {
    test.use({ isolateBundledCatalog: scenario !== 'opener-scope' });
    test(`file preview recovery: ${scenario}`, async ({ app }) => {
      const { window, home } = app;
      mkdirSync(join(home, 'preview-review'), { recursive: true });
      const root = realpathSync(join(home, 'preview-review'));
      writeFileSync(join(root, 'first.md'), '# First report');
      writeFileSync(join(root, 'second.md'), '# Second report');
      writeFileSync(join(root, 'third.md'), '# Third report');
      writeFileSync(join(root, 'other.mdx'), '# Other format');
      const { threadId, splitLayout } = await window.evaluate(async ({ root, scenario }) => {
        const project = await window.cc.projects.add(root);
        if (!project.ok) throw new Error('Project registration failed');
        const create = async () => {
          const response = await fetch('/api/v1/threads', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Preview recovery' })
          });
          const body = await response.json();
          if (!response.ok) throw new Error(JSON.stringify(body));
          return (body.thread ?? body.value).id as string;
        };
        const id = await create();
        let splitLayout: string | null = null;
        if (scenario === 'split-pane') {
          const secondId = await create();
          const slot = {
            maximizedPaneId: null,
            layout: {
              focusedPaneId: 'preview-left',
              root: {
                type: 'split', dir: 'row', sizes: [0.5, 0.5],
                children: [id, secondId].map((threadId, index) => ({
                  type: 'pane', paneId: index === 0 ? 'preview-left' : 'preview-right',
                  content: { kind: 'thread', projectId: project.value.id, threadId }
                }))
              }
            }
          };
          splitLayout = JSON.stringify({
            version: 2, scopes: { global: slot, [`project:${project.value.id}`]: slot }
          });
        }
        return { threadId: id, splitLayout };
      }, { root, scenario });
      const navigate = async (path: string) => window.evaluate((path) => {
        history.pushState({}, '', path);
        dispatchEvent(new PopStateEvent('popstate'));
      }, path);
      const preview = async (path: string, lineNumber?: number) => {
        const result = await window.evaluate(async ({ threadId, path, lineNumber }) => {
          const response = await fetch(`/api/v1/threads/${threadId}/open`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: { source: 'workspace', path, lineNumber } })
          });
          return { status: response.status, body: await response.json() };
        }, { threadId, path, lineNumber });
        expect(result.status).toBe(200);
        expect(result.body.delivered).toBeGreaterThan(0);
      };
      await navigate(`/threads/${threadId}`);
      await expect(window.getByTestId('thread-detail')).toBeVisible();
      if (scenario === 'split-pane') {
        // Seed after navigation has persisted its initial one-pane layout.
        await window.evaluate((layout) => sessionStorage.setItem('zcc.splitLayout', layout!), splitLayout);
        await window.reload();
        await expect(window.getByTestId('thread-detail')).toHaveCount(2);
      }
      await preview('first.md');
      await expect(window.getByRole('heading', { name: 'First report', exact: true })).toBeVisible();
      if (scenario === 'background') {
        await navigate('/inbox');
        await expect(window.getByTestId('thread-detail')).toHaveCount(0);
        await preview('second.md');
        await preview('third.md');
        await navigate(`/threads/${threadId}`);
        await expect(window.getByTestId('thread-detail')).toBeVisible();
        await expect(window.getByRole('heading', { name: 'Third report', exact: true })).toBeVisible({ timeout: 5000 });
        await window.getByRole('button', { name: 'second.md', exact: true }).click();
        await expect(window.getByRole('heading', { name: 'Second report', exact: true })).toBeVisible({ timeout: 5000 });
      } else if (scenario === 'split-pane') {
        await preview('second.md');
        await expect(window.getByRole('heading', { name: 'Second report', exact: true })).toBeVisible({ timeout: 5000 });
        await expect(window.getByRole('heading', { name: 'First report', exact: true })).toHaveCount(0);
        // A native window.open event must create a tab only in its source pane.
        await openThreadToolLauncher(window);
        await window.getByTestId('thread-new-tab-browser').click();
        await expect(window.getByTestId('thread-browser-address')).toHaveCount(1);
        const nativeWindow = await app.electron.browserWindow(window);
        const server = createServer((_request, response) => {
          response.writeHead(200, { 'content-type': 'text/html' });
          response.end('<html><title>Popup source</title><body>Popup source</body></html>');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
          const address = server.address();
          if (!address || typeof address === 'string') throw new Error('Missing popup server port');
          const url = `http://127.0.0.1:${address.port}/`;
          await window.getByTestId('thread-browser-address').fill(url);
          await window.getByTestId('thread-browser-address').press('Enter');
          await expect.poll(() => nativeWindow.evaluate((win, url) => win.contentView.children.some((child) =>
            'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url
          ), url)).toBe(true);
          await nativeWindow.evaluate(async (win, url) => {
            const source = win.contentView.children.find((child) =>
              'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url
            ) as Electron.WebContentsView;
            // The target need not load: this assertion concerns native popup
            // routing, without depending on an external site or OS browser.
            await source.webContents.executeJavaScript("window.open('http://127.0.0.1:1/preview-popup'); void 0");
          }, url);
          await expect(window.getByTestId('thread-browser-address').first()).toHaveValue('http://127.0.0.1:1/preview-popup');
          await expect(window.getByTestId('thread-browser-address')).toHaveCount(1);
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
      } else if (scenario === 'clear-line') {
        await preview('first.md', 1);
        await expect(window.getByTestId('thread-file-preview-focus-line')).toContainText('# First report');
        await preview('first.md');
        await expect(window.getByRole('heading', { name: 'First report', exact: true })).toBeVisible();
        await expect(window.getByTestId('thread-file-preview-focus-line')).toHaveCount(0);
      } else if (scenario === 'opener-scope') {
        await window.getByRole('combobox', { name: 'Open with' }).selectOption('host');
        await expect(window.locator('.docs-file-opener')).toHaveCount(0);
        await preview('other.mdx');
        await expect(window.getByRole('heading', { name: 'Other format', exact: true })).toBeVisible();
        await expect(window.locator('.docs-file-opener')).toHaveCount(1);
        await preview('first.md');
        await expect(window.getByRole('heading', { name: 'First report', exact: true })).toBeVisible();
        await expect(window.locator('.docs-file-opener')).toHaveCount(0);
      } else if (scenario === 'recover-read-error') {
        await preview('missing.md');
        await expect(window.getByTestId('thread-secondary-panel')).toContainText('file not found');
        await preview('second.md');
        await expect(window.getByRole('heading', { name: 'Second report', exact: true })).toBeVisible({ timeout: 5000 });
      } else {
        writeFileSync(join(root, 'first.md'), '# Updated report');
        await preview('first.md');
        await expect(window.getByRole('heading', { name: 'Updated report', exact: true })).toBeVisible({ timeout: 5000 });
      }
    });
  });
}
