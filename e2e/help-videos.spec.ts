import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_E2E_HELP_VIDEOS_ORIGIN: 'http://127.0.0.1:9/' }, initialConfig: { sponsorPromptDismissed: true, walkthroughCompleted: true } });

test('the title-bar Help menu keeps page hints and plays the bundled video catalogue', async ({ app }, testInfo) => {
  const page = app.window;
  const nativeWindow = await app.electron.browserWindow(page);
  await nativeWindow.evaluate((win) => { win.focus(); win.webContents.focus(); });
  const help = page.getByTestId('titlebar-help-toggle');
  await expect(help).toHaveClass(/is-active/);
  await help.click();
  const menu = page.getByRole('dialog', { name: 'Help' });
  await expect(menu.getByRole('switch', { name: /Page hints/ })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('help-menu.png') });

  // The repository seam is offline; the shipped media stays on the app origin.
  const origin = new URL(page.url()).origin;
  await menu.getByRole('button', { name: 'Play Your first project in 30 seconds, 0:30' }).click();
  await expect(menu).toHaveCount(0);
  const library = page.getByTestId('help-video-library');
  const video = library.getByTestId('help-video-player');
  await expect(video).toHaveAttribute('aria-label', 'Your first project in 30 seconds');
  for (const [selector, type] of [['source', 'video/mp4'], ['track', 'text/vtt']] as const) {
    const url = await video.locator(selector).getAttribute('src');
    expect(new URL(url!, page.url()).origin).toBe(origin);
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

  await library.getByRole('button', { name: /How to use a Squad/ }).click();
  await expect(video).toHaveAttribute('aria-label', 'How to use a Squad');
  const squadSource = await video.locator('source').getAttribute('src');
  expect(new URL(squadSource!, page.url()).origin).toBe(origin);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => ({
    hasMetadata: node.readyState > 0, networkState: node.networkState,
    currentSrc: node.currentSrc, error: node.error?.message ?? null
  })), { timeout: 10_000 }).toMatchObject({ hasMetadata: true });
  await library.getByRole('button', { name: /Use Zana everywhere/ }).click();
  await expect(video).toHaveAttribute('aria-label', 'Use Zana everywhere');
  expect(await video.evaluate((node: HTMLVideoElement) => node.muted)).toBe(false);

  // HTML video fullscreen has its own events; it need not enter native window
  // fullscreen. Observe the exact renderer window, including on macOS.
  await nativeWindow.evaluate((win) => {
    win.once('enter-html-full-screen', () => Reflect.set(win, 'helpEnteredFullscreen', true));
    win.once('leave-html-full-screen', () => Reflect.set(win, 'helpLeftFullscreen', true));
  });
  await library.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => nativeWindow.evaluate((win) => Reflect.get(win, 'helpEnteredFullscreen'))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') ?? null)).toBe('help-video-player');
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => nativeWindow.evaluate((win) => Reflect.get(win, 'helpLeftFullscreen'))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(library).toBeVisible();
  // fullscreenElement clears before fullscreenchange restores focus. Wait for
  // that handler so Chromium's video controls do not consume the next Escape.
  await expect(library.getByRole('button', { name: 'Full screen' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);

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
