import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * PR1 — async, handle-owning execution environment (the microVM/container seam).
 *
 * When the resolved `ExecutionEnvironment` exposes `createSession`, `PtyManager.
 * create()` STAYS synchronous: it registers the session in `starting` with a
 * DEFERRED handle (buffering input), returns immediately, boots the backend in
 * the background, then swaps in the real `ExecutionSession` — flushing buffered
 * input, wiring I/O, stamping the pid, flipping to `running`. On boot failure it
 * FAILS CLOSED (finalizes with a non-zero exit + honest banner), never a silent
 * unisolated fallback. These tests drive that lifecycle through a fake env.
 */

// node-pty is imported by pty.ts but must NOT be spawned on the async path — a
// call here would be a bug (the whole point is the SDK owns the process).
const ptySpawns: unknown[] = [];
vi.mock('node-pty', () => ({
  spawn: (...a: unknown[]) => {
    ptySpawns.push(a);
    return { pid: 999, write() {}, onData() {}, onExit() {}, resize() {}, kill() {} };
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import type {
  ExecutionEnvironment,
  ExecutionSession,
  ExecEnvContext,
  InnerLaunch
} from '../harness/execution-environment.js';

// A controllable fake ExecutionSession the test resolves/rejects by hand.
class FakeExec implements ExecutionSession {
  readonly pid = 7777;
  writes: string[] = [];
  killed = false;
  destroyed = false;
  private dataCb?: (d: string) => void;
  private exitCb?: (e: { exitCode: number }) => void;
  onData(cb: (d: string) => void) {
    this.dataCb = cb;
  }
  onExit(cb: (e: { exitCode: number }) => void) {
    this.exitCb = cb;
  }
  write(d: string) {
    this.writes.push(d);
  }
  resize() {}
  kill() {
    this.killed = true;
  }
  destroy() {
    this.destroyed = true;
  }
  emitData(d: string) {
    this.dataCb?.(d);
  }
  emitExit(code: number) {
    this.exitCb?.({ exitCode: code });
  }
}

// Deferred control over createSession so the test decides WHEN the VM "boots".
let pending: {
  resolve: (s: ExecutionSession) => void;
  reject: (e: unknown) => void;
} | null = null;
let lastCtx: (ExecEnvContext & { cols: number; rows: number; sessionEnv: Record<string, string>; spawnEnv?: Record<string, string> }) | null =
  null;
let lastInner: InnerLaunch | null = null;

const microEnv: ExecutionEnvironment = {
  id: 'sandbox', // reuse an existing id so ExecEnvId stays valid in PR1
  wrap: (inner) => inner,
  rewriteCallbackEnv: (env) => ({ ...env, ZCC_REWRITTEN: '1' }),
  status: () => ({ isolated: true }),
  createSession: (inner, ctx) =>
    new Promise<ExecutionSession>((resolve, reject) => {
      lastInner = inner;
      lastCtx = ctx;
      pending = { resolve, reject };
    })
};

vi.mock('../harness/execution-environment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../harness/execution-environment.js')>();
  return {
    ...actual,
    environmentFor: (id: string | undefined) => (id === 'sandbox' ? microEnv : actual.environmentFor(id as never))
  };
});

import { PtyManager } from '../pty.js';
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

const base = {
  projectId: 'p1',
  profile: 'shell' as const,
  cwd: '/work/p1',
  cols: 80,
  rows: 24
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PtyManager — async createSession environment', () => {
  let ptys: PtyManager;

  beforeEach(() => {
    ptySpawns.length = 0;
    pending = null;
    lastCtx = null;
    lastInner = null;
    ptys = new PtyManager();
  });

  it('returns a session in `starting` synchronously and never touches node-pty', () => {
    const s = ptys.create({ ...base, config: cfg(), environment: 'sandbox' });
    expect(s.status).toBe('starting');
    expect(s.pid).toBeUndefined();
    expect(s.environment).toBe('sandbox');
    expect(ptySpawns.length).toBe(0); // the SDK owns the process, not node-pty
    expect(pending).not.toBeNull(); // createSession was kicked off in the background
  });

  it('flips to running, stamps the pid, and drains buffered input on attach', async () => {
    const s = ptys.create({ ...base, config: cfg(), environment: 'sandbox' });
    const ready = ptys.waitForReady(s.id);
    // Input arrives WHILE the VM is still booting — must be buffered, in order.
    ptys.write(s.id, 'echo hi');
    expect(ptys.reply(s.id, 'second')).toBe(true);

    const exec = new FakeExec();
    pending!.resolve(exec);
    await flush();
    await expect(ready).resolves.toMatchObject({ id: s.id, status: 'running', pid: 7777 });
    await flush();

    const live = ptys.getSession(s.id);
    expect(live?.status).toBe('running');
    expect(live?.pid).toBe(7777);
    // Buffered writes replayed in submit order (reply adds a deferred CR later).
    expect(exec.writes.slice(0, 2)).toEqual(['echo hi', 'second']);
  });

  it('streams guest output into the backlog once attached', async () => {
    const s = ptys.create({ ...base, config: cfg(), environment: 'sandbox' });
    const exec = new FakeExec();
    pending!.resolve(exec);
    await flush();
    exec.emitData('guest says hello');
    await flush();
    // getBacklog reflects the buffered/flushed tail.
    await new Promise((r) => setTimeout(r, 20));
    expect(ptys.getBacklog(s.id)).toContain('guest says hello');
  });

  it('passes the REWRITTEN callback env to createSession', () => {
    ptys.create({ ...base, config: cfg(), environment: 'sandbox' });
    expect(lastCtx?.sessionEnv.ZCC_REWRITTEN).toBe('1');
    expect(lastCtx?.spawnEnv?.ZCC_REWRITTEN).toBe('1');
    expect(lastInner).not.toBeNull();
  });

  it('FAILS CLOSED on boot failure — finalizes with a non-zero exit, no local fallback', async () => {
    const s = ptys.create({ ...base, config: cfg(), environment: 'sandbox' });
    const ready = expect(ptys.waitForReady(s.id)).rejects.toThrow('failed before execution handle was ready');
    const exits: Array<[string, number]> = [];
    ptys.on('exit', (id: string, code: number) => exits.push([id, code]));

    pending!.reject(new Error('no hypervisor'));
    await flush();
    await ready;
    await flush();

    // Session is gone (finalized), never downgraded to a running local spawn.
    expect(ptys.getSession(s.id)).toBeNull();
    expect(exits).toContainEqual([s.id, 1]);
    expect(ptySpawns.length).toBe(0);
  });

  it('tears the guest down if the session is closed mid-boot', async () => {
    const s = ptys.create({ ...base, config: cfg(), environment: 'sandbox' });
    ptys.close(s.id); // user closes before the VM finishes booting
    const exec = new FakeExec();
    pending!.resolve(exec);
    await flush();
    await flush();
    expect(exec.killed).toBe(true);
    expect(ptys.getSession(s.id)).toBeNull();
  });

  it('closeExpected finalizes a pidless start and rejects a late backend attach', async () => {
    const s = ptys.create({ ...base, config: cfg(), environment: 'sandbox' });
    const exits: Array<[string, number]> = [];
    ptys.on('exit', (id: string, code: number) => exits.push([id, code]));

    expect(ptys.closeExpected(s.id)).toBe(true);
    expect(ptys.getSession(s.id)).toBeNull();
    expect(exits).toEqual([[s.id, 0]]);

    const exec = new FakeExec();
    pending!.resolve(exec);
    await flush();
    expect(exec.killed).toBe(true);
    expect(ptys.getSession(s.id)).toBeNull();
  });
});
