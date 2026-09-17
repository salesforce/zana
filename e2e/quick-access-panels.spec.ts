import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/app.js';

const test = base.extend({
  home: async ({ home }, use) => {
  const inboxDir = join(home, '.zcc', 'inbox');
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(join(inboxDir, 'entries.jsonl'), Array.from({ length: 24 }, (_, i) => JSON.stringify({
    id: `panel-entry-${i}`, projectId: 'design-review', projectLabel: 'Design system',
    ts: Date.UTC(2026, 8, 17, 9, i), report: true,
    subject: i === 23 ? 'Review the notification and favorites panel before the next release' : `Design review ${i + 1}`,
    comments: 'The updated layout is ready. Review the spacing, hierarchy, and keyboard navigation.'
  })).join('\n') + '\n');
    await use(home);
  }
});
test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('quick access panels share one surface, preserve navigation, and work with keyboard and narrow windows', async ({ app, home }, testInfo) => {
  const win = app.window;
    const projectPath = join(home, 'design-system');
    mkdirSync(projectPath);
    const project = await win.evaluate((path) => window.cc.projects.add(path), projectPath);
    if (!project.ok) throw new Error('Project registration failed');
    const thread = await win.evaluate(async (projectId) => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, providerId: 'fake', title: 'Review the design system', input: 'Check component spacing' })
      });
      return { status: response.status, body: await response.json() };
    }, project.value.id);
    expect(thread.status, JSON.stringify(thread.body)).toBe(201);
    await win.getByTestId('nav-agents').click();
    const card = win.locator('.agent-card').filter({ hasText: 'Review the design system' });
    await card.getByRole('button', { name: 'Follow this agent', exact: true }).click();
    const initialUrl = win.url();
    const bell = win.locator('.titlebar-bell');
    const star = win.locator('.titlebar-fav');
    await bell.click();
    const panel = win.locator('.quick-access-panel');
    await expect(panel).toHaveCount(1);
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('tab', { name: 'Notifications' })).toBeFocused();
    await expect(panel.locator('.notifications-drawer-row')).toHaveCount(20);
    await expect(panel).toContainText('24 unread · All projects');
    await expect(panel).toContainText('showing 20 of 24');
    expect(win.url()).toBe(initialUrl);

    for (const theme of ['light', 'dark'] as const) {
      await win.evaluate((value) => window.cc.config.set({ theme: value }), theme);
      await expect(win.locator('html')).toHaveAttribute('data-theme', theme);
      await win.mouse.move(10, 10);
      const bounds = await panel.boundingBox();
      expect(bounds!.width).toBeCloseTo(392, 1);
      expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await win.screenshot({ path: testInfo.outputPath(`notifications-${theme}.png`), animations: 'disabled' });
    }

    await star.click();
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute('aria-label', 'Favorites');
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByRole('tab', { name: 'Favorites' })).toBeFocused();
    await expect(panel.locator('.favorites-row')).toContainText('Review the design system');
    await win.screenshot({ path: testInfo.outputPath('favorites-dark.png'), animations: 'disabled' });
    await panel.getByRole('tab', { name: 'Favorites' }).press('ArrowLeft');
    await expect(panel.getByRole('tab', { name: 'Notifications' })).toBeFocused();
    await win.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(bell).toBeFocused();

    await star.click();
    await win.reload();
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute('aria-label', 'Favorites');
    await expect(star).toHaveAttribute('aria-expanded', 'true');
    await panel.getByRole('button', { name: 'Remove Review the design system from favorites' }).focus();
    await win.keyboard.press('Enter');
    await expect(panel.getByText('Keep important work close')).toBeVisible();
    expect(win.url()).toBe(initialUrl);
    await panel.getByRole('button', { name: 'Close favorites' }).click();
    await expect(star).toBeFocused();

    await bell.click();
    await win.getByTestId('nav-home').click();
    await expect(panel).toHaveCount(0);
    await bell.click();
    await win.setViewportSize({ width: 360, height: 640 });
    await expect(panel).toBeVisible();
    // Electron applies its renderer zoom as the viewport settles. Compare in
    // the renderer's actual CSS pixels, rather than assuming the host size.
    await expect.poll(() => panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.x >= 0 && bounds.right <= window.innerWidth && bounds.width < 392;
    })).toBe(true);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await win.screenshot({ path: testInfo.outputPath('notifications-narrow.png'), animations: 'disabled' });
    await win.setViewportSize({ width: 1280, height: 900 });
    await panel.locator('.notifications-drawer-view-all').click();
    await expect(panel).toHaveCount(0);
    await expect(win).toHaveURL(/inbox/);
});
