import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake node-pty: a test drives onData (to stream the boot sentinel) and onExit,
// and each spawn records its argv so we can assert the sentinel was prepended to
// the remote command. Mirrors pty-remote-reconnect.test.ts.
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
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => []
}));

// tmux "available" so a non-headless remote arms the tmux wrap (the tmux-backed
// variation); headless spawns opt out regardless.
vi.mock('../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux.js')>();
  return { ...actual, isTmuxAvailable: () => true };
});

// The reap (and the reconnect liveness probe) shell out via execFile('ssh', …).
// Capture every call's argv so we can assert the SIGKILL-by-PID recipe, and let a
// test control the resolved error (null = success/exit 0).
let execError: (Error & { code?: number | string }) | null = null;
const execCalls: string[][] = [];
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: unknown) => void) => {
    execCalls.push(args);
    Promise.resolve().then(() => cb(execError));
    return { pid: 9999 } as unknown;
  }
}));

import { PtyManager } from '../pty.js';
import type { AppConfig, TerminalSession } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  tmuxScope: 'all'
} as AppConfig;

/** OSC boot sentinel the remote login shell prints (`ESC ] 6997 ; … BEL`). */
const sentinel = (pid: number | string): string => `\x1b]6997;zcc-remote-pid=${pid}\x07`;

/** A remote AGENT spawn (non-shell → reap-armed). `opencode` is the real orphan case. */
function makeRemoteAgent(mgr: PtyManager, over: Record<string, unknown> = {}): TerminalSession {
  return mgr.create({
    projectId: 'p1',
    profile: 'opencode',
    cwd: '/work/p1',
    cols: 80,
    rows: 24,
    config: CONFIG,
    remote: { host: 'devbox', remotePath: '/work/p1' },
    ...over
  });
}

/** The reap ssh call (its remote command SIGKILLs by pid), if one was made. */
function reapCall(): string[] | undefined {
  return execCalls.find((a) => a.at(-1)?.includes('kill -KILL'));
}

describe('PtyManager remote agent reap', () => {
  beforeEach(() => {
    spawned.length = 0;
    execCalls.length = 0;
    execError = null;
  });

  it('headless remote agent: captures the PID, strips the sentinel, SIGKILLs by PID on close', () => {
    const mgr = new PtyManager();
    const emitted: string[] = [];
    mgr.on('data', (_id: string, d: string) => emitted.push(d));
    const session = makeRemoteAgent(mgr, { headless: true });

    // Sentinel prepended to the remote command (last ssh arg); NOT tmux-wrapped.
    expect(spawned[0].args.at(-1)).toContain('zcc-remote-pid');
    expect(mgr.getSession(session.id)?.remoteTmuxId).toBeUndefined();

    // Boot sentinel streams interleaved with real output.
    spawned[0].dataCb?.(`starting…${sentinel(4242)}ready`);
    expect(mgr.getSession(session.id)?.remotePid).toBe(4242);
    expect(mgr.getRemoteReap(session.id)?.pid).toBe(4242);
    expect(mgr.getRemoteReap(session.id)?.tmux).toBe(false);

    // Close reaps the remote process by PID over a non-tty ssh (no `-t`); the
    // close also flushes the buffered output as one `data` event.
    mgr.close(session.id);

    // Sentinel escape sequence is stripped from the terminal stream.
    const stream = emitted.join('');
    expect(stream).toContain('starting…ready');
    expect(stream).not.toContain('zcc-remote-pid');

    const reap = reapCall();
    expect(reap).toBeTruthy();
    expect(reap!.at(-1)).toBe('kill -KILL -4242 2>/dev/null; kill -KILL 4242 2>/dev/null; true');
    expect(reap).toContain('devbox');
    expect(reap).toContain('BatchMode=yes');
    expect(reap).not.toContain('-t');
  });

  it('tmux-backed remote agent: reaps via the tmux SESSION on close (tmux swallows the sentinel → no pid)', () => {
    const mgr = new PtyManager();
    const session = makeRemoteAgent(mgr); // non-headless + tmuxScope 'all' → tmux-backed

    // The reap recipe carries the tmux session name (`cc-<id>`), recorded at
    // spawn — the reap ROUTE for a tmux-backed remote, since tmux swallows the
    // OSC boot sentinel and its `pid` never streams. Reapable immediately, no
    // wait on a byte that never comes.
    expect(mgr.getSession(session.id)?.remoteTmuxId).toBe(session.id);
    const reap = mgr.getRemoteReap(session.id);
    expect(reap?.tmux).toBe(true);
    expect(reap?.tmuxName).toBe(`cc-${session.id}`);
    expect(reap?.pid).toBeUndefined();

    // REALITY: NO sentinel is injected here (tmux would never forward it). The
    // reap must still fire — resolve the live pane pid on the box, SIGKILL its
    // group + the pid, then drop the tmux session. This is the regression the
    // fake-fixture E2E masked: tmux-backed coordinators were never reaped.
    mgr.close(session.id);
    const cmd = reapCall()?.at(-1);
    expect(cmd).toContain(`tmux list-panes -t cc-${session.id} -F '#{pane_pid}'`);
    expect(cmd).toContain('kill -KILL -"$p"');
    expect(cmd).toContain(`tmux kill-session -t cc-${session.id}`);
  });

  it('closeExpected() reaps too (auto-close / scheduled teardown path)', () => {
    const mgr = new PtyManager();
    const session = makeRemoteAgent(mgr, { headless: true });
    spawned[0].dataCb?.(sentinel(7777));

    expect(mgr.closeExpected(session.id)).toBe(true);
    expect(reapCall()?.at(-1)).toContain('kill -KILL -7777');
  });

  it('plain remote SHELL: no sentinel prepended, no capture, no reap (honors SIGHUP)', () => {
    const mgr = new PtyManager();
    const session = mgr.create({
      projectId: 'p1',
      profile: 'shell',
      cwd: '/work/p1',
      cols: 80,
      rows: 24,
      config: CONFIG,
      remote: { host: 'devbox', remotePath: '/work/p1' }
    });

    expect(spawned[0].args.at(-1)).not.toContain('zcc-remote-pid');
    expect(mgr.getRemoteReap(session.id)).toBeUndefined();

    // A sentinel-shaped byte on a shell session must not be captured.
    spawned[0].dataCb?.(sentinel(6666));
    expect(mgr.getSession(session.id)?.remotePid).toBeUndefined();

    mgr.close(session.id);
    expect(reapCall()).toBeUndefined();
  });

  it('ignores a malformed sentinel (pid <= 1) but still strips it', () => {
    const mgr = new PtyManager();
    const emitted: string[] = [];
    mgr.on('data', (_id: string, d: string) => emitted.push(d));
    const session = makeRemoteAgent(mgr, { headless: true });

    spawned[0].dataCb?.(`x${sentinel(1)}y`);
    expect(mgr.getSession(session.id)?.remotePid).toBeUndefined();
    expect(mgr.getRemoteReap(session.id)?.pid).toBeUndefined();

    // No PID → close cannot reap; close also flushes the buffered stream.
    mgr.close(session.id);
    expect(reapCall()).toBeUndefined();

    const stream = emitted.join('');
    expect(stream).toContain('xy');
    expect(stream).not.toContain('zcc-remote-pid');
  });

  it('captures the PID exactly once — a later sentinel does not overwrite it', () => {
    const mgr = new PtyManager();
    const session = makeRemoteAgent(mgr, { headless: true });

    spawned[0].dataCb?.(sentinel(4242));
    spawned[0].dataCb?.(sentinel(9999));
    expect(mgr.getSession(session.id)?.remotePid).toBe(4242);
    expect(mgr.getRemoteReap(session.id)?.pid).toBe(4242);
  });

  it('preserves the captured reap PID across an auto-reconnect', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeRemoteAgent(mgr); // tmux-backed → reconnectable
      spawned[0].dataCb?.(sentinel(4242));
      expect(mgr.getRemoteReap(session.id)?.pid).toBe(4242);

      spawned[0].die(255); // dropped link
      await vi.advanceTimersByTimeAsync(1_000); // probe (alive) → respawn
      expect(spawned).toHaveLength(2);
      // The reattach re-attaches the existing tmux pane (no fresh sentinel), so the
      // PID must survive the rebind to stay reapable.
      expect(mgr.getRemoteReap(session.id)?.pid).toBe(4242);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('boot sentinel split across PTY chunk boundaries', () => {
    it('captures the PID when the sentinel straddles two chunks and never leaks a fragment', () => {
      const mgr = new PtyManager();
      const emitted: string[] = [];
      mgr.on('data', (_id: string, d: string) => emitted.push(d));
      const session = makeRemoteAgent(mgr, { headless: true });

      const full = `pre${sentinel(4242)}post`;
      const cut = 6; // mid-way through the OSC escape
      spawned[0].dataCb?.(full.slice(0, cut)); // trailing partial held back
      expect(mgr.getSession(session.id)?.remotePid).toBeUndefined();
      spawned[0].dataCb?.(full.slice(cut)); // completes the sentinel
      expect(mgr.getSession(session.id)?.remotePid).toBe(4242);
      expect(mgr.getRemoteReap(session.id)?.pid).toBe(4242);

      mgr.close(session.id);
      const stream = emitted.join('');
      expect(stream).toBe('prepost');
      expect(stream).not.toContain('zcc-remote-pid');
      expect(stream).not.toContain('\x1b]6997');
    });

    it('captures the PID when the sentinel is streamed one byte at a time', () => {
      const mgr = new PtyManager();
      const emitted: string[] = [];
      mgr.on('data', (_id: string, d: string) => emitted.push(d));
      const session = makeRemoteAgent(mgr, { headless: true });

      for (const ch of `A${sentinel(4242)}B`) spawned[0].dataCb?.(ch);
      expect(mgr.getSession(session.id)?.remotePid).toBe(4242);

      mgr.close(session.id);
      const stream = emitted.join('');
      expect(stream).toBe('AB');
      expect(stream).not.toContain('zcc-remote-pid');
    });

    it('captures the first PID when two sentinels arrive in one chunk and strips both', () => {
      const mgr = new PtyManager();
      const emitted: string[] = [];
      mgr.on('data', (_id: string, d: string) => emitted.push(d));
      const session = makeRemoteAgent(mgr, { headless: true });

      spawned[0].dataCb?.(`a${sentinel(111)}b${sentinel(222)}c`);
      expect(mgr.getSession(session.id)?.remotePid).toBe(111);
      expect(mgr.getRemoteReap(session.id)?.pid).toBe(111);

      mgr.close(session.id);
      const stream = emitted.join('');
      expect(stream).toBe('abc');
      expect(stream).not.toContain('zcc-remote-pid');
    });

    it('does not swallow real output when a sentinel-prefix-shaped run never completes', () => {
      const mgr = new PtyManager();
      const emitted: string[] = [];
      mgr.on('data', (_id: string, d: string) => emitted.push(d));
      const session = makeRemoteAgent(mgr, { headless: true });

      // Chunk ends with a proper prefix of the head → held as a maybe-sentinel.
      spawned[0].dataCb?.('hello\x1b]6997');
      // …but the next bytes prove it was NOT a sentinel; the held run must be
      // released back into the stream, not dropped.
      spawned[0].dataCb?.('bar');
      expect(mgr.getSession(session.id)?.remotePid).toBeUndefined();

      mgr.close(session.id);
      const stream = emitted.join('');
      expect(stream).toContain('hello');
      expect(stream).toContain('bar');
      expect(stream).toContain('\x1b]6997bar');
    });

    it('releases the held partial on close so a dangling fragment never leaks', () => {
      const mgr = new PtyManager();
      const emitted: string[] = [];
      mgr.on('data', (_id: string, d: string) => emitted.push(d));
      const session = makeRemoteAgent(mgr, { headless: true });

      // Head + digits but the terminating BEL never arrives before the stream ends.
      spawned[0].dataCb?.('data\x1b]6997;zcc-remote-pid=42');
      expect(mgr.getRemoteReap(session.id)?.pidCarry).toBe('\x1b]6997;zcc-remote-pid=42');
      expect(mgr.getSession(session.id)?.remotePid).toBeUndefined();

      mgr.close(session.id);
      // Live entry gone (carry released with it); the never-completed partial was
      // held back and never forwarded.
      expect(mgr.getRemoteReap(session.id)).toBeUndefined();
      const stream = emitted.join('');
      expect(stream).toContain('data');
      expect(stream).not.toContain('zcc-remote-pid');
    });

    it('holds a head + digit run at the carry cap boundary but forwards the preceding output', () => {
      const mgr = new PtyManager();
      const emitted: string[] = [];
      mgr.on('data', (_id: string, d: string) => emitted.push(d));
      const session = makeRemoteAgent(mgr, { headless: true });

      // The head is 22 bytes and the cap allows 20 more, so a head + exactly 20
      // digits (no terminating BEL yet) sits AT the bound and is still held as a
      // maybe-sentinel; the ordinary output before it is forwarded immediately.
      const atCap = '1'.repeat(20);
      spawned[0].dataCb?.(`x\x1b]6997;zcc-remote-pid=${atCap}`);
      expect(mgr.getRemoteReap(session.id)?.pidCarry).toBe(`\x1b]6997;zcc-remote-pid=${atCap}`);
      expect(mgr.getSession(session.id)?.remotePid).toBeUndefined();

      mgr.close(session.id);
      // The 'x' before the head was forwarded; the held partial was released on
      // close and never leaked into the stream.
      const stream = emitted.join('');
      expect(stream).toBe('x');
    });

    it('gives up (never grows the carry unbounded) on a head + digit run past the cap', () => {
      const mgr = new PtyManager();
      const emitted: string[] = [];
      mgr.on('data', (_id: string, d: string) => emitted.push(d));
      const session = makeRemoteAgent(mgr, { headless: true });

      // A hostile/garbled stream that emits the head then an unbounded digit run
      // and never a BEL must NOT grow the per-session carry buffer without limit
      // (Rule 5): once past the cap the partial is given up and forwarded, so the
      // carry stays empty and the bytes are not swallowed.
      const overCap = '9'.repeat(64);
      spawned[0].dataCb?.(`out\x1b]6997;zcc-remote-pid=${overCap}`);
      expect(mgr.getSession(session.id)?.remotePid).toBeUndefined();
      expect(mgr.getRemoteReap(session.id)?.pidCarry).toBeUndefined();

      // Feed a genuine sentinel afterwards: the over-cap run was forwarded, not
      // carried, so it cannot fuse with later bytes into a capture.
      spawned[0].dataCb?.(sentinel(4242));
      expect(mgr.getSession(session.id)?.remotePid).toBe(4242);

      mgr.close(session.id);
      const stream = emitted.join('');
      expect(stream).toContain('out');
      expect(stream).toContain(overCap);
      expect(stream).not.toContain('zcc-remote-pid=4242');
    });
  });

  describe('reapRemoteProcess() validation', () => {
    it('rejects a missing / invalid pid without shelling out', async () => {
      const mgr = new PtyManager();
      await expect(mgr.reapRemoteProcess({ target: 'devbox', probeOpts: [], pid: undefined })).resolves.toBe(false);
      await expect(mgr.reapRemoteProcess({ target: 'devbox', probeOpts: [], pid: 1 })).resolves.toBe(false);
      await expect(mgr.reapRemoteProcess({ target: 'devbox', probeOpts: [], pid: 0 })).resolves.toBe(false);
      expect(execCalls).toHaveLength(0);
    });

    it('rejects a target that could be read as an ssh flag', async () => {
      const mgr = new PtyManager();
      await expect(mgr.reapRemoteProcess({ target: '-oProxyCommand=evil', probeOpts: [], pid: 42 })).resolves.toBe(false);
      expect(execCalls).toHaveLength(0);
    });

    it('builds the SIGKILL argv with the recorded probe opts and resolves on success', async () => {
      const mgr = new PtyManager();
      await expect(
        mgr.reapRemoteProcess({ target: 'user@box', probeOpts: ['-o', 'ServerAliveInterval=30'], pid: 42 })
      ).resolves.toBe(true);
      expect(execCalls.at(-1)).toEqual([
        '-o', 'ServerAliveInterval=30',
        '-o', 'BatchMode=yes',
        'user@box',
        'kill -KILL -42 2>/dev/null; kill -KILL 42 2>/dev/null; true'
      ]);
    });

    it('resolves false when the reap ssh errors (already-dead handled by `; true` remotely)', async () => {
      const mgr = new PtyManager();
      execError = Object.assign(new Error('ssh unreachable'), { code: 255 });
      await expect(mgr.reapRemoteProcess({ target: 'box', probeOpts: [], pid: 42 })).resolves.toBe(false);
    });

    it('reaps a tmux-backed recipe by resolving the pane pid, then dropping the session', async () => {
      const mgr = new PtyManager();
      await expect(
        mgr.reapRemoteProcess({ target: 'user@box', probeOpts: ['-o', 'ServerAliveInterval=30'], tmuxName: 'cc-abc-123' })
      ).resolves.toBe(true);
      const args = execCalls.at(-1)!;
      expect(args.slice(0, 5)).toEqual(['-o', 'ServerAliveInterval=30', '-o', 'BatchMode=yes', 'user@box']);
      expect(args.at(-1)).toBe(
        "p=$(tmux list-panes -t cc-abc-123 -F '#{pane_pid}' 2>/dev/null | head -1); " +
          '[ -n "$p" ] && { kill -KILL -"$p" 2>/dev/null; kill -KILL "$p" 2>/dev/null; }; ' +
          'tmux kill-session -t cc-abc-123 2>/dev/null; true'
      );
    });

    it('rejects a tmux name outside the `cc-` shape without shelling out (no metachar injection)', async () => {
      const mgr = new PtyManager();
      await expect(mgr.reapRemoteProcess({ target: 'box', probeOpts: [], tmuxName: 'cc-a; rm -rf ~' })).resolves.toBe(false);
      await expect(mgr.reapRemoteProcess({ target: 'box', probeOpts: [], tmuxName: 'evil' })).resolves.toBe(false);
      expect(execCalls).toHaveLength(0);
    });

    it('prefers the tmux route over a pid when both are present (tmux reap is more thorough)', async () => {
      const mgr = new PtyManager();
      await mgr.reapRemoteProcess({ target: 'box', probeOpts: [], pid: 42, tmuxName: 'cc-xy' });
      expect(execCalls.at(-1)?.at(-1)).toContain('tmux kill-session -t cc-xy');
      expect(execCalls.at(-1)?.at(-1)).not.toContain('kill -KILL 42');
    });
  });
});
