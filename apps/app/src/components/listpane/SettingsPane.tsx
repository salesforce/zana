import { ArrowLeft, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useData, useUi } from '../../store.js';
import { SETTINGS_SECTIONS, SETTINGS_GROUPS, SETTINGS_SUBSECTIONS } from '@/views/settings/SettingsView';
import { SidebarResizer } from '../SidebarResizer.js';
import { useAppSettingsRouteMemory } from '../../hooks/useAppSettingsRouteMemory.js';
import { getSettingsTabRoutePath } from '../../lib/route-paths.js';
import { appSettingsNavCatalog, filterSettingsNav } from '../../lib/settings-nav-search.js';

/**
 * Focused Settings rail. Each Settings section (Global · Prompts · Personas ·
 * Squads · Usage · …, + the project-scoped Project settings) is a row that
 * navigates to `/settings/:section` (project settings live at
 * `/projects/:id/settings`). Scope (Global vs a single project) is chosen in the
 * content header's scope control (see `ScopeControl` in SettingsPanel.tsx),
 * NOT here. Plugins / Skills / MCP live on the top-level Extensions workspace.
 *
 * `SETTINGS_SECTIONS` is the shared source of truth for labels/icons/descs.
 */
export function SettingsPane() {
  const settingsTab = useUi((s) => s.settingsTab);
  const setSettingsAnchor = useUi((s) => s.setSettingsAnchor);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const projects = useData((s) => s.projects);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const routeMemory = useAppSettingsRouteMemory();
  const projectId = focusedProjectId ?? selectedProjectId ?? selectedProject?.id ?? null;
  const [query, setQuery] = useState('');
  const catalog = useMemo(
    () => appSettingsNavCatalog({
      groups: SETTINGS_GROUPS,
      sections: SETTINGS_SECTIONS,
      subsections: SETTINGS_SUBSECTIONS
    }),
    []
  );
  const groups = useMemo(() => filterSettingsNav(query, catalog), [catalog, query]);

  const renderRow = (section: { id: string; label: string; subsections: Array<{ id: string; label: string }> }) => {
    const meta = SETTINGS_SECTIONS.find((row) => row.id === section.id);
    const Icon = meta?.icon;
    return (
      <div key={section.id} className="settings-section-group">
        <Link
          to={getSettingsTabRoutePath(section.id, projectId)}
          data-testid={`settings-nav-${section.id}`}
          className={`settings-section-item ${settingsTab === section.id ? 'active' : ''}`}
          aria-current={settingsTab === section.id ? 'page' : undefined}
          onClick={() => setSettingsAnchor(null)}
        >
          {Icon ? <Icon size={16} aria-hidden="true" /> : null}
          <span className="settings-section-copy">
            <span className="settings-section-label">{section.label}</span>
          </span>
        </Link>
        {section.subsections.length > 0 ? (
          <div className="settings-subsection-list">
            {section.subsections.map((sub) => (
              <Link
                key={sub.id}
                to={getSettingsTabRoutePath(section.id, projectId)}
                className="settings-subsection-item"
                data-testid={`settings-nav-${section.id}-${sub.id}`}
                onClick={() => setSettingsAnchor(sub.id)}
              >
                {sub.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="sidebar settings-pane">
      <Link to={routeMemory.appRoutePath} className="settings-app-back">
        <ArrowLeft size={17} aria-hidden="true" />
        Back
      </Link>
      <div className="settings-search">
        <Search size={12} className="settings-search-icon" aria-hidden="true" />
        <input
          type="text"
          className="settings-search-input"
          data-testid="settings-search"
          aria-label="Search settings"
          placeholder="Search settings…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="settings-search-clear"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      <nav className="settings-picker" aria-label="Settings navigation">
            <div className="settings-group-label">Settings</div>
            {groups.length === 0 ? (
              <p className="settings-search-empty">No matching settings</p>
            ) : (
              groups.map((group) => (
                <div key={group.id} className="settings-group">
                  <div className="settings-group-label">{group.label}</div>
                  {group.sections.map(renderRow)}
                </div>
              ))
            )}
      </nav>
      <SidebarResizer />
    </aside>
  );
}
