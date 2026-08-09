import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake IPty (same shape as pty-live-cap.test.ts) so we can spawn "sessions"
// without launching real subprocesses. Each carries a controllable `pid`; the
// reaper probes it with process.kill(pid, 0), which we stub below so the test
// decides which pids are "alive" — independent of the host's real process
// table.
interface FakeProc {
  pid: number;
  destroyed: number;
  exitCb?: (e: { exitCode: number }) => void;
  write: (data: string) => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
  destroy: () => void;
}

const spawned: FakeProc[] = [];
let nextPid = 5000;

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: nextPid++,
      destroyed: 0,
      write() {},
      onData() {},
      onExit(cb: (e: { exitCode: number }) => void) {
        this.exitCb = cb;
      },
      resize() {},
      kill() {
        this.exitCb?.({ exitCode: 0 });
      },
      destroy() {
        this.destroyed++;
      }
    };
    spawned.push(proc);
    return proc;
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '../../shared/types.js';

const MAX_LIVE_SESSIONS = 8;

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  maxLiveSessions: MAX_LIVE_SESSIONS
};

function makeSession(mgr: PtyManager) {
  return mgr.create({
    projectId: 'p1',
    profile: 'shell',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    config: CONFIG
  });
}

describe('PtyManager.reapDeadSessions', () => {
  beforeEach(() => {
    spawned.length = 0;
    nextPid = 5000;
    vi.restoreAllMocks();
  });

  it('reaps a session whose process is gone (ESRCH) and frees its slot', () => {
    const mgr = new PtyManager();
    const a = makeSession(mgr);
    const b = makeSession(mgr);
    expect(mgr.liveCount()).toBe(2);

    // Process `a` is gone, `b` is alive: kill(pid,0) throws ESRCH for a only.
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === a.pid) {
        const err = new Error('no such process') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      }
      return true; // b is alive
    });

    const exits: string[] = [];
    mgr.on('exit', (id: string) => exits.push(id));

    const reaped = mgr.reapDeadSessions();

    expect(reaped).toEqual([a.id]);
    expect(exits).toEqual([a.id]); // teardown emitted exit for the dead one
    expect(mgr.liveCount()).toBe(1); // slot freed
    expect(mgr.getSession(a.id)).toBeNull();
    expect(mgr.getSession(b.id)).not.toBeNull();
    // The reaped session's `onExit` was LOST (that's why the reaper found it),
    // so node-pty never released the master /dev/ptmx fd on its own —
    // finalizeExit MUST destroy() the proc or the fd leaks until we hit the
    // macOS ptmx cap and every future spawn throws "posix_spawnp failed."
    expect(spawned.find((p) => p.pid === a.pid)?.destroyed).toBe(1);
    // The still-alive session must NOT be destroyed.
    expect(spawned.find((p) => p.pid === b.pid)?.destroyed).toBe(0);
    killSpy.mockRestore();
  });

  it('does NOT reap a session owned by another uid (EPERM = alive)', () => {
    // A reused pid now owned by a different user yields EPERM, not ESRCH. We
    // must treat that as alive — reaping it would wrongly free the slot.
    const mgr = new PtyManager();
    const a = makeSession(mgr);

    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('operation not permitted') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });

    expect(mgr.reapDeadSessions()).toEqual([]);
    expect(mgr.liveCount()).toBe(1);
    expect(mgr.getSession(a.id)).not.toBeNull();
  });

  it('is a no-op when every process is alive', () => {
    const mgr = new PtyManager();
    makeSession(mgr);
    makeSession(mgr);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    expect(mgr.reapDeadSessions()).toEqual([]);
    expect(mgr.liveCount()).toBe(2);
  });

  it('does not double-fire exit for a session that already exited normally', () => {
    const mgr = new PtyManager();
    makeSession(mgr);
    // Normal exit removes it from the live map first.
    spawned[0].kill();
    expect(mgr.liveCount()).toBe(0);

    const killSpy = vi.spyOn(process, 'kill');
    expect(mgr.reapDeadSessions()).toEqual([]);
    // Nothing left to probe — kill is never called.
    expect(killSpy).not.toHaveBeenCalled();
  });
});
