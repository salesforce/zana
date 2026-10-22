import type { Page } from '@playwright/test';
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
  await win.keyboard.press('ControlOrMeta+Comma');
  await expect(search(win)).toBeFocused();
  await win.keyboard.type('heartbeat');
  await expect(search(win)).toHaveValue('heartbeat');
  await expect(win.getByTestId('settings-result-agents.agent-heartbeat.intro')).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(search(win)).toHaveValue('');
  await expect(search(win)).toBeFocused();
  // The shortcut still toggles Settings closed.
  await win.keyboard.press('ControlOrMeta+Comma');
  await expect(search(win)).toHaveCount(0);
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
