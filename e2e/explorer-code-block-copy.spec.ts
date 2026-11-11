import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, type AppHandle } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

// Tabs, entities, a blank inner line and a deliberate blank last line: all
// must survive the copy exactly; only the newline before the closing fence goes.
const CODE = [
  'function greet(name) {',
  '\tconst msg = `Hi ${name} & <friends>`;',
  '',
  '    return msg; // it’s fine',
  '}',
  ''
].join('\n');
const LONG_LINE = 'const wide = "' + 'x'.repeat(800) + '";';
const DOC = [
  '# Code copy',
  '',
  '```js', CODE, '```',
  '',
  '```text', LONG_LINE, '```',
  '',
  '```mermaid', 'graph TD; A-->B', '```',
  ''
].join('\n');

/** The desktop session denies Chromium's clipboard, so read the real system clipboard from main. */
function systemClipboard(app: AppHandle) {
  return {
    read: () => app.electron.evaluate(({ clipboard }) => clipboard.readText()),
    write: (text: string) => app.electron.evaluate(({ clipboard }, text) => clipboard.writeText(text), text)
  };
}

function route(page: Page, path: string) {
  return page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
}

async function addProject(app: AppHandle, home: string): Promise<{ id: string }> {
  const root = join(home, 'code copy explorer');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'snippets.md'), DOC);
  const id = await app.window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);
  return { id };
}

async function openSnippets(scope: Locator): Promise<Locator> {
  const folder = scope.locator('.tree-row.dir').filter({ hasText: /^docs$/ });
  await expect(folder).toBeVisible({ timeout: 15_000 });
  await folder.click();
  await scope.locator('.tree-row.file').filter({ hasText: 'snippets.md' }).click();
  const preview = scope.locator('.explorer-md-preview');
  await expect(preview.getByRole('heading', { name: 'Code copy' })).toBeVisible();
  return preview;
}

/** Keyboard then mouse copy of the first block; the exact text must reach the system clipboard. */
async function expectExactCopy(app: AppHandle, preview: Locator) {
  const blocks = preview.locator('.inbox-md-codeblock');
  await expect(blocks).toHaveCount(2); // js + long line; the mermaid fence has none
  await expect(preview.locator('pre code.language-mermaid')).toHaveCount(1);
  const block = blocks.first();
  const button = block.getByRole('button', { name: 'Copy code' });
  const pre = block.locator('pre');
  const before = await pre.boundingBox();
  const clipboard = systemClipboard(app);

  await clipboard.write('');
  // A keyboard user arrives by key, so :focus-visible applies to the focus
  // that follows; after a mouse click a scripted focus() alone wouldn't match it.
  await app.window.keyboard.press('Shift');
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('opacity', '1');
  await app.window.keyboard.press('Enter');
  await expect(button).toHaveAttribute('data-state', 'copied');
  await expect(block.getByRole('status')).toHaveText('Copied');
  await expect.poll(clipboard.read).toBe(CODE);

  await clipboard.write('other');
  await block.hover();
  await button.click();
  await expect.poll(clipboard.read).toBe(CODE);
  const after = await pre.boundingBox();
  expect(after && { w: after.width, h: after.height }).toEqual(before && { w: before.width, h: before.height });
}

/** The long block scrolls sideways while the button stays at the wrapper's top-right corner. */
async function expectPinnedWhileScrolling(app: AppHandle, preview: Locator) {
  const block = preview.locator('.inbox-md-codeblock').nth(1);
  const pre = block.locator('pre');
  const button = block.getByRole('button', { name: 'Copy code' });
  expect(await pre.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await block.hover();
  const offset = () => button.evaluate(el => {
    const wrap = el.parentElement!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { right: Math.round(wrap.right - box.right), top: Math.round(box.top - wrap.top) };
  });
  const before = await offset();
  await pre.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await pre.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await offset()).toEqual(before);
  const clipboard = systemClipboard(app);
  await clipboard.write('');
  await button.click();
  await expect.poll(clipboard.read).toBe(LONG_LINE);
  await pre.evaluate(el => { el.scrollLeft = 0; });
}

for (const theme of ['light', 'dark'] as const) {
  test(`Explorer markdown preview copies fenced code exactly (${theme})`, async ({ app, home }, testInfo) => {
    test.setTimeout(120_000);
    const page = app.window;
    await page.evaluate(theme => window.cc.config.set({ theme }), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const project = await addProject(app, home);
    await route(page, `/projects/${project.id}/explorer`);
    const preview = await openSnippets(page.locator('.explorer-view').first());
    await expectExactCopy(app, preview);
    await expectPinnedWhileScrolling(app, preview);
    await preview.locator('.inbox-md-codeblock').first().hover();
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`explorer-${theme}.png`), preview);
  });
}

test('thread side-panel Explorer tab copies fenced code exactly', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const page = app.window;
  const project = await addProject(app, home);
  const threadId = await page.evaluate(async projectId => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Explorer copy', input: 'hello' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).value.id as string;
  }, project.id);
  await route(page, `/threads/${threadId}`);
  await expect(page.getByTestId('thread-detail')).toBeVisible({ timeout: 15_000 });
  // Let the fake turn finish first, so the thread doesn't move focus mid-check.
  await expect(page.getByTestId('thread-assistant-text').filter({ hasText: 'Response to: hello' })).toBeVisible({ timeout: 30_000 });
  const show = page.getByTestId('thread-secondary-show');
  if (await show.count()) await show.click();
  await openThreadToolLauncher(page);
  await page.getByTestId('thread-new-tab-explorer').click();
  const tab = page.getByTestId('thread-explorer-tab');
  await expect(tab).toBeVisible();
  const preview = await openSnippets(tab);
  await expectExactCopy(app, preview);
  await expectPinnedWhileScrolling(app, preview);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('thread-side-panel-explorer.png'), tab);
});
