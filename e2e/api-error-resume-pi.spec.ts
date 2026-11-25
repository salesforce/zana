/**
 * Resume after API errors for Pi at the real Electron boundary.
 *
 * Pi has no turn-start hook and posts nothing when a turn fails. Main arms the quiet-period check from the
 * output-activity busy edge, then reads Pi's session JSONL under `$PI_CODING_AGENT_SESSION_DIR`. A stub Pi CLI
 * takes the `--session-id` main mints, writes the real row shapes (final failure = assistant `stopReason:"error"`,
 * user interrupt = `stopReason:"aborted"`, superseded retry = `context_edit` tombstone), and prints output so the
 * busy edge fires. Main must type the rule's message only for a genuine, untombstoned failure.
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

const PI_STUB = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { createInterface } = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.5.0'); process.exit(0); }
const dir = __dirname;
const idIndex = args.indexOf('--session-id');
const id = idIndex >= 0 ? args[idIndex + 1] : '00000000-0000-4000-8000-000000000000';
const cwd = fs.readFileSync(join(dir, 'cwd.txt'), 'utf8').trim();
const sessionDir = join(process.env.PI_CODING_AGENT_SESSION_DIR, '--project--');
fs.mkdirSync(sessionDir, { recursive: true });
const file = join(sessionDir, '2026-11-24T20-03-36-004Z_' + id + '.jsonl');
const row = (value) => fs.appendFileSync(file, JSON.stringify(value) + '\n');
row({ type: 'session', version: 3, id, timestamp: new Date().toISOString(), cwd });
let n = 0;
const user = () => { const uid = 'u' + (++n); row({ type: 'message', id: uid, parentId: 'h', message: { role: 'user', content: 'hi' } }); return uid; };
const assistant = (parent, message) => { const aid = 'a' + (++n); row({ type: 'message', id: aid, parentId: parent, message: { role: 'assistant', content: [], ...message } }); return aid; };
const ERROR = { stopReason: 'error', errorMessage: '503: {"message":"service unavailable","type":"server_error"}' };
console.log('Pi API error probe ready');
createInterface({ input: process.stdin }).on('line', (raw) => {
  const line = raw.replace(/\x1b\[20[01]~/g, '').trim();
  if (!line) return;
  if (line.startsWith('probe ')) {
    const kind = line.slice(6);
    console.log('working on ' + kind + ' ' + 'x'.repeat(40));
    const parent = user();
    if (kind === 'fail') assistant(parent, ERROR);
    else if (kind === 'aborted') assistant(parent, { stopReason: 'aborted', errorMessage: 'Operation aborted' });
    else if (kind === 'retried') {
      const failed = assistant(parent, ERROR);
      row({ type: 'context_edit', id: 'e' + (++n), parentId: failed, targetId: failed, replacement: null });
      assistant(parent, { content: [{ type: 'text', text: 'recovered' }], stopReason: 'stop' });
    }
    else if (kind === 'ok') assistant(parent, { content: [{ type: 'text', text: 'Selected model is at capacity' }], stopReason: 'stop' });
    console.log('PROBE_ACK:' + kind);
  } else fs.appendFileSync(join(dir, 'typed.log'), line + '\n');
});
`;

const serverRule = { id: 'srv', match: 'service unavailable', matchMode: 'contains', message: 'continue', delaySeconds: 5, enabled: true };
const resumeConfig = (rules: object[]) => ({ apiErrorResume: { enabled: true, rules, maxPerWindow: 3, windowMinutes: 15 } });

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function launchPiStub(home: string) {
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-api-error-pi-'));
  const sessionRoot = join(stubDir, 'pi-sessions');
  mkdirSync(sessionRoot, { recursive: true });
  const projectDir = join(home, 'api-error-pi-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(stubDir, 'cwd.txt'), realpathSync(projectDir));
  writeFileSync(join(stubDir, 'pi-stub.cjs'), `#!${process.execPath}\n${PI_STUB}`, { mode: 0o700 });
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()), PI_CODING_AGENT_SESSION_DIR: sessionRoot },
    initialConfig: { sponsorPromptDismissed: true, piBinary: join(stubDir, 'pi-stub.cjs') }
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
    const result = await window.cc.terminals.create({ projectId, profile: 'pi', cols: 100, rows: 32, title: 'Pi API error probe' });
    const session = result && 'ok' in result ? result.value : result;
    if (!session?.id) throw new Error(JSON.stringify(result));
    return session.id as string;
  }, projectId);
  const probe = (kind: string) =>
    win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `probe ${kind}\r` });
  const cleanup = async () => { await closeApp(app.electron); rmSync(stubDir, { recursive: true, force: true }); };
  return { win, probe, typed, cleanup };
}

test('a failed Pi turn that matches a rule is resumed from its session file', async ({ home }) => {
  test.setTimeout(150_000);
  const stub = await launchPiStub(home);
  try {
    await stub.win.evaluate((patch) => window.cc.config.set(patch as never), resumeConfig([serverRule]));
    await sleep(1500);
    await stub.probe('fail');
    // Quiet period (20 s) plus the rule delay (5 s): nothing may be typed before the session file was read.
    await sleep(8000);
    expect(stub.typed(), 'typed before the quiet period elapsed').toEqual([]);
    await expect.poll(stub.typed, { timeout: 60_000, message: 'no resume message arrived' }).toEqual(['continue']);
    await sleep(2000);
    expect(stub.typed()).toEqual(['continue']);
  } finally {
    await stub.cleanup();
  }
});

test('an interrupt, a retried-then-recovered turn and quoted error text type nothing', async ({ home }) => {
  test.setTimeout(180_000);
  const stub = await launchPiStub(home);
  try {
    await stub.win.evaluate((patch) => window.cc.config.set(patch as never), resumeConfig([serverRule, { ...serverRule, id: 'cap', match: 'at capacity' }]));
    await sleep(1500);
    for (const kind of ['aborted', 'retried', 'ok']) {
      await stub.probe(kind);
      await sleep(30_000);
      expect(stub.typed(), `${kind} must not resume`).toEqual([]);
    }
  } finally {
    await stub.cleanup();
  }
});
