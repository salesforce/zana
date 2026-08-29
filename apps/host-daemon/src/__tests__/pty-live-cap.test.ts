import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake IPty (same shape as pty-reply.test.ts / pty-data-batching.test.ts) so we
// can spawn many "sessions" without launching real subprocesses, and drive the
// exit path via kill() to free a live slot.
interface FakeProc {
  pid: number;
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
      pid: 3000 + spawned.length,
      write() {},
      onData() {
        // no-op; the cap path doesn't exercise the data stream
      },
      onExit(cb: (e: { exitCode: number }) => void) {
        // Record so kill() can drive onExit, which deletes the session from
        // PtyManager's live map and frees a cap slot.
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

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

// The live cap is now memory-aware (derived from RAM) unless the config pins it
// explicitly. Pin it here so the test is deterministic regardless of the host
// machine's RAM — exercising the cap-enforcement path, not the derivation
// (which has its own unit test).
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

describe('PtyManager live-session cap', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('allows sessions up to the cap, then throws on the next create', () => {
    const mgr = new PtyManager();

    // Fill exactly to the cap — every one of these must succeed.
    for (let i = 0; i < MAX_LIVE_SESSIONS; i += 1) {
      expect(() => makeSession(mgr)).not.toThrow();
    }
    expect(mgr.liveCount()).toBe(MAX_LIVE_SESSIONS);

    // The (cap+1)th create must FAIL CLEANLY — a thrown Error, not a silent
    // drop — and must not have spawned another proc.
    const before = spawned.length;
    expect(() => makeSession(mgr)).toThrow(/live-session cap/i);
    expect(spawned.length).toBe(before);
    expect(mgr.liveCount()).toBe(MAX_LIVE_SESSIONS);
  });

  it('frees a slot when a session exits, letting a new create succeed', () => {
    const mgr = new PtyManager();
    for (let i = 0; i < MAX_LIVE_SESSIONS; i += 1) makeSession(mgr);
    expect(mgr.liveCount()).toBe(MAX_LIVE_SESSIONS);

    // At the cap: next create throws.
    expect(() => makeSession(mgr)).toThrow(/live-session cap/i);

    // Exit one session (drives onExit → deletes from the live map).
    spawned[0].kill();
    expect(mgr.liveCount()).toBe(MAX_LIVE_SESSIONS - 1);

    // The freed slot is immediately reusable — create now succeeds.
    expect(() => makeSession(mgr)).not.toThrow();
    expect(mgr.liveCount()).toBe(MAX_LIVE_SESSIONS);
  });

  it('counts headless / scheduled sessions toward the cap', () => {
    // Headless + scheduled spawns consume the same process + fd, so they must
    // not be exempt — the cap exists precisely to bound unattended fan-out.
    const mgr = new PtyManager();
    for (let i = 0; i < MAX_LIVE_SESSIONS; i += 1) {
      mgr.create({
        projectId: 'p1',
        profile: 'shell',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        config: CONFIG,
        headless: true,
        scheduled: true
      });
    }
    expect(mgr.liveCount()).toBe(MAX_LIVE_SESSIONS);
    expect(() =>
      mgr.create({
        projectId: 'p1',
        profile: 'shell',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        config: CONFIG,
        headless: true,
        scheduled: true
      })
    ).toThrow(/live-session cap/i);
  });
});
