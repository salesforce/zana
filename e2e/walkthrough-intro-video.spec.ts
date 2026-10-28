import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { walkthroughCompleted: false } });

test('first run opens the tour on the bundled intro video, which plays and leads into the steps', async ({ app }) => {
  const page = app.window;
  const dialog = page.getByTestId('walkthrough-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-walkthrough-step', 'intro');
  await expect(dialog.getByRole('heading', { name: 'Your first project in 30 seconds' })).toBeVisible();
  await expect(dialog.getByText('Step 1 of 5')).toBeVisible();

  // Media comes from the renderer bundle, never the network.
  const origin = new URL(page.url()).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const video = dialog.getByLabel('First project walkthrough video');
  await expect(video).toBeVisible();
  const box = await video.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  for (const [selector, attr, type] of [
    ['source', 'src', 'video/mp4'], ['track', 'src', 'text/vtt']
  ] as const) {
    const url = await video.locator(selector).getAttribute(attr);
    const response = await page.request.get(new URL(url!, page.url()).href);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain(type);
  }

  // Muted autoplay starts on its own and runs the full 30-second clip.
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.2);
  expect(await video.evaluate((node: HTMLVideoElement) => node.muted)).toBe(true);
  expect(await video.evaluate((node: HTMLVideoElement) => node.duration)).toBeCloseTo(30, 0);
  expect(await video.evaluate((node: HTMLVideoElement) => node.error)).toBeNull();
  await video.evaluate((node: HTMLVideoElement) => { node.textTracks[0].mode = 'showing'; });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.textTracks[0].cues?.length ?? 0)).toBe(7);

  await dialog.getByRole('button', { name: /Next/ }).click();
  await expect(dialog).toHaveAttribute('data-walkthrough-step', 'thread');
  await expect(video).toHaveCount(0);
  await expect(dialog.getByText('Step 2 of 5')).toBeVisible();
  await dialog.getByRole('button', { name: /Skip/ }).click();
  await expect(dialog).toHaveCount(0);
});
