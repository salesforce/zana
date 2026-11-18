import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

const shell = (win: import('@playwright/test').Page) => win.locator('.app-shell');
/** Three-state is opt-in (Customize navigation > Collapsed behavior); seed it for the rail specs. */
async function useThreeState(win: import('@playwright/test').Page) {
  await win.evaluate(() => localStorage.setItem('zcc.sidebarCollapseBehavior', 'three-state'));
  await win.reload();
  await expect(win.getByTestId('sidebar-trigger-overlay')).toBeVisible();
  await expect(win.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}
const navWidth = (win: import('@playwright/test').Page) =>
  win.locator('.app-shell').evaluate((el) => getComputedStyle(el).getPropertyValue('--col-nav').trim());

test('rail toggles expanded <-> rail, keeps the expanded width, and then hides, one trigger click per state', async ({ app }) => {
  const win = app.window;
  await useThreeState(win);
  const trigger = win.getByTestId('sidebar-trigger-overlay');
  await expect(shell(win)).not.toHaveClass(/sidebar-is-rail/);
  const expandedWidth = await navWidth(win);

  await trigger.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(shell(win)).toHaveClass(/sidebar-is-rail/);
  await expect(shell(win)).not.toHaveClass(/sidebar-is-collapsed/);
  await expect.poll(() => navWidth(win)).toBe('52px');
  await expect(win.locator('aside.sidebar--rail')).toBeVisible();
  await expect(win.locator('.sidebar-resizer')).toHaveCount(0);
  await expect(win.locator('aside.sidebar--rail').getByRole('link', { name: 'Inbox' }).first()).toBeVisible();
  const overflow = await win.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(overflow).toBe(true);

  // Third click state: hidden. The label names the next state at each step.
  await trigger.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect(shell(win)).toHaveClass(/sidebar-is-collapsed/);
  await expect(shell(win)).not.toHaveClass(/sidebar-is-rail/);

  await trigger.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(shell(win)).not.toHaveClass(/sidebar-is-rail/);
  await expect(shell(win)).not.toHaveClass(/sidebar-is-collapsed/);
  await expect.poll(() => navWidth(win)).toBe(expandedWidth);
});

test('the mode persists across reload and a legacy collapsed flag migrates to hidden', async ({ app }) => {
  const win = app.window;
  await useThreeState(win);
  await win.getByTestId('sidebar-trigger-overlay').getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(shell(win)).toHaveClass(/sidebar-is-rail/);
  await win.reload();
  await expect(shell(win)).toHaveClass(/sidebar-is-rail/);

  await win.evaluate(() => {
    localStorage.removeItem('zcc.sidebarMode');
    localStorage.setItem('zcc.sidebarCollapsed', '1');
  });
  await win.reload();
  await expect(shell(win)).toHaveClass(/sidebar-is-collapsed/);
  await expect(shell(win)).not.toHaveClass(/sidebar-is-rail/);
});

test('the keyboard shortcut cycles the sidebar and Settings shows the rail expanded', async ({ app }) => {
  const win = app.window;
  await useThreeState(win);
  const chord = process.platform === 'darwin' ? 'Meta+Shift+b' : 'Control+Shift+b';
  await win.keyboard.press(chord);
  await expect(shell(win)).toHaveClass(/sidebar-is-rail/);

  await win.locator('aside.sidebar--rail').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(shell(win)).not.toHaveClass(/sidebar-is-rail/);
  await expect.poll(() => win.evaluate(() => localStorage.getItem('zcc.sidebarMode'))).toBe('rail');

  await win.keyboard.press(chord);
  await expect.poll(() => win.evaluate(() => localStorage.getItem('zcc.sidebarMode'))).toBe('hidden');
  await win.keyboard.press(chord);
  await expect.poll(() => win.evaluate(() => localStorage.getItem('zcc.sidebarMode'))).toBe('expanded');
});

for (const width of [900, 1100, 1440]) {
  test(`no horizontal overflow in rail at ${width}px`, async ({ app }) => {
    const win = app.window;
    await useThreeState(win);
    await win.setViewportSize({ width, height: 900 });
    await win.getByTestId('sidebar-trigger-overlay').getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(shell(win)).toHaveClass(/sidebar-is-rail/);
    expect(await win.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const trigger = await win.getByTestId('sidebar-trigger-overlay').getByRole('button', { name: 'Hide sidebar' }).boundingBox();
    expect(trigger).not.toBeNull();
  });
}

test('Customize navigation offers Collapsed behavior; default is two-state and the choice switches the cycle', async ({ app }) => {
  const win = app.window;
  const trigger = win.getByTestId('sidebar-trigger-overlay');
  // Default two-state: collapse hides directly, never stopping at the rail.
  await trigger.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(shell(win)).toHaveClass(/sidebar-is-collapsed/);
  await expect(shell(win)).not.toHaveClass(/sidebar-is-rail/);
  await trigger.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(shell(win)).not.toHaveClass(/sidebar-is-collapsed/);

  const sidebar = win.locator('aside.sidebar--global');
  await sidebar.getByRole('button', { name: 'More', exact: true }).click();
  await win.getByRole('menuitem', { name: 'Customize navigation' }).click();
  const dialog = win.getByRole('dialog', { name: 'Customize navigation' });
  await expect(dialog.getByRole('radio', { name: /Expanded, Hidden/ })).toBeChecked();
  await dialog.getByRole('radio', { name: /Expanded, Rail, Hidden/ }).check();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await trigger.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(shell(win)).toHaveClass(/sidebar-is-rail/);
  await win.reload();
  await expect.poll(() => win.evaluate(() => localStorage.getItem('zcc.sidebarCollapseBehavior'))).toBe('three-state');
});
