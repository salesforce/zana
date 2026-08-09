import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, X, Check, Pencil, Code2, FolderOpen, TerminalSquare, LayoutDashboard, Settings2, Network, GitBranch, ClipboardCopy, Star, AppWindow, RefreshCw, Activity, ChevronRight } from 'lucide-react';
import { CursorIcon } from '../icons/CursorIcon';
import {
  useData,
  useUi,
  sortProjectsForDisplay,
  sortProjectsAlphabetically,
  listedTerminals,
  liveTerminals
} from '../../store';
import type { OpenTarget, Project } from '@shared/types';
import { profileIcon } from '../../util/profileIcon';
import { getScopedProjectId } from '../../util/windowScope';
import { PROJECT_COLORS } from '@shared/project-colors';
import { ListPaneResizer } from '../ListPaneResizer';
import { AddRemoteProjectDialog } from '../AddRemoteProjectDialog';
import { AddGitProjectDialog } from '../AddGitProjectDialog';
import { AddLocalProjectDialog } from '../AddLocalProjectDialog';
import { SectionHeader } from './SectionHeader';
import { AgentStatusDot } from './AgentStatusDot';
import { AgentRowDetail } from './AgentRowDetail';
import { ProjectRollupDot } from './ProjectRollupDot';

interface MenuState {
  projectId: string;
  x: number;
  y: number;
}

export function ProjectsList() {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const closeTerminal = useData((s) => s.closeTerminal);
  const loadProjects = useData((s) => s.loadProjects);
  const loadGitStatus = useData((s) => s.loadGitStatus);
  const addProjectByPath = useData((s) => s.addProjectByPath);
  const addRemoteProject = useData((s) => s.addRemoteProject);
  const cloneProject = useData((s) => s.cloneProject);
  const removeProject = useData((s) => s.removeProject);
  const updateProject = useData((s) => s.updateProject);
  const reorderProjects = useData((s) => s.reorderProjects);
  const selectedId = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const enterProjectFocus = useUi((s) => s.enterProjectFocus);
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const exitProjectFocus = useUi((s) => s.exitProjectFocus);
  const setLauncherOpen = useUi((s) => s.setLauncherOpen);
  const setNav = useUi((s) => s.setNav);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const pushToast = useUi((s) => s.pushToast);
  const unread = useUi((s) => s.unread);
  const gitStatus = useData((s) => s.gitStatus);
  const projectExpanded = useUi((s) => s.projectExpanded);
  const setProjectExpanded = useUi((s) => s.setProjectExpanded);
  const hideIdleProjects = useUi((s) => s.hideIdleProjects);
  const toggleHideIdleProjects = useUi((s) => s.toggleHideIdleProjects);
  const collapsedSections = useUi((s) => s.collapsedSections);
  // Non-null in a per-project window: the rail is locked to this one project.
  const scopedProjectId = getScopedProjectId();

  const openIn = async (target: OpenTarget, path: string) => {
    try {
      const r = await window.cc.openers.openIn(target, path);
      if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : `Failed to open in ${target}`, 'error');
    }
  };
  const [dropOver, setDropOver] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showRemoteDialog, setShowRemoteDialog] = useState(false);
  const [showGitDialog, setShowGitDialog] = useState(false);
  const [showLocalDialog, setShowLocalDialog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Manual reload of the project list — covers out-of-band edits to
  // projects.json that the live `projects:onChanged` push didn't originate
  // (e.g. another window, a hand-edit, or a stale list after sleep). Also
  // re-pulls git status for the projects currently in view so branch/dirty
  // chips don't lag behind. Guarded by `refreshing` so a double-click can't
  // stack reloads; the spinner gives the gesture visible feedback.
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadProjects();
      await Promise.all(visibleProjects.map((p) => loadGitStatus(p.id)));
    } finally {
      setRefreshing(false);
    }
  };

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
    setMenu(null);
  };

  const commitRename = () => {
    if (renamingId) {
      const v = renameValue.trim();
      if (v) updateProject(renamingId, { name: v });
    }
    setRenamingId(null);
  };

  // "+" on a project row: focus the project and open the SAME agent launcher
  // modal that the per-project Agents board's "+ New agent" opens (the
  // `AgentLauncher` rendered by Workspace when `launcherOpen` is set). Entering
  // focus mounts the project Workspace so the modal has a project to launch
  // into; the Agents board is its default focus mode, so opening the launcher
  // there mirrors the in-project path exactly — one component, one behavior.
  const spawnDefaultAgent = (p: Project) => {
    enterProjectFocus(p.id);
    setLauncherOpen(true);
  };

  const sortedProjects = sortProjectsForDisplay(projects);

  // A project is "active" when it has at least one live session — any listed
  // (visible or hidden-but-running) session whose pty hasn't exited. Keeps the
  // selected project visible regardless, so toggling the filter never hides the
  // row the user is currently in.
  const projectHasRunningAgents = (p: Project) =>
    listedTerminals(terminals[p.id]).some((t) => t.status !== 'exited');

  // Whether a project's agent sub-list is shown. The rail auto-expands any
  // project with a live agent so its running agents are visible at a glance
  // without a click; the user's explicit choice (stored boolean) always wins
  // over that default, so collapsing a busy project sticks.
  const isProjectExpanded = (p: Project) =>
    projectExpanded[p.id] ?? projectHasRunningAgents(p);

  const visibleProjects = useMemo(() => {
    // A per-project window locks the rail to its one project — no other projects
    // are reachable in a scoped window, so neither filter nor idle-hide apply.
    if (scopedProjectId) {
      return sortedProjects.filter((p) => p.id === scopedProjectId);
    }
    let list = sortedProjects;
    if (hideIdleProjects) {
      list = list.filter((p) => p.id === selectedId || projectHasRunningAgents(p));
    }
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  }, [sortedProjects, scopedProjectId, hideIdleProjects, selectedId, filter, projectHasRunningAgents]);

  // Rail rows = an interleaved list of section headers and project items, so the
  // single render loop below can stay one `.map`. Projects are split into Remote
  // (SSH) and Local, each sorted alphabetically by name. A scoped per-project
  // window shows just its one project, ungrouped (no headers). The Local header
  // is omitted when there are no Remote projects — a lone "Local" label is noise
  // on a local-only setup.
  type RailRow = { kind: 'header'; label: string; sectionKey: string } | { kind: 'project'; project: Project };
  const railRows: RailRow[] = useMemo(() => {
    if (scopedProjectId) return visibleProjects.map((project) => ({ kind: 'project', project }));
    // Favorites float to the top in their own section, pulled out of the
    // Remote/Local groups so a pinned project shows once (not twice). Category
    // projects (currently the per-extension "Extensions" homes the create-your-
    // own-extension flow spawns) form their own named section too, so a favorited
    // extension project still shows once. The remaining projects split into
    // Remote (SSH) and Local, each A→Z.
    const favorites = sortProjectsAlphabetically(visibleProjects.filter((p) => p.favorite));
    const rest = visibleProjects.filter((p) => !p.favorite);
    const extensions = sortProjectsAlphabetically(
      rest.filter((p) => p.category === 'Extensions')
    );
    const categorized = new Set(extensions.map((p) => p.id));
    const uncategorized = rest.filter((p) => !categorized.has(p.id));
    const remote = sortProjectsAlphabetically(uncategorized.filter((p) => p.remote));
    const local = sortProjectsAlphabetically(uncategorized.filter((p) => !p.remote));
    const rows: RailRow[] = [];
    if (favorites.length > 0) {
      rows.push({ kind: 'header', label: 'Favorites', sectionKey: 'projects:favorites' });
      if (!collapsedSections['projects:favorites']) {
        for (const project of favorites) rows.push({ kind: 'project', project });
      }
    }
    if (extensions.length > 0) {
      rows.push({ kind: 'header', label: 'Extensions', sectionKey: 'projects:extensions' });
      if (!collapsedSections['projects:extensions']) {
        for (const project of extensions) rows.push({ kind: 'project', project });
      }
    }
    if (remote.length > 0) {
      rows.push({ kind: 'header', label: 'Remote', sectionKey: 'projects:remote' });
      if (!collapsedSections['projects:remote']) {
        for (const project of remote) rows.push({ kind: 'project', project });
      }
    }
    // Label Local when it needs to be told apart from a section above it
    // (Remote, Favorites, or Extensions); otherwise show local rows bare.
    if (remote.length > 0 || favorites.length > 0 || extensions.length > 0) {
      if (local.length > 0) {
        rows.push({ kind: 'header', label: 'Local', sectionKey: 'projects:local' });
        if (!collapsedSections['projects:local']) {
          for (const project of local) rows.push({ kind: 'project', project });
        }
      }
    } else {
      for (const project of local) rows.push({ kind: 'project', project });
    }
    return rows;
  }, [visibleProjects, scopedProjectId, collapsedSections]);

  const handleProjectDrop = (toId: string) => {
    const fromId = draggingProjectId;
    setDraggingProjectId(null);
    setDragOverProjectId(null);
    if (!fromId || fromId === toId) return;
    // Reorder against the full sorted list, not the filtered view, so
    // dragging while filtering doesn't reshuffle invisible projects.
    const ids = sortedProjects.map((p) => p.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = ids.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    reorderProjects(next);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  // Clamp the context menu into the viewport. It's positioned at the raw click
  // coordinates, so right-clicking low in the list would otherwise push the
  // bottom items (Rename, Remove project) off-screen and out of reach.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (!el) return;
    const PAD = 8;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - PAD) {
      left = Math.max(PAD, window.innerWidth - rect.width - PAD);
    }
    if (top + rect.height > window.innerHeight - PAD) {
      top = Math.max(PAD, window.innerHeight - rect.height - PAD);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [menu]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.project-delete-armed')) return;
      setConfirmDeleteId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDeleteId(null);
    };
    const timer = window.setTimeout(() => setConfirmDeleteId(null), 4000);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [confirmDeleteId]);

  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropOver) setDropOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDropOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const files = Array.from(e.dataTransfer.files);
    const paths = files
      .map((f) => window.cc.files.pathForFile(f))
      .filter(Boolean);
    let lastAdded: { id: string } | null = null;
    for (const path of paths) {
      const p = await addProjectByPath(path);
      if (p) lastAdded = p;
    }
    if (lastAdded) selectProject(lastAdded.id);
  };

  return (
    <section
      className={`list-pane ${dropOver ? 'drop-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="list-header">
        <h2>Projects</h2>
        {/* Both actions live in one right-pinned group so `space-between` keeps
            them together on the right (a bare third child would strand Refresh
            in the middle of the header). */}
        <div className="list-header-actions">
          <button
            className="icon-btn"
            aria-label="Reload project list"
            title="Reload projects"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : undefined} />
          </button>
          <button
            className={`icon-btn ${hideIdleProjects ? 'on' : ''}`}
            aria-label={hideIdleProjects ? 'Show all projects' : 'Show only projects with running agents'}
            aria-pressed={hideIdleProjects}
            title={hideIdleProjects ? 'Showing only projects with running agents' : 'Hide projects without running agents'}
            onClick={() => toggleHideIdleProjects()}
          >
            <Activity size={16} />
          </button>
        </div>
      </header>
      {/* Three ways to add a project, each labeled so the type is obvious:
          a local folder, a Git clone, or a remote (SSH) box. */}
      <div className="list-add-row" role="group" aria-label="Add a project">
        <button
          className="list-add-btn"
          aria-label="Add a local folder as a project"
          title="Pick a local folder, or type a path, to add as a project"
          onClick={() => setShowLocalDialog(true)}
        >
          <FolderOpen size={14} />
          <span>Folder</span>
        </button>
        <button
          className="list-add-btn"
          aria-label="Import a project from a git URL"
          title="Clone a repository from a git URL and add it"
          onClick={() => setShowGitDialog(true)}
        >
          <GitBranch size={14} />
          <span>Git</span>
        </button>
        <button
          className="list-add-btn"
          aria-label="Add a remote (SSH) project"
          title="Add a remote (SSH) dev box as a project"
          onClick={() => setShowRemoteDialog(true)}
        >
          <Network size={14} />
          <span>Remote</span>
        </button>
      </div>
      {projects.length > 0 && (
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
      {/* Overview is pinned above the scroll area (like the filter), so only the
          project sections scroll under it. */}
      <button
        type="button"
        className={`list-overview ${!focusedProjectId ? 'active' : ''}`}
        onClick={() => exitProjectFocus()}
        aria-pressed={!focusedProjectId}
        title="Show every agent across all projects"
      >
        <LayoutDashboard size={14} />
        <span>Overview</span>
      </button>
      <div className="list-body">
        {projects.length === 0 ? (
          <div className="list-empty">
            No projects yet.
            <br />
            Add a <strong>Folder</strong>, <strong>Git</strong> repo, or <strong>Remote</strong>{' '}
            box above — or drop a folder here.
          </div>
        ) : visibleProjects.length === 0 ? (
          filter.trim() ? (
            <div className="list-empty">No projects match &ldquo;{filter}&rdquo;.</div>
          ) : (
            <div className="list-empty">
              No projects with running agents.
              <br />
              <button
                type="button"
                className="list-empty-link"
                onClick={() => toggleHideIdleProjects()}
              >
                Show all projects
              </button>
            </div>
          )
        ) : (
          railRows.map((row) =>
            row.kind === 'header' ? (
              <SectionHeader key={`hdr:${row.sectionKey}`} label={row.label} sectionKey={row.sectionKey} variant="divider" />
            ) : ((p) => (
            <div key={p.id} className="project-group">
            <div
              className={`project-item ${selectedId === p.id ? 'active' : ''} ${
                draggingProjectId === p.id ? 'dragging' : ''
              } ${
                dragOverProjectId === p.id &&
                draggingProjectId &&
                draggingProjectId !== p.id
                  ? 'drag-over'
                  : ''
              }`}
              onClick={() => enterProjectFocus(p.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ projectId: p.id, x: e.clientX, y: e.clientY });
              }}
              draggable={renamingId !== p.id}
              onDragStart={(e) => {
                if (renamingId === p.id) {
                  e.preventDefault();
                  return;
                }
                setDraggingProjectId(p.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/x-cc-project', p.id);
              }}
              onDragEnter={(e) => {
                if (!draggingProjectId || draggingProjectId === p.id) return;
                e.preventDefault();
                setDragOverProjectId(p.id);
              }}
              onDragOver={(e) => {
                if (!draggingProjectId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                if (!draggingProjectId) return;
                // Don't let project-reorder drops bubble to the section's
                // file-drop handler (which adds new projects from the OS).
                e.preventDefault();
                e.stopPropagation();
                handleProjectDrop(p.id);
              }}
              onDragEnd={() => {
                setDraggingProjectId(null);
                setDragOverProjectId(null);
              }}
            >
              {(() => {
                // The inline expansion shows only LIVE agents (exited ones
                // auto-drop out — the drill-in focus view keeps the history), so
                // the disclosure chevron follows the same live set: a project
                // with only exited sessions reads as agentless here.
                const list = liveTerminals(terminals[p.id]);
                // No live sessions → no disclosure, but keep its slot so the
                // project dot + name align with rows that do have a chevron
                // (otherwise agentless projects shift left and the rail looks
                // ragged).
                if (list.length === 0)
                  return <span className="project-tree-chevron project-tree-chevron--placeholder" aria-hidden="true" />;
                const expanded = isProjectExpanded(p);
                return (
                  <button
                    type="button"
                    className={`project-tree-chevron ${expanded ? 'expanded' : ''}`}
                    aria-label={expanded ? 'Collapse sessions' : 'Expand sessions'}
                    aria-expanded={expanded}
                    onClick={(e) => {
                      e.stopPropagation();
                      setProjectExpanded(p.id, !expanded);
                    }}
                  >
                    <ChevronRight size={14} />
                  </button>
                );
              })()}
              {(() => {
                const list = listedTerminals(terminals[p.id]);
                const hasUnread = list.some((t) => unread[t.id]);
                return (
                  <span
                    className={`project-dot ${hasUnread ? 'unread' : ''}`}
                    style={p.color ? { background: p.color } : undefined}
                    title={hasUnread ? 'New activity' : undefined}
                  />
                );
              })()}
              {(() => {
                // One-line row: name + inline git status. Path, tag and remote
                // host move into the row tooltip so the rail stays compact.
                const g = gitStatus[p.id];
                const tooltip = [
                  p.path,
                  p.tag ? `#${p.tag}` : null,
                  p.remote
                    ? `Remote SSH: ${p.remote.user ? `${p.remote.user}@` : ''}${p.remote.host}`
                    : null
                ]
                  .filter(Boolean)
                  .join('\n');
                return (
                  <div className="project-meta project-meta--inline" title={tooltip || undefined}>
                    {renamingId === p.id ? (
                      <input
                        className="project-rename"
                        value={renameValue}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRename();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenamingId(null);
                          }
                        }}
                      />
                    ) : (
                      <div
                        className="project-name"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startRename(p.id, p.name);
                        }}
                      >
                        {p.name}
                      </div>
                    )}
                    {p.remote && (
                      <Network
                        size={11}
                        strokeWidth={2}
                        className="project-remote-icon"
                        aria-label="Remote SSH project"
                      />
                    )}
                    {g && (
                      <span className="project-git">
                        <span className="project-git-branch">
                          {g.detached ? '(detached)' : g.branch ?? '?'}
                        </span>
                        {g.dirty && <span className="project-git-dirty" title="Uncommitted changes">●</span>}
                        {g.ahead > 0 && <span className="project-git-ahead" title="Ahead">↑{g.ahead}</span>}
                        {g.behind > 0 && <span className="project-git-behind" title="Behind">↓{g.behind}</span>}
                      </span>
                    )}
                  </div>
                );
              })()}
              {/* Live agent rollup: the most-urgent state across the project's
               *  sessions (blocked → working → done → idle). Sits before the
               *  run-count badge so "needs you" reads at a glance. Suppressed
               *  when the project is expanded — the per-agent dots below already
               *  show each session's state, so the rollup would just duplicate
               *  them (and pile a third gold dot next to the git-dirty mark).
               *  It earns its place only collapsed, as the sole summary. */}
              {!isProjectExpanded(p) && <ProjectRollupDot projectId={p.id} />}
              {(() => {
                // Count across all listed sessions (visible + hidden-but-alive);
                // a closed-but-running tab still counts toward the project total.
                const list = listedTerminals(terminals[p.id]);
                const running = list.filter((t) => t.status !== 'exited').length;
                const exited = list.filter((t) => t.status === 'exited').length;
                const crashed = list.filter(
                  (t) => t.status === 'exited' && (t.exitCode ?? 0) !== 0
                ).length;
                if (list.length === 0) return null;
                const titleParts = [`${running} running`, `${exited} exited`];
                if (crashed > 0) titleParts.push(`${crashed} crashed`);
                return (
                  <span
                    className={`project-badge ${
                      crashed > 0 ? 'has-crashed' : ''
                    }`}
                    title={titleParts.join(', ')}
                  >
                    {running}
                    {exited > 0 && <span className="project-badge-exited">·{exited}</span>}
                    {crashed > 0 && (
                      <span className="project-badge-crashed" aria-hidden="true" />
                    )}
                  </span>
                );
              })()}
              {/* Spawn the project's default agent right from the rail row —
               *  reveals on hover (like the session-row X) so idle rows stay
               *  clean. Stops propagation so it doesn't drill into the project. */}
              <button
                type="button"
                className="project-spawn"
                aria-label={`New agent in ${p.name}`}
                title="New agent"
                onClick={(e) => {
                  e.stopPropagation();
                  spawnDefaultAgent(p);
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            {(() => {
              // Live agents only — an agent that exits drops out of the rail on
              // its own (no manual dismiss); its tombstone stays in the drill-in
              // focus view. The exited/`bad` branches below are kept defensive in
              // case a session flips to exited between this read and paint.
              const list = liveTerminals(terminals[p.id]);
              if (!isProjectExpanded(p) || list.length === 0) return null;
              const activeTab = selectedId === p.id ? selectedTabId[p.id] : undefined;
              return (
                <div className="project-terminals" role="list">
                  {list.map((t) => {
                    const exited = t.status === 'exited';
                    const bad = exited && (t.exitCode ?? 0) !== 0;
                    const isUnread = !!unread[t.id] && activeTab !== t.id;
                    return (
                    <div
                      key={t.id}
                      role="listitem"
                      className={`project-terminal-row ${
                        exited ? 'exited' : ''
                      } ${bad ? 'exited-bad' : ''} ${isUnread ? 'unread' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Clicking an agent row opens the agent-inspector modal —
                        // the same peek-at-the-terminal modal the Agents board and
                        // tray open — instead of navigating into the workspace.
                        // The rail row isn't a "selected tab", so it carries no
                        // active highlight. The modal handles live, hidden, and
                        // exited sessions itself.
                        useUi.getState().openAgentModal(t.id, p.id);
                      }}
                      aria-label={isUnread ? `${t.title} · unread output` : undefined}
                      title={
                        exited && t.exitCode != null
                          ? `${t.title} · exited (code ${t.exitCode})`
                          : isUnread
                            ? `${t.title} · unread output`
                            : t.title
                      }
                    >
                      <span
                        className={`tab-profile-icon profile-${t.profile}`}
                        aria-hidden="true"
                      >
                        {profileIcon(t.profile)}
                      </span>
                      <div className="project-terminal-text">
                        <span className="project-terminal-name">{t.title}</span>
                        <AgentRowDetail session={t} />
                      </div>
                      <AgentStatusDot sessionId={t.id} />
                      {bad && (
                        <span className="project-terminal-exit-bad" aria-label={`Exit code ${t.exitCode}`}>
                          ✗{t.exitCode}
                        </span>
                      )}
                      <button
                        type="button"
                        className="project-terminal-close"
                        aria-label={exited ? `Dismiss ${t.title}` : `Delete ${t.title}`}
                        title={exited ? 'Dismiss' : 'Delete (ends the process)'}
                        onClick={(e) => {
                          e.stopPropagation();
                          // This is the explicit DELETE path (unlike the tab
                          // strip's X, which now hides). Confirm before killing
                          // a live process so a stray click can't terminate a
                          // running agent; exited tabs dismiss without a prompt.
                          if (
                            !exited &&
                            !window.confirm(
                              `Delete "${t.title}"? The process will be terminated.`
                            )
                          ) {
                            return;
                          }
                          closeTerminal(t.id, p.id);
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    );
                  })}
                </div>
              );
            })()}
            </div>
          ))(row.project)
          )
        )}
      </div>
      {menu && (() => {
        const p = projects.find((pr) => pr.id === menu.projectId);
        return (
        <div
          ref={menuRef}
          className="project-menu"
          style={{ top: menu.y, left: menu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {p && (
            <>
              <button
                className="project-menu-item"
                onClick={() => {
                  setMenu(null);
                  void updateProject(p.id, { favorite: !p.favorite });
                }}
              >
                <Star size={12} className={p.favorite ? 'project-menu-star-on' : undefined} />
                <span>{p.favorite ? 'Remove from favorites' : 'Add to favorites'}</span>
              </button>
              <div className="project-menu-sep" />
              <button
                className="project-menu-item"
                onClick={() => { setMenu(null); openIn('cursor', p.path); }}
              >
                <CursorIcon size={12} />
                <span>Open in Cursor</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => { setMenu(null); openIn('code', p.path); }}
              >
                <Code2 size={12} />
                <span>Open in VS Code</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => { setMenu(null); openIn('finder', p.path); }}
              >
                <FolderOpen size={12} />
                <span>Reveal in Finder</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => { setMenu(null); openIn('terminal', p.path); }}
              >
                <TerminalSquare size={12} />
                <span>Open in external Terminal</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => {
                  setMenu(null);
                  void navigator.clipboard.writeText(p.path).then(
                    () => pushToast('Path copied', 'info'),
                    () => pushToast('Failed to copy path', 'error')
                  );
                }}
              >
                <ClipboardCopy size={12} />
                <span>Copy path</span>
              </button>
              {!scopedProjectId && (
                <button
                  className="project-menu-item"
                  onClick={() => {
                    setMenu(null);
                    void window.cc.windows.openProject(p.id);
                  }}
                >
                  <AppWindow size={12} />
                  <span>Open in new window</span>
                </button>
              )}
              <div className="project-menu-sep" />
              <button
                className="project-menu-item"
                onClick={() => {
                  setMenu(null);
                  selectProject(p.id);
                  setSettingsTab('project');
                  setNav('settings');
                }}
              >
                <Settings2 size={12} />
                <span>Project settings…</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => startRename(p.id, p.name)}
              >
                <Pencil size={12} />
                <span>Rename</span>
              </button>
              {(() => {
                const armed = confirmDeleteId === p.id;
                const running = listedTerminals(terminals[p.id]).filter((t) => t.status !== 'exited').length;
                return (
                  <button
                    className={`project-menu-item danger ${armed ? 'project-delete-armed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (armed) {
                        setConfirmDeleteId(null);
                        setMenu(null);
                        removeProject(p.id);
                      } else {
                        setConfirmDeleteId(p.id);
                      }
                    }}
                  >
                    {armed ? <Check size={12} /> : <Trash2 size={12} />}
                    <span>
                      {armed
                        ? running > 0
                          ? `Click to confirm (${running} running)`
                          : 'Click to confirm'
                        : 'Remove project'}
                    </span>
                  </button>
                );
              })()}
            </>
          )}
          <div className="project-menu-label">Color</div>
          <div className="project-menu-swatches">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                className="project-swatch"
                style={{ background: c }}
                aria-label={`Set color ${c}`}
                onClick={() => {
                  updateProject(menu.projectId, { color: c });
                  setMenu(null);
                }}
              />
            ))}
            <button
              className="project-swatch reset"
              aria-label="Reset color"
              onClick={() => {
                updateProject(menu.projectId, { color: undefined });
                setMenu(null);
              }}
            >
              ×
            </button>
          </div>
        </div>
        );
      })()}
      <ListPaneResizer />
      {showRemoteDialog && (
        <AddRemoteProjectDialog
          onClose={() => setShowRemoteDialog(false)}
          onSubmit={async (input) => {
            const p = await addRemoteProject(input);
            setShowRemoteDialog(false);
            if (p) selectProject(p.id);
          }}
        />
      )}
      {showGitDialog && (
        <AddGitProjectDialog
          onClose={() => setShowGitDialog(false)}
          onClone={(input) => cloneProject(input)}
          onSuccess={(projectId) => selectProject(projectId)}
        />
      )}
      {showLocalDialog && (
        <AddLocalProjectDialog
          onClose={() => setShowLocalDialog(false)}
          onBrowse={() => window.cc.projects.pickDirectory()}
          onSubmit={async (path) => {
            const p = await addProjectByPath(path);
            if (p) selectProject(p.id);
            return p;
          }}
        />
      )}
    </section>
  );
}
