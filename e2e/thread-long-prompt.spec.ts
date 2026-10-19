import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import { test, expect, type AppHandle } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

async function openThread(app: AppHandle) {
  const path = join(app.home, 'long-prompt-project');
  mkdirSync(path);
  const id = await app.window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Initial turn' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, realpathSync(path));
  await app.window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await expect(app.window.getByTestId('thread-assistant-text')).toContainText('Response to: Initial turn');
  await waitForCompletion(app, id);
  await expect(app.window.getByTestId('thread-assistant-text')).not.toHaveAttribute('data-streaming', 'true');
  return { detail: app.window.getByTestId('thread-detail'), threadId: id };
}

async function waitForCompletion(app: AppHandle, threadId: string) {
  await expect.poll(() => app.window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status;
  }, threadId)).toBe('idle');
}

async function expectReplyUncovered(timeline: Locator) {
  await timeline.evaluate((pane) => { pane.scrollTop = pane.scrollHeight; });
  // Visibility/viewport assertions alone pass when the opaque sticky prompt
  // paints over the answer. Hit-test the actual reply inside the scrollport.
  await expect.poll(() => timeline.getByTestId('thread-assistant-text').last().evaluate((reply) => {
    const viewport = reply.closest('[data-testid="thread-timeline"]')!.getBoundingClientRect();
    const rect = reply.getBoundingClientRect();
    const x = Math.max(rect.left, viewport.left) + 30;
    const y = Math.min(rect.bottom, viewport.bottom) - 20;
    return y > Math.max(rect.top, viewport.top) && reply.contains(document.elementFromPoint(x, y));
  })).toBe(true);
}

test('an expanded long prompt cannot cover the completed agent reply (#201)', async ({ app }, testInfo) => {
  const { detail, threadId } = await openThread(app);
  const timeline = detail.getByTestId('thread-timeline');
  const prompt = `Review this dashboard markup.\n\n${'<section>Dashboard content and styling to review.</section> '.repeat(400)}`;
  await detail.getByTestId('thread-command-input').fill(prompt);
  await detail.getByTestId('thread-command-send').click();
  await expect(timeline.getByTestId('thread-assistant-text').last()).toContainText('Response to: Review this dashboard markup.');
  await waitForCompletion(app, threadId);
  const user = timeline.getByTestId('thread-user-text').last();
  await user.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(user).toContainText(prompt);
  await expectReplyUncovered(timeline);
  await detail.screenshot({ path: testInfo.outputPath('expanded-prompt-reply.png') });
  await user.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(user.getByRole('button', { name: 'Show more', exact: true })).toBeVisible();
  await expectReplyUncovered(timeline);
});

test('prompt pinning adapts to viewport height even below the text truncation limit (#201)', async ({ app }) => {
  const { window } = app;
  await window.setViewportSize({ width: 1100, height: 1400 });
  const { detail, threadId } = await openThread(app);
  const timeline = detail.getByTestId('thread-timeline');
  const prompt = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: review the dashboard theme.`).join('\n');
  await detail.getByTestId('thread-command-input').fill(prompt);
  await detail.getByTestId('thread-command-send').click();
  await expect(timeline.getByTestId('thread-assistant-text').last()).toContainText('Response to: Line 1');
  await waitForCompletion(app, threadId);
  const userItem = timeline.getByTestId('thread-user-text').last().locator('..');
  await expect(userItem.getByTestId('thread-message-overflow')).toHaveCount(0);
  await expect(userItem).toHaveCSS('position', 'sticky');
  await window.setViewportSize({ width: 900, height: 600 });
  await expectReplyUncovered(timeline);
  await expect(userItem).toHaveCSS('position', 'relative');
  await window.setViewportSize({ width: 1100, height: 1400 });
  await expect(userItem).toHaveCSS('position', 'sticky');
  await expectReplyUncovered(timeline);
});
