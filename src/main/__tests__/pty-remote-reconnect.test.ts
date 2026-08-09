import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake node-pty that lets a test drive the exit callback (simulating a dropped
// ssh link) and inspect how many times ssh was (re)spawned. Each spawn records
// its argv so we can assert the reattach reused the SAME command.
interface FakeProc {
  pid: number;
  command: string;
  args: string[];
  exitCb?: (e: { exitCode: number }) => void;
  dataCb?: (d: string) => void;
  write: (data: string) => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
  /** Fire the recorded exit handler as if the process died. */
  die: (code?: number) => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[]) => {
    const proc: FakeProc = {
      pid: 2000 + spawned.length,
      command,
      args,
      write() {},
      onData(cb: (d: string) => void) {
        this.dataCb = cb;
      },
      onExit(cb: (e: { exitCode: number }) => void) {
        this.exitCb = cb;
      },
      resize() {},
      kill() {
        this.exitCb?.({ exitCode: 0 });
      },
      die(code = 1) {
        this.exitCb?.({ exitCode: code });
      }
    };
    spawned.push(proc);
    return proc;
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

// tmux is "available" so the remote wrap (and thus the reattach recipe) arms.
vi.mock('../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux.js')>();
  return { ...actual, isTmuxAvailable: () => true };
});

// The liveness probe shells out via child_process.execFile('ssh', … tmux
// has-session …). Mock it so a test controls the verdict the reconnect timer
// sees: `probeError(null)` = session alive (exit 0), `probeError({code:1})` =
// gone, `probeError({code:255})`/`{killed:true}` = unknown. Default: alive.
let probeError: (Error & { code?: number | string; killed?: boolean }) | null = null;
const probeCalls: string[][] = [];
vi.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown) => void
  ) => {
    probeCalls.push(args);
    // Resolve on a microtask so it behaves like the async call it stands in for.
    Promise.resolve().then(() => cb(probeError));
    return { pid: 9999 } as unknown;
  }
}));

import { PtyManager } from '../pty.js';
import type { AppConfig, TerminalSession } from '../../shared/types.js';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  tmuxScope: 'all'
} as AppConfig;

function makeRemote(mgr: PtyManager): TerminalSession {
  return mgr.create({
    projectId: 'p1',
    profile: 'shell',
    cwd: '/work/p1',
    cols: 80,
    rows: 24,
    config: CONFIG,
    remote: { host: 'devbox', remotePath: '/work/p1' }
  });
}

describe('PtyManager remote auto-reconnect', () => {
  beforeEach(() => {
    spawned.length = 0;
    probeCalls.length = 0;
    probeError = null; // default: the liveness probe reports the session ALIVE
  });

  it('re-attaches the remote tmux session on an unexpected drop, keeping the id live', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeRemote(mgr);
      expect(spawned).toHaveLength(1);

      // Simulate a dropped ssh link (non-zero exit, not a user close).
      spawned[0].die(255);
      // The session must NOT be finalized — it's reconnecting.
      expect(mgr.list('p1').find((s) => s.id === session.id)?.status).toBe('starting');

      // Backoff elapses → the probe runs (alive) → a second ssh is spawned with
      // the SAME argv. advanceTimersByTimeAsync flushes the probe's microtask.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(spawned).toHaveLength(2);
      expect(spawned[1].command).toBe('ssh');
      expect(spawned[1].args).toEqual(spawned[0].args);
      expect(mgr.list('p1').find((s) => s.id === session.id)?.status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('finalizes (does NOT reconnect) when the probe reports the remote tmux session is gone', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeRemote(mgr);

      // The remote agent genuinely finished: ssh connects but tmux has-session
      // exits 1 (no such session). A blind reconnect would spawn a fresh
      // conversation — the probe must prevent that.
      probeError = Object.assign(new Error('no session'), { code: 1 });
      spawned[0].die(0); // remote command exited (agent done)
      await vi.advanceTimersByTimeAsync(1_000);

      // Probed once, no respawn, session finalized as exited.
      expect(probeCalls).toHaveLength(1);
      expect(probeCalls[0]).toEqual(
        expect.arrayContaining(['tmux', 'has-session', '-t', `cc-${session.id}`])
      );
      expect(spawned).toHaveLength(1);
      expect(mgr.list('p1').find((s) => s.id === session.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects when the probe is inconclusive (ssh unreachable) — fail-safe toward recovery', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeRemote(mgr);

      // Probe itself can't reach the host (ssh exit 255) → 'unknown'. We must
      // still attempt the reattach rather than kill a possibly-live session.
      probeError = Object.assign(new Error('ssh: connect timeout'), { code: 255 });
      spawned[0].die(255);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(spawned).toHaveLength(2);
      expect(mgr.list('p1').find((s) => s.id === session.id)?.status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the reconnect budget once the re-attached link streams data', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      makeRemote(mgr);

      // Drop, reconnect, then stream a byte (stability signal), repeated well
      // past the attempt budget — it must keep reconnecting because the counter
      // resets each time data flows.
      for (let i = 0; i < 10; i++) {
        spawned.at(-1)!.die(255);
        await vi.advanceTimersByTimeAsync(20_000); // beyond max backoff (+ probe)
        spawned.at(-1)!.dataCb?.('output'); // proves the link is stable again
      }
      // 1 initial + 10 reconnects, all live (never exhausted).
      expect(spawned).toHaveLength(11);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the attempt budget when reconnects never stabilize', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeRemote(mgr);

      // Crash-loop: die immediately after each (re)spawn, never streaming data.
      // The probe keeps reporting 'alive' (default), so only the budget stops it.
      for (let i = 0; i < 10; i++) {
        spawned.at(-1)!.die(255);
        await vi.advanceTimersByTimeAsync(20_000);
      }
      // 1 initial + at most REMOTE_REATTACH_MAX_ATTEMPTS (6) reconnects.
      expect(spawned.length).toBeLessThanOrEqual(1 + 6);
      // Session finalized as exited once the budget was spent.
      expect(mgr.list('p1').find((s) => s.id === session.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a manual close during backoff cancels the pending reconnect', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeRemote(mgr);

      spawned[0].die(255); // drop → schedules a reconnect
      mgr.close(session.id); // user closes the tab during the backoff
      await vi.advanceTimersByTimeAsync(60_000);

      // No re-attach spawned (not even a probe), and the session is gone.
      expect(spawned).toHaveLength(1);
      expect(probeCalls).toHaveLength(0);
      expect(mgr.list('p1').find((s) => s.id === session.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports remote tmux kill failure so ownership remains retryable', async () => {
    const mgr = new PtyManager();
    const session = makeRemote(mgr);
    probeError = Object.assign(new Error('ssh unavailable'), { code: 255 });
    await expect(mgr.killRemoteTmux(session.id)).resolves.toBe(false);
    expect(mgr.getSession(session.id)).not.toBeNull();

    probeError = null;
    await expect(mgr.killRemoteTmux(session.id)).resolves.toBe(true);
  });

  it('accepts an already-gone remote tmux session during close', async () => {
    const mgr = new PtyManager();
    const session = makeRemote(mgr);
    // The agent can finish between the close click and `tmux kill-session`.
    // Both kill-session and the follow-up has-session probe then return 1.
    probeError = Object.assign(new Error('no server running'), { code: 1 });

    await expect(mgr.killRemoteTmux(session.id)).resolves.toBe(true);
    expect(probeCalls).toHaveLength(2);
    expect(probeCalls[0]).toEqual(expect.arrayContaining(['tmux', 'kill-session', '-t', `cc-${session.id}`]));
    expect(probeCalls[1]).toEqual(expect.arrayContaining(['tmux', 'has-session', '-t', `cc-${session.id}`]));
  });

  it('does not reconnect when tmux teardown closes SSH before local close completes', async () => {
    const mgr = new PtyManager();
    const session = makeRemote(mgr);

    const killed = mgr.killRemoteTmux(session.id);
    // `tmux kill-session` can end the interactive SSH client before its command
    // reply reaches main. This must remain owned by the close request, not trigger
    // remote auto-reconnect.
    spawned[0].die(0);
    await expect(killed).resolves.toBe(true);

    expect(spawned).toHaveLength(1);
    expect(mgr.getSession(session.id)).not.toBeNull();
    expect(mgr.closeExpected(session.id)).toBe(true);
    expect(mgr.getSession(session.id)).toBeNull();
  });

  it('cancels a pending reconnect while remote tmux teardown is in flight', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeRemote(mgr);
      spawned[0].die(255); // arms reconnect backoff

      const killed = mgr.killRemoteTmux(session.id);
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(killed).resolves.toBe(true);

      expect(spawned).toHaveLength(1);
      expect(probeCalls).toHaveLength(1); // kill-session only; no reconnect probe
    } finally {
      vi.useRealTimers();
    }
  });

  it('reply() during the reconnect gap reaches the detached agent via tmux send-keys', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeRemote(mgr);

      // Drop link: session enters reconnect/backoff window.
      spawned[0].die(255);
      expect(mgr.list('p1').find((s) => s.id === session.id)?.status).toBe('starting');

      probeCalls.length = 0;
      expect(mgr.reply(session.id, 'do the thing')).toBe(true);
      await vi.advanceTimersByTimeAsync(0);

      const sendKeys = probeCalls.filter((a) => a.some((t) => t.includes('send-keys')));
      expect(sendKeys).toHaveLength(2);
      expect(sendKeys[0].at(-1)).toContain('send-keys');
      expect(sendKeys[0].at(-1)).toContain('-l');
      expect(sendKeys[0].at(-1)).toContain('do the thing');
      expect(sendKeys[0].at(-1)).toContain(`cc-${session.id}`);
      expect(sendKeys[1].at(-1)).toContain('Enter');
      expect(sendKeys[1].at(-1)).not.toContain('-l');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reply() on an attached remote writes to the pty, not send-keys', () => {
    const mgr = new PtyManager();
    const session = makeRemote(mgr);
    const proc = spawned[0];
    const writeSpy = vi.spyOn(proc, 'write');

    probeCalls.length = 0;
    expect(mgr.reply(session.id, 'hello')).toBe(true);

    expect(writeSpy).toHaveBeenCalledWith('hello');
    expect(probeCalls.filter((a) => a.some((t) => t.includes('send-keys')))).toHaveLength(0);
  });

  it('a scheduled remote run is NOT auto-reconnected (no tmux backing)', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = mgr.create({
        projectId: 'p1',
        profile: 'shell',
        cwd: '/work/p1',
        cols: 80,
        rows: 24,
        config: CONFIG,
        scheduled: true,
        remote: { host: 'devbox', remotePath: '/work/p1' }
      });

      spawned[0].die(255);
      await vi.advanceTimersByTimeAsync(60_000);

      // No reconnect; the session finalized as exited.
      expect(spawned).toHaveLength(1);
      expect(mgr.list('p1').find((s) => s.id === session.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
