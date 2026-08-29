/**
 * Tests for the per-PR favorite main capabilities (R-LIST-026).
 *
 * Covers: setPrFavorite / setPrsFavorite happy path, the R-CORE-004 field-carry
 * (a poll must not wipe `favorite`), the own-property / prototype-pollution guard
 * (a crafted `__proto__` URL can't mutate the prototype), the bulk cap, and the
 * concurrent poll + favorite interleaving.
 */
import { describe, it, expect, vi } from 'vitest';
import prMonitorMainModule from '../lib/pr-main.js';
import type { MonitoredPr } from '../lib/types.js';
import type { PrMonitorContext, ExecResult } from '../lib/context.js';

const PRS_KEY = 'prs';

function seededPr(over: Partial<MonitoredPr> = {}): MonitoredPr {
  return {
    url: 'https://github.com/owner/repo/pull/42',
    repo: 'owner/repo',
    number: 42,
    title: 'Add widget',
    baseRefName: 'main',
    status: 'green',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [{ name: 'Build', state: 'SUCCESS', bucket: 'pass' }],
    addedAt: 1,
    lastChecked: 1,
    lastStatusChange: 1,
    ...over,
  };
}

function makeCtx(initialPrs: Record<string, MonitoredPr>) {
  const store: Record<string, unknown> = { [PRS_KEY]: initialPrs };
  const exec = async ({ args }: { bin: string; args: string[] }): Promise<ExecResult> => {
    if (args.includes('view')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          mergeable: 'MERGEABLE',
          title: 'Add widget',
          baseRefName: 'main',
        }),
        stderr: '',
      };
    }
    if (args.includes('checks')) {
      return { code: 0, stdout: JSON.stringify([{ name: 'Build', state: 'SUCCESS', bucket: 'pass' }]), stderr: '' };
    }
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

type Caps = Record<string, (...a: unknown[]) => Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }>>;

describe('setPrFavorite (R-LIST-026)', () => {
  it('sets and clears favorite, persisting to storage', async () => {
    const pr = seededPr();
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    const on = await caps.setPrFavorite({ url: pr.url, favorite: true });
    expect(on.ok).toBe(true);
    expect((store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url].favorite).toBe(true);

    const off = await caps.setPrFavorite({ url: pr.url, favorite: false });
    expect(off.ok).toBe(true);
    expect((store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url].favorite).toBe(false);
  });

  it('rejects an unknown URL without mutating the map', async () => {
    const pr = seededPr();
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    const res = await caps.setPrFavorite({ url: 'https://github.com/owner/repo/pull/999', favorite: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('rejects a missing URL', async () => {
    const { ctx } = makeCtx({});
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;
    const res = await caps.setPrFavorite({ url: '   ', favorite: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/missing/i);
  });

  it('rejects a prototype-chain trap URL (no prototype pollution)', async () => {
    const pr = seededPr();
    const { ctx } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    for (const trap of ['__proto__', 'constructor', 'prototype']) {
      const res = await caps.setPrFavorite({ url: trap, favorite: true });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/i);
    }
    // The Object prototype was never touched.
    expect(({} as Record<string, unknown>).favorite).toBeUndefined();
  });
});

describe('setPrMuted (R-LIST-018) own-property guard', () => {
  it('rejects a prototype-chain trap URL (no prototype pollution)', async () => {
    const pr = seededPr();
    const { ctx } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    for (const trap of ['__proto__', 'constructor', 'prototype']) {
      const res = await caps.setPrMuted({ url: trap, muted: true });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/i);
    }
    // The Object prototype was never touched.
    expect(({} as Record<string, unknown>).muted).toBeUndefined();
  });

  it('mutes a real PR and rejects an unknown URL', async () => {
    const pr = seededPr();
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    const on = await caps.setPrMuted({ url: pr.url, muted: true });
    expect(on.ok).toBe(true);
    expect((store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url].muted).toBe(true);

    const miss = await caps.setPrMuted({ url: 'https://github.com/owner/repo/pull/999', muted: true });
    expect(miss.ok).toBe(false);
    expect(miss.error).toMatch(/not found/i);
  });
});

describe('setPrsFavorite bulk (R-LIST-026 / DR-2)', () => {
  it('sets favorite for a batch in one call, skipping unknown URLs', async () => {
    const a = seededPr({ url: 'https://github.com/o/r/pull/1', number: 1 });
    const b = seededPr({ url: 'https://github.com/o/r/pull/2', number: 2 });
    const { ctx, store } = makeCtx({ [a.url]: a, [b.url]: b });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    const res = await caps.setPrsFavorite({
      urls: [a.url, b.url, 'https://github.com/o/r/pull/404'],
      favorite: true,
    });
    expect(res.ok).toBe(true);
    const persisted = store[PRS_KEY] as Record<string, MonitoredPr>;
    expect(persisted[a.url].favorite).toBe(true);
    expect(persisted[b.url].favorite).toBe(true);
    // storage.set called exactly once — one write over the batch.
    expect((ctx.storage.set as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('clears favorite for a batch', async () => {
    const a = seededPr({ url: 'https://github.com/o/r/pull/1', number: 1, favorite: true });
    const b = seededPr({ url: 'https://github.com/o/r/pull/2', number: 2, favorite: true });
    const { ctx, store } = makeCtx({ [a.url]: a, [b.url]: b });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    await caps.setPrsFavorite({ urls: [a.url, b.url], favorite: false });
    const persisted = store[PRS_KEY] as Record<string, MonitoredPr>;
    expect(persisted[a.url].favorite).toBe(false);
    expect(persisted[b.url].favorite).toBe(false);
  });

  it('ignores prototype-chain traps in the batch', async () => {
    const a = seededPr({ url: 'https://github.com/o/r/pull/1', number: 1 });
    const { ctx, store } = makeCtx({ [a.url]: a });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    const res = await caps.setPrsFavorite({ urls: ['__proto__', 'constructor', a.url], favorite: true });
    expect(res.ok).toBe(true);
    expect((store[PRS_KEY] as Record<string, MonitoredPr>)[a.url].favorite).toBe(true);
    expect(({} as Record<string, unknown>).favorite).toBeUndefined();
  });

  it('caps the batch at BULK_URL_CAP (500) URLs', async () => {
    // Seed 501 PRs; the 501st must be left untouched by one bulk call.
    const prs: Record<string, MonitoredPr> = {};
    const urls: string[] = [];
    for (let i = 0; i < 501; i++) {
      const url = `https://github.com/o/r/pull/${i}`;
      prs[url] = seededPr({ url, number: i });
      urls.push(url);
    }
    const { ctx, store } = makeCtx(prs);
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    await caps.setPrsFavorite({ urls, favorite: true });
    const persisted = store[PRS_KEY] as Record<string, MonitoredPr>;
    expect(persisted[urls[499]].favorite).toBe(true);
    // The 501st URL exceeds the cap and was not mutated.
    expect(persisted[urls[500]].favorite).toBeUndefined();
  });

  it('tolerates a non-array urls param', async () => {
    const { ctx } = makeCtx({});
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;
    const res = await caps.setPrsFavorite({ urls: undefined as unknown as string[], favorite: true });
    expect(res.ok).toBe(true);
  });
});

describe('favorite survives a poll (R-CORE-004 field carry)', () => {
  it('keeps favorite after a refresh rebuild', async () => {
    const pr = seededPr({ favorite: true });
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    const res = await caps.pollAll();
    expect(res.ok).toBe(true);
    expect((store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url].favorite).toBe(true);
  });
});

/**
 * R-CORE-004 interleaving: a favorite toggle landing WHILE a poll is mid-flight
 * (after the poll read the map, before it wrote back) must not be lost, and the
 * poll's fresh status must still land.
 */
function makeGatedCtx(initialPrs: Record<string, MonitoredPr>) {
  const store: Record<string, unknown> = { [PRS_KEY]: initialPrs };
  let releaseGate: (() => void) | null = null;
  let signalStarted: (() => void) | null = null;
  const gate = new Promise<void>((r) => {
    releaseGate = r;
  });
  const started = new Promise<void>((r) => {
    signalStarted = r;
  });
  const ghBroker = async ({ args }: { bin: string; args: string[] }): Promise<ExecResult> => {
    if (args.includes('view')) {
      signalStarted?.();
      await gate;
      return {
        code: 0,
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'BLOCKED',
          mergeable: 'MERGEABLE',
          title: 'Add widget',
          baseRefName: 'main',
        }),
        stderr: '',
      };
    }
    if (args.includes('checks')) {
      return { code: 0, stdout: JSON.stringify([{ name: 'Build', state: 'FAILURE', bucket: 'fail' }]), stderr: '' };
    }
    return { code: 0, stdout: '[]', stderr: '' };
  };
  const ctx: PrMonitorContext = {
    moduleId: 'pr-monitor',
    exec: ghBroker as PrMonitorContext['exec'],
    log: vi.fn(),
    storage: {
      get: vi.fn(async (key: string) => store[key]),
      set: vi.fn((key: string, value: unknown) => {
        store[key] = value;
      }),
    } as unknown as PrMonitorContext['storage'],
    cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as PrMonitorContext['cache'],
  };
  return { ctx, store, started, release: () => releaseGate?.() };
}

describe('R-CORE-004 concurrent poll + setPrFavorite', () => {
  it('a favorite toggle during an in-flight poll is not lost, and the poll status still lands', async () => {
    const pr = seededPr();
    delete pr.favorite;
    const { ctx, store, started, release } = makeGatedCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as unknown as Caps;

    const pollDone = caps.pollAll();
    await started;

    const toggled = await caps.setPrFavorite({ url: pr.url, favorite: true });
    expect(toggled.ok).toBe(true);

    release();
    await pollDone;

    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    expect(persisted.favorite).toBe(true);
    expect(persisted.status).not.toBe('green');
  });
});
