import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true, defaultThreadProviderId: 'fake' }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

async function route(page: Page, path: string) {
  await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
}

// `zcc thread spawn` / `zcc thread tell` from inside a thread send `fromThreadId`
// (ZCC_THREAD_ID). The receiver shows the sender like a bot message.
test('a thread another agent spawned or messaged names the sending thread like a bot message', async ({ app, home }, testInfo) => {
  test.setTimeout(180_000);
  const page = app.window;
  const url = (path: string) => new URL(path, page.url()).href;
  const path = join(home, 'sender-project');
  mkdirSync(path);
  const projectId = (await (await page.request.post(url('/api/v1/projects'), { data: { path } })).json()).project.id as string;
  const thread = async (id: string) => (await (await page.request.get(url(`/api/v1/threads/${id}`))).json()).thread;

  const senderRes = await page.request.post(url('/api/v1/threads'), { data: { projectId, providerId: 'fake', title: 'Release planner', input: 'Plan the release' } });
  expect(senderRes.ok(), await senderRes.text()).toBe(true);
  const sender = (await senderRes.json()).thread.id as string;
  await expect.poll(async () => (await thread(sender)).status, { timeout: 30_000 }).toBe('idle');

  // Same body the control SDK sends for `zcc thread spawn`.
  const spawned = await page.request.post(url('/api/v1/threads'), {
    data: { projectId, providerId: 'fake', prompt: 'Read and execute the brief', visibility: 'visible', origin: 'sdk', fromThreadId: sender }
  });
  expect(spawned.ok(), await spawned.text()).toBe(true);
  const child = (await spawned.json()).thread.id as string;
  await expect.poll(async () => (await thread(child)).status, { timeout: 30_000 }).toBe('idle');
  // The title comes from visible text, never the agent-only sender header.
  expect(String((await thread(child)).title)).not.toContain('[From thread');

  await route(page, '/threads/' + child);
  const timeline = page.getByTestId('thread-timeline');
  const rows = timeline.locator('.thread-timeline-row.is-sourced');
  await expect(rows).toHaveCount(1, { timeout: 15_000 });
  const header = rows.first().getByTestId('thread-message-source');
  await expect(header).toHaveAttribute('data-source-kind', 'thread');
  await expect(header).toContainText('Release planner');
  await expect(header).toContainText('started this thread');
  await expect(rows.first()).toContainText('Read and execute the brief');
  await expect(rows.first()).not.toContainText('[From thread');
  await expect(rows.first().getByTestId('thread-edit-message')).toHaveCount(0);
  expect(parseFloat(await rows.first().locator('.thread-timeline-bubble').evaluate(el => getComputedStyle(el).borderLeftWidth))).toBeGreaterThan(2);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('thread-sender-spawn.png'));

  // Same body the CLI sends for `zcc thread tell` from inside a thread.
  const told = await page.request.post(url(`/api/v1/threads/${child}/send`), { data: { text: 'Any blockers?', mode: 'auto', fromThreadId: sender } });
  expect(told.ok(), await told.text()).toBe(true);
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  await expect(rows.nth(1).getByTestId('thread-message-source')).toContainText('messaged');

  // An operator send (no fromThreadId) stays an ordinary user prompt.
  await expect.poll(async () => (await thread(child)).status, { timeout: 30_000 }).toBe('idle');
  const plain = await page.request.post(url(`/api/v1/threads/${child}/send`), { data: { text: 'Thanks', mode: 'auto' } });
  expect(plain.ok(), await plain.text()).toBe(true);
  await expect(timeline.locator('.thread-timeline-row.is-user', { hasText: 'Thanks' })).toHaveCount(1, { timeout: 15_000 });
  await expect(rows).toHaveCount(2);

  // The header links back to the sending thread in-app.
  await header.getByRole('link', { name: 'Release planner' }).click();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/threads/' + sender);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('thread-sender-tell.png'));
});
