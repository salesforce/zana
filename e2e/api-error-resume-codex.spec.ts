/**
 * Resume after API errors for Codex (#649) at the real Electron boundary.
 *
 * Codex posts NO hook when a turn fails: its `Stop` hook never fires. A stub Codex CLI therefore runs the REAL
 * injected `UserPromptSubmit` hook (which arms the quiet-period check in main), writes a rollout under an isolated
 * `$CODEX_HOME/sessions`, and never sends `Stop`. Main must read the rollout once the turn goes quiet and, when a
 * configured rule matches the failed turn, type the rule's message into the PTY.
 *
 * The stub runs the injected hook command strings through /bin/sh, exactly as the Claude and Codex specs do.
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

// Behaves like Codex for the parts main observes: injected hook commands, a rollout file, typed input.
const CODEX_STUB = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.171.0'); process.exit(0); }
const dir = __dirname;
const hooks = new Map();
for (const arg of args) {
  const event = /^hooks\.([^=]+)=/.exec(arg)?.[1];
  if (event) hooks.set(event, [...arg.matchAll(/command=("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1])));
}
const hook = (event, payload = {}) => {
  for (const command of hooks.get(event) || []) {
    spawnSync('/bin/sh', ['-c', command], {
      input: JSON.stringify({ hook_event_name: event, turn_id: 'turn-probe', ...payload }), timeout: 6000, stdio: ['pipe', 'pipe', 'pipe']
    });
  }
};
const cwd = fs.readFileSync(join(dir, 'cwd.txt'), 'utf8').trim();
const id = '01a208f2-0000-7000-8000-' + String(process.pid).padStart(12, '0');
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const bucket = join(process.env.CODEX_HOME, 'sessions', String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate()));
fs.mkdirSync(bucket, { recursive: true });
const rollout = join(bucket, 'rollout-' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + 'T00-00-00-' + id + '.jsonl');
const write = (type, payload) => fs.appendFileSync(rollout, JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n');
write('session_meta', { id, cwd, timestamp: new Date().toISOString(), originator: 'codex-tui', cli_version: '0.171.0', source: 'cli' });
const started = () => write('event_msg', { type: 'task_started', turn_attribution: { turn_id: 'turn-probe', turn_trigger: 'user' } });
const complete = (error) => write('event_msg', { type: 'task_complete', turn_id: 'turn-probe', last_agent_message: error ? null : 'done', ...(error ? { error } : {}) });
const decoy = join(dir, 'decoy-rollout.jsonl');
console.log('Codex API error probe ready');
createInterface({ input: process.stdin }).on('line', (raw) => {
  const line = raw.replace(/\x1b\[20[01]~/g, '').trim();
  if (!line) return;
  if (line === 'probe prompt') { hook('UserPromptSubmit', { transcript_path: decoy, rollout_path: decoy }); started(); }
  else if (line === 'probe fail-overloaded') complete({ message: 'Selected model is at capacity. Please try a different model.', codex_error_info: 'server_overloaded' });
  else if (line === 'probe fail-midstream') {
    write('event_msg', { type: 'agent_message', message: 'Here is the first half of the answer' });
    complete({ message: 'Selected model is at capacity. Please try a different model.', codex_error_info: 'server_overloaded' });
  }
  else if (line === 'probe fail-auth') complete({ message: 'unexpected status 401 Unauthorized', codex_error_info: { http_connection_failed: { http_status_code: 401 } } });
  else if (line === 'probe lookalike') {
    write('event_msg', { type: 'agent_message', message: 'The server said: Selected model is at capacity. Please try a different model.' });
    complete(null);
  }
  else fs.appendFileSync(join(dir, 'typed.log'), line + '\n');
  if (line.startsWith('probe ')) console.log('PROBE_ACK:' + line.slice(6));
});
`;

const atCapacityRule = { id: 'cap', match: 'at capacity', matchMode: 'contains', message: 'continue', delaySeconds: 5, enabled: true };
const resumeConfig = (rules: object[]) => ({ apiErrorResume: { enabled: true, rules, maxPerWindow: 3, windowMinutes: 15 } });

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function launchCodexStub(home: string) {
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-api-error-codex-'));
  const codexHome = join(stubDir, 'codex-home');
  mkdirSync(codexHome, { recursive: true });
  const projectDir = join(home, 'api-error-codex-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(stubDir, 'cwd.txt'), realpathSync(projectDir));
  // A rollout outside the resolver root that a forged hook body points at: it holds a matching failed turn.
  writeFileSync(join(stubDir, 'decoy-rollout.jsonl'), [
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', error: { message: 'Selected model is at capacity.', codex_error_info: 'server_overloaded' } } })
  ].join('\n') + '\n');
  writeFileSync(join(stubDir, 'codex-stub.cjs'), `#!${process.execPath}\n${CODEX_STUB}`, { mode: 0o700 });
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()), CODEX_HOME: codexHome },
    initialConfig: { sponsorPromptDismissed: true, codexBinary: join(stubDir, 'codex-stub.cjs') }
  });
  const win = app.window;
  const typed = () => {
    const file = join(stubDir, 'typed.log');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  };
  const projectId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id as string;
  }, projectDir);
  const sessionId = await win.evaluate(async (projectId) => {
    const result = await window.cc.terminals.create({ projectId, profile: 'codex', cols: 100, rows: 32, title: 'Codex API error probe' });
    const session = result && 'ok' in result ? result.value : result;
    if (!session?.id) throw new Error(JSON.stringify(result));
    return session.id as string;
  }, projectId);
  const state = () => win.evaluate(async (id) => {
    const pairs = (await window.cc.terminals.agentStatusSnapshot()) as Array<[string, string]>;
    return pairs.find(([sid]) => sid === id)?.[1];
  }, sessionId);
  const probe = (line: string) =>
    win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `probe ${line}\r` });
  const cleanup = async () => { await closeApp(app.electron); rmSync(stubDir, { recursive: true, force: true }); };
  return { win, state, probe, typed, cleanup };
}

test('a failed Codex turn that matches a rule is resumed from its rollout without any Stop hook', async ({ home }) => {
  test.setTimeout(150_000);
  const stub = await launchCodexStub(home);
  try {
    await stub.win.evaluate((patch) => window.cc.config.set(patch as never), resumeConfig([atCapacityRule]));
    await stub.probe('prompt');
    await expect.poll(stub.state, { timeout: 15_000 }).toBe('working');
    await stub.probe('fail-overloaded');
    // Quiet period (20 s) plus the rule delay (5 s): nothing may be typed before the rollout was read.
    await sleep(8000);
    expect(stub.typed(), 'typed before the quiet period elapsed').toEqual([]);
    await expect.poll(stub.typed, { timeout: 60_000, message: 'no resume message arrived' }).toEqual(['continue']);
    await sleep(2000);
    expect(stub.typed()).toEqual(['continue']);
  } finally {
    await stub.cleanup();
  }
});

test('a Codex turn that breaks after the model already spoke is still resumed', async ({ home }) => {
  test.setTimeout(150_000);
  const stub = await launchCodexStub(home);
  try {
    await stub.win.evaluate((patch) => window.cc.config.set(patch as never), resumeConfig([atCapacityRule]));
    await stub.probe('prompt');
    await expect.poll(stub.state, { timeout: 15_000 }).toBe('working');
    await stub.probe('fail-midstream');
    await expect.poll(stub.typed, { timeout: 60_000, message: 'no resume message arrived' }).toEqual(['continue']);
  } finally {
    await stub.cleanup();
  }
});

test('lookalike model text, a forged rollout path and a non-matching failure type nothing', async ({ home }) => {
  test.setTimeout(150_000);
  const stub = await launchCodexStub(home);
  try {
    await stub.win.evaluate((patch) => window.cc.config.set(patch as never), resumeConfig([atCapacityRule]));
    // Good turn whose model reply quotes the error text; the hook body also points at a decoy rollout.
    await stub.probe('prompt');
    await expect.poll(stub.state, { timeout: 15_000 }).toBe('working');
    await stub.probe('lookalike');
    await sleep(30_000);
    expect(stub.typed(), 'a quoted error or forged path must not resume').toEqual([]);
    // A real failure whose text matches no rule.
    await stub.probe('prompt');
    await expect.poll(stub.state, { timeout: 15_000 }).toBe('working');
    await stub.probe('fail-auth');
    await sleep(30_000);
    expect(stub.typed(), 'a non-matching failure must not resume').toEqual([]);
  } finally {
    await stub.cleanup();
  }
});

test('descriptors report Codex as resume-capable and the unsupported harnesses as not', async ({ home }) => {
  const stub = await launchCodexStub(home);
  try {
    const descriptors = await stub.win.evaluate(() => window.cc.harness.descriptors());
    expect(descriptors.find((d) => d.id === 'codex')?.apiErrorResume, 'codex reports resume support').toBe('supported');
    for (const descriptor of descriptors.filter((d) => ['opencode', 'cursor', 'pi'].includes(d.id))) {
      expect(descriptor.apiErrorResume, `${descriptor.id} stays unsupported`).toBe('unsupported');
    }
  } finally {
    await stub.cleanup();
  }
});
