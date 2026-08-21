/**
 * Loads renderer apps owned by the server-side PluginService. These are distinct
 * from legacy disk extensions: their bundles are served from the supervised
 * same-origin static host, so relative chunks and assets resolve without giving
 * the renderer an install path or a filesystem read capability.
 */

import * as React from 'react';
import { create } from 'zustand';
import type { AppModule, ModuleHost } from '@shared/module-api';
import type { PluginAppEntry } from '@shared/types';
import type { PluginRegistrationSet } from '@zana-ai/zcc-plugin-sdk';
import { isPluginAppDefinition } from '@zana-ai/zcc-plugin-sdk';
import { PluginSlotBoundary } from './PluginSlotBoundary';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots';
import { evictHost } from '../modules/ModulePanelHost';

export interface PluginAppModule extends AppModule {
  loadError?: string;
}

interface PluginAppModulesState {
  modules: PluginAppModule[];
  setModules: (modules: PluginAppModule[]) => void;
}

/** Live server-plugin app modules, merged with built-ins and legacy extensions. */
export const usePluginAppModules = create<PluginAppModulesState>((set) => ({
  modules: [],
  setModules: (modules) => set({ modules })
}));

type PluginAppImporter = (url: string) => Promise<{ default?: unknown }>;

const importPluginApp: PluginAppImporter = (url) => import(/* @vite-ignore */ url);

function errorModule(entry: PluginAppEntry, message: string): PluginAppModule {
  const Panel: React.ComponentType<{ host: ModuleHost }> = () =>
    React.createElement(
      'main',
      { className: 'settings-panel' },
      React.createElement(
        'div',
        { className: 'settings-inner' },
        React.createElement('h2', null, `${entry.name} failed to load`),
        React.createElement(
          'pre',
          { style: { whiteSpace: 'pre-wrap', color: 'var(--danger)' } },
          message
        )
      )
    );
  return {
    id: entry.id,
    title: entry.name,
    icon: entry.icon,
    panel: Panel,
    projectTab: entry.projectTab,
    loadError: message
  };
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

  return {
    id: entry.id,
    title: nav?.title ?? entry.name,
    icon: nav?.icon ?? entry.icon,
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
  importer: PluginAppImporter
): Promise<PluginAppModule | null> {
  if (!entry.appUrl) return null;
  try {
    // Some bundled renderer apps use the host React shim during module evaluation
    // (before their slot registration runs), so prime it before importing.
    (globalThis as Record<string, unknown>).__ZCC_HOST_REACT__ = React;
    const mod = await importer(entry.appUrl);
    if (!isPluginAppDefinition(mod.default)) {
      clearPluginSlots(entry.id);
      return errorModule(entry, 'Bundle did not default-export a plugin app.');
    }
    const set = interpretPluginApp(entry.id, mod.default);
    return moduleFromSet(entry, set);
  } catch (error) {
    clearPluginSlots(entry.id);
    return errorModule(entry, error instanceof Error ? error.message : String(error));
  }
}

let reconcileSequence = 0;
let activePluginIds = new Set<string>();

/**
 * Replaces all visible server-plugin app registrations. The sequence guard keeps
 * a slow prior import from overwriting the newest lifecycle snapshot.
 */
export async function reconcilePluginApps(
  entries: readonly PluginAppEntry[],
  options: { importer?: PluginAppImporter } = {}
): Promise<void> {
  const sequence = ++reconcileSequence;
  const wanted = entries.filter((entry) => entry.status === 'running' && entry.appUrl);
  const wantedIds = new Set(wanted.map((entry) => entry.id));
  const modules = (await Promise.all(wanted.map((entry) => loadPluginApp(entry, options.importer ?? importPluginApp))))
    .filter((module): module is PluginAppModule => module !== null);

  if (sequence !== reconcileSequence) return;
  for (const id of activePluginIds) {
    if (!wantedIds.has(id)) {
      clearPluginSlots(id);
      evictHost(id);
    }
  }
  activePluginIds = wantedIds;
  usePluginAppModules.getState().setModules(modules);
}

/** Initial snapshot for the server-owned plugin app registry. */
export async function initPluginApps(): Promise<void> {
  try {
    await reconcilePluginApps(await window.cc.pluginApps.list());
  } catch {
    // Plugins are optional. Keep the shell usable if the runtime is offline.
  }
}
