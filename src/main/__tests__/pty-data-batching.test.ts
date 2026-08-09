import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake IPty that lets the test drive the data + exit callbacks directly, so we
// can feed a burst of chunks and assert how many `data` events PtyManager emits
// after coalescing. Mirrors the mock shape in pty-reply.test.ts.
interface FakeProc {
  pid: number;
  dataCbs: ((d: string) => void)[];
  exitCb?: (e: { exitCode: number }) => void;
  write: (data: string) => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
  /** Helper: push a chunk to every registered onData listener. */
  feed: (d: string) => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: 2000 + spawned.length,
      dataCbs: [],
      write() {},
      onData(cb: (d: string) => void) {
        this.dataCbs.push(cb);
      },
      onExit(cb: (e: { exitCode: number }) => void) {
        this.exitCb = cb;
      },
      resize() {},
      kill() {
        this.exitCb?.({ exitCode: 0 });
      },
      feed(d: string) {
        for (const cb of this.dataCbs) cb(d);
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

describe('PtyManager output batching', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('coalesces a burst of chunks into a single data event per flush window', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeSession(mgr);
      const proc = spawned[0];

      const events: string[] = [];
      mgr.on('data', (_id: string, data: string) => events.push(data));

      // A burst: five tiny chunks within one window emit nothing yet.
      proc.feed('a');
      proc.feed('b');
      proc.feed('c');
      proc.feed('d');
      proc.feed('e');
      expect(events).toEqual([]);

      // After the flush window, the whole burst is one ordered message.
      vi.runAllTimers();
      expect(events).toEqual(['abcde']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits the session id with the coalesced data', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeSession(mgr);
      const proc = spawned[0];

      const seen: Array<[string, string]> = [];
      mgr.on('data', (id: string, data: string) => seen.push([id, data]));

      proc.feed('hello ');
      proc.feed('world');
      vi.runAllTimers();

      expect(seen).toEqual([[session.id, 'hello world']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('separate flush windows yield separate events', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      makeSession(mgr);
      const proc = spawned[0];

      const events: string[] = [];
      mgr.on('data', (_id: string, data: string) => events.push(data));

      proc.feed('first');
      vi.runAllTimers();
      proc.feed('second');
      vi.runAllTimers();

      expect(events).toEqual(['first', 'second']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes any buffered tail before the exit event (no dropped bytes)', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeSession(mgr);
      const proc = spawned[0];

      const order: string[] = [];
      mgr.on('data', (_id: string, data: string) => order.push(`data:${data}`));
      mgr.on('exit', () => order.push('exit'));

      // Output arrives, then the process exits before the flush timer fires.
      proc.feed('tail bytes');
      proc.kill(); // drives onExit synchronously

      // The buffered tail is flushed, and it lands BEFORE the exit event.
      expect(order).toEqual(['data:tail bytes', 'exit']);

      // The now-dead session's timer must not emit a second, empty event.
      vi.runAllTimers();
      expect(order).toEqual(['data:tail bytes', 'exit']);
      // Session id was real (sanity).
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      vi.useRealTimers();
    }
  });
});
