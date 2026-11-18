import type { PluginApplicationTab } from './application-tabs.js';
import { hrefForPluginNavPanel } from '../plugins/plugin-nav-href.js';
import { listNavPanels } from '../plugins/plugin-slots.js';

/**
 * Route that opens a pinned item on its owner's page, or null when the page is
 * not registered. The item key is one encoded segment of the page's sub-path.
 */
export function pluginTabPath(tab: PluginApplicationTab): string | null {
  const panel = listNavPanels().find(
    (row) => row.pluginId === tab.pluginId && row.id === tab.pageId
  );
  if (!panel) return null;
  return hrefForPluginNavPanel(
    tab.pluginId,
    panel.path ?? panel.id,
    encodeURIComponent(tab.itemKey)
  );
}
