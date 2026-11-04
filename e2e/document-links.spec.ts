import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('Library and Explorer keep linked Markdown navigation inside built Electron', async ({ app, home }) => {
  test.setTimeout(120_000);
  const { window } = app;
  const root = join(home, 'linked-documents');
  mkdirSync(join(root, 'notes'), { recursive: true });
  const projectId = await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);
  const body = '# Link test A\n\n[B relative](b.md)\n\n[B explicit](./b.md)\n\n[B root](/test/b.md)\n\n[B heading](b.md#section-2)\n\n[Missing](missing.md)\n\n[Website](https://example.com)';
  const target = '# Link test B\n\n[Back](a.md)\n\n' + 'Paragraph.\n\n'.repeat(100) + '## Section 2\n\nTarget heading.\n';
  for (const scope of ['project', 'global'] as const) {
    await window.evaluate(async ({ scope, projectId, body, target }) => {
      const owner = scope === 'project' ? projectId : undefined;
      const destination = await window.cc.library.add({ scope, projectId: owner, relPath: 'test/b.md', title: 'Link test B', content: target });
      if (!destination?.absPath) throw new Error('Library target was not created');
      const source = await window.cc.library.add({ scope, projectId: owner, relPath: 'test/a.md', title: 'Link test A', content: `${body}\n\n[B file](file://${destination.absPath})` });
      if (!source) throw new Error('Library source was not created');
    }, { scope, projectId, body, target });
    const route = scope === 'project' ? `/projects/${projectId}/docs` : '/plugins/docs/panel/global/test/a.md';
    await window.evaluate(route => { history.pushState({}, '', route); dispatchEvent(new PopStateEvent('popstate')); }, route);
    if (scope === 'project') {
      await window.getByRole('button', { name: 'a.md', exact: true }).click();
    }
    const pane = window.locator('.library-viewer');
    await expect(pane.getByRole('heading', { name: 'Link test A', exact: true })).toBeVisible();
    const appUrl = window.url();
    for (const label of ['B relative', 'B explicit', 'B root', 'B heading', 'B file']) {
      await pane.getByRole('link', { name: label, exact: true }).click();
      await expect(pane.getByRole('heading', { name: 'Link test B', exact: true })).toBeAttached();
      if (label === 'B heading') {
        expect(await pane.getByRole('heading', { name: 'Section 2' }).evaluate(el => {
          const bounds = el.getBoundingClientRect();
          const scroller = el.closest('.explorer-md-preview')!.getBoundingClientRect();
          return bounds.top >= scroller.top && bounds.bottom <= scroller.bottom;
        })).toBe(true);
      }
      expect(window.url()).toBe(appUrl);
      await pane.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(pane.getByRole('heading', { name: 'Link test A', exact: true })).toBeVisible();
    }
    await pane.getByRole('link', { name: 'Missing', exact: true }).click();
    await expect(window.getByText('Linked document was not found in this library').last()).toBeVisible();
    expect(window.url()).toBe(appUrl);
    await pane.getByRole('button', { name: 'Edit', exact: true }).click();
    // The original report also reproduces in the actual TipTap rich editor.
    await pane.locator('[contenteditable=true]').getByRole('link', { name: 'B relative', exact: true }).click();
    await expect(pane.getByRole('heading', { name: 'Link test B', exact: true })).toBeVisible();
    expect(window.url()).toBe(appUrl);
  }

  writeFileSync(join(root, 'notes', 'a.md'), '# Explorer A\n\n[B](b.md#section-2)');
  writeFileSync(join(root, 'notes', 'b.md'), '# Explorer B\n\n[Back](a.md)\n\n## Section 2\n');
  await window.evaluate(id => { history.pushState({}, '', `/projects/${id}/explorer`); dispatchEvent(new PopStateEvent('popstate')); }, projectId);
  await window.locator('.tree-row.dir').getByTitle('notes', { exact: true }).click();
  await window.locator('.tree-row.file').getByTitle('a.md', { exact: true }).click();
  const viewer = window.locator('.explorer-viewer');
  await expect(viewer.getByRole('heading', { name: 'Explorer A' })).toBeVisible();
  const appUrl = window.url();
  await viewer.getByRole('link', { name: 'B', exact: true }).click();
  await expect(viewer.getByRole('heading', { name: 'Explorer B' })).toBeVisible();
  expect(window.url()).toBe(appUrl);
  await viewer.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(viewer.getByRole('heading', { name: 'Explorer A' })).toBeVisible();
});
