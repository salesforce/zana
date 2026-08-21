import {
  Blocks,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Sparkles
} from 'lucide-react';
import { useUi, type ExtensionsTab } from '../../store';

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
  }
];

/** Focused navigation for the top-level Extensions workspace. */
export function ExtensionsPane() {
  const extensionsTab = useUi((s) => s.extensionsTab);
  const setExtensionsTab = useUi((s) => s.setExtensionsTab);
  return (
    <aside className="sidebar sidebar--titlebar-controls extensions-pane">
      <div className="sidebar-chrome">
        <div className="sidebar-history-controls" aria-label="Extensions navigation history">
          <button
            type="button"
            aria-label="Back to app"
            title="Back to app"
            onClick={() => useUi.getState().setNav('home')}
          >
            <ChevronLeft size={19} />
          </button>
          <button type="button" aria-label="No next view" title="No next view" disabled>
            <ChevronRight size={19} />
          </button>
        </div>
      </div>
      <button
            type="button"
            className="extensions-pane-back"
            onClick={() => useUi.getState().setNav('home')}
          >
            <ChevronLeft size={17} aria-hidden="true" />
            Back to app
          </button>
          <nav className="extensions-picker" aria-label="Extensions navigation">
            {EXTENSIONS_GROUPS.map((group) => (
              <section key={group.label} className="extensions-picker-group" aria-label={group.label}>
                <h2 className="extensions-picker-label">{group.label}</h2>
                {group.items.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`extensions-nav-${id}`}
                    className={`extensions-picker-item ${extensionsTab === id ? 'active' : ''}`}
                    onClick={() => setExtensionsTab(id)}
                    aria-current={extensionsTab === id ? 'page' : undefined}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                ))}
              </section>
            ))}
      </nav>
    </aside>
  );
}
