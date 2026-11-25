import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium, type Locator } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, isolateBundledCatalog: true });

const pngPath = 'e2e/artifacts/run/screenshot #1.PNG';
test.beforeEach(async ({ home }) => {
  const root = join(home, 'image-project');
  mkdirSync(join(root, 'e2e/artifacts/run'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(home, '.zcc/inbox'), { recursive: true });
  writeFileSync(join(home, '.zcc/projects.json'), JSON.stringify({ version: 1, projects: [
    { id: 'images', name: 'Image project', path: root, createdAt: Date.now(), lastActiveAt: Date.now() }
  ] }));
  writeFileSync(join(root, pngPath), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPf8AAAAASUVORK5CYII=', 'base64'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#1677c8"/><circle cx="600" cy="400" r="200" fill="#bce9fa"/></svg>';
  writeFileSync(join(root, 'illustration.svg'), svg);
  writeFileSync(join(root, 'docs/relocated.svg'), svg);
  writeFileSync(join(root, 'broken.png'), 'not an image');
  writeFileSync(join(root, 'report.md'), '# Report remains readable');
  writeFileSync(join(home, '.zcc/inbox/entries.jsonl'), JSON.stringify({
    id: 'image-report', projectId: 'images', ts: Date.now(), subject: 'Image attachment regression',
    comments: 'Screenshots and illustrations attached.',
    docs: [pngPath, 'relocated.svg', 'illustration.svg', 'broken.png', 'missing.png', 'report.md'].map(path => ({ path }))
  }) + '\n');
});

async function expectDecoded(image: Locator, width: number, height: number) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => [node.complete, node.naturalWidth, node.naturalHeight])).toEqual([true, width, height]);
}

test('Inbox decodes image attachments through desktop IPC and mobile HTTP', async ({ app }, testInfo) => {
  test.setTimeout(150_000);
  const desktop = app.window;
  await desktop.getByTestId('nav-inbox').click();
  await desktop.getByRole('button', { name: /Image attachment regression/ }).click();
  await expectDecoded(desktop.getByRole('img', { name: pngPath, exact: true }), 1, 1);
  await expect(desktop.getByText('File is binary — not rendered.')).toHaveCount(0);
  await desktop.getByRole('option', { name: 'relocated.svg', exact: true }).click();
  const illustration = desktop.getByRole('img', { name: 'docs/relocated.svg', exact: true });
  await expectDecoded(illustration, 1200, 800);
  await expect(desktop.getByText('relocated', { exact: true })).toBeVisible();
  expect((await illustration.boundingBox())!.width).toBeLessThanOrEqual((await desktop.locator('.inbox-doc-body').boundingBox())!.width);
  await captureElectronScreenshot(app.electron, desktop, testInfo.outputPath('inbox-image-desktop.png'));
  await desktop.getByRole('option', { name: 'broken.png', exact: true }).click();
  await expect(desktop.getByRole('status').filter({ hasText: 'Could not display this image' })).toBeVisible();
  await desktop.getByRole('option', { name: 'missing.png', exact: true }).click();
  await expect(desktop.locator('.inbox-doc-tombstone')).toBeVisible();
  await expect(desktop.locator('.inbox-doc-body img')).toHaveCount(0);
  await desktop.getByRole('option', { name: 'report.md', exact: true }).click();
  await expect(desktop.getByRole('heading', { name: 'Report remains readable' })).toBeVisible();

  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(desktop.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Inbox images' } });
    const credential = await pair.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const mobile = await context.newPage();
    await mobile.goto(`${serverUrl}/inbox`);
    await mobile.getByRole('button', { name: /Image attachment regression/ }).tap();
    await expect(mobile.locator('.inbox-doc-image')).toHaveCount(0);
    await mobile.getByRole('button', { name: 'screenshot #1.PNG', exact: true }).tap();
    await expectDecoded(mobile.getByRole('img', { name: pngPath, exact: true }), 1, 1);
    await mobile.getByRole('button', { name: 'illustration.svg', exact: true }).tap();
    const mobileImage = mobile.getByRole('img', { name: 'illustration.svg', exact: true });
    await expectDecoded(mobileImage, 1200, 800);
    for (const width of [320, 390, 820]) {
      await mobile.setViewportSize({ width, height: 844 });
      const bounds = (await mobileImage.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.width / bounds.height).toBeCloseTo(1.5, 1);
    }
    await mobile.screenshot({ path: testInfo.outputPath('inbox-image-mobile.png') });
    await mobile.getByRole('button', { name: 'broken.png', exact: true }).tap();
    await expect(mobile.getByRole('status').filter({ hasText: 'Could not display this image' })).toBeVisible();
  } finally {
    await browser.close();
    await gateway.close();
  }
});
