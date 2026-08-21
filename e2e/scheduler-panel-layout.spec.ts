/**
 * Top-level Scheduler view layout — the panel owns the full content track
 * with no inner project/group list rail (Inbox still splits; Scheduler does not).
 */
import { test, expect } from './fixtures/app';

test('top-level Scheduler view fills the content area without a list rail', async ({
  app
}) => {
  const win = app.window;

  await win.locator('.nav-item').filter({ hasText: 'Scheduler' }).first().click();

  const panel = win.locator('.settings-panel.scheduler-page');
  await panel.waitFor({ state: 'visible', timeout: 15_000 });

  await expect(panel.locator('.list-pane')).toHaveCount(0);
  await expect(panel.getByPlaceholder('Filter projects')).toHaveCount(0);

  const panelBox = await panel.boundingBox();
  const shellWidth = await win.evaluate(() => window.innerWidth);
  expect(panelBox, 'scheduler panel has a layout box').toBeTruthy();
  expect(panelBox!.width).toBeGreaterThan(600);
  expect(panelBox!.width).toBeGreaterThan(shellWidth * 0.5);
  expect(panelBox!.x + panelBox!.width).toBeGreaterThan(shellWidth - 40);
});
