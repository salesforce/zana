import { product } from '../lib/product-client.js';
import type { PluginHostBridge } from '@zana-ai/zcc-plugin-sdk';
import { installPluginRuntime } from './plugin-runtime.js';
import type {
  PluginSettingDescriptor,
  PluginSettingsSnapshot as SdkPluginSettingsSnapshot
} from '@zana-ai/zcc-plugin-sdk/server';
import type { PluginSettingsSnapshot as DomainPluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';
/**
 * Loads renderer apps owned by the server-side PluginService. Bundles are served
 * from `/plugins/:id/assets/*` on the supervised same-origin static host (and,
 * in Vite dev, the product server behind the renderer proxy) so relative chunks
 * resolve without giving the renderer an install path. Leftover `extension.json`
 * bundles that default-export `RendererEntry.activate()` are not activated here:
 * they call `ModuleHost.call` (`modules:call`), and PluginService never spawns
 * that Electron main. Disk-extension loading still owns those bundles.
 */

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import { create } from 'zustand';
import type { AppModule, ModuleHost, RendererEntry } from '@zana-ai/zcc-extension-sdk/renderer';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import type { PluginRegistrationSet } from '@zana-ai/zcc-plugin-sdk';
import { isPluginAppDefinition } from '@zana-ai/zcc-plugin-sdk';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import { PluginLoadFailure } from './PluginLoadFailure.js';
import { clearPluginSlots, getPluginRegistrationSets, interpretPluginApp } from './plugin-slots.js';
import { evictHost } from '../modules/ModulePanelHost.js';

export interface PluginAppModule extends AppModule {
  loadError?: string;
}

interface PluginAppModulesState {
  modules: PluginAppModule[];
  runtimeLoadedIds: ReadonlySet<string>;
  setSnapshot: (modules: PluginAppModule[], runtimeLoadedIds: ReadonlySet<string>) => void;
}

/** Live server-plugin app modules, merged with built-ins and legacy extensions. */
export const usePluginAppModules = create<PluginAppModulesState>((set) => ({
  modules: [],
  runtimeLoadedIds: new Set(),
  setSnapshot: (modules, runtimeLoadedIds) => set({ modules, runtimeLoadedIds })
}));

interface PluginAppLoadOutcome {
  module: PluginAppModule | null;
  runtimeLoaded: boolean;
}

type PluginAppImporter = (url: string) => Promise<{ default?: unknown }>;

const importPluginApp: PluginAppImporter = (url) => import(/* @vite-ignore */ url);

/**
 * Replace previously registered pages with host recovery UI, preserving their
 * paths and placement. Drop every executable plugin contribution. A first-load
 * failure has no known pages, so it stays in the hub without inventing a rail row.
 */
function errorModule(entry: PluginAppEntry, message: string): PluginAppModule {
  const previous = getPluginRegistrationSets().find((set) => set.pluginId === entry.id);
  const component = () => React.createElement(PluginLoadFailure, { pluginId: entry.id, name: entry.name, detail: message });
  const recovered = interpretPluginApp(entry.id, {
    __zccPluginApp: true,
    setup(app: { slots: {
      navPanel(registration: object): void;
      projectTab(registration: object): void;
    } }) {
      for (const panel of previous?.navPanels ?? []) {
        app.slots.navPanel({ id: panel.id, title: panel.title, icon: panel.icon, path: panel.path, placement: panel.placement, component });
      }
      for (const tab of previous?.projectTabs ?? []) {
        app.slots.projectTab({ id: tab.id, label: tab.label, icon: tab.icon, order: tab.order, global: tab.global, component });
      }
    }
  }, entry.name);
  return {
    id: entry.id,
    title: entry.name,
    icon: entry.icon,
    projectTab: entry.projectTab,
    ...moduleFromSet(entry, recovered),
    loadError: message
  };
}

function isRendererEntry(value: unknown): value is RendererEntry {
  return typeof value === 'object' && value !== null && typeof (value as RendererEntry).activate === 'function';
}

function moduleFromSet(entry: PluginAppEntry, set: PluginRegistrationSet): PluginAppModule | null {
  const nav = set.navPanels[0];
  const projectTab = set.projectTabs[0];
  if (!nav && !projectTab) return null;

  const Panel: React.ComponentType<{ host: ModuleHost }> = ({ host }) => {
    const projectId = host.getScopedProjectId();
    if (projectTab && projectId) {
      const Component = projectTab.component;
      return React.createElement(
        PluginSlotBoundary,
        { pluginId: entry.id, generation: projectTab.generation },
        React.createElement(Component, { pluginId: entry.id, projectId })
      );
    }
    if (nav) {
      const Component = nav.component;
      return React.createElement(
        PluginSlotBoundary,
        { pluginId: entry.id, generation: nav.generation },
        React.createElement(Component, { pluginId: entry.id, subPath: '' })
      );
    }
    return React.createElement('div', { className: 'module-no-panel', role: 'status' }, 'This plugin is available per project.');
  };

  // Plugin identity is the catalog name/icon. A plugin's first project tab or
  // nav panel is a destination, not the installed plugin name.
  return {
    id: entry.id,
    title: entry.name,
    icon: entry.icon,
    panel: Panel,
    projectTab: projectTab
      ? {
          label: projectTab.label,
          icon: projectTab.icon,
          order: projectTab.order,
          global: projectTab.global
        }
      : entry.projectTab
  };
}

async function loadPluginApp(
  entry: PluginAppEntry,
  importer: PluginAppImporter,
  isCurrent: () => boolean
): Promise<PluginAppLoadOutcome> {
  if (!entry.appUrl) return { module: null, runtimeLoaded: false };
  try {
    // Some bundled renderer apps use the host React shim during module evaluation
    // (before their slot registration runs), so prime it before importing.
    (globalThis as Record<string, unknown>).__ZCC_HOST_REACT__ = React;
    (globalThis as Record<string, unknown>).__ZCC_HOST_REACT_DOM__ = ReactDOM;
    (globalThis as Record<string, unknown>).__ZCC_HOST_REACT_DOM_CLIENT__ = ReactDOMClient;
    const mod = await importer(entry.appUrl);
    // Imports cannot be cancelled. Do not let a stale import register slots after
    // a newer lifecycle snapshot disabled, removed, or reloaded this plugin.
    if (!isCurrent()) return { module: null, runtimeLoaded: false };
    if (isPluginAppDefinition(mod.default)) {
      const set = interpretPluginApp(entry.id, mod.default, entry.name);
      return { module: moduleFromSet(entry, set), runtimeLoaded: true };
    }
    // Leftover extension.json renderers call ModuleHost.call → modules:call.
    // PluginService never spawns that Electron main, so activating them here
    // toasts "Unknown module". Disk-extension loading still owns those bundles
    // when a live child exists.
    if (isRendererEntry(mod.default)) {
      clearPluginSlots(entry.id);
      return { module: null, runtimeLoaded: false };
    }
    return {
      module: errorModule(entry, 'Bundle did not default-export a plugin app.'),
      runtimeLoaded: false
    };
  } catch (error) {
    if (!isCurrent()) return { module: null, runtimeLoaded: false };
    return {
      module: errorModule(entry, error instanceof Error ? error.message : String(error)),
      runtimeLoaded: false
    };
  }
}

let reconcileSequence = 0;
let activePluginIds = new Set<string>();
let retrySequence = 0;
const appliedAppUrls = new Map<string, string>();
const loadedOutcomes = new Map<string, PluginAppLoadOutcome>();

/**
 * Renderer bundles for plugins that are live enough to own UI. `needs-configuration`
 * is still a running factory — Salesforce (and anything that flags setup) must
 * mount so the user can actually configure it. Disabled / degraded stay out.
 */
export function pluginAppIsLoadable(
  entry: Pick<PluginAppEntry, 'status' | 'appUrl'>
): boolean {
  return (entry.status === 'running' || entry.status === 'needs-configuration') && Boolean(entry.appUrl);
}

/**
 * Replaces visible server-plugin app registrations. Unchanged `appUrl`s skip
 * re-import so a reload of one plugin does not remount every other panel.
 */
export async function reconcilePluginApps(
  entries: readonly PluginAppEntry[],
  options: { importer?: PluginAppImporter; retryPluginId?: string } = {},
  sequence = ++reconcileSequence
): Promise<void> {
  if (sequence !== reconcileSequence) return;
  const wanted = entries.filter((entry) => pluginAppIsLoadable(entry) || (
    entry.enabled && entry.status === 'degraded' &&
    getPluginRegistrationSets().some((set) => set.pluginId === entry.id && (set.navPanels.length > 0 || set.projectTabs.length > 0))
  ));
  const wantedIds = new Set(wanted.map((entry) => entry.id));
  const importer = options.importer ?? importPluginApp;
  const modules: PluginAppModule[] = [];
  const runtimeLoadedIds = new Set<string>();

  for (const entry of wanted) {
    if (!pluginAppIsLoadable(entry)) {
      const outcome = { module: errorModule(entry, entry.statusDetail || 'Plugin is not running.'), runtimeLoaded: false };
      loadedOutcomes.set(entry.id, outcome);
      appliedAppUrls.delete(entry.id);
      modules.push(outcome.module);
      continue;
    }
    const url = entry.appUrl as string;
    // The host's change event may already have loaded the new generation. Only
    // bypass a failed import, so a healthy page does not mount twice per reload.
    const retry = options.retryPluginId === entry.id && Boolean(loadedOutcomes.get(entry.id)?.module?.loadError);
    if (!retry && appliedAppUrls.get(entry.id) === url && loadedOutcomes.has(entry.id)) {
      const previous = loadedOutcomes.get(entry.id)!;
      if (previous.module) modules.push(previous.module);
      if (previous.runtimeLoaded) runtimeLoadedIds.add(entry.id);
      continue;
    }
    // ESM caches rejected imports too. An explicit retry needs a fresh URL even
    // when the server returns the same generation. Other plugins stay mounted.
    const importEntry = retry ? { ...entry, appUrl: `${url}${url.includes('?') ? '&' : '?'}zccRetry=${++retrySequence}` } : entry;
    const outcome = await loadPluginApp(importEntry, importer, () => sequence === reconcileSequence);
    if (sequence !== reconcileSequence) return;
    appliedAppUrls.set(entry.id, url);
    loadedOutcomes.set(entry.id, outcome);
    if (outcome.module) modules.push(outcome.module);
    if (outcome.runtimeLoaded) runtimeLoadedIds.add(entry.id);
  }

  if (sequence !== reconcileSequence) return;
  for (const id of activePluginIds) {
    if (!wantedIds.has(id)) {
      clearPluginSlots(id);
      evictHost(id);
      appliedAppUrls.delete(id);
      loadedOutcomes.delete(id);
    }
  }
  activePluginIds = wantedIds;
  usePluginAppModules.getState().setSnapshot(modules, runtimeLoadedIds);
}

/** Rebuild/reload through the authorized host, then verify the browser import. */
export async function reloadPluginApp(pluginId: string): Promise<void> {
  const result = await product.pluginApps.reload(pluginId);
  if (!result.ok) throw new Error(result.message || 'Reload failed');
  const sequence = ++reconcileSequence;
  const entries = await product.pluginApps.list();
  await reconcilePluginApps(entries, { retryPluginId: pluginId }, sequence);
  if (sequence !== reconcileSequence) return;
  const current = entries.find((entry) => entry.id === pluginId);
  if (!current || !current.enabled || (current.status !== 'running' && current.status !== 'needs-configuration')) {
    throw new Error(current?.statusDetail || 'Plugin is not running. Review its status in Plugins.');
  }
  const error = usePluginAppModules.getState().modules.find((module) => module.id === pluginId)?.loadError;
  if (error) throw new Error(error);
}

/**
 * `product.pluginApps.getSettings` returns the wire-contract snapshot
 * (`@zana-ai/zcc-domain/product`, a flattened descriptor shape), but
 * `PluginHostBridge` expects the plugin-authoring SDK's discriminated-union
 * snapshot (`@zana-ai/zcc-plugin-sdk/server`). Re-narrow per descriptor rather
 * than casting across the two independently-declared types.
 */
function toSdkSettingDescriptor(
  descriptor: DomainPluginSettingsSnapshot['descriptors'][string]
): PluginSettingDescriptor {
  switch (descriptor.type) {
    case 'string':
      return {
        type: 'string',
        label: descriptor.label,
        description: descriptor.description,
        secret: descriptor.secret,
        ...(descriptor.multiline === true ? { multiline: true } : {}),
        default: typeof descriptor.default === 'string' ? descriptor.default : undefined
      };
    case 'boolean':
      return {
        type: 'boolean',
        label: descriptor.label,
        description: descriptor.description,
        default: typeof descriptor.default === 'boolean' ? descriptor.default : undefined
      };
    case 'number':
      return {
        type: 'number',
        label: descriptor.label,
        description: descriptor.description,
        default: typeof descriptor.default === 'number' ? descriptor.default : undefined,
        min: typeof descriptor.min === 'number' ? descriptor.min : undefined,
        max: typeof descriptor.max === 'number' ? descriptor.max : undefined
      };
    case 'select':
      return {
        type: 'select',
        label: descriptor.label,
        description: descriptor.description,
        options: descriptor.options ?? [],
        default: typeof descriptor.default === 'string' ? descriptor.default : undefined
      };
    case 'project':
      return {
        type: 'project',
        label: descriptor.label,
        description: descriptor.description,
        default: typeof descriptor.default === 'string' ? descriptor.default : undefined
      };
  }
}

function toSdkSettingsSnapshot(snapshot: DomainPluginSettingsSnapshot): SdkPluginSettingsSnapshot {
  const descriptors: Record<string, PluginSettingDescriptor> = {};
  for (const [key, descriptor] of Object.entries(snapshot.descriptors)) {
    descriptors[key] = toSdkSettingDescriptor(descriptor);
  }
  return { descriptors, values: snapshot.values };
}

/** Initial snapshot for the server-owned plugin app registry. */
export async function refreshPluginApps(): Promise<void> {
  const sequence = ++reconcileSequence;
  const host: PluginHostBridge = {
    callRpc: (pluginId, method, args) => product.pluginApps.callRpc(pluginId, method, args),
    getSettings: (pluginId) => product.pluginApps.getSettings(pluginId).then(toSdkSettingsSnapshot),
    setSettings: async (pluginId, values) => {
      await product.pluginApps.setSettings(pluginId, values);
    },
    // Desktop only: main draws the sheet and signs the token. Web and mobile
    // have no signer, so the plugin's action fails closed there.
    requestApproval: async (pluginId, request) => {
      const approvals = typeof window === 'undefined' ? undefined : window.cc?.pluginApprovals;
      if (!approvals) return { approved: false, reason: 'unavailable' };
      return approvals.request({ ...request, pluginId });
    }
  };
  (globalThis as { __ZCC_PLUGIN_HOST__?: PluginHostBridge }).__ZCC_PLUGIN_HOST__ = host;
  // Keep this a static import so composer/RPC hooks share the same React
  // context objects as PluginComposerChrome (a dynamic import can duplicate
  // module state in the production renderer chunk graph).
  installPluginRuntime();
  try {
    const entries = await product.pluginApps.list();
    await reconcilePluginApps(entries, {}, sequence);
  } catch {
    // Plugins are optional. Keep the shell usable if the runtime is offline.
  }
}

/** Initial snapshot for the server-owned plugin app registry. */
export async function initPluginApps(): Promise<void> {
  await refreshPluginApps();
}
