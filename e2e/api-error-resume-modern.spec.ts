/**
 * Resume after API errors for Modern threads (#649) at the real Electron boundary.
 *
 * A fake Codex app-server (no tokens) fails the first turn with a scripted provider error; the built app's
 * server must read the failed turn from the thread's own events and, when a rule matches, send the rule's
 * message as a new turn. Temporary errors resume; an auth error does not.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

const FIXTURE = fileURLToPath(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url));
const RULE = { id: 'r1', match: 'at capacity', matchMode: 'contains', message: 'continue', delaySeconds: 1, enabled: true };

test.use({
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'fixture-bin');
    mkdirSync(bin);
    const shellInit = `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`;
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(home, name), shellInit);
    writeFileSync(join(home, 'codex-script.json'), JSON.stringify({ turns: [] }));
    writeFileSync(join(bin, 'codex'), `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('codex-cli 0.153.4'); process.exit(0); }
if (!process.argv.includes('app-server')) process.exit(64);
process.argv = [process.execPath, ${JSON.stringify(FIXTURE)}, ${JSON.stringify(join(home, 'codex-script.json'))}];
import(${JSON.stringify(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url).href)});
`, { mode: 0o700 });
    await use({ PATH: `${bin}:${process.env.PATH ?? ''}`, ZDOTDIR: home });
  }
});

const failedTurn = (id: string, message: string, codexErrorInfo: string) => {
  const error = { message, codexErrorInfo, additionalDetails: null };
  return [
    { method: 'turn/started', params: { threadId: 'fixture', turn: { id, status: 'inProgress' } } },
    { method: 'error', params: { threadId: 'fixture', turnId: id, error, willRetry: false } },
    { method: 'turn/completed', params: { threadId: 'fixture', turn: { id, status: 'failed', error } } }
  ];
};
const delta = (id: string, text: string) => ({ method: 'item/agentMessage/delta', params: { threadId: 'fixture', turnId: id, itemId: `${id}-msg`, delta: text } });
/** Codex retries a flaky stream itself: `willRetry` errors, then the turn goes on and completes. */
const retriedThenOkTurn = (id: string) => {
  const error = { message: 'Selected model is at capacity. Please try a different model.', codexErrorInfo: 'serverOverloaded', additionalDetails: null };
  return [
    { method: 'turn/started', params: { threadId: 'fixture', turn: { id, status: 'inProgress' } } },
    { method: 'error', params: { threadId: 'fixture', turnId: id, error, willRetry: true } },
    { method: 'error', params: { threadId: 'fixture', turnId: id, error, willRetry: true } },
    delta(id, 'carrying on'),
    { method: 'turn/completed', params: { threadId: 'fixture', turn: { id, status: 'completed' } } }
  ];
};
/** The stream breaks after the model already said something. */
const midStreamFailedTurn = (id: string) => {
  const error = { message: 'Selected model is at capacity. Please try a different model.', codexErrorInfo: 'serverOverloaded', additionalDetails: null };
  return [
    { method: 'turn/started', params: { threadId: 'fixture', turn: { id, status: 'inProgress' } } },
    delta(id, 'Here is the first half of the answer'),
    { method: 'error', params: { threadId: 'fixture', turnId: id, error, willRetry: false } },
    { method: 'turn/completed', params: { threadId: 'fixture', turn: { id, status: 'failed', error } } }
  ];
};
const okTurn = (id: string) => [
  { method: 'turn/started', params: { threadId: 'fixture', turn: { id, status: 'inProgress' } } },
  { method: 'turn/completed', params: { threadId: 'fixture', turn: { id, status: 'completed' } } }
];

async function startThread(window: Page, home: string): Promise<string> {
  const root = join(home, 'modern-project');
  mkdirSync(root, { recursive: true });
  return window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'codex', input: 'Do the thing', permissionMode: 'full' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, root);
}

const requests = (window: Page, threadId: string) => window.evaluate(async (id) => {
  const rows = await (await fetch(`/api/v1/threads/${id}/events?limit=200`)).json();
  const list = (Array.isArray(rows) ? rows : rows.events ?? []) as Array<{ type?: string; payload?: { input?: Array<{ text?: string }> } }>;
  return list.filter((r) => r.type === 'client/turn/requested').map((r) => r.payload?.input?.[0]?.text ?? '');
}, threadId);

test('a Modern thread that fails on a temporary API error is resumed by a matching rule', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  writeFileSync(join(home, 'codex-script.json'), JSON.stringify({
    turns: [failedTurn('t1', 'Selected model is at capacity. Please try a different model.', 'serverOverloaded'), okTurn('t2')]
  }));
  await window.evaluate((rule) => window.cc.config.set({ apiErrorResume: { enabled: true, rules: [rule], maxPerWindow: 3, windowMinutes: 15 } }), RULE);
  const threadId = await startThread(window, home);
  await expect.poll(() => requests(window, threadId), { timeout: 30_000 }).toEqual(['Do the thing', 'continue']);
  await expect.poll(() => window.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId), { timeout: 30_000 }).toBe('idle');
});

test('a Modern thread that fails on an auth error is not resumed', async ({ app }) => {
  test.setTimeout(90_000);
  const { window, home } = app;
  writeFileSync(join(home, 'codex-script.json'), JSON.stringify({
    turns: [failedTurn('t1', 'at capacity but unauthorized', 'unauthorized'), okTurn('t2')]
  }));
  await window.evaluate((rule) => window.cc.config.set({ apiErrorResume: { enabled: true, rules: [rule], maxPerWindow: 3, windowMinutes: 15 } }), RULE);
  const threadId = await startThread(window, home);
  await expect.poll(() => window.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId), { timeout: 30_000 }).toBe('error');
  await window.waitForTimeout(4000); // well past the 1 s rule delay
  expect(await requests(window, threadId)).toEqual(['Do the thing']);
});

test('a stream that breaks after the model already spoke is still resumed', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  writeFileSync(join(home, 'codex-script.json'), JSON.stringify({ turns: [midStreamFailedTurn('t1'), okTurn('t2')] }));
  await window.evaluate((rule) => window.cc.config.set({ apiErrorResume: { enabled: true, rules: [rule], maxPerWindow: 3, windowMinutes: 15 } }), RULE);
  const threadId = await startThread(window, home);
  await expect.poll(() => requests(window, threadId), { timeout: 30_000 }).toEqual(['Do the thing', 'continue']);
});

test('errors the provider retries itself, then recovers, are not resumed', async ({ app }) => {
  test.setTimeout(90_000);
  const { window, home } = app;
  writeFileSync(join(home, 'codex-script.json'), JSON.stringify({ turns: [retriedThenOkTurn('t1'), okTurn('t2')] }));
  await window.evaluate((rule) => window.cc.config.set({ apiErrorResume: { enabled: true, rules: [rule], maxPerWindow: 3, windowMinutes: 15 } }), RULE);
  const threadId = await startThread(window, home);
  await expect.poll(() => window.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId), { timeout: 30_000 }).toBe('idle');
  await window.waitForTimeout(4000);
  expect(await requests(window, threadId)).toEqual(['Do the thing']);
});
