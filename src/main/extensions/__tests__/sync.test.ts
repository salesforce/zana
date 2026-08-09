import { describe, it, expect } from 'vitest';
import { syncDiskExtensions, type SyncDeps } from '../sync.js';
import type { DiskExtensionSpec } from '../process-host.js';
import type { LoadedExtensions } from '../loader.js';
import type { ExtensionEntry } from '../../../shared/types.js';

/**
 * `syncDiskExtensions` is the hot-reload reconciler shared by boot + rescan +
 * the file-watcher. The diff is pure given injected seams, so these tests drive
 * it with in-memory fakes — no `utilityProcess`, no real discovery. We assert
 * which children get spawned vs torn down for each disk-state transition, and
 * that boot (empty prev + empty live) and a second identical pass behave right.
 */

function spec(id: string, entryPath = `/ext/${id}/main.mjs`): DiskExtensionSpec {
  return { moduleId: id, entryPath };
}

function entry(id: string): ExtensionEntry {
  return {
    id,
    path: `/ext/${id}`,
    manifest: null,
    enabled: true,
    loaded: true,
    mainActive: false,
    consented: true,
    needsConsent: null
  };
}

/**
 * Build a SyncDeps fake. `desiredSpecs` is what discovery would return this pass;
 * `live` is the set of currently-live ids. spawn/teardown record their calls and
 * mutate `live` so a follow-up `liveModuleIds()` reflects them (mirrors the real
 * host: spawn → live, teardown → not live).
 */
function makeDeps(opts: {
  desiredSpecs: DiskExtensionSpec[];
  live: Set<string>;
}): SyncDeps & { spawnCalls: string[]; teardownCalls: string[] } {
  const live = new Set(opts.live);
  const spawnCalls: string[] = [];
  const teardownCalls: string[] = [];
  const restampEntries = (): ExtensionEntry[] =>
    opts.desiredSpecs.map((s) => ({ ...entry(s.moduleId), mainActive: live.has(s.moduleId) }));
  return {
    spawnCalls,
    teardownCalls,
    loadBoot: async (): Promise<LoadedExtensions> => ({
      entries: opts.desiredSpecs.map((s) => entry(s.moduleId)),
      modules: [],
      diskSpecs: opts.desiredSpecs
    }),
    loadReStamp: async (): Promise<LoadedExtensions> => ({
      entries: restampEntries(),
      modules: [],
      diskSpecs: []
    }),
    liveModuleIds: () => new Set(live),
    spawn: async (s) => {
      spawnCalls.push(s.moduleId);
      live.add(s.moduleId); // spawn is teardown-first → ends live
      return true;
    },
    teardown: async (id) => {
      teardownCalls.push(id);
      live.delete(id);
    },
    log: () => {}
  };
}

describe('syncDiskExtensions', () => {
  it('spawns a newly-appeared consented main extension; tears nothing down', async () => {
    const deps = makeDeps({ desiredSpecs: [spec('alpha')], live: new Set() });
    const res = await syncDiskExtensions(new Map(), deps);

    expect(deps.spawnCalls).toEqual(['alpha']);
    expect(deps.teardownCalls).toEqual([]);
    expect(res.spawned).toEqual(['alpha']);
    expect([...res.diskSpecsById.keys()]).toEqual(['alpha']);
    expect(res.entries.find((e) => e.id === 'alpha')?.mainActive).toBe(true);
  });

  it('tears down an extension removed from disk (in prev, not desired)', async () => {
    const deps = makeDeps({ desiredSpecs: [], live: new Set(['gone']) });
    const prev = new Map([['gone', spec('gone')]]);
    const res = await syncDiskExtensions(prev, deps);

    expect(deps.teardownCalls).toEqual(['gone']);
    expect(deps.spawnCalls).toEqual([]);
    expect(res.tornDown).toEqual(['gone']);
    expect(res.diskSpecsById.size).toBe(0);
  });

  it('tears down a live extension that is no longer desired (disabled/unconsented since)', async () => {
    // It is live and was a prior spec, but discovery no longer returns it
    // (e.g. disabled or consent revoked) → it must be torn down.
    const deps = makeDeps({ desiredSpecs: [], live: new Set(['beta']) });
    const res = await syncDiskExtensions(new Map(), deps);

    expect(deps.teardownCalls).toEqual(['beta']);
    expect(res.tornDown).toEqual(['beta']);
  });

  it('respawns a live extension that is still desired (fresh import on change)', async () => {
    const deps = makeDeps({ desiredSpecs: [spec('alpha')], live: new Set(['alpha']) });
    const prev = new Map([['alpha', spec('alpha')]]);
    const res = await syncDiskExtensions(prev, deps);

    // spawn is teardown-first internally; the contract is that spawn is called.
    expect(deps.spawnCalls).toEqual(['alpha']);
    expect(deps.teardownCalls).toEqual([]); // not an explicit teardown (still desired)
    expect(res.spawned).toEqual(['alpha']);
  });

  it('boot path (empty prev + empty live) spawns every spec and tears down none', async () => {
    const deps = makeDeps({ desiredSpecs: [spec('a'), spec('b')], live: new Set() });
    const res = await syncDiskExtensions(new Map(), deps);

    expect(deps.spawnCalls.sort()).toEqual(['a', 'b']);
    expect(deps.teardownCalls).toEqual([]);
    expect([...res.diskSpecsById.keys()].sort()).toEqual(['a', 'b']);
  });

  it('is idempotent: a second pass with the result map as prev re-spawns desired, tears nothing extra down', async () => {
    // First pass: cold boot of one ext.
    const deps1 = makeDeps({ desiredSpecs: [spec('alpha')], live: new Set() });
    const res1 = await syncDiskExtensions(new Map(), deps1);

    // Second pass: same desired set, now live, prev = res1 map. A watcher re-fire
    // must not tear anything down; respawn of the still-desired ext is expected
    // (cheap + correct — spawn is teardown-first).
    const deps2 = makeDeps({ desiredSpecs: [spec('alpha')], live: new Set(['alpha']) });
    const res2 = await syncDiskExtensions(res1.diskSpecsById, deps2);

    expect(deps2.teardownCalls).toEqual([]);
    expect(deps2.spawnCalls).toEqual(['alpha']);
    expect([...res2.diskSpecsById.keys()]).toEqual(['alpha']);
  });

  it('tears down ANY live id that is not a desired disk spec — so the caller must feed it DISK-ext ids only', async () => {
    // Regression guard for the boot crash where `runDiskSync` fed
    // `moduleRouter.liveModuleIds()` (which unions the trusted in-process
    // built-ins zana + slack) into this reconciler. Since the reconciler tears
    // down anything live that isn't a desired DISK spec, a built-in id present
    // in `live` here gets torn down — which on boot killed zana right after
    // setup and surfaced as the renderer's "Unknown module: zana". This locks
    // in WHY the call site must pass `extProcessHost.liveModuleIds()` (disk
    // children only), never the router's union.
    const deps = makeDeps({ desiredSpecs: [], live: new Set(['zana', 'slack']) });
    const res = await syncDiskExtensions(new Map(), deps);

    expect(deps.teardownCalls.sort()).toEqual(['slack', 'zana']);
    expect(res.tornDown.sort()).toEqual(['slack', 'zana']);
  });

  it('handles a mixed transition: add one, remove one, keep one', async () => {
    const deps = makeDeps({
      desiredSpecs: [spec('keep'), spec('add')],
      live: new Set(['keep', 'drop'])
    });
    const prev = new Map([
      ['keep', spec('keep')],
      ['drop', spec('drop')]
    ]);
    const res = await syncDiskExtensions(prev, deps);

    expect(deps.teardownCalls).toEqual(['drop']);
    expect(deps.spawnCalls.sort()).toEqual(['add', 'keep']);
    expect([...res.diskSpecsById.keys()].sort()).toEqual(['add', 'keep']);
  });
});
