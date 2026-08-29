import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData, useUi } from '../../store.js';
import { SETTINGS_SECTIONS, SETTINGS_GROUPS } from '@/views/settings/SettingsView';
import { SidebarResizer } from '../SidebarResizer.js';
import { useAppSettingsRouteMemory } from '../../hooks/useAppSettingsRouteMemory.js';
import { getSettingsTabRoutePath } from '../../lib/route-paths.js';

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
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const projects = useData((s) => s.projects);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const routeMemory = useAppSettingsRouteMemory();
  const projectId = focusedProjectId ?? selectedProjectId ?? selectedProject?.id ?? null;

  const renderRow = (section: (typeof SETTINGS_SECTIONS)[number]) => {
    const { id, label, icon: Icon } = section;
    return (
      <div key={id} className="settings-section-group">
        <Link
          to={getSettingsTabRoutePath(id, projectId)}
          data-testid={`settings-nav-${id}`}
          className={`settings-section-item ${settingsTab === id ? 'active' : ''}`}
          aria-current={settingsTab === id ? 'page' : undefined}
        >
          <Icon size={16} aria-hidden="true" />
          <span className="settings-section-copy">
            <span className="settings-section-label">{label}</span>
          </span>
        </Link>
      </div>
    );
  };

  return (
    <aside className="sidebar settings-pane">
      <Link to={routeMemory.appRoutePath} className="settings-app-back">
        <ArrowLeft size={17} aria-hidden="true" />
        Back
      </Link>
      <nav className="settings-picker" aria-label="Settings navigation">
            <div className="settings-group-label">Settings</div>
            {SETTINGS_GROUPS.map((group) => {
              const sections = SETTINGS_SECTIONS.filter((section) => section.group === group.id);
              if (sections.length === 0) return null;
              return (
                <div key={group.id} className="settings-group">
                  <div className="settings-group-label">{group.label}</div>
                  {sections.map(renderRow)}
                </div>
              );
            })}
            <div className="settings-group">
              <div className="settings-group-label">Project</div>
              <Link
                to={getSettingsTabRoutePath('project', projectId)}
                data-testid="settings-nav-project"
                className={`settings-section-item ${settingsTab === 'project' ? 'active' : ''}`}
                aria-current={settingsTab === 'project' ? 'page' : undefined}
              >
                <span className="settings-section-copy">
                  <span className="settings-section-label">Project settings</span>
                </span>
              </Link>
            </div>
      </nav>
      <SidebarResizer />
    </aside>
  );
}
