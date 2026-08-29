import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { resolveIcon } from '../lib/resolveIcon.js';
import { getPluginPanelRoutePath } from '../lib/route-paths.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { listNavPanels, subscribePluginSlots } from './plugin-slots.js';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';

export function pluginNavKey(pluginId: string, path: string): string {
  return `${pluginId}/${path}`;
}

export function PluginNavRows({ compact = false }: { compact?: boolean }) {
  const panels = useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  const route = useRouteState();
  if (panels.length === 0) return null;
  return (
    <nav className="plugin-nav-rows" aria-label="Plugin panels" data-testid="plugin-nav-rows">
      {panels.map((panel) => {
        const path = panel.path ?? panel.id;
        const to = getPluginPanelRoutePath({ pluginId: panel.pluginId, path });
        const active =
          route.nav === panel.pluginId &&
          (route.pluginPanelPath === path || (!route.pluginPanelPath && path === panel.id));
        const Icon = resolveIcon(panel.icon);
        const Accessory = panel.experimental_sidebarAccessory;
        return (
          <div key={`${panel.pluginId}/${path}:${panel.generation}`} className="plugin-nav-row-wrap">
            <Link
              to={to}
              className={`plugin-nav-row${active ? ' is-active' : ''}${compact ? ' is-compact' : ''}`}
              data-testid={`plugin-nav-${panel.pluginId}-${path}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={14} />
              <span>{panel.title}</span>
            </Link>
            {Accessory ? (
              <PluginSlotBoundary pluginId={panel.pluginId} generation={panel.generation}>
                <Accessory />
              </PluginSlotBoundary>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function PluginNavListPane() {
  const panels = useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  const route = useRouteState();
  const active = panels.find((panel) => {
    const path = panel.path ?? panel.id;
    return panel.pluginId === route.nav && path === (route.pluginPanelPath ?? path);
  }) ?? panels.find((panel) => panel.pluginId === route.nav);
  const Header = active?.headerContent;
  return (
    <section className="list-pane plugin-nav-list-pane" data-testid="plugin-nav-list-pane">
      <header className="list-header">
        <h2>{active?.title ?? 'Plugin'}</h2>
      </header>
      <div className="list-body">
        <PluginNavRows />
        {Header && active ? (
          <PluginSlotBoundary pluginId={active.pluginId} generation={active.generation}>
            <Header pluginId={active.pluginId} subPath={route.pluginSubPath ?? ''} />
          </PluginSlotBoundary>
        ) : null}
      </div>
    </section>
  );
}
