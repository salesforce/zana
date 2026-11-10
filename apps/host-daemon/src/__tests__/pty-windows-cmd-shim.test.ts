/**
 * PtyManager.create() on Windows: a forwarding `claude.cmd` earlier on PATH
 * than `claude.exe`, or the npm `codex.cmd` (`node.exe <codex.js> %*`), must
 * not route the CLI Agent through cmd.exe (8191-char cap → "The command line
 * is too long."), and a launch that still can't fit fails before spawning
 * with the limit named.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const spawns: { command: string; args: string[]; env: Record<string, string> }[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[], opts: { env: Record<string, string> }) => {
    spawns.push({ command, args, env: opts.env });
    return { pid: 4242, write() {}, onData() {}, onExit() {}, resize() {}, kill() {} };
  }
}));
vi.mock('node:path', async (original) => ({ ...await original<typeof import('node:path')>(), delimiter: ';' }));
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  sessionPluginMcpServers: () => [],
  alwaysOnPluginMcpAllowlist: () => []
}));
vi.mock('../tmux.js', () => ({
  isTmuxAvailable: () => false,
  buildLocalTmuxCommand: (_id: string, command: string, args: string[]) => ({ command, args }),
  wrapRemoteTmux: (_id: string, quoted: string) => quoted,
  tmuxSessionName: (sessionId: string) => `cc-${sessionId}`,
  killLocalTmuxSession: () => {}
}));
vi.mock('../harness/claude/binary-identity.js', () => ({
  resolveGenuineClaudeFromPath: (fallback: string) => fallback
}));

const root = mkdtempSync(join(tmpdir(), 'pty-win-shim-'));
const dataDir = join(root, 'data');
const shimDir = join(root, 'launcher bin');
const exeDir = join(root, "local bin o'brien");
mkdirSync(dataDir);
mkdirSync(shimDir);
mkdirSync(exeDir);
const exe = join(exeDir, 'claude.exe');
writeFileSync(exe, 'MZ', { mode: 0o700 });
const shim = join(shimDir, 'claude.cmd');

// `npm install -g @openai/codex`: %APPDATA%\npm\codex.cmd (the real file) and
// the script it runs; node.exe in its own folder, as with the Node installer.
const npmDir = join(root, "App Data o'brien", 'npm');
const codexJs = join(npmDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
mkdirSync(dirname(codexJs), { recursive: true });
writeFileSync(codexJs, '');
const codexCmd = join(npmDir, 'codex.cmd');
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'harness', '__tests__', 'fixtures', 'windows-shims');
copyFileSync(join(fixtures, 'npm-codex.cmd'), codexCmd);
const nodeDir = join(root, 'nodejs');
mkdirSync(nodeDir);
const nodeExe = join(nodeDir, 'node.exe');
writeFileSync(nodeExe, 'MZ', { mode: 0o700 });

const platform = process.platform;
const priorEnv = { ...process.env };
Object.defineProperty(process, 'platform', { value: 'win32' });
process.env.ZCC_DATA_DIR = dataDir;
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.PATHEXT = '.EXE;.CMD';
delete process.env.ZCC_SESSION_ID;
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: platform });
  process.env = priorEnv;
  rmSync(root, { recursive: true, force: true });
});

const { PtyManager } = await import('../pty.js');
const { resetWindowsShimCacheForTests } = await import('../harness/windows-command.js');

const config = { version: 1, theme: 'dark', shell: 'cmd.exe', claudeBinary: 'claude', codexBinary: 'codex', fontSize: 13, lastProjectId: null } as const;
// The real inbox guidance alone is ~8.7 K characters; pad well past cmd.exe's cap.
const longPrompt = 'Project house rules. '.repeat(500);

function launch(profile: 'claude' | 'codex' = 'claude') {
  const mgr = new PtyManager();
  mgr.setMcpBaseUrl('http://127.0.0.1:39999');
  return mgr.create({
    projectId: 'proj1', profile, cwd: root, cols: 80, rows: 24,
    config: config as never, projectSettings: { appendSystemPrompt: longPrompt }
  });
}

beforeEach(() => {
  spawns.length = 0;
  resetWindowsShimCacheForTests();
  // Shim folder first, as with a tool launcher, then the real exe folder.
  process.env.PATH = `${shimDir};${exeDir};${npmDir};${nodeDir}`;
});

describe('PtyManager.create on win32 with a claude.cmd shim first on PATH', () => {
  it('spawns the exe the shim forwards to, with the argv unchanged', () => {
    writeFileSync(shim, `@"${exe}" %*\r\n`, { mode: 0o700 });
    launch();
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.command).toBe(exe);
    expect(spawns[0]!.args).toContain('--append-system-prompt');
    expect(spawns[0]!.args.some((a) => a.includes(longPrompt))).toBe(true);
  });

  it('fails before spawning, naming the limit, when the shim is not a plain forwarder', () => {
    writeFileSync(shim, `@echo off\r\nsetlocal\r\n"${exe}" %*\r\n`, { mode: 0o700 });
    expect(() => launch()).toThrow(
      /^Cannot start .*claude\.cmd: its command line is \d+ characters, over the Windows limit of 8191\. It is a batch file/
    );
    expect(spawns).toHaveLength(0);
  });
});

describe('PtyManager.create on win32 with the npm codex.cmd on PATH', () => {
  it('spawns node.exe on codex.js, with the long argv after it unchanged', () => {
    launch('codex');
    expect(spawns).toHaveLength(1);
    const [spawned] = spawns;
    expect(spawned!.command).toBe(nodeExe);
    expect(spawned!.args[0]).toBe(codexJs);
    // The guidance rides in `-c developer_instructions=…`, past cmd.exe's cap.
    expect(spawned!.args.some((a) => a.startsWith('developer_instructions='))).toBe(true);
    expect(spawned!.args.join(' ').length).toBeGreaterThan(8191);
  });

  it('fails before spawning, naming the limit, when node is only a node.cmd shim', () => {
    const nvm = join(root, 'nvm');
    mkdirSync(nvm, { recursive: true });
    writeFileSync(join(nvm, 'node.cmd'), '@echo off\r\n', { mode: 0o700 });
    process.env.PATH = `${npmDir};${nvm};${nodeDir}`;
    expect(() => launch('codex')).toThrow(
      /^Cannot start .*codex\.cmd: its command line is \d+ characters, over the Windows limit of 8191\. It is a batch file/
    );
    expect(spawns).toHaveLength(0);
  });

  it('runs a pnpm codex.cmd through node.exe and carries its NODE_PATH into the spawn env', () => {
    // A pnpm-installed CLI as codex: node_modules\.bin\codex.cmd (the real
    // pnpm template, with a NODE_PATH block) runs ..\@fixture\echo-cli\bin\echo-cli.js.
    const pnpmBin = join(root, 'proj', 'node_modules', '.bin');
    const script = join(pnpmBin, '..', '@fixture', 'echo-cli', 'bin', 'echo-cli.js');
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(pnpmBin, { recursive: true });
    writeFileSync(script, '');
    copyFileSync(join(fixtures, 'pnpm-node-path.cmd'), join(pnpmBin, 'codex.cmd'));
    process.env.PATH = `${pnpmBin};${nodeDir}`;
    launch('codex');
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.command).toBe(nodeExe);
    expect(spawns[0]!.args[0]).toBe(script);
    expect(spawns[0]!.env.NODE_PATH).toMatch(/^C:\\proj\\node_modules\\\.pnpm\\/);
  });
});
