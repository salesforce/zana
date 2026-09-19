import { test, expect } from './fixtures/app.js';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true });

// Execute the actual commands injected by CodexProvider, including their stdin
// payloads, through a real PTY and the built app's loopback hook listener.
const stub = String.raw`
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
if (process.argv.includes('--version')) { console.log('codex-cli 0.153.4'); process.exit(0); }
const hooks = new Map();
for (const arg of process.argv.slice(2)) {
  const event = /^hooks\.([^=]+)=/.exec(arg)?.[1];
  if (event) hooks.set(event, [...arg.matchAll(/command=("(?:[^"\\]|\\.)*")/g)].map(m => JSON.parse(m[1])));
}
function hook(event, payload = {}, foreign = false) {
  if (!hooks.has(event)) throw new Error('Missing injected hook: ' + event);
  for (let command of hooks.get(event)) {
    if (foreign) command = command.replace(/\/hook\/notify\/[^/]+\//, '/hook/notify/foreign/');
    const result = spawnSync('/bin/sh', ['-c', command], {
      input: JSON.stringify({ hook_event_name: event, turn_id: 'turn-probe', ...payload }),
      timeout: 6000, stdio: ['pipe', 'pipe', 'pipe']
    });
    if (result.status !== 0) throw new Error('Hook failed: ' + event);
  }
}
const approval = { tool_name: 'Bash', tool_input: { command: 'echo approved' } };
hook('UserPromptSubmit');
console.log('Codex status probe ready');
createInterface({ input: process.stdin }).on('line', line => {
  switch (line.trim()) {
    case 'permission': hook('PermissionRequest', approval); console.log('Would you like to run this command? 1. Yes 2. No'); break;
    case 'repaint': console.log('1. Yes  2. No'); break;
    case 'background':
      hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'background', tool_input: { command: 'echo unrelated' }, tool_response: 'x'.repeat(24000) });
      console.log('Background output '.repeat(1500)); break;
    case 'answer': hook('PostToolUse', { ...approval, tool_use_id: 'approval-1' }); console.log('Continuing'); break;
    case 'interrupt': hook('Interrupt'); console.log('Interrupted'); break;
    case 'start': hook('UserPromptSubmit'); console.log('Working'); break;
    case 'finish': hook('Stop'); console.log('Done'); break;
    case 'foreign': hook('PermissionRequest', approval, true); console.log('Foreign callback ignored'); break;
  }
  console.log('PROBE_ACK:' + line.trim());
});
`;

test('Codex CLI keeps Needs you through prompt repaints and resolves the matching approval', async ({ app, events }) => {
  const { window } = app;
  const dir = mkdtempSync(join(tmpdir(), 'zcc-codex-input-status-'));
  const binary = join(dir, 'codex-stub.cjs');
  writeFileSync(binary, `#!${process.execPath}\n${stub}`);
  chmodSync(binary, 0o755);
  let sessionId: string | undefined;
  let projectId: string | undefined;
  try {
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      return (result && 'ok' in result ? result.value : result).id;
    }, dir);
    await window.evaluate((path) => window.cc.config.set({ codexBinary: path }), binary);
    sessionId = await window.evaluate(async (id) => {
      const result = await window.cc.terminals.create({ projectId: id!, profile: 'codex', cols: 100, rows: 32, title: 'Codex input status probe' });
      const session = result && 'ok' in result ? result.value : result;
      if (!session?.id) throw new Error(JSON.stringify(result));
      return session.id;
    }, projectId);
    const state = () => window.evaluate(async (id) => {
      return (await window.cc.terminals.agentStatusSnapshot()).find(([sid]) => sid === id)?.[1];
    }, sessionId!);
    const send = async (command: string) => {
      await events.poll();
      const since = events.collect().at(-1)?.seq ?? 0;
      await window.evaluate(({ id, command }) => window.cc.terminals.write(id, command + '\r'), { id: sessionId!, command });
      await events.waitForEvent((event) => event.seq > since && event.channel === 'terminals:onData'
        && JSON.stringify(event.args).includes('PROBE_ACK:' + command), 15000);
    };
    await expect.poll(state).toBe('working');
    // Force the quiet→output edge that used to clear blocked on prompt paint.
    await window.waitForTimeout(1800);
    await send('permission');
    await expect.poll(state).toBe('blocked');
    await window.locator('.nav-item').filter({ hasText: 'Agents' }).first().click();
    const blockedCard = window.getByRole('listitem', { name: /^Needs you/ }).getByRole('button', { name: /^Codex input status probe/ });
    await expect(blockedCard).toBeVisible();
    for (const command of ['repaint', 'background']) {
      await window.waitForTimeout(1800);
      await events.poll();
      const since = events.collect().at(-1)?.seq ?? 0;
      await send(command);
      await window.waitForTimeout(1800);
      await events.poll();
      expect(await state()).toBe('blocked');
      expect(events.collect().filter((event) => event.seq > since && event.channel === 'terminals:onAgentStatus'
        && event.args[0] === sessionId && event.args[1] === 'working')).toHaveLength(0);
    }
    await send('answer');
    await expect.poll(state).toBe('working');
    await expect(blockedCard).toHaveCount(0);
    await expect(window.getByRole('listitem', { name: /^Working/ }).getByRole('button', { name: /^Codex input status probe/ })).toBeVisible();
    await send('foreign');
    await window.waitForTimeout(400);
    expect(await state()).toBe('working');
    await send('interrupt');
    await expect.poll(state).toBe('idle');
    await send('start');
    await expect.poll(state).toBe('working');
    await send('permission');
    await expect.poll(state).toBe('blocked');
    await send('finish');
    await expect.poll(state).toBe('idle');
  } finally {
    await window.evaluate(async ({ sessionId, projectId }) => {
      if (sessionId) await window.cc.terminals.close(sessionId);
      if (projectId) await window.cc.projects.remove(projectId);
    }, { sessionId, projectId }).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
