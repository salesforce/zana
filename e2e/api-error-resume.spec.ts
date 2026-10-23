/**
 * Resume after API errors (#421) at the real Electron boundary. A stub Claude
 * CLI runs the REAL `UserPromptSubmit` and `StopFailure` hook commands main
 * injected into its `--settings`, against main's loopback notify route, as
 * Claude Code does. A StopFailure must end the turn (agent goes idle) and, when
 * a configured rule matches, make main type the rule's message into the PTY.
 * With no rule, nothing is typed.
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

// Runs the injected hook commands as the CLI would, and records every other
// typed line (bracketed-paste markers stripped) in typed.log.
const CLAUDE_STUB = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.296 (Claude Code)'); process.exit(0); }
if (args.includes('--print')) { console.log('Probe'); process.exit(0); }
const at = args.indexOf('--settings');
const hooks = (at >= 0 ? JSON.parse(args[at + 1]) : { hooks: {} }).hooks || {};
const commands = (event) => (hooks[event] || []).flatMap((entry) => (entry.hooks || []).map((hook) => hook.command));
const run = (event, input) => commands(event).forEach((command) =>
  spawnSync('/bin/sh', ['-c', command], { input, env: process.env, timeout: 15000, encoding: 'utf8' }));
const idle = () => process.stdout.write('\x1b]0;✳ Claude Code\x07');
console.log('Claude API error probe ready');
idle();
createInterface({ input: process.stdin }).on('line', (raw) => {
  const line = raw.replace(/\x1b\[20[01]~/g, '').trim();
  if (!line) return;
  const stop = /^probe stopfailure-([\w-]+)$/.exec(line);
  if (line === 'probe prompt') run('UserPromptSubmit', JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'work' }));
  else if (stop) run('StopFailure', fs.readFileSync(join(__dirname, stop[1] + '.json'), 'utf8'));
  else fs.appendFileSync(join(__dirname, 'typed.log'), line + '\n');
  if (line.startsWith('probe ')) console.log('PROBE_ACK:' + line.slice(6));
  idle();
});
`;

const GATEWAY_TEXT = '400 litellm.BadRequestError: LLM Provider NOT provided. You passed model=claude-opus-5-5. Error doing the fallback: Provider anthropic not found';
const stopFailure = (text = GATEWAY_TEXT) => JSON.stringify({
  hook_event_name: 'StopFailure', error: 'invalid_request', error_details: text, last_assistant_message: 'API Error: ' + text
});

const containsRule = { id: 'gw', match: 'Provider anthropic not found', matchMode: 'contains', message: 'continue', delaySeconds: 5, enabled: true };
const regexRule = { id: 'rx', match: 'LLM Provider NOT provided.*model=claude-', matchMode: 'regex', message: 'continue', delaySeconds: 5, enabled: true };
const resumeConfig = (rules: object[]) => ({ apiErrorResume: { enabled: true, rules, maxPerWindow: 3, windowMinutes: 15 } });

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function launchStub(home: string) {
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-api-error-resume-'));
  writeFileSync(join(stubDir, 'claude-stub.cjs'), `#!${process.execPath}\n${CLAUDE_STUB}`, { mode: 0o700 });
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()) },
    initialConfig: { sponsorPromptDismissed: true, claudeBinary: join(stubDir, 'claude-stub.cjs') }
  });
  const typed = () => {
    const file = join(stubDir, 'typed.log');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  };
  const cleanup = async () => { await closeApp(app.electron); rmSync(stubDir, { recursive: true, force: true }); };
  return { app, win: app.window, stubDir, typed, cleanup };
}
type Stub = Awaited<ReturnType<typeof launchStub>>;

async function openAgent(stub: Stub, home: string) {
  const projectDir = join(home, 'api-error-project');
  mkdirSync(projectDir, { recursive: true });
  const projectId = await stub.win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id as string;
  }, projectDir);
  const sessionId = await stub.win.evaluate(async (projectId) => {
    const result = await window.cc.terminals.create({ projectId, profile: 'claude', cols: 100, rows: 32, title: 'API error probe' });
    const session = result && 'ok' in result ? result.value : result;
    if (!session?.id) throw new Error(JSON.stringify(result));
    return session.id as string;
  }, projectId);
  const state = () => stub.win.evaluate(async (id) => {
    const pairs = (await window.cc.terminals.agentStatusSnapshot()) as Array<[string, string]>;
    return pairs.find(([sid]) => sid === id)?.[1];
  }, sessionId);
  const probe = (line: string) =>
    stub.win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `probe ${line}\r` });
  const fail = async (label: string, body: string) => {
    writeFileSync(join(stub.stubDir, `${label}.json.tmp`), body);
    renameSync(join(stub.stubDir, `${label}.json.tmp`), join(stub.stubDir, `${label}.json`));
    await probe('prompt');
    await expect.poll(state, { timeout: 15_000 }).toBe('working');
    await probe(`stopfailure-${label}`);
  };
  return { sessionId, state, fail };
}

const setConfig = (win: Page, patch: object) => win.evaluate((p) => window.cc.config.set(p as never), patch);

test('a StopFailure that matches a contains rule ends the turn and types the message once', async ({ home }, testInfo) => {
  test.setTimeout(120_000);
  const stub = await launchStub(home);
  try {
    await setConfig(stub.win, resumeConfig([containsRule]));
    const agent = await openAgent(stub, home);
    await agent.fail('gw', stopFailure());
    const t0 = Date.now();
    await expect.poll(agent.state, { timeout: 15_000, message: 'StopFailure did not end the turn' }).toBe('idle');
    await sleep(Math.max(0, 3000 - (Date.now() - t0)));
    expect(stub.typed(), 'typed before the 5 s delay').toEqual([]);
    await expect.poll(stub.typed, { timeout: 15_000, message: 'no resume message arrived' }).toEqual(['continue']);
    await sleep(2000);
    expect(stub.typed()).toEqual(['continue']);
    await captureElectronScreenshot(stub.app.electron, stub.win, testInfo.outputPath('resumed.png'));
    await testInfo.attach('resumed', { path: testInfo.outputPath('resumed.png'), contentType: 'image/png' });
  } finally {
    await stub.cleanup();
  }
});

test('a StopFailure that matches a regex rule types the message once', async ({ home }) => {
  test.setTimeout(120_000);
  const stub = await launchStub(home);
  try {
    await setConfig(stub.win, resumeConfig([regexRule]));
    const agent = await openAgent(stub, home);
    await agent.fail('rx', stopFailure('LLM Provider NOT provided. You passed model=claude-opus-5-5'));
    await expect.poll(agent.state, { timeout: 15_000 }).toBe('idle');
    await expect.poll(stub.typed, { timeout: 15_000 }).toEqual(['continue']);
    await sleep(2000);
    expect(stub.typed()).toEqual(['continue']);
  } finally {
    await stub.cleanup();
  }
});

test('with the feature off a StopFailure only ends the turn', async ({ home }) => {
  test.setTimeout(120_000);
  const stub = await launchStub(home);
  try {
    const agent = await openAgent(stub, home);
    await agent.fail('gw', stopFailure());
    await expect.poll(agent.state, { timeout: 15_000 }).toBe('idle');
    await sleep(8000);
    expect(stub.typed()).toEqual([]);
  } finally {
    await stub.cleanup();
  }
});

test('Settings → Agents adds a suggested rule and checks an error against it', async ({ home }, testInfo) => {
  test.setTimeout(120_000);
  const stub = await launchStub(home);
  const { win } = stub;
  try {
    await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-agents').click();
    await win.getByRole('switch', { name: 'Resume after matching API errors' }).click();
    await win.getByRole('button', { name: '+ Connection lost mid-response' }).click();
    await expect.poll(async () => (await win.evaluate(() => window.cc.config.get())).apiErrorResume?.rules?.[0]?.match)
      .toBe('Connection lost mid-response');
    const saved = (await win.evaluate(() => window.cc.config.get())).apiErrorResume!;
    expect(saved).toMatchObject({ enabled: true, maxPerWindow: 3, windowMinutes: 15 });
    await win.getByLabel('Error text to check').fill('API Error: Connection lost mid-response. The response above may be incomplete.');
    await win.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(win.getByText(/Matches rule 1: Zana would send “continue” after 30 s\./)).toBeVisible({ timeout: 15_000 });
    await captureElectronScreenshot(stub.app.electron, win, testInfo.outputPath('settings.png'));
    await testInfo.attach('settings', { path: testInfo.outputPath('settings.png'), contentType: 'image/png' });
  } finally {
    await stub.cleanup();
  }
});
