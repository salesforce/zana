import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true }
});

test('phone composer picks, previews, removes and sends screenshots through mobile HTTP', async ({ app }, testInfo) => {
  test.setTimeout(180_000);
  const root = join(app.home, 'phone-attachments');
  mkdirSync(root);
  const threadId = await app.window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Phone screenshot check' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, root);
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const paired = await context.request.post(`${serverUrl}/_mobile/pair`, {
      data: { code: gateway.pair().code, label: 'Phone screenshots' }
    });
    expect(paired.ok()).toBe(true);
    const credential = await paired.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, {
      headers: { authorization: `Bearer ${credential.credential}` }
    })).ok()).toBe(true);
    const phone = await context.newPage();
    await phone.goto(`${serverUrl}/threads/${threadId}`);
    const composer = phone.locator('.thread-command-composer');
    const editor = phone.getByTestId('thread-command-input');
    const options = composer.getByRole('button', { name: 'Composer options', exact: true });
    const attach = composer.getByRole('button', { name: 'Attach files', exact: true });
    const send = phone.getByTestId('thread-command-send');
    await expect(editor).toBeVisible();
    await expect(phone.locator('.model-reasoning-picker-trigger-skel')).toHaveCount(0, { timeout: 60_000 });
    await expect(phone.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    // The picker must not introduce an empty/selectable native input into the card.
    await expect(composer.locator('input[type="file"]')).toBeHidden();
    const screenshot = {
      name: 'phone-screenshot.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    };
    await editor.fill('Draft survives image selection');
    for (const width of [320, 390]) {
      await phone.setViewportSize({ width, height: 460 });
      await expect(options).toHaveAttribute('aria-expanded', 'false');
      await expect(attach).toBeVisible();
      await expect(attach).toBeEnabled();
      const chooserPromise = phone.waitForEvent('filechooser');
      await attach.click();
      const chooser = await chooserPromise;
      expect(chooser.isMultiple()).toBe(true);
      await chooser.setFiles([screenshot]);
      const thumb = composer.getByRole('img', { name: screenshot.name });
      await expect(thumb).toBeVisible();
      await expect.poll(() => thumb.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
      await expect(editor).toHaveText('Draft survives image selection');
      await options.click();
      await phone.screenshot({ path: testInfo.outputPath(`phone-options-with-image-${width}.png`) });
      for (const control of [attach, options, send]) {
        const box = (await control.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(460);
      }
      const settingsBox = (await composer.locator('.thread-command-options').boundingBox())!;
      const actionsBox = (await composer.locator('.thread-command-secondary-actions').boundingBox())!;
      const sendBox = (await send.boundingBox())!;
      expect(settingsBox.y).toBeGreaterThanOrEqual(sendBox.y + sendBox.height);
      expect(actionsBox.y).toBeGreaterThanOrEqual(settingsBox.y + settingsBox.height);
      await editor.focus();
      await expect(options).toHaveAttribute('aria-expanded', 'false');
      for (const control of [editor, options, send, thumb]) {
        const box = (await control.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(460);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await phone.screenshot({ path: testInfo.outputPath(`phone-screenshot-${width}.png`) });
      await composer.getByRole('button', { name: `Remove ${screenshot.name}` }).click();
      await expect(thumb).toHaveCount(0);
    }
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.getByTestId('thread-command-expand').click();
    const expanded = phone.getByRole('dialog', { name: 'Write a message', exact: true });
    await expect(expanded).toBeVisible();
    await expect(attach).toBeVisible();
    const chooserPromise = phone.waitForEvent('filechooser');
    await attach.click();
    await (await chooserPromise).setFiles([screenshot]);
    await expanded.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(composer.getByRole('img', { name: screenshot.name })).toBeVisible();
    await editor.fill('');
    await editor.focus();
    const uploaded = phone.waitForResponse((response) => /\/attachments$/.test(response.url()) && response.request().method() === 'POST');
    await send.click();
    const response = await uploaded;
    expect(response.status()).toBe(201);
    const attachment = await response.json();
    expect(attachment).toMatchObject({ type: 'localImage', mimeType: 'image/png', sizeBytes: screenshot.buffer.length });
    await expect(composer.locator('.composer-image-thumbs')).toHaveCount(0);
    const sent = phone.getByRole('img', { name: /^phone-screenshot-.*\.png$/ }).first();
    await expect(sent).toBeVisible();
    await expect.poll(() => sent.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    await phone.screenshot({ path: testInfo.outputPath('phone-screenshot-sent.png') });
  } finally {
    await browser.close();
    await gateway.close();
  }
});
