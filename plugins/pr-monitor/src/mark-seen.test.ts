/**
 * Unit tests for the markPrAsSeen handler in PR Monitor.
 *
 * Tests the lastSeenAt timestamp update mechanism — success path (updates and
 * persists), error cases (missing URL, PR not found), storage failure handling,
 * and correct return envelope shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import prMonitorMainModule from '../lib/pr-main.js';
import type { MonitoredPr } from '../lib/types.js';
import type { PrMonitorContext, ExecResult } from '../lib/context.js';

// pr-main.ts keys its persisted PR map under this private storage key. It isn't
// exported, so mirror the literal here (a drift guard: if the source key
// changes, these tests fail loudly rather than silently passing on a stale key).
const PRS_KEY = 'prs';

/** A tracked PR without a lastSeenAt timestamp. */
function basePr(): MonitoredPr {
  return {
    url: 'https://github.com/owner/repo/pull/42',
    repo: 'owner/repo',
    number: 42,
    title: 'Add feature',
    baseRefName: 'main',
    status: 'green',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }],
    addedAt: 1000,
    lastChecked: 2000,
    lastStatusChange: 1500,
  };
}

/**
 * Build a ctx whose storage is an in-memory map seeded with the given PRs, and
 * whose exec broker returns benign valid gh output (not needed for markPrAsSeen,
 * but required by the module's setup guard).
 */
function makeCtx(initialPrs: Record<string, MonitoredPr>) {
  const store: Record<string, unknown> = { [PRS_KEY]: initialPrs };
  const exec = async ({ args }: { bin: string; args: string[] }): Promise<ExecResult> => {
    // Benign stub — markPrAsSeen doesn't invoke exec, but module setup requires
    // ctx.exec to be present (throws "unavailable" otherwise).
    return { code: 0, stdout: '[]', stderr: '' };
  };
  const ctx: PrMonitorContext = {
    moduleId: 'pr-monitor',
    exec: exec as PrMonitorContext['exec'],
    log: vi.fn(),
    storage: {
      get: vi.fn(async (key: string) => store[key]),
      set: vi.fn((key: string, value: unknown) => {
        store[key] = value;
      }),
    } as unknown as PrMonitorContext['storage'],
    cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as PrMonitorContext['cache'],
  };
  return { ctx, store };
}

describe('markPrAsSeen', () => {
  beforeEach(() => {
    // Clear Date.now mock between tests if any test needs to set it
    vi.restoreAllMocks();
  });

  it('successfully updates lastSeenAt timestamp for an existing PR', async () => {
    const pr = basePr();
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    // Mock Date.now to return a predictable timestamp
    const mockNow = 5000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow);

    const res = (await caps.markPrAsSeen({ url: pr.url })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.prs).toBeDefined();

    // Check the returned PR has the updated timestamp
    const updated = res.prs?.find((p) => p.number === 42);
    expect(updated?.lastSeenAt).toBe(mockNow);

    // Check the persisted PR has the updated timestamp
    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(mockNow);
  });

  it('preserves all other PR fields when updating lastSeenAt', async () => {
    const pr: MonitoredPr = {
      ...basePr(),
      projectId: 'proj-123',
      lastSeenAt: 3000,
    };
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const mockNow = 6000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow);

    const res = (await caps.markPrAsSeen({ url: pr.url })) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];

    // Verify only lastSeenAt changed
    expect(persisted.lastSeenAt).toBe(mockNow);
    expect(persisted.projectId).toBe('proj-123');
    expect(persisted.status).toBe('green');
    expect(persisted.title).toBe('Add feature');
    expect(persisted.lastChecked).toBe(2000);
    expect(persisted.lastStatusChange).toBe(1500);
  });

  it('returns error when PR URL not found', async () => {
    const pr = basePr();
    const { ctx } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const nonexistentUrl = 'https://github.com/owner/repo/pull/999';
    const res = (await caps.markPrAsSeen({ url: nonexistentUrl })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toBe(`PR not found: ${nonexistentUrl}`);
    expect(res.prs).toBeUndefined();
  });

  it('returns error when URL parameter is missing', async () => {
    const { ctx } = makeCtx({});
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.markPrAsSeen({ url: '' })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing PR URL');
    expect(res.prs).toBeUndefined();
  });

  it('returns error when URL parameter is whitespace only', async () => {
    const { ctx } = makeCtx({});
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.markPrAsSeen({ url: '   \t\n  ' })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing PR URL');
    expect(res.prs).toBeUndefined();
  });

  it('trims whitespace from URL before lookup', async () => {
    const pr = basePr();
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const mockNow = 7000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow);

    // Pass URL with surrounding whitespace
    const res = (await caps.markPrAsSeen({ url: `  ${pr.url}  ` })) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(mockNow);
  });

  it('persists the updated PR list to storage', async () => {
    const pr1 = basePr();
    const pr2 = { ...basePr(), url: 'https://github.com/owner/repo/pull/99', number: 99, addedAt: 1100 };
    const { ctx, store } = makeCtx({ [pr1.url]: pr1, [pr2.url]: pr2 });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const mockNow = 8000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow);

    await caps.markPrAsSeen({ url: pr1.url });

    // Verify storage.set was called
    expect(ctx.storage.set).toHaveBeenCalledWith(PRS_KEY, expect.any(Object));

    // Verify the store actually has the updated data
    const persisted = store[PRS_KEY] as Record<string, MonitoredPr>;
    expect(persisted[pr1.url].lastSeenAt).toBe(mockNow);
    expect(persisted[pr2.url].lastSeenAt).toBeUndefined();
  });

  it('returns PRs sorted by addedAt', async () => {
    const pr1 = { ...basePr(), url: 'https://github.com/owner/repo/pull/42', number: 42, addedAt: 3000 };
    const pr2 = { ...basePr(), url: 'https://github.com/owner/repo/pull/10', number: 10, addedAt: 1000 };
    const pr3 = { ...basePr(), url: 'https://github.com/owner/repo/pull/25', number: 25, addedAt: 2000 };
    const { ctx } = makeCtx({ [pr1.url]: pr1, [pr2.url]: pr2, [pr3.url]: pr3 });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.markPrAsSeen({ url: pr2.url })) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    expect(res.prs?.map(p => p.number)).toEqual([10, 25, 42]); // sorted by addedAt asc
  });

  it('handles storage read errors gracefully', async () => {
    const pr = basePr();
    const store: Record<string, unknown> = { [PRS_KEY]: { [pr.url]: pr } };

    // Create ctx with a storage.get that throws
    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: async () => ({ code: 0, stdout: '[]', stderr: '' }) as ExecResult,
      log: vi.fn(),
      storage: {
        get: vi.fn(async () => {
          throw new Error('Storage read failed');
        }),
        set: vi.fn(),
      } as unknown as PrMonitorContext['storage'],
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as PrMonitorContext['cache'],
    };

    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const res = (await caps.markPrAsSeen({ url: pr.url })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Storage read failed');
    expect(res.prs).toBeUndefined();
  });

  it('handles storage write errors gracefully', async () => {
    const pr = basePr();
    const store: Record<string, unknown> = { [PRS_KEY]: { [pr.url]: pr } };

    // Create ctx with a storage.set that throws
    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: async () => ({ code: 0, stdout: '[]', stderr: '' }) as ExecResult,
      log: vi.fn(),
      storage: {
        get: vi.fn(async (key: string) => store[key]),
        set: vi.fn(() => {
          throw new Error('Storage write failed');
        }),
      } as unknown as PrMonitorContext['storage'],
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as PrMonitorContext['cache'],
    };

    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const res = (await caps.markPrAsSeen({ url: pr.url })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Storage write failed');
    expect(res.prs).toBeUndefined();
  });

  it('handles storage returning non-object gracefully', async () => {
    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: async () => ({ code: 0, stdout: '[]', stderr: '' }) as ExecResult,
      log: vi.fn(),
      storage: {
        get: vi.fn(async () => 'not an object'),
        set: vi.fn(),
      } as unknown as PrMonitorContext['storage'],
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as PrMonitorContext['cache'],
    };

    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const res = (await caps.markPrAsSeen({ url: 'https://github.com/owner/repo/pull/42' })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    // Should treat corrupt storage as empty and return "PR not found"
    expect(res.ok).toBe(false);
    expect(res.error).toBe('PR not found: https://github.com/owner/repo/pull/42');
  });

  it('handles storage returning null gracefully', async () => {
    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: async () => ({ code: 0, stdout: '[]', stderr: '' }) as ExecResult,
      log: vi.fn(),
      storage: {
        get: vi.fn(async () => null),
        set: vi.fn(),
      } as unknown as PrMonitorContext['storage'],
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as PrMonitorContext['cache'],
    };

    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const res = (await caps.markPrAsSeen({ url: 'https://github.com/owner/repo/pull/42' })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    // Should treat null storage as empty and return "PR not found"
    expect(res.ok).toBe(false);
    expect(res.error).toBe('PR not found: https://github.com/owner/repo/pull/42');
  });

  it('can update lastSeenAt multiple times', async () => {
    const pr = basePr();
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    // First update
    const mockNow1 = 5000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow1);
    await caps.markPrAsSeen({ url: pr.url });
    let persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(mockNow1);

    // Second update
    const mockNow2 = 9000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow2);
    await caps.markPrAsSeen({ url: pr.url });
    persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(mockNow2);
  });

  it('does not call exec during mark-as-seen operation', async () => {
    const pr = basePr();
    const execSpy = vi.fn(async () => ({ code: 0, stdout: '[]', stderr: '' }) as ExecResult);
    const store: Record<string, unknown> = { [PRS_KEY]: { [pr.url]: pr } };

    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: execSpy as PrMonitorContext['exec'],
      log: vi.fn(),
      storage: {
        get: vi.fn(async (key: string) => store[key]),
        set: vi.fn((key: string, value: unknown) => {
          store[key] = value;
        }),
      } as unknown as PrMonitorContext['storage'],
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as PrMonitorContext['cache'],
    };

    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await caps.markPrAsSeen({ url: pr.url });

    // exec should never be called during mark-as-seen (no gh CLI needed)
    expect(execSpy).not.toHaveBeenCalled();
  });
});

describe('markPrAsUnseen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully clears lastSeenAt timestamp for an existing PR', async () => {
    const pr: MonitoredPr = { ...basePr(), lastSeenAt: 5000 };
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.markPrAsUnseen({ url: pr.url })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.prs).toBeDefined();

    // Check the returned PR has the explicit unread sentinel.
    const updated = res.prs?.find((p) => p.number === 42);
    expect(updated?.lastSeenAt).toBe(0);

    // Check the persisted PR has the explicit unread sentinel.
    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(0);
  });

  it('preserves all other PR fields when clearing lastSeenAt', async () => {
    const pr: MonitoredPr = {
      ...basePr(),
      projectId: 'proj-456',
      lastSeenAt: 7000,
    };
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.markPrAsUnseen({ url: pr.url })) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];

    // Verify only lastSeenAt changed (to the explicit unread sentinel).
    expect(persisted.lastSeenAt).toBe(0);
    expect(persisted.projectId).toBe('proj-456');
    expect(persisted.status).toBe('green');
    expect(persisted.title).toBe('Add feature');
    expect(persisted.lastChecked).toBe(2000);
    expect(persisted.lastStatusChange).toBe(1500);
  });

  it('can mark a PR unseen even if it was never seen before', async () => {
    const pr = basePr(); // no lastSeenAt
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.markPrAsUnseen({ url: pr.url })) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(0);
  });

  it('returns error when PR URL not found', async () => {
    const pr = basePr();
    const { ctx } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const nonexistentUrl = 'https://github.com/owner/repo/pull/888';
    const res = (await caps.markPrAsUnseen({ url: nonexistentUrl })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toBe(`PR not found: ${nonexistentUrl}`);
    expect(res.prs).toBeUndefined();
  });

  it('returns error when URL parameter is missing', async () => {
    const { ctx } = makeCtx({});
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.markPrAsUnseen({ url: '' })) as { ok: boolean; prs?: MonitoredPr[]; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing PR URL');
    expect(res.prs).toBeUndefined();
  });

  it('trims whitespace from URL before lookup', async () => {
    const pr: MonitoredPr = { ...basePr(), lastSeenAt: 6000 };
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    // Pass URL with surrounding whitespace
    const res = (await caps.markPrAsUnseen({ url: `  ${pr.url}  ` })) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(0);
  });

  it('persists the updated PR list to storage', async () => {
    const pr1: MonitoredPr = { ...basePr(), lastSeenAt: 4000 };
    const pr2: MonitoredPr = {
      ...basePr(),
      url: 'https://github.com/owner/repo/pull/99',
      number: 99,
      addedAt: 1100,
      lastSeenAt: 5000,
    };
    const { ctx, store } = makeCtx({ [pr1.url]: pr1, [pr2.url]: pr2 });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    await caps.markPrAsUnseen({ url: pr1.url });

    // Verify storage.set was called
    expect(ctx.storage.set).toHaveBeenCalledWith(PRS_KEY, expect.any(Object));

    // Verify the store has the correct data
    const persisted = store[PRS_KEY] as Record<string, MonitoredPr>;
    expect(persisted[pr1.url].lastSeenAt).toBe(0);
    expect(persisted[pr2.url].lastSeenAt).toBe(5000); // unchanged
  });

  it('returns PRs sorted by addedAt', async () => {
    const pr1: MonitoredPr = {
      ...basePr(),
      url: 'https://github.com/owner/repo/pull/42',
      number: 42,
      addedAt: 3000,
      lastSeenAt: 6000,
    };
    const pr2: MonitoredPr = {
      ...basePr(),
      url: 'https://github.com/owner/repo/pull/10',
      number: 10,
      addedAt: 1000,
      lastSeenAt: 6000,
    };
    const pr3: MonitoredPr = {
      ...basePr(),
      url: 'https://github.com/owner/repo/pull/25',
      number: 25,
      addedAt: 2000,
      lastSeenAt: 6000,
    };
    const { ctx } = makeCtx({ [pr1.url]: pr1, [pr2.url]: pr2, [pr3.url]: pr3 });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.markPrAsUnseen({ url: pr2.url })) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    expect(res.prs?.map(p => p.number)).toEqual([10, 25, 42]); // sorted by addedAt asc
  });

  it('allows toggling between seen and unseen states', async () => {
    const pr = basePr();
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    // Mark as seen
    const mockNow = 10000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow);
    await caps.markPrAsSeen({ url: pr.url });
    let persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(mockNow);

    // Mark as unseen
    await caps.markPrAsUnseen({ url: pr.url });
    persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(0);

    // Mark as seen again
    const mockNow2 = 15000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow2);
    await caps.markPrAsSeen({ url: pr.url });
    persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.lastSeenAt).toBe(mockNow2);
  });
});

describe('setPrsSeen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('marks every supplied PR read in one batch', async () => {
    const pr1 = basePr();
    const pr2 = { ...basePr(), url: 'https://github.com/owner/repo/pull/99', number: 99, addedAt: 1100 };
    const pr3 = { ...basePr(), url: 'https://github.com/owner/repo/pull/100', number: 100, addedAt: 1200 };
    const { ctx, store } = makeCtx({ [pr1.url]: pr1, [pr2.url]: pr2, [pr3.url]: pr3 });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    vi.spyOn(Date, 'now').mockReturnValue(9000);

    const res = (await caps.setPrsSeen({ urls: [pr1.url, pr2.url, pr3.url], seen: true })) as {
      ok: boolean;
      prs?: MonitoredPr[];
    };

    expect(res.ok).toBe(true);
    const persisted = store[PRS_KEY] as Record<string, MonitoredPr>;
    expect(Object.values(persisted).map((pr) => pr.lastSeenAt)).toEqual([9000, 9000, 9000]);
    expect(ctx.storage.set).toHaveBeenCalledTimes(1);
  });

  it('marks every supplied PR unread in one batch', async () => {
    const pr1 = { ...basePr(), lastSeenAt: 5000 };
    const pr2 = { ...basePr(), url: 'https://github.com/owner/repo/pull/99', number: 99, addedAt: 1100, lastSeenAt: 5000 };
    const pr3 = { ...basePr(), url: 'https://github.com/owner/repo/pull/100', number: 100, addedAt: 1200, lastSeenAt: 5000 };
    const { ctx, store } = makeCtx({ [pr1.url]: pr1, [pr2.url]: pr2, [pr3.url]: pr3 });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.setPrsSeen({ urls: [pr1.url, pr2.url, pr3.url], seen: false })) as {
      ok: boolean;
      prs?: MonitoredPr[];
    };

    expect(res.ok).toBe(true);
    const persisted = store[PRS_KEY] as Record<string, MonitoredPr>;
    expect(Object.values(persisted).map((pr) => pr.lastSeenAt)).toEqual([0, 0, 0]);
    expect(ctx.storage.set).toHaveBeenCalledTimes(1);
  });
});
