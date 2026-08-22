import {
  Blocks,
  ChevronLeft,
  FolderOpen,
  Plug,
  Sparkles
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { type ExtensionsTab } from '../../store.js';
import { SidebarResizer } from '../SidebarResizer.js';
import { SidebarHistoryControls } from '../SidebarHistoryControls.js';
import { useAppSettingsRouteMemory } from '../../hooks/useAppSettingsRouteMemory.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { getExtensionsTabRoutePath } from '../../lib/route-paths.js';

const EXTENSIONS_GROUPS: Array<{
  label: string;
  items: Array<{ id: ExtensionsTab; label: string; icon: typeof Blocks }>;
}> = [
  {
    label: 'Extensions',
    items: [
      { id: 'marketplace', label: 'Browse extensions', icon: Blocks },
      { id: 'installed', label: 'Installed extensions', icon: FolderOpen }
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
  const { extensionsTab } = useRouteState();
  const routeMemory = useAppSettingsRouteMemory();
  return (
    <aside className="sidebar sidebar--titlebar-controls extensions-pane">
      <div className="sidebar-chrome">
        <SidebarHistoryControls label="Extensions navigation history" />
      </div>
      <Link
            to={routeMemory.toolsBackRoutePath}
            className="extensions-pane-back"
          >
            <ChevronLeft size={17} aria-hidden="true" />
            Back to app
          </Link>
          <nav className="extensions-picker" aria-label="Extensions navigation">
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
              </section>
            ))}
      </nav>
      <SidebarResizer />
    </aside>
  );
}
