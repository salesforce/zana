/**
 * PTY sessions Electron-main owns report lifecycle events to plugins, at the
 * real Electron boundary. A stub CLI stands in for Claude and Codex: it reads
 * the REAL turn-hook URLs main injected into its launch and calls them when the
 * spec writes a command line to the PTY, exactly where the hooks would fire.
 * The platform-hooks-probe fixture plugin records every `thread.*` event it
 * receives, and the spec reads them back over the plugin RPC.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';
import { cleanupTmuxEnvironment } from './fixtures/tmux-isolation.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/plugins/platform-hooks-probe', import.meta.url));
const MODEL_CLI = fileURLToPath(new URL('./fixtures/claude-model-cli.cjs', import.meta.url));
const PLUGIN_ID = 'platform-hooks-probe';

// Shared by both stubs: `turn-start` / `turn-stop` call the injected hook URLs, `exit N` ends the process.
const COMMAND_LOOP = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { createInterface } = require('node:readline');
function serve(urls) {
  const sessionId = decodeURIComponent(urls.stop.split('/').pop());
  fs.writeFileSync(join(__dirname, 'wiring-' + sessionId + '.json'), JSON.stringify(urls));
  console.log('PTY lifecycle probe ready');
  createInterface({ input: process.stdin }).on('line', async (line) => {
    const text = line.trim();
    if (text === 'turn-start') await fetch(urls.notify + '/unblocked', { method: 'POST' }).catch(() => undefined);
    else if (text === 'turn-stop') await fetch(urls.stop, { method: 'POST' }).catch(() => undefined);
    else if (text === 'forged-stop') await fetch(urls.stop.replace(/\/hook\/stop\/[^/]+\//, '/hook/stop/forged-project/'), { method: 'POST' }).catch(() => undefined);
    else if (/^exit \d+$/.test(text)) process.exit(Number(text.slice(5)));
    else return;
    console.log('ACK:' + text);
  });
}
`;

const CLAUDE_STUB = String.raw`
${COMMAND_LOOP}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.296 (Claude Code)'); process.exit(0); }
if (args.includes('--input-format')) require(${JSON.stringify(MODEL_CLI)});
else if (args.includes('--print')) { console.log('Probe'); process.exit(0); }
else if (!process.env.ZCC_HOOK_URL || !process.env.ZCC_NOTIFY_URL) process.exit(0);
else serve({ stop: process.env.ZCC_HOOK_URL, notify: process.env.ZCC_NOTIFY_URL });
`;

const CODEX_STUB = String.raw`
${COMMAND_LOOP}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.154.0'); process.exit(0); }
const stop = args.map((arg) => /^hooks\.Stop=.*"(http:\/\/127\.0\.0\.1:\d+\/hook\/stop\/[^"\\]+)/.exec(arg)).find(Boolean);
const notify = args.map((arg) => /^hooks\.UserPromptSubmit=.*"(http:\/\/127\.0\.0\.1:\d+\/hook\/notify\/[^"\\]+?)\/unblocked/.exec(arg)).find(Boolean);
if (!stop || !notify) process.exit(0);
serve({ stop: stop[1], notify: notify[1] });
`;

interface Row {
  eventId: string; threadId: string; origin: string; surface?: string; sessionId?: string; projectId?: string; providerId?: string; bootId?: string;
}

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

async function launchLifecycleProbe(home: string, profile: 'claude' | 'codex', stubSource: string) {
  const stubDir = mkdtempSync(join(tmpdir(), `zcc-pty-lifecycle-${profile}-`));
  writeFileSync(join(stubDir, `${profile}-stub.cjs`), `#!${process.execPath}\n${stubSource}`, { mode: 0o700 });
  installProbePlugin(home);
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()) },
    initialConfig: { sponsorPromptDismissed: true, tmuxScope: 'off', [profile === 'claude' ? 'claudeBinary' : 'codexBinary']: join(stubDir, `${profile}-stub.cjs`) }
  });
  const win = app.window;
  const shutdown = async () => {
    try { await closeApp(app.electron); } finally {
      await cleanupTmuxEnvironment(home);
      rmSync(stubDir, { recursive: true, force: true });
    }
  };
  try {
    await waitForProbePlugin(win);
    const projectDir = join(home, `lifecycle-${profile}-project`);
    mkdirSync(projectDir, { recursive: true });
    const projectId = await win.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id as string;
    }, projectDir);
    const rpc = <T,>(method: string, args?: unknown) =>
      win.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: PLUGIN_ID, method, args }) as Promise<T>;
    const rows = (sessionId: string) => rpc<Row[]>('lifecycleList').then((all) => all.filter((row) => row.sessionId === sessionId));
    const origins = async (sessionId: string) => (await rows(sessionId)).map((row) => row.origin);
    const open = async () => {
      const sessionId = await win.evaluate(async ({ projectId, profile }) => {
        const result = await window.cc.terminals.create({ projectId, profile, cols: 100, rows: 32, title: `Lifecycle ${profile} probe` });
        const session = result && 'ok' in result ? result.value : result;
        if (!session?.id) throw new Error(JSON.stringify(result));
        return session.id as string;
      }, { projectId, profile });
      const wiring = join(stubDir, `wiring-${sessionId}.json`);
      await expect.poll(() => existsSync(wiring), { timeout: 30_000, message: 'the PTY never started with turn hooks' }).toBe(true);
      return { sessionId, urls: JSON.parse(readFileSync(wiring, 'utf8')) as { stop: string; notify: string } };
    };
    const say = (sessionId: string, line: string) => win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `${line}\r` });
    return { win, projectId, rpc, rows, origins, open, say, shutdown };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

test.beforeAll(async () => {
  await buildPluginHost(FIXTURE_DIR, '1.0.0');
});

test('a Claude PTY reports created, active, idle, then failed and deleted on a crash', async ({ home }) => {
  test.setTimeout(180_000);
  const probe = await launchLifecycleProbe(home, 'claude', CLAUDE_STUB);
  try {
    await probe.rpc('lifecycleClear');
    const { sessionId } = await probe.open();
    await expect.poll(() => probe.origins(sessionId), { timeout: 20_000 }).toEqual(['thread.created']);
    expect(await probe.rows(sessionId)).toEqual([expect.objectContaining({
      surface: 'pty', sessionId, threadId: sessionId, projectId: probe.projectId, providerId: 'claude-code'
    })]);

    const caps = await probe.rpc<{ capabilities: Array<{ id: string; available: boolean; reason?: string }> }>('capabilitiesForThread', { threadId: sessionId });
    expect(JSON.stringify(caps)).toContain('lifecycle-delivery');
    expect(caps.capabilities.find((row) => row.id === 'lifecycle-delivery')?.available).toBe(true);

    // A repeated start while already active is one event.
    await probe.say(sessionId, 'turn-start');
    await probe.say(sessionId, 'turn-start');
    await expect.poll(() => probe.origins(sessionId), { timeout: 20_000 }).toEqual(['thread.created', 'thread.active']);
    await probe.say(sessionId, 'turn-stop');
    await expect.poll(() => probe.origins(sessionId), { timeout: 20_000 }).toEqual(['thread.created', 'thread.active', 'thread.idle']);

    // A callback naming another project is not attributed to this one.
    await probe.say(sessionId, 'turn-start');
    await expect.poll(() => probe.origins(sessionId), { timeout: 20_000 }).toHaveLength(4);
    await probe.say(sessionId, 'forged-stop');
    await expect(async () => {
      await probe.say(sessionId, 'turn-stop');
      expect(await probe.origins(sessionId)).toEqual(['thread.created', 'thread.active', 'thread.idle', 'thread.active', 'thread.idle']);
    }).toPass({ timeout: 20_000 });

    // The process dies with a code: failed, then deleted, in order.
    await probe.say(sessionId, 'exit 3');
    await expect.poll(() => probe.origins(sessionId), { timeout: 20_000 }).toEqual([
      'thread.created', 'thread.active', 'thread.idle', 'thread.active', 'thread.idle', 'thread.failed', 'thread.deleted'
    ]);
    const all = await probe.rows(sessionId);
    expect(new Set(all.map((row) => row.eventId)).size).toBe(all.length);
    for (const row of all) expect(row).toMatchObject({ surface: 'pty', sessionId, projectId: probe.projectId });
  } finally {
    await probe.shutdown();
  }
});

test('a Codex PTY reports its turns and a requested close is deleted without a failure', async ({ home }) => {
  test.setTimeout(180_000);
  const probe = await launchLifecycleProbe(home, 'codex', CODEX_STUB);
  try {
    await probe.rpc('lifecycleClear');
    const { sessionId } = await probe.open();
    await probe.say(sessionId, 'turn-start');
    await probe.say(sessionId, 'turn-stop');
    await expect.poll(() => probe.origins(sessionId), { timeout: 20_000 }).toEqual(['thread.created', 'thread.active', 'thread.idle']);
    expect(await probe.rows(sessionId)).toEqual(expect.arrayContaining([expect.objectContaining({
      surface: 'pty', sessionId, threadId: sessionId, projectId: probe.projectId, providerId: 'codex'
    })]));

    await probe.win.evaluate((id) => window.cc.terminals.close(id), sessionId);
    await expect.poll(() => probe.origins(sessionId), { timeout: 20_000 }).toEqual(['thread.created', 'thread.active', 'thread.idle', 'thread.deleted']);
  } finally {
    await probe.shutdown();
  }
});
