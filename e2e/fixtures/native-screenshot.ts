import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/** Keep visual artifacts on Electron's compositor; CDP capture stalls under Xvfb. */
export async function captureElectronScreenshot(electron: ElectronApplication, page: Page, outputPath: string, target?: Locator) {
  if (target) await target.scrollIntoViewIfNeeded();
  const box = target ? await target.boundingBox() : undefined;
  if (target) expect(box).not.toBeNull();
  const rect = box ? { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) } : undefined;
  const nativeWindow = await electron.browserWindow(page);
  try {
    const encoded = await nativeWindow.evaluate(async (window, rect) => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const image = await Promise.race([
          window.webContents.capturePage(rect, { stayHidden: true, stayAwake: true }),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Layout capture timed out')), 15_000);
          })
        ]);
        return image.toPNG().toString('base64');
      } finally { clearTimeout(deadline); }
    }, rect);
    const png = Buffer.from(encoded, 'base64');
    expect(png.byteLength).toBeGreaterThan(0);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    writeFileSync(outputPath, png);
  } finally { await nativeWindow.dispose(); }
}
