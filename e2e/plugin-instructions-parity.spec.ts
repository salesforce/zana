/**
 * A plugin's per-session guidance reaches PTY launches at the real Electron
 * boundary, not only Modern turns. The platform-hooks-probe fixture's
 * `configure()` returns guidance and records the context it was given; stub
 * CLIs stand in for Claude, Codex and OpenCode and dump exactly what main
 * launched them with (argv, and for OpenCode the config file plus the
 * instructions files it lists).
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
const GUIDANCE = 'Always greet the operator by first name.';
const LABELLED = `Instructions from the ZCC plugin "${PLUGIN_ID}":\n${GUIDANCE}`;

const DUMP = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
function dump() {
  const sessionId = process.env.ZCC_SESSION_ID;
  if (!sessionId) return;
  const record = { args: process.argv.slice(2) };
  const configPath = process.env.OPENCODE_CONFIG;
  if (configPath && fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    record.openCodeInstructions = (config.instructions || []).map((path) => ({
      path, text: fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null, mode: fs.existsSync(path) ? (fs.statSync(path).mode & 0o777) : null
    }));
  }
  fs.writeFileSync(join(__dirname, 'launch-' + sessionId + '.json'), JSON.stringify(record));
  console.log('instructions probe ready');
  process.stdin.resume();
}
`;

const CLAUDE_STUB = String.raw`
${DUMP}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.296 (Claude Code)'); process.exit(0); }
if (args.includes('--input-format')) require(${JSON.stringify(MODEL_CLI)});
else if (args.includes('--print')) { console.log('Probe'); process.exit(0); }
else dump();
`;
const CODEX_STUB = String.raw`
${DUMP}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.154.0'); process.exit(0); }
dump();
`;
const OPENCODE_STUB = String.raw`
${DUMP}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.0.0'); process.exit(0); }
if (args[0] === 'models' || args[0] === 'agent' || args[0] === 'debug') { console.log('[]'); process.exit(0); }
dump();
`;

type Profile = 'claude' | 'codex' | 'opencode';
const STUBS: Record<Profile, { source: string; binaryKey: string }> = {
  claude: { source: CLAUDE_STUB, binaryKey: 'claudeBinary' },
  codex: { source: CODEX_STUB, binaryKey: 'codexBinary' },
  opencode: { source: OPENCODE_STUB, binaryKey: 'opencodeBinary' }
};

interface LaunchRecord {
  args: string[];
  openCodeInstructions?: Array<{ path: string; text: string | null; mode: number | null }>;
}
interface Seen { surface: string; sessionId: string; threadId: string; projectId: string; providerId: string }

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

async function launchProbe(home: string, profile: Profile) {
  const stubDir = mkdtempSync(join(tmpdir(), `zcc-plugin-instructions-${profile}-`));
  const stubPath = join(stubDir, `${profile}-stub.cjs`);
  writeFileSync(stubPath, `#!${process.execPath}\n${STUBS[profile].source}`, { mode: 0o700 });
  installProbePlugin(home);
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()) },
    initialConfig: {
      sponsorPromptDismissed: true, tmuxScope: 'off', [STUBS[profile].binaryKey]: stubPath,
      ...(profile === 'opencode' ? { harnessOpenCodeEnabled: true } : {})
    }
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
    const projectDir = join(home, `instructions-${profile}-project`);
    mkdirSync(projectDir, { recursive: true });
    const projectId = await win.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id as string;
    }, projectDir);
    const rpc = <T,>(method: string, args?: unknown) =>
      win.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: PLUGIN_ID, method, args }) as Promise<T>;
    const open = async (): Promise<{ sessionId: string; launch: LaunchRecord }> => {
      const sessionId = await win.evaluate(async ({ projectId, profile }) => {
        const result = await window.cc.terminals.create({ projectId, profile, cols: 100, rows: 32, title: `Instructions ${profile} probe` });
        const session = result && 'ok' in result ? result.value : result;
        if (!session?.id) throw new Error(JSON.stringify(result));
        return session.id as string;
      }, { projectId, profile });
      const dumped = join(stubDir, `launch-${sessionId}.json`);
      await expect.poll(() => existsSync(dumped), { timeout: 30_000, message: 'the PTY never started' }).toBe(true);
      return { sessionId, launch: JSON.parse(readFileSync(dumped, 'utf8')) as LaunchRecord };
    };
    return { win, projectId, rpc, open, shutdown };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

test.beforeAll(async () => {
  await buildPluginHost(FIXTURE_DIR, '1.0.0');
});

test('a Claude PTY launches with the plugin guidance and configure() sees the real session', async ({ home }) => {
  test.setTimeout(180_000);
  const probe = await launchProbe(home, 'claude');
  try {
    // No guidance contributed: the launch carries none of it.
    await probe.rpc('sessionInstructionsSet', { text: '' });
    const quiet = await probe.open();
    expect(quiet.launch.args.join('\n')).not.toContain(GUIDANCE);

    await probe.rpc('sessionInstructionsSet', { text: GUIDANCE });
    const { sessionId, launch } = await probe.open();
    const at = launch.args.findIndex((arg, index) => arg === '--append-system-prompt' && (launch.args[index + 1] ?? '').includes(LABELLED));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(await probe.rpc<Seen[]>('sessionInstructionsSeen')).toEqual(expect.arrayContaining([expect.objectContaining({
      surface: 'pty', sessionId, threadId: sessionId, projectId: probe.projectId, providerId: 'claude-code'
    })]));
  } finally {
    await probe.shutdown();
  }
});

test('a Codex PTY folds the plugin guidance into developer_instructions', async ({ home }) => {
  test.setTimeout(180_000);
  const probe = await launchProbe(home, 'codex');
  try {
    await probe.rpc('sessionInstructionsSet', { text: GUIDANCE });
    const { sessionId, launch } = await probe.open();
    const developer = launch.args.find((arg) => arg.startsWith('developer_instructions='));
    expect(developer).toContain(GUIDANCE);
    expect(launch.args).not.toContain('--append-system-prompt');
    expect(await probe.rpc<Seen[]>('sessionInstructionsSeen')).toEqual(expect.arrayContaining([expect.objectContaining({
      surface: 'pty', sessionId, projectId: probe.projectId, providerId: 'codex'
    })]));
  } finally {
    await probe.shutdown();
  }
});

test('an OpenCode PTY lists a private per-session instructions file', async ({ home }) => {
  test.setTimeout(180_000);
  const probe = await launchProbe(home, 'opencode');
  try {
    await probe.rpc('sessionInstructionsSet', { text: GUIDANCE });
    const { sessionId, launch } = await probe.open();
    const file = launch.openCodeInstructions?.find((entry) => entry.text?.includes(LABELLED));
    expect(file).toMatchObject({ mode: 0o600 });
    expect(file!.path).toContain(sessionId);
    expect(await probe.rpc<Seen[]>('sessionInstructionsSeen')).toEqual(expect.arrayContaining([expect.objectContaining({ surface: 'pty', sessionId })]));
  } finally {
    await probe.shutdown();
  }
});
