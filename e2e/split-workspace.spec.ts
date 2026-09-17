import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';

async function beginDrag(page: Page, source: Locator, target: Locator, x = 0.9, y = 0.5) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width * x, to!.y + to!.height * y, { steps: 12 });
}

const nav = (page: Page, title: string) => page.getByTestId(`nav-${title.toLowerCase()}`);

test('shell splits: drag, cancel, resize, move, maximize and reload', async ({ app }, testInfo) => {
  const { window: page } = app;
  await nav(page, 'Home').click();
  const workspace = page.getByTestId('split-workspace');
  await expect(workspace).toHaveAttribute('data-split', 'false');

  await beginDrag(page, nav(page, 'Inbox'), workspace);
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Split right');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.split-drag-overlay')).toHaveCount(0);
  await expect(workspace).toHaveAttribute('data-split', 'false');

  // A fresh click after cancellation must work; no sticky per-row suppression.
  await nav(page, 'Inbox').click();
  await expect(page).toHaveURL(/inbox/);
  await nav(page, 'Home').click();
  await page.locator('[contenteditable="true"]').first().fill('Draft survives split changes');
  await beginDrag(page, nav(page, 'Inbox'), workspace);
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Split right');
  await page.screenshot({ path: testInfo.outputPath('split-drop-preview.png') });
  await page.mouse.up();
  await expect(workspace).toHaveAttribute('data-split', 'true');
  await expect(workspace.locator('.split-pane')).toHaveCount(2);
  await expect(workspace.locator('.split-pane-bar-title')).toHaveText(['Home', 'Inbox']);
  await expect(page.locator('[contenteditable="true"]').first()).toHaveText('Draft survives split changes');
  const divider = workspace.getByRole('separator', { name: 'Resize panes left and right' });
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '52');
  await page.keyboard.press('Enter');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  const beforeResize = await workspace.locator('.split-pane').first().boundingBox();
  const handle = await divider.boundingBox();
  await page.mouse.move(handle!.x, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 100, handle!.y + handle!.height / 2, { steps: 10 });
  await expect(divider).toHaveAttribute('data-dragging', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await workspace.locator('.split-pane').first().boundingBox())!.width).toBeCloseTo(beforeResize!.width, 0);
  await page.mouse.move(handle!.x, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 100, handle!.y + handle!.height / 2, { steps: 10 });
  // Changing pane focus rerenders the shell while the pointer is captured.
  // That must not abort the divider interaction or use an obsolete callback.
  await page.keyboard.press('Control+1');
  await expect(workspace.locator('[data-focused="true"] .split-pane-bar-title')).toHaveText('Home');
  await expect(divider).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');

  // Keyboard focus tracks the containing pane as reliably as a pointer click.
  const inbox = workspace.locator('.split-pane').filter({ has: page.locator('.split-pane-bar-title', { hasText: 'Inbox' }) });
  await inbox.getByRole('button', { name: 'Move pane', exact: true }).click();
  await page.getByRole('option', { name: 'Move pane below', exact: true }).click();
  await expect(workspace.locator('.split-tree').first()).toHaveClass(/split-tree--col/);
  const maximize = inbox.getByRole('button', { name: 'Maximize pane', exact: true });
  await maximize.click();
  await expect(inbox).toHaveAttribute('data-maximized', 'true');
  const full = await workspace.boundingBox();
  const maximized = await inbox.boundingBox();
  expect(maximized!.x).toBeCloseTo(full!.x, 0);
  expect(maximized!.y).toBeCloseTo(full!.y, 0);
  expect(maximized!.width).toBeCloseTo(full!.width, 0);
  expect(maximized!.height).toBeCloseTo(full!.height, 0);
  await expect(nav(page, 'Home')).toBeVisible();
  await inbox.getByRole('button', { name: 'Restore pane' }).click();

  // Center-drag swaps views; an edge-drag moves the view into a new split.
  const homeTitle = workspace.locator('.split-pane-bar-title', { hasText: 'Home' });
  await beginDrag(page, homeTitle, inbox, 0.5, 0.5);
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Swap views');
  await page.mouse.up();
  await expect(workspace.locator('.split-pane-bar-title')).toHaveText(['Inbox', 'Home']);
  await beginDrag(page, workspace.locator('.split-pane-bar-title', { hasText: 'Home' }), inbox, 0.9, 0.5);
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Move right');
  await page.mouse.up();
  await expect(workspace.locator('.split-tree').first()).toHaveClass(/split-tree--row/);
  await expect(page.locator('[contenteditable="true"]').first()).toHaveText('Draft survives split changes');
  await page.screenshot({ path: testInfo.outputPath('split-workspace.png') });
  await page.setViewportSize({ width: 680, height: 900 });
  await expect(workspace).toHaveAttribute('data-split', 'false');
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
  await expect(page.locator('[contenteditable="true"]').first()).toHaveText('Draft survives split changes');
  await page.setViewportSize({ width: 1480, height: 960 });
  await expect(workspace).toHaveAttribute('data-split', 'true');
  await page.reload();
  await expect(workspace.locator('.split-pane-bar-title')).toHaveText(['Inbox', 'Home']);
  await workspace.getByRole('button', { name: 'Close pane', exact: true }).last().click();
  await expect(workspace).toHaveAttribute('data-split', 'false');
  await expect(workspace.locator('.split-pane')).toHaveCount(1);
});
