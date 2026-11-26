import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true, defaultThreadProviderId: 'fake' }, launchEnv: { ZCC_FAKE_PROVIDER: '1', ZCC_E2E_PEER_BOOT_KEY_HEX: randomBytes(32).toString('hex') } });

async function route(page: Page, path: string) {
  await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
}

/** Call a plugin agent tool as the host daemon does for a running turn. */
function toolCaller(page: Page, home: string) {
  const origin = new URL(page.url()).origin;
  const auth = JSON.parse(readFileSync(join(home, '.zcc', 'auth.json'), 'utf8')) as { hostId: string; hostKey: string };
  let n = 0;
  return async (threadId: string, tool: string, args: Record<string, unknown>) => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      n += 1;
      const res = await fetch(`${origin}/internal/hosts/tool-call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.hostKey}`, 'x-zcc-host-id': auth.hostId },
        body: JSON.stringify({ sessionId: threadId, threadId, providerThreadId: threadId, turnId: `e2e-turn-${n}`, callId: `e2e-call-${n}`, tool, arguments: args })
      });
      const body = await res.json() as { success?: boolean; contentItems?: Array<{ text?: string }> };
      const text = (body.contentItems ?? []).map(i => i.text ?? '').join('\n');
      if (!text.includes('plugin tool policy not ready') || Date.now() > deadline) return { success: body.success, text };
      await new Promise(r => setTimeout(r, 1_000));
    }
  };
}

test('first bot contact sends without approval and replies reach running and idle threads with attribution', async ({ app, home }, testInfo) => {
  test.setTimeout(240_000);
  const page = app.window;
  const toggle = page.getByRole('switch', { name: 'Bots', exact: true });
  await route(page, '/settings/experimental');
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
  await page.getByRole('link', { name: 'Back to app' }).click();
  await route(page, '/settings/experimental');
  await toggle.click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('link', { name: 'Back to app' }).click();

  const rpc = async (method: string, args: Record<string, unknown>) => {
    const res = await page.request.post(new URL('/api/v1/plugin-apps/bots/rpc', page.url()).href, { data: { method, args } });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).value;
  };
  const path = join(home, 'reply-project');
  mkdirSync(path);
  const projectId = (await (await page.request.post(new URL('/api/v1/projects', page.url()).href, { data: { path } })).json()).project.id;
  await rpc('create', { name: 'Demo Tester', projectId, providerId: 'fake', color: '#7c5cff' });

  // Thread A: an ordinary conversation with a long-running turn.
  const created = await page.request.post(new URL('/api/v1/threads', page.url()).href, { data: { projectId, providerId: 'fake', title: 'Release check', input: 'delay:25000 Work on the release' } });
  expect(created.ok(), await created.text()).toBe(true);
  const a = (await created.json()).thread.id as string;
  const api = (id: string) => new URL(`/api/v1/threads/${id}`, page.url()).href;
  const thread = async (id: string) => (await (await page.request.get(api(id))).json()).thread;
  await expect.poll(async () => (await thread(a)).status, { timeout: 30_000 }).toBe('active');
  await route(page, '/threads/' + a);

  // First contact opens bot thread B and unlocks bot_reply.
  const call = toolCaller(page, home);
  const sendResult = await call(a, 'bot_send', { bot: 'Demo Tester', message: 'Please say hi.' });
  expect(sendResult.success, sendResult.text).toBe(true);
  expect(app.electron.windows().filter(w => w !== page && w.url().startsWith('data:text/html'))).toHaveLength(0);
  const delivery = JSON.parse(sendResult.text) as { threadId: string; createdMainThread: boolean };
  expect(delivery.createdMainThread).toBe(true);
  const b = delivery.threadId;

  // B replies while A's turn is still running.
  expect((await thread(a)).status).toBe('active');
  const reply = await call(b, 'bot_reply', { threadId: a, message: "Hi! I'm Demo Tester, a friendly read-only test bot." });
  expect(reply.success, reply.text).toBe(true);

  const events = async (id: string) => (await (await page.request.get(api(id) + '/events?limit=500')).json()).events as Array<{ type: string; data?: any; payload?: any }>;
  const sourced = async () => (await events(a)).filter(e => e.type === 'client/turn/requested' && (e.data ?? e.payload)?.messageSource);
  await expect.poll(async () => (await sourced()).length, { timeout: 15_000 }).toBe(1);
  const steer = (await sourced())[0]!;
  const data = steer.data ?? steer.payload;
  expect(data.messageSource).toMatchObject({ pluginId: 'bots', kind: 'bot', label: 'Demo Tester', color: '#7c5cff', threadId: b, detail: 'replied' });
  expect(data.target.kind).toBe('steer');
  expect(data.input[0]).toMatchObject({ text: '[Reply from bot Demo Tester]', visibility: 'agent-only' });
  // Nothing waits behind "Send now".
  const timeline = page.getByTestId('thread-timeline');
  const botRow = timeline.locator('.thread-timeline-row.is-sourced');
  await expect(botRow).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Send now' })).toHaveCount(0);
  const header = botRow.getByTestId('thread-message-source');
  await expect(header).toContainText('Demo Tester');
  await expect(header).toContainText('Bot');
  await expect(header).toContainText('replied');
  await expect(botRow).not.toContainText('[Reply from bot');
  await expect(botRow.getByTestId('thread-edit-message')).toHaveCount(0);
  // The accent bar is wider than the ordinary 1px border (zoom scales the exact value).
  expect(parseFloat(await botRow.locator('.thread-timeline-bubble').evaluate(el => getComputedStyle(el).borderLeftWidth))).toBeGreaterThan(2);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('bot-reply-steer.png'));

  // Once A is idle, a second reply starts a new turn instead of queueing.
  await expect.poll(async () => (await thread(a)).status, { timeout: 60_000 }).toBe('idle');
  const again = await call(b, 'bot_reply', { threadId: a, message: 'One more thing: all checks pass.' });
  expect(again.success, again.text).toBe(true);
  await expect.poll(async () => (await sourced()).length, { timeout: 15_000 }).toBe(2);
  expect(((await sourced())[1]!.data ?? (await sourced())[1]!.payload).target.kind).toBe('new-turn');
  await expect(botRow).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Send now' })).toHaveCount(0);
  await expect.poll(async () => (await thread(a)).status, { timeout: 60_000 }).toBe('idle');
  await expect(timeline).toContainText('Response to:');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('bot-reply-idle.png'));
});
