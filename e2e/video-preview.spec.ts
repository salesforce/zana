import { copyFileSync, mkdirSync, openSync, closeSync, writeSync, ftruncateSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('video previews stream large files, play and seek in built Electron', async ({ app }, testInfo) => {
  const { window, home } = app;
  const projectPath = join(home, 'video-project');
  mkdirSync(projectPath);
  const path = join(projectPath, 'demo #1.mp4');
  // Tiny deterministic H.264 fixture plus a legal MP4 free box above both read caps.
  // Generated with ffmpeg testsrc2=size=160x90:rate=12, -t 4, libx264, yuv420p, +faststart.
  copyFileSync(fileURLToPath(new URL('./fixtures/preview-video.mp4', import.meta.url)), path);
  const originalSize = statSync(path).size;
  const padding = 12 * 1024 * 1024;
  const fd = openSync(path, 'r+');
  try {
    const box = Buffer.alloc(8);
    box.writeUInt32BE(padding);
    box.write('free', 4);
    writeSync(fd, box, 0, box.length, originalSize);
    ftruncateSync(fd, originalSize + padding);
  } finally { closeSync(fd); }
  const threadId = await window.evaluate(async (projectPath) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Video preview test' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, projectPath);
  await window.evaluate(({ threadId, path }) => {
    localStorage.setItem(`zcc.secondaryPanel.${threadId}`, JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 480, activeId: 'video',
      tabs: [{ id: 'video', kind: 'file-preview', path, title: 'demo #1.mp4' }]
    }));
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, { threadId, path });
  const video = window.getByLabel('Video preview: demo #1.mp4');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => ({
    error: node.error?.message ?? null, width: node.videoWidth, duration: node.duration
  }))).toEqual({ error: null, width: 160, duration: 4 });
  expect(await video.evaluate((node: HTMLVideoElement) => node.controls && node.paused && !node.autoplay)).toBe(true);
  await video.evaluate(async (node: HTMLVideoElement) => { node.muted = true; await node.play(); });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1);
  await video.evaluate((node: HTMLVideoElement) => { node.pause(); node.currentTime = 2.5; });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => !node.seeking && node.readyState >= 2)).toBe(true);
  expect(await video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(2.5, 1);

  const tail = await video.evaluate(async (node: HTMLVideoElement) => {
    const response = await fetch(node.src, { headers: { Range: 'bytes=-32' } });
    return { status: response.status, range: response.headers.get('content-range'), length: (await response.arrayBuffer()).byteLength };
  });
  expect(tail).toEqual({ status: 206, range: `bytes ${originalSize + padding - 32}-${originalSize + padding - 1}/${originalSize + padding}`, length: 32 });
  await window.getByTestId('thread-secondary-maximize').click();
  await expect(video).toBeVisible();
  expect(await video.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(480);
  await window.screenshot({ path: testInfo.outputPath('video-preview.png') });

  // Thread storage uses the same player through the server's confined local reader.
  const storage = join(home, '.zcc', 'thread-storage', threadId);
  mkdirSync(storage, { recursive: true });
  copyFileSync(path, join(storage, 'stored.mp4'));
  const openStorage = async (name: string) => window.evaluate(async ({ threadId, name }) => {
    const response = await fetch(`/api/v1/threads/${threadId}/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: { path: name, source: 'thread-storage' } })
    });
    if (!response.ok) throw new Error(await response.text());
  }, { threadId, name });
  await openStorage('stored.mp4');
  const stored = window.getByLabel('Video preview: stored.mp4');
  await expect.poll(() => stored.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(160);
  writeFileSync(join(storage, 'broken.mp4'), 'not a video');
  await openStorage('broken.mp4');
  await expect(window.getByRole('status').filter({ hasText: 'Could not play this video' })).toBeVisible();
  await expect(window.getByTestId('thread-secondary-panel')).not.toContainText('file exceeds the read cap');
});
