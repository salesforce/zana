import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useData, useUi } from '../../store';
import type { SettingsTab } from '../../store';
import { SETTINGS_SECTIONS, SETTINGS_GROUPS, SETTINGS_SUBSECTIONS } from '../SettingsPanel';
import { useMergedModules } from '../../modules';
import { ListPaneResizer } from '../ListPaneResizer';

/**
 * Settings list pane (column 2): the **section picker**. Each Settings section
 * (Global · Prompts · Plugins · Skills · MCP · Extensions, + the project-scoped
 * Project settings) is a row that sets `settingsTab`. Scope (Global vs a single
 * project) is chosen in the content header's scope control (see `ScopeControl`
 * in SettingsPanel.tsx), NOT here — so this column no longer lists projects.
 *
 * `SETTINGS_SECTIONS` is the shared source of truth for labels/icons/descs.
 */
export function SettingsPane() {
  const settingsTab = useUi((s) => s.settingsTab);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const setSettingsAnchor = useUi((s) => s.setSettingsAnchor);
  const settingsExtensionId = useUi((s) => s.settingsExtensionId);
  const selectSettingsExtension = useUi((s) => s.selectSettingsExtension);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  // Every module the shell knows (built-ins + runtime extensions), the SAME
  // source the Extensions hub lists — so the picker's Extensions sub-list mirrors
  // the hub exactly. Core stays extension-agnostic here (Rule 6): the sub-list is
  // derived from the merged module set, never a hard-coded id.
  const modules = useMergedModules();
  const extensionSubs = useMemo(
    () => [...modules].sort((a, b) => a.title.localeCompare(b.title)),
    [modules]
  );

  // Free-text filter over the whole picker — section labels/descriptions, their
  // static jump-anchors, and the dynamic extension sub-list. A section survives
  // if it OR any of its sub-items matches, so a hit like "overseer" keeps the
  // Agents section (and only its matching anchors) visible.
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const extSubsFor = (id: SettingsTab) =>
    id === 'extensions'
      ? extensionSubs.map((m) => ({ id: m.id, label: m.title }))
      : SETTINGS_SUBSECTIONS[id] ?? [];

  const matchesSection = (s: (typeof SETTINGS_SECTIONS)[number]) => {
    if (!q) return true;
    if (s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)) return true;
    return extSubsFor(s.id).some((sub) => sub.label.toLowerCase().includes(q));
  };
  // Sub-items to show for a section given the query: when the section label
  // itself matched, show all of its sub-items; otherwise show only the matching
  // ones (so a query narrows the expanded list to what it hit).
  const visibleSubs = (s: (typeof SETTINGS_SECTIONS)[number]) => {
    const subs = extSubsFor(s.id);
    if (!q) return subs;
    if (s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)) return subs;
    return subs.filter((sub) => sub.label.toLowerCase().includes(q));
  };

  // Jump to a sub-section: switch to its tab, then hand the anchor to the panel
  // which scrolls it into view once rendered (see SettingsPanel's scroll effect).
  const jumpToAnchor = (tab: SettingsTab, anchor: string) => {
    setSettingsTab(tab);
    setSettingsAnchor(anchor);
  };

  const renderRow = (section: (typeof SETTINGS_SECTIONS)[number]) => {
    const { id, label, desc } = section;
    const subs = visibleSubs(section);
    // The Extensions section expands into one jump-link per installed module, so
    // you can navigate straight to an extension's own settings. Dynamic (mirrors
    // the hub), unlike the static anchor sub-lists above.
    if (id === 'extensions') {
      return (
        <div key={id} className="settings-section-group">
          <div
            className={`project-item settings-section-item ${settingsTab === id ? 'active' : ''}`}
            onClick={() => setSettingsTab(id)}
          >
            <div className="project-meta">
              <div className="project-name">{label}</div>
              <div className="project-path">{desc}</div>
            </div>
          </div>
          {subs.length > 0 && (
            <div className="settings-subsection-list">
              {subs.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  className={`settings-subsection-item ${
                    settingsTab === 'extensions' && settingsExtensionId === sub.id ? 'active' : ''
                  }`}
                  onClick={() => selectSettingsExtension(sub.id)}
                  title={sub.label}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={id} className="settings-section-group">
        <div
          className={`project-item settings-section-item ${settingsTab === id ? 'active' : ''}`}
          onClick={() => setSettingsTab(id)}
        >
          <div className="project-meta">
            <div className="project-name">{label}</div>
            <div className="project-path">{desc}</div>
          </div>
        </div>
        {subs.length > 0 && (
          <div className="settings-subsection-list">
            {subs.map((sub) => (
              <button
                key={sub.id}
                type="button"
                className="settings-subsection-item"
                onClick={() => jumpToAnchor(id, sub.id)}
              >
                {sub.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const projectMatches =
    !q ||
    'project settings'.includes(q) ||
    (selectedProject ? selectedProject.name.toLowerCase().includes(q) : 'project specific harness'.includes(q));

  const anyMatch =
    SETTINGS_SECTIONS.some(matchesSection) || projectMatches;

  return (
    <section className="list-pane">
      <header className="list-header">
        <h2>Settings</h2>
      </header>
      <div className="settings-search">
        <Search size={14} className="settings-search-icon" aria-hidden />
        <input
          type="text"
          className="settings-search-input"
          placeholder="Search settings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search settings"
        />
        {query && (
          <button
            type="button"
            className="settings-search-clear"
            onClick={() => setQuery('')}
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="list-body settings-picker">
        {SETTINGS_GROUPS.map((group) => {
          const sections = SETTINGS_SECTIONS.filter(
            (s) => s.group === group.id && matchesSection(s)
          );
          if (sections.length === 0) return null;
          return (
            <div key={group.id} className="settings-group">
              <div className="settings-group-label">{group.label}</div>
              {sections.map(renderRow)}
            </div>
          );
        })}
        {projectMatches && (
          <div className="settings-group">
            <div className="settings-group-label">Project</div>
            <div
              className={`project-item settings-section-item ${settingsTab === 'project' ? 'active' : ''}`}
              onClick={() => setSettingsTab('project')}
            >
              <div className="project-meta">
                <div className="project-name">Project settings</div>
                <div className="project-path">
                  {selectedProject ? selectedProject.name : 'Project specific harness'}
                </div>
              </div>
            </div>
          </div>
        )}
        {!anyMatch && <div className="settings-search-empty">No settings match "{query}".</div>}
      </div>
      <ListPaneResizer />
    </section>
  );
}
