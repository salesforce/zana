import { test, expect } from './fixtures/app.js';

test('Home Thread composer uses the TipTap editor and provider controls', async ({ app }) => {
  const { window } = app;

  await window.locator('[data-testid="nav-home"]').click();
  const homeComposer = window.locator('.thread-command-composer, .home-agent-command').first();
  await expect(homeComposer).toBeVisible();
  await expect(homeComposer.locator('[data-testid="thread-command-input"], .ui-command-composer-input')).toBeVisible();
  await expect(homeComposer.getByLabel('Provider')).toBeVisible();
  await expect(homeComposer.getByLabel('Permission mode')).toBeVisible();
  await expect(homeComposer.getByTestId('thread-command-send')).toBeVisible();
});

test('Agents + opens the launch modal for a new thread or agent', async ({ app }) => {
  const { window } = app;

  await window.locator('[data-testid="nav-agents"]').click();
  const newThread = window.locator('[data-testid="agents-new"]');
  if (await newThread.count()) {
    await newThread.click();
  } else {
    await window.locator('[data-testid="agents-new-empty"]').click();
  }

  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Thread' })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Legacy Agent' })).toBeVisible();
  await expect(modal.locator('.thread-command-composer')).toBeVisible();
});
