import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Persona MCP allowlist on the Claude CLI launch path (p2-claude-interactive):
 * the per-session strict-mode file, its lifecycle (0600, exit, refused spawn,
 * stale sweep), the credential-stripped warning (AC-13 / AC-15), D9 strict-flag
 * orthogonality with the skills restriction, and the single launch-warning hook.
 * Uses the REAL mcp-config module (the golden suite mocks it).
 */

interface Spawn {
  command: string;
  args: string[];
  env: Record<string, string>;
  exit: () => void;
}
const spawned: Spawn[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[], opts: { env?: Record<string, string> }) => {
    let onExit: (event: { exitCode: number }) => void = () => undefined;
    spawned.push({ command, args, env: opts?.env ?? {}, exit: () => onExit({ exitCode: 0 }) });
    return {
      pid: 6000 + spawned.length,
      write() {},
      onData() {},
      onExit(cb: (event: { exitCode: number }) => void) {
        onExit = cb;
      },
      resize() {},
      kill() {}
    };
  }
}));

vi.mock('../tmux.js', () => ({
  isTmuxAvailable: () => false,
  buildLocalTmuxCommand: (_id: string, command: string, args: string[]) => ({ command, args }),
  wrapRemoteTmux: (_id: string, quoted: string) => quoted,
  tmuxSessionName: (sessionId: string) => `cc-${sessionId}`
}));

vi.mock('../harness/claude/binary-identity.js', () => ({
  resolveGenuineClaudeFromPath: (fallback: string) => fallback
}));

import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { ALWAYS_ALLOWED_MCP_SERVERS } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};
const SESSION_DIR = join(tmpdir(), 'zcc-session-mcp');
const ENV_KEYS = ['ZCC_DATA_DIR', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY'] as const;

type Manager = InstanceType<(typeof import('../pty.js'))['PtyManager']>;
let PtyManager: (typeof import('../pty.js'))['PtyManager'];
let SpawnRefusedError: (typeof import('../pty.js'))['SpawnRefusedError'];
let mcpConfig: typeof import('../mcp-config.js');

describe('PtyManager.create: persona MCP allowlist for Claude', () => {
  let dataDir: string;
  let claudeHome: string;
  let cwd: string;
  let saved: Record<string, string | undefined>;

  const mgr = (): Manager => {
    const m = new PtyManager();
    m.setMcpBaseUrl('http://127.0.0.1:39999');
    return m;
  };
  const create = (m: Manager, extra: Record<string, unknown> = {}) =>
    m.create({
      nativeToolPolicyRequired: false,
      projectId: 'p1',
      profile: 'claude',
      cwd,
      cols: 80,
      rows: 24,
      config: CONFIG,
      ...extra
    } as never);
  const persona = (mcpServers?: string[]) => ({ id: 'persona-1', name: 'P', ...(mcpServers ? { mcpServers } : {}) });
  const mcpFile = (args: string[]) => args[args.indexOf('--mcp-config') + 1]!;
  const servers = (path: string) => JSON.parse(readFileSync(path, 'utf8')).mcpServers as Record<string, Record<string, unknown>>;
  const allowedTools = (args: string[]) => args.filter((_, i) => args[i - 1] === '--allowedTools').join(' ');

  beforeEach(async () => {
    spawned.length = 0;
    vi.resetModules();
    ({ PtyManager, SpawnRefusedError } = await import('../pty.js'));
    mcpConfig = await import('../mcp-config.js');
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-pty-mcp-data-'));
    claudeHome = mkdtempSync(join(tmpdir(), 'zcc-pty-mcp-claude-'));
    cwd = mkdtempSync(join(tmpdir(), 'zcc-pty-mcp-cwd-'));
    process.env.ZCC_DATA_DIR = dataDir;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    writeFileSync(
      join(claudeHome, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          usrA: {
            command: 'node',
            args: ['a.js'],
            env: { API_KEY: 'SECRET-ENV' },
            headers: { Authorization: 'Bearer SECRET-HDR' },
            oauth: { clientId: 'SECRET-OAUTH' },
            auth: { token: 'SECRET-AUTH' }
          },
          usrB: { command: 'node', args: ['b.js'] }
        }
      })
    );
  });

  afterEach(() => {
    mcpConfig.rebuildPluginServers([]);
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    for (const d of [dataDir, claudeHome, cwd]) rmSync(d, { recursive: true, force: true });
  });

  it('AC-14d: the always-allowed set is pinned to zcc-inbox (no other server serves Squad execution tools)', () => {
    expect([...ALWAYS_ALLOWED_MCP_SERVERS]).toEqual(['zcc-inbox']);
  });

  it('[] writes a 0600 per-session strict file with zcc-inbox only, then removes it on exit', () => {
    const session = create(mgr(), { persona: persona([]) });
    const { args } = spawned[0]!;
    const path = mcpFile(args);
    expect(path).toBe(join(SESSION_DIR, `${session.id}.json`));
    expect(Object.keys(servers(path))).toEqual(['zcc-inbox']);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(args.filter((a) => a === '--strict-mcp-config')).toHaveLength(1);
    expect(allowedTools(args)).toContain('mcp__zcc-inbox');
    spawned[0]!.exit();
    expect(existsSync(path)).toBe(false);
  });

  it('a list carries exactly the allowlisted servers; zcc-inbox survives', () => {
    create(mgr(), { persona: persona(['usrA']) });
    const path = mcpFile(spawned[0]!.args);
    expect(Object.keys(servers(path)).sort()).toEqual(['usrA', 'zcc-inbox']);
    expect(spawned[0]!.args).toContain('--strict-mcp-config');
  });

  it('AC-13: no credential field or secret reaches the file or argv', () => {
    create(mgr(), { persona: persona(['usrA']) });
    const { args, env } = spawned[0]!;
    const text = readFileSync(mcpFile(args), 'utf8');
    expect(text + JSON.stringify(args) + JSON.stringify(env)).not.toMatch(/SECRET/);
    for (const field of ['env', 'headers', 'oauth', 'auth']) expect(servers(mcpFile(args)).usrA).not.toHaveProperty(field);
  });

  it('AC-15: a credential-stripped allowlisted server yields one warning naming it, via the single hook', () => {
    const m = mgr();
    const events: Array<{ warnings: Array<{ code: string; server?: string; message: string }>; personaId?: string; sessionId: string }> = [];
    m.on('launchWarning', (event) => events.push(event));
    const data: string[] = [];
    m.on('data', (_id: string, chunk: string) => data.push(chunk));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = create(m, { persona: persona(['usrA', 'ghost']) });
    expect(events).toHaveLength(1);
    expect(events[0]!.sessionId).toBe(session.id);
    expect(events[0]!.personaId).toBe('persona-1');
    expect(events[0]!.warnings.map((w) => [w.code, w.server])).toEqual([
      ['allowlisted-mcp-credentials-stripped', 'usrA'],
      ['allowlisted-mcp-not-carried', 'ghost']
    ]);
    expect(data.join('')).toContain('usrA');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events) + data.join('')).not.toMatch(/SECRET/);
  });

  it('no allowlist (and a clean allowlist) emits no launchWarning event', () => {
    const m = mgr();
    const events: unknown[] = [];
    m.on('launchWarning', (event) => events.push(event));
    create(m, { persona: persona() });
    create(m, { persona: persona(['usrB']) });
    expect(events).toEqual([]);
  });

  it('an isolated (scheduled) launch consumes the isolated plan warnings through the same hook, deduplicated', () => {
    const m = mgr();
    const events: Array<{ warnings: Array<{ code: string; server?: string }> }> = [];
    m.on('launchWarning', (event) => events.push(event));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    create(m, { scheduled: true, persona: persona(['usrA']) });
    expect(events).toHaveLength(1);
    expect(events[0]!.warnings.filter((w) => w.server === 'usrA')).toHaveLength(1);
    expect(spawned[0]!.args).toContain('--strict-mcp-config');
  });

  it('an unset allowlist keeps the shared per-project file and emits no strict flag', () => {
    create(mgr(), { persona: persona() });
    const { args } = spawned[0]!;
    expect(mcpFile(args)).toBe(mcpConfig.mcpConfigPathForProject('p1'));
    expect(args).not.toContain('--strict-mcp-config');
  });

  it('D9: skills-lean strict stays a single flag; the file still holds exactly the allowlist', () => {
    create(mgr(), { persona: persona(['usrB']), skillSettings: { strictMcp: true } });
    const { args } = spawned[0]!;
    expect(args.filter((a) => a === '--strict-mcp-config')).toHaveLength(1);
    expect(Object.keys(servers(mcpFile(args))).sort()).toEqual(['usrB', 'zcc-inbox']);
  });

  it('D9: a skills restriction keeps its own settings keys while a set list adds the strict flag', () => {
    create(mgr(), { persona: persona(['usrB']), skillSettings: { skillOverrides: { foo: 'off' } } });
    const { args } = spawned[0]!;
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--settings') + 1]).toContain('skillOverrides');
  });

  it('D9: skills-lean with an unset MCP list is unchanged (strict, shared file)', () => {
    create(mgr(), { persona: persona(), skillSettings: { strictMcp: true } });
    const { args } = spawned[0]!;
    expect(args.filter((a) => a === '--strict-mcp-config')).toHaveLength(1);
    expect(mcpFile(args)).toBe(mcpConfig.mcpConfigPathForProject('p1'));
  });

  it('pre-approves only allowlisted always-on plugin tools in allowlist mode (D5: not exempt)', () => {
    mcpConfig.rebuildPluginServers([
      { id: 'p1', enabled: true, rootDir: cwd, mcpServers: [{ name: 'auto', type: 'http', url: 'https://x.test/mcp', alwaysOn: true }] }
    ]);
    const config = { ...CONFIG, trustZccToolsEnabled: true };
    create(mgr(), { config, persona: persona([]) });
    expect(allowedTools(spawned[0]!.args)).not.toContain('mcp__plugin_p1_auto');
    expect(allowedTools(spawned[0]!.args)).toContain('mcp__zcc-inbox');
    create(mgr(), { config, persona: persona(['plugin:p1:auto']) });
    expect(allowedTools(spawned[1]!.args)).toContain('mcp__plugin_p1_auto');
    create(mgr(), { config, persona: persona() });
    expect(allowedTools(spawned[2]!.args)).toContain('mcp__plugin_p1_auto');
  });

  it('a write failure refuses the launch (no silent fall back to unrestricted) and leaves no file', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // An id colliding with a non-empty directory makes the atomic rename fail.
    const id = '11111111-2222-3333-4444-555555555555';
    const target = join(SESSION_DIR, `${id}.json`);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'x'), '1');
    try {
      expect(() => create(mgr(), { persona: persona([]), preallocatedSessionId: id })).toThrow(SpawnRefusedError);
      expect(spawned).toHaveLength(0);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('the stale sweep removes a crashed session file but never a live session file', async () => {
    mkdirSync(SESSION_DIR, { recursive: true });
    const orphan = join(SESSION_DIR, 'crashed-session-aaaa.json');
    writeFileSync(orphan, '{}');
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    utimesSync(orphan, old, old);
    // First create in this (freshly imported) module runs the throttled sweep.
    const live = create(mgr(), { persona: persona([]) });
    const livePath = mcpFile(spawned[0]!.args);
    // Age the live session's file past the cap: ownership, not mtime, must protect it.
    utimesSync(livePath, old, old);
    const { sweepStaleSessionArtifacts } = await import('../pty.js');
    const owned = new Set([live.id]);
    await sweepStaleSessionArtifacts(SESSION_DIR, Date.now(), (id) => owned.has(id));
    await vi.waitFor(() => expect(existsSync(orphan)).toBe(false));
    expect(existsSync(livePath)).toBe(true);
    spawned[0]!.exit();
    expect(existsSync(livePath)).toBe(false);
  });
});
