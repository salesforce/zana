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

  await followInput.fill('Do not send this cancelled follow-up');
  await followInput.press('Enter');
  const cancelledMessage = queued.locator('.thread-queued-ghost').filter({ hasText: 'Do not send this cancelled follow-up' });
  await expect(cancelledMessage).toBeVisible();
  const removalResponse = window.waitForResponse((response) => response.request().method() === 'DELETE'
    && response.url().includes('/next-turn/'));
  await cancelledMessage.getByRole('button', { name: 'Remove queued message' }).click();
  expect((await removalResponse).status()).toBe(200);
  await expect(cancelledMessage).toHaveCount(0);
  await expect(queued.getByTestId('thread-queued-flush-error')).toHaveCount(0);
  await expect(queued.locator('.thread-queued-item-text')).toHaveText(['Is it done ?']);
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

test('Remove deletes paused queued messages, including the last one', async ({ app }) => {
  const { window } = app;
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible().catch(() => false)) {
    await support.getByRole('button', { name: 'Dismiss' }).click();
  }
  await window.getByTestId('nav-home').click();
  const homeComposer = window.locator('.thread-command-composer').first();
  await expect(homeComposer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await homeComposer.getByTestId('thread-command-input').fill('delay:60000 keep running until stopped');
  await homeComposer.getByTestId('thread-command-send').click();

  const detail = window.getByTestId('thread-detail');
  await expect(detail).toBeVisible({ timeout: 30_000 });
  const composer = detail.locator('.thread-command-composer');
  const input = composer.getByTestId('thread-command-input');
  const queued = detail.getByTestId('thread-queued-messages');
  await expect(composer.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Queue');
  for (const message of ['First queued message', 'Second queued message']) {
    await input.fill(message);
    await input.press('Enter');
    await expect(queued).toContainText(message);
  }
  await window.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(queued.getByTestId('thread-queued-paused')).toBeVisible();

  for (const message of ['First queued message', 'Second queued message']) {
    const row = queued.locator('.thread-queued-ghost').filter({ hasText: message });
    const removalResponse = window.waitForResponse((response) => response.request().method() === 'DELETE'
      && response.url().includes('/next-turn/'));
    await row.getByRole('button', { name: 'Remove queued message' }).click();
    const response = await removalResponse;
    expect(response.status()).toBe(200);
    await expect(row).toHaveCount(0);
    await expect(detail.getByTestId('thread-queued-flush-error')).toHaveCount(0);

    // Verify persisted queue state independently of the card's optimistic removal.
    const remaining = await window.evaluate(async (deleteUrl) => {
      const listUrl = deleteUrl.slice(0, deleteUrl.lastIndexOf('/'));
      return (await (await fetch(listUrl)).json()).items.length;
    }, response.url());
    expect(remaining).toBe(message === 'First queued message' ? 1 : 0);
  }
  await expect(queued).toHaveCount(0);
  await expect(detail.getByTestId('thread-timeline').getByTestId('thread-user-text')).toHaveText([
    'delay:60000 keep running until stopped'
  ]);
});

test('a distant child completion keeps the parent Working and follow-ups queued', async ({ app }) => {
  const { window } = app;
  await window.getByTestId('nav-home').click();
  const home = window.locator('.thread-command-composer').first();
  await expect(home.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await home.getByTestId('thread-command-input').fill('nested_turn delay:15000 finish the parent');
  await home.getByTestId('thread-command-send').click();
  const detail = window.getByTestId('thread-detail');
  const timeline = detail.getByTestId('thread-timeline');
  await expect(timeline).toContainText('Child finished; parent still running.', { timeout: 30_000 });
  await expect(window.locator('.thread-status-badge.is-working')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  const composer = detail.locator('.thread-command-composer');
  await expect(composer.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Queue');
  await composer.getByTestId('thread-command-input').fill('Follow-up after the parent');
  await composer.getByTestId('thread-command-input').press('Enter');
  await expect(detail.getByTestId('thread-queued-messages')).toContainText('Follow-up after the parent');
  await expect(timeline.getByTestId('thread-user-text').filter({ hasText: 'Follow-up after the parent' })).toHaveCount(0);
  await expect(timeline).toContainText('Response to: nested_turn delay:15000 finish the parent', { timeout: 30_000 });
  await expect(timeline).toContainText('Response to: Follow-up after the parent', { timeout: 20_000 });
  await expect(detail.getByTestId('thread-queued-messages')).toHaveCount(0);
  await expect(composer.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Send');
});

test('idle follow-ups start despite eight hidden active threads', async ({ app }) => {
  const { window } = app;
  await window.getByTestId('nav-home').click();
  const home = window.locator('.thread-command-composer').first();
  await expect(home.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await home.getByTestId('thread-command-input').fill('Finish the initial job');
  await home.getByTestId('thread-command-send').click();
  const detail = window.getByTestId('thread-detail');
  const timeline = detail.getByTestId('thread-timeline');
  await expect(timeline).toContainText('Response to: Finish the initial job', { timeout: 30_000 });
  const composer = detail.locator('.thread-command-composer');
  const send = composer.getByTestId('thread-command-send');
  await expect(send).toHaveAttribute('aria-label', 'Send');

  // Real host sessions in the isolated app reproduce hidden live probes filling
  // the reconnect concurrency budget while this visible thread is idle.
  const hiddenIds = await window.evaluate(async () => {
    const { threads } = await (await fetch('/api/v1/threads')).json();
    const { projectId, hostId, environmentId } = threads[0];
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const response = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId, hostId, providerId: 'fake', visibility: 'hidden',
          environment: { kind: 'reuse', environmentId },
          input: `delay:60000 hidden work ${index}`
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      ids.push(body.thread.id);
    }
    return ids;
  });
  try {
    await expect.poll(() => window.evaluate(async (ids) => {
      const rows = await Promise.all(ids.map(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread));
      return rows.filter((row) => row.status === 'active').length;
    }, hiddenIds), { timeout: 20_000 }).toBe(8);

    for (const submit of ['Enter', 'Send']) {
      const prompt = `Follow-up via ${submit}`;
      await expect(send).toHaveAttribute('aria-label', 'Send');
      await composer.getByTestId('thread-command-input').fill(prompt);
      if (submit === 'Enter') await composer.getByTestId('thread-command-input').press('Enter');
      else await send.click();
      await expect(timeline).toContainText(`Response to: ${prompt}`, { timeout: 20_000 });
      await expect(detail.getByTestId('thread-queued-messages')).toHaveCount(0);
      await expect.poll(() => pendingLabelCount(timeline)).toBe(0);
    }
  } finally {
    await window.evaluate(async (ids) => {
      for (const id of ids) {
        const response = await fetch(`/api/v1/threads/${id}/stop`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
        });
        if (!response.ok) throw new Error(`Failed to stop fixture thread: ${response.status}`);
      }
    }, hiddenIds);
  }
});

test('Send now sends the selected message from active and paused queues', async ({ app }, testInfo) => {
  const { window } = app;
  await window.getByTestId('nav-home').click();
  const home = window.locator('.thread-command-composer').first();
  await expect(home.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await home.getByTestId('thread-command-input').fill('delay:60000 keep the original job running');
  await home.getByTestId('thread-command-send').click();
  const detail = window.getByTestId('thread-detail');
  const timeline = detail.getByTestId('thread-timeline');
  const composer = detail.locator('.thread-command-composer');
  const input = composer.getByTestId('thread-command-input');
  await expect(composer.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Queue');
  const queued = detail.getByTestId('thread-queued-messages');
  for (const message of ['Keep this queued', 'Send this during the job', 'Send this after stop']) {
    await input.fill(message);
    await input.press('Enter');
    await expect(queued).toContainText(message);
  }
  const during = queued.locator('.thread-queued-ghost').filter({ hasText: 'Send this during the job' });
  await expect(during.getByRole('button', { name: 'Send now', exact: true })).toBeVisible();
  await queued.screenshot({ path: testInfo.outputPath('queue-send-now.png') });
  const sent = window.waitForResponse((response) => response.request().method() === 'POST'
    && /\/next-turn\/[^/]+\/send$/.test(response.url()));
  await during.getByRole('button', { name: 'Send now', exact: true }).click();
  expect((await sent).status()).toBe(200);
  await expect(timeline.getByTestId('thread-user-text').filter({ hasText: 'Send this during the job' })).toBeVisible();
  await expect(queued.locator('.thread-queued-item-text')).toHaveText(['Keep this queued', 'Send this after stop']);
  await expect(timeline).not.toContainText('Response to: delay:60000 keep the original job running');

  await window.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(queued.getByTestId('thread-queued-paused')).toBeVisible();
  await expect(composer.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Send');
  const afterStop = queued.locator('.thread-queued-ghost').filter({ hasText: 'Send this after stop' });
  // The per-row button is also keyboard-operable without using the bulk action.
  await afterStop.getByRole('button', { name: 'Send now', exact: true }).focus();
  await window.keyboard.press('Enter');
  await expect(timeline).toContainText('Response to: Send this after stop', { timeout: 20_000 });
  await expect(queued.locator('.thread-queued-item-text')).toHaveText(['Keep this queued']);
  await expect(queued.getByTestId('thread-queued-paused')).toBeVisible();
  await expect(timeline.getByTestId('thread-user-text').filter({ hasText: 'Keep this queued' })).toHaveCount(0);
  await expect(queued.getByRole('button', { name: 'Send all', exact: true })).toBeVisible();
  await expect(queued.getByRole('button', { name: 'Send now', exact: true })).toBeEnabled();
  await expect(queued.getByRole('alert')).toHaveCount(0);
});
