/**
 * Ctrl+mouse wheel zooms the app (backlog item 85).
 *
 * Chromium reports a Ctrl+wheel through `zoom-changed` and leaves applying it
 * to the host. This spec sends real wheel input events (the path a mouse takes)
 * to the app window and checks the zoom factor moves one menu step per notch,
 * that a plain wheel does not zoom, and that the level survives a relaunch.
 */
import { test, expect, launchApp, closeApp, type AppHandle } from './fixtures/app.js';

const VISIBLE = { env: { ZCC_E2E_VISIBLE: '1' } };
const START_FACTOR = 0.95;

async function zoomFactor(app: AppHandle): Promise<number> {
  return app.electron.evaluate(({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === url);
    return win ? win.webContents.getZoomFactor() : Number.NaN;
  }, app.window.url());
}

async function wheel(app: AppHandle, deltaY: number, ctrl: boolean): Promise<void> {
  await app.electron.evaluate(({ BrowserWindow }, args) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === args.url);
    if (!win) throw new Error('no app window for the test page');
    win.focus();
    win.webContents.sendInputEvent({
      type: 'mouseWheel',
      x: 300,
      y: 300,
      deltaX: 0,
      deltaY: args.deltaY,
      modifiers: args.ctrl ? ['control'] : []
    });
  }, { deltaY, ctrl, url: app.window.url() });
}

test('Ctrl+wheel zooms one step per notch, a plain wheel does not, and the zoom survives a relaunch', async ({ home }) => {
  test.setTimeout(180_000);
  let zoomed = 0;
  const first = await launchApp(home, VISIBLE);
  try {
    expect(await zoomFactor(first)).toBeCloseTo(START_FACTOR, 2);

    await wheel(first, 120, false);
    await first.window.waitForTimeout(500);
    expect(await zoomFactor(first)).toBeCloseTo(START_FACTOR, 2);

    for (let i = 1; i <= 3; i++) {
      await wheel(first, 120, true);
      await expect.poll(() => zoomFactor(first)).toBeCloseTo(START_FACTOR * 1.2 ** (i / 2), 2);
    }
    // Wheel down (negative delta) zooms back out.
    await wheel(first, -120, true);
    await wheel(first, -120, true);
    await expect.poll(() => zoomFactor(first)).toBeCloseTo(START_FACTOR * 1.2 ** 0.5, 2);
    zoomed = await zoomFactor(first);
  } finally {
    await closeApp(first.electron);
  }

  const second = await launchApp(home, VISIBLE);
  try {
    await expect.poll(() => zoomFactor(second), { timeout: 20_000 }).toBeCloseTo(zoomed, 2);
  } finally {
    await closeApp(second.electron);
  }
});
