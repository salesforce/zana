/**
 * CLI Agent uses the same ModelReasoningPicker + execution-options catalog as
 * Modern Thread. The PTY adapter snapshot (Haiku/Sonnet/Opus/Fable `(latest)`)
 * is only a loading placeholder — once the catalog is ready, More models holds
 * selectedOnly aliases and the mode chip sits left of the harness trigger.
 */
import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';

const PTY_ALIAS_IDS = ['haiku', 'sonnet', 'opus', 'fable'] as const;

async function openCliAgentLauncher(window: Page) {
  await window.locator('[data-testid="nav-agents"]').click();
  if (await window.locator('[data-testid="agents-new"]').count()) {
    await window.locator('[data-testid="agents-new"]').click();
  } else if (await window.locator('[data-testid="agents-new-empty"]').count()) {
    await window.locator('[data-testid="agents-new-empty"]').click();
  } else {
    await window.locator('[data-testid="agents-board-new-thread"]').first().click();
  }
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'CLI Agent' }).click();
  return modal;
}

async function assertChipLeftOf(left: Locator, right: Locator) {
  await expect(left).toBeVisible({ timeout: 15_000 });
  await expect(right).toBeVisible({ timeout: 15_000 });
  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  expect(leftBox, 'mode chip bounding box').toBeTruthy();
  expect(rightBox, 'harness chip bounding box').toBeTruthy();
  expect(leftBox!.x).toBeLessThan(rightBox!.x);
}

test('CLI Agent mode sits left of harness and uses the Thread catalog, not PTY aliases', async ({ app }) => {
  const { window } = app;
  const modal = await openCliAgentLauncher(window);
  const mode = modal.getByTestId('composer-mode-picker-trigger');
  const trigger = modal.getByTestId('model-reasoning-picker-trigger');
  await expect(trigger.locator('[data-model-loading-placeholder="trigger-model"]')).toHaveCount(0, {
    timeout: 30_000
  });
  await assertChipLeftOf(mode, trigger);

  await trigger.click();
  const menu = window.getByTestId('model-reasoning-picker-menu');
  await expect(menu).toBeVisible();
  await expect(window.getByTestId('model-reasoning-more-toggle')).toBeVisible({ timeout: 30_000 });
  for (const id of PTY_ALIAS_IDS) {
    await expect(menu.getByTestId(`model-reasoning-model-${id}`)).toHaveCount(0);
  }
  await expect(menu.locator('[data-testid^="model-reasoning-model-claude-"]').first()).toBeVisible();

  await window.getByTestId('model-reasoning-more-toggle').click();
  await expect(window.getByTestId('model-reasoning-more-menu')).toBeVisible();
});
