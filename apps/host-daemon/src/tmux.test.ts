import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:child_process so the probe/reaper don't actually shell out.
const execFileSyncMock = vi.fn();
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args)
}));

import {
  tmuxSessionName,
  buildLocalTmuxCommand,
  wrapRemoteTmux,
  isTmuxAvailable,
  resetTmuxAvailabilityCache,
  verifyTmux,
  reapOrphanTmuxSessions,
  TMUX_SESSION_PREFIX
} from './tmux.js';

describe('tmux helpers (pure)', () => {
  it('names sessions with the cc- prefix', () => {
    expect(tmuxSessionName('abc')).toBe('cc-abc');
    expect(TMUX_SESSION_PREFIX).toBe('cc-');
  });

  it('reports installed tmux version for Settings', () => {
    execFileSyncMock.mockReturnValue('tmux 3.6a\n');
    expect(verifyTmux()).toEqual({ installed: true, version: 'tmux 3.6a', installHint: 'brew install tmux' });
  });

  it('reports actionable missing tmux status without throwing', () => {
    execFileSyncMock.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(verifyTmux()).toEqual({ installed: false, installHint: 'brew install tmux' });
  });

  it('buildLocalTmuxCommand wraps command + args in new-session -A -s <name> --', () => {
    const { command, args } = buildLocalTmuxCommand('sess-1', 'claude', ['--model', 'opus']);
    expect(command).toBe('tmux');
    // `-u` forces UTF-8 (the app spawns tmux under a non-UTF-8 locale, so
    // without it multi-byte chars render as "_"); it MUST lead the argv. The
    // following `set -g …` clauses (chained with literal `;`) configure
    // OSC-title forwarding so agent-status detection works through tmux, plus
    // `mouse on` so the wheel scrolls tmux's scrollback instead of being turned
    // into arrow keys; see buildLocalTmuxCommand. The new-session follows.
    expect(args).toEqual([
      '-u',
      'set', '-g', 'set-titles', 'on', ';',
      'set', '-g', 'set-titles-string', '#T', ';',
      'set', '-ga', 'terminal-overrides', ',*:tsl=\\E]2;:fsl=\\007', ';',
      'set', '-g', 'mouse', 'on', ';',
      'new-session', '-A', '-s', 'cc-sess-1', '--', 'claude', '--model', 'opus'
    ]);
  });

  it('buildLocalTmuxCommand still ends with the new-session + wrapped command', () => {
    const { args } = buildLocalTmuxCommand('sess-1', 'claude', ['--model', 'opus']);
    const ns = args.indexOf('new-session');
    expect(ns).toBeGreaterThan(0);
    expect(args.slice(ns)).toEqual(['new-session', '-A', '-s', 'cc-sess-1', '--', 'claude', '--model', 'opus']);
  });

  it('buildLocalTmuxCommand passes session-scoped env via new-session -e (no leak across sessions)', () => {
    // Regression: the tmux server snapshots the FIRST client's env as its
    // server-global env, so later sessions would inherit the first session's
    // ZCC_* hook URLs without an explicit per-session override. Each defined
    // var must appear as `-e KEY=VAL` between the session name and `--`.
    const { args } = buildLocalTmuxCommand('sess-1', 'claude', [], {
      ZCC_FIRSTPROMPT_URL: 'http://x/firstprompt/p/sess-1',
      ZCC_SUBAGENT_URL: 'http://x/subagent/p/sess-1',
      ZCC_MISSING: undefined // undefined vars are skipped, not emitted as "=undefined"
    });
    const ns = args.indexOf('new-session');
    const dd = args.indexOf('--');
    const between = args.slice(ns, dd);
    expect(between).toContain('-e');
    expect(between).toContain('ZCC_FIRSTPROMPT_URL=http://x/firstprompt/p/sess-1');
    expect(between).toContain('ZCC_SUBAGENT_URL=http://x/subagent/p/sess-1');
    // undefined values are omitted entirely
    expect(args.some((a) => a.includes('ZCC_MISSING'))).toBe(false);
    // -e flags sit AFTER the session name and BEFORE the `--` terminator
    expect(ns).toBeGreaterThanOrEqual(0);
    expect(dd).toBeGreaterThan(ns);
  });

  it('wrapRemoteTmux passes the quoted inner command as tmux shell-command (no --)', () => {
    // The caller hands a single shell-quoted token; tmux runs it via sh -c.
    // The leading `set … ';'` clauses forward the pane's OSC title so remote
    // agent-status detection works through tmux (mirrors buildLocalTmuxCommand),
    // then the `new -A -s` shell-command follows.
    expect(wrapRemoteTmux('sess-2', "'cd /p && exec claude'")).toBe(
      "tmux -u set -g set-titles on ';' " +
        "set -g set-titles-string '#T' ';' " +
        "set -ga terminal-overrides ',*:tsl=\\E]2;:fsl=\\007' ';' " +
        "set -g mouse on ';' " +
        "new -A -s cc-sess-2 'cd /p && exec claude'"
    );
  });

  it('enables tmux mouse mode so the wheel scrolls the pane instead of sending arrow keys', () => {
    // Regression guard for the tmux scroll bug: without `set -g mouse on`, a
    // tmux pane reads to xterm.js as a no-scrollback alternate buffer, so wheel
    // notches become Up/Down arrow keys that navigate the inner program's
    // history/messages instead of scrolling the terminal. Both the local argv
    // and the remote command string MUST enable mouse mode.
    const local = buildLocalTmuxCommand('sess-1', 'claude', []);
    // Present as the argv triple `set -g mouse on`, before the new-session.
    const m = local.args.indexOf('mouse');
    expect(m).toBeGreaterThan(0);
    expect(local.args.slice(m - 2, m + 2)).toEqual(['set', '-g', 'mouse', 'on']);
    expect(m).toBeLessThan(local.args.indexOf('new-session'));

    const remote = wrapRemoteTmux('sess-2', "'x'");
    expect(remote).toContain('set -g mouse on');
    // …and it comes before the attach-or-create (part of the option prelude).
    expect(remote.indexOf('set -g mouse on')).toBeLessThan(remote.indexOf('new -A -s'));
  });

  it('wrapRemoteTmux title-forwarding clauses match the local builder (same three options)', () => {
    // Regression guard for the remote-status bug: the remote wrapper MUST set
    // the same set-titles / set-titles-string / terminal-overrides options the
    // local builder sets, or every remote agent reads as "Idle" through tmux.
    const remote = wrapRemoteTmux('sess-3', "'x'");
    expect(remote).toContain('set -g set-titles on');
    expect(remote).toContain("set -g set-titles-string '#T'");
    expect(remote).toContain("set -ga terminal-overrides ',*:tsl=\\E]2;:fsl=\\007'");
    // …and the attach-or-create still names our cc-<id> session.
    expect(remote).toContain('new -A -s cc-sess-3');
  });

  it('forces UTF-8 with -u so multi-byte characters do not render as "_"', () => {
    // Regression guard for the encoding bug: the app spawns tmux under a
    // non-UTF-8 locale (Electron launched from Finder has an empty LANG → C
    // locale), so without `-u` the attached client sets client_utf8=0 and
    // renders every multi-byte char (é, ü, …) as "_". `-u` forces UTF-8. It
    // MUST be the first token, before any set/new-session subcommand.
    const local = buildLocalTmuxCommand('sess-1', 'claude', []);
    expect(local.args[0]).toBe('-u');
    expect(local.args.indexOf('-u')).toBeLessThan(local.args.indexOf('new-session'));

    const remote = wrapRemoteTmux('sess-2', "'x'");
    expect(remote.startsWith('tmux -u ')).toBe(true);
    expect(remote.indexOf('-u')).toBeLessThan(remote.indexOf('new -A -s'));
  });
});

describe('isTmuxAvailable', () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    resetTmuxAvailabilityCache();
    execFileSyncMock.mockReset();
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    resetTmuxAvailabilityCache();
  });

  it('is false on win32 without probing', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(isTmuxAvailable(true)).toBe(false);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('is true when `tmux -V` succeeds', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    execFileSyncMock.mockReturnValue('tmux 3.4');
    expect(isTmuxAvailable(true)).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledWith('tmux', ['-V'], expect.anything());
  });

  it('is false when the binary is missing (throws)', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    execFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(isTmuxAvailable(true)).toBe(false);
  });

  it('caches the result (no second probe without force)', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    execFileSyncMock.mockReturnValue('tmux 3.4');
    expect(isTmuxAvailable(true)).toBe(true);
    expect(isTmuxAvailable()).toBe(true); // cached
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });
});

describe('reapOrphanTmuxSessions', () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    execFileMock.mockReset();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
  });

  /** Wire execFile so `ls` returns the given names and kill-session succeeds. */
  function mockTmux(sessionNames: string[]) {
    execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, out: string) => void) => {
      if (args[0] === 'ls') {
        cb(null, sessionNames.join('\n') + '\n');
      } else {
        cb(null, ''); // kill-session
      }
    });
  }

  it('kills cc-* sessions with no live pty, keeps the live ones', async () => {
    mockTmux(['cc-alive', 'cc-orphan', 'other-tool-session']);
    const live = new Set(['alive']);
    const reaped = await reapOrphanTmuxSessions((id) => live.has(id));

    // Only cc-orphan is reaped: cc-alive is live, other-tool-session isn't ours.
    expect(reaped).toEqual(['orphan']);
    const killCalls = execFileMock.mock.calls.filter((c) => c[1][0] === 'kill-session');
    expect(killCalls).toHaveLength(1);
    expect(killCalls[0][1]).toEqual(['kill-session', '-t', 'cc-orphan']);
  });

  it('reaps nothing when every cc- session is live', async () => {
    mockTmux(['cc-a', 'cc-b']);
    const reaped = await reapOrphanTmuxSessions(() => true);
    expect(reaped).toEqual([]);
    expect(execFileMock.mock.calls.filter((c) => c[1][0] === 'kill-session')).toHaveLength(0);
  });

  it('returns [] when tmux has no server running (ls errors)', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, out: string) => void) => {
      cb(new Error('no server running'), '');
    });
    expect(await reapOrphanTmuxSessions(() => false)).toEqual([]);
  });

  it('is a no-op on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(await reapOrphanTmuxSessions(() => false)).toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
