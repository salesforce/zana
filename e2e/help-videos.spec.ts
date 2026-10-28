import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true, walkthroughCompleted: true } });

test('the title-bar Help menu keeps page hints and plays the bundled video catalogue', async ({ app }, testInfo) => {
  const page = app.window;
  const help = page.getByTestId('titlebar-help-toggle');
  await expect(help).toHaveClass(/is-active/);
  await help.click();
  const menu = page.getByRole('dialog', { name: 'Help' });
  await expect(menu.getByRole('switch', { name: /Page hints/ })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('help-menu.png') });

  // Media comes from the renderer bundle, never the network.
  const origin = new URL(page.url()).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await menu.getByRole('button', { name: 'Play Your first project in 30 seconds, 0:30' }).click();
  await expect(menu).toHaveCount(0);
  const library = page.getByTestId('help-video-library');
  const video = library.getByTestId('help-video-player');
  await expect(video).toHaveAttribute('aria-label', 'Your first project in 30 seconds');
  for (const [selector, type] of [['source', 'video/mp4'], ['track', 'text/vtt']] as const) {
    const url = await video.locator(selector).getAttribute('src');
    const response = await page.request.get(new URL(url!, page.url()).href);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain(type);
  }
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.2);
  expect(await video.evaluate((node: HTMLVideoElement) => node.duration)).toBeCloseTo(30, 0);
  expect(await video.evaluate((node: HTMLVideoElement) => node.error)).toBeNull();

  // Near the end the clip counts as watched, and that survives a reload.
  await video.evaluate((node: HTMLVideoElement) => { node.currentTime = 28.5; });
  await expect(library.getByRole('button', { name: /Your first project/ })).toContainText('Watched');
  await page.screenshot({ path: testInfo.outputPath('help-video-library.png') });

  // The app session grants HTML fullscreen, so the clip can fill the screen.
  await library.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') ?? null)).toBe('help-video-player');
  const windowFullScreen = () => app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isFullScreen()));
  await expect.poll(windowFullScreen).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  // Let the native window finish leaving fullscreen before the reload below.
  await expect.poll(windowFullScreen, { timeout: 10_000 }).toBe(false);
  await expect(library).toBeVisible();

  await library.getByRole('button', { name: /Use Zana everywhere/ }).click();
  await expect(video).toHaveAttribute('aria-label', 'Use Zana everywhere');
  expect(await video.evaluate((node: HTMLVideoElement) => node.muted)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(library).toHaveCount(0);
  await expect(help).toBeFocused();

  await page.reload();
  await help.click();
  await expect(menu.getByRole('button', { name: 'Play Your first project in 30 seconds, 0:30, watched' })).toBeVisible();
  await menu.getByRole('button', { name: 'Replay walkthrough' }).click();
  const tour = page.getByTestId('walkthrough-dialog');
  await expect(tour).toHaveAttribute('data-walkthrough-step', 'intro');
  await tour.getByRole('button', { name: /Skip/ }).click();
  await expect(help).toHaveClass(/is-active/);
});
