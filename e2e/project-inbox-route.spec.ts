import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from './fixtures/app.js';

// A project's Inbox has its own project-scoped route, so Ctrl/Cmd+, closes
// that project's Settings back to it instead of the project's last mode. The
// cross-project Inbox stays on `/inbox`.

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test("Ctrl/Cmd+, from a project's Inbox opens project Settings and closes back to that Inbox", async ({ app }) => {
  const win = app.window;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-project-inbox-'));
  const projectId = await win.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return ((res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string }).id;
  }, projectDir);
  try {
    const projects = win.getByTestId('sidebar-projects-heading');
    if ((await projects.getAttribute('aria-expanded')) === 'false') await projects.click();
    await win.locator('.project-item').filter({ hasText: basename(projectDir) }).first().click();
    const rail = win.locator('.project-scoped-nav.project-focused-nav');
    const inbox = rail.getByTestId('project-nav-inbox');
    await expect(inbox).toHaveAttribute('href', `/projects/${projectId}/inbox`);
    // Visit another project view first so falling back to "last project mode" would be visible.
    await rail.getByTestId('project-nav-scheduler').click();
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/scheduler$`));
    await inbox.click();
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/inbox$`));
    await expect(inbox).toHaveAttribute('aria-current', 'page');
    await expect(win.locator('.inbox-view')).toBeVisible();

    await win.keyboard.press('ControlOrMeta+Comma');
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/settings$`));
    await expect(win.getByRole('heading', { name: 'Project settings' })).toBeVisible();

    await win.keyboard.press('ControlOrMeta+Comma');
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/inbox$`));
    await expect(inbox).toHaveAttribute('aria-current', 'page');
    await expect(win.locator('.inbox-view')).toBeVisible();

    // The rail's Back leaves the project for the cross-project Inbox.
    await rail.getByRole('button', { name: 'Back to all projects' }).click();
    await expect(win).toHaveURL(/\/inbox$/);
    await expect(win.getByTestId('nav-inbox')).toHaveAttribute('aria-current', 'page');
  } finally {
    await win.evaluate(async (pid) => {
      try { await window.cc.projects.remove(pid); } catch { /* best-effort cleanup */ }
    }, projectId);
  }
});

test('the workspace Inbox stays on /inbox, and Ctrl/Cmd+, closes Settings back to it', async ({ app }) => {
  const win = app.window;
  await win.getByTestId('nav-inbox').click();
  await expect(win).toHaveURL(/\/inbox$/);
  await expect(win.getByTestId('nav-inbox')).toHaveAttribute('aria-current', 'page');
  await expect(win.locator('.inbox-view')).toBeVisible();

  await win.keyboard.press('ControlOrMeta+Comma');
  await expect(win).toHaveURL(/\/settings/);
  await win.keyboard.press('ControlOrMeta+Comma');
  await expect(win).toHaveURL(/\/inbox$/);
  await expect(win.locator('.inbox-view')).toBeVisible();
});
