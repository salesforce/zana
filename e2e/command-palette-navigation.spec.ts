import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('command palette searches real threads and projects, filters categories, and remembers destinations', async ({ app, home }, testInfo) => {
  const win = app.window;
  const projectPath = join(home, 'design-system');
  mkdirSync(projectPath);
  writeFileSync(join(projectPath, 'palette-notes.md'), '# Palette review\n');
  const project = await win.evaluate((path) => window.cc.projects.add(path), projectPath);
  expect(project.ok).toBe(true);
  if (!project.ok) throw new Error('Project registration failed');
  const thread = await win.evaluate(async (projectId) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Audit the design system', input: 'Review component spacing' })
    });
    return { status: response.status, body: await response.json() };
  }, project.value.id);
  expect(thread.status, JSON.stringify(thread.body)).toBe(201);
  expect(thread.body.ok).toBe(true);
  const threadId = thread.body.value.id as string;
  await win.getByTestId('nav-inbox').click();

  const openPalette = async () => {
    await win.keyboard.press('ControlOrMeta+p');
    await expect(win.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await expect(win.getByRole('combobox', { name: 'Search commands and destinations' })).toBeFocused();
  };
  await openPalette();
  const palette = win.getByRole('dialog', { name: 'Command palette' });
  const input = palette.getByRole('combobox');
  await palette.getByRole('button', { name: 'Threads', exact: true }).click();
  await input.fill('Audit the design');
  const match = palette.getByRole('option', { name: /Audit the design system/ });
  await expect(match).toBeVisible({ timeout: 15_000 });
  await expect(match).toHaveAttribute('aria-selected', 'true');
  await expect(palette.getByRole('status')).toHaveText('1 result');
  await input.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(win).toHaveURL(new RegExp(`/threads/${threadId}$`));
  await expect(win.getByTestId('thread-detail')).toBeVisible();

  await openPalette();
  await expect(palette.locator('.palette-section').first()).toContainText('Recently used');
  await expect(palette.getByRole('option').first()).toContainText('Audit the design system');
  await expect(palette.getByRole('option', { name: /Audit the design system/ })).toHaveCount(1);

  for (const theme of ['light', 'dark'] as const) {
    await win.evaluate((value) => window.cc.config.set({ theme: value }), theme);
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme);
    await win.mouse.move(10, 10);
    expect(await palette.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await win.screenshot({ path: testInfo.outputPath(`command-palette-${theme}.png`), animations: 'disabled' });
  }

  await palette.getByRole('button', { name: 'Projects', exact: true }).click();
  await input.fill('design');
  await expect(palette.getByRole('option')).toHaveCount(1);
  await expect(palette.getByRole('option')).toContainText('design-system');
  await input.press('ArrowDown');
  await expect(palette.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await input.fill('no-such-project-xyz');
  await expect(palette.getByText('No results found')).toBeVisible();
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await input.press('PageDown');
  await input.press('Enter');
  await expect(palette).toBeVisible();

  await input.fill('');
  await input.press('Shift+Tab');
  await expect(palette.getByRole('button', { name: 'Commands', exact: true })).toBeFocused();
  await win.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.fill('design-system');
  await input.press('Enter');
  await expect(palette).toHaveCount(0);

  // File mode still searches the selected project through its real filesystem API.
  await openPalette();
  await input.fill('@palette-notes');
  await expect(palette.getByRole('option', { name: 'palette-notes.md' })).toBeVisible({ timeout: 15_000 });
  await expect(palette.getByText('Files in design-system', { exact: true })).toBeVisible();
  await input.fill('/');
  await expect(palette.getByText('Slash commands in design-system', { exact: true })).toBeVisible();
  await input.fill('#design-system');
  await expect(palette.getByRole('option', { name: /design-system/ })).toBeVisible();
  await input.press('Tab');
  await expect(input).toHaveValue(/\s$/);
  await expect(palette.getByRole('option')).toContainText('Launch in design-system');
  await input.press('Escape');
  await expect(palette).toHaveCount(0);

  await win.setViewportSize({ width: 800, height: 700 });
  await openPalette();
  await palette.getByRole('button', { name: 'Commands', exact: true }).click();
  await input.fill('Open Settings');
  await expect(palette.getByRole('option', { name: /Open Settings/ })).toBeVisible();
  expect(await palette.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await win.screenshot({ path: testInfo.outputPath('command-palette-narrow.png'), animations: 'disabled' });
  await input.press('Enter');
  await expect(win.getByRole('navigation', { name: 'Settings navigation' })).toBeVisible();
});

test('palette Favorites follows existing project stars and thread follows', async ({ app, home }, testInfo) => {
  const win = app.window;
  const path = join(home, 'design-system');
  mkdirSync(path);
  const project = await win.evaluate((dir) => window.cc.projects.add(dir), path);
  expect(project.ok).toBe(true);
  if (!project.ok) throw new Error('Project registration failed');
  const created = await win.evaluate(async (projectId) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Review accessibility', input: 'Review keyboard navigation' })
    });
    return response.json();
  }, project.value.id);
  expect(created.ok).toBe(true);
  await win.getByTestId('nav-inbox').click();
  const palette = win.getByRole('dialog', { name: 'Command palette' });
  const input = palette.getByRole('combobox');
  const favorites = async () => {
    await win.keyboard.press('ControlOrMeta+p');
    await palette.getByRole('button', { name: 'Favorites', exact: true }).click();
    await expect(input).toBeFocused();
  };
  await favorites();
  await expect(palette.getByText('No favorites yet')).toBeVisible();
  await input.press('Escape');

  // Use the same project star and follow control a user uses elsewhere in the app.
  await win.getByRole('button', { name: 'Add design-system to favorites', exact: true }).click();
  await win.getByTestId('nav-agents').click();
  const card = win.locator('.agent-card[data-kind="thread"]').filter({ hasText: 'Review accessibility' });
  await card.getByRole('button', { name: 'Follow this agent', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Unfollow this agent', exact: true })).toBeVisible();
  await win.reload();
  await expect(card.getByRole('button', { name: 'Unfollow this agent', exact: true })).toBeVisible();
  await favorites();
  await expect(palette.getByRole('option')).toHaveCount(2);
  await expect(palette.getByRole('option', { name: /Review accessibility/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: /^design-system / })).toBeVisible();

  for (const theme of ['light', 'dark'] as const) {
    await win.evaluate((value) => window.cc.config.set({ theme: value }), theme);
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme);
    await win.mouse.move(10, 10);
    await win.screenshot({ path: testInfo.outputPath(`palette-favorites-${theme}.png`), animations: 'disabled' });
  }
  await input.fill('not-a-favorite');
  await expect(palette.getByText('No favorites match your search')).toBeVisible();
  await input.fill('accessibility');
  await input.press('Enter');
  await expect(win).toHaveURL(new RegExp(`/threads/${created.value.id}$`));
  await expect(win.getByTestId('thread-detail')).toBeVisible();

  await win.getByTestId('nav-agents').click();
  await card.getByRole('button', { name: 'Unfollow this agent', exact: true }).click();
  await favorites();
  await expect(palette.getByRole('option')).toHaveCount(1);
  await expect(palette.getByRole('option')).toContainText('design-system');
  await win.setViewportSize({ width: 520, height: 700 });
  await expect(palette.getByRole('button', { name: 'Favorites', exact: true })).toBeInViewport();
  expect(await palette.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await input.press('Escape');
});
