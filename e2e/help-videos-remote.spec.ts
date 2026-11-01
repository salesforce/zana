import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import catalogue from '../content/videos/catalogue.json' with { type: 'json' };
const baselineClip = catalogue.videos.find(video => video.id === 'guided-start')!;

interface ContentRepo { url: string; requests: string[]; offline: boolean; invalid: boolean }
const test = base.extend<{ contentRepo: ContentRepo }>({
  contentRepo: async ({}, use) => {
    const clip = { ...baselineClip, id: 'published-after-install', title: 'Published without an app update' };
    const files = new Map<string, Buffer>();
    for (const asset of [clip.src, clip.poster, clip.captions]) {
      files.set(`/${asset.path}`, await readFile(fileURLToPath(new URL(`../${asset.path}`, import.meta.url))));
    }
    const repo: ContentRepo = { url: '', requests: [], offline: false, invalid: false };
    const server = createServer((req, res) => {
      repo.requests.push(req.url!);
      if (repo.offline) { res.writeHead(503).end(); return; }
      if (req.url === '/content/videos/catalogue.json') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(repo.invalid ? { version: 99 } : { version: 1, videos: [clip, { ...clip, id: 'future-only', title: 'Future only', minAppVersion: '999.0.0' }] }));
      } else {
        const bytes = files.get(req.url!);
        if (!bytes) { res.writeHead(404).end(); return; }
        res.setHeader('content-length', bytes.length); res.end(bytes);
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    repo.url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    try { await use(repo); }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  },
  launchEnv: async ({ contentRepo }, use) => { await use({ ZCC_E2E_HELP_VIDEOS_ORIGIN: contentRepo.url }); }
});
test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true, walkthroughCompleted: true } });

test('discovers a content-only video and plays, seeks, captions and saves it through the built host, including offline reuse', async ({ app, contentRepo }, testInfo) => {
  const page = app.window;
  await page.getByTestId('titlebar-help-toggle').click();
  const menu = page.getByRole('dialog', { name: 'Help' });
  const published = menu.getByRole('button', { name: 'Play Published without an app update, 0:30' });
  await expect(published).toBeVisible();
  await expect(menu.getByRole('button', { name: /Future only/ })).toHaveCount(0);
  await published.click();
  const player = page.getByTestId('help-video-player');
  await expect(player).toHaveAttribute('aria-label', 'Published without an app update');
  await expect.poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.2);
  expect(await player.evaluate((node: HTMLVideoElement) => node.duration)).toBeCloseTo(30, 0);
  expect(await player.evaluate((node: HTMLVideoElement) => node.error)).toBeNull();
  const src = await player.locator('source').getAttribute('src');
  const ranged = await page.request.get(new URL(src!, page.url()).href, { headers: { range: 'bytes=0-31' } });
  expect(ranged.status()).toBe(206); expect((await ranged.body()).length).toBe(32);
  const track = await player.locator('track').getAttribute('src');
  const captions = await page.request.get(new URL(track!, page.url()).href);
  expect(captions.headers()['content-type']).toContain('text/vtt'); expect(await captions.text()).toContain('WEBVTT');
  const save = page.getByRole('link', { name: 'Save video' });
  expect(await save.getAttribute('download')).toBe(clipFileName());
  const saved = await page.request.get(new URL((await save.getAttribute('href'))!, page.url()).href);
  expect(saved.headers()['content-type']).toContain('video/mp4'); expect((await saved.body()).length).toBe(baselineClip.src.bytes);
  await player.evaluate((node: HTMLVideoElement) => { node.currentTime = 28.5; });
  await expect(page.getByRole('button', { name: /Published without an app update/ })).toContainText('Watched');
  await page.screenshot({ path: testInfo.outputPath('repo-video-playing.png') });

  contentRepo.offline = true;
  const downloadsBefore = contentRepo.requests.filter(path => path.endsWith('.mp4')).length;
  await page.reload();
  await page.getByTestId('titlebar-help-toggle').click();
  await page.getByRole('button', { name: 'Play Published without an app update, 0:30, watched' }).click();
  await expect.poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.2);
  expect(contentRepo.requests.filter(path => path.endsWith('.mp4')).length).toBe(downloadsBefore);
});

test('an invalid repository catalogue leaves the bundled offline videos working', async ({ app, contentRepo }) => {
  contentRepo.invalid = true;
  const page = app.window;
  await page.getByTestId('titlebar-help-toggle').click();
  await expect.poll(() => contentRepo.requests.includes('/content/videos/catalogue.json')).toBe(true);
  await expect(page.getByRole('button', { name: /Play Published without/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Play Your first project/ }).click();
  const player = page.getByTestId('help-video-player');
  await expect.poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.2);
});

test('a browser without the Electron bridge uses the same catalogue and media endpoints', async ({ app, browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto(app.window.url());
    expect(await page.evaluate(() => 'cc' in window && window.cc != null)).toBe(false);
    await page.getByTestId('titlebar-help-toggle').click();
    await page.getByRole('button', { name: 'Play Published without an app update, 0:30' }).click();
    const player = page.getByTestId('help-video-player');
    await expect.poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.2);
    const track = await player.locator('track').getAttribute('src');
    expect((await page.request.get(new URL(track!, page.url()).href)).headers()['content-type']).toContain('text/vtt');
  } finally { await page.close(); }
});

function clipFileName() { return baselineClip.fileName; }
