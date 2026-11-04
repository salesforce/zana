import type { Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from './fixtures/app.js';

// Opening Settings puts focus in "Search settings…" so typing goes straight into
// it, from every entry that lands on the Settings rail. A deep link keeps its own
// field focus (reveal), and Escape still only clears the query.

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

const search = (win: Page) => win.getByRole('combobox', { name: 'Search settings' });

async function leaveSettings(win: Page) {
  await win.getByTestId('nav-inbox').click();
  await expect(search(win)).toHaveCount(0);
}

test('Ctrl/Cmd+, focuses search; typing filters, Escape clears and keeps Settings open', async ({ app }) => {
  const win = app.window;
  await leaveSettings(win);
  // Closing comes back here, so wait until the Inbox route has actually landed.
  await expect(win).toHaveURL(/\/inbox$/);
  await expect(win.getByTestId('nav-inbox')).toHaveAttribute('aria-current', 'page');
  await win.keyboard.press('ControlOrMeta+Comma');
  await expect(search(win)).toBeFocused();
  await win.keyboard.type('heartbeat');
  await expect(search(win)).toHaveValue('heartbeat');
  await expect(win.getByTestId('settings-result-agents.agent-heartbeat.intro')).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(search(win)).toHaveValue('');
  await expect(search(win)).toBeFocused();
  // The shortcut still toggles Settings closed, back where it was opened.
  await win.keyboard.press('ControlOrMeta+Comma');
  await expect(search(win)).toHaveCount(0);
  await expect(win).toHaveURL(/\/inbox$/);
});

test("Ctrl/Cmd+, drilled into a project opens and closes that project's Settings", async ({ app }) => {
  const win = app.window;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-settings-shortcut-'));
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
    // The URL changes before the route renders; closing returns to the rendered view.
    await expect(rail.getByTestId('project-nav-scheduler')).toHaveAttribute('aria-current', 'page');

    await win.keyboard.press('ControlOrMeta+Comma');
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/settings$`));
    await expect(win.getByRole('heading', { name: 'Project settings' })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Back to Global settings' })).toBeVisible();
    // Project Settings has no search box, so nothing tries to focus one.
    await expect(search(win)).toHaveCount(0);

    await win.keyboard.press('ControlOrMeta+Comma');
    await expect(win).toHaveURL(new RegExp(`/projects/${projectId}/scheduler$`));
    await expect(rail).toBeVisible();
  } finally {
    await win.evaluate(async (pid) => {
      try { await window.cc.projects.remove(pid); } catch { /* best-effort cleanup */ }
    }, projectId);
  }
});

test('the sidebar Settings link focuses search; moving between sections does not take focus back', async ({ app }) => {
  const win = app.window;
  await leaveSettings(win);
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(search(win)).toBeFocused();
  await win.getByTestId('settings-nav-terminal').click();
  await expect(win).toHaveURL(/\/settings\/terminal/);
  await expect(search(win)).not.toBeFocused();
});

test('re-mounting the rail while a Terminal field has focus leaves focus in that field', async ({ app }) => {
  const win = app.window;
  await leaveSettings(win);
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-terminal').click();
  await expect(win).toHaveURL(/\/settings\/terminal/);
  const field = win.locator('[data-settings-target="terminal.font-size"] input');
  await field.focus();
  await expect(field).toBeFocused();
  // Programmatic clicks keep focus in the field while collapse/expand unmounts
  // and re-mounts the Settings rail (a pointer click would focus the button).
  const trigger = win.getByTestId('sidebar-trigger-overlay');
  await trigger.getByRole('button', { name: 'Collapse sidebar' }).evaluate((b: HTMLElement) => b.click());
  await expect(search(win)).toHaveCount(0);
  await trigger.getByRole('button', { name: 'Expand sidebar' }).evaluate((b: HTMLElement) => b.click());
  await expect(search(win)).toBeVisible();
  await expect(field).toBeFocused();
  await expect(search(win)).not.toBeFocused();
});

test('the tray/menubar "Settings" entry (main-process IPC) focuses search', async ({ app }) => {
  const win = app.window;
  await leaveSettings(win);
  await win.evaluate(() => window.cc.menubar.open('settings'));
  await expect(search(win)).toBeFocused();
});

test('palette "Open Settings" focuses search over the palette restoring its opener', async ({ app }) => {
  const win = app.window;
  await leaveSettings(win);
  await win.keyboard.press('ControlOrMeta+p');
  const palette = win.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('Open Settings');
  await palette.getByRole('option').filter({ hasText: 'Open Settings' }).first().click();
  await expect(palette).toHaveCount(0);
  await expect(search(win)).toBeFocused();
});

test('a deep link to a field focuses that field, not search', async ({ app }) => {
  const win = app.window;
  await leaveSettings(win);
  await win.keyboard.press('ControlOrMeta+p');
  const palette = win.getByRole('dialog', { name: 'Command palette' });
  const input = palette.getByRole('combobox');
  await input.fill('does not make terminals faster');
  await expect(palette.getByRole('option').filter({ hasText: 'tmux' }).first()).toBeVisible({ timeout: 15_000 });
  await input.press('Enter');
  await expect(palette).toHaveCount(0);
  const row = win.locator('[data-settings-target="terminal.tmux-persistence"]').first();
  await expect(row).toHaveClass(/settings-search-flash/, { timeout: 10_000 });
  await expect.poll(() => row.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))).toBe(true);
  await expect(search(win)).not.toBeFocused();
});
