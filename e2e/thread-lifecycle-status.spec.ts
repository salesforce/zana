/**
 * Built-Electron regression for thread lifecycle settlement: a live fake turn
 * with follow-ups must not show Error while work remains active, and must not
 * leave user bubbles stuck on Pending.
 */
import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({
  launchEnv: {
    ZCC_FAKE_PROVIDER: '1'
  }
});

async function pendingLabelCount(root: Locator): Promise<number> {
  const labels = root.getByTestId('thread-message-request-label');
  const count = await labels.count();
  let pending = 0;
  for (let i = 0; i < count; i += 1) {
    const text = (await labels.nth(i).innerText()).trim();
    if (text === 'Pending') pending += 1;
  }
  return pending;
}

test('live follow-ups do not Error the thread or leave Pending bubbles', async ({ app }) => {
  const { window } = app;
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible().catch(() => false)) {
    await support.getByRole('button', { name: 'Dismiss' }).click();
  }

  await window.getByTestId('nav-home').click();

  const homeComposer = window.locator('.thread-command-composer').first();
  await expect(homeComposer).toBeVisible({ timeout: 30_000 });
  const send = homeComposer.getByTestId('thread-command-send');
  await expect(send).toBeEnabled({ timeout: 30_000 });

  const input = homeComposer.getByTestId('thread-command-input');
  await input.click();
  await input.fill('delay:8000 keep this turn alive');
  await send.click();

  const detail = window.getByTestId('thread-detail');
  await expect(detail).toBeVisible({ timeout: 30_000 });
  const timeline = detail.getByTestId('thread-timeline');
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  await expect(
    timeline.getByTestId('thread-user-text').filter({ hasText: 'keep this turn alive' })
  ).toBeVisible({ timeout: 20_000 });
  await expect(window.locator('.thread-status-badge.is-working')).toBeVisible({ timeout: 15_000 });
  await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect.poll(() => pendingLabelCount(timeline), { timeout: 15_000 }).toBe(0);

  const composer = detail.locator('.thread-command-composer');
  const followInput = composer.getByTestId('thread-command-input');
  const followSend = composer.getByTestId('thread-command-send');
  await expect(followSend).toBeEnabled({ timeout: 15_000 });

  await followInput.click();
  await followInput.fill('Is it done ?');
  await followSend.click();
  await expect(
    timeline.getByTestId('thread-user-text').filter({ hasText: 'Is it done ?' })
  ).toBeVisible({ timeout: 15_000 });
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  await expect(window.locator('.thread-status-badge.is-working')).toBeVisible();

  await expect(followSend).toBeEnabled({ timeout: 15_000 });
  await followInput.click();
  await followInput.fill('Is it done yet?');
  await followSend.click();
  await expect(
    timeline.getByTestId('thread-user-text').filter({ hasText: 'Is it done yet?' })
  ).toBeVisible({ timeout: 15_000 });
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);

  await expect.poll(() => pendingLabelCount(timeline), { timeout: 15_000 }).toBe(0);
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  await expect(window.locator('.thread-status-badge.is-working')).toBeVisible();
  await expect(timeline.locator('span.is-shimmer').filter({ hasText: 'Running' })).toHaveCount(0);
});
