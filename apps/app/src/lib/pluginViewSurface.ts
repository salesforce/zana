/**
 * A plugin view window shows one plugin project tab in its own OS window. Main
 * loads it with `?surface=plugin-view&projectId&pluginId&tabId`. The
 * `projectId` param also makes it a scoped window (see windowScope.ts), so it
 * never owns session restore or the walkthrough.
 *
 * The target is read once and remembered in `sessionStorage`, so a reload that
 * drops the query still shows the same tab. Like window scope, this is a
 * display choice, not a security boundary: main authorizes the window.
 */
export type PluginViewSurfaceTarget = { pluginId: string; tabId: string; projectId: string; resourceId?: string };

const STORAGE_KEY = 'zcc.pluginViewTarget';
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parsePluginViewSearch(search: string): PluginViewSurfaceTarget | null {
  const params = new URLSearchParams(search);
  if (params.get('surface') !== 'plugin-view') return null;
  return parseTarget({
    pluginId: params.get('pluginId'),
    tabId: params.get('tabId'),
    projectId: params.get('projectId'),
    resourceId: params.has('resourceId') ? params.get('resourceId') : undefined
  });
}

function parseTarget(value: unknown): PluginViewSurfaceTarget | null {
  if (!value || typeof value !== 'object') return null;
  const { pluginId, tabId, projectId, resourceId } = value as Record<string, unknown>;
  if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) return null;
  if (typeof tabId !== 'string' || !TAB_ID.test(tabId)) return null;
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 256 || /[\x00-\x1f\x7f]/.test(projectId)) return null;
  if (resourceId !== undefined && (typeof resourceId !== 'string' || !resourceId.trim() || resourceId.length > 2048 || /[\x00-\x1f\x7f]/.test(resourceId))) return null;
  return { pluginId, tabId, projectId, ...(resourceId === undefined ? {} : { resourceId }) };
}

function readPluginViewTarget(): PluginViewSurfaceTarget | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromQuery = parsePluginViewSearch(window.location.search);
    if (fromQuery) {
      try {
        window.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(fromQuery));
      } catch {
        /* storage unavailable: the query still applies to this load */
      }
      return fromQuery;
    }
    const stored = window.sessionStorage?.getItem(STORAGE_KEY);
    return stored ? parseTarget(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

const target = readPluginViewTarget();

/** The tab this window shows, or `null` outside a plugin view window. */
export function getPluginViewTarget(): PluginViewSurfaceTarget | null {
  return target;
}

export function isPluginViewSurface(): boolean {
  return target !== null;
}
