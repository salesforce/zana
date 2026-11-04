import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('balanced thread header keeps context accessible and actions reachable at narrow widths', async ({ app }, testInfo) => {
  const { window, home, electron } = app;
  const projectPath = join(home, 'balanced-header-project');
  const branchName = 'fix/a-long-branch-name-for-the-balanced-thread-header';
  mkdirSync(projectPath);
  execFileSync('git', ['init', '--quiet'], { cwd: projectPath });
  writeFileSync(join(projectPath, 'README.md'), 'Balanced thread header fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: projectPath });
  execFileSync('git', ['-c', 'user.name=Header E2E', '-c', 'user.email=header@example.test', 'commit', '--quiet', '-m', 'Initial fixture'], { cwd: projectPath });
  execFileSync('git', ['checkout', '-b', branchName], { cwd: projectPath });
  const title = 'Verify this: https://salesforce-internal.example/project-context-menu/with-a-long-title';
  const id = await window.evaluate(async ({ projectPath, title }) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title, input: 'Verify project navigation delay:20000' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, { projectPath, title });
  await window.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  const header = window.locator('.thread-detail-header--balanced');
  const context = header.getByRole('button', { name: 'Thread context', exact: true });
  const dialog = window.getByRole('dialog', { name: 'Thread context' });
  await expect(header.getByRole('heading', { level: 1 })).toHaveAttribute('title', title);
  await expect(context).toBeVisible();
  await expect(header.getByTestId('thread-detail-status')).toBeVisible();
  await expect(header.getByTestId('thread-detail-status')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(header.getByTestId('thread-header-meta')).toContainText('Fake');
  await expect(context).toContainText('balanced-header-project');
  await expect(context).toContainText(branchName);
  await expect(dialog).toHaveCount(0);
  await context.focus();
  await context.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTitle('Project: balanced-header-project', { exact: true })).toBeVisible();
  await expect(dialog.getByTitle(`Branch: ${branchName}`, { exact: true })).toBeVisible();
  await expect(dialog.getByText('Fake', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close thread context' })).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(context).toBeFocused();

  for (const width of [1440, 1000, 800]) {
    await window.setViewportSize({ width, height: 800 });
    // Exercise a split-sized pane without changing global layout preferences.
    for (const paneWidth of [null, 480]) {
      await header.evaluate((element, paneWidth) => {
        element.style.width = paneWidth ? `${paneWidth}px` : '';
      }, paneWidth);
      await expect.poll(() => header.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const heading = element.querySelector('h1')!.getBoundingClientRect();
        const metadata = element.querySelector('.thread-detail-meta')!.getBoundingClientRect();
        return element.scrollWidth <= element.clientWidth + 1 && heading.width > 40 && metadata.top >= heading.bottom
          && [...element.querySelectorAll('button')].every(button => {
            const rect = button.getBoundingClientRect();
            return rect.left >= bounds.left && rect.right <= bounds.right + 1
              && (button.closest('.thread-detail-meta')
                ? rect.top >= metadata.top && rect.bottom <= metadata.bottom + 1
                : Math.abs(rect.top + rect.height / 2 - (heading.top + heading.height / 2)) < 2);
          });
      })).toBe(true);
      await context.click();
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
      })).toBe(true);
      await dialog.getByRole('button', { name: 'Close thread context' }).click();
      await expect(context).toBeFocused();
    }
  }
  await header.evaluate(element => { element.style.width = ''; });
  await context.click();
  await header.getByTestId('thread-overflow-trigger').click();
  await expect(dialog).toHaveCount(0);
  await expect(window.getByRole('menu', { name: 'Agent actions' })).toBeVisible();
  await window.keyboard.press('Escape');
  await window.evaluate(() => window.cc.config.set({ theme: 'light' }));
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  await captureElectronScreenshot(electron, window, testInfo.outputPath('balanced-thread-header-light.png'));
  await context.click();
  await captureElectronScreenshot(electron, window, testInfo.outputPath('balanced-thread-context-light.png'));
  await window.keyboard.press('Escape');

  // The portaled context must also remain clickable above Electron's native browser.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>Header preview</title><h1>Header preview</h1><script>window.headerMarker = Math.random()</script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing preview server port');
    const url = `http://127.0.0.1:${address.port}/`;
    await window.setViewportSize({ width: 1440, height: 900 });
    const showPanel = header.getByTestId('thread-secondary-show');
    if (await showPanel.isVisible()) await showPanel.click();
    const right = window.getByTestId('thread-secondary-panel');
    await right.getByTestId('thread-secondary-new-tab').click();
    await window.getByRole('menuitem', { name: 'Browser', exact: true }).click();
    await right.getByTestId('thread-browser-address').fill(url);
    await right.getByTestId('thread-browser-address').press('Enter');
    const nativeWindow = await electron.browserWindow(window);
    const browserState = () => nativeWindow.evaluate(async (win, url) => {
      const view = win.contentView.children.find(child => 'webContents' in child
        && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView | undefined;
      return view ? { visible: view.getVisible(), marker: await view.webContents.executeJavaScript('window.headerMarker') } : null;
    }, url);
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    const marker = (await browserState())!.marker;
    await context.click();
    await expect.poll(async () => (await browserState())?.visible).toBe(false);
    await expect(right.locator('.thread-browser-snapshot')).toBeVisible();
    const close = dialog.getByRole('button', { name: 'Close thread context' });
    expect(await close.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    })).toBe(true);
    await captureElectronScreenshot(electron, window, testInfo.outputPath('balanced-context-above-native-browser.png'));
    await close.click();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    expect((await browserState())!.marker).toBe(marker);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
