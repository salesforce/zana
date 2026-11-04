/**
 * The OpenCode native tool veto at the real Electron boundary. A stub OpenCode
 * does what the real one does with its per-session config: it loads every
 * `plugin` module the config names and runs the `tool.execute.before` hook
 * before a tool body. The module is the REAL gate main wrote for this PTY; it
 * asks main's loopback native-tool route, which asks the platform-hooks-probe
 * plugin over the supervised server runtime channel. A throw from the hook
 * blocks the call, exactly as OpenCode treats it.
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

const OPENCODE_STUB = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { createInterface } = require('node:readline');
const { fileURLToPath } = require('node:url');
const write = (file, text) => { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.0.0'); process.exit(0); }
if (args[0] === 'models' || args[0] === 'agent' || args[0] === 'debug') { console.log('[]'); process.exit(0); }
const sessionId = process.env.ZCC_SESSION_ID;
if (!sessionId || !process.env.OPENCODE_CONFIG) process.exit(0);
(async () => {
  const config = JSON.parse(fs.readFileSync(process.env.OPENCODE_CONFIG, 'utf8'));
  const gates = (config.plugin || []).filter((entry) => /native-tool-gate/.test(entry));
  const hooks = [];
  for (const entry of config.plugin || []) {
    const mod = await import(entry);
    hooks.push(await mod.default({}));
  }
  const gatePath = gates.length ? fileURLToPath(gates[0]) : null;
  write(join(__dirname, 'wiring-' + sessionId + '.json'), JSON.stringify({
    plugins: config.plugin || [], gateCount: gates.length,
    gateMode: gatePath && fs.existsSync(gatePath) ? (fs.statSync(gatePath).mode & 0o777) : null
  }));
  console.log('opencode native tool gate ready');
  createInterface({ input: process.stdin }).on('line', async (line) => {
    const match = /^probe ([\w-]+)$/.exec(line.trim());
    if (!match) return;
    const label = match[1];
    const call = JSON.parse(fs.readFileSync(join(__dirname, label + '.json'), 'utf8'));
    let blocked = null;
    try {
      for (const hook of hooks) {
        if (hook['tool.execute.before']) await hook['tool.execute.before']({ tool: call.tool, sessionID: 'oc', callID: call.callID }, { args: call.args });
      }
    } catch (error) { blocked = String(error && error.message || error); }
    write(join(__dirname, label + '.out.json'), JSON.stringify({ blocked }));
    console.log('PROBE_ACK:' + label);
  });
})().catch((error) => { console.error(error); process.exit(1); });
`;

interface PolicyRow { threadId: string; sessionId?: string; surface?: string; projectId: string; providerId: string; toolName: string; state: string }
interface Wiring { plugins: string[]; gateCount: number; gateMode: number | null }

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

test('an OpenCode PTY tool call is vetoed by the plugin policy through main', async ({ home }) => {
  test.setTimeout(180_000);
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-native-tool-opencode-'));
  const stubPath = join(stubDir, 'opencode-stub.cjs');
  writeFileSync(stubPath, `#!${process.execPath}\n${OPENCODE_STUB}`, { mode: 0o700 });
  installProbePlugin(home);
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()) },
    initialConfig: { sponsorPromptDismissed: true, tmuxScope: 'off', opencodeBinary: stubPath, harnessOpenCodeEnabled: true }
  });
  const win = app.window;
  let stderr = '';
  app.electron.process().stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-16_000); });
  try {
    await waitForProbePlugin(win);
    const projectDir = join(home, 'native-tool-opencode-project');
    mkdirSync(projectDir, { recursive: true });
    const projectId = await win.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id as string;
    }, projectDir);
    const sessionId = await win.evaluate(async (projectId) => {
      const result = await window.cc.terminals.create({ projectId, profile: 'opencode', cols: 100, rows: 32, title: 'Native tool policy opencode probe' });
      const session = result && 'ok' in result ? result.value : result;
      if (!session?.id) throw new Error(JSON.stringify(result));
      return session.id as string;
    }, projectId);
    const wiringFile = join(stubDir, `wiring-${sessionId}.json`);
    await expect.poll(() => existsSync(wiringFile), { timeout: 30_000, message: `the OpenCode PTY never loaded its gate\n${stderr}` }).toBe(true);
    const wiring = JSON.parse(readFileSync(wiringFile, 'utf8')) as Wiring;
    expect(wiring.gateCount).toBe(1);
    expect(wiring.gateMode).toBe(0o600);

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

    const allowed = await probe('allow', 'bash', { command: 'pwd' });
    expect(allowed, stderr).toEqual({ blocked: null });
    const afterAllow = await rpc<PolicyRow[]>('toolPolicyEventsList');
    expect(afterAllow).toHaveLength(1);
    expect(afterAllow[0]).toMatchObject({ toolName: 'bash', threadId: sessionId, sessionId, surface: 'pty', projectId, state: 'allowed' });

    await expect(rpc('setToolPolicySelection', { selection: 'deny' })).resolves.toEqual({ ok: true });
    const denied = await probe('deny', 'bash', { command: 'rm -rf /tmp/scratch' });
    expect(denied.blocked).toBe(`Blocked by tool policy: ${FIXTURE_REASON}`);
    const afterDeny = await rpc<PolicyRow[]>('toolPolicyEventsList');
    expect(afterDeny.at(-1)).toMatchObject({ toolName: 'bash', state: 'denied', threadId: sessionId, surface: 'pty' });

    // Non-shell tools go through the same gate.
    const deniedWrite = await probe('deny-write', 'write', { filePath: join(projectDir, 'x.txt'), content: 'x' });
    expect(deniedWrite.blocked).toBe(`Blocked by tool policy: ${FIXTURE_REASON}`);

    // Once the PTY is gone, main denies without asking plugins and the gate file is removed.
    await win.evaluate((id) => window.cc.terminals.close(id), sessionId);
    await expect.poll(async () => (await win.evaluate((id) => window.cc.terminals.list(id), projectId)).map((session) => session.id))
      .not.toContain(sessionId);
    const gateUrl = new URL(wiring.plugins.find((entry) => entry.includes('native-tool-gate'))!);
    await expect.poll(() => existsSync(gateUrl), { timeout: 10_000, message: 'gate file survived the session' }).toBe(false);
  } finally {
    try { await closeApp(app.electron); } finally {
      await cleanupTmuxEnvironment(home);
      rmSync(stubDir, { recursive: true, force: true });
    }
  }
});
