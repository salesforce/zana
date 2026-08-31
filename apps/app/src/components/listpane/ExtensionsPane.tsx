import { Blocks, ChevronLeft, FolderOpen, Plug, Puzzle, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type ExtensionsTab } from '../../store.js';
import { SidebarResizer } from '../SidebarResizer.js';
import { useAppSettingsRouteMemory } from '../../hooks/useAppSettingsRouteMemory.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { getExtensionsHubPageRoutePath, getExtensionsTabRoutePath } from '../../lib/route-paths.js';
import { resolveIcon } from '../../lib/resolveIcon.js';
import { listExtensionsHubPanels, subscribePluginSlots } from '../../plugins/plugin-slots.js';
import { useSyncExternalStore } from 'react';

const EXTENSIONS_GROUPS: Array<{
  label: string;
  items: Array<{ id: ExtensionsTab; label: string; icon: typeof Blocks }>;
}> = [
  {
    label: 'Plugins',
    items: [
      { id: 'marketplace', label: 'Browse plugins', icon: Blocks },
      { id: 'installed', label: 'Installed plugins', icon: FolderOpen }
    ]
  },
  {
    label: 'Skills',
    items: [
      { id: 'skills', label: 'Skills', icon: Sparkles }
    ]
  },
  {
    label: 'MCP',
    items: [
      { id: 'mcp', label: 'MCP', icon: Plug }
    ]
  }
];

/** Focused navigation for the top-level Extensions workspace. */
export function ExtensionsPane() {
  const { extensionsTab, extensionsHubPluginId, pluginPanelPath } = useRouteState();
  const routeMemory = useAppSettingsRouteMemory();
  const hubPages = useSyncExternalStore(subscribePluginSlots, listExtensionsHubPanels, listExtensionsHubPanels);
  return (
    <aside className="sidebar sidebar--titlebar-controls extensions-pane">
      <Link
            to={routeMemory.toolsBackRoutePath}
            className="extensions-pane-back"
          >
            <ChevronLeft size={17} aria-hidden="true" />
            Back to app
          </Link>
          <nav className="extensions-picker" aria-label="Plugins navigation">
            {EXTENSIONS_GROUPS.map((group) => (
              <section key={group.label} className="extensions-picker-group" aria-label={group.label}>
                <h2 className="extensions-picker-label">{group.label}</h2>
                {group.items.map(({ id, label, icon: Icon }) => (
                  <Link
                    key={id}
                    to={getExtensionsTabRoutePath(id)}
                    data-testid={`extensions-nav-${id}`}
                    className={`extensions-picker-item ${extensionsTab === id ? 'active' : ''}`}
                    aria-current={extensionsTab === id ? 'page' : undefined}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                ))}
                {group.label === 'Plugins'
                  ? hubPages.map((panel) => {
                      const path = panel.path ?? panel.id;
                      const to = getExtensionsHubPageRoutePath({ pluginId: panel.pluginId, pageId: path });
                      const active =
                        extensionsTab === 'page' &&
                        extensionsHubPluginId === panel.pluginId &&
                        pluginPanelPath === path;
                      const Icon = resolveIcon(panel.icon) ?? Puzzle;
                      return (
                        <Link
                          key={`${panel.pluginId}/${path}:${panel.generation}`}
                          to={to}
                          data-testid={`extensions-nav-page-${panel.pluginId}-${path}`}
                          className={`extensions-picker-item ${active ? 'active' : ''}`}
                          aria-current={active ? 'page' : undefined}
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span>{panel.title}</span>
                        </Link>
                      );
                    })
                  : null}
              </section>
            ))}
      </nav>
      <SidebarResizer />
    </aside>
  );
}
