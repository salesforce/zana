/**
 * OBL-010 at the real Electron boundary: a plugin `ask` tool-policy decision
 * on a main-owned PTY. A stub CLI runs the REAL PreToolUse relay command main
 * injected (curl backstop and hook timeout included) against main's loopback
 * hook route. The ask must be answered by a human through the host-rendered
 * approval; the page, the agent and the plugin cannot approve it, and every
 * other outcome (deny, cancel, timeout) denies.
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
const MODEL_CLI = fileURLToPath(new URL('./fixtures/claude-model-cli.cjs', import.meta.url));
const PLUGIN_ID = 'platform-hooks-probe';

const writeAtomic = (file: string, text: string) => {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
};

// Shared by both stubs: on `probe <label>` run the injected relay command with
// `<label>.json`'s event on stdin, exactly as the CLI would, and record the outcome.
const PROBE_LOOP = String.raw`
const write = (file, text) => { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };
function serveProbes(command) {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const match = /^probe ([\w-]+)$/.exec(line.trim());
    if (!match) return;
    const label = match[1];
    const { input } = JSON.parse(fs.readFileSync(join(__dirname, label + '.json'), 'utf8'));
    const result = spawnSync('/bin/sh', ['-c', command], { input, env: process.env, timeout: 170000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    write(join(__dirname, label + '.out.json'), JSON.stringify({
      status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error ? String(result.error) : null
    }));
    console.log('PROBE_ACK:' + label);
  });
}
`;

const CLAUDE_STUB = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
${PROBE_LOOP}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.296 (Claude Code)'); process.exit(0); }
if (args.includes('--input-format')) require(${JSON.stringify(MODEL_CLI)});
// ClaudeCliProvider one-shots (tab namer, …) pass --print and disable hooks.
else if (args.includes('--print')) { console.log('Probe'); process.exit(0); }
else if (!process.env.ZCC_NATIVETOOL_URL) process.exit(0);
else {
  const url = process.env.ZCC_NATIVETOOL_URL;
  const at = args.indexOf('--settings');
  const settings = at >= 0 ? JSON.parse(args[at + 1]) : { hooks: {} };
  const relay = (entry) => entry.hooks.find((hook) => hook.command.includes('ZCC_NATIVETOOL_URL'));
  const entries = ((settings.hooks || {}).PreToolUse || []).filter(relay);
  const command = entries.length ? relay(entries[0]).command : '';
  // Use the independently forwarded hook identity, not the native-tool URL under test.
  const sessionId = decodeURIComponent(process.env.ZCC_HOOK_URL.split('/').pop());
  write(join(__dirname, 'wiring-' + sessionId + '.json'), JSON.stringify({
    url, matchers: entries.map((entry) => entry.matcher), count: entries.length, command,
    tmux: process.env.TMUX, tmuxPane: process.env.TMUX_PANE
  }));
  console.log('Claude native tool policy probe ready');
  serveProbes(command);
}
`;

interface ProbeResult { status: number | null; stdout: string; stderr: string; error: string | null }
interface PolicyRow { state: string; toolName: string }
interface Wiring { url: string; count: number; matchers?: string[]; command: string; tmux?: string; tmuxPane?: string }

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
    const rows = await win.evaluate(async () => (await window.cc.pluginApps.list()).map((row) => ({
      id: row.id, status: row.status, statusDetail: row.statusDetail
    })));
    return JSON.stringify(rows);
  }, { timeout: 45_000, message: 'plugin startup did not settle' }).toContain(`"id":"${PLUGIN_ID}","status":"running"`);
}

/** Add a project and open one main-owned PTY on the stub; resolve once the stub has recorded its relay wiring. */
async function startProbeSession(win: Page, home: string, profile: 'claude' | 'codex', stubDir: string) {
  const projectDir = join(home, `native-tool-${profile}-project`);
  mkdirSync(projectDir, { recursive: true });
  const projectId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id as string;
  }, projectDir);
  const sessionId = await win.evaluate(async ({ projectId, profile }) => {
    const result = await window.cc.terminals.create({ projectId, profile, cols: 100, rows: 32, title: `Native tool policy ${profile} probe` });
    const session = result && 'ok' in result ? result.value : result;
    if (!session?.id) throw new Error(JSON.stringify(result));
    return session.id as string;
  }, { projectId, profile });
  const wiringFile = join(stubDir, `wiring-${sessionId}.json`);
  await expect.poll(() => existsSync(wiringFile), {
    timeout: 30_000,
    message: 'the PTY never started with a native tool relay'
  }).toBe(true);
  const wiring = JSON.parse(readFileSync(wiringFile, 'utf8')) as Wiring;
  return { projectDir, projectId, sessionId, wiring };
}

/** The probe plugin's RPCs, plus `probe`: run the PTY's real relay command on one event, as the CLI would. */
function probeApi(win: Page, stubDir: string, sessionId: string) {
  const rpc = <T,>(method: string, args?: unknown) =>
    win.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: PLUGIN_ID, method, args }) as Promise<T>;
  const rows = () => rpc<PolicyRow[]>('toolPolicyEventsList');
  const probe = async (label: string, event: unknown): Promise<ProbeResult> => {
    writeAtomic(join(stubDir, `${label}.json`), JSON.stringify({ input: JSON.stringify(event) }));
    await win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `probe ${label}\r` });
    const out = join(stubDir, `${label}.out.json`);
    await expect.poll(() => existsSync(out), { timeout: 170_000, message: `probe ${label} never answered` }).toBe(true);
    return JSON.parse(readFileSync(out, 'utf8')) as ProbeResult;
  };
  return { rpc, rows, probe };
}

/** Boot the private app with the probe plugin running and one main-owned PTY running the stub CLI. */
async function launchProbe(home: string, profile: 'claude' | 'codex', stubSource: string, tmuxScope: 'off' | 'all' = 'off') {
  const stubDir = mkdtempSync(join(tmpdir(), `zcc-native-tool-${profile}-`));
  writeFileSync(join(stubDir, `${profile}-stub.cjs`), `#!${process.execPath}\n${stubSource}`, { mode: 0o700 });
  installProbePlugin(home);
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  const shutdown = async () => {
    try {
      if (app) await closeApp(app.electron);
    } finally {
      await cleanupTmuxEnvironment(home);
      rmSync(stubDir, { recursive: true, force: true });
    }
  };
  try {
    // An explicit free port keeps the private product server off the default one.
    app = await launchApp(home, {
      env: { ZCC_SERVER_PORT: String(await freePort()) },
      initialConfig: { sponsorPromptDismissed: true, tmuxScope, [profile === 'claude' ? 'claudeBinary' : 'codexBinary']: join(stubDir, `${profile}-stub.cjs`) }
    });
    let stderr = '';
    app.electron.process().stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-16_000); });
    const win = app.window;
    await waitForProbePlugin(win);
    const session = await startProbeSession(win, home, profile, stubDir);
    const cleanup = async () => {
      await win.evaluate(async ({ sessionId, projectId }) => {
        try { await window.cc.terminals.close(sessionId); } catch { /* already closed */ }
        try { await window.cc.projects.remove(projectId); } catch { /* best-effort */ }
      }, session).catch(() => undefined);
      await shutdown();
    };
    return { win, home, stubDir, ...session, ...probeApi(win, stubDir, session.sessionId), cleanup, stderr: () => stderr };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

type Probe = Awaited<ReturnType<typeof launchProbe>>;

interface PendingAsk { id: string; origin: { pluginId: string; rendererId: string }; payload: { title: string; data: { kind: string; toolName: string; prompt: string } } }

const pendingAsk = (probe: Probe) => probe.win.evaluate(async (sessionId) => {
  const response = await fetch(`/api/v1/pty-sessions/${sessionId}/interactions`);
  return (await response.json()) as PendingAsk[];
}, probe.sessionId);

const claudeEvent = (probe: Probe, toolUseId: string) => ({
  session_id: '5b0c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d', cwd: probe.projectDir, permission_mode: 'default',
  hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `echo ${toolUseId}` }, tool_use_id: toolUseId
});

/** Start a relay probe without waiting for it, so the spec can answer the pending ask. */
function startProbe(probe: Probe, label: string, toolUseId: string): Promise<ProbeResult> {
  return probe.probe(label, claudeEvent(probe, toolUseId));
}

async function waitForAsk(probe: Probe): Promise<PendingAsk> {
  await expect.poll(async () => (await pendingAsk(probe)).length, { timeout: 20_000, message: 'the approval never opened' }).toBe(1);
  return (await pendingAsk(probe))[0]!;
}

const reasonOf = (result: ProbeResult) => (JSON.parse(result.stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }).hookSpecificOutput;

test.beforeAll(async () => {
  await buildPluginHost(FIXTURE_DIR, '1.0.0');
});

test('a human approving a host-rendered ask after 20 s lets the PTY tool call through', async ({ home }) => {
  test.setTimeout(240_000);
  const probe = await launchProbe(home, 'claude', CLAUDE_STUB);
  try {
    await probe.rpc('toolPolicyEventsClear');
    await probe.rpc('setToolPolicySelection', { selection: 'ask' });
    const running = startProbe(probe, 'approve', 'toolu_ask_approve');
    const ask = await waitForAsk(probe);
    expect(ask.origin).toMatchObject({ pluginId: PLUGIN_ID, rendererId: 'zcc:tool-policy-ask' });
    expect(ask.payload.data).toMatchObject({ kind: 'tool-policy-ask', toolName: 'Bash' });

    // The page alone cannot approve: a bare product API answer carries no human proof.
    const bare = await probe.win.evaluate(async ({ sessionId, id }) => {
      const response = await fetch(`/api/v1/pty-sessions/${sessionId}/interactions/${id}/respond`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: { decision: 'allow' } })
      });
      return response.status;
    }, { sessionId: probe.sessionId, id: ask.id });
    expect(bare).toBeGreaterThanOrEqual(400);
    expect((await pendingAsk(probe)).map((row) => row.id)).toEqual([ask.id]);

    // The relay is still waiting well past the old 5 s budget.
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    expect(existsSync(join(probe.stubDir, 'approve.out.json'))).toBe(false);
    await probe.win.evaluate(({ sessionId, id }) => window.cc.threads.interactions.respondSession(sessionId, id, { decision: 'allow' }), { sessionId: probe.sessionId, id: ask.id });

    const result = await running;
    expect(result, `${JSON.stringify(result)}\n${probe.stderr()}`).toMatchObject({ status: 0, stdout: '' });
    expect(await probe.rows()).toEqual([expect.objectContaining({ toolName: 'Bash', state: 'asked' })]);
  } finally {
    await probe.cleanup();
  }
});

test('deny, cancel and an unanswered ask all deny the PTY tool call', async ({ home }) => {
  test.setTimeout(240_000);
  const probe = await launchProbe(home, 'claude', CLAUDE_STUB);
  try {
    await probe.rpc('setToolPolicySelection', { selection: 'ask' });

    const denied = startProbe(probe, 'deny', 'toolu_ask_deny');
    const first = await waitForAsk(probe);
    await probe.win.evaluate(({ sessionId, id }) => window.cc.threads.interactions.respondSession(sessionId, id, { decision: 'deny' }), { sessionId: probe.sessionId, id: first.id });
    expect(reasonOf(await denied)).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: 'Tool call was not approved' });

    const cancelled = startProbe(probe, 'cancel', 'toolu_ask_cancel');
    const second = await waitForAsk(probe);
    await probe.win.evaluate(async ({ sessionId, id }) => {
      await fetch(`/api/v1/pty-sessions/${sessionId}/interactions/${id}/cancel`, { method: 'POST' });
    }, { sessionId: probe.sessionId, id: second.id });
    expect(reasonOf(await cancelled)).toMatchObject({ permissionDecision: 'deny' });

    // The plugin asks for the minimum window; nobody answers.
    await probe.rpc('setToolPolicySelection', { selection: 'ask', timeoutMs: 10_000 });
    const started = Date.now();
    const timedOut = await startProbe(probe, 'timeout', 'toolu_ask_timeout');
    expect(reasonOf(timedOut)).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: 'Tool call approval timed out' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
    expect(await pendingAsk(probe)).toEqual([]);
  } finally {
    await probe.cleanup();
  }
});
