import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, type AppHandle } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

// One fenced block far taller than the viewer: the match sits at its very end,
// so scrolling the block's parent into view would not show the text.
const TALL_BLOCK = Array.from({ length: 400 }, (_, i) => `line ${i + 1} filler`).concat('final-needle-token here').join('\n');
const DOC = ['# Find in preview', '', 'Intro paragraph.', '', '```text', TALL_BLOCK, '```', '', 'Closing words.', ''].join('\n');

function route(page: Page, path: string) {
  return page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
}

async function addProject(app: AppHandle, home: string): Promise<{ id: string }> {
  const root = join(home, 'markdown find explorer');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'tall.md'), DOC);
  const id = await app.window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);
  return { id };
}

async function openTall(scope: Locator): Promise<Locator> {
  const folder = scope.locator('.tree-row.dir').filter({ hasText: /^docs$/ });
  await expect(folder).toBeVisible({ timeout: 15_000 });
  await folder.click();
  await scope.locator('.tree-row.file').filter({ hasText: 'tall.md' }).click();
  const preview = scope.locator('.explorer-md-preview');
  await expect(preview.getByRole('heading', { name: 'Find in preview' })).toBeVisible();
  return preview;
}

test('Ctrl+F in the Explorer markdown preview scrolls to a match inside a tall code block', async ({ app, home }) => {
  test.setTimeout(120_000);
  const page = app.window;
  const project = await addProject(app, home);
  await route(page, `/projects/${project.id}/explorer`);
  const scope = page.locator('.explorer-view').first();
  const preview = await openTall(scope);

  // Opening the preview from the tree leaves focus there; click into the text first.
  await preview.getByRole('heading', { name: 'Find in preview' }).click();
  await page.keyboard.press('Control+F');
  const input = scope.getByRole('searchbox', { name: 'Find in preview' });
  await expect(input).toBeFocused();
  await input.fill('final-needle-token');
  await expect(scope.getByTestId('dom-find-bar-count')).toHaveText('1/1');

  // The match itself, not just its block, is inside the visible scroll area.
  const where = await preview.evaluate((host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf('final-needle-token');
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 'final-needle-token'.length);
      const match = range.getBoundingClientRect();
      let scroller: Element | null = node.parentElement;
      while (scroller && !(getComputedStyle(scroller).overflowY.match(/auto|scroll/) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
      const box = (scroller ?? host).getBoundingClientRect();
      return { top: match.top, bottom: match.bottom, boxTop: box.top, boxBottom: box.bottom, scrolled: scroller?.scrollTop ?? 0 };
    }
    return null;
  });
  expect(where).not.toBeNull();
  expect(where!.scrolled).toBeGreaterThan(0);
  expect(where!.top).toBeGreaterThanOrEqual(where!.boxTop);
  expect(where!.bottom).toBeLessThanOrEqual(where!.boxBottom);

  // The bar stays inside the viewer while the document scrolls.
  const bar = scope.getByTestId('dom-find-bar');
  const barBox = await bar.boundingBox();
  const viewerBox = await scope.locator('.explorer-viewer').first().boundingBox();
  expect(barBox!.y).toBeGreaterThanOrEqual(viewerBox!.y);
  expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(viewerBox!.y + viewerBox!.height);

  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
});
