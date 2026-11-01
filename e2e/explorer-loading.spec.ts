import { test, expect } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('cold tree is usable while the editor module is stalled; reopening fetches fresh filenames', async ({ app, home }, testInfo) => {
  const { window } = app;
  await app.electron.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false);
  });
  const diagnostics: string[] = [];
  window.on('pageerror', error => diagnostics.push(error.message));
  window.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  await window.evaluate(() => performance.setResourceTimingBufferSize(3000));
  const root = join(home, 'explorer-loading');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'first.ts'), 'export const first = 1;');
  writeFileSync(join(root, 'src', 'child.ts'), 'export const child = 2;');
  await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, root);

  await app.electron.evaluate(({ BrowserWindow }) => {
    const state = globalThis as any;
    state.explorerEditorRequests = 0;
    state.releaseExplorerEditor = () => {};
    BrowserWindow.getAllWindows()[0].webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/assets/ExplorerEditor-*.js'] }, (_details, callback) => {
      state.explorerEditorRequests++;
      state.releaseExplorerEditor = () => {
        state.releaseExplorerEditor = () => {};
        callback({ cancel: false });
      };
    });
  });
  let rootReads = 0;
  window.on('request', request => {
    if (new URL(request.url()).pathname === '/api/v1/fs/list-dir' && request.postDataJSON()?.path === root) rootReads++;
  });
  const editorRequests = () => app.electron.evaluate(() => (globalThis as any).explorerEditorRequests as number);
  const rootRequests = async () => rootReads;
  const releaseEditor = () => app.electron.evaluate(() => (globalThis as any).releaseExplorerEditor());
  try {
    const heading = window.getByTestId('sidebar-projects-heading');
    if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
    await window.getByRole('button', { name: 'Open explorer-loading', exact: true }).click();
    const coldStart = Date.now();
    await window.getByTestId('project-nav-explorer').click();
    const first = window.locator('.tree-row.file').filter({ hasText: 'first.ts' });
    await expect(first).toBeVisible();
    const treeReadyMs = Date.now() - coldStart;
    expect(await editorRequests()).toBe(0);
    await first.click();
    await expect.poll(editorRequests).toBe(1);
    await expect(window.getByRole('status', { name: 'Loading file viewer' })).toBeVisible();
    await window.locator('.tree-row.dir').filter({ hasText: 'src' }).click();
    await expect(window.locator('.tree-row.file').filter({ hasText: 'child.ts' })).toBeVisible();
    const editorStart = Date.now();
    await releaseEditor();
    await expect(window.locator('.explorer-viewer-monaco .monaco-editor')).toContainText('export const first');
    const editorReadyMs = Date.now() - editorStart;

    await window.getByTestId('project-nav-terminals').click();
    writeFileSync(join(root, 'new.ts'), 'export const fresh = true;');
    const repeatStart = Date.now();
    await window.getByTestId('project-nav-explorer').click();
    await expect(window.locator('.tree-row.file').filter({ hasText: 'new.ts' })).toBeVisible();
    await testInfo.attach('explorer-loading-timings', { contentType: 'application/json', body: JSON.stringify({ treeReadyMs, editorReadyAfterReleaseMs: editorReadyMs, repeatTreeReadyMs: Date.now() - repeatStart }) });
  } finally {
    await releaseEditor();
    await app.electron.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.session.webRequest.onBeforeRequest(null);
    });
    const surface = await window.evaluate(() => ({ visibility: document.visibilityState, resources: performance.getEntriesByType('resource').map(row => row.name), links: Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(link => ({ href: link.href, loaded: !!link.sheet })), tree: document.querySelector('.explorer-tree-body')?.textContent }));
    await testInfo.attach('renderer-errors', { contentType: 'application/json', body: JSON.stringify({ diagnostics, rootRequests: await rootRequests(), editorRequests: await editorRequests(), surface }) });
  }
});

test('slow directory loading recovers when the pending request finishes without intervention', async ({ app, home }, testInfo) => {
  const { window } = app;
  await app.electron.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false);
  });
  const diagnostics: string[] = [];
  window.on('pageerror', error => diagnostics.push(error.message));
  window.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  await window.evaluate(() => performance.setResourceTimingBufferSize(3000));
  const root = join(home, 'explorer-recovery');
  mkdirSync(root);
  writeFileSync(join(root, 'fresh.ts'), 'export const fresh = true;');
  await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, root);
  let releaseOld!: () => void;
  const gate = new Promise<void>(resolve => { releaseOld = resolve; });
  let readCount = 0;
  const reads = async () => readCount;
  try {
    const heading = window.getByTestId('sidebar-projects-heading');
    if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
    await window.getByRole('button', { name: 'Open explorer-recovery', exact: true }).click();
    await window.getByTestId('project-nav-explorer').click();
    await expect(window.locator('.tree-row.file').filter({ hasText: 'fresh.ts' })).toBeVisible();
    await window.route(url => url.pathname === '/api/v1/fs/list-dir', async route => {
      if (++readCount === 1) {
        await gate;
        await route.continue();
      } else await route.continue();
    });
    await window.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(window.getByText('Taking longer than expected', { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(window.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    expect(await reads()).toBe(1);
    await releaseOld();
    await expect(window.locator('.tree-row.file').filter({ hasText: 'fresh.ts' })).toBeVisible();
    await expect(window.getByText('Taking longer than expected', { exact: true })).toHaveCount(0);
    expect(await reads()).toBe(1);
  } finally {
    await releaseOld();
    await window.unrouteAll({ behavior: 'wait' });
    const surface = await window.evaluate(() => ({ visibility: document.visibilityState, resources: performance.getEntriesByType('resource').map(row => row.name), links: Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(link => ({ href: link.href, loaded: !!link.sheet })), tree: document.querySelector('.explorer-tree-body')?.textContent }));
    await testInfo.attach('renderer-errors', { contentType: 'application/json', body: JSON.stringify({ diagnostics, reads: await reads(), surface }) });
  }
});
