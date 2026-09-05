import { paneContentForPathname } from '../lib/split-layout/splitThreadNavigation.js';
import {
  getExtensionsHubPageRoutePath,
  getPluginPanelRoutePath,
  getProjectModeRoutePath,
  getProjectRoutePath
} from '../lib/route-paths.js';
import type {
  PluginCreateProjectActionContext,
  PluginProjectMenuActionContext
} from '@zana-ai/zcc-plugin-sdk';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { listNavPanels, listProjectTabs, projectTabView } from './plugin-slots.js';

export function hrefForPluginNavPanel(
  pluginId: string,
  path: string,
  subPath?: string
): string {
  const panel = listNavPanels().find(
    (row) => row.pluginId === pluginId && (row.path ?? row.id) === path
  );
  if (panel?.placement === 'extensions') {
    return getExtensionsHubPageRoutePath({ pluginId, pageId: path, subPath });
  }
  return getPluginPanelRoutePath({ pluginId, path, subPath });
}

/** Project workspace URL for a plugin `projectTab`, or the project home when none is registered. */
export function hrefForPluginProjectTab(pluginId: string, projectId: string, tabId?: string): string {
  const tabs = listProjectTabs();
  const forPlugin = tabs.filter((row) => row.pluginId === pluginId);
  const tab = (tabId ? forPlugin.find((row) => row.id === tabId) : undefined) ?? forPlugin[0];
  if (!tab) return getProjectRoutePath(projectId);
  return getProjectModeRoutePath(projectId, projectTabView(tab, tabs));
}

export function projectMenuNavigateContext(
  pluginId: string,
  projectId: string | null,
  navigate: (to: string) => void
): PluginProjectMenuActionContext {
  return {
    projectId,
    toProject(id, options) {
      navigate(hrefForPluginProjectTab(pluginId, id, options?.tabId));
    }
  };
}

export function createProjectActionContext(
  pluginId: string,
  deps: {
    pickDirectory(): Promise<string | null>;
    addProject(path: string): Promise<{ id: string } | null>;
    cloneRoot(): Promise<string | null>;
    navigate(to: string): void;
    openDialog(options?: { title?: string; params?: JsonValue }): boolean;
  }
): PluginCreateProjectActionContext {
  return {
    pickDirectory: deps.pickDirectory,
    addProject: deps.addProject,
    cloneRoot: deps.cloneRoot,
    toProject(id, options) {
      deps.navigate(hrefForPluginProjectTab(pluginId, id, options?.tabId));
    },
    openDialog: deps.openDialog
  };
}

/** Hub URL when a split `/plugins/...` path belongs to an extensions-placed panel. */
export function extensionsHubRedirectForPath(pathname: string): string | null {
  const content = paneContentForPathname(pathname);
  if (content?.kind !== 'plugin-panel') return null;
  const forPlugin = listNavPanels().filter((row) => row.pluginId === content.pluginId);
  const panel =
    forPlugin.find((row) => (row.path ?? row.id) === content.panelPath) ?? forPlugin[0] ?? null;
  if (panel?.placement !== 'extensions') return null;
  return hrefForPluginNavPanel(content.pluginId, content.panelPath, content.subPath || undefined);
}

