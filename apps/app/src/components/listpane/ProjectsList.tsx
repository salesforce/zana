import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Search, Trash2, X, Check, Pencil, Code2, FolderOpen, TerminalSquare, LayoutDashboard, Settings2, Network, GitBranch, ClipboardCopy, Star, AppWindow, RefreshCw, Activity, ChevronRight, GripVertical, MoreHorizontal, ChevronUp, ChevronDown, ListFilter, MessageCirclePlus } from 'lucide-react';
import { CursorIcon } from '../icons/CursorIcon.js';
import {
  useData,
  useUi,
  sortProjectsForDisplay,
  sortProjectsAlphabetically,
  listedTerminals,
  liveTerminals
} from '../../store.js';
import type { OpenTarget, Project } from '@zana-ai/zcc-domain/product';
import { profileIcon } from '../../lib/profileIcon.js';
import { getScopedProjectId } from '../../lib/windowScope.js';
import { PROJECT_COLORS } from '@zana-ai/zcc-domain/project-colors';
import { ListPaneResizer } from '../ListPaneResizer.js';
import { AddRemoteProjectDialog } from '../AddRemoteProjectDialog.js';
import { AddGitProjectDialog } from '../AddGitProjectDialog.js';
import { AddLocalProjectDialog } from '../AddLocalProjectDialog.js';
import { AgentStatusDot } from './AgentStatusDot.js';
import { AgentRowDetail } from './AgentRowDetail.js';
import { ProjectRollupDot } from './ProjectRollupDot.js';
import { reorderProjectIds } from './projectReordering.js';

interface MenuState {
  projectId: string;
  x: number;
  y: number;
}

interface RailGroup {
  projects: Project[];
}

type SidebarProjectSort = 'manual' | 'recent' | 'created' | 'alphabetical';

const SIDEBAR_PROJECT_SORT_KEY = 'zcc.sidebarProjectSort';
const SIDEBAR_PROJECTS_SECTION_KEY = 'sidebar:projects';
const SIDEBAR_PROJECTS_TREE_ID = 'sidebar-projects-tree';

function readSidebarProjectSort(): SidebarProjectSort {
  if (typeof localStorage === 'undefined') return 'manual';
  const value = localStorage.getItem(SIDEBAR_PROJECT_SORT_KEY);
  return value === 'recent' || value === 'created' || value === 'alphabetical' ? value : 'manual';
}

function SortableProject({
  project,
  disabled,
  children
}: {
  project: Project;
  disabled: boolean;
  children: (dragHandle: {
    attributes: ReturnType<typeof useSortable>['attributes'];
    listeners: ReturnType<typeof useSortable>['listeners'];
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    disabled
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      className={`project-group ${isDragging ? 'is-dragging' : ''}`}
      style={style}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

export function ProjectsList({
  placement = 'pane',
  dragHandle
}: {
  placement?: 'pane' | 'sidebar';
  dragHandle?: React.HTMLAttributes<HTMLElement>;
}) {
  const inSidebar = placement === 'sidebar';
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
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
  const sidebarProjectsCollapsed = useUi(
    (s) => inSidebar && !!s.collapsedSections[SIDEBAR_PROJECTS_SECTION_KEY]
  );
  const toggleSection = useUi((s) => s.toggleSection);
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showRemoteDialog, setShowRemoteDialog] = useState(false);
  const [showGitDialog, setShowGitDialog] = useState(false);
  const [showLocalDialog, setShowLocalDialog] = useState(false);
  const [sidebarAddOpen, setSidebarAddOpen] = useState(false);
  const [sidebarOrganizeOpen, setSidebarOrganizeOpen] = useState(false);
  const sidebarAddRef = useRef<HTMLDivElement | null>(null);
  const sidebarOrganizeRef = useRef<HTMLDivElement | null>(null);
  const [sidebarProjectSort, setSidebarProjectSort] = useState<SidebarProjectSort>(readSidebarProjectSort);
  const [refreshing, setRefreshing] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  // The chat action focuses the project (Agents board) and opens the same
  // Start-a-session modal every other launch point uses.
  const spawnDefaultAgent = (p: Project) => {
    enterProjectFocus(p.id);
    setLauncherOpen(true);
  };

  const sortedProjects = useMemo(() => {
    if (!inSidebar || sidebarProjectSort === 'manual') return sortProjectsForDisplay(projects);
    if (sidebarProjectSort === 'alphabetical') return sortProjectsAlphabetically(projects);
    return projects.slice().sort((a, b) =>
      sidebarProjectSort === 'created'
        ? b.createdAt - a.createdAt
        : b.lastActiveAt - a.lastActiveAt
    );
  }, [inSidebar, projects, sidebarProjectSort]);

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

  // Keep every project in one uninterrupted tree. Display order stays stable
  // from the persisted project ordering or the selected sort preference.
  const railGroups = useMemo<RailGroup[]>(() => {
    return [{ projects: visibleProjects }];
  }, [visibleProjects]);

  const canReorder = !scopedProjectId && !filter.trim() && !hideIdleProjects && (!inSidebar || sidebarProjectSort === 'manual');
  const setSidebarSort = (sort: SidebarProjectSort) => {
    setSidebarProjectSort(sort);
    localStorage.setItem(SIDEBAR_PROJECT_SORT_KEY, sort);
    setSidebarOrganizeOpen(false);
  };
  const reorderWithinGroup = (group: RailGroup, fromId: string, toId: string) => {
    if (!canReorder || fromId === toId) return;
    const orderedIds = sortedProjects.map((project) => project.id);
    const nextIds = reorderProjectIds(
      orderedIds,
      group.projects.map((project) => project.id),
      fromId,
      toId
    );
    if (nextIds !== orderedIds) reorderProjects(nextIds);
  };
  const moveProject = (group: RailGroup, projectId: string, direction: -1 | 1) => {
    const index = group.projects.findIndex((project) => project.id === projectId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= group.projects.length) return;
    reorderWithinGroup(group, projectId, group.projects[nextIndex].id);
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const group = railGroups.find((candidate) => {
      const ids = new Set(candidate.projects.map((project) => project.id));
      return ids.has(String(active.id)) && ids.has(String(over.id));
    });
    if (group) reorderWithinGroup(group, String(active.id), String(over.id));
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

  // The add / organize popovers are absolutely positioned over the tree, so a
  // click in the list (or Escape) must dismiss them — same contract as the
  // project-focus "+" menu. The trigger lives inside the ref so toggling the
  // open button does not immediately re-close.
  useEffect(() => {
    if (!sidebarAddOpen && !sidebarOrganizeOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (sidebarAddRef.current?.contains(t) || sidebarOrganizeRef.current?.contains(t)) return;
      setSidebarAddOpen(false);
      setSidebarOrganizeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarAddOpen(false);
        setSidebarOrganizeOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [sidebarAddOpen, sidebarOrganizeOpen]);

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

  const renderProject = (group: RailGroup, p: Project) => (
    <SortableProject key={p.id} project={p} disabled={!canReorder || renamingId === p.id}>
      {({ attributes, listeners }) => (
        <>
          <div
            className={`project-item ${selectedId === p.id ? 'active' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ projectId: p.id, x: e.clientX, y: e.clientY });
            }}
          >
            <button
              type="button"
              className="project-reorder-handle"
              aria-label={`Reorder ${p.name}`}
              title="Drag to reorder"
              disabled={!canReorder || renamingId === p.id}
              onClick={(e) => e.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              <GripVertical size={14} />
            </button>
            {(() => {
              const list = liveTerminals(terminals[p.id]);
              if (list.length === 0) {
                return null;
              }
              const expanded = isProjectExpanded(p);
              return (
                <button
                  type="button"
                  className={`project-tree-chevron ${expanded ? 'expanded' : ''}`}
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} sessions for ${p.name}`}
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
              const g = gitStatus[p.id];
              const tooltip = [
                p.path,
                p.tag ? `#${p.tag}` : null,
                p.remote ? `Remote SSH: ${p.remote.user ? `${p.remote.user}@` : ''}${p.remote.host}` : null
              ]
                .filter(Boolean)
                .join('\n');
              const hasUnread = listedTerminals(terminals[p.id]).some((t) => unread[t.id]);
              const projectDot = (
                <span
                  className={`project-dot ${hasUnread ? 'unread' : ''}`}
                  style={p.color ? { background: p.color } : undefined}
                  title={hasUnread ? 'New activity' : undefined}
                />
              );
              const projectMeta = (
                <span className="project-meta project-meta--inline" title={tooltip || undefined}>
                  <span className="project-name">{p.name}</span>
                  {p.remote && <Network size={11} strokeWidth={2} className="project-remote-icon" aria-label="Remote SSH project" />}
                  {g && (
                    <span className="project-git">
                      <span className="project-git-branch">{g.detached ? '(detached)' : g.branch ?? '?'}</span>
                      {g.dirty && <span className="project-git-dirty" title="Uncommitted changes">●</span>}
                      {g.ahead > 0 && <span className="project-git-ahead" title="Ahead">↑{g.ahead}</span>}
                      {g.behind > 0 && <span className="project-git-behind" title="Behind">↓{g.behind}</span>}
                    </span>
                  )}
                </span>
              );
              if (renamingId === p.id) {
                return (
                  <>
                    {projectDot}
                    <input
                      className="project-rename"
                      value={renameValue}
                      autoFocus
                      aria-label={`Rename ${p.name}`}
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
                  </>
                );
              }
              return (
                <button
                  type="button"
                  className="project-select"
                  aria-label={`Open ${p.name}`}
                  onClick={() => enterProjectFocus(p.id)}
                >
                  {projectDot}
                  {projectMeta}
                </button>
              );
            })()}
            {!isProjectExpanded(p) && <ProjectRollupDot projectId={p.id} />}
            {(() => {
              const list = listedTerminals(terminals[p.id]);
              const running = list.filter((t) => t.status !== 'exited').length;
              const exited = list.filter((t) => t.status === 'exited').length;
              const crashed = list.filter((t) => t.status === 'exited' && (t.exitCode ?? 0) !== 0).length;
              if (!list.length) return null;
              const titleParts = [`${running} running`, `${exited} exited`];
              if (crashed) titleParts.push(`${crashed} crashed`);
              return (
                <span className={`project-badge ${crashed ? 'has-crashed' : ''}`} title={titleParts.join(', ')}>
                  {running}
                  {exited > 0 && <span className="project-badge-exited">·{exited}</span>}
                  {crashed > 0 && <span className="project-badge-crashed" aria-hidden="true" />}
                </span>
              );
            })()}
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
              <MessageCirclePlus size={14} />
            </button>
            <button
              type="button"
              className="project-actions"
              aria-label={`Project actions for ${p.name}`}
              title="Project actions"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({ projectId: p.id, x: rect.right, y: rect.bottom });
              }}
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
          {(() => {
            const list = liveTerminals(terminals[p.id]);
            if (!list.length) return null;
            if (!isProjectExpanded(p)) return null;
            const activeTab = selectedId === p.id ? selectedTabId[p.id] : undefined;
            return (
              <div className="project-terminals" role="list" aria-label={`Live sessions in ${p.name}`}>
                {list.map((t) => {
                  const isUnread = !!unread[t.id] && activeTab !== t.id;
                  return (
                    <div key={t.id} role="listitem">
                      <button
                        type="button"
                        className={`project-terminal-row ${isUnread ? 'unread' : ''}`}
                        onClick={() => useUi.getState().openAgentModal(t.id, p.id)}
                        aria-label={isUnread ? `${t.title}, unread output` : t.title}
                        title={isUnread ? `${t.title} · unread output` : t.title}
                      >
                        <span className={`tab-profile-icon profile-${t.profile}`} aria-hidden="true">
                          {profileIcon(t.profile)}
                        </span>
                        <span className="project-terminal-text">
                          <span className="project-terminal-name">{t.title}</span>
                          <AgentRowDetail session={t} />
                        </span>
                        <AgentStatusDot sessionId={t.id} />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}
    </SortableProject>
  );

  return (
    <section
      className={`${inSidebar ? 'sidebar-projects' : 'list-pane'} ${sidebarProjectsCollapsed ? 'sidebar-projects--collapsed' : ''} ${dropOver ? 'drop-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className={inSidebar ? 'sidebar-projects-header' : 'list-header'}>
        {inSidebar ? (
          <button
            type="button"
            className="sidebar-projects-heading"
            {...dragHandle}
            data-testid="sidebar-projects-heading"
            onClick={() => toggleSection(SIDEBAR_PROJECTS_SECTION_KEY)}
            aria-label={`${sidebarProjectsCollapsed ? 'Expand' : 'Collapse'} Workspaces section`}
            aria-controls={SIDEBAR_PROJECTS_TREE_ID}
            aria-expanded={!sidebarProjectsCollapsed}
            title={`${sidebarProjectsCollapsed ? 'Expand' : 'Collapse'} Workspaces`}
          >
            <span>Workspaces</span>
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={`sidebar-projects-chevron ${sidebarProjectsCollapsed ? '' : 'open'}`}
            />
          </button>
        ) : (
          <h2>Projects</h2>
        )}
        {/* The sidebar header keeps workspace creation under one + menu. The
            overflow menu is intentionally reserved for non-creation actions. */}
        <div className="list-header-actions">
          {inSidebar ? (
            <>
              <div className="sidebar-projects-menu-wrap" ref={sidebarOrganizeRef}>
                <button
                  className={`icon-btn ${hideIdleProjects ? 'on' : ''}`}
                  aria-label="Organize workspaces"
                  aria-haspopup="menu"
                  aria-expanded={sidebarOrganizeOpen}
                  title="Organize workspaces"
                  onClick={() => {
                    setMenu(null);
                    setSidebarAddOpen(false);
                    setSidebarOrganizeOpen((open) => !open);
                  }}
                >
                  <ListFilter size={17} />
                </button>
                {sidebarOrganizeOpen && (
                  <div className="sidebar-projects-organize-menu" role="menu" aria-label="Organize workspaces">
                    <span className="sidebar-projects-menu-label">Sort by</span>
                    {([
                      ['manual', 'Manual order'],
                      ['recent', 'Recent activity'],
                      ['created', 'Created date'],
                      ['alphabetical', 'Alphabetical']
                    ] as const).map(([sort, label]) => (
                      <button
                        key={sort}
                        type="button"
                        role="menuitemradio"
                        aria-checked={sidebarProjectSort === sort}
                        onClick={() => setSidebarSort(sort)}
                      >
                        <span>{label}</span>
                        {sidebarProjectSort === sort && <Check size={14} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="icon-btn"
                aria-label="Workspace menu"
                title="Workspace menu"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setSidebarAddOpen(false);
                  setSidebarOrganizeOpen(false);
                  setMenu({ projectId: '', x: rect.right, y: rect.bottom });
                }}
              >
                <MoreHorizontal size={18} />
              </button>
              <div className="sidebar-projects-menu-wrap" ref={sidebarAddRef}>
                <button
                  className="icon-btn"
                  aria-label="Add project"
                  aria-haspopup="menu"
                  aria-expanded={sidebarAddOpen}
                  title="Add project"
                  onClick={() => {
                    setMenu(null);
                    setSidebarOrganizeOpen(false);
                    setSidebarAddOpen((open) => !open);
                  }}
                >
                  <Plus size={18} />
                </button>
                {sidebarAddOpen && (
                  <div className="sidebar-projects-add-menu" role="group" aria-label="Add a project">
                    <button type="button" onClick={() => { setShowLocalDialog(true); setSidebarAddOpen(false); }}>
                      <FolderOpen size={14} />
                      <span>Add local folder</span>
                    </button>
                    <button type="button" onClick={() => { setShowGitDialog(true); setSidebarAddOpen(false); }}>
                      <GitBranch size={14} />
                      <span>Clone from Git</span>
                    </button>
                    <button type="button" onClick={() => { setShowRemoteDialog(true); setSidebarAddOpen(false); }}>
                      <Network size={14} />
                      <span>Add remote project</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </header>
      <div className={inSidebar ? 'sidebar-projects-add-row' : 'list-add-row'} role="group" aria-label="Add a project">
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
        <div className={inSidebar ? 'sidebar-projects-filter list-filter' : 'list-filter'}>
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
      {!inSidebar && (
        <button
          type="button"
          className={`list-overview ${!focusedProjectId ? 'active' : ''}`}
          onClick={() => {
            exitProjectFocus();
            setNav('agents');
          }}
          aria-pressed={!focusedProjectId}
          title="Show every agent across all projects"
        >
          <LayoutDashboard size={14} />
          <span>Overview</span>
        </button>
      )}
      <div
        id={inSidebar ? SIDEBAR_PROJECTS_TREE_ID : undefined}
        className={inSidebar ? 'sidebar-projects-body' : 'list-body'}
        hidden={sidebarProjectsCollapsed}
      >
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            {railGroups.map((group) => (
              <div key="projects" className="project-rail-group">
                <SortableContext items={group.projects.map((project) => project.id)} strategy={verticalListSortingStrategy}>
                  {group.projects.map((project) => renderProject(group, project))}
                </SortableContext>
              </div>
            ))}
          </DndContext>
        )}
      </div>
      {menu && (() => {
        const p = projects.find((pr) => pr.id === menu.projectId);
        const menuGroup = p
          ? railGroups.find((group) => group.projects.some((project) => project.id === p.id))
          : undefined;
        const menuIndex = p && menuGroup ? menuGroup.projects.findIndex((project) => project.id === p.id) : -1;
        return (
        <div
          ref={menuRef}
          className="project-menu"
          style={{ top: menu.y, left: menu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {!p && (
            <button className="project-menu-item" onClick={() => { setMenu(null); void handleRefresh(); }}>
              <RefreshCw size={12} />
              <span>Refresh projects</span>
            </button>
          )}
          {p && (
            <>
              <button
                className="project-menu-item"
                disabled={!canReorder || !menuGroup || menuIndex <= 0}
                onClick={() => {
                  if (menuGroup) moveProject(menuGroup, p.id, -1);
                  setMenu(null);
                }}
              >
                <ChevronUp size={12} />
                <span>Move up</span>
              </button>
              <button
                className="project-menu-item"
                disabled={!canReorder || !menuGroup || menuIndex === -1 || menuIndex >= menuGroup.projects.length - 1}
                onClick={() => {
                  if (menuGroup) moveProject(menuGroup, p.id, 1);
                  setMenu(null);
                }}
              >
                <ChevronDown size={12} />
                <span>Move down</span>
              </button>
              <div className="project-menu-sep" />
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
          {p && (
            <>
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
            </>
          )}
        </div>
        );
      })()}
      {!inSidebar && <ListPaneResizer />}
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
