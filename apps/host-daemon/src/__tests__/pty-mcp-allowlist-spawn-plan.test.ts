import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Persona MCP allowlist on the Codex and OpenCode launch paths (p2-codex-opencode):
 * unset / [] / list spawn plans, name-disable with no generated definitions file
 * (Codex `-c mcp_servers.<n>.enabled=false`; OpenCode via the OPENCODE_CONFIG file
 * channel), zcc-inbox survival (AC-14d), no credential field anywhere (AC-13),
 * the missing-server warning (AC-15), and the D7 ignore-with-notice paths
 * (a harness that cannot apply the list, and remote/SSH sessions).
 * Uses the REAL mcp-config module.
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
      pid: 7000 + spawned.length,
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
const ENV_KEYS = ['ZCC_DATA_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT'] as const;
const SECRETS = /SECRET/;
// Normalise the per-session id and the per-session MCP bearer token (and its config path).
const scrub = (text: string, id: string) =>
  text.split(id).join('<SID>').replace(/[0-9a-f]{64}/g, '<TOK>').replace(/zcc-session-mcp[^"]*/g, '<FILE>');

type Manager = InstanceType<(typeof import('../pty.js'))['PtyManager']>;
let PtyManager: (typeof import('../pty.js'))['PtyManager'];
let SpawnRefusedError: (typeof import('../pty.js'))['SpawnRefusedError'];
let mcpConfig: typeof import('../mcp-config.js');

type Warn = { code: string; message: string; server?: string };
type WarnEvent = { warnings: Warn[]; personaId?: string; sessionId: string };

describe('PtyManager.create: persona MCP allowlist for Codex and OpenCode', () => {
  let root: string;
  let cwd: string;
  let saved: Record<string, string | undefined>;

  const mgr = (): Manager => {
    const m = new PtyManager();
    m.setMcpBaseUrl('http://127.0.0.1:39999');
    return m;
  };
  const create = (m: Manager, profile: string, extra: Record<string, unknown> = {}) =>
    m.create({
      nativeToolPolicyRequired: false,
      projectId: 'p1',
      profile,
      cwd,
      cols: 80,
      rows: 24,
      config: CONFIG,
      ...extra
    } as never);
  const persona = (mcpServers?: string[]) => ({ id: 'persona-1', name: 'P', ...(mcpServers ? { mcpServers } : {}) });
  const events = (m: Manager): WarnEvent[] => {
    const out: WarnEvent[] = [];
    m.on('launchWarning', (event: WarnEvent) => out.push(event));
    return out;
  };
  const disabledCodex = (args: string[]) =>
    args.filter((a) => /^mcp_servers\..+\.enabled=false$/.test(a)).map((a) => a.slice('mcp_servers.'.length, -'.enabled=false'.length)).sort();
  const openCodeFile = (s: Spawn) => JSON.parse(readFileSync(s.env.OPENCODE_CONFIG!, 'utf8')) as { mcp: Record<string, Record<string, unknown>> };
  const disabledOpenCode = (s: Spawn) =>
    Object.entries(openCodeFile(s).mcp).filter(([, v]) => v.enabled === false).map(([k]) => k).sort();

  beforeEach(async () => {
    spawned.length = 0;
    vi.resetModules();
    ({ PtyManager, SpawnRefusedError } = await import('../pty.js'));
    mcpConfig = await import('../mcp-config.js');
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    root = mkdtempSync(join(tmpdir(), 'zcc-pty-mcp-co-'));
    cwd = join(root, 'project');
    mkdirSync(cwd);
    process.env.ZCC_DATA_DIR = join(root, 'data');
    delete process.env.OPENCODE_CONFIG;
    delete process.env.OPENCODE_CONFIG_CONTENT;
    // Codex user config: two servers, one with credentials, plus a user server literally named zcc-inbox.
    mkdirSync(join(root, 'codex'));
    process.env.CODEX_HOME = join(root, 'codex');
    writeFileSync(
      join(root, 'codex', 'config.toml'),
      [
        '[mcp_servers.usrA]',
        'command = "node"',
        'bearer_token = "SECRET-AUTH"',
        '[mcp_servers.usrA.env]',
        'API_KEY = "SECRET-ENV"',
        '[mcp_servers.usrA.http_headers]',
        'Authorization = "Bearer SECRET-HDR"',
        '[mcp_servers.usrB]',
        'url = "https://b.test/mcp"',
        '[mcp_servers.zcc-inbox]',
        'url = "https://spoof.test/mcp"'
      ].join('\n')
    );
    // OpenCode user config (JSONC): same names, credentials under its own field names.
    mkdirSync(join(root, 'xdg', 'opencode'), { recursive: true });
    process.env.XDG_CONFIG_HOME = join(root, 'xdg');
    writeFileSync(
      join(root, 'xdg', 'opencode', 'opencode.jsonc'),
      `// user config
{
  "mcp": {
    "usrA": { "type": "local", "command": ["node", "a.js"], "environment": { "API_KEY": "SECRET-ENV" },
              "headers": { "Authorization": "Bearer SECRET-HDR" }, "oauth": { "clientId": "SECRET-OAUTH" } },
    "usrB": { "type": "remote", "url": "https://b.test/mcp", /* trailing comma ok */ },
  },
}`
    );
  });

  afterEach(() => {
    mcpConfig.rebuildPluginServers([]);
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(root, { recursive: true, force: true });
  });

  describe('Codex', () => {
    it('unset leaves argv byte-identical to a persona-less launch: no disable flags, no warning', () => {
      const m = mgr();
      const ev = events(m);
      const plain = create(m, 'codex');
      const withPersona = create(m, 'codex', { persona: persona() });
      const norm = (s: Spawn, id: string) => scrub(JSON.stringify([s.command, s.args, s.env]), id);
      expect(norm(spawned[1]!, withPersona.id)).toBe(norm(spawned[0]!, plain.id));
      expect(disabledCodex(spawned[1]!.args)).toEqual([]);
      expect(ev).toEqual([]);
    });

    it('[] disables every configured user server by name; zcc-inbox survives and is never disabled', () => {
      create(mgr(), 'codex', { persona: persona([]) });
      const { args } = spawned[0]!;
      expect(disabledCodex(args)).toEqual(['usrA', 'usrB']);
      expect(args.some((a) => a.startsWith('mcp_servers.zcc-inbox.url='))).toBe(true);
      expect(args).not.toContain('mcp_servers.zcc-inbox.enabled=false');
    });

    it('a list disables only the unlisted servers (exclusive, not additive); zcc-inbox survives', () => {
      create(mgr(), 'codex', { persona: persona(['usrA']) });
      expect(disabledCodex(spawned[0]!.args)).toEqual(['usrB']);
      expect(spawned[0]!.args.some((a) => a.startsWith('mcp_servers.zcc-inbox.url='))).toBe(true);
    });

    it('also disables servers named only in the project .codex/config.toml', () => {
      mkdirSync(join(cwd, '.codex'));
      writeFileSync(join(cwd, '.codex', 'config.toml'), '[mcp_servers.projC]\ncommand = "node"\n');
      create(mgr(), 'codex', { persona: persona(['usrA']) });
      expect(disabledCodex(spawned[0]!.args)).toEqual(['projC', 'usrB']);
    });

    it('AC-14d: the always-allowed set is pinned to zcc-inbox and survives [] and a list', () => {
      expect([...ALWAYS_ALLOWED_MCP_SERVERS]).toEqual(['zcc-inbox']);
      create(mgr(), 'codex', { persona: persona([]) });
      create(mgr(), 'codex', { persona: persona(['usrB']) });
      for (const s of spawned) expect(s.args.filter((a) => a.startsWith('mcp_servers.zcc-inbox.url='))).toHaveLength(1);
    });

    it('AC-13: only names reach argv and env, no definition or credential', () => {
      create(mgr(), 'codex', { persona: persona([]) });
      const { args, env } = spawned[0]!;
      expect(JSON.stringify(args) + JSON.stringify(env)).not.toMatch(SECRETS);
      expect(args.some((a) => a.startsWith('mcp_servers.usrA.') && !a.endsWith('.enabled=false'))).toBe(false);
      expect(args.some((a) => /bearer|http_headers|\.env=/.test(a))).toBe(false);
    });

    it('AC-15: an allowlisted server missing from the config warns by name through the single hook; a present one does not', () => {
      const m = mgr();
      const ev = events(m);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const session = create(m, 'codex', { persona: persona(['usrA', 'ghost']) });
      expect(ev).toHaveLength(1);
      expect(ev[0]!.sessionId).toBe(session.id);
      expect(ev[0]!.personaId).toBe('persona-1');
      expect(ev[0]!.warnings.map((w) => [w.code, w.server])).toEqual([['allowlisted-mcp-not-found', 'ghost']]);
      expect(ev[0]!.warnings[0]!.message).toContain('"ghost"');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(ev) + JSON.stringify(spawned[0]!.args)).not.toMatch(SECRETS);
    });

    it('an unreadable config warns that servers defined only there may still load', () => {
      writeFileSync(join(root, 'codex', 'config.toml'), 'this is = = not toml');
      const m = mgr();
      const ev = events(m);
      create(m, 'codex', { persona: persona([]) });
      expect(ev[0]!.warnings.map((w) => w.code)).toEqual(['mcp-allowlist-config-unreadable']);
      expect(disabledCodex(spawned[0]!.args)).toEqual([]);
    });

    it('a name that is not a bare key is reported, never written into argv', () => {
      writeFileSync(join(root, 'codex', 'config.toml'), '[mcp_servers."odd.name"]\ncommand = "node"\n[mcp_servers.usrB]\nurl = "https://b.test/mcp"\n');
      const m = mgr();
      const ev = events(m);
      create(m, 'codex', { persona: persona([]) });
      expect(disabledCodex(spawned[0]!.args)).toEqual(['usrB']);
      expect(spawned[0]!.args.join(' ')).not.toContain('odd.name');
      expect(ev[0]!.warnings.map((w) => [w.code, w.server])).toEqual([['mcp-allowlist-not-disabled', 'odd.name']]);
    });

    it('a Zana plugin server follows the allowlist while the harness-owned user servers are disabled by name', () => {
      mcpConfig.rebuildPluginServers([
        { id: 'p1', enabled: true, rootDir: cwd, mcpServers: [{ name: 'auto', type: 'http', url: 'https://x.test/mcp', alwaysOn: true }] }
      ]);
      const m = mgr();
      const ev = events(m);
      create(m, 'codex', { persona: persona([]) });
      expect(spawned[0]!.args.some((a) => a.startsWith('mcp_servers.plugin_p1_auto.'))).toBe(false);
      create(m, 'codex', { persona: persona(['plugin:p1:auto']) });
      expect(spawned[1]!.args.some((a) => a.startsWith('mcp_servers.plugin_p1_auto.url='))).toBe(true);
      // A pinned registry entry is delivered by Zana, so it is never reported missing.
      expect(ev.flatMap((e) => e.warnings).filter((w) => w.server === 'plugin:p1:auto')).toEqual([]);
    });
  });

  describe('OpenCode', () => {
    it('unset leaves the config file and env byte-identical to a persona-less launch', () => {
      const m = mgr();
      const ev = events(m);
      const plain = create(m, 'opencode');
      const withPersona = create(m, 'opencode', { persona: persona() });
      const view = (s: Spawn, id: string) =>
        scrub(JSON.stringify([s.command, s.args, { ...s.env, OPENCODE_CONFIG: readFileSync(s.env.OPENCODE_CONFIG!, 'utf8') }]), id);
      expect(view(spawned[1]!, withPersona.id)).toBe(view(spawned[0]!, plain.id));
      expect(disabledOpenCode(spawned[1]!)).toEqual([]);
      expect(ev).toEqual([]);
    });

    it('[] disables every configured user server through the OPENCODE_CONFIG file only; zcc-inbox stays enabled', () => {
      create(mgr(), 'opencode', { persona: persona([]) });
      const s = spawned[0]!;
      const file = openCodeFile(s);
      expect(disabledOpenCode(s)).toEqual(['usrA', 'usrB']);
      expect(file.mcp['zcc-inbox']).toMatchObject({ type: 'remote', enabled: true });
      // The inline channel is clobbered by a telemetry shim, so it carries no disable.
      expect(JSON.parse(s.env.OPENCODE_CONFIG_CONTENT!).mcp.usrA).toBeUndefined();
      expect(s.args).toEqual(expect.not.arrayContaining(['usrA']));
    });

    it('a list disables only the unlisted servers; zcc-inbox survives', () => {
      create(mgr(), 'opencode', { persona: persona(['usrB']) });
      expect(disabledOpenCode(spawned[0]!)).toEqual(['usrA']);
      expect(openCodeFile(spawned[0]!).mcp['zcc-inbox']).toMatchObject({ enabled: true });
    });

    it('enumerates project opencode.json and .opencode config too', () => {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: { projC: { type: 'local', command: ['x'] } } }));
      mkdirSync(join(cwd, '.opencode'));
      writeFileSync(join(cwd, '.opencode', 'opencode.json'), JSON.stringify({ mcp: { projD: { type: 'remote', url: 'https://d.test' } } }));
      create(mgr(), 'opencode', { persona: persona(['usrA', 'usrB']) });
      expect(disabledOpenCode(spawned[0]!)).toEqual(['projC', 'projD']);
    });

    it('AC-14d: zcc-inbox survives [] and a list, and a user server named zcc-inbox cannot disable it', () => {
      writeFileSync(join(root, 'xdg', 'opencode', 'opencode.json'), JSON.stringify({ mcp: { 'zcc-inbox': { enabled: false } } }));
      create(mgr(), 'opencode', { persona: persona([]) });
      create(mgr(), 'opencode', { persona: persona(['usrA']) });
      for (const s of spawned) expect(openCodeFile(s).mcp['zcc-inbox']).toMatchObject({ type: 'remote', enabled: true });
    });

    it('AC-13: only names reach the config file, env and argv, no definition or credential', () => {
      create(mgr(), 'opencode', { persona: persona([]) });
      const s = spawned[0]!;
      const text = readFileSync(s.env.OPENCODE_CONFIG!, 'utf8') + JSON.stringify(s.env) + JSON.stringify(s.args);
      expect(text).not.toMatch(SECRETS);
      for (const [name, entry] of Object.entries(openCodeFile(s).mcp)) {
        if (name !== 'zcc-inbox') expect(entry).toEqual({ enabled: false });
      }
    });

    it('AC-15: an allowlisted server missing from the config warns by name through the single hook', () => {
      const m = mgr();
      const ev = events(m);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      create(m, 'opencode', { persona: persona(['usrA', 'ghost']) });
      expect(ev).toHaveLength(1);
      expect(ev[0]!.warnings.map((w) => [w.code, w.server])).toEqual([['allowlisted-mcp-not-found', 'ghost']]);
      expect(JSON.stringify(ev)).not.toMatch(SECRETS);
    });

    it('removes the per-session file on exit', () => {
      create(mgr(), 'opencode', { persona: persona([]) });
      const path = spawned[0]!.env.OPENCODE_CONFIG!;
      expect(existsSync(path)).toBe(true);
      spawned[0]!.exit();
      expect(existsSync(path)).toBe(false);
    });

    it('refuses the launch when the file channel cannot be written (no silent unrestricted fall back)', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const id = '22222222-3333-4444-5555-666666666666';
      const target = join(tmpdir(), 'zcc-session-mcp', `${id}.json`);
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'x'), '1');
      try {
        expect(() => create(mgr(), 'opencode', { persona: persona([]), preallocatedSessionId: id })).toThrow(SpawnRefusedError);
        expect(spawned).toHaveLength(0);
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });
  });

  describe('D7: the allowlist is ignored with a notice, never a block', () => {
    it('a harness that cannot disable user servers launches with a visible ignore notice', () => {
      const m = mgr();
      const ev = events(m);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const data: string[] = [];
      m.on('data', (_id: string, chunk: string) => data.push(chunk));
      create(m, 'pi', { persona: persona(['usrA']) });
      expect(spawned).toHaveLength(1);
      expect(ev[0]!.warnings.map((w) => w.code)).toEqual(['mcp-allowlist-ignored']);
      expect(data.join('')).toContain('allowlist is ignored');
    });

    it('an unset allowlist on that harness is silent', () => {
      const m = mgr();
      const ev = events(m);
      create(m, 'pi', { persona: persona() });
      expect(ev).toEqual([]);
    });

    it('an unavailable local MCP server says the allowlist was not applied', () => {
      const m = new PtyManager();
      const ev = events(m);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      create(m, 'codex', { persona: persona([]) });
      expect(disabledCodex(spawned[0]!.args)).toEqual([]);
      expect(ev[0]!.warnings.map((w) => w.code)).toEqual(['mcp-allowlist-ignored']);
    });

    it('a remote (SSH) session ignores the list with a notice and still launches', () => {
      const m = mgr();
      const ev = events(m);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const session = create(m, 'claude', { persona: persona([]), remote: { host: 'devbox', remotePath: '/work/p1' } });
      expect(spawned).toHaveLength(1);
      expect(ev).toHaveLength(1);
      expect(ev[0]!.sessionId).toBe(session.id);
      expect(ev[0]!.warnings.map((w) => w.code)).toEqual(['mcp-allowlist-ignored']);
      expect(ev[0]!.warnings[0]!.message).toContain('remote');
    });

    it('a remote session with no allowlist is silent', () => {
      const m = mgr();
      const ev = events(m);
      create(m, 'claude', { persona: persona(), remote: { host: 'devbox', remotePath: '/work/p1' } });
      expect(ev).toEqual([]);
    });
  });
});
