import { test, expect } from './fixtures/app';

test.use({
  e2e: true,
  launchEnv: { ZCC_E2E_STARTUP_REPAIR_ONCE: '1' }
});

test('repair-required startup renders only repair UI and retries into normal shell', async ({ app }) => {
  const { window } = app;
  await expect(window.getByRole('heading', { name: 'Routing settings need repair' })).toBeVisible();
  await expect(window.locator('[data-testid="nav-agents"]')).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Retry migration' })).toBeVisible();

  await window.getByRole('button', { name: 'Retry migration' }).click();

  await expect(window.locator('[data-testid="nav-agents"]')).toBeVisible({ timeout: 30_000 });
  await expect(window.getByRole('heading', { name: 'Routing settings need repair' })).toHaveCount(0);
  await expect.poll(() => window.evaluate(() => window.cc.startup.state())).toEqual({ mode: 'ready' });
});
