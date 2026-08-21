/**
 * Renders the active app-module's panel. Reads the current nav, looks up the
 * matching module in the MERGED registry (built-ins + runtime-loaded
 * extensions), and mounts its panel with a per-module `ModuleHost`. Renders
 * nothing when nav points at a core panel.
 *
 * Hosts are memoised per module id so a module's panel keeps a stable host
 * reference across re-renders (its effects depend on `host`). The cache is
 * evicted via `evictHost` when an extension is disabled/removed so a later
 * re-enable gets a fresh host (and the stale one is dropped).
 *
 * Every mounted panel is wrapped in an `ErrorBoundary` so a runtime extension
 * that throws while rendering is contained to its own slot and never crashes
 * the shell — mirroring the import/activate isolation in `loader.ts`.
 */

import { useEffect, useMemo } from 'react';
import { useUi } from '../store.js';
import { useMergedModules } from './index.js';
import { createModuleHost, createMountScopedHost, clearModuleCache } from './host.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import type { ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import { listNavPanels } from '../plugins/plugin-slots.js';
import { PluginSlotBoundary } from '../plugins/PluginSlotBoundary.js';
import { AppPageHeader } from '../components/AppPageHeader.js';

function generationFor(pluginId: string): number {
  return listNavPanels().find((panel) => panel.pluginId === pluginId)?.generation ?? 0;
}

export function ModulePanelHost() {
  const nav = useUi((s) => s.nav);
  const modules = useMergedModules();
  const mod = useMemo(() => modules.find((m) => m.id === nav), [modules, nav]);

  // W1-6: wrap the cached base host in a per-MOUNT cleanup scope so the panel's
  // `on`/`subscribe`/`register` subscriptions auto-dispose when this panel
  // unmounts (nav switch / module change). Re-created per module id; the base
  // host + its cache/storage are still the shared singleton.
  const scoped = useMemo(() => (mod ? createMountScopedHost(getHost(mod.id)) : null), [mod]);
  const host: ModuleHost | null = scoped?.host ?? null;
  useEffect(() => () => scoped?.dispose(), [scoped]);

  if (!mod || !host) return null;

  // As of the Phase 2 contract `panel` is optional: a module may contribute
  // only `commands` and/or a `navBadge`. Such a module still owns a nav entry
  // (for its badge + palette commands), so selecting it must not crash —
  // ListPane has already bowed out of the content area for any merged module.
  // We render a tasteful placeholder rather than nothing so the empty content
  // area doesn't read as a broken view.
  const Panel = mod.panel;
  if (!Panel) {
    return (
      <div className="module-panel-host">
        <AppPageHeader title={<h1>{mod.title}</h1>} />
        <div className="module-panel-slot module-no-panel" role="status">
          <p>{mod.title} has no view of its own.</p>
          <p className="module-no-panel-hint">
            It contributes commands and badges — open the command palette (⌘K) to use them.
          </p>
        </div>
      </div>
    );
  }

  // Own the shell-grid placement HERE so every extension panel fills the content
  // area (columns 2→3, full height) without each extension having to know the
  // app-shell's grid secret. The list column returns null for a module nav, so a
  // bare panel would otherwise auto-place into the narrow list track (col 2) and
  // leave col 3 empty. This slot spans both — the extension's own root just needs
  // to fill 100% (which `width:auto`/block already does inside a stretched slot).
  return (
    <div className="module-panel-host">
      <AppPageHeader title={<h1>{mod.title}</h1>} />
      <div className="module-panel-slot panel-body--full">
        <PluginSlotBoundary pluginId={mod.id} generation={generationFor(mod.id)}>
          <ErrorBoundary key={`${mod.id}:${generationFor(mod.id)}`}>
            <Panel host={host} />
          </ErrorBoundary>
        </PluginSlotBoundary>
      </div>
    </div>
  );
}

const hosts = new Map<string, ModuleHost>();

/**
 * The single cached `ModuleHost` for a module id, created on first use. Shared
 * with the extension loader so a runtime panel's `activate()` closes over the
 * SAME host instance that ModulePanelHost later injects as the `host` prop —
 * one host per module, so `evictHost` actually releases what the panel holds.
 */
export function getHost(moduleId: string): ModuleHost {
  let h = hosts.get(moduleId);
  if (!h) {
    h = createModuleHost(moduleId);
    hosts.set(moduleId, h);
  }
  return h;
}

/**
 * Drop a module's cached host AND its in-memory `host.cache`. Called by the
 * extension loader when an extension is disabled or removed, so its host (and
 * any closed-over state) is released and a later re-enable builds a fresh one.
 * Clearing the cache here keeps the cache lifecycle matched to the host's — a
 * removed extension must not leave stale scratch data behind to leak (or to be
 * silently re-read on a later re-enable).
 */
export function evictHost(moduleId: string): void {
  hosts.delete(moduleId);
  clearModuleCache(moduleId);
}
