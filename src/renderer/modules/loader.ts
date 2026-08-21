/**
 * Runtime extension loader (P1-C). Turns the enabled, loaded, renderer-bearing
 * extensions reported by `window.cc.extensions` into `AppModule`s that the
 * shell treats identically to the static built-ins in `./index`.
 *
 * Loading is async (read bundle string → blob → dynamic import → activate), so
 * the result lands in a Zustand store (`useExtensionModules`) and triggers a
 * re-render. The merged set (built-ins + these) is what Sidebar / ListPane /
 * App / ModulePanelHost actually consume — see `getMergedModules`.
 *
 * Each panel is built closed over the HOST's React instance (passed into
 * `activate`) so its hooks resolve against the host React tree — never a second
 * copy (which would throw "Invalid hook call"). A panel that throws during
 * import/activate is isolated to a small error surface in its own slot and
 * never crashes the shell.
 */

import * as React from 'react';
import { create } from 'zustand';
import type { AppModule } from '@shared/module-api';
import type { ActivateResult, RendererEntry } from '@zana-ai/zcc-extension-sdk/renderer';
import type { ExtensionEntry } from '@shared/types';
import { isPluginAppDefinition } from '@zana-ai/zcc-plugin-sdk';
import type { PluginRegistrationSet } from '@zana-ai/zcc-plugin-sdk';
import { interpretPluginApp } from '../plugins/plugin-slots';
import { PluginSlotBoundary } from '../plugins/PluginSlotBoundary';
import { evictHost, getHost } from './ModulePanelHost';
import { setExtensionGrants } from './host';

/**
 * A runtime-loaded extension module. Either a successfully-activated panel
 * (`panel` set) or a load failure (`error` set, `panel` an error surface).
 * Both are real `AppModule`s so the merged set is uniform — a failed extension
 * still shows its nav entry, but its panel renders the failure rather than
 * crashing the shell.
 */
export interface ExtensionModule extends AppModule {
  /** Present when import/activate failed; the panel renders this message. */
  loadError?: string;
}

interface ExtensionModulesState {
  /** Successfully discovered + activated (or error-surfaced) extension modules. */
  modules: ExtensionModule[];
  setModules: (modules: ExtensionModule[]) => void;
}

/**
 * Live store of runtime-loaded extension modules. Kept separate from the static
 * `APP_MODULES` registry; `getMergedModules` / `useMergedModules` combine them.
 */
export const useExtensionModules = create<ExtensionModulesState>((set) => ({
  modules: [],
  setModules: (modules) => set({ modules })
}));

/**
 * Build a tiny error-surface panel for an extension that failed to load. Mirrors
 * MainModuleHost's per-module isolation: the failure is contained to this slot.
 */
function makeErrorModule(entry: ExtensionEntry, message: string): ExtensionModule {
  const title = entry.manifest?.title ?? entry.id;
  const Panel: React.ComponentType = () =>
    React.createElement(
      'main',
      { className: 'settings-panel' },
      React.createElement(
        'div',
        { className: 'settings-inner' },
        React.createElement('h2', null, `${title} failed to load`),
        React.createElement(
          'pre',
          { style: { whiteSpace: 'pre-wrap', color: 'var(--danger)' } },
          message
        )
      )
    );
  return {
    id: entry.id,
    title,
    icon: entry.manifest?.icon ?? 'HelpCircle',
    titleLabel: entry.manifest?.titleLabel,
    panel: Panel,
    loadError: message
  };
}

function appModuleFromPluginSet(entry: ExtensionEntry, set: PluginRegistrationSet): ExtensionModule {
  const title = entry.manifest?.title ?? entry.id;
  const nav = set.navPanels[0];
  const settings = set.settingsSections[0];
  const projectTab = set.projectTabs[0];
  const Panel = nav
    ? function PluginNavPanel() {
        const Component = nav.component;
        return React.createElement(
          PluginSlotBoundary,
          { pluginId: entry.id, generation: nav.generation },
          React.createElement(Component, { pluginId: entry.id, subPath: '' })
        );
      }
    : undefined;
  const Settings = settings
    ? function PluginSettingsPanel() {
        const Component = settings.component;
        return React.createElement(
          PluginSlotBoundary,
          { pluginId: entry.id, generation: settings.generation },
          React.createElement(Component, { pluginId: entry.id })
        );
      }
    : undefined;
  return {
    id: entry.id,
    title: nav?.title ?? title,
    icon: nav?.icon ?? entry.manifest?.icon ?? 'Puzzle',
    titleLabel: entry.manifest?.titleLabel,
    panel: Panel,
    settingsPanel: Settings,
    projectTab: projectTab
      ? {
          label: projectTab.label,
          icon: projectTab.icon,
          order: projectTab.order,
          global: projectTab.global
        }
      : entry.manifest?.projectTab
  };
}

/** The subset of `AppModule` an `activate()` return contributes to the module. */
type NormalizedActivate = Pick<ActivateResult, 'panel' | 'settingsPanel' | 'background' | 'commands' | 'navBadge'>;

/**
 * Pure: normalize whatever `RendererEntry.activate()` returned into the uniform
 * `{ panel?, settingsPanel?, background?, commands?, navBadge? }` shape the loader copies onto
 * the built `ExtensionModule`. Backward-compatible:
 *
 *   - a **function/class** (a React component) → `{ panel: <it> }` (the original,
 *     bare-component return shape);
 *   - an **exotic component object** — `React.lazy` / `memo` / `forwardRef`
 *     return objects (tagged with `$$typeof`), which are valid components but
 *     not plain ActivateResults → `{ panel: <it> }`, preserving the original
 *     code path that accepted object components;
 *   - a **plain ActivateResult object** → its `panel` / `settingsPanel` /
 *     `background` / `commands` / `navBadge` are read through (each only when it has the right
 *     runtime type, so a malformed field is dropped rather than trusted);
 *   - **anything else** (null, string, number, …) → `{}` (the caller treats an
 *     empty result, i.e. no panel, as a load failure and error-surfaces it).
 *
 * Kept side-effect-free and host-agnostic so it's unit-testable in isolation.
 */
export function normalizeActivateResult(result: unknown): NormalizedActivate {
  // A React component is a function (function/arrow component) or, rarely, a
  // class — both are `typeof 'function'`. This is the original return shape.
  if (typeof result === 'function') {
    return { panel: result as ActivateResult['panel'] };
  }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    // React.lazy/memo/forwardRef components are objects carrying a `$$typeof`
    // tag rather than panel/commands/navBadge — treat them as the panel itself,
    // matching the pre-existing object-component code path.
    if (
      '$$typeof' in r &&
      !('panel' in r) &&
      !('settingsPanel' in r) &&
      !('background' in r) &&
      !('commands' in r) &&
      !('navBadge' in r)
    ) {
      return { panel: r as unknown as ActivateResult['panel'] };
    }
    const out: NormalizedActivate = {};
    if (typeof r.panel === 'function' || (r.panel && typeof r.panel === 'object' && '$$typeof' in (r.panel as object))) {
      out.panel = r.panel as ActivateResult['panel'];
    }
    if (
      typeof r.settingsPanel === 'function' ||
      (r.settingsPanel && typeof r.settingsPanel === 'object' && '$$typeof' in (r.settingsPanel as object))
    ) {
      out.settingsPanel = r.settingsPanel as ActivateResult['settingsPanel'];
    }
    if (
      typeof r.background === 'function' ||
      (r.background && typeof r.background === 'object' && '$$typeof' in (r.background as object))
    ) {
      out.background = r.background as ActivateResult['background'];
    }
    if (typeof r.commands === 'function') out.commands = r.commands as ActivateResult['commands'];
    if (typeof r.navBadge === 'function') out.navBadge = r.navBadge as ActivateResult['navBadge'];
    return out;
  }
  return {};
}

/**
 * Load one extension's renderer bundle into an `ExtensionModule`. Returns an
 * error module (never throws) when the bundle is missing or fails to
 * import/activate, so one bad extension can't abort the whole reconcile.
 */
async function loadExtensionModule(entry: ExtensionEntry): Promise<ExtensionModule> {
  const manifest = entry.manifest;
  if (!manifest) return makeErrorModule(entry, 'Missing manifest.');
  let blobUrl: string | null = null;
  try {
    const js = await window.cc.extensions.readRendererEntry(entry.id);
    if (js == null) {
      return makeErrorModule(entry, 'Renderer bundle could not be read.');
    }
    blobUrl = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
    // Expose the host's React on a global BEFORE importing the bundle. A blob
    // import has no import map, so a bundle that ships shims for `react` /
    // `react/jsx-runtime` (instead of leaving them as unresolvable bare imports)
    // reads the host React from here. activate({ React }) also provides it, but
    // a bundled dep can call a React API at MODULE-EVAL time — BEFORE activate —
    // e.g. lucide-react's icon factory calls `forwardRef` at import. Setting the
    // global up front covers that eval-time window so such bundles import
    // cleanly. Bundles that import nothing (like the hello sample) ignore it.
    (globalThis as Record<string, unknown>).__ZCC_HOST_REACT__ = React;
    const mod = (await import(/* @vite-ignore */ blobUrl)) as { default?: RendererEntry | unknown };
    const exported = mod.default;
    if (isPluginAppDefinition(exported)) {
      const set = interpretPluginApp(entry.id, exported);
      return appModuleFromPluginSet(entry, set);
    }
    const rendererEntry = exported as RendererEntry | undefined;
    if (!rendererEntry || typeof rendererEntry.activate !== 'function') {
      return makeErrorModule(entry, 'Bundle did not default-export a plugin app or RendererEntry.');
    }
    // Use the SAME cached host ModulePanelHost will inject as the `host` prop,
    // so the panel closes over one host instance and `evictHost` releases it.
    const host = getHost(entry.id);
    // activate() may return a bare component (original shape) OR an
    // ActivateResult ({ panel?, settingsPanel?, background?, commands?, navBadge? }).
    // Normalize both, then copy the contributions straight onto the AppModule —
    // the Phase 2 shell wiring already consumes commands/navBadge and the
    // Extensions hub reads settingsPanel from the merged set, so no shell change
    // is needed beyond populating these fields.
    const { panel, settingsPanel, background, commands, navBadge } = normalizeActivateResult(
      rendererEntry.activate({ React, host })
    );
    // A module is usable if it contributes ANY extension point. A panel-less
    // module that contributes only settingsPanel/commands/navBadge is valid (its
    // nav entry renders the .module-no-panel placeholder when selected, and a
    // settings-only extension is reachable via the Extensions hub) — only a
    // fully-empty result is a load failure. This mirrors built-in panel-less
    // modules; rejecting the runtime case here would break the documented
    // contract (AppModule.panel / ActivateResult.panel are optional).
    const hasPanel = typeof panel === 'function' || (typeof panel === 'object' && panel !== null);
    const hasSettings =
      typeof settingsPanel === 'function' ||
      (typeof settingsPanel === 'object' && settingsPanel !== null);
    const contributes =
      hasPanel || hasSettings || typeof commands === 'function' || typeof navBadge === 'function';
    if (!contributes) {
      return makeErrorModule(
        entry,
        'activate() returned nothing usable (no panel, settingsPanel, commands, or navBadge).'
      );
    }
    return {
      id: entry.id,
      title: manifest.title,
      icon: manifest.icon,
      titleLabel: manifest.titleLabel,
      // May legitimately be undefined now — AppModule.panel is optional (Phase 2)
      // and ModulePanelHost renders .module-no-panel for a no-panel module.
      panel: hasPanel ? panel : undefined,
      // Forwarded UNCONDITIONALLY (not gated on hasPanel): the Extensions hub
      // mounts the settings page independent of panel/placement, so a
      // settings-only extension surfaces its config page with no nav panel.
      settingsPanel: hasSettings ? settingsPanel : undefined,
      // Background remains independent from visible contributions: it mounts in
      // ModuleBackgroundHost for the app session, not with the nav-selected panel.
      background,
      commands,
      navBadge,
      // Carry the manifest's project-tab opt-in onto the built module, but only
      // when the module actually has a panel to mount — a project tab with no
      // view would render an empty placeholder inside the workspace. Core's
      // Workspace reads this to add a per-project tab for the module.
      projectTab: hasPanel ? manifest.projectTab : undefined
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeErrorModule(entry, message);
  } finally {
    // Revoke once the import has resolved — the module graph is materialised by
    // then, so the blob URL is no longer needed.
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Monotonic token guarding against out-of-order reconciles. `onChanged` can
 * fire twice in quick succession; both reconciles load asynchronously and may
 * resolve in either order. We stamp each call and only the latest one is
 * allowed to publish + evict, so a slow earlier load can't clobber a newer
 * result and leave the store disagreeing with the actual extension state.
 */
let reconcileSeq = 0;

/**
 * Reconcile the runtime extension set against what `window.cc.extensions`
 * reports: load enabled + loaded + renderer-bearing extensions into modules,
 * evict the host cache for any extension that has dropped out (disabled /
 * removed), and publish the new set into the store.
 *
 * Pass the entries from a fresh `list()` or an `onChanged` push.
 */
export async function reconcileExtensionModules(entries: ExtensionEntry[]): Promise<void> {
  const seq = ++reconcileSeq;
  // P3-B: publish the disk-ext grant map for the renderer ModuleHost gate. Every
  // entry with a manifest is a disk ext (built-ins aren't in this list), so its
  // declared permissions become its advisory grant. A built-in id is absent from
  // the map → its host is unrestricted (trusted by provenance).
  // P3-B grant map: the effective (consented) permissions back the renderer
  // ModuleHost gate. An unconsented ext gets an empty set, but it also isn't
  // mounted at all (filtered below), so its host is never created.
  setExtensionGrants(
    entries
      .filter((e) => e.manifest)
      .map((e) => ({
        id: e.id,
        // Consent precedes any grant: an unconsented ext advertises no perms.
        permissions: e.consented ? e.manifest?.permissions ?? [] : []
      }))
  );
  // P3-D: only mount a CONSENTED panel. An enabled-but-unconsented (or widened)
  // ext is discovered + listed (so the UI can prompt) but its panel never loads
  // until the user approves — consent precedes code running.
  const wanted = entries.filter(
    (e) => e.enabled && e.loaded && e.manifest?.entry.renderer
  );
  const wantedIds = new Set(wanted.map((e) => e.id));

  const modules = await Promise.all(wanted.map(loadExtensionModule));

  // A newer reconcile superseded us while we were loading — drop this result so
  // the latest event wins regardless of load-time ordering.
  if (seq !== reconcileSeq) return;

  // Evict host caches for extensions that dropped out (disabled / removed),
  // comparing against the live set right before we publish.
  for (const prev of useExtensionModules.getState().modules) {
    if (!wantedIds.has(prev.id)) evictHost(prev.id);
  }
  useExtensionModules.setState({ modules });
}

/**
 * One-shot initial load: pull the current extension list and reconcile. Safe to
 * call once at app start; failures are swallowed (the shell still works without
 * extensions).
 */
export async function initExtensionModules(): Promise<void> {
  try {
    const entries = await window.cc.extensions.list();
    await reconcileExtensionModules(entries);
  } catch {
    /* extensions are optional — a failed list just yields no extension nav */
  }
}
