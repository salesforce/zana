import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, isolateBundledCatalog: true });

test.beforeEach(async ({ home }) => {
  const projects = Array.from({ length: 35 }, (_, index) => {
    const id = `picker-${index}`;
    const path = join(home, id);
    mkdirSync(path);
    return { id, path, name: `Project ${String(index).padStart(2, '0')} with a longer name`, createdAt: Date.now(), lastActiveAt: Date.now() };
  });
  mkdirSync(join(home, '.zcc', 'inbox'), { recursive: true });
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify({ version: 1, projects }));
  copyFileSync(fileURLToPath(new URL('./fixtures/preview-video.mp4', import.meta.url)), join(projects[0].path, 'demo #1.mp4'));
  writeFileSync(join(projects[0].path, 'broken.mp4'), 'not a video');
  writeFileSync(join(home, '.zcc', 'inbox', 'entries.jsonl'), JSON.stringify({
    id: 'video-report', projectId: projects[0].id, ts: Date.now(), subject: 'Video report',
    comments: 'Review the recording.', docs: [{ path: 'demo #1.mp4' }, { path: 'broken.mp4' }]
  }) + '\n');
});

test('mobile project selection scrolls and fits the keyboard; inbox videos play and seek', async ({ app }, testInfo) => {
  test.setTimeout(150_000);
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Picker and videos' } });
    const credential = await pair.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    await page.goto(`${serverUrl}/threads/new`);
    const trigger = page.getByRole('button', { name: 'Machine and project', exact: true });
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 844 });
      await trigger.tap();
      const dialog = page.getByRole('dialog', { name: 'Choose project', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Close project picker' })).toBeFocused();
      await expect(dialog.getByRole('button', { name: /› Default Project General tasks on/ })).toBeVisible();
      const list = dialog.locator('.mobile-project-picker-list');
      const box = (await list.boundingBox())!;
      const cdp = await context.newCDPSession(page);
      try {
        const x = box.x + box.width / 2;
        const y = box.y + box.height - 30;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (const distance of [30, 60, 90, 120, 150]) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally { await cdp.detach(); }
      await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(20);
      await expect(dialog).toBeVisible();
      await page.setViewportSize({ width, height: 360 });
      const search = dialog.getByRole('searchbox', { name: 'Search machines or projects…' });
      await search.fill('Project 34');
      const project = dialog.getByRole('button', { name: /› Project 34 with a longer name/ });
      for (const control of [dialog, search, project, dialog.getByRole('button', { name: /^Add project on / })]) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(360);
      }
      expect((await project.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath(`project-picker-${width}.png`) });
      await project.tap();
      await expect(dialog).toBeHidden();
      await expect(trigger).toContainText('Project 34');
      await expect(trigger).toBeFocused();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${serverUrl}/inbox`);
    await page.locator('.inbox-row').filter({ hasText: 'Video report' }).click();
    await expect(page.locator('video')).toHaveCount(0);
    await page.getByRole('button', { name: 'demo #1.mp4', exact: true }).tap();
    const video = page.getByLabel('Video preview: demo #1.mp4');
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => ({ width: node.videoWidth, duration: node.duration, error: node.error?.message ?? null }))).toEqual({ width: 160, duration: 4, error: null });
    expect(await video.evaluate((node: HTMLVideoElement) => node.controls && node.playsInline && !node.autoplay)).toBe(true);
    await video.evaluate(async (node: HTMLVideoElement) => { node.muted = true; await node.play(); });
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1);
    await video.evaluate((node: HTMLVideoElement) => { node.pause(); node.currentTime = 2.5; });
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => !node.seeking && node.readyState >= 2)).toBe(true);
    expect(await video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(2.5, 1);
    const range = await video.evaluate(async (node: HTMLVideoElement) => {
      const response = await fetch(node.src, { headers: { Range: 'bytes=0-31' } });
      return { status: response.status, length: (await response.arrayBuffer()).byteLength };
    });
    expect(range).toEqual({ status: 206, length: 32 });
    await page.screenshot({ path: testInfo.outputPath('inbox-video-mobile.png') });
    await page.getByRole('button', { name: 'demo #1.mp4', exact: true }).tap();
    await expect(video).toHaveCount(0);
    await page.getByRole('button', { name: 'broken.mp4', exact: true }).tap();
    await expect(page.getByRole('status').filter({ hasText: 'Could not play this video' })).toBeVisible();
    // The same inbox component plays recordings in the built desktop window.
    await app.window.getByRole('link', { name: /^Inbox(?: \d+ unread)?$/ }).click();
    await app.window.locator('.inbox-row').filter({ hasText: 'Video report' }).click();
    const desktopVideo = app.window.getByLabel('Video preview: demo #1.mp4');
    await expect.poll(() => desktopVideo.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(160);
    await page.goto(`${serverUrl}/threads/new`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await trigger.click();
    await expect(page.getByRole('listbox', { name: 'Machine and project', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Choose project' })).toHaveCount(0);
  } finally {
    await browser.close();
    await gateway.close();
  }
});
