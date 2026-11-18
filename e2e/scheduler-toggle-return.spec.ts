import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from './fixtures/app.js';

// Ctrl/Cmd+J opens the Scheduler and, pressed again, returns to the exact view
// the user was on (a project's view or a Settings page) instead of Home, as
// Ctrl/Cmd+I does with the Inbox (#730). Ctrl+J has no menu item; the renderer
// keydown is its only entry point.

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('Ctrl/Cmd+J twice from a project view returns to it', async ({ app }) => {
  const win = app.window;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-scheduler-toggle-'));
  const projectId = await win.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return ((res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string }).id;
  }, projectDir);
  try {
    const projects = win.getByTestId('sidebar-projects-heading');
    if ((await projects.getAttribute('aria-expanded')) === 'false') await projects.click();
    await win.locator('.project-item').filter({ hasText: basename(projectDir) }).first().click();
    const rail = win.locator('.project-scoped-nav.project-focused-nav');
    await rail.getByTestId('project-nav-explorer').click();
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/explorer$`));

    await win.keyboard.press('ControlOrMeta+KeyJ');
    await expect(win).toHaveURL(/\/scheduler$/);

    await win.keyboard.press('ControlOrMeta+KeyJ');
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/explorer$`));
    await expect(rail.getByTestId('project-nav-explorer')).toHaveAttribute('aria-current', 'page');
  } finally {
    await win.evaluate(async (pid) => {
      try { await window.cc.projects.remove(pid); } catch { /* best-effort cleanup */ }
    }, projectId);
  }
});

test('Ctrl/Cmd+J twice from a Settings page returns to that page', async ({ app }) => {
  const win = app.window;
  await win.keyboard.press('ControlOrMeta+Comma');
  await expect(win).toHaveURL(/\/settings/);
  const settingsUrl = win.url();

  await win.keyboard.press('ControlOrMeta+KeyJ');
  await expect(win).toHaveURL(/\/scheduler$/);
  await win.keyboard.press('ControlOrMeta+KeyJ');
  await expect(win).toHaveURL(settingsUrl);
});
