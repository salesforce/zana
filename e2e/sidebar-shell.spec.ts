import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { companionEnabled: true } });

test('the shell keeps its sidebar trigger and history controls in Electron title-bar chrome', async ({ app }) => {
  const { window } = app;
  const sidebar = window.locator('aside.sidebar').first();
  const sidebarTrigger = window.getByTestId('sidebar-trigger-overlay');

  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Minimize to Command Center' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Remote access' })).toHaveCount(0);
  await expect(sidebarTrigger).toBeVisible();
  const historyControls = window.getByTestId('sidebar-history-controls');
  await expect(historyControls).toBeVisible();
  await expect(historyControls.getByRole('button', { name: 'Go back' })).toBeVisible();
  await expect(historyControls.getByRole('button', { name: 'Go forward' })).toBeVisible();
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
  await expect(historyControls).toBeVisible();
  await expect(historyControls.getByRole('button', { name: 'Go back' })).toBeVisible();

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

test('Remote access is reachable through Settings without a footer shortcut', async ({ app }) => {
  const { window } = app;
  const utilities = window.getByLabel('Sidebar utilities');
  await expect(utilities.getByRole('link', { name: 'Remote access', exact: true })).toHaveCount(0);
  await utilities.getByRole('link', { name: 'Settings', exact: true }).click();
  await window.getByTestId('settings-nav-remote-access').click();
  await expect(window.getByRole('heading', { name: 'Remote access', exact: true })).toBeVisible();
});
