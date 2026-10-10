/**
 * LIVE-ONLY, MANUAL/OPT-IN check — real Claude Code, real model spend.
 * Gated on ZCC_LIVE_CLAUDE=1; SKIPPED by default, including in CI. Run with
 * `ZCC_LIVE_CLAUDE=1 pnpm test:e2e -- e2e/live-background-stop.spec.ts`.
 *
 * Proves the native stop chain end to end: card row → server → host daemon →
 * Claude bridge → SDK stopTask, with no fallback message to the agent. The
 * always-on fallback coverage lives in e2e/thread-background-stop.spec.ts.
 */
import { connect } from 'node:net';
import { test, expect } from './fixtures/app.js';

test.use({ seedClaudeAuth: true, initialConfig: { sponsorPromptDismissed: true } });

const listening = (port: number) => new Promise<boolean>(resolve => {
  const socket = connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

test('a real Claude background server is stopped natively from its card row while idle', async ({ app }) => {
  test.skip(process.env.ZCC_LIVE_CLAUDE !== '1',
    'LIVE-ONLY opt-in check, not a CI signal: requires ZCC_LIVE_CLAUDE=1 plus an authenticated claude CLI');
  test.setTimeout(300_000);
  const { window } = app;
  const port = 47_000 + Math.floor(Math.random() * 2000);
  const id = await window.evaluate(async port => {
    const project = (await window.cc.projects.list())[0];
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, providerId: 'claude-code', permissionMode: 'full',
        input: `Use your Bash tool with run_in_background set to true to run exactly: python3 -m http.server ${port} --bind 127.0.0.1\n`
          + 'Do not wait for it, do not check on it, do not stop it. Immediately reply with the single word STARTED and end your turn.' }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, port);
  const status = () => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id);
  await expect.poll(status, { timeout: 180_000, intervals: [2000] }).toBe('idle');
  await expect.poll(() => listening(port), { timeout: 20_000 }).toBe(true);

  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  const card = window.getByTestId('thread-background-commands');
  await expect(card).toContainText(String(port), { timeout: 30_000 });

  const response = window.waitForResponse(r => r.url().endsWith(`/threads/${id}/background/stop`));
  await card.getByRole('button', { name: /^Stop / }).first().click();
  const body = await (await response).json();
  // Native stop: the item is reported stopped and nothing was handed to the agent.
  expect(body.stopped?.length).toBeGreaterThan(0);
  expect(body.requested ?? []).toEqual([]);

  await expect.poll(() => listening(port), { timeout: 20_000 }).toBe(false);
  await expect(card).toBeHidden({ timeout: 20_000 });
  await expect(window.getByTestId('thread-timeline')).not.toContainText('Stop these running background tasks now');
});
