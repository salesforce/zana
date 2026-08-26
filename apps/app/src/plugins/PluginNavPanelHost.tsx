import { useMemo, useSyncExternalStore } from 'react';
import { listNavPanels, subscribePluginSlots } from './plugin-slots.js';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import { useRouteState } from '../hooks/useRouteState.js';

/**
 * Renders the active plugin navPanel (every panel, not only the first) with the
 * real URL `subPath`. Falls back to nothing when nav is not a plugin panel.
 */
export function PluginNavPanelHost() {
  const route = useRouteState();
  const panels = useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  const panel = useMemo(() => {
    const forPlugin = panels.filter((row) => row.pluginId === route.nav);
    if (forPlugin.length === 0) return null;
    if (route.pluginPanelPath) {
      return forPlugin.find((row) => (row.path ?? row.id) === route.pluginPanelPath) ?? forPlugin[0] ?? null;
    }
    return forPlugin[0] ?? null;
  }, [panels, route.nav, route.pluginPanelPath]);

  if (!panel) return null;
  const Component = panel.component;
  return (
    <div className="module-panel-host">
      <div className="module-panel-slot panel-body--full">
        <PluginSlotBoundary pluginId={panel.pluginId} generation={panel.generation}>
          <Component pluginId={panel.pluginId} subPath={route.pluginSubPath} />
        </PluginSlotBoundary>
      </div>
    </div>
  );
}

export function useHasPluginNavPanel(nav: string): boolean {
  const panels = useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  return panels.some((panel) => panel.pluginId === nav);
}
