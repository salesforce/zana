/**
 * Renderer module registry — the single place that lists app modules
 * (plugins/*). Core reads `APP_MODULES` to build the sidebar, the nav union,
 * and the panel switch. Adding a module = appending one import here.
 *
 * Everything else about a module (its panel, its main capabilities, its
 * storage) is reached generically, so no other core file changes.
 */

import { useMemo } from 'react';
import type { AppModule } from '@shared/module-api';
import { slackModule } from '../../../plugins/slack/module';
import { useExtensionModules } from './loader';

// Zana ships as a disk extension, merged in at runtime via
// `useExtensionModules` / `mergeModules` below. It is now a
// FULL disk extension (main + renderer, `extensions/zana/`): its per-project
// Tickets surface reaches ticket/sprint/artifact/profile DATA through its own
// out-of-process main child, which maps each capability onto zana's MCP server
// via the host MCP pool over the brokered `mcp` capability — no more native
// better-sqlite3 pinned to a main-only built-in. Only `slackModule` remains a
// renderer built-in (slack needs in-process timers for the live-bot poll loop
// and a trusted ctx.fetch; promoted from a disk extension — see plugins/slack/).
// See extensions/zana/.
export const APP_MODULES: AppModule[] = [slackModule];

/** Built-in module ids, used to widen the NavId union at runtime. */
export const MODULE_IDS = APP_MODULES.map((m) => m.id);

/** Look up a built-in module by id. Prefer the merged accessors for code that
 *  must also see runtime-loaded extensions. */
export function getModule(id: string): AppModule | undefined {
  return APP_MODULES.find((m) => m.id === id);
}

/**
 * Combine the static built-ins with the runtime-loaded extension modules. A
 * runtime extension may not collide with a built-in id; if one does, the
 * built-in wins (it was registered first and is trusted).
 */
function mergeModules(extensionModules: AppModule[]): AppModule[] {
  if (extensionModules.length === 0) return APP_MODULES;
  const taken = new Set(APP_MODULES.map((m) => m.id));
  const extras = extensionModules.filter((m) => !taken.has(m.id));
  return extras.length === 0 ? APP_MODULES : [...APP_MODULES, ...extras];
}

/**
 * Reactive merged module set (built-ins + runtime extensions). The single
 * source the shell's nav-aware surfaces (Sidebar, App title, ListPane,
 * ModulePanelHost) consume so built-ins and extensions are treated uniformly.
 * Memoised against the raw extension slice to keep a stable reference (avoids
 * the zustand fresh-array selector trap).
 */
export function useMergedModules(): AppModule[] {
  const extensionModules = useExtensionModules((s) => s.modules);
  return useMemo(() => mergeModules(extensionModules), [extensionModules]);
}

/** Imperative merged-module lookup for non-React call sites. */
export function getMergedModule(id: string): AppModule | undefined {
  return mergeModules(useExtensionModules.getState().modules).find((m) => m.id === id);
}

/** Reactive merged-module lookup by id (built-ins + runtime extensions). */
export function useMergedModule(id: string): AppModule | undefined {
  const merged = useMergedModules();
  return useMemo(() => merged.find((m) => m.id === id), [merged, id]);
}

/**
 * The merged modules that opted into a PER-PROJECT TAB (declared `projectTab`),
 * sorted into the order their tabs should appear: ascending by
 * `projectTab.order` (default 100), then by id for a stable tie-break. Core's
 * Workspace / per-project rail append one tab per entry AFTER the built-in
 * project tabs. A module qualifies only if it also has a `panel` (the loader
 * already drops `projectTab` from a panel-less module). Generic — no module-id
 * literal (Rule 6).
 */
export function selectProjectTabModules(modules: AppModule[]): AppModule[] {
  return modules
    .filter((m) => m.projectTab && m.panel)
    .sort(
      (a, b) =>
        (a.projectTab?.order ?? 100) - (b.projectTab?.order ?? 100) ||
        a.id.localeCompare(b.id)
    );
}

/** Reactive set of project-tab modules (built-ins + runtime extensions). */
export function useProjectTabModules(): AppModule[] {
  const merged = useMergedModules();
  return useMemo(() => selectProjectTabModules(merged), [merged]);
}

/** Imperative project-tab module set for non-React call sites. */
export function getProjectTabModules(): AppModule[] {
  return selectProjectTabModules(mergeModules(useExtensionModules.getState().modules));
}

/** Imperative merged id set (built-ins + currently-loaded extensions). */
export function getMergedModuleIds(): string[] {
  return mergeModules(useExtensionModules.getState().modules).map((m) => m.id);
}
