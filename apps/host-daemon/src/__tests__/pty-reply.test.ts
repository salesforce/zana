import { describe, it, expect, vi, beforeEach } from 'vitest';

// PtyManager imports node-pty, which spawns real subprocesses. Mock it with a
// fake IPty that records writes, so we can assert what `reply` sends without
// launching a shell. Each spawned proc keeps its own write log.
interface FakeProc {
  pid: number;
  writes: string[];
  exitCb?: (e: { exitCode: number }) => void;
  dataCbs: Array<(d: string) => void>;
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
      dataCbs: [],
      write(data: string) {
        this.writes.push(data);
      },
      onData(cb: (d: string) => void) {
        this.dataCbs.push(cb);
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
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => [], sessionPluginMcpServers: () => []
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
    nativeToolPolicyRequired: false,
    projectId: 'p1',
    profile: 'shell',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    config: CONFIG
  });
}

function makeOpenCodeSession(mgr: PtyManager) {
  return mgr.create({
    nativeToolPolicyRequired: false,
    projectId: 'p1',
    profile: 'opencode',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    config: CONFIG
  });
}

function makeCodexSession(mgr: PtyManager) {
  return mgr.create({
    nativeToolPolicyRequired: false,
    projectId: 'p1',
    profile: 'codex',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    config: { ...CONFIG, harnessCodexEnabled: true }
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

      // A short timer can fire before a large paste has left Codex's input
      // buffer. Return stays independently observable and arrives after 200ms.
      vi.advanceTimersByTime(199);
      expect(proc.writes).toEqual(['yes, proceed']);
      vi.advanceTimersByTime(1);
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

  it('wraps an OpenCode reply body in a bracketed-paste envelope before the deferred CR', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeOpenCodeSession(mgr);
      const proc = spawned[0];
      const startWrites = proc.writes.length; // ignore any spawn-time opening prompt

      mgr.reply(session.id, 'do the work');
      // Body arrives wrapped; embedded newlines (none here) would be buffered as
      // a literal paste rather than each acting as a premature Enter.
      expect(proc.writes.slice(startWrites)).toEqual(['\x1b[200~do the work\x1b[201~']);

      vi.runAllTimers();
      expect(proc.writes.slice(startWrites)).toEqual(['\x1b[200~do the work\x1b[201~', '\r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a multi-line OpenCode assignment intact inside one bracketed paste', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeOpenCodeSession(mgr);
      const proc = spawned[0];
      const startWrites = proc.writes.length;

      const assignment = 'You are assigned work unit `x`.\nTask: do it\n\nClose the unit.';
      mgr.reply(session.id, assignment);
      vi.runAllTimers();

      // The whole multi-line body is one paste; a single trailing CR submits it.
      expect(proc.writes.slice(startWrites)).toEqual([`\x1b[200~${assignment}\x1b[201~`, '\r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses advertised bracketed-paste mode for a multi-line Codex worker assignment', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = makeCodexSession(mgr);
      const proc = spawned[0];
      const startWrites = proc.writes.length;
      const assignment = 'You are assigned work unit `x`.\nTask: do it\n\nClose the unit.';

      // Codex opts into the standard terminal bracketed-paste protocol when its
      // composer is ready. Its long assignment must be a single paste, then a
      // separate synthetic Return after the paste buffer has drained.
      for (const cb of proc.dataCbs) cb('\x1b[?2004h');
      mgr.reply(session.id, assignment);
      expect(proc.writes.slice(startWrites)).toEqual([`\x1b[200~${assignment}\x1b[201~`]);

      vi.advanceTimersByTime(200);
      expect(proc.writes.slice(startWrites)).toEqual([`\x1b[200~${assignment}\x1b[201~`, '\r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(Array.from({ length: 7 }, (_, i) => i + 1))('tracks paste enable and disable split at offset %i', (split) => {
    vi.useFakeTimers();
    const mgr = new PtyManager();
    const session = makeCodexSession(mgr);
    try {
      const proc = spawned[0];
      const emit = (data: string) => proc.dataCbs.forEach((cb) => cb(data));
      const assignment = 'First line\nSecond line';
      for (const enabled of [true, false]) {
        const control = `\x1b[?2004${enabled ? 'h' : 'l'}`;
        emit('output'.repeat(5000) + control.slice(0, split));
        emit(control.slice(split) + 'ready');
        const start = proc.writes.length;
        mgr.reply(session.id, assignment);
        vi.advanceTimersByTime(200);
        expect(proc.writes.slice(start)).toEqual([
          enabled ? `\x1b[200~${assignment}\x1b[201~` : assignment,
          '\r'
        ]);
      }
    } finally {
      mgr.close(session.id);
      vi.useRealTimers();
    }
  });

  it.each([
    ['\x1b[?2004l\x1b[?2004h', true],
    ['\x1b[?2004h\x1b[?2004l', false]
  ] as const)('uses the last paste-mode transition in %j', (data, enabled) => {
    vi.useFakeTimers();
    const mgr = new PtyManager();
    const session = makeCodexSession(mgr);
    try {
      const proc = spawned[0];
      proc.dataCbs.forEach((cb) => cb(data));
      // A later ordinary chunk must not replay a previously completed control.
      proc.dataCbs.forEach((cb) => cb('output'));
      const start = proc.writes.length;
      mgr.reply(session.id, 'first\nsecond');
      vi.advanceTimersByTime(200);
      expect(proc.writes.slice(start)).toEqual([
        enabled ? '\x1b[200~first\nsecond\x1b[201~' : 'first\nsecond', '\r'
      ]);
    } finally {
      mgr.close(session.id);
      vi.useRealTimers();
    }
  });

  it('keeps paste-mode state and partial controls separate between workers', () => {
    vi.useFakeTimers();
    const mgr = new PtyManager();
    const first = makeCodexSession(mgr);
    const second = makeCodexSession(mgr);
    try {
      spawned[0].dataCbs.forEach((cb) => cb('\x1b[?20'));
      spawned[1].dataCbs.forEach((cb) => cb('04h'));
      spawned[0].dataCbs.forEach((cb) => cb('04h'));
      const starts = spawned.map((proc) => proc.writes.length);
      mgr.reply(first.id, 'one\ntwo');
      mgr.reply(second.id, 'one\ntwo');
      vi.advanceTimersByTime(200);
      expect(spawned[0].writes.slice(starts[0])).toEqual(['\x1b[200~one\ntwo\x1b[201~', '\r']);
      expect(spawned[1].writes.slice(starts[1])).toEqual(['one\ntwo', '\r']);
    } finally {
      mgr.close(first.id);
      mgr.close(second.id);
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
