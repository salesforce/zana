import { writeFileSync } from 'node:fs';
import { test, expect } from './fixtures/app.js';
import { FAIRY_GLYPH_ALPHA } from '../apps/desktop/src/generated/zana-glyph.js';

test('fairy branding loads in the built Electron tray, popover and browser favicon', async ({ app }, testInfo) => {
  test.skip(process.platform !== 'darwin', 'macOS template-image contract');

  // Observe the real tray's next theme-driven update, without adding production test hooks.
  await app.electron.evaluate(({ Tray, nativeTheme }) => {
    const prior = Tray.prototype.setImage;
    const state = { image: null as null | { template: boolean; width: number; height: number; png: string; alpha: string }, restore: () => {} };
    (globalThis as any).__fairyBrandCheck = state;
    Tray.prototype.setImage = function (image: Electron.NativeImage) {
      state.image = {
        template: image.isTemplateImage(), ...image.getSize(),
        png: image.toPNG({ scaleFactor: 2 }).toString('base64'),
        alpha: image.toBitmap({ scaleFactor: 2 }).filter((_value, index) => index % 4 === 3).toString('base64')
      };
      return prior.call(this, image);
    };
    state.restore = () => { Tray.prototype.setImage = prior; };
    nativeTheme.emit('updated');
  });
  try {
    await expect.poll(() => app.electron.evaluate(() => (globalThis as any).__fairyBrandCheck.image)).not.toBeNull();
    const tray = await app.electron.evaluate(() => (globalThis as any).__fairyBrandCheck.image);
    expect(tray).toMatchObject({ template: true, width: 18, height: 18 });
    expect(tray.alpha).toBe(FAIRY_GLYPH_ALPHA);
    writeFileSync(testInfo.outputPath('fairy-tray.png'), Buffer.from(tray.png, 'base64'));
  } finally {
    await app.electron.evaluate(() => {
      (globalThis as any).__fairyBrandCheck.restore();
      delete (globalThis as any).__fairyBrandCheck;
    });
  }

  const favicon = await app.window.locator('link[rel="icon"]').getAttribute('href');
  expect(favicon).toBeTruthy();
  const faviconSvg = await app.window.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    return (await fetch(link.href)).text();
  });
  expect(faviconSvg).toContain('<title>Zana</title>');
  expect(faviconSvg).toContain('#ffdb9e');

  await app.window.setViewportSize({ width: 380, height: 560 });
  await app.window.goto(new URL('?surface=popover', app.window.url()).href);
  const glyph = app.window.locator('.mbp-brand-glyph');
  await expect(glyph).toBeVisible();
  const rendered = await glyph.evaluate(async (element) => {
    const style = getComputedStyle(element);
    const url = style.maskImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!url) throw new Error('Missing fairy mask');
    const svg = await (await fetch(url)).text();
    return { svg, color: style.backgroundColor, width: style.width };
  });
  expect(rendered.svg).toContain('Zana fairy silhouette');
  expect(Number.parseFloat(rendered.width)).toBeCloseTo(18, 1);
  expect(rendered.color).not.toBe('rgba(0, 0, 0, 0)');
  await app.window.screenshot({ path: testInfo.outputPath('fairy-popover.png'), animations: 'disabled' });
});
