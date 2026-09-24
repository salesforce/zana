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
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';
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
 * Record a failed plugin-app import for the Plugins hub. Do not attach a
 * `panel` — the sidebar treats any panel as a global nav destination, and most
 * plugin apps never registered one (settings, pendingInteraction, provider
 * icons). The hub already renders `loadError` on the detail pane.
 */
function errorModule(entry: PluginAppEntry, message: string): PluginAppModule {
  return {
    id: entry.id,
    title: entry.name,
    icon: entry.icon,
    projectTab: entry.projectTab,
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
    clearPluginSlots(entry.id);
    return {
      module: errorModule(entry, 'Bundle did not default-export a plugin app.'),
      runtimeLoaded: false
    };
  } catch (error) {
    if (!isCurrent()) return { module: null, runtimeLoaded: false };
    clearPluginSlots(entry.id);
    return {
      module: errorModule(entry, error instanceof Error ? error.message : String(error)),
      runtimeLoaded: false
    };
  }
}

let reconcileSequence = 0;
let activePluginIds = new Set<string>();
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
  options: { importer?: PluginAppImporter } = {},
  sequence = ++reconcileSequence
): Promise<void> {
  const wanted = entries.filter(pluginAppIsLoadable);
  const wantedIds = new Set(wanted.map((entry) => entry.id));
  const importer = options.importer ?? importPluginApp;
  const modules: PluginAppModule[] = [];
  const runtimeLoadedIds = new Set<string>();

  for (const entry of wanted) {
    const url = entry.appUrl as string;
    if (appliedAppUrls.get(entry.id) === url && loadedOutcomes.has(entry.id)) {
      const previous = loadedOutcomes.get(entry.id)!;
      if (previous.module) modules.push(previous.module);
      if (previous.runtimeLoaded) runtimeLoadedIds.add(entry.id);
      continue;
    }
    const outcome = await loadPluginApp(entry, importer, () => sequence === reconcileSequence);
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
