import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeProc {
  pid: number;
  writes: string[];
  dataCbs: Array<(d: string) => void>;
  exitCb?: (e: { exitCode: number }) => void;
  write: (data: string) => void;
  onData: (cb: (d: string) => void) => { dispose(): void };
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: 4000 + spawned.length,
      writes: [],
      dataCbs: [],
      write(data: string) {
        this.writes.push(data);
      },
      onData(cb: (d: string) => void) {
        this.dataCbs.push(cb);
        return { dispose: () => {
          const i = this.dataCbs.indexOf(cb);
          if (i >= 0) this.dataCbs.splice(i, 1);
        } };
      },
      onExit(cb: (e: { exitCode: number }) => void) {
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
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => []
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

describe('PtyManager stdin-after-ready opening prompt', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('types the opening task via reply after first TUI output', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      mgr.create({
        projectId: 'p1',
        profile: 'mastracode',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        config: CONFIG,
        openingPrompt: 'analyse the repo'
      });
      const proc = spawned[0];
      expect(proc.writes).toEqual([]);

      for (const cb of proc.dataCbs) cb('MASTRA CODE\n');
      expect(proc.writes).toEqual([]);

      vi.advanceTimersByTime(500);
      expect(proc.writes).toEqual(['analyse the repo']);

      vi.advanceTimersByTime(50);
      expect(proc.writes).toEqual(['analyse the repo', '\r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not inject when the session exits before the ready delay', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = mgr.create({
        projectId: 'p1',
        profile: 'mastracode',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        config: CONFIG,
        openingPrompt: 'analyse the repo'
      });
      const proc = spawned[0];
      for (const cb of proc.dataCbs) cb('banner');
      mgr.close(session.id);
      vi.runAllTimers();
      expect(proc.writes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for afcode input readiness across chunks, after a slow startup', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      mgr.create({ projectId: 'p1', profile: 'afcode', cwd: '/tmp', cols: 80, rows: 24,
        config: CONFIG, openingPrompt: 'analyse the repo' });
      const proc = spawned[0];
      const emit = (data: string) => [...proc.dataCbs].forEach((cb) => cb(data));
      const readinessCallback = proc.dataCbs.at(-1)!;
      emit('AGENTFORCE CODE\nConnecting MCP servers...\n');
      vi.advanceTimersByTime(5000);
      expect(proc.writes).toEqual([]);
      emit('x'.repeat(40000) + '\x1b[?20');
      emit('04h> ');
      // Some execution backends cannot unsubscribe an already-queued chunk.
      readinessCallback('\x1b[?2004h');
      vi.advanceTimersByTime(550);
      expect(proc.writes).toEqual(['analyse the repo', '\r']);
      expect(proc.dataCbs).toHaveLength(1);
      emit('\x1b[?2004h');
      vi.advanceTimersByTime(60_000);
      expect(proc.writes).toEqual(['analyse the repo', '\r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retain a readiness listener for an empty opening task', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      mgr.create({ projectId: 'p1', profile: 'afcode', cwd: '/tmp', cols: 80, rows: 24,
        config: CONFIG, openingPrompt: '  ' });
      expect(spawned[0].dataCbs).toHaveLength(1);
      vi.advanceTimersByTime(60_000);
      expect(spawned[0].writes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a readiness timeout and never injects a late task', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const data = vi.fn();
      mgr.on('data', data);
      mgr.create({ projectId: 'p1', profile: 'afcode', cwd: '/tmp', cols: 80, rows: 24,
        config: CONFIG, openingPrompt: 'analyse the repo' });
      vi.advanceTimersByTime(60_000);
      expect(data).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Initial task was not sent'));
      for (const cb of spawned[0].dataCbs) cb('\x1b[?2004h');
      vi.advanceTimersByTime(1000);
      expect(spawned[0].writes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the readiness subscription when afcode closes before its prompt', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      const session = mgr.create({ projectId: 'p1', profile: 'afcode', cwd: '/tmp', cols: 80, rows: 24,
        config: CONFIG, openingPrompt: 'analyse the repo' });
      mgr.close(session.id);
      for (const cb of spawned[0].dataCbs) cb('\x1b[?2004h');
      vi.runAllTimers();
      expect(spawned[0].writes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not inject a scheduled or resume launch', () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager();
      mgr.create({
        projectId: 'p1',
        profile: 'mastracode',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        config: CONFIG,
        openingPrompt: 'analyse the repo',
        scheduled: true
      });
      for (const cb of spawned[0].dataCbs) cb('banner');
      vi.runAllTimers();
      expect(spawned[0].writes).toEqual([]);

      mgr.create({
        projectId: 'p1',
        profile: 'mastracode',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        config: CONFIG,
        openingPrompt: 'analyse the repo',
        resume: true
      });
      for (const cb of spawned[1].dataCbs) cb('banner');
      vi.runAllTimers();
      expect(spawned[1].writes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
