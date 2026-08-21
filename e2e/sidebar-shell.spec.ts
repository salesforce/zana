import { test, expect } from './fixtures/app';

test('the shell keeps its sidebar trigger and history controls in Electron title-bar chrome', async ({ app }) => {
  const { window } = app;
  const sidebar = window.locator('aside.sidebar').first();
  const sidebarTrigger = window.getByTestId('sidebar-trigger-overlay');

  await expect(sidebar).toBeVisible();
  await expect(sidebarTrigger).toBeVisible();
  const triggerBeforeCollapse = await sidebarTrigger.boundingBox();
  expect(triggerBeforeCollapse).not.toBeNull();
  expect(triggerBeforeCollapse?.y).toBe(0);
  await expect(sidebarTrigger.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await sidebarTrigger.getByRole('button', { name: 'Collapse sidebar' }).click();

  // Collapse removes the rail entirely, but the root trigger stays at its fixed
  // top-left position rather than being reparented into page content.
  await expect(window.locator('aside.sidebar')).toHaveCount(0);

  const expandSidebar = sidebarTrigger.getByRole('button', { name: 'Expand sidebar' });
  await expect(expandSidebar).toBeVisible();
  await expect(expandSidebar).toHaveClass(/sidebar-expand-control/);
  await expect(expandSidebar).toHaveAttribute('aria-expanded', 'false');
  const triggerAfterCollapse = await sidebarTrigger.boundingBox();
  expect(triggerAfterCollapse).not.toBeNull();
  expect(triggerAfterCollapse?.x).toBe(triggerBeforeCollapse?.x);
  expect(triggerAfterCollapse?.y).toBe(triggerBeforeCollapse?.y);

  await expandSidebar.click();
  await expect(sidebar).toBeVisible();
  await expect(sidebarTrigger.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});
