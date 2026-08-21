import { ArrowLeft } from 'lucide-react';
import { useData, useUi } from '../../store.js';
import { SETTINGS_SECTIONS, SETTINGS_GROUPS } from '@/views/settings/SettingsView';

/**
 * Focused Settings rail. Each Settings section
 * (Global · Prompts · Plugins · Skills · MCP · Extensions, + the project-scoped
 * Project settings) is a row that sets `settingsTab`. Scope (Global vs a single
 * project) is chosen in the content header's scope control (see `ScopeControl`
 * in SettingsPanel.tsx), NOT here.
 *
 * `SETTINGS_SECTIONS` is the shared source of truth for labels/icons/descs.
 */
export function SettingsPane() {
  const settingsTab = useUi((s) => s.settingsTab);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const renderRow = (section: (typeof SETTINGS_SECTIONS)[number]) => {
    const { id, label, icon: Icon } = section;
    return (
      <div key={id} className="settings-section-group">
        <button
          type="button"
          data-testid={`settings-nav-${id}`}
          className={`settings-section-item ${settingsTab === id ? 'active' : ''}`}
          onClick={() => setSettingsTab(id)}
          aria-current={settingsTab === id ? 'page' : undefined}
        >
          <Icon size={16} aria-hidden="true" />
          <span className="settings-section-copy">
            <span className="settings-section-label">{label}</span>
          </span>
        </button>
      </div>
    );
  };

  return (
    <aside className="sidebar settings-pane">
      <button
        type="button"
        className="settings-app-back"
        onClick={() => useUi.getState().setNav('home')}
      >
        <ArrowLeft size={17} aria-hidden="true" />
        Back
      </button>
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
              <button
                type="button"
                data-testid="settings-nav-project"
                className={`settings-section-item ${settingsTab === 'project' ? 'active' : ''}`}
                onClick={() => setSettingsTab('project')}
                aria-current={settingsTab === 'project' ? 'page' : undefined}
              >
                <span className="settings-section-copy">
                  <span className="settings-section-label">Project settings</span>
                </span>
              </button>
            </div>
      </nav>
    </aside>
  );
}
