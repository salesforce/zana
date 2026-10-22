import { test, expect } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('Explorer reveals a Quick Open file in the tree without taking focus', async ({ app, home }) => {
  const { window } = app;
  const root = join(home, 'explorer reveal');
  const deep = join(root, 'src', 'feature', 'nested');
  mkdirSync(deep, { recursive: true });
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
  // Enough siblings that the target sits below the tree pane's fold.
  for (let i = 0; i < 80; i++) writeFileSync(join(deep, `a${String(i).padStart(2, '0')}.ts`), `export const v${i} = ${i};\n`);
  writeFileSync(join(deep, 'target.ts'), 'export const revealed = true;\n');
  await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, root);

  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.getByRole('button', { name: 'Open explorer reveal', exact: true }).click();
  await window.getByTestId('project-nav-explorer').click();
  await expect(window.locator('.tree-row.dir').filter({ hasText: 'src' })).toBeVisible();

  await window.keyboard.press('ControlOrMeta+e');
  await window.locator('.palette-input').fill('target.ts');
  await expect(window.locator('.palette-label').filter({ hasText: 'target.ts' })).toBeVisible();
  await window.keyboard.press('Enter');

  const row = window.locator('.tree-row.file[aria-current="true"]');
  await expect(row).toHaveText('target.ts');
  await expect(window.locator('.explorer-viewer-monaco .monaco-editor')).toContainText('revealed');
  for (const folder of ['src', 'feature', 'nested']) {
    await expect(window.locator('.tree-row.dir').filter({ hasText: new RegExp(`^${folder}$`) }).locator('.lucide-chevron-down')).toBeVisible();
  }
  // Untouched siblings stay collapsed.
  await expect(window.locator('.tree-row.file').filter({ hasText: 'guide.md' })).toHaveCount(0);
  // The row is scrolled into the tree pane, and focus is not in the tree.
  await expect.poll(() => row.evaluate(el => {
    const pane = el.closest('.explorer-tree-body')!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return box.top >= pane.top && box.bottom <= pane.bottom;
  })).toBe(true);
  expect(await window.evaluate(() => !!document.activeElement?.closest('.explorer-tree'))).toBe(false);
});
