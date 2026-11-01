import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import { test, expect, type AppHandle } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

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

test('sticky prompt backing blends into the thread sheet in both themes', async ({ app }) => {
  const { detail } = await openThread(app);
  const promptItem = detail.getByTestId('thread-user-text').first().locator('..');
  for (const theme of ['light', 'dark'] as const) {
    await app.window.evaluate(value => window.cc.config.set({ theme: value }), theme);
    await expect(app.window.locator('html')).toHaveAttribute('data-theme', theme);
    const surface = await promptItem.evaluate(node => {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const background = getComputedStyle(parent).backgroundColor;
        if (background !== 'rgba(0, 0, 0, 0)') return background;
      }
      throw new Error('Thread has no opaque background');
    });
    await expect(promptItem).toHaveCSS('background-color', surface);
    await expect(promptItem).toHaveCSS('position', 'sticky');
    await expect(promptItem.locator('.thread-timeline-bubble')).not.toHaveCSS('background-color', surface);
  }
});

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
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('expanded-prompt-reply.png'), detail);
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

test('a short-text prompt collapses by rendered height, not character count', async ({ app }) => {
  const { detail, threadId } = await openThread(app);
  const timeline = detail.getByTestId('thread-timeline');
  const prompt = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`).join('\n');
  await detail.getByTestId('thread-command-input').fill(prompt);
  await detail.getByTestId('thread-command-send').click();
  await expect(timeline.getByTestId('thread-assistant-text').last()).toContainText('Response to: Step 1');
  await waitForCompletion(app, threadId);
  const user = timeline.getByTestId('thread-user-text').last();
  const body = user.locator('.thread-message-collapsible');
  const collapsedHeight = await body.evaluate((el) => el.getBoundingClientRect().height);
  // 15 lines of 15px / 1.55 line-height, not the 30 lines the prompt renders.
  expect(collapsedHeight).toBeGreaterThan(300);
  expect(collapsedHeight).toBeLessThan(400);
  await user.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(user).toContainText('Step 30');
  expect(await body.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(collapsedHeight * 1.5);
  await expect(timeline.getByTestId('thread-assistant-text').last().getByTestId('thread-message-overflow')).toHaveCount(0);
});
