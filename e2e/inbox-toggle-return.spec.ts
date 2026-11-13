import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

// Ctrl/Cmd+I opens the Inbox and, pressed again, returns to the exact view the
// user was on — a project's view or a Settings page — instead of Home. Both
// entry points are driven for real: the renderer keydown and the native
// View → Toggle Inbox menu item (main's sendToFocused → preload → App).

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

/** Clicks View → Toggle Inbox in the real application menu. */
async function clickToggleInboxMenu(electron: ElectronApplication): Promise<void> {
  const clicked = await electron.evaluate(({ Menu, BrowserWindow }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.label === 'Toggle Inbox') return item;
        const found = item.submenu ? find(item.submenu.items) : null;
        if (found) return found;
      }
      return null;
    };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item) return false;
    item.click(undefined, BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], undefined as never);
    return true;
  });
  expect(clicked).toBe(true);
}

test("Ctrl/Cmd+I twice from a project view returns to it, and the menu item does the same", async ({ app }) => {
  const win = app.window;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-toggle-'));
  const projectId = await win.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return ((res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string }).id;
  }, projectDir);
  try {
    const projects = win.getByTestId('sidebar-projects-heading');
    if ((await projects.getAttribute('aria-expanded')) === 'false') await projects.click();
    await win.locator('.project-item').filter({ hasText: basename(projectDir) }).first().click();
    const rail = win.locator('.project-scoped-nav.project-focused-nav');
    await rail.getByTestId('project-nav-scheduler').click();
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/scheduler$`));

    await win.keyboard.press('ControlOrMeta+KeyI');
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/inbox$`));
    await expect(win.locator('.inbox-view')).toBeVisible();

    await win.keyboard.press('ControlOrMeta+KeyI');
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/scheduler$`));
    await expect(rail.getByTestId('project-nav-scheduler')).toHaveAttribute('aria-current', 'page');

    await clickToggleInboxMenu(app.electron);
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/inbox$`));
    await clickToggleInboxMenu(app.electron);
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/scheduler$`));
  } finally {
    await win.evaluate(async (pid) => {
      try { await window.cc.projects.remove(pid); } catch { /* best-effort cleanup */ }
    }, projectId);
  }
});

test('Ctrl/Cmd+I twice from a Settings page returns to that page', async ({ app }) => {
  const win = app.window;
  await win.keyboard.press('ControlOrMeta+Comma');
  await expect(win).toHaveURL(/\/settings/);
  const settingsUrl = win.url();

  await win.keyboard.press('ControlOrMeta+KeyI');
  await expect(win).toHaveURL(/\/inbox$/);
  await win.keyboard.press('ControlOrMeta+KeyI');
  await expect(win).toHaveURL(settingsUrl);
});
