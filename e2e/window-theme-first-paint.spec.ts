/**
 * New windows open in the effective theme, so a light window doesn't flash
 * dark before its renderer has read the config.
 *
 * Main sets the native `backgroundColor` to the theme's --bg-base and passes
 * `--zcc-theme=<theme>` to the preload, which seeds `<html data-theme>`. The
 * spec opens a project window under each theme (Light, Dark, and System with
 * both OS appearances) and checks both against what the renderer then paints.
 * Electron doesn't report `additionalArguments` back, so the preload argument
 * is read from the renderer process's command line, which Linux (CI) exposes.
 * Playwright emulates `prefers-color-scheme: light` in every window by default,
 * so each case emulates the OS appearance it gives `nativeTheme`.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { isAppRendererUrl, test, expect } from './fixtures/app.js';

function hex(rgb: string): string {
  const parts = rgb.match(/\d+/g)!.slice(0, 3).map(Number);
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

test('new windows open on the background and data-theme of the effective theme', async ({ app }) => {
  const { electron, window: main } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-window-theme-'));
  const projectId = await main.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return ((res && 'ok' in res ? (res as any).value : res) as { id: string }).id;
  }, projectDir);
  const initialTheme = (await main.evaluate(() => window.cc.config.get())).theme;

  const appWindows = () => electron.windows().filter((w) => isAppRendererUrl(w.url()));
  /** Open the project window and return its page plus what main gave it. */
  const openProjectWindow = async (colorScheme: 'light' | 'dark') => {
    await main.evaluate((pid) => window.cc.windows.openProject(pid), projectId);
    let page: Page | undefined;
    await expect.poll(() => {
      page = appWindows().find((w) => w !== main);
      return !!page;
    }, { timeout: 20_000 }).toBe(true);
    await page!.emulateMedia({ colorScheme });
    await page!.waitForSelector('.titlebar', { timeout: 30_000 });
    // The project window is the newest BrowserWindow.
    const created = await electron.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().reduce((newest, w) => (w.id > newest.id ? w : newest));
      return { background: win.getBackgroundColor().toLowerCase(), pid: win.webContents.getOSProcessId() };
    });
    // Chromium rewrites its process title, so the arguments can be space- rather than NUL-separated.
    const args = process.platform === 'linux' ? readFileSync(`/proc/${created.pid}/cmdline`, 'utf8').split(/[\0 ]/) : null;
    return { page: page!, created: { ...created, args } };
  };
  const closeProjectWindow = async (page: Page) => {
    await page.close();
    await expect.poll(() => appWindows().length).toBe(1);
  };

  try {
    const cases = [
      { theme: 'light', appearance: 'system', expected: 'light' },
      { theme: 'dark', appearance: 'light', expected: 'dark' },
      { theme: 'system', appearance: 'light', expected: 'light' },
      { theme: 'system', appearance: 'dark', expected: 'dark' }
    ] as const;
    for (const { theme, appearance, expected } of cases) {
      // `themeSource` sets main's `shouldUseDarkColors`, but under Playwright the
      // renderer's prefers-color-scheme stays light, so emulate the same appearance.
      const colorScheme = appearance === 'dark' ? 'dark' : 'light';
      await electron.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value; }, appearance);
      await main.emulateMedia({ colorScheme });
      await main.evaluate((value) => window.cc.config.set({ theme: value }), theme);
      await expect(main.locator('html')).toHaveAttribute('data-theme', expected);

      const { page, created } = await openProjectWindow(colorScheme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
      const painted = hex(await page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor));
      const label = `theme=${theme} OS=${appearance}`;
      expect(created.background, label).toBe(painted);
      if (created.args) expect(created.args, label).toContain(`--zcc-theme=${expected}`);
      await closeProjectWindow(page);
    }
  } finally {
    await electron.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
    await main.evaluate(async ({ pid, theme }) => {
      try { await window.cc.config.set({ theme }); } catch { /* best-effort */ }
      try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
    }, { pid: projectId, theme: initialTheme });
  }
});
