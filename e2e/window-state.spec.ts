import { test, expect } from './fixtures/app';

async function mainWindowState(app: import('./fixtures/app').AppHandle) {
  return app.electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'));
    return {
      normal: win?.isNormal() ?? false,
      maximized: win?.isMaximized() ?? false,
      fullscreen: win?.isFullScreen() ?? false,
      simpleFullscreen: win?.isSimpleFullScreen() ?? false,
      bounds: win?.getBounds()
    };
  });
}

async function zoomToWorkArea(app: import('./fixtures/app').AppHandle) {
  const normal = await app.electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'));
    if (!win) throw new Error('main window not found');
    return win.getNormalBounds();
  });
  await app.electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'));
    if (!win) throw new Error('main window not found');
    // Electron maps maximize() to native fullscreen while fullscreenable. Disable
    // that mapping only for this call to exercise macOS zoom/maximize instead.
    win.setFullScreenable(false);
    win.maximize();
    win.setFullScreenable(true);
  });
  await expect.poll(() => app.electron.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'));
    if (!win) return false;
    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    return bounds.x === area.x && bounds.y === area.y && bounds.width === area.width && bounds.height === area.height;
  })).toBe(true);
  const state = await mainWindowState(app);
  expect(state.fullscreen).toBe(false);
  expect(state.normal).toBe(false);
  return normal;
}

test('Option-green maximize is restored after quit', async ({ app }) => {
  await zoomToWorkArea(app);

  const appClosed = app.electron.waitForEvent('close');
  await app.electron.evaluate(({ app: electronApp }) => electronApp.quit());
  await appClosed;

  const relaunched = await import('./fixtures/app').then(({ launchApp }) => launchApp(app.home));
  try {
    await expect.poll(() => mainWindowState(relaunched)).toMatchObject({
      fullscreen: false,
      simpleFullscreen: false,
      maximized: true
    });
  } finally {
    await relaunched.electron.close();
  }
});

test('Option-green maximize is restored after close and reactivate', async ({ app }) => {
  await zoomToWorkArea(app);
  const reopenedPromise = app.electron.waitForEvent('window');
  const windowClosed = app.window.waitForEvent('close');
  await app.electron.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'))?.close();
  });
  await windowClosed;
  await app.electron.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
  const reopened = await reopenedPromise;
  await reopened.waitForLoadState('domcontentloaded');

  await expect.poll(() => mainWindowState(app)).toMatchObject({
    normal: false,
    maximized: true
  });
});

test('native fullscreen relaunches as a regular window', async ({ app }) => {
  await app.electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'));
    if (!win) throw new Error('main window not found');
    win.setFullScreen(true);
  });
  await expect.poll(() => mainWindowState(app).then((state) => state.fullscreen)).toBe(true);

  const appClosed = app.electron.waitForEvent('close');
  await app.electron.evaluate(({ app: electronApp }) => electronApp.quit());
  await appClosed;

  const relaunched = await import('./fixtures/app').then(({ launchApp }) => launchApp(app.home));
  try {
    await expect.poll(() => mainWindowState(relaunched)).toMatchObject({
      normal: true,
      maximized: false,
      fullscreen: false
    });
  } finally {
    await relaunched.electron.close();
  }
});
