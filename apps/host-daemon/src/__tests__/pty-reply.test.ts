import { describe, it, expect, vi, beforeEach } from 'vitest';

// PtyManager imports node-pty, which spawns real subprocesses. Mock it with a
// fake IPty that records writes, so we can assert what `reply` sends without
// launching a shell. Each spawned proc keeps its own write log.
interface FakeProc {
  pid: number;
  writes: string[];
  exitCb?: (e: { exitCode: number }) => void;
  write: (data: string) => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: 1000 + spawned.length,
      writes: [],
      write(data: string) {
        this.writes.push(data);
      },
      onData() {
        // no-op; reply tests don't exercise the data stream
      },
      onExit(cb: (e: { exitCode: number }) => void) {
        // Record the handler so kill() can drive the exit path, which is what
        // removes the session from PtyManager's live map.
        this.exitCb = cb;
      },
      resize() {},
      kill() {
        this.exitCb?.({ exitCode: 0 });
      }
    };
    spawned.push(proc);
    return proc;
  }
}));

// mcp-config touches no electron APIs, but mock it so a claude-profile spawn
// in this suite never writes a real ~/.zcc/mcp file. Mirror the exports
// pty.ts actually imports (the sync ensure), returning a throwaway path.
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
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

describe('PtyManager.reply', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('writes the body first, then the carriage return as a deferred write', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeSession(mgr);
      const proc = spawned[0];

      const ok = mgr.reply(session.id, 'yes, proceed');

      // Body lands synchronously; the CR is held back so the TUI doesn't
      // coalesce it into the paste buffer and swallow the submit.
      expect(ok).toBe(true);
      expect(proc.writes).toEqual(['yes, proceed']);

      vi.runAllTimers();
      expect(proc.writes).toEqual(['yes, proceed', '\r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves multi-line reply bodies, with a single trailing CR', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeSession(mgr);
      const proc = spawned[0];

      mgr.reply(session.id, 'line one\nline two');
      vi.runAllTimers();

      expect(proc.writes).toEqual(['line one\nline two', '\r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the deferred CR when the session exits during the delay', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeSession(mgr);
      const proc = spawned[0];

      mgr.reply(session.id, 'too late');
      mgr.close(session.id);
      vi.runAllTimers();

      // Body was written, but the CR is dropped because the pty is gone.
      expect(proc.writes).toEqual(['too late']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes an expected close to exit code zero when the harness kill exits non-zero', () => {
    const mgr = new PtyManager();
    const session = makeSession(mgr);
    const exits: Array<[string, number]> = [];
    mgr.on('exit', (id: string, code: number) => exits.push([id, code]));

    spawned[0].exitCb?.({ exitCode: 1 });
    expect(exits).toEqual([[session.id, 1]]);

    const expected = makeSession(mgr);
    mgr.on('exit', (id: string, code: number) => {
      if (id === expected.id) exits.push([id, code]);
    });
    spawned[1].kill = () => spawned[1].exitCb?.({ exitCode: 1 });

    expect(mgr.closeExpected(expected.id)).toBe(true);
    expect(exits).toContainEqual([expected.id, 0]);
  });

  it('returns false and writes nothing when the session is unknown', () => {
    const mgr = new PtyManager();
    makeSession(mgr);
    const proc = spawned[0];

    const ok = mgr.reply('no-such-session', 'hello');

    expect(ok).toBe(false);
    expect(proc.writes).toEqual([]);
  });
});
