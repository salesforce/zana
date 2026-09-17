import { test, expect } from './fixtures/app.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test('sidebar project search, keyboard actions, and Settings stay usable in both themes', async ({ app, home }, testInfo) => {
  const win = app.window;
  for (const name of ['design-system', 'commerce-app', 'mobile-client']) {
    const path = join(home, name);
    mkdirSync(path);
    const result = await win.evaluate((dir) => window.cc.projects.add(dir), path);
    expect(result.ok).toBe(true);
  }
  await win.getByTestId('nav-inbox').click();
  const rail = win.locator('.sidebar--global');
  const filter = rail.getByRole('textbox', { name: 'Filter projects' });
  await expect(filter).toBeVisible();
  await filter.fill('commerce');
  await expect(rail.getByRole('button', { name: 'Open commerce-app', exact: true })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Open design-system', exact: true })).toHaveCount(0);
  await filter.press('ArrowDown');
  await expect(filter).toHaveValue('commerce');
  await rail.getByRole('button', { name: 'Collapse Projects section' }).click();
  await expect(filter).toHaveCount(0);
  await rail.getByRole('button', { name: 'Expand Projects section' }).click();
  await expect(filter).toHaveValue('commerce');
  await filter.press('Escape');
  await expect(filter).toHaveValue('');
  await expect(rail.getByRole('button', { name: 'Open design-system', exact: true })).toBeVisible();
  await filter.fill('missing-project-xyz');
  await expect(rail.locator('.list-empty[role="status"]')).toContainText('No projects match');
  await rail.getByRole('button', { name: 'Clear filter', exact: true }).click();
  await expect(rail.locator('.list-empty[role="status"]')).toHaveCount(0);

  const project = rail.locator('.project-item').filter({ has: win.getByRole('button', { name: 'Open commerce-app', exact: true }) });
  await filter.focus();
  await win.keyboard.press('Tab');
  const spawn = project.locator('.project-spawn');
  await spawn.focus();
  await expect(spawn).toBeFocused();
  await expect(spawn).toHaveCSS('visibility', 'visible');
  await expect(spawn).toHaveCSS('opacity', '1');
  await expect(project.locator('.project-actions')).toHaveCSS('opacity', '1');
  await project.locator('.project-actions').press('Enter');
  await expect(win.getByRole('button', { name: 'Rename', exact: true })).toBeVisible();
  await win.keyboard.press('Escape');

  for (const theme of ['light', 'dark'] as const) {
    await win.evaluate((value) => window.cc.config.set({ theme: value }), theme);
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme);
    const settings = rail.getByRole('link', { name: 'Settings', exact: true });
    await expect(settings).toHaveText('Settings');
    await expect(settings).toBeInViewport();
    expect(await rail.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await win.screenshot({ path: testInfo.outputPath(`sidebar-${theme}.png`), animations: 'disabled' });
  }
  await rail.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(win.getByRole('navigation', { name: 'Settings navigation' })).toBeVisible();
  await win.getByRole('link', { name: 'Back to app' }).click();
  await expect(filter).toBeVisible();
});
