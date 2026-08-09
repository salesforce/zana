import { useEffect, useMemo, useState } from 'react';
import { Search, X, Settings, LayoutDashboard, Layers, Clock } from 'lucide-react';
import { useData, useUi, useScheduler, useScheduleGroups } from '../../store';
import { sortProjectsForDisplay, sortProjectsAlphabetically } from '../../store';
import { getScopedProjectId } from '../../util/windowScope';
import { groupIcon, GROUP_FALLBACK_COLOR } from '../scheduleGroupMeta';
import { ScheduleGroupsModal } from '../ScheduleGroupsModal';
import { ListPaneResizer } from '../ListPaneResizer';
import { SectionHeader } from './SectionHeader';

export function SchedulerPane() {
  const projects = useData((s) => s.projects);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const schedulerTab = useUi((s) => s.schedulerTab);
  const setSchedulerTab = useUi((s) => s.setSchedulerTab);
  const selectedGroupId = useUi((s) => s.selectedGroupId);
  const selectGroup = useUi((s) => s.selectGroup);
  const groups = useScheduleGroups((s) => s.groups);
  const tasks = useScheduler((s) => s.tasks);
  const collapsedSections = useUi((s) => s.collapsedSections);
  const hideSchedulelessProjects = useUi((s) => s.hideSchedulelessProjects);
  const toggleHideSchedulelessProjects = useUi((s) => s.toggleHideSchedulelessProjects);
  const [filter, setFilter] = useState('');
  const [managingGroups, setManagingGroups] = useState(false);
  // In a per-project window the scheduler is locked to this project: force the
  // 'project' scope on the scoped project and hide the cross-project Summary /
  // Groups / Ungrouped sections (the Project section already filters to it via
  // visibleProjects). The main window keeps the full scope switcher.
  const scopedProjectId = getScopedProjectId();
  useEffect(() => {
    if (scopedProjectId) {
      selectProject(scopedProjectId);
      setSchedulerTab('project');
    }
  }, [scopedProjectId, selectProject, setSchedulerTab]);
  const q = filter.trim().toLowerCase();

  // Per-project schedule counts, so the rail can badge projects that actually
  // have schedules and de-emphasize the ones that don't — the path tails alone
  // (all `/Users/<me>/Documents/…`) don't tell you where the work is.
  const countByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (t.source && t.source !== 'global') {
        const pid = (t.source as { projectId: string }).projectId;
        m.set(pid, (m.get(pid) ?? 0) + 1);
      }
    }
    return m;
  }, [tasks]);

  // Projects with schedules float to the top (count desc), then the rest in the
  // usual display order. The active project stays put wherever it sorts.
  const sortedProjects = useMemo(() => {
    const base = sortProjectsForDisplay(projects);
    return [...base].sort(
      (a, b) => (countByProject.get(b.id) ?? 0) - (countByProject.get(a.id) ?? 0)
    );
  }, [projects, countByProject]);

  const visibleProjects = useMemo(() => {
    let list = sortedProjects;
    if (q) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
      );
    }
    // "Only scheduled" toggle: keep projects that have at least one schedule.
    // The active project stays visible so the selection never vanishes.
    if (hideSchedulelessProjects) {
      list = list.filter(
        (p) => (countByProject.get(p.id) ?? 0) > 0 || p.id === selectedProjectId
      );
    }
    return list;
  }, [sortedProjects, q, hideSchedulelessProjects, countByProject, selectedProjectId]);

  // Per-group + ungrouped counts of global schedules, for the rail badges.
  const globalTasks = tasks.filter((t) => !t.source || t.source === 'global');
  const knownGroupIds = new Set(groups.map((g) => g.id));
  const countForGroup = (gid: string) => globalTasks.filter((t) => t.group === gid).length;
  const ungroupedCount = globalTasks.filter(
    (t) => !t.group || !knownGroupIds.has(t.group)
  ).length;

  return (
    <section className="list-pane">
      <header className="list-header">
        <h2>Scheduler</h2>
        {!scopedProjectId && (
          <button
            className={`icon-btn ${hideSchedulelessProjects ? 'on' : ''}`}
            aria-label={
              hideSchedulelessProjects
                ? 'Show all projects'
                : 'Show only projects with schedules'
            }
            aria-pressed={hideSchedulelessProjects}
            title={
              hideSchedulelessProjects
                ? 'Showing only projects with schedules'
                : 'Hide projects without schedules'
            }
            onClick={() => toggleHideSchedulelessProjects()}
          >
            <Clock size={16} />
          </button>
        )}
      </header>
      {projects.length > 4 && (
        <div className="list-filter">
          <Search size={12} className="list-filter-icon" />
          <input
            placeholder="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="list-filter-clear"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="list-body">
        {/* Summary + Groups + Ungrouped are cross-project — hidden in a scoped
            window, which shows only its one project's schedules below. */}
        {!scopedProjectId && (
          <div className="settings-scope-label">Summary</div>
        )}
        {!scopedProjectId && (
          <div
            className={`project-item ${schedulerTab === 'overview' ? 'active' : ''}`}
            onClick={() => setSchedulerTab('overview')}
          >
            <LayoutDashboard size={14} className="settings-scope-icon" />
            <div className="project-meta">
              <div className="project-name">Overview</div>
              <div className="project-path">All schedules at a glance</div>
            </div>
          </div>
        )}

        {!scopedProjectId && (
          <SectionHeader
            label="Groups"
            sectionKey="scheduler:groups"
            action={
              <button
                className="list-section-action"
                onClick={() => setManagingGroups(true)}
                title="Manage groups"
                aria-label="Manage groups"
              >
                <Settings size={12} />
              </button>
            }
          />
        )}
        {!scopedProjectId && !collapsedSections['scheduler:groups'] && (
          <>
            {groups.map((g) => {
              const active = schedulerTab === 'group' && selectedGroupId === g.id;
              const Icon = groupIcon(g.icon);
              const count = countForGroup(g.id);
              return (
                <div
                  key={g.id}
                  className={`project-item ${active ? 'active' : ''}`}
                  onClick={() => selectGroup(g.id)}
                  title={g.name}
                >
                  <Icon
                    size={14}
                    className="settings-scope-icon"
                    style={{ color: g.color ?? GROUP_FALLBACK_COLOR }}
                  />
                  <div className="project-meta">
                    <div className="project-name">{g.name}</div>
                  </div>
                  {count > 0 && <span className="list-count-badge">{count}</span>}
                </div>
              );
            })}
            <div
              className={`project-item project-item--ungrouped ${schedulerTab === 'global' ? 'active' : ''}`}
              onClick={() => setSchedulerTab('global')}
              title="App-wide schedules that aren't in a group"
            >
              <Layers size={14} className="settings-scope-icon" />
              <div className="project-meta">
                <div className="project-name">Ungrouped</div>
              </div>
              {ungroupedCount > 0 && <span className="list-count-badge">{ungroupedCount}</span>}
            </div>
          </>
        )}

        <SectionHeader label="Project" sectionKey="scheduler:project" />
        {collapsedSections['scheduler:project'] ? null : sortedProjects.length === 0 ? (
          <div className="list-empty">No projects yet.</div>
        ) : visibleProjects.length === 0 ? (
          filter.trim() ? (
            <div className="list-empty">No projects match &ldquo;{filter}&rdquo;.</div>
          ) : (
            <div className="list-empty">
              No projects with schedules.
              <br />
              <button
                type="button"
                className="list-empty-link"
                onClick={() => toggleHideSchedulelessProjects()}
              >
                Show all projects
              </button>
            </div>
          )
        ) : (
          visibleProjects.map((p) => {
            const active = schedulerTab === 'project' && selectedProjectId === p.id;
            const count = countByProject.get(p.id) ?? 0;
            return (
              <div
                key={p.id}
                className={`project-item project-item--compact ${active ? 'active' : ''} ${
                  count === 0 ? 'project-item--empty' : ''
                }`}
                onClick={() => {
                  selectProject(p.id);
                  setSchedulerTab('project');
                }}
                title={`${p.name} — ${p.path}`}
              >
                <span
                  className={`project-dot ${count === 0 ? 'project-dot--hollow' : ''}`}
                  style={p.color && count > 0 ? { background: p.color } : undefined}
                />
                <div className="project-meta">
                  <div className="project-name">{p.name}</div>
                </div>
                {count > 0 && <span className="list-count-badge">{count}</span>}
              </div>
            );
          })
        )}
      </div>
      <ListPaneResizer />
      {managingGroups && <ScheduleGroupsModal onClose={() => setManagingGroups(false)} />}
    </section>
  );
}
