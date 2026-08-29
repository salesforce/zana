/**
 * Main-side runtime load for discovered extensions. For each enabled,
 * version-compatible extension that declares `entry.main`, dynamically import
 * the module, take its `default` export as a `MainModule`, and collect it so
 * core can feed it into the EXISTING `moduleHost.setupAll([...MAIN_MODULES,
 * ...discovered])` (merge, never replace).
 *
 * Failures are isolated per-extension — a bad import must not break boot or
 * sibling extensions, mirroring `setupAll`'s own try/catch isolation. A failed
 * import stamps the entry's `error` to `main-load-failed` and `loaded:false`.
 *
 * Electron-free: it only does dynamic ESM imports + path work, so a test can
 * exercise it without mocking `app`.
 */

import type { MainModule } from '@zana-ai/zcc-extension-sdk/main';
import { pathToFileURL } from 'node:url';
import { discoverExtensions, toEntry } from './discovery.js';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import type { DiskExtensionSpec } from './process-host.js';

type LogFn = (message: string, err?: unknown) => void;
const noopLog: LogFn = () => {};

export interface LoadedExtensions {
  /** Renderer-facing entries (manifest + enabled + loaded + mainActive + error). */
  entries: ExtensionEntry[];
  /**
   * Main modules to merge into `moduleHost.setupAll`. Always EMPTY now: under
   * P3-A disk-extension main code is NEVER imported into the Electron main
   * process. It is spawned out-of-process instead — see `diskSpecs`. The field
   * is retained (empty) so the boot caller's destructure keeps compiling and a
   * future trusted-disk path could repopulate it.
   */
  modules: MainModule[];
  /**
   * Disk extensions to spawn out-of-process: each enabled, compatible,
   * main-bearing extension's id + resolved absolute main entry path. The host
   * forks one `utilityProcess` per spec via `ExtensionProcessHost.spawn`. The
   * untrusted `import()` happens in that child, never here.
   */
  diskSpecs: DiskExtensionSpec[];
}

export interface LoadOptions {
  log?: LogFn;
  /**
   * When provided, the loader runs in **re-discovery mode**: it does NOT
   * collect any spawn spec. Instead it stamps each main-bearing entry's
   * `mainActive` from this set — the ids whose `utilityProcess` child is live
   * right now (the union of in-process built-ins + live out-of-process children,
   * supplied by the router's `liveModuleIds`). A disk extension's main side is
   * relaunch-required to (re)activate, so a re-enabled-but-not-relaunched
   * extension correctly reads `mainActive:false` and the renderer surfaces a
   * relaunch hint.
   *
   * Omit on the BOOT path: the loader collects a spawn spec per main-bearing
   * extension; the caller forks one child per spec. `mainActive` is left false
   * here (no child has reported ready yet) and re-stamped from the live set.
   */
  activeMainIds?: ReadonlySet<string>;
  /**
   * Built-in module ids (the `MAIN_MODULES`/`APP_MODULES` set). A disk
   * extension whose id collides with one of these is rejected at discovery —
   * it would otherwise shadow a trusted in-process module for main-side
   * dispatch. Forwarded to {@link discoverExtensions}; when omitted, discovery
   * falls back to its conservative `RESERVED_BUILTIN_IDS` default.
   */
  reservedIds?: ReadonlySet<string>;
}

/**
 * Discover extensions and resolve each one's main-side state.
 *
 * BOOT path (no `activeMainIds`): for each enabled, compatible, CONSENTED
 * extension that declares `entry.main`, collect a `DiskExtensionSpec` (id +
 * resolved entry path). The loader DOES NOT import the module — under P3-A the
 * untrusted `import()` happens in a per-extension `utilityProcess`, never in
 * main. The caller spawns one child per spec and re-stamps `mainActive` from the
 * live set. P3-D: an enabled-but-UNCONSENTED (or permission-widened) extension
 * is NOT spawned — consent precedes any code running — so it yields no spec and
 * stays `mainActive:false` until the user approves.
 *
 * RE-DISCOVERY path (`activeMainIds` provided): collect no specs — re-read the
 * manifests/enabled-map and stamp each main-bearing entry's `mainActive` from
 * the live set. A re-enabled-but-not-relaunched extension reads
 * `mainActive:false`.
 */
export async function loadExtensions(opts: LoadOptions = {}): Promise<LoadedExtensions> {
  const log = opts.log ?? noopLog;
  const reDiscover = opts.activeMainIds !== undefined;
  const activeMainIds = opts.activeMainIds ?? new Set<string>();

  const discovered = await discoverExtensions(log, opts.reservedIds);
  const modules: MainModule[] = [];
  const entries: ExtensionEntry[] = [];

  for (const ext of discovered) {
    const entry = toEntry(ext);
    // Install = full trust. Consent grants are not part of the plugin model.
    entry.consented = true;
    entry.needsConsent = null;
    if (ext.mainEntryPath && ext.loaded && ext.enabled) {
      if (reDiscover) {
        entry.mainActive = activeMainIds.has(ext.id) || modules.some((m) => m.id === ext.id);
      } else {
        try {
          const imported = (await import(pathToFileURL(ext.mainEntryPath).href)) as {
            default?: MainModule;
          };
          if (imported.default && typeof imported.default.setup === 'function') {
            modules.push(imported.default);
            entry.mainActive = true;
          }
        } catch (err) {
          log(`main-load-failed: ${ext.id}`, err);
          entry.error = 'main-load-failed';
          entry.loaded = false;
          entry.mainActive = false;
        }
      }
    }
    entries.push(entry);
  }

  return { entries, modules, diskSpecs: [] };
}
