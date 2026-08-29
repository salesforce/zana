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
import { useLocation } from 'react-router-dom';
import { useUi } from '../store.js';
import { useMergedModules } from './index.js';
import { createModuleHost, createMountScopedHost, clearModuleCache } from './host.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import type { AppModule, ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import { listNavPanels } from '../plugins/plugin-slots.js';
import { PluginSlotBoundary } from '../plugins/PluginSlotBoundary.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { useHasPluginNavPanel } from '../plugins/PluginNavPanelHost.js';
import { isSplitWorkspacePath } from '../lib/split-layout/splitThreadNavigation.js';

function generationFor(pluginId: string): number {
  return listNavPanels().find((panel) => panel.pluginId === pluginId)?.generation ?? 0;
}

/**
 * Compiled-in / leftover disk-extension panel. Plugin nav URLs are split
 * workspace routes, so {@link ModulePanelHost} sits out; the split pane falls
 * back here when the plugin never registered a navPanel slot (Docs is the
 * built-in example: UI lives in `apps/app`, `plugins/docs` only ships skills).
 */
export function AppModulePanel({ moduleId }: { moduleId: string }) {
  const modules = useMergedModules();
  const mod = useMemo(() => modules.find((m) => m.id === moduleId), [modules, moduleId]);
  return <ModulePanelBody mod={mod ?? null} extraHostClass="split-plugin-pane" />;
}

function ModulePanelBody({
  mod,
  extraHostClass
}: {
  mod: AppModule | null;
  extraHostClass?: string;
}) {
  const scoped = useMemo(() => (mod ? createMountScopedHost(getHost(mod.id)) : null), [mod]);
  const host: ModuleHost | null = scoped?.host ?? null;
  useEffect(() => () => scoped?.dispose(), [scoped]);

  if (!mod || !host) return null;

  const Panel = mod.panel;
  if (!Panel) {
    return (
      <div className="module-panel-host">
        <div className="module-panel-slot module-no-panel" role="status">
          <p>{mod.title} has no view of its own.</p>
          <p className="module-no-panel-hint">
            It contributes commands and badges — open the command palette (⌘K) to use them.
          </p>
        </div>
      </div>
    );
  }

  const hostClass = extraHostClass ? `module-panel-host ${extraHostClass}` : 'module-panel-host';
  return (
    <div className={hostClass}>
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

export function ModulePanelHost() {
  const nav = useUi((s) => s.nav);
  const route = useRouteState();
  const location = useLocation();
  const modules = useMergedModules();
  const pluginPanel = useHasPluginNavPanel(route.nav || nav);
  const mod = useMemo(() => modules.find((m) => m.id === nav), [modules, nav]);

  if (isSplitWorkspacePath(location.pathname) || pluginPanel) return null;

  return <ModulePanelBody mod={mod ?? null} />;
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
