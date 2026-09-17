/**
 * Built-Electron regression for thread lifecycle settlement: a live fake turn
 * with follow-ups must finish before queued messages run, without an Error or
 * user bubbles stuck on Pending. Exercise both Enter and the send button.
 */
import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({
  launchEnv: {
    ZCC_FAKE_PROVIDER: '1'
  }
});

test.afterEach(async ({ app }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const state = await app.window.evaluate(async () => {
    const { threads } = await (await fetch('/api/v1/threads')).json();
    const id = threads?.[0]?.id;
    if (!id) return { threads };
    return {
      threads,
      events: await (await fetch(`/api/v1/threads/${id}/events?limit=100`)).json(),
      nextTurn: await (await fetch(`/api/v1/threads/${id}/next-turn`)).json()
    };
  }).catch(() => null);
  await testInfo.attach('queue-state', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
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

test('Enter and Send queue follow-ups until the active response finishes', async ({ app }) => {
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
  await input.fill('delay:15000 keep this turn alive');
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
  await expect(followSend).toHaveAttribute('aria-label', 'Queue');
  const queued = detail.getByTestId('thread-queued-messages');

  await followInput.click();
  await followInput.fill('Is it done ?');
  await followInput.press('Enter');
  await expect(queued).toContainText('Is it done ?');
  await expect(followInput).toHaveText('');
  await expect(
    timeline.getByTestId('thread-user-text').filter({ hasText: 'Is it done ?' })
  ).toHaveCount(0);
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  await expect(window.locator('.thread-status-badge.is-working')).toBeVisible();

  await expect(followSend).toBeEnabled({ timeout: 15_000 });
  await followInput.click();
  await followInput.fill('delay:1000 Is it done yet?');
  await followSend.click();
  await expect(queued.locator('.thread-queued-item-text')).toHaveText([
    'Is it done ?',
    'delay:1000 Is it done yet?'
  ]);
  await expect(
    timeline.getByTestId('thread-user-text').filter({ hasText: 'Is it done yet?' })
  ).toHaveCount(0);
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  await expect(window.locator('.thread-status-badge.is-working')).toBeVisible();

  // The original response must survive, and both queued messages must drain in
  // FIFO order, with no interruption of the original turn.
  await expect(timeline).toContainText('Response to: delay:15000 keep this turn alive', { timeout: 30_000 });
  await expect(timeline).toContainText('Response to: Is it done ?', { timeout: 20_000 });
  await expect(timeline).toContainText('Response to: delay:1000 Is it done yet?', { timeout: 20_000 });
  await expect(queued).toHaveCount(0);
  await expect(timeline.getByTestId('thread-user-text')).toHaveText([
    'delay:15000 keep this turn alive',
    'Is it done ?',
    'delay:1000 Is it done yet?'
  ]);

  await expect.poll(() => pendingLabelCount(timeline), { timeout: 15_000 }).toBe(0);
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await expect(timeline.locator('span.is-shimmer').filter({ hasText: 'Running' })).toHaveCount(0);

  // The same conditional send starts immediately once the thread is idle.
  await expect(followSend).toHaveAttribute('aria-label', 'Send');
  await followInput.fill('An idle follow-up');
  await followInput.press('Enter');
  await expect(timeline).toContainText('Response to: An idle follow-up');
  await expect(queued).toHaveCount(0);

  // Steering remains an explicit action, with the BB shortcut inversion when
  // the Steer preference is selected.
  await expect(followSend).toHaveAttribute('aria-label', 'Send');
  await followInput.fill('delay:10000 verify explicit steering');
  await followInput.press('Enter');
  await expect(followSend).toHaveAttribute('aria-label', 'Queue');
  const modifierEnter = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await followInput.fill('An explicit steer');
  const steeringRequest = window.waitForRequest((request) => request.url().endsWith('/send') && request.method() === 'POST');
  await followInput.press(modifierEnter);
  expect((await steeringRequest).postDataJSON().mode).toBe('steer-if-active');
  await expect(timeline.getByTestId('thread-user-text').filter({ hasText: 'An explicit steer' })).toBeVisible();
  await expect(queued).toHaveCount(0);

  await composer.getByTestId('composer-send-mode-picker').click();
  await window.getByRole('option', { name: /^Steer/ }).click();
  await expect(followSend).toHaveAttribute('aria-label', 'Steer');
  await followInput.fill('delay:1000 Queue with modifier');
  await followInput.press(modifierEnter);
  await expect(queued).toContainText('Queue with modifier');
  await followInput.fill('A primary steer');
  await followInput.press('Enter');
  await expect(timeline.getByTestId('thread-user-text').filter({ hasText: 'A primary steer' })).toBeVisible();
  await expect(queued.locator('.thread-queued-item-text')).toHaveText(['delay:1000 Queue with modifier']);
  await expect.poll(() => pendingLabelCount(timeline)).toBe(0);
  await expect(timeline).toContainText('Response to: delay:10000 verify explicit steering', { timeout: 20_000 });
  await expect(timeline).toContainText('Response to: delay:1000 Queue with modifier', { timeout: 20_000 });
  await expect(queued).toHaveCount(0);
});
