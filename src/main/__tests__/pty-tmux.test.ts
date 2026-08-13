import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture BOTH the command and argv each spawn receives, so we can assert
// whether the tmux wrap was applied.
interface FakeProc {
  pid: number;
  command: string;
  args: string[];
  write: () => void;
  onData: () => void;
  onExit: () => void;
  resize: () => void;
  kill: () => void;
  killed: boolean;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[]) => {
    const proc: FakeProc = {
      pid: 4000 + spawned.length,
      command,
      args,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      killed: false,
      kill() { proc.killed = true; }
    };
    spawned.push(proc);
    return proc;
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

// Control tmux availability deterministically.
const tmuxAvailable = vi.fn(() => true);
vi.mock('../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux.js')>();
  return {
    ...actual,
    isTmuxAvailable: () => tmuxAvailable()
  };
});

import { PtyManager, remotePortForSession, detectRemoteForwardFailure } from '../pty.js';
import type { AppConfig } from '../../shared/types.js';

function cfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    version: 1,
    theme: 'dark',
    shell: '/bin/zsh',
    claudeBinary: 'claude',
    fontSize: 13,
    lastProjectId: null,
    ...over
  } as AppConfig;
}

const dims = { cwd: '/work/p1', cols: 80, rows: 24 };

describe('pty tmux wrapping (local)', () => {
  let ptys: PtyManager;

  beforeEach(() => {
    spawned.length = 0;
    tmuxAvailable.mockReturnValue(true);
    ptys = new PtyManager();
  });

  it('wraps the command in tmux when scope is "all" and tmux is available', () => {
    ptys.create({ projectId: 'p1', profile: 'shell', config: cfg({ tmuxScope: 'all' }), ...dims });
    const proc = spawned[0];
    expect(proc.command).toBe('tmux');
    // Leading `set -g …` clauses configure OSC-title forwarding; the
    // new-session invocation follows them.
    const ns = proc.args.indexOf('new-session');
    expect(ns).toBeGreaterThanOrEqual(0);
    expect(proc.args.slice(ns, ns + 3)).toEqual(['new-session', '-A', '-s']);
    expect(proc.args[ns + 3]).toMatch(/^cc-/); // cc-<sessionId>
    // The real shell command follows the `--` terminator.
    const dashdash = proc.args.indexOf('--');
    expect(dashdash).toBeGreaterThan(0);
    expect(proc.args[dashdash + 1]).toBe('/bin/zsh');
  });

  it('does NOT wrap when scope is unset (default)', () => {
    ptys.create({ projectId: 'p1', profile: 'shell', config: cfg(), ...dims });
    expect(spawned[0].command).toBe('/bin/zsh');
  });

  it('does NOT wrap when scope is "off"', () => {
    ptys.create({ projectId: 'p1', profile: 'shell', config: cfg({ tmuxScope: 'off' }), ...dims });
    expect(spawned[0].command).toBe('/bin/zsh');
  });

  it('does NOT wrap a local session when scope is "remote" (remote-only)', () => {
    ptys.create({ projectId: 'p1', profile: 'shell', config: cfg({ tmuxScope: 'remote' }), ...dims });
    expect(spawned[0].command).toBe('/bin/zsh');
  });

  it('does NOT wrap when tmux is unavailable, even with scope "all"', () => {
    tmuxAvailable.mockReturnValue(false);
    ptys.create({ projectId: 'p1', profile: 'shell', config: cfg({ tmuxScope: 'all' }), ...dims });
    expect(spawned[0].command).toBe('/bin/zsh');
  });

  it('does NOT wrap a scheduled run', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ tmuxScope: 'all' }),
      scheduled: true,
      ...dims
    });
    expect(spawned[0].command).toBe('/bin/zsh');
  });

  it('wraps a headless Team worker so lifecycle restoration can reattach it', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ tmuxScope: 'all' }),
      headless: true,
      cohort: {
        cohortId: 'cohort-1', teamId: 'team-1', teamName: 'Team',
        role: 'worker', slotId: 'slot-1'
      },
      ...dims
    });
    expect(spawned[0].command).toBe('tmux');
  });

  it('does NOT wrap an unrelated headless run', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ tmuxScope: 'all' }),
      headless: true,
      ...dims
    });
    expect(spawned[0].command).toBe('/bin/zsh');
  });

  it('the cc- session name embeds the real session id (reaper match key)', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ tmuxScope: 'all' }),
      ...dims
    });
    const ns = spawned[0].args.indexOf('new-session');
    expect(spawned[0].args[ns + 3]).toBe(`cc-${session.id}`);
  });

  it('preserves local tmux clients on shutdown while killing plain sessions', () => {
    ptys.create({
      projectId: 'p1', profile: 'shell', config: cfg({ tmuxScope: 'all' }), ...dims
    });
    ptys.create({
      projectId: 'p1', profile: 'shell', config: cfg(), ...dims
    });

    ptys.killAll({ preserveLocalTmux: true });

    expect(spawned[0].killed).toBe(false);
    expect(spawned[1].killed).toBe(true);
  });
});

describe('pty tmux wrapping (remote)', () => {
  let ptys: PtyManager;

  beforeEach(() => {
    spawned.length = 0;
    tmuxAvailable.mockReturnValue(true);
    ptys = new PtyManager();
  });

  it('wraps the remote login command in a tmux session honoring the compound shell command', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ tmuxScope: 'all' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    // ssh is the spawned command; argv is [...keepaliveOpts, '-t', target, remoteCmd].
    expect(spawned[0].command).toBe('ssh');
    const remoteCmd = spawned[0].args.at(-1) as string;
    // `-u` forces UTF-8 (remote login shell may be non-UTF-8, else multi-byte
    // chars render as "_"), then the title-forwarding `set … ';'` clauses so
    // remote agent-status detection works through tmux (mirrors the local wrap)…
    expect(remoteCmd.startsWith('tmux -u set -g set-titles on')).toBe(true);
    expect(remoteCmd).toContain("set -g set-titles-string '#T'");
    // …then tmux attach-or-create with our cc-<id> name…
    expect(remoteCmd).toContain(`new -A -s cc-${session.id} `);
    // …and the original `cd … && exec …` is preserved INSIDE a single quoted
    // token (so the remote tmux runs it via sh -c, honoring the &&).
    expect(remoteCmd).toContain('&&');
    expect(remoteCmd).toContain('/work/p1');
    expect(remoteCmd).toContain('exec');
  });

  it('wraps the remote login command when scope is "remote" (remote-only)', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ tmuxScope: 'remote' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).toContain(`new -A -s cc-${session.id} `);
  });

  it('adds SSH keepalive options so an idle link is not silently reaped', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ tmuxScope: 'all' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    const args = spawned[0].args;
    // Keepalives precede the `-t target cmd` triple (added regardless of tmux).
    expect(args).toContain('ServerAliveInterval=30');
    expect(args).toContain('ServerAliveCountMax=4');
    expect(args).toContain('TCPKeepAlive=yes');
    // The remote command is still the LAST element after the keepalive opts.
    expect(args.indexOf('-t')).toBeGreaterThan(args.indexOf('ServerAliveInterval=30'));
  });

  it('does NOT wrap a remote session when scope is unset (default)', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg(),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    expect(spawned[0].command).toBe('ssh');
    expect((spawned[0].args.at(-1) as string).startsWith('tmux ')).toBe(false);
  });

  it('does NOT wrap a remote session when scope is "off"', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ tmuxScope: 'off' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    expect(spawned[0].command).toBe('ssh');
    expect((spawned[0].args.at(-1) as string).startsWith('tmux ')).toBe(false);
  });

  it('cd-prefixes a remote with no remotePath to the global remoteDefaultPath', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ remoteDefaultPath: '/opt/workspace/core-public' }),
      remote: { host: 'devbox' }, // no per-project path
      ...dims
    });
    const remoteCmd = spawned[0].args.at(-1) as string;
    // The start path is shell-quoted, so the prefix is `cd '<path>' &&`.
    expect(remoteCmd).toContain("cd '/opt/workspace/core-public' &&");
  });

  it('per-project remotePath overrides the global remoteDefaultPath', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg({ remoteDefaultPath: '/opt/workspace/core-public' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).toContain("cd '/work/p1' &&");
    expect(remoteCmd).not.toContain('/opt/workspace/core-public');
    // The session still records the configured start path for display/restore;
    // TerminalView uploads relative to the canonical remote root.
    expect(session.cwd).toBe('/work/p1');
  });

  it('no cd prefix when neither remotePath nor remoteDefaultPath is set', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg(),
      remote: { host: 'devbox' },
      ...dims
    });
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).not.toContain('cd ');
    expect(remoteCmd).toContain('exec');
  });

  it('wraps OpenCode bootstrap in tmux without replaying its opening prompt outside the login shell', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'opencode',
      config: cfg({ tmuxScope: 'remote' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      extraArgs: ['--prompt', 'Reply exactly: remote-opencode-ok'],
      ...dims
    });
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).toContain(`new -A -s cc-${session.id} `);
    // tmux shell-quotes the complete bootstrap again, so inspect semantic tokens
    // rather than assuming its nested quote representation.
    expect(remoteCmd).toContain('bash');
    expect(remoteCmd).toContain('--prompt');
    expect(remoteCmd).toContain('remote-opencode-ok');
    // `new -A` runs its command only while creating this tmux session; an
    // attach reuses the live pane and cannot send the opening task again.
    expect((remoteCmd.match(/remote-opencode-ok/g) ?? [])).toHaveLength(1);
  });
});

describe('pty remote wake-reconnect', () => {
  let ptys: PtyManager;
  // A prior remote session's id — reused as the tmux session NAME so
  // `tmux new -A -s cc-<oldId>` re-attaches the still-live agent on the box.
  const oldId = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    spawned.length = 0;
    tmuxAvailable.mockReturnValue(true);
    ptys = new PtyManager();
  });

  it('re-attaches the OLD tmux session name and mints a FRESH local id', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'claude',
      config: cfg({ tmuxScope: 'all' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      reconnectTmuxId: oldId,
      resume: true,
      ...dims
    });
    // The new local pty gets a fresh id (NOT the old one) so a late onExit from
    // the dead proxy can't finalize this replacement.
    expect(session.id).not.toBe(oldId);
    // Remote command is the LAST ssh arg — the reverse-tunnel + keepalive opts
    // (`-o ServerAlive… -R <port> -t <host>`) now precede it, so it's no longer
    // at a fixed index. Matches the idiom used by the other remote tests above.
    const remoteCmd = spawned[0].args.at(-1) as string;
    // …but the tmux session NAME reuses the old id, so attach-or-create
    // re-attaches the live detached agent. The `new -A -s` is preceded by the
    // OSC-title `set -g` prelude (see wrapRemoteTmux), so match the substring
    // rather than the string start — same idiom as the reverse-tunnel tests above.
    expect(remoteCmd).toContain(`new -A -s cc-${oldId} `);
    // The stable tmux id is stamped on the session so a SECOND sleep can target
    // the same box session.
    expect(session.remoteTmuxId).toBe(oldId);
  });

  it('folds --continue into the remote claude argv on resume', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'claude',
      config: cfg({ tmuxScope: 'all' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      reconnectTmuxId: oldId,
      resume: true,
      ...dims
    });
    // Remote command is the LAST ssh arg — the reverse-tunnel + keepalive opts
    // (`-o ServerAlive… -R <port> -t <host>`) now precede it, so it's no longer
    // at a fixed index. Matches the idiom used by the other remote tests above.
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).toContain('--continue');
  });

  it('forces the tmux wrap on reconnect even if persistence is toggled OFF', () => {
    // The box session only exists because persistence was ON at first spawn;
    // re-attaching requires the wrap regardless of the current flag.
    const session = ptys.create({
      projectId: 'p1',
      profile: 'claude',
      config: cfg({ tmuxScope: 'off' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      reconnectTmuxId: oldId,
      resume: true,
      ...dims
    });
    // Remote command is the LAST ssh arg — the reverse-tunnel + keepalive opts
    // (`-o ServerAlive… -R <port> -t <host>`) now precede it, so it's no longer
    // at a fixed index. Matches the idiom used by the other remote tests above.
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).toContain(`new -A -s cc-${oldId} `);
    expect(session.remoteTmuxId).toBe(oldId);
  });

  it('ignores a non-UUID reconnect id (falls back to the fresh session id)', () => {
    // Renderer-supplied and flows into the tmux command string, so a non-UUID
    // must not be reused as the session name (shell-metachar injection guard).
    const session = ptys.create({
      projectId: 'p1',
      profile: 'claude',
      config: cfg({ tmuxScope: 'all' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      reconnectTmuxId: 'not-a-uuid; rm -rf ~',
      resume: true,
      ...dims
    });
    // Remote command is the LAST ssh arg — the reverse-tunnel + keepalive opts
    // (`-o ServerAlive… -R <port> -t <host>`) now precede it, so it's no longer
    // at a fixed index. Matches the idiom used by the other remote tests above.
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).not.toContain('rm -rf');
    // The tmux name falls back to the freshly-minted session id.
    expect(remoteCmd).toContain(`new -A -s cc-${session.id} `);
    expect(session.remoteTmuxId).toBe(session.id);
  });

  it('does not duplicate --continue when extraArgs already carries a resume flag', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'claude',
      config: cfg({ tmuxScope: 'all' }),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      reconnectTmuxId: oldId,
      resume: true,
      extraArgs: ['--continue'],
      ...dims
    });
    // Remote command is the LAST ssh arg — the reverse-tunnel + keepalive opts
    // (`-o ServerAlive… -R <port> -t <host>`) now precede it, so it's no longer
    // at a fixed index. Matches the idiom used by the other remote tests above.
    const remoteCmd = spawned[0].args.at(-1) as string;
    // Exactly one --continue, not two.
    const count = remoteCmd.split('--continue').length - 1;
    expect(count).toBe(1);
  });
});

describe('remote hooks over ssh -R reverse tunnel', () => {
  let ptys: PtyManager;

  beforeEach(() => {
    spawned.length = 0;
    tmuxAvailable.mockReturnValue(false); // isolate the hook wiring from tmux
    ptys = new PtyManager();
    // A non-null base URL is what arms remote hooks (the reverse tunnel maps a
    // remote loopback port back to THIS local port).
    ptys.setMcpBaseUrl('http://127.0.0.1:54321');
  });

  it('adds an -R reverse forward and bakes ZCC_* hook URLs into the remote claude command', () => {
    const session = ptys.create({
      projectId: 'proj-remote',
      profile: 'claude',
      config: cfg(),
      remote: { host: 'devbox', user: 'svc', remotePath: '/work/p1' },
      ...dims
    });
    const args = spawned[0].args;
    // The reverse forward is present and maps <remotePort>:127.0.0.1:54321.
    const rIdx = args.indexOf('-R');
    expect(rIdx).toBeGreaterThanOrEqual(0);
    expect(args[rIdx + 1]).toMatch(/^\d+:127\.0\.0\.1:54321$/);
    const remotePort = Number((args[rIdx + 1] as string).split(':')[0]);
    // The remote command exports the hook URLs pointed at that loopback port,
    // with the session id baked in (identity-in-URL, unforgeable).
    const remoteCmd = args.at(-1) as string;
    expect(remoteCmd).toContain(`ZCC_NOTIFY_URL='http://127.0.0.1:${remotePort}/hook/notify/proj-remote/${session.id}'`);
    expect(remoteCmd).toContain(`ZCC_SUBAGENT_URL='http://127.0.0.1:${remotePort}/hook/subagent/proj-remote/${session.id}'`);
    // Interactive sessions carry both lifecycle boundaries: UserPromptSubmit
    // begins a new turn and Stop marks the completed turn idle.
    expect(remoteCmd).toContain('ZCC_FIRSTPROMPT_URL=');
    expect(remoteCmd).toContain(`ZCC_HOOK_URL='http://127.0.0.1:${remotePort}/hook/stop/proj-remote/${session.id}'`);
    // The hook `--settings` JSON is spliced into claude's argv.
    expect(remoteCmd).toContain('--settings');
    expect(remoteCmd).toContain('Notification');
    // MCP is OFF by default (remoteMcpEnabled unset) — no --mcp-config, no inbox
    // tools, and the Overseer hook is never wired.
    expect(remoteCmd).not.toContain('--mcp-config');
    expect(remoteCmd).not.toContain('mcp__zcc-inbox__inbox_push');
    expect(remoteCmd).not.toContain('ZCC_OVERSEER_URL=');
  });

  it('marks the session with an optimistic remoteTunnel posture when the -R forward is wired', () => {
    const session = ptys.create({
      projectId: 'proj-remote',
      profile: 'claude',
      config: cfg(),
      remote: { host: 'devbox', user: 'svc', remotePath: '/work/p1' },
      ...dims
    });
    expect(session.remoteTunnel).toEqual({ ok: true });
  });

  it('leaves remoteTunnel absent for a plain shell remote (no tunnel requested)', () => {
    const session = ptys.create({
      projectId: 'proj-remote',
      profile: 'shell',
      config: cfg(),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    expect(session.remoteTunnel).toBeUndefined();
  });

  it('forwards MCP over the tunnel when remoteMcpEnabled: inline --mcp-config + inbox tools', () => {
    const session = ptys.create({
      projectId: 'proj-remote',
      profile: 'claude',
      config: cfg({ remoteMcpEnabled: true }),
      remote: { host: 'devbox', user: 'svc', remotePath: '/work/p1' },
      ...dims
    });
    const args = spawned[0].args;
    const rIdx = args.indexOf('-R');
    const remotePort = Number((args[rIdx + 1] as string).split(':')[0]);
    const remoteCmd = args.at(-1) as string;
    // Inline mcp-config pointed at the SAME loopback port the hooks use, with the
    // project + session ids baked into the path (identity-in-URL, unforgeable).
    expect(remoteCmd).toContain('--mcp-config');
    expect(remoteCmd).toContain(`http://127.0.0.1:${remotePort}/mcp/proj-remote/${session.id}`);
    expect(remoteCmd).toContain('mcp__zcc-inbox__inbox_push');
    // Overseer stays excluded even with MCP on.
    expect(remoteCmd).not.toContain('ZCC_OVERSEER_URL=');
  });

  it('does not wire remote hooks when the MCP server is not up', () => {
    ptys.setMcpBaseUrl(null);
    ptys.create({
      projectId: 'proj-remote',
      profile: 'claude',
      config: cfg(),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    const args = spawned[0].args;
    expect(args).not.toContain('-R');
    expect(args.at(-1) as string).not.toContain('ZCC_NOTIFY_URL=');
  });

  it('does not wire remote hooks for a plain shell profile', () => {
    ptys.create({
      projectId: 'proj-remote',
      profile: 'shell',
      config: cfg(),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    const args = spawned[0].args;
    expect(args).not.toContain('-R');
  });

  it('derives a distinct, stable, in-band remote port per session', () => {
    const a = remotePortForSession('11111111-1111-1111-1111-111111111111');
    const b = remotePortForSession('22222222-2222-2222-2222-222222222222');
    expect(a).not.toBe(b); // distinct sessions → distinct ports
    expect(a).toBe(remotePortForSession('11111111-1111-1111-1111-111111111111')); // stable
    for (const p of [a, b]) {
      expect(p).toBeGreaterThanOrEqual(49_200);
      expect(p).toBeLessThan(51_200);
    }
  });

  it('detects the ssh remote-forward-failure warning and extracts the listen port', () => {
    expect(
      detectRemoteForwardFailure('Warning: remote port forwarding failed for listen port 49999')
    ).toBe(49999);
    // Case-insensitive, embedded in a larger chunk.
    expect(
      detectRemoteForwardFailure('...\r\nWarning: Remote Port Forwarding Failed For Listen Port 50000\r\n$ ')
    ).toBe(50000);
    // Unrelated output → no match.
    expect(detectRemoteForwardFailure('Welcome to devbox\r\n$ ')).toBeNull();
  });
});

describe('remote session-id / resume parity', () => {
  let ptys: PtyManager;

  beforeEach(() => {
    spawned.length = 0;
    tmuxAvailable.mockReturnValue(false); // keep the remote command a bare `exec`
    ptys = new PtyManager();
  });

  it('mints + injects a stable --session-id and records it on the remote session', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'claude',
      config: cfg(),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    // The recovered id is stamped on the session (was permanently undefined
    // before the parity fix) so a relaunch can resume THIS conversation.
    expect(session.claudeSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // …and the same id is injected as `--session-id` into the remote claude argv
    // (each token is individually shell-quoted).
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).toContain(`'--session-id' '${session.claudeSessionId}'`);
  });

  it('does NOT inject a --session-id for a plain remote shell profile', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'shell',
      config: cfg(),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    expect(session.claudeSessionId).toBeUndefined();
    expect(spawned[0].args.at(-1) as string).not.toContain('--session-id');
  });

  it('does NOT mint when the caller pins a --resume id, and recovers that id', () => {
    const pinned = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const session = ptys.create({
      projectId: 'p1',
      profile: 'claude',
      config: cfg(),
      extraArgs: ['--resume', pinned],
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    // The pinned id is surfaced as the session's claudeSessionId (keeps the
    // resume chain stable across relaunches), and we never add a conflicting
    // second --session-id.
    expect(session.claudeSessionId).toBe(pinned);
    const remoteCmd = spawned[0].args.at(-1) as string;
    expect(remoteCmd).not.toContain('--session-id');
    expect(remoteCmd).toContain(`'--resume' '${pinned}'`);
  });

  it('does NOT mint for the claude-resume profile (caller owns the session)', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'claude-resume',
      config: cfg(),
      remote: { host: 'devbox', remotePath: '/work/p1' },
      ...dims
    });
    expect(session.claudeSessionId).toBeUndefined();
    expect(spawned[0].args.at(-1) as string).not.toContain('--session-id');
  });
});
