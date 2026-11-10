/**
 * The Cursor native tool veto at the real Electron boundary. A stub Cursor
 * does what cursor-agent does with `--plugin-dir`: it reads the plugin's
 * `hooks/hooks.json` and runs each `preToolUse` command with the event JSON on
 * stdin before a tool body, reading `permission: "deny"` (or exit code 2, or a
 * failure of a `failClosed` hook) as a rejection. The hook is the REAL gate
 * main wrote for this PTY; it asks main's loopback native-tool route, which asks
 * the platform-hooks-probe plugin over the supervised server runtime channel.
 */
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';
import { cleanupTmuxEnvironment } from './fixtures/tmux-isolation.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/plugins/platform-hooks-probe', import.meta.url));
const PLUGIN_ID = 'platform-hooks-probe';
const FIXTURE_REASON = 'denied by fixture tool policy';

const writeAtomic = (file: string, text: string) => {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
};

const CURSOR_STUB = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const write = (file, text) => { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2026.08.11-stub'); process.exit(0); }
const sessionId = process.env.ZCC_SESSION_ID;
const dirs = args.flatMap((arg, i) => (arg === '--plugin-dir' ? [args[i + 1]] : []));
if (!sessionId) process.exit(0);
const hooks = [];
for (const dir of dirs) {
  const file = join(dir, 'hooks', 'hooks.json');
  if (fs.existsSync(file)) hooks.push(...(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.preToolUse || []));
}
const dir = dirs[0];
write(join(__dirname, 'wiring-' + sessionId + '.json'), JSON.stringify({
  dirs, hookCount: hooks.length, failClosed: hooks.every((h) => h.failClosed === true),
  dirMode: dir ? (fs.statSync(dir).mode & 0o777) : null,
  hooksMode: dir ? (fs.statSync(join(dir, 'hooks', 'hooks.json')).mode & 0o777) : null,
  manifest: dir ? fs.existsSync(join(dir, '.cursor-plugin', 'plugin.json')) : false
}));
// Run one hook the way cursor-agent does; true means the call is rejected.
const runHook = (hook, event) => new Promise((resolve) => {
  const child = spawn('/bin/sh', ['-c', hook.command], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  const timer = setTimeout(() => { child.kill(); resolve(hook.failClosed ? 'timeout' : null); }, (hook.timeout || 30) * 1000);
  child.stdout.on('data', (c) => { out += c; });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 2) return resolve('exit 2');
    if (code !== 0) return resolve(hook.failClosed ? 'exit ' + code : null);
    let parsed;
    try { parsed = out.trim() ? JSON.parse(out) : {}; } catch { return resolve('invalid json'); }
    resolve(parsed.permission === 'deny' ? (parsed.user_message || 'denied') : null);
  });
  child.stdin.end(JSON.stringify(event));
});
console.log('cursor native tool gate ready');
createInterface({ input: process.stdin }).on('line', async (line) => {
  const match = /^probe ([\w-]+)$/.exec(line.trim());
  if (!match) return;
  const label = match[1];
  const call = JSON.parse(fs.readFileSync(join(__dirname, label + '.json'), 'utf8'));
  let blocked = null;
  for (const hook of hooks) {
    const verdict = await runHook(hook, { hook_event_name: 'preToolUse', tool_name: call.tool, tool_use_id: call.callID, tool_input: call.args, cwd: process.cwd() });
    if (verdict) blocked = verdict;
  }
  write(join(__dirname, label + '.out.json'), JSON.stringify({ blocked }));
  console.log('PROBE_ACK:' + label);
});
`;

interface PolicyRow { threadId: string; sessionId?: string; surface?: string; projectId: string; providerId: string; toolName: string; state: string }
interface Wiring { dirs: string[]; hookCount: number; failClosed: boolean; dirMode: number | null; hooksMode: number | null; manifest: boolean }

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function installProbePlugin(home: string): void {
  const pluginStore = join(home, '.zcc/plugins');
  mkdirSync(pluginStore, { recursive: true });
  writeFileSync(join(pluginStore, 'installed.json'), JSON.stringify({
    version: 1,
    plugins: [{
      id: PLUGIN_ID, version: '0.1.0', name: 'Platform Hooks Probe', enabled: true, status: 'running',
      provenance: 'direct', sourceKind: 'path', source: `path:${FIXTURE_DIR}`, rootDir: FIXTURE_DIR,
      serverEntry: './server.ts', appEntry: null, installedAt: Date.now(), updatedAt: Date.now()
    }]
  }));
}

async function waitForProbePlugin(win: Page): Promise<void> {
  await expect.poll(async () => {
    const rows = await win.evaluate(async () => (await window.cc.pluginApps.list()).map((row) => ({ id: row.id, status: row.status })));
    return JSON.stringify(rows);
  }, { timeout: 45_000, message: 'plugin startup did not settle' }).toContain(`"id":"${PLUGIN_ID}","status":"running"`);
}

test.beforeAll(async () => {
  await buildPluginHost(FIXTURE_DIR, '1.0.0');
});

test('a Cursor PTY tool call is vetoed by the plugin policy through main', async ({ home }) => {
  test.setTimeout(180_000);
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-native-tool-cursor-'));
  const stubPath = join(stubDir, 'cursor-stub.cjs');
  writeFileSync(stubPath, `#!${process.execPath}\n${CURSOR_STUB}`, { mode: 0o700 });
  installProbePlugin(home);
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()) },
    initialConfig: { sponsorPromptDismissed: true, tmuxScope: 'off', cursorBinary: stubPath, harnessCursorEnabled: true }
  });
  const win = app.window;
  let stderr = '';
  app.electron.process().stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-16_000); });
  try {
    await waitForProbePlugin(win);
    const projectDir = join(home, 'native-tool-cursor-project');
    mkdirSync(projectDir, { recursive: true });
    const projectId = await win.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id as string;
    }, projectDir);
    const sessionId = await win.evaluate(async (projectId) => {
      const result = await window.cc.terminals.create({ projectId, profile: 'cursor', cols: 100, rows: 32, title: 'Native tool policy cursor probe' });
      const session = result && 'ok' in result ? result.value : result;
      if (!session?.id) throw new Error(JSON.stringify(result));
      return session.id as string;
    }, projectId);
    const wiringFile = join(stubDir, `wiring-${sessionId}.json`);
    await expect.poll(() => existsSync(wiringFile), { timeout: 30_000, message: `the Cursor PTY never loaded its gate\n${stderr}` }).toBe(true);
    const wiring = JSON.parse(readFileSync(wiringFile, 'utf8')) as Wiring;
    expect(wiring.dirs).toHaveLength(1);
    expect(wiring.hookCount).toBe(1);
    expect(wiring.failClosed).toBe(true);
    expect(wiring.manifest).toBe(true);
    expect(wiring.dirMode).toBe(0o700);
    expect(wiring.hooksMode).toBe(0o600);

    const rpc = <T,>(method: string, args?: unknown) =>
      win.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: PLUGIN_ID, method, args }) as Promise<T>;
    const probe = async (label: string, tool: string, args: Record<string, unknown>) => {
      writeAtomic(join(stubDir, `${label}.json`), JSON.stringify({ tool, callID: `call_${label}`, args }));
      await win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `probe ${label}\r` });
      const out = join(stubDir, `${label}.out.json`);
      await expect.poll(() => existsSync(out), { timeout: 20_000, message: `probe ${label} never answered` }).toBe(true);
      return JSON.parse(readFileSync(out, 'utf8')) as { blocked: string | null };
    };

    await expect(rpc('toolPolicyEventsClear')).resolves.toEqual({ ok: true });

    const allowed = await probe('allow', 'Shell', { command: 'pwd' });
    expect(allowed, stderr).toEqual({ blocked: null });
    const afterAllow = await rpc<PolicyRow[]>('toolPolicyEventsList');
    expect(afterAllow).toHaveLength(1);
    expect(afterAllow[0]).toMatchObject({ toolName: 'Shell', threadId: sessionId, sessionId, surface: 'pty', projectId, state: 'allowed' });

    await expect(rpc('setToolPolicySelection', { selection: 'deny' })).resolves.toEqual({ ok: true });
    const denied = await probe('deny', 'Shell', { command: 'rm -rf /tmp/scratch' });
    expect(denied.blocked).toBe(FIXTURE_REASON);
    const afterDeny = await rpc<PolicyRow[]>('toolPolicyEventsList');
    expect(afterDeny.at(-1)).toMatchObject({ toolName: 'Shell', state: 'denied', threadId: sessionId, surface: 'pty' });

    // Non-shell tools go through the same gate.
    const deniedWrite = await probe('deny-write', 'Write', { path: join(projectDir, 'x.txt'), content: 'x' });
    expect(deniedWrite.blocked).toBe(FIXTURE_REASON);

    // Once the PTY is gone, main denies without asking plugins and the gate directory is removed.
    await win.evaluate((id) => window.cc.terminals.close(id), sessionId);
    await expect.poll(async () => (await win.evaluate((id) => window.cc.terminals.list(id), projectId)).map((session) => session.id))
      .not.toContain(sessionId);
    await expect.poll(() => existsSync(wiring.dirs[0]!), { timeout: 10_000, message: 'gate directory survived the session' }).toBe(false);
  } finally {
    try { await closeApp(app.electron); } finally {
      await cleanupTmuxEnvironment(home);
      rmSync(stubDir, { recursive: true, force: true });
    }
  }
});
