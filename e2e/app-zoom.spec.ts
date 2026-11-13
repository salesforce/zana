/**
 * View > Zoom In on Windows and Linux (backlog item 71).
 *
 * Electron's `zoomIn` role binds CmdOrCtrl+Plus, which Electron matches as
 * Shift+=, so the plain Ctrl+= the menu advertises did nothing. This spec
 * presses the real chord through `webContents.sendInputEvent` (the path a
 * keyboard takes to menu accelerators), checks the zoom factor and a measured
 * element size, then relaunches on the same home and checks the zoom is kept.
 */
import { test, expect, launchApp, closeApp, type AppHandle } from './fixtures/app.js';

test.skip(process.platform === 'darwin', 'macOS keeps Electron’s zoomIn / zoomOut roles (Cmd+Plus)');

const STEPS = 8;

async function zoomFactor(app: AppHandle): Promise<number> {
  return app.electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
    return win ? win.webContents.getZoomFactor() : Number.NaN;
  });
}

async function pressCtrl(app: AppHandle, keyCode: string, shift = false): Promise<void> {
  await app.electron.evaluate(({ BrowserWindow }, args) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
    if (!win) throw new Error('no visible app window');
    win.focus();
    const modifiers = args.shift ? ['control', 'shift'] : ['control'];
    for (const type of ['rawKeyDown', 'char', 'keyUp'] as const) {
      win.webContents.sendInputEvent({ type, keyCode: args.keyCode, modifiers: modifiers as Electron.InputEvent['modifiers'] });
    }
  }, { keyCode, shift });
}

/** The body text size in device pixels: grows with page zoom. */
async function bodyFontDevicePx(app: AppHandle): Promise<number> {
  return app.window.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize) * window.devicePixelRatio);
}

test('Ctrl+= keeps zooming the whole UI past 200%, and the zoom survives a relaunch', async ({ home }) => {
  test.setTimeout(180_000);
  let zoomed = 0;
  const first = await launchApp(home);
  try {
    const startFactor = await zoomFactor(first);
    expect(startFactor).toBeCloseTo(0.95, 2);
    const startFont = await bodyFontDevicePx(first);

    for (let i = 1; i <= STEPS; i++) {
      await pressCtrl(first, '=');
      await expect.poll(() => zoomFactor(first)).toBeCloseTo(0.95 * 1.2 ** (i / 2), 2);
    }
    zoomed = await zoomFactor(first);
    expect(zoomed).toBeGreaterThan(1.95);
    await expect.poll(() => bodyFontDevicePx(first)).toBeGreaterThan(startFont * 1.9);

    // Ctrl+Shift+= (the old role's chord) and Ctrl+Numpad+ still zoom; Ctrl+- undoes them.
    await pressCtrl(first, 'Plus', true);
    await expect.poll(() => zoomFactor(first)).toBeGreaterThan(zoomed * 1.05);
    await pressCtrl(first, 'numadd');
    await pressCtrl(first, '-');
    await pressCtrl(first, '-');
    await expect.poll(() => zoomFactor(first)).toBeCloseTo(zoomed, 2);
  } finally {
    await closeApp(first.electron);
  }

  const second = await launchApp(home);
  try {
    await expect.poll(() => zoomFactor(second), { timeout: 20_000 }).toBeCloseTo(zoomed, 2);
    await pressCtrl(second, '0');
    await expect.poll(() => zoomFactor(second)).toBeCloseTo(0.95, 2);
  } finally {
    await closeApp(second.electron);
  }
});
