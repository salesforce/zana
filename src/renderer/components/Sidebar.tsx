import { Fragment, cloneElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
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
import {
  Blocks,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  FolderGit2,
  House,
  Inbox,
  LayoutDashboard,
  MessageCircleQuestion,
  MessageCirclePlus,
  Sparkles,
  Settings,
  type LucideIcon
} from 'lucide-react';
import {
  useUi,
  useData,
  useUnreadInboxCount,
  useEnabledSchedulerCount,
  useRunningSchedulerCount,
  useAgentNavCounts,
  type NavId
} from '../store';
import { resolveIcon } from '../util/resolveIcon';
import { useMergedModules } from '../modules';
import { AgentTray } from './AgentTray';
import { ProjectsList } from './listpane/ProjectsList';
import {
  normalizeSidebarNavOrder,
  PINNED_SIDEBAR_NAV_IDS,
  reorderSidebarNavItems
} from './sidebarNavOrder';
import { listSidebarFooterActions, subscribePluginSlots } from '../plugins/plugin-slots';

interface NavEntry {
  id: NavId;
  label: string;
  icon: LucideIcon;
}

const coreNavItems: NavEntry[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'scheduler', label: 'Scheduler', icon: Clock }
];

// Next Steps launcher (afl-03) — opt-in via AppConfig.suggestionsEnabled. The
// nav id stays 'suggestions' (stable internal id); only the label is user-facing.
// Slots in right after Inbox (its sibling surface).
const suggestionsNavItem: NavEntry = { id: 'suggestions', label: 'Next Steps', icon: Sparkles };
// Global (cross-project) Follow-ups — same experimental gate as the
// project-scoped workspace mode (AppConfig.followUpsEnabled); 'followups' was
// already a valid CoreNavId (for the scoped mode) but had no top-level panel
// until now. Slots in right after Inbox, alongside its sibling launchers.
const followupsNavItem: NavEntry = { id: 'followups', label: 'Follow-ups', icon: MessageCircleQuestion };

// Plugins / Skills / MCP are no longer top-level rail destinations — they live
// as tabs inside the Settings panel (configuration, not content). Extensions,
// by contrast, IS a content/discovery destination (browse + install, the
// VSCode-style store), so it earns a system-level rail entry alongside Settings.
const extensionsNavItem: NavEntry = { id: 'extensions', label: 'Extensions', icon: Blocks };
const settingsNavItem: NavEntry = { id: 'settings', label: 'Settings', icon: Settings };
// Fixed utility dock, separate from the movable destinations. Add future
// utility actions here; the layout remains a compact horizontal icon row.
const sidebarUtilityItems = [settingsNavItem];

function SortableNavItem({
  id,
  children
}: {
  id: string;
  children: ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`sidebar-nav-sortable ${isDragging ? 'is-dragging' : ''}`}
      data-sortable-nav-id={id}
      // The sidebar mixes compact rows with tall collection sections. Preserve a
      // dragged item's own dimensions instead of scaling it to the target's rect.
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {cloneElement(children, { ...attributes, ...listeners })}
    </div>
  );
}

function SortableSidebarSection({
  id,
  children
}: {
  id: string;
  children: ReactElement<{ dragHandle?: React.HTMLAttributes<HTMLElement> }>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`sidebar-section-sortable ${isDragging ? 'is-dragging' : ''}`}
      data-sortable-sidebar-section-id={id}
      // See SortableNavItem: a section must translate between slots, not stretch
      // to the height of a nav row while it crosses one.
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {cloneElement(children, { dragHandle: { ...attributes, ...listeners } })}
    </div>
  );
}

const NAV_ORDER_KEY = 'zcc.sidebarNavOrder';

const navCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

function readNavOrder(): unknown {
  if (typeof localStorage === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(NAV_ORDER_KEY) ?? 'null');
  } catch {
    return null;
  }
}

const AGENTS_SECTION_KEY = 'sidebar:agents';
const AGENTS_SECTION_ID = 'sidebar-agents-list';
const AGENTS_SECTION_SORT_ID = 'sidebar-section:agents';
const WORKSPACES_SECTION_SORT_ID = 'sidebar-section:workspaces';
const AGENTS_SECTION_HEIGHT_KEY = 'zcc.sidebarAgentsHeight';
const AGENTS_SECTION_DEFAULT_HEIGHT = 176;
const AGENTS_SECTION_MIN_HEIGHT = 64;
const AGENTS_SECTION_MAX_HEIGHT = 420;

function clampAgentsSectionHeight(value: number): number {
  return Math.max(AGENTS_SECTION_MIN_HEIGHT, Math.min(AGENTS_SECTION_MAX_HEIGHT, value));
}

function readAgentsSectionHeight(): number {
  if (typeof localStorage === 'undefined') return AGENTS_SECTION_DEFAULT_HEIGHT;
  const value = Number(localStorage.getItem(AGENTS_SECTION_HEIGHT_KEY));
  return Number.isFinite(value) ? clampAgentsSectionHeight(value) : AGENTS_SECTION_DEFAULT_HEIGHT;
}

/** Active agents use the same collapsible collection treatment as Workspaces. */
function AgentsSidebarSection({
  dragHandle
}: {
  dragHandle?: React.HTMLAttributes<HTMLElement>;
}) {
  const collapsed = useUi((s) => !!s.collapsedSections[AGENTS_SECTION_KEY]);
  const toggleSection = useUi((s) => s.toggleSection);
  const setLauncherOpen = useUi((s) => s.setLauncherOpen);
  const setNav = useUi((s) => s.setNav);
  const [height, setHeight] = useState(readAgentsSectionHeight);

  const setSectionHeight = (next: number) => {
    const clamped = clampAgentsSectionHeight(next);
    setHeight(clamped);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AGENTS_SECTION_HEIGHT_KEY, String(clamped));
    }
  };

  const onResizeMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    document.body.classList.add('resizing-sidebar-section');
    const onMove = (moveEvent: MouseEvent) => setSectionHeight(startHeight + moveEvent.clientY - startY);
    const onUp = () => {
      document.body.classList.remove('resizing-sidebar-section');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <section
      className={`sidebar-agents ${collapsed ? 'sidebar-agents--collapsed' : ''}`}
      style={collapsed ? undefined : { '--sidebar-agents-height': `${height}px` } as React.CSSProperties}
    >
      <header className="sidebar-agents-header">
        <button
          type="button"
          className="sidebar-agents-heading"
          {...dragHandle}
          onClick={() => toggleSection(AGENTS_SECTION_KEY)}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} Agents section`}
          aria-controls={AGENTS_SECTION_ID}
          aria-expanded={!collapsed}
          title={`${collapsed ? 'Expand' : 'Collapse'} Agents`}
        >
          <span>Agents</span>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`sidebar-agents-chevron ${collapsed ? '' : 'open'}`}
          />
        </button>
        <div className="sidebar-agents-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Open Agents dashboard"
            title="Open Agents dashboard"
            onClick={() => setNav('agents')}
          >
            <LayoutDashboard size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="New quick agent"
            title="New quick agent"
            onClick={() => setLauncherOpen(true)}
          >
            <MessageCirclePlus size={18} />
          </button>
        </div>
      </header>
      <div id={AGENTS_SECTION_ID} className="sidebar-agents-body" hidden={collapsed}>
        <AgentTray placement="inline" />
      </div>
      {!collapsed && (
        <div
          className="sidebar-agents-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={AGENTS_SECTION_MIN_HEIGHT}
          aria-valuemax={AGENTS_SECTION_MAX_HEIGHT}
          aria-valuenow={height}
          title="Drag to resize · double-click to reset"
          onMouseDown={onResizeMouseDown}
          onDoubleClick={() => setSectionHeight(AGENTS_SECTION_DEFAULT_HEIGHT)}
        />
      )}
    </section>
  );
}

export function Sidebar() {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const unreadInbox = useUnreadInboxCount();
  const enabledSchedules = useEnabledSchedulerCount();
  const runningSchedules = useRunningSchedulerCount();
  const agentCounts = useAgentNavCounts();
  const suggestionsEnabled = useData((s) => s.suggestionsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  const [storedNavOrder, setStoredNavOrder] = useState(readNavOrder);
  const suppressNavClickRef = useRef(false);
  const navHistoryRef = useRef<NavId[]>([nav]);
  const navHistoryIndexRef = useRef(0);
  const [, setNavHistoryRevision] = useState(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== NAV_ORDER_KEY) return;
      try { setStoredNavOrder(JSON.parse(event.newValue ?? 'null')); } catch { setStoredNavOrder(null); }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => {
    const history = navHistoryRef.current;
    const index = navHistoryIndexRef.current;
    if (history[index] === nav) return;
    history.splice(index + 1);
    history.push(nav);
    navHistoryIndexRef.current = history.length - 1;
    setNavHistoryRevision((revision) => revision + 1);
  }, [nav]);
  const navItems = useMemo(() => {
    const items = [...coreNavItems];
    if (suggestionsEnabled) items.splice(2, 0, suggestionsNavItem);
    if (followUpsEnabled) items.splice(2, 0, followupsNavItem);
    return items;
  }, [suggestionsEnabled, followUpsEnabled]);
  const modules = useMergedModules();
  const footerActions = useSyncExternalStore(
    subscribePluginSlots,
    listSidebarFooterActions,
    listSidebarFooterActions
  );
  // Extensions shares installation and configuration in one hub. Installed
  // panels with a global surface also get a direct shortcut above Workspaces;
  // project-only and Settings-only modules stay in their native surfaces.
  const moduleNavItems: NavEntry[] = modules
    .filter((module) =>
      !!module.panel &&
      module.placement !== 'settings' &&
      module.projectTab?.global !== false
    )
    .map((module) => ({
      id: module.id,
      label: module.title,
      icon: resolveIcon(module.icon)
    }));
  const fixedNavItems = [
    ...navItems.filter((item) => PINNED_SIDEBAR_NAV_IDS.includes(item.id as never)),
    ...navItems.filter(
      (item) => !['agents', 'projects', 'scheduler', ...PINNED_SIDEBAR_NAV_IDS].includes(item.id)
    ),
    coreNavItems.find((item) => item.id === 'scheduler')!,
    extensionsNavItem,
    ...moduleNavItems
  ];
  const navItemsById = new Map<string, NavEntry>(fixedNavItems.map((item) => [item.id, item]));
  const sortableSidebarSectionIds = [AGENTS_SECTION_SORT_ID, WORKSPACES_SECTION_SORT_ID];
  const orderedNavIds = normalizeSidebarNavOrder(
    storedNavOrder,
    [...fixedNavItems.map((item) => item.id), ...sortableSidebarSectionIds]
  );
  const pinnedNavIds = orderedNavIds.filter((id) => PINNED_SIDEBAR_NAV_IDS.includes(id as never));
  const sortableNavIds = orderedNavIds.filter(
    (id) => !PINNED_SIDEBAR_NAV_IDS.includes(id as never)
  );

  const renderNavItem = (
    item: NavEntry,
    compactOnly = false
  ): ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>> => {
    const Icon = item.icon;
    const showBadge = item.id === 'inbox' && unreadInbox > 0;
    // Scheduler badge only appears when a scheduled agent is running right now;
    // it shows that live count in gold and adds a pulsing dot on the icon so
    // the "running" state reads at a glance. An armed-but-idle schedule shows
    // no badge.
    const isScheduler = item.id === 'scheduler';
    const running = isScheduler && runningSchedules > 0;
    const showScheduleBadge = running;
    const scheduleTitle = `${runningSchedules} running · ${enabledSchedules} scheduled`;
    // Agents badge: live count of working/blocked agents, red when any is
    // blocked (needs you), gold-ish (running) otherwise. Mirrors the scheduler
    // running-dot treatment so a working agent reads at a glance on the rail.
    const isAgents = item.id === 'agents';
    const agentsActive = isAgents && agentCounts.active > 0;
    const agentsBlocked = isAgents && agentCounts.blocked > 0;
    const agentsTitle = agentsBlocked
      ? `${agentCounts.active} active · ${agentCounts.blocked} need you`
      : `${agentCounts.active} active`;
    return (
      <button
        key={item.id}
        // Stable e2e hook (inert in prod — a plain data attr): the UI-driven
        // specs click nav entries by id (`nav-agents`, `nav-projects`, …).
        data-testid={`nav-${item.id}`}
        className={`nav-item ${compactOnly ? 'nav-item--compact-only' : ''} ${nav === item.id ? 'active' : ''}`}
        onClick={() => {
          if (suppressNavClickRef.current) {
            suppressNavClickRef.current = false;
            return;
          }
          // Clicking the top-level Projects rail item always returns to the
          // un-focused home (the cross-project Agents board + project list),
          // never staying drilled into / highlighting the last project.
          if (item.id === 'projects') {
            useUi.getState().exitProjectFocus();
            useUi.getState().selectProject(null);
          }
          setNav(item.id as NavId);
        }}
        aria-current={nav === item.id ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        title={
          collapsed
            ? showScheduleBadge
              ? `${item.label} — ${scheduleTitle}`
              : agentsActive
                ? `${item.label} — ${agentsTitle}`
                : item.label
            : undefined
        }
      >
        <span className="nav-item-icon">
          <Icon size={16} />
          {(running || agentsActive) && (
            <span className="nav-running-dot" aria-hidden="true" />
          )}
        </span>
        <span className="nav-item-label">{item.label}</span>
        {showBadge && (
          <span
            className="nav-badge"
            aria-label={`${unreadInbox} unread`}
            title={`${unreadInbox} unread`}
          >
            {unreadInbox > 99 ? '99+' : unreadInbox}
          </span>
        )}
        {showScheduleBadge && (
          <span
            className="nav-badge nav-badge--running"
            aria-label={scheduleTitle}
            title={scheduleTitle}
          >
            {runningSchedules > 99 ? '99+' : runningSchedules}
          </span>
        )}
        {agentsActive && (
          <span
            className={`nav-badge ${agentsBlocked ? 'nav-badge--blocked' : 'nav-badge--running'}`}
            aria-label={agentsTitle}
            title={agentsTitle}
          >
            {agentCounts.active > 99 ? '99+' : agentCounts.active}
          </span>
        )}
      </button>
    );
  };

  const handleNavDragEnd = ({ active, over }: DragEndEvent) => {
    window.setTimeout(() => { suppressNavClickRef.current = false; }, 0);
    if (!over || active.id === over.id) return;
    const next = reorderSidebarNavItems(orderedNavIds, String(active.id), String(over.id));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next));
    }
    setStoredNavOrder(next);
  };

  const handleNavDragStart = ({ activatorEvent }: DragStartEvent) => {
    suppressNavClickRef.current = activatorEvent.type === 'pointerdown';
  };

  const handleNavDragCancel = () => {
    window.setTimeout(() => { suppressNavClickRef.current = false; }, 0);
  };

  const goNavHistory = (direction: -1 | 1) => {
    const nextIndex = navHistoryIndexRef.current + direction;
    const nextNav = navHistoryRef.current[nextIndex];
    if (!nextNav) return;
    navHistoryIndexRef.current = nextIndex;
    setNav(nextNav);
    setNavHistoryRevision((revision) => revision + 1);
  };
  const canGoBack = navHistoryIndexRef.current > 0;
  const canGoForward = navHistoryIndexRef.current < navHistoryRef.current.length - 1;

  // The shell owns the single persistent toggle. Returning no rail removes the
  // navigation column while its fixed trigger stays available above the shell.
  if (collapsed) return null;

  return (
    <aside className="sidebar sidebar--global">
      <div className="sidebar-chrome">
        <div className="sidebar-history-controls" aria-label="Navigation history">
          <button
            type="button"
            aria-label="Go back"
            title="Go back"
            disabled={!canGoBack}
            onClick={() => goNavHistory(-1)}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            type="button"
            aria-label="Go forward"
            title="Go forward"
            disabled={!canGoForward}
            onClick={() => goNavHistory(1)}
          >
            <ChevronRight size={19} />
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={navCollisionDetection}
        onDragStart={handleNavDragStart}
        onDragCancel={handleNavDragCancel}
        onDragEnd={handleNavDragEnd}
      >
        <div className="sidebar-sections">
          <nav className="sidebar-nav sidebar-nav--sortable" aria-label="Main navigation" data-testid="sidebar-navigation">
            {pinnedNavIds.map((id) => {
              const item = navItemsById.get(id);
              return item ? (
                <Fragment key={id}>
                  {renderNavItem(item)}
                </Fragment>
              ) : null;
            })}
            <SortableContext items={sortableNavIds} strategy={verticalListSortingStrategy}>
              {sortableNavIds.map((id) => {
                const item = navItemsById.get(id);
                if (item) return (
                  <Fragment key={id}>
                    <SortableNavItem
                      id={id}
                    >
                      {renderNavItem(item)}
                    </SortableNavItem>
                  </Fragment>
                );
                if (id === AGENTS_SECTION_SORT_ID) return (
                  <SortableSidebarSection key={id} id={id}>
                    <AgentsSidebarSection />
                  </SortableSidebarSection>
                );
                if (id === WORKSPACES_SECTION_SORT_ID) return (
                  <SortableSidebarSection key={id} id={id}>
                    <ProjectsList placement="sidebar" />
                  </SortableSidebarSection>
                );
                return null;
              })}
            </SortableContext>
          </nav>
        </div>
      </DndContext>

      <div className="sidebar-utility-bar" aria-label="Sidebar utilities">
        {sidebarUtilityItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-utility-button ${nav === item.id ? 'active' : ''}`}
              aria-label={item.label}
              aria-current={nav === item.id ? 'page' : undefined}
              title={item.label}
              onClick={() => setNav(item.id as NavId)}
            >
              <Icon size={18} />
            </button>
          );
        })}
        {footerActions.map((action) => (
          <button
            key={`${action.id}:${action.generation}`}
            type="button"
            className="sidebar-utility-button"
            aria-label={action.title}
            title={action.title}
            onClick={() => {
              void action.run();
            }}
          >
            {(() => {
              const Icon = resolveIcon(action.icon);
              return <Icon size={18} />;
            })()}
          </button>
        ))}
      </div>
    </aside>
  );
}
