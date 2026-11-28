import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, type Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });
test.beforeEach(async ({ home }) => {
  const project = join(home, 'library-project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(home, '.zcc'), { recursive: true });
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify({ version: 1, projects: [{
    id: 'library-project', name: 'Library project', path: project, createdAt: 1, lastActiveAt: 1,
  }] }));
  const folder = join(home, '.zcc', 'library', 'notes');
  mkdirSync(folder, { recursive: true });
  const content = '# A readable mobile document\n\n' +
    Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: Documents should use the whole phone screen, with comfortable text and scrolling.`).join('\n\n') +
    '\n\n`' + 'long-reference-'.repeat(30) + '`\n\n```text\n' + 'wide code '.repeat(40) + '\n```\n\n' +
    '| Column one | Column two | Column three |\n|---|---|---|\n| ' + 'wide-table-value'.repeat(15) + ' | second | third |\n\nEnd of mobile document.';
  for (let i = 0; i < 25; i++) writeFileSync(join(folder, `mobile-note-${String(i).padStart(2, '0')}.md`), content);
});

async function navigate(page: Page, path: string) {
  await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
}

async function expectImportAlignment(page: Page, project = false) {
  const header = page.locator('.library-view .explorer-tree-header');
  const button = header.getByRole('button', { name: `Import file into ${project ? 'project' : 'Global'} Library`, exact: true });
  await expect(button).toBeVisible();
  const icon = (await button.locator('svg').boundingBox())!;
  const label = (await button.locator('span').boundingBox())!;
  const box = (await button.boundingBox())!;
  const next = (await header.locator('button').last().boundingBox())!;
  // Both children fit in the clickable box, on one row, clear of the next action.
  expect(icon.x + icon.width).toBeLessThanOrEqual(label.x);
  expect(Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2)).toBeLessThanOrEqual(1);
  expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width);
  expect(label.y).toBeGreaterThanOrEqual(box.y);
  expect(label.y + label.height).toBeLessThanOrEqual(box.y + box.height);
  expect(box.x + box.width).toBeLessThanOrEqual(next.x);
}

test('Library opens full-width mobile documents and restores the tree on Back', async ({ app }, testInfo) => {
  test.setTimeout(180_000);
  expect(await app.window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'docs' }))).toMatchObject({ ok: true });
  await expect.poll(() => app.window.evaluate(async () => (await window.cc.pluginApps.list()).some(p => p.id === 'docs' && p.status === 'running'))).toBe(true);
  await app.window.getByTestId('nav-docs').click();
  await expect(app.window.locator('.library-panel .explorer-tree')).toBeVisible();
  await expectImportAlignment(app.window);
  await navigate(app.window, '/projects/library-project/docs');
  await expectImportAlignment(app.window, true);
  await navigate(app.window, '/plugins/docs/panel');
  await expectImportAlignment(app.window);
  await app.window.locator('.tree-row.dir').filter({ hasText: 'notes' }).click();
  await app.window.getByRole('button', { name: 'mobile-note-00.md', exact: true }).click();
  await expect(app.window.locator('.library-md-pane')).toBeVisible();
  await expect(app.window.locator('.explorer-tree')).toBeVisible();
  await expect(app.window.getByRole('button', { name: 'Back to documents' })).toHaveCount(0);
  await expect(app.window.locator('.library-resizer')).toBeVisible();

  const reservation = createServer();
  await new Promise<void>(r => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(r => reservation.close(() => r()));
  const url = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: url, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${url}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Mobile library verification' } });
    const credential = await pair.json();
    expect((await context.request.post(`${url}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await drawer.getByRole('button', { name: 'Tools', exact: true }).click();
    await drawer.getByTestId('nav-docs').click();
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [scope, path] of [['global', '/plugins/docs/panel'], ['project', '/projects/library-project/docs']]) {
        await navigate(page, path);
        const root = page.locator('.library-view');
        await expect(root).toHaveAttribute('data-mobile-pane', 'documents');
        await expectImportAlignment(page, scope === 'project');
        const input = root.locator('.library-search input');
        await input.fill('mobile-note');
        await root.locator('.tree-row.dir').filter({ hasText: 'notes' }).click();
        const row = root.getByRole('button', { name: 'mobile-note-24.md', exact: true });
        await row.scrollIntoViewIfNeeded();
        const scroll = await root.locator('.library-tree').evaluate(el => el.scrollTop);
        expect(scroll).toBeGreaterThan(0);
        await row.click();
        await expect(root).toHaveAttribute('data-mobile-pane', 'document');
        await expect(root.locator('.explorer-tree')).toBeHidden();
        await expect(root.locator('.library-resizer')).toBeHidden();
        await expect(root.getByRole('heading', { name: 'A readable mobile document' })).toBeVisible();
        const reader = root.locator('.library-viewer');
        const box = (await reader.boundingBox())!;
        const rootBox = (await root.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(rootBox.width - 2);
        expect(box.width).toBeGreaterThanOrEqual(width - 2);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        const body = root.locator('.explorer-md-preview');
        expect(await body.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        const back = root.getByRole('button', { name: 'Back to documents' });
        await expect(back).toBeFocused();
        expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: testInfo.outputPath(`${width}-${scope}-document.png`) });
        await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await expect(root.getByText('End of mobile document.', { exact: true })).toBeInViewport();
        await expect(back).toBeInViewport();
        await back.click();
        await expect(input).toHaveValue('mobile-note');
        await expect(row).toBeFocused();
        expect(await root.locator('.library-tree').evaluate(el => el.scrollTop)).toBe(scroll);
        await page.screenshot({ path: testInfo.outputPath(`${width}-${scope}-list.png`) });
        await row.press('Enter');
        await expect(root).toHaveAttribute('data-mobile-pane', 'document');
      }
    }
    await navigate(page, '/plugins/docs/panel/global/notes/mobile-note-00.md');
    await expect(page.locator('.library-panel')).toHaveAttribute('data-mobile-pane', 'document');
    await expect(page.getByRole('heading', { name: 'A readable mobile document' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to documents' }).click();
    await page.locator('.library-panel .library-search input').fill('comfortable text and scrolling');
    // The phrase occurs only in document bodies, never in names or metadata.
    const folder = page.locator('.library-panel .tree-row.dir').filter({ hasText: 'notes' });
    await expect(folder).toBeVisible();
    if (!(await page.getByRole('button', { name: 'mobile-note-00.md', exact: true }).isVisible())) await folder.click();
    await page.getByRole('button', { name: 'mobile-note-00.md', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A readable mobile document' })).toBeVisible();
  } finally {
    await browser.close();
    await gateway.close();
  }
});
