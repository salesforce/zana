/**
 * OBL-004 at the real Electron boundary, for PTYs Electron-main owns. A stub
 * CLI runs the REAL PreToolUse relay command main injected into its launch
 * (Claude `--settings`, Codex `-c hooks.PreToolUse`) against main's loopback
 * hook route, which asks the platform-hooks-probe plugin over the supervised
 * server runtime channel. In 2.3.4 every local Claude call was denied here
 * with "no native tool policy decision" (Claude sends no `turn_id`, and the
 * product route never knew main's PTYs).
 *
 * The spec only talks to the private app (renderer APIs) and main's ephemeral
 * hook port, read from the stub's per-session wiring file.
 */
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { NATIVE_TOOL_POLICY_INPUT_MAX_CHARS } from '../packages/contracts/src/runtime.js';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';
import { cleanupTmuxEnvironment, isolateTmuxEnvironment } from './fixtures/tmux-isolation.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/plugins/platform-hooks-probe', import.meta.url));
const MODEL_CLI = fileURLToPath(new URL('./fixtures/claude-model-cli.cjs', import.meta.url));
const PLUGIN_ID = 'platform-hooks-probe';
const FIXTURE_REASON = 'denied by fixture tool policy';
const NO_DECISION = 'no native tool policy decision';

const sha = (key: unknown[]) => createHash('sha256').update(JSON.stringify(key)).digest('hex');
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
    const result = spawnSync('/bin/sh', ['-c', command], { input, env: process.env, timeout: 15000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
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

const CODEX_STUB = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
${PROBE_LOOP}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.154.0'); process.exit(0); }
const override = args.find((arg) => arg.startsWith('hooks.PreToolUse='));
if (!override) process.exit(0);
const commands = [...override.matchAll(/command=("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]));
const relays = commands.filter((command) => command.includes('/hook/nativetool/'));
if (!relays.length) process.exit(0);
const url = /'(http:\/\/127\.0\.0\.1:\d+\/hook\/nativetool\/[^']+)'/.exec(relays[0])[1];
write(join(__dirname, 'wiring-' + decodeURIComponent(url.split('/').pop()) + '.json'), JSON.stringify({
  url, count: relays.length, command: relays[0]
}));
console.log('Codex native tool policy probe ready');
serveProbes(relays[0]);
`;

interface ProbeResult { status: number | null; stdout: string; stderr: string; error: string | null }
interface PolicyReply { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } }
interface PolicyRow { invocationId: string; threadId: string; projectId: string; providerId: string; toolName: string; state: string }
interface Wiring { url: string; count: number; matchers?: string[]; command: string; tmux?: string; tmuxPane?: string }

const denyReason = (stdout: string) => (JSON.parse(stdout) as PolicyReply).hookSpecificOutput;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function post(url: string, body: unknown): Promise<PolicyReply> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status).toBe(200);
  return await response.json() as PolicyReply;
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
    await expect.poll(() => existsSync(out), { timeout: 20_000, message: `probe ${label} never answered` }).toBe(true);
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
type ClaudeEvent = (toolUseId: string, toolName: string, toolInput: Record<string, unknown>, extra?: Record<string, unknown>) => Record<string, unknown>;

/** Claude Code 2.1.296's PreToolUse keys, with no turn_id. */
const claudeEvents = (probe: Probe): ClaudeEvent => (toolUseId, toolName, toolInput, extra = {}) => ({
  session_id: '5b0c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d',
  transcript_path: join(probe.home, '.claude/projects/native-tool/5b0c1d2e.jsonl'),
  cwd: probe.projectDir,
  prompt_id: '9e8d7c6b-5a49-4382-8170-6f5e4d3c2b1a',
  permission_mode: 'default',
  effort: 'medium',
  hook_event_name: 'PreToolUse',
  tool_name: toolName,
  tool_input: toolInput,
  tool_use_id: toolUseId,
  ...extra
});
const rowCount = async (probe: Probe) => (await probe.rows()).length;

/** The fixture allows by default: the relay prints nothing, so Claude's own permission flow decides. */
const allowStaysSilentAndReplays = (probe: Probe, event: ClaudeEvent) => test.step('allow is silent and an identical retry replays it', async () => {
  const allowEvent = event('toolu_e2e_allow', 'Bash', { command: 'pwd' });
  const allowed = await probe.probe('allow', allowEvent);
  expect(allowed, `${JSON.stringify(allowed)}\n${probe.stderr()}`).toMatchObject({ status: 0, stdout: '' });
  const firstRows = await probe.rows();
  expect(firstRows).toHaveLength(1);
  expect(firstRows[0]).toMatchObject({
    toolName: 'Bash', providerId: 'claude-code', threadId: probe.sessionId, projectId: probe.projectId, state: 'allowed',
    invocationId: sha([probe.sessionId, null, 'toolu_e2e_allow', 'Bash', { command: 'pwd' }])
  });
  await expect(probe.probe('allow-retry', allowEvent)).resolves.toMatchObject({ status: 0, stdout: '' });
  expect(await probe.rows()).toHaveLength(1);
});

const denyIsContentBound = (probe: Probe, event: ClaudeEvent) => test.step('a deny replays, and only for the same content', async () => {
  const before = await rowCount(probe);
  // A realistic size: ~200 KiB of tool input across parentPort.
  await expect(probe.rpc('setToolPolicySelection', { selection: 'deny' })).resolves.toEqual({ ok: true });
  const denyEvent = event('toolu_e2e_deny', 'Write', { file_path: join(probe.projectDir, 'big.txt'), content: 'x'.repeat(200 * 1024) });
  const denied = await probe.probe('deny', denyEvent);
  expect(denied.status).toBe(0);
  expect(denyReason(denied.stdout)).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: FIXTURE_REASON });
  expect((await probe.rows()).at(-1)).toMatchObject({ toolName: 'Write', state: 'denied' });
  expect(await rowCount(probe)).toBe(before + 1);

  // Reusing a real tool_use_id with other content never replays its decision.
  const poisoned = await post(probe.wiring.url, event('toolu_e2e_allow', 'Write', { file_path: '/tmp/x', content: 'poisoned' }));
  expect(poisoned.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: FIXTURE_REASON });
  expect(await rowCount(probe)).toBe(before + 2);

  // A retried deny stays denied even after the policy flips to allow.
  await probe.rpc('setToolPolicySelection', { selection: 'allow' });
  const deniedAgain = await probe.probe('deny-retry', denyEvent);
  expect(denyReason(deniedAgain.stdout).permissionDecisionReason).toBe(FIXTURE_REASON);
  expect(await rowCount(probe)).toBe(before + 2);
});

const identityComesFromMain = (probe: Probe, event: ClaudeEvent) => test.step('identity comes from main\'s live session, never the body', async () => {
  const before = await rowCount(probe);
  const spoofed = await probe.probe('spoof', event('toolu_e2e_spoof', 'Bash', { command: 'ls' }, {
    threadId: 'forged', projectId: 'forged', providerId: 'codex', session_id: 'forged', cwd: '/forged'
  }));
  expect(spoofed).toMatchObject({ status: 0, stdout: '' });
  const rows = await probe.rows();
  expect(rows).toHaveLength(before + 1);
  expect(rows.at(-1)).toMatchObject({ threadId: probe.sessionId, projectId: probe.projectId, providerId: 'claude-code', toolName: 'Bash' });
});

const denyReasonsAreNormalised = (probe: Probe, event: ClaudeEvent) => test.step('plugin reasons Codex could not use as a deny are normalised', async () => {
  const before = await rowCount(probe);
  await probe.rpc('setToolPolicySelection', { selection: 'deny', reason: '   ' });
  const blank = await probe.probe('blank', event('toolu_e2e_blank', 'Bash', { command: 'id' }));
  expect(denyReason(blank.stdout)).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: 'denied by plugin tool policy' });
  await probe.win.evaluate((id) => window.cc.pluginApps.callRpc(id, 'setToolPolicySelection', {
    selection: 'deny', reason: 'blocked ' + String.fromCharCode(0xd83d)
  }), PLUGIN_ID);
  const surrogate = await probe.probe('surrogate', event('toolu_e2e_surrogate', 'Bash', { command: 'whoami' }));
  expect(surrogate.stdout).not.toMatch(/\\ud83d/i);
  expect(denyReason(surrogate.stdout).permissionDecisionReason).toBe('blocked \ufffd');
  expect(await rowCount(probe)).toBe(before + 2);
  await probe.rpc('setToolPolicySelection', { selection: 'allow' });
});

const sizeLimitIsOnTheInput = (probe: Probe, event: ClaudeEvent) => test.step('the 256 KiB limit applies to the parsed tool input, not the request', async () => {
  const before = await rowCount(probe);
  const fill = NATIVE_TOOL_POLICY_INPUT_MAX_CHARS - JSON.stringify({ file_path: '/tmp/huge', content: '' }).length;
  // 3 UTF-8 bytes per character: ~768 KiB on the wire, yet within the limit, so plugins decide.
  const atLimit = await probe.probe('at-limit', event('toolu_e2e_at_limit', 'Write', { file_path: '/tmp/huge', content: '\u20ac'.repeat(fill) }));
  expect(atLimit, `${JSON.stringify(atLimit).slice(0, 2000)}\n${probe.stderr()}`).toMatchObject({ status: 0, stdout: '' });
  expect(await rowCount(probe)).toBe(before + 1);
  // One character more gets an explicit reason, without asking plugins.
  const huge = await probe.probe('huge', event('toolu_e2e_huge', 'Write', { file_path: '/tmp/huge', content: 'x'.repeat(fill + 1) }));
  expect(denyReason(huge.stdout).permissionDecisionReason).toBe('tool input is larger than the 256 KiB native tool policy limit');
  expect(await rowCount(probe)).toBe(before + 1);
});

const failsClosedWithoutPlugins = (probe: Probe, event: ClaudeEvent) => test.step('malformed, foreign and post-close calls fail closed without asking plugins', async () => {
  const { win, wiring, projectId, sessionId } = probe;
  const before = await rowCount(probe);
  const base = wiring.url.slice(0, wiring.url.indexOf('/hook/nativetool/'));
  const { tool_use_id: _dropped, ...withoutToolUseId } = event('toolu_e2e_missing', 'Bash', { command: 'pwd' });
  for (const [url, body] of [
    [wiring.url, withoutToolUseId],
    [wiring.url, event('toolu_e2e_bad_turn', 'Bash', { command: 'pwd' }, { turn_id: 12 })],
    [`${base}/hook/nativetool/${projectId}/${randomUUID()}`, event('toolu_e2e_unknown', 'Bash', { command: 'pwd' })],
    [`${base}/hook/nativetool/forged-project/${sessionId}`, event('toolu_e2e_forged', 'Bash', { command: 'pwd' })]
  ] as const) {
    const reply = await post(url, body);
    expect(reply.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: NO_DECISION });
  }
  expect(await rowCount(probe)).toBe(before);

  // The decision never depended on product-route registration.
  const productSessions = await win.evaluate(async () => {
    const response = await fetch('/api/v1/terminals');
    return ((await response.json()).sessions as Array<{ id: string }>).map((session) => session.id);
  });
  expect(productSessions).not.toContain(sessionId);

  // Once main's PTY is gone, the hook denies without asking plugins.
  await win.evaluate((id) => window.cc.terminals.close(id), sessionId);
  await expect.poll(async () => (await win.evaluate((id) => window.cc.terminals.list(id), projectId)).map((session) => session.id))
    .not.toContain(sessionId);
  const afterClose = await post(wiring.url, event('toolu_e2e_after_close', 'Bash', { command: 'pwd' }));
  expect(afterClose.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: NO_DECISION });
  expect(await rowCount(probe)).toBe(before);
});

test.beforeAll(async () => {
  await buildPluginHost(FIXTURE_DIR, '1.0.0');
});

test('a local Claude PTY tool call without turn_id reaches the plugin policy through main', async ({ home }) => {
  test.setTimeout(180_000);
  const probe = await launchProbe(home, 'claude', CLAUDE_STUB);
  try {
    // Main injected exactly one native-tool relay, bound to this PTY.
    expect(probe.wiring).toMatchObject({ count: 1, matchers: [''] });
    expect(probe.wiring.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/hook/nativetool/${probe.projectId}/${probe.sessionId}$`));
    const event = claudeEvents(probe);
    await expect(probe.rpc('toolPolicyEventsClear')).resolves.toEqual({ ok: true });
    await allowStaysSilentAndReplays(probe, event);
    await denyIsContentBound(probe, event);
    await identityComesFromMain(probe, event);
    await denyReasonsAreNormalised(probe, event);
    await sizeLimitIsOnTheInput(probe, event);
    await failsClosedWithoutPlugins(probe, event);
  } finally {
    await probe.cleanup();
  }
});

// Private build: pnpm test:e2e -- e2e/native-tool-policy-pty.spec.ts -g 'two concurrent local tmux'
test('two concurrent local tmux agents get their own native-tool endpoints', async ({ home }) => {
  test.setTimeout(180_000);
  test.skip(process.platform === 'win32', 'tmux is POSIX only');
  // Fail rather than silently accept the product's no-tmux plain-PTY fallback.
  execFileSync('tmux', ['-V'], { encoding: 'utf8', timeout: 3000, maxBuffer: 4096 });
  const probe = await launchProbe(home, 'claude', CLAUDE_STUB, 'all');
  let secondSessionId: string | undefined;
  try {
    // Keep A alive while B starts: the existing server retains A's global env.
    const second = await startProbeSession(probe.win, home, 'claude', probe.stubDir);
    secondSessionId = second.sessionId;
    expect(second.sessionId).not.toBe(probe.sessionId);
    const secondApi = probeApi(probe.win, probe.stubDir, second.sessionId);
    for (const session of [probe, second]) {
      expect(session.wiring).toMatchObject({ count: 1, matchers: [''] });
      expect(new URL(session.wiring.url).pathname).toBe(`/hook/nativetool/${session.projectId}/${session.sessionId}`);
    }
    expect(second.wiring.url).not.toBe(probe.wiring.url);

    // Real panes, same private socket and server PID, overlapping lifetimes.
    const tmuxRoot = isolateTmuxEnvironment(home, process.env).TMUX_TMPDIR!;
    for (const session of [probe, second]) {
      expect(session.wiring.tmux, 'agent must run inside a real tmux pane').toBeTruthy();
      expect(session.wiring.tmux!.split(',')[0]).toContain(`${tmuxRoot}/tmux-`);
      expect(session.wiring.tmuxPane).toMatch(/^%\d+$/);
    }
    expect(second.wiring.tmux!.split(',').slice(0, 2)).toEqual(probe.wiring.tmux!.split(',').slice(0, 2));
    expect(second.wiring.tmuxPane).not.toBe(probe.wiring.tmuxPane);

    await probe.rpc('toolPolicyEventsClear');
    const event = claudeEvents(probe);
    const results = await Promise.all([
      probe.probe('tmux-first', event('toolu_tmux_first', 'Bash', { command: 'pwd' })),
      secondApi.probe('tmux-second', event('toolu_tmux_second', 'Bash', { command: 'pwd' }))
    ]);
    for (const result of results) {
      expect(result, `${JSON.stringify(result)}\n${probe.stderr()}`).toMatchObject({ status: 0, stdout: '', error: null });
      expect(result.stdout + result.stderr).not.toContain(NO_DECISION);
    }
    expect(await probe.rows()).toEqual(expect.arrayContaining([probe, second].map((session) => expect.objectContaining({
      threadId: session.sessionId, projectId: session.projectId, providerId: 'claude-code', toolName: 'Bash', state: 'allowed'
    }))));
    expect(await probe.rows()).toHaveLength(2);
  } finally {
    if (secondSessionId) await probe.win.evaluate((id) => window.cc.terminals.close(id), secondSessionId).catch(() => undefined);
    await probe.cleanup();
  }
});

test('a local Codex PTY tool call reaches the same plugin policy through main', async ({ home }) => {
  test.setTimeout(180_000);
  const probe = await launchProbe(home, 'codex', CODEX_STUB);
  const { wiring, projectId, sessionId, rpc, rows } = probe;
  try {
    expect(wiring.count).toBe(1);
    expect(new URL(wiring.url).pathname).toBe(`/hook/nativetool/${projectId}/${sessionId}`);
    const event = (toolUseId: string, toolInput: Record<string, unknown> = { command: 'pwd' }) => ({
      session_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      transcript_path: join(home, '.codex/sessions/rollout.jsonl'),
      cwd: probe.projectDir,
      hook_event_name: 'PreToolUse',
      model: 'gpt-5.5',
      permission_mode: 'default',
      turn_id: 'turn-e2e-1',
      tool_name: 'Bash',
      tool_use_id: toolUseId,
      tool_input: toolInput
    });
    await rpc('toolPolicyEventsClear');

    // Codex 0.140-0.157 rejects a bare allow as "Hook failed", so allow stays silent.
    const allowed = await probe.probe('allow', event('call_e2e_allow'));
    expect(allowed, `${JSON.stringify(allowed)}\n${probe.stderr()}`).toMatchObject({ status: 0, stdout: '' });
    expect(await rows()).toEqual([expect.objectContaining({
      providerId: 'codex', threadId: sessionId, projectId, toolName: 'Bash', state: 'allowed',
      invocationId: sha([sessionId, 'turn-e2e-1', 'call_e2e_allow', 'Bash', { command: 'pwd' }])
    })]);

    await rpc('setToolPolicySelection', { selection: 'deny' });
    const denied = await probe.probe('deny', event('call_e2e_deny'));
    expect(denied.stdout).toBe(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: FIXTURE_REASON }
    }));
    expect((await rows()).filter((row) => row.state === 'denied')).toHaveLength(1);

    const poisoned = await post(wiring.url, event('call_e2e_allow', { command: 'rm -rf /tmp/x' }));
    expect(poisoned.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(await rows()).toHaveLength(3);

    // A blank plugin reason would make Codex run the tool; the host replaces it.
    await rpc('setToolPolicySelection', { selection: 'deny', reason: '' });
    const blank = await probe.probe('blank', event('call_e2e_blank'));
    expect(denyReason(blank.stdout)).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: 'denied by plugin tool policy' });
    expect(await rows()).toHaveLength(4);
  } finally {
    await probe.cleanup();
  }
});
