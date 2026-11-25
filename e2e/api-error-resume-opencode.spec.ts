/**
 * Resume after API errors for OpenCode at the real Electron boundary.
 *
 * OpenCode has no turn-start hook. Main arms the quiet-period check from the output-activity busy edge, then reads
 * OpenCode's SQLite database (`$XDG_DATA_HOME/opencode/opencode.db`) read-only. A stub OpenCode CLI writes the real
 * row shapes: a persisted non-retryable failure (completed assistant row with `error`), a user interrupt
 * (`MessageAbortedError`) and a row still being retried (no `completed`). OpenCode persists nothing for retryable
 * 429/503/529 failures, so only the first shape may resume.
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

const OPENCODE_STUB = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { createInterface } = require('node:readline');
const { DatabaseSync } = require('node:sqlite');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('opencode 1.18.10'); process.exit(0); }
// Discovery probes (agent list, models, debug, acp, ...) never create a session in real OpenCode; only the TUI does.
if (args[0] && !args[0].startsWith('-')) process.exit(0);
const dir = __dirname;
const cwd = fs.readFileSync(join(dir, 'cwd.txt'), 'utf8').trim();
const dataDir = join(process.env.XDG_DATA_HOME, 'opencode');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'opencode.db'));
const run = (sql, ...params) => db.prepare(sql).run(...params);
run('PRAGMA journal_mode = WAL');
run('CREATE TABLE IF NOT EXISTS session (id text PRIMARY KEY, directory text NOT NULL, parent_id text, time_created integer NOT NULL, time_updated integer NOT NULL)');
run('CREATE TABLE IF NOT EXISTS message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)');
const sid = 'ses_' + String(process.pid).padStart(12, '0');
const stamp = Date.now();
run('INSERT INTO session (id, directory, parent_id, time_created, time_updated) VALUES (?, ?, NULL, ?, ?)', sid, cwd, stamp, stamp);
let n = 0;
const insert = (data) => { const t = Date.now() + (++n); run('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)', 'msg_' + n, sid, t, t, JSON.stringify(data)); };
const error = (name, data) => ({ role: 'assistant', time: { created: 1, completed: 2 }, error: { name, data } });
console.log('OpenCode API error probe ready');
createInterface({ input: process.stdin }).on('line', (raw) => {
  const line = raw.replace(/\x1b\[20[01]~/g, '').trim();
  if (!line) return;
  if (!line.startsWith('probe ')) { fs.appendFileSync(join(dir, 'typed.log'), line + '\n'); return; }
  const kind = line.slice(6);
  console.log('working on ' + kind + ' ' + 'x'.repeat(40));
  insert({ role: 'user', time: { created: 1 } });
  if (kind === 'fail') insert(error('UnknownError', { message: 'litellm.ServiceUnavailableError: BedrockException' }));
  else if (kind === 'auth') insert(error('APIError', { message: 'invalid x-api-key', statusCode: 401, isRetryable: false }));
  else if (kind === 'aborted') insert(error('MessageAbortedError', { message: 'The operation was aborted.' }));
  else if (kind === 'retrying') insert({ role: 'assistant', time: { created: 1 } });
  else if (kind === 'ok') insert({ role: 'assistant', finish: 'stop', time: { created: 1, completed: 2 } });
  console.log('PROBE_ACK:' + kind);
});
`;

const serverRule = { id: 'srv', match: 'ServiceUnavailable', matchMode: 'contains', message: 'continue', delaySeconds: 5, enabled: true };
const resumeConfig = (rules: object[]) => ({ apiErrorResume: { enabled: true, rules, maxPerWindow: 3, windowMinutes: 15 } });

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function launchOpenCodeStub(home: string) {
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-api-error-opencode-'));
  const dataHome = join(stubDir, 'xdg-data');
  mkdirSync(dataHome, { recursive: true });
  const projectDir = join(home, 'api-error-opencode-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(stubDir, 'cwd.txt'), realpathSync(projectDir));
  writeFileSync(join(stubDir, 'opencode-stub.cjs'), `#!${process.execPath}\n${OPENCODE_STUB}`, { mode: 0o700 });
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()), XDG_DATA_HOME: dataHome },
    initialConfig: { sponsorPromptDismissed: true, harnessOpenCodeEnabled: true, opencodeBinary: join(stubDir, 'opencode-stub.cjs') }
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
    const result = await window.cc.terminals.create({ projectId, profile: 'opencode', cols: 100, rows: 32, title: 'OpenCode API error probe' });
    const session = result && 'ok' in result ? result.value : result;
    if (!session?.id) throw new Error(JSON.stringify(result));
    return session.id as string;
  }, projectId);
  const probe = (kind: string) =>
    win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `probe ${kind}\r` });
  const cleanup = async () => { await closeApp(app.electron); rmSync(stubDir, { recursive: true, force: true }); };
  return { win, probe, typed, cleanup };
}

test('a persisted OpenCode failure that matches a rule is resumed from its database', async ({ home }) => {
  test.setTimeout(150_000);
  const stub = await launchOpenCodeStub(home);
  try {
    await stub.win.evaluate((patch) => window.cc.config.set(patch as never), resumeConfig([serverRule]));
    await sleep(1500);
    await stub.probe('fail');
    // Quiet period (10 s) plus the rule delay (5 s): nothing may be typed before the database was read.
    await sleep(6000);
    expect(stub.typed(), 'typed before the quiet period elapsed').toEqual([]);
    await expect.poll(stub.typed, { timeout: 60_000, message: 'no resume message arrived' }).toEqual(['continue']);
    await sleep(2000);
    expect(stub.typed()).toEqual(['continue']);
  } finally {
    await stub.cleanup();
  }
});

test('an interrupt, a still-retrying row, a good turn and a non-matching failure type nothing', async ({ home }) => {
  test.setTimeout(240_000);
  const stub = await launchOpenCodeStub(home);
  try {
    await stub.win.evaluate((patch) => window.cc.config.set(patch as never), resumeConfig([serverRule]));
    await sleep(1500);
    for (const kind of ['aborted', 'retrying', 'ok', 'auth']) {
      await stub.probe(kind);
      await sleep(22_000);
      expect(stub.typed(), `${kind} must not resume`).toEqual([]);
    }
  } finally {
    await stub.cleanup();
  }
});
