import { paneContentForPathname } from '../lib/split-layout/splitThreadNavigation.js';
import { getExtensionsHubPageRoutePath, getPluginPanelRoutePath } from '../lib/route-paths.js';
import { listNavPanels } from './plugin-slots.js';

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

