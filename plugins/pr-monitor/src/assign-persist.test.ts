/**
 * Regression test for the manual project assignment surviving a poll.
 *
 * The bug: `refreshOne` rebuilds each `MonitoredPr` from the live gh poll and
 * originally did not copy `projectId` forward, so the background poll (and the
 * 2s cache tick that mirrors it) silently wiped a user's project assignment
 * within one poll interval — it looked like "selecting a project doesn't stick".
 *
 * These tests drive the PUBLIC `pollAll` / `assignProject` capabilities through
 * the module's `setup(ctx)` surface (refreshOne is internal), with an in-memory
 * storage stub and a mock gh broker, and assert the assignment persists.
 */
import { describe, it, expect, vi } from 'vitest';
import prMonitorMainModule from '../lib/pr-main.js';
import type { MonitoredPr } from '../lib/types.js';
import type { PrMonitorContext, ExecResult } from '../lib/context.js';

// pr-main.ts keys its persisted PR map under this private storage key. It isn't
// exported, so mirror the literal here (a drift guard: if the source key
// changes, these tests fail loudly rather than silently passing on a stale key).
const PRS_KEY = 'prs';

/** A tracked PR with a manual project assignment already in place. */
function seededPr(): MonitoredPr {
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
    projectId: 'proj-123',
    lastSeenAt: undefined,
  };
}

/**
 * A ctx whose storage is an in-memory map seeded with one assigned PR, and whose
 * exec broker returns benign valid gh output so refreshOne completes its rebuild.
 */
function makeCtx(initialPrs: Record<string, MonitoredPr>) {
  const store: Record<string, unknown> = { [PRS_KEY]: initialPrs };
  const exec = async ({ args }: { bin: string; args: string[] }): Promise<ExecResult> => {
    // `gh pr view ... --json state,mergeStateStatus,mergeable,title,baseRefName`
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
    // `gh pr checks ... --json name,state,bucket`
    if (args.includes('checks')) {
      return {
        code: 0,
        stdout: JSON.stringify([{ name: 'Build', state: 'SUCCESS', bucket: 'pass' }]),
        stderr: '',
      };
    }
    // Any landing probe / api call — return empty so classify falls through.
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

describe('pollAll preserves manual project assignment', () => {
  it('keeps projectId after a refresh rebuild', async () => {
    const { ctx, store } = makeCtx({ [seededPr().url]: seededPr() });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.pollAll()) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    const refreshed = res.prs?.find((p) => p.number === 42);
    expect(refreshed?.projectId).toBe('proj-123');
    // And it must be persisted, not just returned.
    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[seededPr().url];
    expect(persisted.projectId).toBe('proj-123');
  });
});

/**
 * R-CORE-004 (AC-CORE-4.1): a user action landing WHILE a poll is mid-flight —
 * after the poll read the map, before it wrote back — must not be lost. The
 * sequential test above proves carry-forward; this drives the TRUE interleaving
 * by gating the poll's gh round-trip on a barrier, firing assignProject while the
 * poll is parked, then releasing the poll and asserting BOTH the user's new
 * projectId and the poll's fresh (non-green) status survive.
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
      await gate; // park the poll here until the test releases it
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
      return {
        code: 0,
        stdout: JSON.stringify([{ name: 'Build', state: 'FAILURE', bucket: 'fail' }]),
        stderr: '',
      };
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

describe('R-CORE-004 concurrent poll + user action', () => {
  it('AC-CORE-4.1: assignProject during an in-flight poll is not lost, and the poll status still lands', async () => {
    const pr = seededPr();
    delete pr.projectId; // start unassigned
    const { ctx, store, started, release } = makeGatedCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    // Start the poll; it parks inside the gh round-trip.
    const pollDone = caps.pollAll() as Promise<{ ok: boolean; prs?: MonitoredPr[] }>;
    await started;

    // User assigns a project WHILE the poll is mid-fetch.
    const assigned = (await caps.assignProject(pr.url, 'proj-777')) as { ok: boolean };
    expect(assigned.ok).toBe(true);

    // Release the poll so it merges + persists over its (now stale) snapshot.
    release();
    await pollDone;

    const persisted = (store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url];
    // User field survives — not reverted to undefined by the stale poll snapshot...
    expect(persisted.projectId).toBe('proj-777');
    // ...AND the poll's fresh status (BLOCKED merge + failing checks) still landed.
    expect(persisted.status).not.toBe('green');
  });
});

describe('assignProject', () => {
  it('sets the projectId and persists it', async () => {
    const pr = seededPr();
    delete pr.projectId;
    const { ctx, store } = makeCtx({ [pr.url]: pr });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = (await caps.assignProject(pr.url, 'proj-999')) as { ok: boolean; prs?: MonitoredPr[] };

    expect(res.ok).toBe(true);
    expect(res.prs?.find((p) => p.number === 42)?.projectId).toBe('proj-999');
    expect((store[PRS_KEY] as Record<string, MonitoredPr>)[pr.url].projectId).toBe('proj-999');
  });

  it('clears the projectId when passed null', async () => {
    const { ctx, store } = makeCtx({ [seededPr().url]: seededPr() });
    const caps = prMonitorMainModule.setup(ctx) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    await caps.assignProject(seededPr().url, null);

    expect((store[PRS_KEY] as Record<string, MonitoredPr>)[seededPr().url].projectId).toBeUndefined();
  });
});
