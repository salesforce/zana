/**
 * Shared harness for the P2 built-Electron specs (admission prompt text, tool.settled, plugin
 * contribution parity, process helper). One observer fixture plugin is copied once per manifest
 * variant into the isolated HOME and preinstalled before launch, so each variant loads once at boot.
 * Everything lives under the throwaway HOME: `~/.agents`, `~/.cursor` and `~/.zcc` are never the real ones.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type AppHandle } from './app.js';
import type { Page } from '@playwright/test';
import { BUILTIN_PLUGINS } from '../../apps/server/src/plugins/builtin-registry.js';

export const OBSERVER_DIR = fileURLToPath(new URL('./plugins/p2-observer-probe', import.meta.url));
export const CLAUDE_NATIVE_FIXTURE = fileURLToPath(new URL('./claude-native-tool-policy.cjs', import.meta.url));
export const FIXTURE_BIN = fileURLToPath(new URL('./bin', import.meta.url));

/** The manifest patch a variant applies on top of the observer's own `zcc` block. */
export type ZccPatch = Record<string, unknown>;

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * Copy the observer under `<home>/p2-plugins/<id>`, give it its own package name and manifest patch, and
 * return the installed.json row. The plugin id is the package name without the `zcc-plugin-` prefix.
 */
export function copyObserver(home: string, id: string, patch: ZccPatch = {}): { id: string; rootDir: string; row: Record<string, unknown> } {
  const rootDir = join(home, 'p2-plugins', id);
  cpSync(OBSERVER_DIR, rootDir, { recursive: true });
  const manifestPath = join(rootDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string; zcc: Record<string, unknown> };
  manifest.name = `zcc-plugin-${id}`;
  manifest.zcc = { ...manifest.zcc, name: `P2 ${id}`, ...patch };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const row = {
    id, version: '0.1.0', name: `P2 ${id}`, enabled: true, status: 'running', provenance: 'direct', sourceKind: 'path',
    source: `path:${rootDir}`, rootDir, serverEntry: './server.ts', appEntry: null, installedAt: Date.now(), updatedAt: Date.now()
  };
  return { id, rootDir, row };
}

/** Preinstall observer variants before launch; a row written into a running service is never noticed. */
export function installObservers(home: string, variants: Record<string, ZccPatch>): string[] {
  const copies = Object.entries(variants).map(([id, patch]) => copyObserver(home, id, patch));
  mkdirSync(join(home, '.zcc/plugins'), { recursive: true });
  writeFileSync(join(home, '.zcc/plugins/installed.json'), JSON.stringify({ version: 1, plugins: copies.map((copy) => copy.row) }));
  return copies.map((copy) => copy.id);
}

export const rpcOn = (page: Page, pluginId: string) => <T,>(method: string, args?: unknown) =>
  page.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: pluginId, method, args }) as Promise<T>;

export async function waitForRunning(page: Page, ids: string[]): Promise<void> {
  await expect.poll(async () => {
    const rows = await page.evaluate(async () => (await window.cc.pluginApps.list()).map((row) => ({ id: row.id, status: row.status, detail: (row as { statusDetail?: string }).statusDetail })));
    return ids.map((id) => rows.find((row) => row.id === id)).filter((row) => row?.status !== 'running').map((row) => `${row?.status}:${row?.detail ?? ''}`);
  }, { timeout: 45_000, message: 'observer plugins did not reach running' }).toEqual([]);
}

/**
 * Wait until every enabled server plugin has a sealed native tool policy (and the unconfigured bundled
 * integration is out of the way), so native tool policy and tool.settled are live, never waived.
 */
export async function waitForSealedPolicy(app: AppHandle): Promise<void> {
  const page = app.window;
  const plugins = await page.evaluate(() => window.cc.pluginApps.list());
  if (plugins.some((row) => row.id === 'salesforce')) {
    expect(await page.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', false))).toMatchObject({ ok: true });
  }
  await expect.poll(() => {
    const { plugins } = JSON.parse(readFileSync(join(app.home, '.zcc/plugins/installed.json'), 'utf8')) as {
      plugins: Array<{ id: string; enabled: boolean; serverEntry?: string; toolPolicy?: string }>;
    };
    return [
      ...BUILTIN_PLUGINS.filter((row) => row.autoInstall && !plugins.some((installed) => installed.id === row.pluginId)).map((row) => row.pluginId),
      ...plugins.filter((row) => row.enabled && row.serverEntry && !['true', 'false'].includes(row.toolPolicy ?? '')).map((row) => row.id)
    ];
  }, { timeout: 45_000, message: 'tool policy was never sealed' }).toEqual([]);
}

export async function addProject(page: Page, dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  return page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id as string;
  }, dir);
}

export async function openTerminal(page: Page, projectId: string, profile: string, title: string): Promise<string> {
  return page.evaluate(async ({ projectId, profile, title }) => {
    const result = await window.cc.terminals.create({ projectId, profile: profile as 'claude', cols: 100, rows: 32, title });
    // The IPC returns either the session or a Result wrapping it, depending on the build.
    const reply = result as unknown as { ok?: boolean; value?: { id?: string }; id?: string };
    const session = reply.ok === undefined ? reply : reply.value;
    if (!session?.id) throw new Error(JSON.stringify(result));
    return session.id;
  }, { projectId, profile, title });
}

export const say = (page: Page, sessionId: string, line: string) =>
  page.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `${line}\r` });

/** Write an executable node stub (shebang = this node) into `dir`. */
export function writeNodeStub(dir: string, name: string, source: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

/**
 * Stub CLI core shared by the PTY specs. On launch it records argv, the session id, `ZCC_MCP_URL`,
 * `ZCC_TOOLSETTLED_URL` and, for OpenCode, the config file named by `OPENCODE_CONFIG`, into
 * `launch-<sessionId>.json` beside the stub, then reads commands from the PTY. `settle <label>` runs the
 * injected PostToolUse tool-settled relay with a synthetic body, as Claude does after a tool ends.
 */
export const PTY_STUB_CORE = String.raw`
const fs = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
function relayCommand(args) {
  const at = args.indexOf('--settings');
  if (at < 0) return '';
  const hooks = (JSON.parse(args[at + 1]).hooks || {}).PostToolUse || [];
  for (const entry of hooks) for (const hook of entry.hooks || []) if (hook.command.includes('ZCC_TOOLSETTLED_URL')) return hook.command;
  return '';
}
function dump() {
  const sessionId = process.env.ZCC_SESSION_ID;
  if (!sessionId) return;
  const args = process.argv.slice(2);
  const record = { args, mcpUrl: process.env.ZCC_MCP_URL || null, settledUrl: process.env.ZCC_TOOLSETTLED_URL || null, home: process.env.HOME };
  record.mcpConfigs = args.flatMap((arg, index) => args[index - 1] === '--mcp-config'
    ? [arg.trim().startsWith('{') ? arg : (fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg)] : []);
  const configPath = process.env.OPENCODE_CONFIG;
  if (configPath && fs.existsSync(configPath)) record.openCodeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.writeFileSync(join(__dirname, 'launch-' + sessionId + '.json'), JSON.stringify(record));
  console.log('P2 stub ready');
  const relay = relayCommand(args);
  createInterface({ input: process.stdin }).on('line', (line) => {
    const match = /^settle ([\w-]+)$/.exec(line.trim());
    if (!match) return;
    const body = JSON.stringify({
      session_id: sessionId, cwd: process.cwd(), hook_event_name: 'PostToolUse', tool_name: 'Bash',
      tool_input: { command: 'echo ' + match[1] }, tool_use_id: 'toolu_p2_' + match[1],
      tool_response: { stdout: 'PTY_SETTLED_OUTPUT:' + match[1] + ' token=fixture-secret-must-be-redacted ' + 'x'.repeat(6000), stderr: '', exit_code: 0 }
    });
    const result = spawnSync('/bin/sh', ['-c', relay], { input: body, env: process.env, timeout: 15000, encoding: 'utf8' });
    fs.writeFileSync(join(__dirname, 'settle-' + match[1] + '.json'), JSON.stringify({ status: result.status, hasRelay: relay !== '' }));
    console.log('SETTLE_ACK:' + match[1]);
  });
}
`;

export const claudeStub = (modelCli: string) => String.raw`
${PTY_STUB_CORE}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.296 (Claude Code)'); process.exit(0); }
if (args.includes('--input-format')) require(${JSON.stringify(modelCli)});
else if (args.includes('--print')) { console.log('Probe'); process.exit(0); }
else dump();
`;
export const CODEX_STUB = String.raw`
${PTY_STUB_CORE}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.154.0'); process.exit(0); }
dump();
`;
export const OPENCODE_STUB = String.raw`
${PTY_STUB_CORE}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.0.0'); process.exit(0); }
if (args[0] === 'models' || args[0] === 'agent' || args[0] === 'debug') { console.log('[]'); process.exit(0); }
dump();
`;

export interface LaunchRecord {
  args: string[];
  mcpUrl: string | null;
  settledUrl: string | null;
  mcpConfigs: string[];
  home: string;
  openCodeConfig?: { mcp?: Record<string, unknown> };
}

export function readLaunch(stubDir: string, sessionId: string): LaunchRecord | undefined {
  const path = join(stubDir, `launch-${sessionId}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as LaunchRecord : undefined;
}

/**
 * Environment for Modern Claude on the scripted native-policy CLI: the real SDK hook protocol with a
 * scripted model. Writes the CLI shim, shell rc PATH and config into HOME and returns the launch env.
 */
export function prepareScriptedClaude(home: string): Record<string, string> {
  const bin = join(home, 'p2-claude-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), `#!${process.execPath}\nrequire(${JSON.stringify(CLAUDE_NATIVE_FIXTURE)});\n`, { mode: 0o700 });
  for (const name of ['.zshrc', '.bashrc', '.bash_profile']) {
    writeFileSync(join(home, name), `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`);
  }
  // An explicit binary in config avoids the shared fixture's disabled-Claude guard.
  writeHomeConfig(home, { claudeBinary: join(bin, 'claude') });
  return { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ZDOTDIR: home, ZCC_CLAUDE_CODE_EXECUTABLE: join(bin, 'claude') };
}

/** Write `~/.zcc/config.json` in the isolated HOME before launch (the app keeps an existing file as is). */
export function writeHomeConfig(home: string, extra: Record<string, unknown>): void {
  mkdirSync(join(home, '.zcc'), { recursive: true });
  writeFileSync(join(home, '.zcc/config.json'), JSON.stringify({
    walkthroughCompleted: true, setupDismissed: true, sponsorPromptDismissed: true, teamJobLaunchEnabled: true,
    tmuxScope: 'off', autoRenameTabs: false, ...extra
  }));
}

/**
 * Environment for Modern Codex on the scripted app-server: every JSON-RPC request is appended to
 * `requestLog`, so a spec can read the `thread/start` config the product built.
 */
export function prepareScriptedCodex(home: string, requestLog: string): Record<string, unknown> {
  // The Modern Codex bridge resolves `codex` from PATH, so the shim lives in the dir prepareScriptedClaude
  // already put on PATH (and in the shell rc files).
  const bin = join(home, 'p2-claude-bin');
  mkdirSync(bin, { recursive: true });
  const script = join(home, 'p2-codex-script.json');
  writeFileSync(script, JSON.stringify({ modelId: 'p2-codex', messageText: 'P2 Codex ready', requestLogPath: requestLog }));
  const server = new URL('../../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url);
  writeFileSync(join(bin, 'codex'), `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('codex-cli 0.154.0'); process.exit(0); }
if (!process.argv.includes('app-server')) process.exit(64);
process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(server))}, ${JSON.stringify(script)}];
import(${JSON.stringify(server.href)});
`, { mode: 0o700 });
  return { codexBinary: join(bin, 'codex') };
}

export const isAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

export const readPid = (path: string): number | undefined =>
  existsSync(path) ? Number(readFileSync(path, 'utf8').trim()) || undefined : undefined;
