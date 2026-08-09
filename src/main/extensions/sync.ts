/**
 * Disk-extension reconciliation (hot-reload). One helper that both BOOT and a
 * live RESCAN (the "Reload" button + the `~/.zcc/extensions` file-watcher) call,
 * so a freshly installed / changed / removed extension takes effect WITHOUT an
 * app restart.
 *
 * The hard part is the diff: discovery gives the DESIRED set (every enabled,
 * compatible, CONSENTED main-bearing extension → a `DiskExtensionSpec`); the
 * process host knows the LIVE set (children that reported ready). This helper
 * reconciles the two against the PREVIOUS spec set:
 *   - removed  (was a spec / is live, no longer desired) → teardown the child.
 *   - desired  (every spec) → `spawn(spec)`. `ExtensionProcessHost.spawn` already
 *     tears down any existing child first and clears the crash record, so a live
 *     extension whose code changed gets a FRESH `import()` (no ESM-URL staleness)
 *     and a not-yet-live one is simply started. Respawning the small main-bearing
 *     set on a disk change is cheap; we deliberately DON'T hash dirs to find the
 *     one that changed (unbounded I/O on the main loop — rule #5).
 *
 * Boot is just "rescan with an empty previous + empty live set" → it spawns every
 * spec and tears nothing down, exactly as the old inline boot block did.
 *
 * Electron-free + I/O-injected (`SyncDeps`) so the diff is unit-testable with
 * fakes — no `utilityProcess`, no real discovery. Names no concrete extension id
 * (rule #6): it only iterates the discovered spec set.
 */

import type { ExtensionEntry } from '../../shared/types.js';
import type { DiskExtensionSpec } from './process-host.js';
import type { LoadedExtensions } from './loader.js';

type LogFn = (message: string, err?: unknown) => void;

/**
 * Injected seams. The host builds these from its existing closures
 * (`loadExtensions`, `moduleRouter`, `extProcessHost`); tests pass fakes.
 */
export interface SyncDeps {
  /** Boot-mode discovery → `{ entries, diskSpecs }` (the desired spec set). */
  loadBoot: () => Promise<LoadedExtensions>;
  /** Re-discovery mode: re-stamp `mainActive` from the given live id set. */
  loadReStamp: (live: ReadonlySet<string>) => Promise<LoadedExtensions>;
  /** Ids whose child is live AND completed setup, right now. */
  liveModuleIds: () => Set<string>;
  /** Start (or restart — spawn tears down first) one disk extension's child. */
  spawn: (spec: DiskExtensionSpec) => Promise<boolean>;
  /** Tear down one child (no-op for an unknown id). */
  teardown: (id: string) => Promise<void>;
  log: LogFn;
}

export interface SyncResult {
  /** Re-stamped renderer entries to publish via `extensions:onChanged`. */
  entries: ExtensionEntry[];
  /** The new authoritative spec set, keyed by id — becomes the next `prevSpecs`. */
  diskSpecsById: Map<string, DiskExtensionSpec>;
  /** Ids whose child was (re)spawned this pass — for logging. */
  spawned: string[];
  /** Ids torn down this pass (removed / disabled / unconsented since) — for logging. */
  tornDown: string[];
}

/**
 * Reconcile live disk-extension children against what discovery now wants.
 *
 * @param prevSpecs the spec set from the LAST sync (boot passes an empty map).
 * @returns the re-stamped entries + the new spec map (assign it back as the next
 *          `prevSpecs`) + which ids were (re)spawned / torn down.
 */
export async function syncDiskExtensions(
  prevSpecs: ReadonlyMap<string, DiskExtensionSpec>,
  deps: SyncDeps
): Promise<SyncResult> {
  // 1. Desired state: discovery's boot-mode spec set (enabled + compatible +
  //    consented main-bearing exts). Renderer-only / unconsented exts yield no
  //    spec — they need no child.
  const { diskSpecs } = await deps.loadBoot();
  const nextSpecs = new Map<string, DiskExtensionSpec>();
  for (const spec of diskSpecs) nextSpecs.set(spec.moduleId, spec);

  // 2. Live children right now.
  const live = deps.liveModuleIds();

  // 3. Teardown: anything that WAS a spec or is currently live but is no longer
  //    desired (disabled / unconsented / deleted / now version-incompatible).
  const tornDown: string[] = [];
  const toTeardown = new Set<string>();
  for (const id of prevSpecs.keys()) if (!nextSpecs.has(id)) toTeardown.add(id);
  for (const id of live) if (!nextSpecs.has(id)) toTeardown.add(id);
  for (const id of toTeardown) {
    try {
      await deps.teardown(id);
      tornDown.push(id);
    } catch (err) {
      deps.log(`extension sync: teardown ${id} failed`, err);
    }
  }

  // 4. (Re)spawn every desired spec. `spawn` is teardown-first + clears the crash
  //    record, so this both STARTS a newly-appeared/consented ext and RESTARTS a
  //    live one with fresh code. Isolated per-spec: one bad ext can't abort the rest.
  const spawned: string[] = [];
  for (const spec of nextSpecs.values()) {
    try {
      await deps.spawn(spec);
      spawned.push(spec.moduleId);
    } catch (err) {
      deps.log(`extension sync: spawn ${spec.moduleId} failed`, err);
    }
  }

  // 5. Re-stamp `mainActive` from the now-current live set (a child that failed
  //    to come up reads `mainActive:false` and the renderer surfaces the hint).
  const { entries } = await deps.loadReStamp(deps.liveModuleIds());

  return { entries, diskSpecsById: nextSpecs, spawned, tornDown };
}
