/**
 * Windows caption buttons (minimize / maximize / close) follow the app theme.
 *
 * Electron paints the title bar overlay natively from `color` / `symbolColor`,
 * outside the renderer's CSS, so main must call `setTitleBarOverlay` on every
 * window when the Theme setting changes and when the OS appearance changes.
 * Electron has no getter for the overlay, so the spec records the real calls
 * and checks them against the colours the renderer actually paints under the
 * buttons (the title bar's background and muted text).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { isAppRendererUrl, test, expect } from './fixtures/app.js';

type Overlay = { color: string; symbolColor: string; height: number };

function hex(rgb: string): string {
  const parts = rgb.match(/\d+/g)!.slice(0, 3).map(Number);
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

/** The colours `page` paints under the caption buttons. */
async function paintedTitleBar(page: Page, selector: string) {
  const painted = await page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, text: getComputedStyle(document.documentElement).getPropertyValue('--text-muted') };
  });
  return { color: hex(painted.background), symbolColor: painted.text.trim() };
}

test('Windows caption buttons follow the Theme setting and the OS appearance in every window', async ({ app }) => {
  test.skip(process.platform !== 'win32', 'The title bar overlay exists only on Windows');
  const { electron, window: main } = app;

  await electron.evaluate(({ BrowserWindow }) => {
    const prior = BrowserWindow.prototype.setTitleBarOverlay;
    const calls: Record<number, Overlay[]> = {};
    (globalThis as any).__overlayCheck = { calls, restore: () => { BrowserWindow.prototype.setTitleBarOverlay = prior; } };
    BrowserWindow.prototype.setTitleBarOverlay = function (this: Electron.BrowserWindow, options: Electron.TitleBarOverlayOptions) {
      (calls[this.id] ??= []).push(options as Overlay);
      return prior.call(this, options);
    };
  });
  const lastOverlays = () =>
    electron.evaluate(({ BrowserWindow }) => {
      const calls = (globalThis as any).__overlayCheck.calls as Record<number, Overlay[]>;
      // Only windows main re-coloured; other BrowserWindows (popover, sheets) have no overlay.
      return BrowserWindow.getAllWindows()
        .filter((win) => calls[win.id])
        .map((win) => ({ id: win.id, last: calls[win.id].at(-1)!, count: calls[win.id].length }));
    });

  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-overlay-theme-'));
  const projectId = await main.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return ((res && 'ok' in res ? (res as any).value : res) as { id: string }).id;
  }, projectDir);
  const initialTheme = (await main.evaluate(() => window.cc.config.get())).theme;

  try {
    await main.evaluate((pid) => window.cc.windows.openProject(pid), projectId);
    let projectWindow: Page | undefined;
    await expect.poll(() => {
      projectWindow = electron.windows().find((w) => w !== main && isAppRendererUrl(w.url()));
      return !!projectWindow;
    }, { timeout: 20_000 }).toBe(true);
    await projectWindow!.waitForSelector('.titlebar', { timeout: 30_000 });
    const windowCount = electron.windows().filter((w) => isAppRendererUrl(w.url())).length;
    expect(windowCount).toBe(2);

    for (const theme of ['light', 'dark'] as const) {
      await main.evaluate((value) => window.cc.config.set({ theme: value }), theme);
      await expect(main.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(projectWindow!.locator('html')).toHaveAttribute('data-theme', theme);
      const painted = await paintedTitleBar(main, '.titlebar');
      expect(await paintedTitleBar(projectWindow!, '.titlebar')).toEqual(painted);
      await expect.poll(async () => (await lastOverlays()).map((entry) => entry.last)).toEqual(
        Array.from({ length: windowCount }, () => ({ ...painted, height: 44 }))
      );
    }

    // Theme System: the overlay follows a real appearance change. Forcing
    // `themeSource` flips `shouldUseDarkColors` and the renderer's
    // prefers-color-scheme, and Electron emits `updated` itself, as on an OS switch.
    await main.evaluate(() => window.cc.config.set({ theme: 'system' }));
    for (const appearance of ['light', 'dark'] as const) {
      await electron.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value; }, appearance);
      await expect(main.locator('html')).toHaveAttribute('data-theme', appearance);
      await expect(projectWindow!.locator('html')).toHaveAttribute('data-theme', appearance);
      const painted = await paintedTitleBar(main, '.titlebar');
      expect(painted).toEqual(await paintedTitleBar(projectWindow!, '.titlebar'));
      await expect.poll(async () => (await lastOverlays()).map((entry) => entry.last)).toEqual(
        Array.from({ length: windowCount }, () => ({ ...painted, height: 44 }))
      );
    }
  } finally {
    await electron.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'system';
      (globalThis as any).__overlayCheck?.restore();
      delete (globalThis as any).__overlayCheck;
    });
    await main.evaluate(async ({ pid, theme }) => {
      try { await window.cc.config.set({ theme }); } catch { /* best-effort */ }
      try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
    }, { pid: projectId, theme: initialTheme });
  }
});
