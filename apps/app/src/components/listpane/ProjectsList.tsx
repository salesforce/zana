import { useHosts } from '../../hooks/useHosts.js';
import { useProjectAvailability } from '../../hooks/useProjectAvailability.js';
import { projectAvailabilityLabel } from '../../lib/machine-project-client.js';
import { groupProjectsByMachine, machineProjectMatches, newThreadLocationPath, type MachineProjectGroup } from '../../lib/machine-projects.js';
import { AddMachineProjectDialog } from '../AddMachineProjectDialog.js';
import { MachineProjectsDialog } from '../MachineProjectsDialog.js';
import './machine-projects.css';
import { ProjectIconPicker } from './ProjectIconPicker.js';
import { product } from '../../lib/product-client.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Search, Trash2, X, Check, Pencil, FolderOpen, LayoutDashboard, Settings2, Network, GitBranch, Star, AppWindow, RefreshCw, Activity, ChevronRight, MoreHorizontal, ChevronUp, ChevronDown, ListFilter, MessageCirclePlus, Laptop, Server } from 'lucide-react';
import { ProjectOpenActions } from './ProjectOpenActions.js';
import {
  useData,
  useUi,
  useAgentStatus,
  useIdleTriage,
  sortProjectsForDisplay,
  sortProjectsAlphabetically,
  listedTerminals,
  projectRailTerminals
} from '../../store.js';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { getScopedProjectId } from '../../lib/windowScope.js';
import { PROJECT_COLORS } from '@zana-ai/zcc-domain/project-colors';
import { ListPaneResizer } from '../ListPaneResizer.js';
import { AddRemoteProjectDialog } from '../AddRemoteProjectDialog.js';
import { AddGitProjectDialog } from '../AddGitProjectDialog.js';
import { AddLocalProjectDialog } from '../AddLocalProjectDialog.js';
import { ProjectRollupDot } from './ProjectRollupDot.js';
import { reorderProjectIds } from './projectReordering.js';
import { pinDefaultProjectFirst, pinFavoriteProjectsFirst } from './project-rail.js';
import { useProjectRailDisclosure } from './useProjectRailDisclosure.js';
import { useMobileNavDismiss } from '../mobile-nav-context.js';
import { ProjectAgentRailRow, ProjectThreadRailRow } from './project-session-rail-rows.js';
import { projectNavigationSessions } from '../../lib/teamRunOrganization.js';
import { sessionRailTitle } from '../../lib/sessionRailTitle.js';
import { useAgentCardActions, AgentCardMenu, clampMenuAnchor } from '../agentCardActions.js';
import { useThreadCardActions, ThreadCardMenu, openThreadMenu } from '../threadCardActions.js';
import { PromptModal } from '../PromptModal.js';
import type { AgentCard } from '../AgentBoard.js';
import { useThreads, type ThreadListItem } from '../../thread-store.js';
import { useEnsureThreads } from '../../hooks/useEnsureThreads.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { getAgentSessionRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { railThreadsForProject, threadIsLiveForRail, threadTitle } from '../fleet-item.js';
import { POST_DRAG_CLICK_SUPPRESS_MS, suppressPostDragClick } from '../../lib/suppress-post-drag-click.js';
import { beginProjectDrag, PROJECT_DRAG_MIME, projectFromDrag } from '../../lib/project-drag.js';
import { composerProjectLabel, isRemoteWorkspaceProject, isScratchWorkspaceProject } from '../composer-project-default.js';
import { ProjectDot } from './ProjectDot.js';
import { resolveIcon } from '../../lib/resolveIcon.js';
import { listCreateProjectActions, listProjectMenuActions, subscribePluginSlots } from '../../plugins/plugin-slots.js';
import { createProjectActionContext, projectMenuNavigateContext } from '../../plugins/plugin-nav-href.js';
import {
  PluginCreateProjectDialog,
  runCreateProjectAction,
  type PluginCreateProjectDialogState
} from '../../plugins/PluginCreateProjectDialog.js';

interface MenuState {
  projectId: string;
  machineId?: string;
  returnFocus?: HTMLElement;
  x: number;
  y: number;
  /** Trigger top; when set, place below the control and flip above only if needed. */
  anchorTop?: number;
}

const MENU_PAD = 8;
const MENU_GAP = 4;

/** Prefer below the trigger; flip above when the viewport has more room there. */
function placeFixedMenu(
  el: HTMLElement,
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'right'>
) {
  const menu = el.getBoundingClientRect();
  const spaceBelow = window.innerHeight - anchor.bottom - MENU_PAD;
  const spaceAbove = anchor.top - MENU_PAD;
  const openAbove = spaceBelow < menu.height + MENU_GAP && spaceAbove > spaceBelow;
  let left = anchor.right - menu.width;
  let top = openAbove ? anchor.top - menu.height - MENU_GAP : anchor.bottom + MENU_GAP;
  if (left < MENU_PAD) left = MENU_PAD;
  if (left + menu.width > window.innerWidth - MENU_PAD) {
    left = Math.max(MENU_PAD, window.innerWidth - menu.width - MENU_PAD);
  }
  if (top < MENU_PAD) top = MENU_PAD;
  if (top + menu.height > window.innerHeight - MENU_PAD) {
    top = Math.max(MENU_PAD, window.innerHeight - menu.height - MENU_PAD);
  }
  el.style.position = 'fixed';
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.zIndex = '20';
}

interface RailGroup {
  machine?: MachineProjectGroup;
  projects: Project[];
}

type SidebarProjectSort = 'manual' | 'recent' | 'created' | 'alphabetical';

const SIDEBAR_PROJECT_SORT_KEY = 'zcc.sidebarProjectSort';
const SIDEBAR_PROJECTS_SECTION_KEY = 'sidebar:projects';
const SIDEBAR_PROJECT_VIEW_KEY = 'zcc.sidebarProjectView';

/** `projects` nests sessions under each project; `agents` hides the project
 *  rows and lists every thread / CLI agent flat, tagged with its project. */
type SidebarProjectView = 'projects' | 'agents';
const SIDEBAR_PROJECTS_TREE_ID = 'sidebar-projects-tree';

function readSidebarProjectSort(): SidebarProjectSort {
  if (typeof localStorage === 'undefined') return 'manual';
  const value = localStorage.getItem(SIDEBAR_PROJECT_SORT_KEY);
  return value === 'recent' || value === 'created' || value === 'alphabetical' ? value : 'manual';
}

function readSidebarProjectView(): SidebarProjectView {
  if (typeof localStorage === 'undefined') return 'projects';
  return localStorage.getItem(SIDEBAR_PROJECT_VIEW_KEY) === 'agents' ? 'agents' : 'projects';
}

type FlatRailItem =
  | { kind: 'thread'; project: Project; thread: ThreadListItem; at: number }
  | { kind: 'agent'; project: Project; session: TerminalSession; at: number };

function SortableProject({
  project,
  sortId,
  disabled,
  children
}: {
  project: Project;
  sortId?: string;
  disabled: boolean;
  children: (dragHandle: {
    attributes: ReturnType<typeof useSortable>['attributes'];
    listeners: ReturnType<typeof useSortable>['listeners'];
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortId ?? project.id,
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
  dragHandle,
  onNavigate
}: {
  placement?: 'pane' | 'sidebar';
  dragHandle?: React.HTMLAttributes<HTMLElement>;
  onNavigate?: (event: { preventDefault: () => void }) => void;
}) {
  const inSidebar = placement === 'sidebar';
  const dismissMobileNav = useMobileNavDismiss();
  const mobile = inSidebar && !!dismissMobileNav;
  const projects = useData((s) => s.projects);
  const hosts = useHosts();
  const folderAvailability = useProjectAvailability(inSidebar ? projects : [], hosts);
  const [addingMachine, setAddingMachine] = useState<MachineProjectGroup | null>(null);
  const [overviewMachineId, setOverviewMachineId] = useState<string | null>(null);
  const collapsedSections = useUi(s => s.collapsedSections);
  const terminals = useData((s) => s.terminals);
  const projectNavigationOrganization = useData((s) => s.projectNavigationOrganization);
  const loadProjects = useData((s) => s.loadProjects);
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
  const openProjectSettings = useUi((s) => s.openProjectSettings);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const unread = useUi((s) => s.unread);
  const projectExpanded = useUi((s) => s.projectExpanded);
  const setProjectExpanded = useUi((s) => s.setProjectExpanded);
  const disclosure = useProjectRailDisclosure(mobile, projectExpanded, setProjectExpanded);
  const hideIdleProjects = useUi((s) => s.hideIdleProjects);
  const toggleHideIdleProjects = useUi((s) => s.toggleHideIdleProjects);
  const sidebarProjectsCollapsed = useUi(
    (s) => inSidebar && !!s.collapsedSections[SIDEBAR_PROJECTS_SECTION_KEY]
  );
  const [mobileProjectsOpen, setMobileProjectsOpen] = useState(true);
  const projectsCollapsed = mobile ? !mobileProjectsOpen : sidebarProjectsCollapsed;
  const toggleSection = useUi((s) => s.toggleSection);
  // Non-null in a per-project window: the rail is locked to this one project.
  const scopedProjectId = getScopedProjectId();
  const projectMenuActions = useSyncExternalStore(
    subscribePluginSlots,
    listProjectMenuActions,
    listProjectMenuActions
  );
  const createProjectActions = useSyncExternalStore(
    subscribePluginSlots,
    listCreateProjectActions,
    listCreateProjectActions
  );
  const headerMenuActions = projectMenuActions.filter((row) => row.placement === 'workspace');
  const rowMenuActions = useMemo(() => projectMenuActions.filter((row) => row.placement === 'project'), [projectMenuActions]);
  const threads = useThreads((s) => s.threads);
  useEnsureThreads();
  const navigate = useNavigate();
  const { threadId: activeThreadId, sessionId: activeSessionId } = useRouteState();
  const liveThreadsByProject = useMemo(() => {
    const map = new Map<string, typeof threads>();
    for (const thread of threads) {
      if (!threadIsLiveForRail(thread)) continue;
      const list = map.get(thread.projectId) ?? [];
      list.push(thread);
      map.set(thread.projectId, list);
    }
    return map;
  }, [threads]);
  const railThreadsByProject = useMemo(() => {
    const grouped = new Map<string, typeof threads>();
    for (const thread of threads) {
      const list = grouped.get(thread.projectId) ?? [];
      list.push(thread);
      grouped.set(thread.projectId, list);
    }
    const map = new Map<string, typeof threads>();
    for (const [projectId, list] of grouped) {
      map.set(projectId, railThreadsForProject(list));
    }
    return map;
  }, [threads]);

  const [dropOver, setDropOver] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [projectActionTitles, setProjectActionTitles] = useState<{
    menu: MenuState | null;
    titles: Record<string, string>;
  }>({ menu: null, titles: {} });
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu?.projectId) return;
    let current = true;
    setProjectActionTitles({ menu, titles: {} });
    for (const action of rowMenuActions) {
      if (!action.titleForProject) continue;
      const key = `${menu.projectId}:${action.pluginId}:${action.id}:${action.generation}`;
      void Promise.resolve().then(() => action.titleForProject!(menu.projectId)).then(
        (title) => {
          if (current) setProjectActionTitles((state) => state.menu === menu
            ? { ...state, titles: { ...state.titles, [key]: title.trim().slice(0, 100) || action.title } }
            : state);
        },
        () => {
          if (current) setProjectActionTitles((state) => state.menu === menu
            ? { ...state, titles: { ...state.titles, [key]: action.title } }
            : state);
        }
      );
    }
    return () => { current = false; };
  }, [menu, rowMenuActions]);
  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showRemoteDialog, setShowRemoteDialog] = useState(false);
  const [showGitDialog, setShowGitDialog] = useState(false);
  const [showLocalDialog, setShowLocalDialog] = useState(false);
  const [createProjectDialog, setCreateProjectDialog] = useState<PluginCreateProjectDialogState | null>(null);
  const [sidebarAddOpen, setSidebarAddOpen] = useState(false);
  const [sidebarOrganizeOpen, setSidebarOrganizeOpen] = useState(false);
  const sidebarAddRef = useRef<HTMLDivElement | null>(null);
  const sidebarOrganizeRef = useRef<HTMLDivElement | null>(null);
  const [sidebarProjectSort, setSidebarProjectSort] = useState<SidebarProjectSort>(readSidebarProjectSort);
  const [sidebarProjectView, setSidebarProjectViewState] = useState<SidebarProjectView>(readSidebarProjectView);
  const [refreshing, setRefreshing] = useState(false);
  const launchCreateProjectAction = (action: (typeof createProjectActions)[number]) => {
    setSidebarAddOpen(false);
    runCreateProjectAction(
      action,
      createProjectActionContext(action.pluginId, {
        pickDirectory: () => product.projects.pickDirectory(),
        addProject: async (path) => {
          const project = await addProjectByPath(path);
          return project ? { id: project.id } : null;
        },
        cloneRoot: async () => {
          const root = await product.projects.cloneRoot().catch(() => '');
          return root.trim() || null;
        },
        navigate: (to) => {
          void navigate(to);
        },
        openDialog: (options) => {
          if (!action.component) return false;
          setCreateProjectDialog({
            action,
            title: options?.title?.trim() || action.title,
            params: options?.params ?? null
          });
          return true;
        }
      })
    );
  };
  // Nested session rows share the board/list lifecycle menu (Stop / Restart /
  // Rename / Delete). Distinct from `menu` below, which is the project-row
  // overflow. Opening one closes the other so they never stack.
  const {
    menu: agentMenu,
    setMenu: setAgentMenu,
    actions: agentActions,
    rename: agentRename,
    closeRename: closeAgentRename,
    submitRename: submitAgentRename
  } = useAgentCardActions();
  const { menu: threadMenu, setMenu: setThreadMenu } = useThreadCardActions();
  const sensors = useSensors(
    // Mouse drags use native DataTransfer so projects can leave the rail and
    // become composer mentions. Keep touch and keyboard sorting via dnd-kit.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const suppressClickRef = useRef(false);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [projectDropId, setProjectDropId] = useState<string | null>(null);
  const consumeProjectClick = () => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  };
  const releaseProjectClick = () => {
    if (suppressClickRef.current) suppressPostDragClick();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, POST_DRAG_CLICK_SUPPRESS_MS);
  };
  const onProjectDragStart = ({ activatorEvent }: DragStartEvent) => {
    suppressClickRef.current = activatorEvent.type === 'touchstart';
  };

  // Manual reload of the project list — covers out-of-band edits to
  // projects.json that the live `projects:onChanged` push didn't originate
  // (e.g. another window, a hand-edit, or a stale list after sleep). Guarded
  // by `refreshing` so a double-click can't stack reloads; the spinner gives
  // the gesture visible feedback.
  const handleRefresh = async () => {
    if (refreshing) return;
    setMenu(null);
    setSidebarAddOpen(false);
    setSidebarOrganizeOpen(false);
    setRefreshing(true);
    try {
      await loadProjects();
    } finally {
      setRefreshing(false);
    }
  };

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
    setMenu(null);
    setAgentMenu(null);
  };

  const sessionToCard = (session: TerminalSession, project: Project): AgentCard => ({
    session,
    state: useAgentStatus.getState().byId[session.id] ?? 'unknown',
    projectId: project.id,
    projectName: composerProjectLabel(project),
    projectColor: project.color,
    triage: useIdleTriage.getState().byId[session.id]
  });

  const openAgentCardMenu = (e: MouseEvent, session: TerminalSession, project: Project) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    setThreadMenu(null);
    setAgentMenu({ card: sessionToCard(session, project), ...clampMenuAnchor(e) });
  };

  const openMachineMenu = (machineId: string, heading: HTMLElement, x: number, y: number) => {
    setAgentMenu(null);
    setThreadMenu(null);
    setSidebarAddOpen(false);
    setSidebarOrganizeOpen(false);
    setMenu({ projectId: '', machineId, x, y, returnFocus: heading.querySelector<HTMLButtonElement>('.machine-project-name') ?? undefined });
  };

  const commitRename = () => {
    if (renamingId) {
      const v = renameValue.trim();
      if (v) updateProject(renamingId, { name: v });
    }
    setRenamingId(null);
  };

  // Open the shared Start-a-session modal in the current view. selectProject
  // seeds the launcher's project picker; it does not switch to the workspace.
  const spawnDefaultAgent = (p: Project) => {
    selectProject(p.id);
    setLauncherOpen(true, p.id);
    dismissMobileNav?.();
  };

  const sortedProjects = useMemo(() => {
    const sorted = !inSidebar || sidebarProjectSort === 'manual'
      ? sortProjectsForDisplay(projects)
      : sidebarProjectSort === 'alphabetical'
        ? sortProjectsAlphabetically(projects)
        : projects.slice().sort((a, b) =>
          sidebarProjectSort === 'created'
            ? b.createdAt - a.createdAt
            : b.lastActiveAt - a.lastActiveAt
        );
    return pinDefaultProjectFirst(pinFavoriteProjectsFirst(sorted));
  }, [inSidebar, projects, sidebarProjectSort]);

  // A project is "active" when it has at least one live interactive session
  // or a live thread. Scheduler jobs stay off this tree. Keeps the selected
  // project visible regardless, so toggling the filter never hides the row
  // the user is in.
  const projectHasRunningAgents = (p: Project) =>
    projectRailTerminals(terminals[p.id]).length > 0 ||
    (liveThreadsByProject.get(p.id)?.length ?? 0) > 0;

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
    const machines = groupProjectsByMachine(list, hosts);
    return list.filter(
      (p) => machines.some(machine => machine.projects.includes(p) && machine.name.toLowerCase().includes(q)) ||
        composerProjectLabel(p).toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q) ||
        (p.tag?.toLowerCase().includes(q) ?? false)
    );
  }, [sortedProjects, scopedProjectId, hideIdleProjects, selectedId, filter, terminals, liveThreadsByProject, hosts]);

  // "Agents only" is a sidebar presentation; a scoped window keeps its tree.
  const agentsOnly = inSidebar && !scopedProjectId && sidebarProjectView === 'agents';
  const setSidebarView = (view: SidebarProjectView) => {
    setSidebarProjectViewState(view);
    localStorage.setItem(SIDEBAR_PROJECT_VIEW_KEY, view);
    setSidebarOrganizeOpen(false);
  };

  // Flat rail: every nestable session across the (idle-filtered) projects,
  // newest first. The text filter matches the session title or project name.
  const flatItems = useMemo<FlatRailItem[]>(() => {
    if (!agentsOnly) return [];
    const q = filter.trim().toLowerCase();
    let source = sortedProjects;
    if (hideIdleProjects) source = source.filter((p) => projectHasRunningAgents(p));
    const items: FlatRailItem[] = [];
    for (const project of source) {
      const projectMatches = !q || composerProjectLabel(project).toLowerCase().includes(q)
        || project.name.toLowerCase().includes(q);
      for (const thread of railThreadsByProject.get(project.id) ?? []) {
        if (!projectMatches && !threadTitle(thread).toLowerCase().includes(q)) continue;
        items.push({ kind: 'thread', project, thread, at: thread.updatedAt ?? thread.createdAt });
      }
      const sessions = projectNavigationSessions(
        projectRailTerminals(terminals[project.id]),
        projectNavigationOrganization
      );
      for (const session of sessions) {
        const title = sessionRailTitle(session);
        if (!projectMatches && !title.toLowerCase().includes(q)) continue;
        items.push({ kind: 'agent', project, session, at: session.createdAt });
      }
    }
    return items.sort((a, b) => b.at - a.at);
  }, [agentsOnly, filter, sortedProjects, hideIdleProjects, railThreadsByProject, terminals, liveThreadsByProject, projectNavigationOrganization]);

  // Keep every project in one uninterrupted tree. Display order stays stable
  // from the persisted project ordering or the selected sort preference.
  const machineGroups = useMemo(() => groupProjectsByMachine(sortedProjects, hosts), [sortedProjects, hosts]);
  const railGroups = useMemo<RailGroup[]>(() => {
    if (!inSidebar || scopedProjectId) return [{ projects: visibleProjects }];
    return machineGroups.map(machine => ({ machine, projects: machine.projects.filter(project =>
      (!hideIdleProjects || project.id === selectedId || (!isScratchWorkspaceProject(project) ? projectHasRunningAgents(project) : (liveThreadsByProject.get(project.id) ?? []).some(thread => thread.hostId === machine.hostId || (machine.primary && !thread.hostId)) || (machine.primary && projectRailTerminals(terminals[project.id]).length > 0)))
      && machineProjectMatches(machine, project, filter)
    ) })).filter(group => !filter.trim() || group.projects.length > 0);
  }, [inSidebar, scopedProjectId, visibleProjects, machineGroups, filter, hideIdleProjects, selectedId, terminals, liveThreadsByProject]);
  const openMachineThread = (group: MachineProjectGroup, project: Project) => {
    navigate(newThreadLocationPath({ projectId: project.id, hostId: group.hostId }));
    dismissMobileNav?.();
  };

  // Reorder is allowed whenever the full unfiltered list is on screen. A
  // Recents/Created/A–Z sort still shows Move up/down — using them (or a
  // drag) switches the rail to Manual so the new order is what you see.
  const canReorder = !scopedProjectId && !filter.trim() && !hideIdleProjects;
  const setSidebarSort = (sort: SidebarProjectSort) => {
    setSidebarProjectSort(sort);
    localStorage.setItem(SIDEBAR_PROJECT_SORT_KEY, sort);
    setSidebarOrganizeOpen(false);
  };
  const reorderWithinGroup = (group: RailGroup, fromId: string, toId: string) => {
    if (!canReorder || fromId === toId) return;
    const locked = group.projects.some(
      (project) => (project.id === fromId || project.id === toId) && isScratchWorkspaceProject(project)
    );
    if (locked) return;
    if (inSidebar && sidebarProjectSort !== 'manual') setSidebarSort('manual');
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
    releaseProjectClick();
    if (!over || active.id === over.id) return;
    const group = railGroups.find((candidate) => {
      const ids = new Set(candidate.projects.map((project) => project.id));
      return ids.has(String(active.id)) && ids.has(String(over.id));
    });
    if (group) reorderWithinGroup(group, String(active.id), String(over.id));
  };
  const handleDragCancel = () => {
    releaseProjectClick();
  };

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (menu.machineId) {
          e.preventDefault();
          e.stopPropagation();
          menu.returnFocus?.focus();
        }
        setMenu(null);
      }
      if (menu.machineId && e.key === 'Tab') setMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // The add / organize popovers are absolutely positioned over the tree, so a
  // click in the list (or Escape) must dismiss them — same contract as the
  // project-focus "+" menu. The trigger lives inside the ref so toggling the
  // open button does not immediately re-close.
  useEffect(() => {
    if (!sidebarAddOpen && !sidebarOrganizeOpen) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (sidebarAddRef.current?.contains(t) || sidebarOrganizeRef.current?.contains(t)) return;
      setSidebarAddOpen(false);
      setSidebarOrganizeOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
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

  useLayoutEffect(() => {
    if (!sidebarAddOpen && !sidebarOrganizeOpen) return;
    const wrap = sidebarAddOpen ? sidebarAddRef.current : sidebarOrganizeRef.current;
    const menuEl = wrap?.querySelector(
      sidebarAddOpen ? '.sidebar-projects-add-menu' : '.sidebar-projects-organize-menu'
    );
    const button = wrap?.querySelector('.icon-btn');
    if (!(menuEl instanceof HTMLElement) || !(button instanceof HTMLElement)) return;
    placeFixedMenu(menuEl, button.getBoundingClientRect());
  }, [sidebarAddOpen, sidebarOrganizeOpen]);

  // Clamp the context menu into the viewport. Header controls place below first
  // and flip above only when there is more room there; row clicks stay at the
  // pointer so right-clicking low in the list cannot push Rename/Remove off-screen.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (!el) return;
    if (menu.anchorTop != null) {
      placeFixedMenu(el, { top: menu.anchorTop, bottom: menu.y, right: menu.x });
      return;
    }
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - MENU_PAD) {
      left = Math.max(MENU_PAD, window.innerWidth - rect.width - MENU_PAD);
    }
    if (top + rect.height > window.innerHeight - MENU_PAD) {
      top = Math.max(MENU_PAD, window.innerHeight - rect.height - MENU_PAD);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [menu]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.project-delete-armed')) return;
      setConfirmDeleteId(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
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
      .map((f) => product.files.pathForFile(f))
      .filter(Boolean);
    let lastAdded: { id: string } | null = null;
    for (const path of paths) {
      const p = await addProjectByPath(path);
      if (p) lastAdded = p;
    }
    if (lastAdded) selectProject(lastAdded.id);
  };

  const renderProject = (group: RailGroup, p: Project) => {
    const sortable = !mobile && canReorder && renamingId !== p.id && !isScratchWorkspaceProject(p);
    const labelClass = sortable ? 'project-label project-label--sortable' : 'project-label';
    const scratch = isScratchWorkspaceProject(p);
    const projectedDefault = scratch && !!group.machine && !group.machine.primary && p.hostId !== group.machine.hostId;
    const liveList = projectNavigationSessions(
      projectedDefault ? [] : projectRailTerminals(terminals[p.id]),
      projectNavigationOrganization
    );
    const railThreads = (railThreadsByProject.get(p.id) ?? []).filter(thread => !scratch || !group.machine
      || thread.hostId === group.machine.hostId || (group.machine.primary && !thread.hostId));
    const disclosureId = scratch && group.machine ? `${group.machine.id}:${p.id}` : p.id;
    const expanded = disclosure.isExpanded(disclosureId, liveList.length + railThreads.length > 0);
    const nestedCount = liveList.length + railThreads.length;
    const displayName = composerProjectLabel(p);
    return (
    <SortableProject key={p.id} project={p} sortId={projectedDefault ? `${group.machine!.id}:${p.id}` : p.id} disabled={!sortable}>
      {({ attributes, listeners }) => (
        <>
          <div
            className="project-item"
            data-session-move-project={p.id}
            style={projectDropId === p.id ? { outline: '1px solid var(--accent)', borderRadius: 6 } : undefined}
            onDragOver={(event) => {
              const source = projects.find((project) => project.id === draggedProjectId);
              if (!sortable || !source || source.id === p.id || isScratchWorkspaceProject(source)
                || !event.dataTransfer.types.includes(PROJECT_DRAG_MIME)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              setProjectDropId(p.id);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setProjectDropId(null);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(PROJECT_DRAG_MIME)) return;
              event.preventDefault();
              event.stopPropagation();
              setProjectDropId(null);
              const source = projectFromDrag(event.dataTransfer, projects);
              if (sortable && source?.id === draggedProjectId) reorderWithinGroup(group, source.id, p.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (projectedDefault) return;
              setAgentMenu(null);
              setMenu({ projectId: p.id, x: e.clientX, y: e.clientY });
            }}
          >
            {(() => {
              const tooltip = [
                projectedDefault ? `Default Project on ${group.machine!.name}` : p.path,
                p.tag ? `#${p.tag}` : null,
                p.remote ? `Remote SSH: ${p.remote.user ? `${p.remote.user}@` : ''}${p.remote.host}` : null
              ]
                .filter(Boolean)
                .join('\n');
              const hasUnread = listedTerminals(terminals[p.id]).some((t) => unread[t.id]);
              const projectDot = <ProjectDot project={p} unread={hasUnread} />;
              const projectMeta = (
                <span className="project-meta project-meta--inline" title={tooltip || undefined}>
                  <span className="project-name">{displayName}</span>
                  {!isScratchWorkspaceProject(p) && folderAvailability[p.id] && !['ready', 'unknown', 'offline'].includes(folderAvailability[p.id]) && <span className="project-folder-warning" title={projectAvailabilityLabel[folderAvailability[p.id]]} aria-hidden="true">!</span>}
                  {isRemoteWorkspaceProject(p) && <Network size={11} strokeWidth={2} className="project-remote-icon" aria-label="Remote SSH project" />}
                </span>
              );
              const favoriteStar = (
                <span
                  role="button"
                  tabIndex={0}
                  className={`project-favorite-star${p.favorite ? ' is-fav' : ''}`}
                  aria-pressed={Boolean(p.favorite)}
                  aria-label={p.favorite ? `Remove ${displayName} from favorites` : `Add ${displayName} to favorites`}
                  title={p.favorite ? 'Favorite — click to remove' : 'Add to favorites'}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void updateProject(p.id, { favorite: !p.favorite });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      void updateProject(p.id, { favorite: !p.favorite });
                    }
                  }}
                >
                  <Star size={11} fill={p.favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                </span>
              );
              const treeChevron =
                liveList.length === 0 && railThreads.length === 0 ? null : (
                  <button
                    type="button"
                    className={`project-tree-chevron ${expanded ? 'expanded' : ''}`}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} sessions for ${displayName}`}
                    aria-expanded={expanded}
                    onClick={(e) => {
                      e.stopPropagation();
                      disclosure.setExpanded(disclosureId, !expanded);
                    }}
                  >
                    <ChevronRight size={14} />
                  </button>
                );
              if (renamingId === p.id) {
                return (
                  <div className={labelClass}>
                    {projectDot}
                    <input
                      className="project-rename"
                      value={renameValue}
                      autoFocus
                      aria-label={`Rename ${displayName}`}
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
                    {treeChevron}
                  </div>
                );
              }
              return (
                <div className={labelClass} {...listeners}>
                  <button
                    type="button"
                    className="project-select"
                    draggable={!mobile}
                    onDragStart={(event) => {
                      beginProjectDrag(event.dataTransfer, p);
                      suppressClickRef.current = true;
                      setDraggedProjectId(p.id);
                    }}
                    onDragEnd={() => {
                      setDraggedProjectId(null);
                      setProjectDropId(null);
                      releaseProjectClick();
                    }}
                    aria-label={`Open ${displayName}`}
                    onClick={() => {
                      if (consumeProjectClick()) return;
                      if (projectedDefault) openMachineThread(group.machine!, p);
                      else enterProjectFocus(p.id);
                    }}
                    {...(sortable ? attributes : {})}
                  >
                    {projectDot}
                    {projectMeta}
                  </button>
                  {!projectedDefault && favoriteStar}
                  {treeChevron}
                </div>
              );
            })()}
            {!expanded && !projectedDefault && <ProjectRollupDot projectId={p.id} />}
            {nestedCount > 0 && (
              <span
                className="project-badge"
                title={`${nestedCount} ${nestedCount === 1 ? 'agent' : 'agents'}`}
              >
                {nestedCount}
              </span>
            )}
            {!projectedDefault && <button
              type="button"
              className="project-actions"
              aria-label={`Project actions for ${displayName}`}
              title="Project actions"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({ projectId: p.id, x: rect.right, y: rect.bottom });
              }}
            >
              <MoreHorizontal size={15} />
            </button>}
            <button
              type="button"
              className="project-spawn"
              aria-label={`New agent in ${displayName}`}
              title="New agent"
              onClick={(e) => {
                e.stopPropagation();
                if (projectedDefault) openMachineThread(group.machine!, p);
                else spawnDefaultAgent(p);
              }}
            >
              <MessageCirclePlus size={14} />
            </button>
          </div>
          {(() => {
            if (!nestedCount) return null;
            if (!expanded) return null;
            const activeTab = selectedId === p.id ? selectedTabId[p.id] : undefined;
            return (
              <div className="project-terminals" role="list" aria-label={`Sessions in ${displayName}`}>
                {railThreads.map((thread) => (
                  <ProjectThreadRailRow
                    key={thread.id}
                    thread={thread}
                    active={activeThreadId === thread.id}
                    projectId={p.id}
                    routeProjectId={scopedProjectId}
                    onOpen={() => {
                      if (consumeProjectClick()) return;
                      navigate(getThreadRoutePath(thread.id, scopedProjectId));
                    }}
                    onContextMenu={(e) => openThreadMenu(e, thread, setThreadMenu)}
                  />
                ))}
                {liveList.map((t) => (
                  <ProjectAgentRailRow
                    key={t.id}
                    session={t}
                    isUnread={!!unread[t.id] && activeTab !== t.id}
                    active={activeSessionId === t.id}
                    onOpen={() => {
                      if (consumeProjectClick()) return;
                      navigate(getAgentSessionRoutePath(t.id, scopedProjectId));
                    }}
                    onContextMenu={(e) => openAgentCardMenu(e, t, p)}
                    projectId={p.id}
                    routeProjectId={scopedProjectId}
                    projectRemote={Boolean(p.remote)}
                  />
                ))}
              </div>
            );
          })()}
        </>
      )}
    </SortableProject>
    );
  };

  return (
    <section
      className={`${inSidebar ? 'sidebar-projects' : 'list-pane'} ${projectsCollapsed ? 'sidebar-projects--collapsed' : ''} ${dropOver ? 'drop-over' : ''}`}
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
            onClick={(event) => {
              onNavigate?.(event);
              if (event.defaultPrevented) return;
              if (mobile) setMobileProjectsOpen((open) => !open);
              else toggleSection(SIDEBAR_PROJECTS_SECTION_KEY);
            }}
            aria-label={`${projectsCollapsed ? 'Expand' : 'Collapse'} Machines section`}
            aria-controls={SIDEBAR_PROJECTS_TREE_ID}
            aria-expanded={!projectsCollapsed}
            title={`${projectsCollapsed ? 'Expand' : 'Collapse'} Machines`}
          >
            <span>Machines</span>
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={`sidebar-projects-chevron ${projectsCollapsed ? '' : 'open'}`}
            />
          </button>
        ) : (
          <h2>Projects</h2>
        )}
        {/* The sidebar header keeps project creation under one + menu. */}
        <div className="list-header-actions">
          {inSidebar ? (
            <>
              <div className="sidebar-projects-menu-wrap" ref={sidebarOrganizeRef}>
                <button
                  className={`icon-btn ${hideIdleProjects || agentsOnly ? 'on' : ''}`}
                  aria-label="Organize projects"
                  aria-haspopup="menu"
                  aria-expanded={sidebarOrganizeOpen}
                  title="Organize projects"
                  onClick={() => {
                    setMenu(null);
                    setSidebarAddOpen(false);
                    setSidebarOrganizeOpen((open) => !open);
                  }}
                >
                  <ListFilter size={14} />
                </button>
                {sidebarOrganizeOpen && (
                  <div className="sidebar-projects-organize-menu" role="menu" aria-label="Organize projects">
                    <span className="sidebar-projects-menu-label">Show</span>
                    {([
                      ['projects', 'Projects'],
                      ['agents', 'Agents only']
                    ] as const).map(([view, label]) => (
                      <button
                        key={view}
                        type="button"
                        role="menuitemradio"
                        aria-checked={sidebarProjectView === view}
                        onClick={() => setSidebarView(view)}
                      >
                        <span>{label}</span>
                        {sidebarProjectView === view && <Check size={14} aria-hidden="true" />}
                      </button>
                    ))}
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
                    {headerMenuActions.length > 0 && (
                      <>
                        <span className="sidebar-projects-menu-label">Plugins</span>
                        {headerMenuActions.map((action) => {
                          const Icon = resolveIcon(action.icon ?? 'Puzzle');
                          return (
                            <button
                              key={`${action.pluginId}:${action.id}:${action.generation}`}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setSidebarOrganizeOpen(false);
                                void action.run(projectMenuNavigateContext(action.pluginId, null, (to) => {
                                  void navigate(to);
                                }));
                              }}
                            >
                              <Icon size={14} />
                              <span>{action.title}</span>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Reload project list"
                title="Refresh projects"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
              >
                <RefreshCw size={14} className={refreshing ? 'spin' : undefined} aria-hidden="true" />
              </button>
              <div className="sidebar-projects-menu-wrap" ref={sidebarAddRef}>
                <button
                  className="icon-btn"
                  aria-label="Add machine or project"
                  aria-haspopup="menu"
                  aria-expanded={sidebarAddOpen}
                  title="Add machine or project"
                  onClick={() => {
                    setMenu(null);
                    setSidebarOrganizeOpen(false);
                    setSidebarAddOpen((open) => !open);
                  }}
                >
                  <Plus size={14} />
                </button>
                {sidebarAddOpen && (
                  <div className="sidebar-projects-add-menu" role="group" aria-label="Add a machine or project">
                    <button type="button" onClick={() => { navigate('/settings/machines'); setSidebarAddOpen(false); }}><Server size={14} /><span>Connect a machine</span></button>
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
                    {createProjectActions.map((action) => {
                      const Icon = resolveIcon(action.icon ?? 'Puzzle');
                      return (
                        <button
                          key={`${action.pluginId}:${action.id}:${action.generation}`}
                          type="button"
                          onClick={() => launchCreateProjectAction(action)}
                        >
                          <Icon size={14} />
                          <span>{action.title}</span>
                        </button>
                      );
                    })}
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
        {createProjectActions.map((action) => {
          const Icon = resolveIcon(action.icon ?? 'Puzzle');
          return (
            <button
              key={`${action.pluginId}:${action.id}:${action.generation}`}
              type="button"
              className="list-add-btn"
              aria-label={action.title}
              title={action.title}
              onClick={() => launchCreateProjectAction(action)}
            >
              <Icon size={14} />
              <span>{action.title}</span>
            </button>
          );
        })}
      </div>
      {projects.length > 0 && !scopedProjectId && !projectsCollapsed && (
        <div className="mobile-sticky-search">
          <div className={inSidebar ? 'sidebar-projects-filter list-filter' : 'list-filter'}>
            <Search size={14} className="list-filter-icon" aria-hidden="true" />
            <input
              placeholder={agentsOnly ? 'Filter agents' : inSidebar && !scopedProjectId ? 'Filter machines or projects' : 'Filter projects'}
              aria-label={agentsOnly ? 'Filter agents' : inSidebar && !scopedProjectId ? 'Filter machines or projects' : 'Filter projects'}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && filter) {
                  event.preventDefault();
                  event.stopPropagation();
                  setFilter('');
                }
              }}
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
        hidden={projectsCollapsed}
      >
        {projects.length === 0 ? (
          <div className="list-empty">
            No projects yet.
            <br />
            Add a <strong>Folder</strong>, <strong>Git</strong> repo, or <strong>Remote</strong>{' '}
            box above — or drop a folder here.
          </div>
        ) : agentsOnly ? (
          flatItems.length === 0 ? (
            <div className="list-empty" role="status">
              {filter.trim() ? <>No agents match &ldquo;{filter}&rdquo;.</> : 'No agents yet.'}
              <br />
              <button type="button" className="list-empty-link" onClick={() => setSidebarView('projects')}>
                Show projects
              </button>
            </div>
          ) : (
            <div className="project-terminals project-terminals--flat" role="list" aria-label="Agents">
              {flatItems.map((item) => {
                const projectName = composerProjectLabel(item.project);
                if (item.kind === 'thread') {
                  const { thread } = item;
                  return (
                    <ProjectThreadRailRow
                      key={thread.id}
                      thread={thread}
                      active={activeThreadId === thread.id}
                      projectId={item.project.id}
                      routeProjectId={scopedProjectId}
                      projectName={projectName}
                      onOpen={() => navigate(getThreadRoutePath(thread.id, scopedProjectId))}
                      onContextMenu={(e) => openThreadMenu(e, thread, setThreadMenu)}
                    />
                  );
                }
                const { session } = item;
                const activeTab = selectedId === item.project.id ? selectedTabId[item.project.id] : undefined;
                return (
                  <ProjectAgentRailRow
                    key={session.id}
                    session={session}
                    isUnread={!!unread[session.id] && activeTab !== session.id}
                    active={activeSessionId === session.id}
                    onOpen={() => navigate(getAgentSessionRoutePath(session.id, scopedProjectId))}
                    onContextMenu={(e) => openAgentCardMenu(e, session, item.project)}
                    projectId={item.project.id}
                    routeProjectId={scopedProjectId}
                    projectRemote={Boolean(item.project.remote)}
                    projectName={projectName}
                  />
                );
              })}
            </div>
          )
        ) : inSidebar && railGroups.length === 0 ? (
          <div className="list-empty" role="status">No machines or projects match &ldquo;{filter}&rdquo;.</div>
        ) : railGroups.every(group => group.projects.length === 0) && !inSidebar ? (
          filter.trim() ? (
            <div className="list-empty" role="status">No projects match &ldquo;{filter}&rdquo;.</div>
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onProjectDragStart}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
          >
            {railGroups.map((group) => (
              <div key={group.machine?.id ?? 'projects'} className={`project-rail-group${group.machine ? ' machine-project-group' : ''}`} data-machine-id={group.machine?.id}>
                {group.machine && <div className="machine-project-heading"
                  onContextMenu={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openMachineMenu(group.machine!.id, event.currentTarget, event.clientX, event.clientY);
                  }}
                  onKeyDown={event => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openMachineMenu(group.machine!.id, event.currentTarget, rect.left, rect.bottom);
                  }}>
                  <button type="button" className="machine-project-disclosure" aria-label={`${collapsedSections[`sidebar:machine:${group.machine.id}`] && !filter ? 'Expand' : 'Collapse'} ${group.machine.name}`} aria-expanded={!collapsedSections[`sidebar:machine:${group.machine.id}`] || Boolean(filter)} onClick={() => toggleSection(`sidebar:machine:${group.machine!.id}`)}>
                    <ChevronRight size={13} className={!collapsedSections[`sidebar:machine:${group.machine.id}`] || filter ? 'open' : ''} />
                  </button>
                  <button type="button" className="machine-project-name" aria-label={group.machine.name} aria-expanded={!collapsedSections[`sidebar:machine:${group.machine.id}`] || Boolean(filter)} onClick={() => toggleSection(`sidebar:machine:${group.machine!.id}`)}>
                    {group.machine.primary ? <Laptop size={15} /> : <Server size={15} />}
                    <span>{group.machine.name}</span>
                    <span className={`machine-project-status${group.machine.host?.status === 'connected' ? ' online' : ''}`} title={group.machine.host?.status === 'connected' ? 'Online' : group.machine.host ? 'Offline' : group.machine.hostId ? 'Unavailable' : group.machine.remote ? 'Setup needed' : 'Local'} />
                    <small>{group.machine.projects.length}</small>
                  </button>
                  <button type="button" className="machine-project-add" aria-label={`Add project on ${group.machine.name}`} onClick={() => setAddingMachine(group.machine!)}><Plus size={13} /></button>
                </div>}
                {(!group.machine || !collapsedSections[`sidebar:machine:${group.machine.id}`] || Boolean(filter)) && <div className={group.machine ? 'machine-project-children' : undefined}>
                  <SortableContext items={group.projects.map(project => isScratchWorkspaceProject(project) && group.machine && !group.machine.primary && project.hostId !== group.machine.hostId ? `${group.machine.id}:${project.id}` : project.id)} strategy={verticalListSortingStrategy}>
                    {group.projects.map(project => renderProject(group, project))}
                  </SortableContext>
                  {group.machine && <button type="button" className="machine-project-add-child" onClick={() => setAddingMachine(group.machine!)}><Plus size={12} />Add project</button>}
                </div>}
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
        const pinnedFirst = Boolean(p && isScratchWorkspaceProject(p));
        const prevPinned = Boolean(
          menuGroup && menuIndex > 0 && isScratchWorkspaceProject(menuGroup.projects[menuIndex - 1])
        );
        return (
        <div
          ref={menuRef}
          className="project-menu"
          role={menu.machineId ? 'menu' : undefined}
          aria-label={menu.machineId ? 'Machine actions' : undefined}
          style={{ top: menu.y, left: menu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.machineId && (
            <button type="button" className="project-menu-item" role="menuitem" autoFocus onClick={() => { setOverviewMachineId(menu.machineId!); setMenu(null); }}>
              <FolderOpen size={12} />
              <span>View projects</span>
            </button>
          )}
          {!p && !menu.machineId && (
            <button className="project-menu-item" onClick={() => { setMenu(null); void handleRefresh(); }}>
              <RefreshCw size={12} />
              <span>Refresh projects</span>
            </button>
          )}
          {p && (
            <>
              <ProjectOpenActions project={p} onClose={() => setMenu(null)} />
              <div className="project-menu-sep" />
              {mobile && (
                <button className="project-menu-item" onClick={() => { setMenu(null); spawnDefaultAgent(p); }}>
                  <MessageCirclePlus size={16} />
                  <span>New agent</span>
                </button>
              )}
              <button
                className="project-menu-item"
                disabled={!canReorder || !menuGroup || pinnedFirst || prevPinned || menuIndex <= 0}
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
                disabled={!canReorder || !menuGroup || pinnedFirst || menuIndex === -1 || menuIndex >= menuGroup.projects.length - 1}
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
              {!scopedProjectId && (
                <button
                  className="project-menu-item"
                  onClick={() => {
                    setMenu(null);
                    void product.windows.openProject(p.id);
                  }}
                >
                  <AppWindow size={12} />
                  <span>Open in new window</span>
                </button>
              )}
              {rowMenuActions.length > 0 && (
                <>
                  <div className="project-menu-sep" />
                  {rowMenuActions.map((action) => {
                    const Icon = resolveIcon(action.icon ?? 'Puzzle');
                    const key = `${action.pluginId}:${action.id}:${action.generation}`;
                    const resolvedTitle = projectActionTitles.menu === menu ? projectActionTitles.titles[`${p.id}:${key}`] : undefined;
                    return (
                      <button
                        key={key}
                        className="project-menu-item"
                        disabled={Boolean(action.titleForProject) && !resolvedTitle}
                        onClick={() => {
                          setMenu(null);
                          void action.run(projectMenuNavigateContext(action.pluginId, p.id, (to) => {
                            void navigate(to);
                          }));
                        }}
                      >
                        <Icon size={12} />
                        <span>{action.titleForProject ? (resolvedTitle ?? 'Checking…') : action.title}</span>
                      </button>
                    );
                  })}
                </>
              )}
              <div className="project-menu-sep" />
              <button
                className="project-menu-item"
                onClick={() => {
                  setMenu(null);
                  openProjectSettings(p.id);
                }}
              >
                <Settings2 size={12} />
                <span>Project settings…</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => startRename(p.id, composerProjectLabel(p))}
              >
                <Pencil size={12} />
                <span>Rename</span>
              </button>
              {(() => {
                const armed = confirmDeleteId === p.id;
                const running = projectRailTerminals(terminals[p.id]).length;
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
              {!isScratchWorkspaceProject(p) && <>
                <div className="project-menu-label">Icon</div>
                <ProjectIconPicker value={p.icon} onChange={icon => {
                  void updateProject(p.id, { icon });
                  setMenu(null);
                }} />
              </>}
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
      {agentMenu && (
        <AgentCardMenu menu={agentMenu} setMenu={setAgentMenu} actions={agentActions} />
      )}
      {threadMenu && (
        <ThreadCardMenu menu={threadMenu} setMenu={setThreadMenu} />
      )}
      {agentRename && (
        <PromptModal
          title="Rename agent"
          label="Name"
          initialValue={agentRename.card.session.title}
          confirmLabel="Rename"
          onSubmit={(v) => submitAgentRename(agentRename.card, v)}
          onClose={closeAgentRename}
        />
      )}
      {!inSidebar && <ListPaneResizer />}
      {overviewMachineId && machineGroups.find(group => group.id === overviewMachineId) && <MachineProjectsDialog
        group={machineGroups.find(group => group.id === overviewMachineId)!}
        onClose={() => setOverviewMachineId(null)}
        onAdd={group => { setOverviewMachineId(null); setAddingMachine(group); }}
        onNewThread={(group, project) => { setOverviewMachineId(null); openMachineThread(group, project); }}
        onOpenProject={project => { setOverviewMachineId(null); enterProjectFocus(project.id); }}
      />}
      {addingMachine && <AddMachineProjectDialog group={addingMachine} onClose={() => setAddingMachine(null)} onAdded={project => { setAddingMachine(null); selectProject(project.id); }} />}
      {showRemoteDialog && (
        <AddRemoteProjectDialog
          onClose={() => setShowRemoteDialog(false)}
          onSubmit={addRemoteProject}
          onSuccess={(id) => selectProject(id)}
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
          onBrowse={() => product.projects.pickDirectory()}
          onSubmit={async (path, hostId) => {
            const p = await addProjectByPath(path, hostId ? { hostId } : undefined);
            if (p) selectProject(p.id);
            return p;
          }}
        />
      )}
      {createProjectDialog && (
        <PluginCreateProjectDialog
          state={createProjectDialog}
          onClose={() => setCreateProjectDialog(null)}
          pickDirectory={() => product.projects.pickDirectory()}
          addProject={async (path) => {
            const project = await addProjectByPath(path);
            return project ? { id: project.id } : null;
          }}
          cloneRoot={async () => {
            const root = await product.projects.cloneRoot().catch(() => '');
            return root.trim() || null;
          }}
          navigate={(to) => {
            void navigate(to);
          }}
        />
      )}
    </section>
  );
}
