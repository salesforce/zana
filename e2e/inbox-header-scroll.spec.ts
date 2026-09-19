import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test.beforeEach(async ({ home }) => {
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
});

test('inbox message header stays visible and usable while its content scrolls', async ({ app }, testInfo) => {
  const page = app.window;
  await page.getByTestId('nav-inbox').click();
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
