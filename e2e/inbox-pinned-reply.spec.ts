import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test.beforeEach(async ({ home }) => {
  const inboxDir = join(home, '.zcc', 'inbox');
  mkdirSync(inboxDir, { recursive: true });
  // A registered project makes the entries replyable (reopen shell) instead of "Project no longer exists".
  const root = join(home, 'proj-e2e-root');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify({
    version: 1,
    projects: [{ id: 'proj-e2e', name: 'Reply project', path: root, createdAt: Date.now(), lastActiveAt: Date.now() }]
  }));
  const now = Date.now();
  const entries = [
    {
      id: 'long-report', projectId: 'proj-e2e', ts: now, subject: 'Long inbox report', report: true,
      comments: Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: Report content that scrolls beneath the pinned reply bar.`).join('\n\n')
    },
    { id: 'short-report', projectId: 'proj-e2e', ts: now - 1000, subject: 'Short inbox report', report: true, comments: 'Just one short paragraph.' }
  ];
  writeFileSync(join(inboxDir, 'entries.jsonl'), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
});

const openEntry = async (page: Page, subject: string) => {
  await page.locator('.inbox-row').filter({ hasText: subject }).click();
  await expect(page.locator('.inbox-detail-title')).toContainText(subject);
};
const scrollTo = (pane: Locator, fraction: number) =>
  pane.evaluate((el, f) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * f; }, fraction);
const height = (box: Locator) => box.evaluate((el) => el.getBoundingClientRect().height);

test('reply bar stays pinned at every scroll position, width and theme', async ({ app }) => {
  const page = app.window;
  await page.getByTestId('nav-inbox').click();
  await openEntry(page, 'Long inbox report');
  const pane = page.locator('.inbox-view-detail');
  const dock = pane.locator('.inbox-detail-dock');

  for (const { width, theme } of [
    { width: 1600, theme: 'light' }, { width: 1000, theme: 'light' },
    { width: 1600, theme: 'dark' }, { width: 1000, theme: 'dark' }
  ] as const) {
    await page.evaluate((theme) => window.cc.config.set({ theme }), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await app.electron.evaluate(({ BrowserWindow }, nextWidth) => {
      const main = BrowserWindow.getAllWindows().find((c) => !c.webContents.getURL().startsWith('devtools:'))!;
      main.webContents.setZoomFactor(1);
      main.setContentSize(nextWidth, 800);
    }, width);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);

    let pinnedTop: number | null = null;
    for (const fraction of [0, 0.5, 1]) {
      await scrollTo(pane, fraction);
      await expect.poll(async () => {
        const p = (await pane.boundingBox())!;
        const d = (await dock.boundingBox())!;
        return d.y >= p.y - 1 && d.y + d.height <= p.y + p.height + 1;
      }).toBe(true);
      const top = (await dock.boundingBox())!.y;
      pinnedTop ??= top;
      expect(Math.abs(top - pinnedTop)).toBeLessThanOrEqual(1);
      expect(await dock.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    }
    // At the end the last paragraph is fully visible above the dock.
    const last = pane.getByText('Paragraph 80:');
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual((await dock.boundingBox())!.y + 1);
  }
});

test('reply box grows to a cap, Esc/R round-trip, quote and the draft survives switching entries', async ({ app }) => {
  const page = app.window;
  await app.electron.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((c) => !c.webContents.getURL().startsWith('devtools:'))!;
    main.webContents.setZoomFactor(1);
    main.setContentSize(1400, 800);
  });
  await page.getByTestId('nav-inbox').click();
  await openEntry(page, 'Long inbox report');
  const pane = page.locator('.inbox-view-detail');
  const input = pane.getByLabel('Reply to the originating agent');
  await scrollTo(pane, 0);

  // 2. Growth and cap.
  await pane.getByRole('button', { name: 'Leave a reply' }).click();
  await expect(input).toBeFocused();
  const initial = await height(input);
  await input.fill('one\ntwo\nthree\nfour\nfive');
  await expect.poll(() => height(input)).toBeGreaterThan(initial);
  await input.fill(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'));
  const innerHeight = await page.evaluate(() => window.innerHeight);
  await expect.poll(() => height(input)).toBeLessThanOrEqual(innerHeight * 0.4 + 1);
  expect(await input.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  // 3. Esc leaves the box, R comes back with the text intact.
  await input.press('Escape');
  await expect(input).not.toBeFocused();
  await page.keyboard.press('r');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(/^line 1\n/);

  // 4. Quote a paragraph.
  await input.fill('');
  await input.press('Escape');
  const paragraph = pane.locator('.inbox-detail-comments').getByText('Paragraph 3:');
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.click({ clickCount: 3 });
  const quote = page.getByRole('button', { name: 'Quote in reply' });
  await expect(quote).toBeVisible();
  await quote.click();
  await expect(input).toHaveValue(/^> Paragraph 3: .*\n- $/);
  await expect(input).toBeFocused();

  // 5. The draft survives another entry.
  const draft = await input.inputValue();
  await openEntry(page, 'Short inbox report');
  await openEntry(page, 'Long inbox report');
  await expect(pane.getByLabel('Reply to the originating agent')).toHaveValue(draft);

});

test('a short message keeps its dock right under the text, not at the pane bottom', async ({ app }) => {
  const page = app.window;
  await page.getByTestId('nav-inbox').click();
  await openEntry(page, 'Short inbox report');
  const pane = page.locator('.inbox-view-detail');
  const dock = pane.locator('.inbox-detail-dock');
  const paneBox = (await pane.boundingBox())!;
  const dockBox = (await dock.boundingBox())!;
  const textBox = (await pane.getByText('Just one short paragraph.').boundingBox())!;
  expect(dockBox.y).toBeLessThan(textBox.y + textBox.height + 150);
  expect(dockBox.y + dockBox.height).toBeLessThan(paneBox.y + paneBox.height - 100);
});
