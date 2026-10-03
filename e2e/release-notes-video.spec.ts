import { test, expect } from './fixtures/app.js';
import { readFileSync } from 'node:fs';

const releaseVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test.use({ e2e: true, initialConfig: { lastSeenVersion: '2.2.0' } });

test('updated users see current notes and can play older bundled release videos with captions', async ({ app }) => {
  const page = app.window;
  // Unpackaged Electron reports its own version here; shipped builds report
  // Zana's version. Both use the same main-owned update notification path.
  const runningVersion = await app.electron.evaluate(({ app: electronApp }) => electronApp.getVersion());
  const dialogTitle = `What’s new in v${runningVersion}`;
  let dialog = page.getByRole('dialog', { name: dialogTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: `What's new in ${releaseVersion}`, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Got it' }).click();
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('dialog', { name: dialogTitle })).toHaveCount(0);

  // The update card shows only the newest release. Media stays attached to its
  // original version and remains accessible through the full release history.
  const support = page.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible()) await support.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-nav-about').click();
  await page.getByRole('button', { name: 'What’s new', exact: true }).click();
  dialog = page.getByRole('dialog', { name: `What’s new in v${releaseVersion}`, exact: true });
  await expect(dialog).toBeVisible();
  const video = dialog.getByLabel('Use Zana everywhere walkthrough');
  await expect(video).toBeVisible();
  expect(await video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);

  // Keep loopback available while blocking the internet: the shipping player,
  // poster, captions, and media bytes must all come from the bundled renderer.
  const origin = new URL(page.url()).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const source = await video.locator('source').getAttribute('src');
  const poster = await video.getAttribute('poster');
  const captions = await video.locator('track').getAttribute('src');
  for (const [url, type] of [[source, 'video/mp4'], [poster, 'image/jpeg'], [captions, 'text/vtt']] as const) {
    const response = await page.request.get(new URL(url!, page.url()).href);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain(type);
  }
  const partial = await page.request.get(new URL(source!, page.url()).href, { headers: { Range: 'bytes=-256' } });
  expect(partial.status()).toBe(206);
  expect(partial.headers()['accept-ranges']).toBe('bytes');
  expect((await partial.body()).length).toBe(256);

  // A gesture inside the modal makes playback user-initiated; no autoplay.
  await dialog.locator('figcaption').getByRole('heading', { name: 'Use Zana everywhere' }).click();
  await video.evaluate(async (node: HTMLVideoElement) => {
    node.textTracks[0].mode = 'showing';
    await node.play();
  });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.2);
  expect(await video.evaluate((node: HTMLVideoElement) => node.duration)).toBeCloseTo(64, 0);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.textTracks[0].cues?.length ?? 0)).toBe(7);
  await video.evaluate((node: HTMLVideoElement) => { node.pause(); node.currentTime = 58; });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.seeking)).toBe(false);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(58, 0);
  expect(await video.evaluate((node: HTMLVideoElement) => node.error)).toBeNull();
  await dialog.getByRole('button', { name: 'Got it' }).click();
  await expect(video).toHaveCount(0);
});
