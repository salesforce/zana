import { test, expect } from './fixtures/app.js';
import type { ElectronApplication, Page } from '@playwright/test';

test.skip(process.platform !== 'darwin', 'Command Center is a macOS surface');
test.use({ initialConfig: { companionEnabled: true } });

async function part(electron: ElectronApplication, name: string): Promise<Page> {
  let page: Page | undefined;
  await expect.poll(() => !!(page = electron.windows().find(p =>
    p.url().includes('surface=companion') && p.url().includes(`part=${name}`)))).toBe(true);
  await page!.waitForSelector('#root');
  return page!;
}

/** Sample the native compositor, including alpha, at a CSS point. */
async function pixel(electron: ElectronApplication, page: Page, point: { x: number; y: number }) {
  const native = await electron.browserWindow(page);
  try {
    return await native.evaluate(async (win, point) => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const zoom = win.webContents.getZoomFactor();
        const image = await Promise.race([
          win.webContents.capturePage({ x: Math.floor(point.x * zoom), y: Math.floor(point.y * zoom), width: 1, height: 1 },
            { stayHidden: true, stayAwake: true }),
          new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Companion pixel capture timed out')), 15_000); })
        ]);
        // Native bitmap byte order is BGRA on this macOS surface.
        return Array.from(image.toBitmap().subarray(0, 4));
      } finally { clearTimeout(deadline); }
    }, point);
  } finally { await native.dispose(); }
}

test('companion surfaces block underlying text in both themes while outer margins stay transparent', async ({ app }) => {
  const { window, electron } = app;
  // Activate the isolated app before entering: synthetic clicks do not activate
  // NSPanel windows, and background compositing can leave animations paused.
  await electron.evaluate(({ app }) => app.focus({ steal: true }));
  expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
  const rail = await part(electron, 'rail');
  await rail.getByRole('button', { name: /^Status:/ }).click();
  const panel = await part(electron, 'panel');
  await expect(panel.locator('.cc-card')).toBeVisible();
  await expect.poll(() => panel.locator('.cc-card').evaluate(el =>
    el.getAnimations().some(animation => animation.playState === 'running'))).toBe(false);

  for (const theme of ['dark', 'light'] as const) {
    await window.evaluate(theme => window.cc.config.set({ theme }), theme);
    const expected = theme === 'dark' ? [30, 30, 30, 255] : [255, 255, 255, 255];
    for (const [page, selector] of [[rail, '.cc-rail'], [panel, '.cc-card']] as const) {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const sample = await page.locator(selector).evaluate(el => {
        const box = el.getBoundingClientRect();
        return { x: box.left + 4, y: box.top + 30 };
      });
      // Alpha must be 255: matching RGB alone misses desktop bleed-through.
      await expect.poll(() => pixel(electron, page, sample)).toEqual(expected);
    }
    // Sample the far side of the large transparent panel window, away from
    // its card and shadow. Making the entire BrowserWindow opaque is no fix.
    const margin = await panel.locator('.cc-card').evaluate(el => {
      const box = el.getBoundingClientRect();
      return { x: box.left > innerWidth - box.right ? 1 : innerWidth - 2, y: 1 };
    });
    expect((await pixel(electron, panel, margin))[3]).toBe(0);
  }
});
