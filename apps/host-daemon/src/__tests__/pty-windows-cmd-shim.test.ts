/**
 * PtyManager.create() on Windows: a forwarding `claude.cmd` earlier on PATH
 * than `claude.exe` must not route the CLI Agent through cmd.exe (8191-char
 * cap → "The command line is too long."), and a launch that still can't fit
 * fails before spawning with the limit named.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const spawns: { command: string; args: string[] }[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[]) => {
    spawns.push({ command, args });
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

const config = { version: 1, theme: 'dark', shell: 'cmd.exe', claudeBinary: 'claude', fontSize: 13, lastProjectId: null } as const;
// The real inbox guidance alone is ~8.7 K characters; pad well past cmd.exe's cap.
const longPrompt = 'Project house rules. '.repeat(500);

function launch() {
  const mgr = new PtyManager();
  mgr.setMcpBaseUrl('http://127.0.0.1:39999');
  return mgr.create({
    projectId: 'proj1', profile: 'claude', cwd: root, cols: 80, rows: 24,
    config: config as never, projectSettings: { appendSystemPrompt: longPrompt }
  });
}

beforeEach(() => {
  spawns.length = 0;
  resetWindowsShimCacheForTests();
  // Shim folder first, as with a tool launcher, then the real exe folder.
  process.env.PATH = `${shimDir};${exeDir}`;
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
