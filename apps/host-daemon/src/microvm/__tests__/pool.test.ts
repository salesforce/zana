import { describe, it, expect, vi } from 'vitest';
import { MicroVmPool } from '../pool.js';

/**
 * Unit tests for the persistent guest pool. A FAKE microsandbox SDK stands in
 * for the native addon so we exercise the full lifecycle — lazy boot, reuse
 * (state persistence key), LRU eviction, idle reap, per-command timeout, reset,
 * disposeAll, and the fail-closed gates (disabled / unsupported platform / boot
 * failure / SDK-absent) — with no VM.
 */

// ---- Fake SDK -------------------------------------------------------------

class FakeExecOutput {
  constructor(
    private readonly _stdout: string,
    private readonly _stderr: string,
    readonly code: number
  ) {}
  stdout() {
    return this._stdout;
  }
  stderr() {
    return this._stderr;
  }
  get success() {
    return this.code === 0;
  }
}

class FakeSandbox {
  stopped = false;
  killAttempted = false;
  shellCalls: string[] = [];
  constructor(
    readonly name: string,
    /** Optional per-instance shell impl (default echoes the script). */
    private readonly impl?: (script: string) => Promise<FakeExecOutput> | FakeExecOutput
  ) {}
  async shell(script: string) {
    this.shellCalls.push(script);
    if (this.impl) return this.impl(script);
    return new FakeExecOutput(`ran: ${script}`, '', 0);
  }
  async stop() {
    this.stopped = true;
  }
  async kill() {
    this.killAttempted = true;
  }
}

interface Cap {
  built: FakeSandbox[];
  removed: string[];
  names: string[];
  policies: string[][];
}

function fakeSdk(
  capture: Cap,
  opts: { boot?: (name: string) => FakeSandbox; failCreate?: boolean } = {}
) {
  return {
    NetworkPolicy: {
      builder() {
        const calls: string[] = [];
        const b: Record<string, unknown> = {
          defaultDeny: () => (calls.push('defaultDeny'), b),
          egress: (fn: (e: unknown) => unknown) => {
            const e: Record<string, unknown> = {
              allowPublic: () => (calls.push('allowPublic'), e),
              allowHost: () => (calls.push('allowHost'), e),
              allowLoopback: () => (calls.push('allowLoopback'), e)
            };
            fn(e);
            return b;
          },
          build: () => {
            capture.policies.push(calls);
            return { calls };
          }
        };
        return b;
      }
    },
    Sandbox: {
      builder(name: string) {
        capture.names.push(name);
        const b: Record<string, unknown> = {
          image: () => b,
          cpus: () => b,
          memory: () => b,
          workdir: () => b,
          ephemeral: () => b,
          replace: () => b,
          network: (fn: (nb: unknown) => unknown) => {
            fn({ policy: () => ({}) });
            return b;
          },
          create: async () => {
            if (opts.failCreate) throw new Error('boot exploded');
            const sb = opts.boot ? opts.boot(name) : new FakeSandbox(name);
            capture.built.push(sb);
            return sb;
          }
        };
        return b;
      },
      async remove(name: string) {
        capture.removed.push(name);
      }
    }
  };
}

function cap(): Cap {
  return { built: [], removed: [], names: [], policies: [] };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const baseDeps = (over = {}) => ({
  platformSupported: () => true,
  ...over
});

describe('MicroVmPool — run + persistence', () => {
  it('lazily boots a guest on first run and REUSES it (state persists) on the next', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c) as never }));

    const r1 = await pool.exec('proj-1', 'echo hello');
    const r2 = await pool.exec('proj-1', 'echo world');

    expect(r1.ok).toBe(true);
    expect(r1.code).toBe(0);
    expect(r1.stdout).toContain('echo hello');
    expect(r2.ok).toBe(true);
    // Only ONE guest booted for two calls on the same projectId -> state persists.
    expect(c.built).toHaveLength(1);
    expect(pool.liveCount()).toBe(1);
    // Both commands ran against the same sandbox, cd'd into the workdir.
    expect(c.built[0].shellCalls).toHaveLength(2);
    expect(c.built[0].shellCalls[0]).toContain('cd /root');
  });

  it('boots a SEPARATE guest per projectId', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c) as never }));
    await pool.exec('proj-a', 'true');
    await pool.exec('proj-b', 'true');
    expect(c.built).toHaveLength(2);
    expect(pool.liveCount()).toBe(2);
  });

  it('returns a non-zero exit code as DATA (never throws)', async () => {
    const c = cap();
    const pool = new MicroVmPool(
      baseDeps({
        loadSdk: async () =>
          fakeSdk(c, { boot: (name) => new FakeSandbox(name, () => new FakeExecOutput('', 'boom', 2)) }) as never
      })
    );
    const r = await pool.exec('p', 'false');
    expect(r.ok).toBe(true);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('boom');
  });

  it('rejects an empty command and a NUL byte before booting', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c) as never }));
    expect((await pool.exec('p', '   ')).ok).toBe(false);
    expect((await pool.exec('p', 'a\0b')).message).toMatch(/NUL/);
    expect(c.built).toHaveLength(0);
  });

  it('clips oversized stdout and flags truncated', async () => {
    const c = cap();
    const big = 'x'.repeat(1024 * 1024 + 50);
    const pool = new MicroVmPool(
      baseDeps({
        loadSdk: async () => fakeSdk(c, { boot: (n) => new FakeSandbox(n, () => new FakeExecOutput(big, '', 0)) }) as never
      })
    );
    const r = await pool.exec('p', 'cat huge');
    expect(r.truncated).toBe(true);
    expect(r.stdout!.length).toBe(1024 * 1024);
  });
});

describe('MicroVmPool — network policy', () => {
  it('builds a public+host+loopback egress policy by default', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c) as never }));
    await pool.exec('p', 'true');
    expect(c.policies[0]).toEqual(['defaultDeny', 'allowPublic', 'allowHost', 'allowLoopback']);
  });

  it('builds a fully-closed (no egress) policy for network:none', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c) as never }));
    await pool.exec('p', 'true', { network: 'none' });
    expect(c.policies[0]).toEqual(['defaultDeny']);
  });
});

describe('MicroVmPool — bounds + reaping', () => {
  it('LRU-evicts the least-recently-used guest at capacity', async () => {
    const c = cap();
    // Monotonic injected clock so lastUsed ordering is deterministic (real
    // Date.now() can collide within a millisecond and make the LRU ambiguous).
    let t = 0;
    const pool = new MicroVmPool(baseDeps({ maxGuests: 2, now: () => ++t, loadSdk: async () => fakeSdk(c) as never }));
    await pool.exec('a', 'true'); // a used
    await pool.exec('b', 'true'); // b used (newer)
    await pool.exec('a', 'true'); // bump a -> b is now LRU
    await pool.exec('c', 'true'); // capacity 2 -> evicts b
    await flush();
    expect(pool.liveCount()).toBe(2);
    // b's sandbox was stopped.
    const bGuest = c.built[1];
    expect(bGuest.stopped).toBe(true);
  });

  it('reaps a guest after the idle TTL', async () => {
    vi.useFakeTimers();
    try {
      const c = cap();
      const pool = new MicroVmPool(baseDeps({ idleTtlMs: 1000, loadSdk: async () => fakeSdk(c) as never }));
      await pool.exec('p', 'true');
      expect(pool.liveCount()).toBe(1);
      vi.advanceTimersByTime(1001);
      expect(pool.liveCount()).toBe(0);
      expect(c.built[0].stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset() tears down the guest so the next run boots a fresh one', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c) as never }));
    await pool.exec('p', 'true');
    const first = c.built[0];
    const res = await pool.reset('p');
    expect(res.existed).toBe(true);
    await flush();
    expect(first.stopped).toBe(true);
    expect(pool.liveCount()).toBe(0);
    await pool.exec('p', 'true');
    expect(c.built).toHaveLength(2); // a brand-new guest
  });

  it('reset() on an unknown project is a no-op', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c) as never }));
    expect(await pool.reset('nope')).toEqual({ ok: true, existed: false });
  });

  it('disposeAll() stops every guest and rejects further runs', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c) as never }));
    await pool.exec('a', 'true');
    await pool.exec('b', 'true');
    await pool.disposeAll();
    expect(c.built[0].stopped).toBe(true);
    expect(c.built[1].stopped).toBe(true);
    expect(pool.liveCount()).toBe(0);
    const r = await pool.exec('a', 'true');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/disposed/);
  });
});

describe('MicroVmPool — timeout', () => {
  it('times out a hung command and drops the guest', async () => {
    // Real timer with the minimum clamp (1s) — fake timers don't compose
    // cleanly with the timeout Promise.race created inside the async acquire
    // microtask chain. 1s keeps the test fast enough.
    const c = cap();
    const hang = new FakeSandbox('zcc-pg-p', () => new Promise<FakeExecOutput>(() => {})); // never resolves
    const pool = new MicroVmPool(
      baseDeps({ defaultTimeoutMs: MIN_TIMEOUT_MS, loadSdk: async () => fakeSdk(c, { boot: () => hang }) as never })
    );
    const r = await pool.exec('p', 'sleep 999');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/timed out/);
    // The wedged guest was dropped.
    expect(pool.liveCount()).toBe(0);
  }, 10_000);
});

const MIN_TIMEOUT_MS = 1_000;

describe('MicroVmPool — fail closed', () => {
  it('returns disabled when the feature flag is off (no SDK load)', async () => {
    let loaded = false;
    const pool = new MicroVmPool(
      baseDeps({ enabled: () => false, loadSdk: async () => ((loaded = true), fakeSdk(cap()) as never) })
    );
    const r = await pool.exec('p', 'true');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/disabled/);
    expect(loaded).toBe(false);
  });

  it('returns unsupported on a non-capable platform (no SDK load)', async () => {
    let loaded = false;
    const pool = new MicroVmPool({
      platformSupported: () => false,
      loadSdk: async () => ((loaded = true), fakeSdk(cap()) as never)
    });
    const r = await pool.exec('p', 'true');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/unsupported|Apple Silicon/);
    expect(loaded).toBe(false);
  });

  it('degrades to an honest message when the SDK import fails', async () => {
    const pool = new MicroVmPool(
      baseDeps({
        loadSdk: async () => {
          throw new Error('addon missing');
        }
      })
    );
    const r = await pool.exec('p', 'true');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/SDK not available|addon missing/);
  });

  it('degrades to an honest message when guest boot fails', async () => {
    const c = cap();
    const pool = new MicroVmPool(baseDeps({ loadSdk: async () => fakeSdk(c, { failCreate: true }) as never }));
    const r = await pool.exec('p', 'true');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/boot failed|exploded/);
    expect(pool.liveCount()).toBe(0);
  });

  it('rejects an unauthorized image before booting', async () => {
    let loaded = false;
    const pool = new MicroVmPool(
      baseDeps({ loadSdk: async () => ((loaded = true), fakeSdk(cap()) as never) })
    );
    const r = await pool.exec('p', 'true', { image: 'evil.com/backdoor:latest' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/allowlist/);
    expect(loaded).toBe(false);
  });
});
