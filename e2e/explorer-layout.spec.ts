import { test, expect } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('Explorer fills the project pane and its editor resizes with the tree', async ({ app, home }, testInfo) => {
  const { window } = app;
  const root = join(home, 'explorer-layout');
  mkdirSync(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'explorer-layout', description: 'A realistic long line to exercise the editor layout. '.repeat(30) }, null, 2));
  const projectId = await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);

  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.getByRole('button', { name: 'Open explorer-layout', exact: true }).click();
  await window.getByTestId('project-nav-explorer').click();
  await window.locator('.tree-row.file').filter({ hasText: 'package.json' }).click();
  const editor = window.locator('.explorer-viewer-monaco .monaco-editor');
  await expect(editor).toContainText('explorer-layout');
  await expect(window.getByRole('combobox', { name: 'Explorer machine' })).toHaveCount(0);

  for (const width of [1440, 900]) {
    await window.setViewportSize({ width, height: 850 });
    await expect.poll(async () => window.locator('.explorer-view').evaluate(surface => {
      const parent = surface.parentElement!.getBoundingClientRect();
      const grid = surface.getBoundingClientRect();
      const viewer = surface.querySelector('.explorer-viewer')!.getBoundingClientRect();
      const editor = surface.querySelector('.monaco-editor')!.getBoundingClientRect();
      return Math.max(Math.abs(parent.width - grid.width), Math.abs(parent.right - viewer.right), Math.abs(viewer.width - editor.width));
    })).toBeLessThanOrEqual(2);
    await window.screenshot({ path: testInfo.outputPath(`explorer-${width}.png`), animations: 'disabled' });
  }

  const separator = window.locator('.explorer-resizer');
  const before = await window.locator('.explorer-viewer').boundingBox();
  const handle = await separator.boundingBox();
  expect(before).toBeTruthy(); expect(handle).toBeTruthy();
  await window.mouse.move(handle!.x + handle!.width / 2, handle!.y + 80);
  await window.mouse.down();
  await window.mouse.move(handle!.x + handle!.width / 2 + 60, handle!.y + 80, { steps: 6 });
  await window.mouse.up();
  await expect.poll(async () => (await window.locator('.explorer-viewer').boundingBox())!.width).toBeCloseTo(before!.width - 60, 0);
  await separator.dblclick();
  await expect(separator).toHaveAttribute('aria-valuenow', '260');
  expect(projectId).toBeTruthy();
});

test('Explorer preview shows a minimap, managed from its right-click menu, that hides when narrow', async ({ app, home }) => {
  const { window } = app;
  const root = join(home, 'explorer-minimap');
  mkdirSync(root);
  writeFileSync(join(root, 'long.ts'), Array.from({ length: 400 }, (_, i) => `export const value${i} = ${i}; // line ${i}`).join('\n'));
  await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, root);

  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.getByRole('button', { name: 'Open explorer-minimap', exact: true }).click();
  await window.getByTestId('project-nav-explorer').click();
  await window.locator('.tree-row.file').filter({ hasText: 'long.ts' }).click();
  await window.setViewportSize({ width: 1440, height: 850 });

  const minimap = window.locator('.explorer-viewer-monaco .minimap');
  await expect(minimap).toBeVisible();
  await expect.poll(async () => {
    const box = await minimap.boundingBox();
    const editorBox = await window.locator('.explorer-viewer-monaco .monaco-editor').boundingBox();
    if (!box || !editorBox) return false;
    return Math.abs((box.x + box.width) - (editorBox.x + editorBox.width)) < 25;
  }).toBe(true);

  // The viewport slider moves as the editor scrolls.
  const slider = window.locator('.explorer-viewer-monaco .minimap-slider');
  const top = (await slider.boundingBox())!.y;
  await window.locator('.explorer-viewer-monaco .monaco-editor').hover();
  await window.mouse.wheel(0, 1200);
  await expect.poll(async () => (await slider.boundingBox())!.y).toBeGreaterThan(top);

  // Narrow viewport: auto-hidden.
  await window.setViewportSize({ width: 700, height: 850 });
  await expect(minimap).toBeHidden();
  await window.setViewportSize({ width: 1440, height: 850 });
  await expect(minimap).toBeVisible();

  // Right-click menu: move the minimap to the left edge.
  const menu = window.getByRole('menu', { name: 'Minimap', exact: true });
  await minimap.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /Side/ }).click();
  await window.getByRole('menuitemradio', { name: 'Left' }).click();
  await expect(menu).toBeHidden();
  await expect.poll(async () => {
    const m = await minimap.boundingBox();
    const e = await window.locator('.explorer-viewer-monaco .monaco-editor').boundingBox();
    return m!.x < e!.x + e!.width / 2;
  }).toBe(true);
  expect((await window.evaluate(() => window.cc.config.get())).explorerMinimapSide).toBe('left');

  // Turn it off from the menu, then bring it back from the scrollbar's menu.
  await minimap.click({ button: 'right' });
  await menu.getByRole('menuitemcheckbox', { name: 'Minimap', exact: true }).click();
  await expect(minimap).toBeHidden();
  expect((await window.evaluate(() => window.cc.config.get())).explorerMinimapEnabled).toBe(false);
  await window.locator('.explorer-viewer-monaco .editor-scrollable > .scrollbar.vertical').click({ button: 'right' });
  await menu.getByRole('menuitemcheckbox', { name: 'Minimap', exact: true }).click();
  await expect(minimap).toBeVisible();
});

test('Explorer file icons follow the file icon theme setting', async ({ app, home }) => {
  const { window } = app;
  const root = join(home, 'explorer-icons');
  mkdirSync(root);
  writeFileSync(join(root, 'main.ts'), 'export {};\n');
  writeFileSync(join(root, 'notes.md'), '# notes\n');
  await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, root);

  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.getByRole('button', { name: 'Open explorer-icons', exact: true }).click();
  await window.getByTestId('project-nav-explorer').click();

  // Default: Seti glyphs, drawn with the bundled font under the app's CSP.
  const tsIcon = window.locator('.tree-row.file').filter({ hasText: 'main.ts' }).locator('.file-icon');
  const mdIcon = window.locator('.tree-row.file').filter({ hasText: 'notes.md' }).locator('.file-icon');
  await expect(tsIcon).toBeVisible();
  expect(await tsIcon.evaluate(el => getComputedStyle(el).fontFamily)).toContain('seti');
  await expect.poll(() => window.evaluate(() => document.fonts.check('16px seti'))).toBe(true);
  expect(await tsIcon.getAttribute('class')).not.toBe(await mdIcon.getAttribute('class'));

  // Minimal: one plain glyph; None: no icons. Applies live, and persists.
  await window.evaluate(() => window.cc.config.set({ explorerFileIconTheme: 'minimal' }));
  await expect(tsIcon).toHaveCount(0);
  await expect(window.locator('.tree-row.file').filter({ hasText: 'main.ts' }).locator('.tree-icon svg')).toHaveCount(1);
  await window.evaluate(() => window.cc.config.set({ explorerFileIconTheme: 'none' }));
  await expect(window.locator('.tree-row.file').filter({ hasText: 'main.ts' }).locator('.tree-icon svg, .file-icon')).toHaveCount(0);
  expect((await window.evaluate(() => window.cc.config.get())).explorerFileIconTheme).toBe('none');
});
