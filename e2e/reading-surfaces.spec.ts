import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test.beforeEach(async ({ home }) => {
  const inbox = join(home, '.zcc/inbox');
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, 'entries.jsonl'), JSON.stringify({
    id: 'reading-surface-report', projectId: 'proj-e2e', ts: Date.now(),
    subject: 'Reading surface report', report: true,
    comments: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: A report with enough content to scroll.`).join('\n\n')
  }) + '\n');
});

async function colors(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const read = (token: string) => {
      probe.style.backgroundColor = `var(${token})`;
      return getComputedStyle(probe).backgroundColor;
    };
    const result = { panel: read('--bg-panel'), base: read('--bg-base') };
    probe.remove();
    return result;
  });
}

async function expectBackgrounds(page: Page, selectors: string[], color: string) {
  for (const selector of selectors) {
    const surface = page.locator(selector).first();
    await expect(surface).toBeVisible();
    await expect(surface).toHaveCSS('background-color', color);
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`reading surfaces stay continuous across modules in ${theme} mode`, async ({ app, home }, testInfo) => {
    test.setTimeout(180_000);
    const page = app.window;
    await app.electron.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().startsWith('devtools:'))!;
      main.webContents.setZoomFactor(1);
      main.setContentSize(1800, 1000);
    });
    await page.evaluate(theme => window.cc.config.set({ theme }), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const { panel, base } = await colors(page);
    expect(panel).not.toBe(base);

    await test.step('Inbox includes the sticky toolbar and reply dock', async () => {
      await page.getByTestId('nav-inbox').click();
      await page.locator('.inbox-row').filter({ hasText: 'Reading surface report' }).click();
      const surfaces = ['.inbox-view', '.inbox-list-pane', '.inbox-detail-header', '.inbox-detail-dock'];
      await expectBackgrounds(page, surfaces, panel);
      await page.locator('.inbox-view-detail').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expectBackgrounds(page, surfaces, panel);
      const fade = await page.locator('.inbox-detail-dock').evaluate(el => getComputedStyle(el, '::before').backgroundImage);
      expect(fade).toContain(panel);
      await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`inbox-${theme}.png`));
    });

    const root = join(home, 'reading-surfaces');
    mkdirSync(root);
    writeFileSync(join(root, 'README.md'), '# Explorer reading\n\nA continuous document surface.\n');
    writeFileSync(join(root, 'example.json'), '{ "surface": "code editor" }');
    writeFileSync(join(root, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="cornflowerblue"/></svg>');
    const projectId = await page.evaluate(async path => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      await window.cc.library.add({ scope: 'project', projectId: result.value.id, relPath: 'surface.md', title: 'Library reading', content: '# Library reading\n\nA continuous document surface.\n' });
      return result.value.id;
    }, root);

    await test.step('Library shares its surface through preview and rich editing', async () => {
      await page.evaluate(id => {
        history.pushState({}, '', `/projects/${id}/docs`);
        dispatchEvent(new PopStateEvent('popstate'));
      }, projectId);
      await page.getByRole('button', { name: 'surface.md', exact: true }).click();
      const surfaces = ['.library-view .explorer-tree', '.library-viewer', '.library-viewer .explorer-md-preview'];
      await expectBackgrounds(page, surfaces, panel);
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expectBackgrounds(page, ['.library-md-editor'], panel);
      await expect(page.locator('.library-md-editor [contenteditable=true]')).toContainText('Library reading');
      await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`library-edit-${theme}.png`));
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await page.evaluate(() => {
        history.pushState({}, '', '/plugins/docs/panel');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      const folder = page.locator('.library-panel .tree-row.dir').filter({ hasText: 'reading-surfaces' });
      await expect(folder).toBeVisible();
      if (await folder.getAttribute('aria-expanded') !== 'true') await folder.click();
      await page.getByRole('button', { name: 'surface.md', exact: true }).click();
      await expectBackgrounds(page, surfaces, panel);
    });

    await test.step('Explorer uses the reading surface while preserving code and image stages', async () => {
      await page.evaluate(id => {
        history.pushState({}, '', `/projects/${id}/explorer`);
        dispatchEvent(new PopStateEvent('popstate'));
      }, projectId);
      await expectBackgrounds(page, ['.explorer-tree', '.explorer-viewer'], panel);
      await page.locator('.tree-row.file').filter({ hasText: 'README.md' }).click();
      await expectBackgrounds(page, ['.explorer-md-preview'], panel);
      await expect(page.getByRole('heading', { name: 'Explorer reading', exact: true })).toBeVisible();
      await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`explorer-${theme}.png`));
      await page.locator('.tree-row.file').filter({ hasText: 'example.json' }).click();
      await expect(page.locator('.explorer-viewer-monaco .monaco-editor')).toContainText('code editor');
      await expect(page.locator('.explorer-viewer-monaco .monaco-editor')).toHaveClass(new RegExp(theme === 'dark' ? 'vs-dark' : '\\bvs\\b'));
      await page.locator('.tree-row.file').filter({ hasText: 'image.svg' }).click();
      await expectBackgrounds(page, ['.explorer-image-preview'], base);
    });

    await test.step('Design Docs matches across the list, file tree, reader and review rail', async () => {
      expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }))).toMatchObject({ ok: true });
      await expect.poll(() => page.evaluate(async () =>
        (await window.cc.pluginApps.list()).find(plugin => plugin.id === 'design-docs')?.status
      ), { timeout: 30_000 }).toBe('running');
      await page.evaluate(async projectId => {
        await window.cc.pluginApps.callRpc('design-docs', 'create', { title: 'Continuous design', template: 'technical', projectId });
      }, projectId);
      await page.evaluate(() => {
        history.pushState({}, '', '/plugins/design-docs/design-docs');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByText('Continuous design', { exact: true }).first().click();
      await expect(page.locator('.dd-prose')).toBeVisible();
      if (!await page.locator('.dd-rail').isVisible()) await page.getByRole('button', { name: 'Show comments & history' }).click();
      await expectBackgrounds(page, ['.dd-root', '.dd-list', '.dd-list-section', '.dd-tree', '.dd-rail'], panel);
      await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`design-docs-${theme}.png`));
      await page.getByRole('button', { name: 'Hide doc list' }).click();
      await expectBackgrounds(page, ['.dd-list-collapsed'], panel);
      await page.getByRole('button', { name: 'Show doc list' }).click();
      await page.getByRole('button', { name: 'Split', exact: true }).click();
      await expectBackgrounds(page, ['.dd-editor-split .dd-editor-input'], base);
    });
  });
}
