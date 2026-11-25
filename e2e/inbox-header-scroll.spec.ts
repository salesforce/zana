import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test.beforeEach(async ({ home }, testInfo) => {
  const inboxDir = join(home, '.zcc', 'inbox');
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(join(inboxDir, 'entries.jsonl'), `${JSON.stringify({
    id: 'scrollable-report',
    projectId: 'proj-e2e',
    ts: Date.now(),
    subject: 'Long inbox report',
    comments: Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: Report content that scrolls beneath the message header.`).join('\n\n'),
    report: true
  })}\n`);
  if (testInfo.title.includes('bounded Inbox pages')) {
    writeFileSync(join(inboxDir, 'entries.jsonl'), Array.from({ length: 5000 }, (_, index) => JSON.stringify({
      id: `page-${index}`, projectId: 'proj-e2e', ts: Date.now() - (5000 - index) * 1000, subject: `Paged report ${index}`, comments: 'x'.repeat(8192), report: true
    })).join('\n') + '\n');
  }
});

test('bounded Inbox pages preserve cursors through built Electron HTTP and UI', async ({ app }) => {
  const page = app.window;
  const read = (query: string) => page.evaluate(async query => {
    const response = await fetch(`/api/v1/inbox?${query}`);
    return { status: response.status, data: await response.json() };
  }, query);
  const first = await read('limit=100&projectId=proj-e2e');
  expect(first.status).toBe(200);
  expect(first.data.entries).toHaveLength(100);
  expect(first.data.entries[0].id).toBe('page-4999');
  expect(first.data.hasMore).toBe(true);
  const second = await read(`limit=100&projectId=proj-e2e&before=${first.data.entries.at(-1).id}`);
  expect(second.data.entries[0].id).toBe('page-4899');
  expect(second.data.entries).toHaveLength(100);
  await page.getByTestId('nav-inbox').click();
  await expect(page.getByRole('button', { name: /Paged report 4999/ })).toBeVisible();
});

test('inbox message header stays visible and usable while its content scrolls', async ({ app }, testInfo) => {
  const page = app.window;
  await page.getByTestId('nav-inbox').click();
  await page.getByRole('button', { name: 'Split view', exact: true }).click();
  await page.locator('.inbox-row').filter({ hasText: 'Long inbox report' }).click();
  const pane = page.locator('.inbox-view-detail');
  const header = pane.locator('.inbox-detail-header');
  const title = pane.locator('.inbox-detail-title');

  // Exercise both a single-line toolbar and the wrapped layout in each theme.
  for (const { width, theme } of [
    { width: 1600, theme: 'light' },
    { width: 1000, theme: 'light' },
    { width: 1600, theme: 'dark' },
    { width: 1000, theme: 'dark' },
  ] as const) {
    await page.evaluate((theme) => window.cc.config.set({ theme }), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await app.electron.evaluate(({ BrowserWindow }, nextWidth) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.getURL().startsWith('devtools:'))!;
      main.webContents.setZoomFactor(1);
      main.setContentSize(nextWidth, 800);
    }, width);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
    await pane.evaluate((el) => { el.scrollTop = 0; });
    await expect(title).toBeInViewport();
    const initialHeader = (await header.boundingBox())!;

    for (const fraction of [0.5, 1]) {
      await pane.evaluate((el, f) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * f; }, fraction);
      await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
      await expect(title).not.toBeInViewport();
      await expect(header).toBeInViewport({ ratio: 1 });
      await expect.poll(async () => (await header.boundingBox())!.y).toBeCloseTo(initialHeader.y, 0);
      expect(await header.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');

      // Scrolled content must not paint or intercept clicks over the toolbar.
      const keep = header.getByRole('button', { name: 'Keep this entry', exact: true });
      await keep.click();
      await expect(header.getByRole('button', { name: 'Remove keep flag' })).toHaveAttribute('aria-pressed', 'true');
      await header.getByRole('button', { name: 'Remove keep flag' }).click();
      await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
    }
    await page.screenshot({ path: testInfo.outputPath(`inbox-scrolled-${width}-${theme}.png`) });
  }

  await header.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(header).toHaveCount(0);
  await expect(pane.locator('.inbox-overview')).toBeVisible();
});
