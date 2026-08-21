import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { DndContext } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import {
  Blocks,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  FolderGit2,
  House,
  Inbox,
  MessageCircleQuestion,
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
} from '../store.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { useMergedModules } from '../modules/index.js';
import { AgentsSidebarSection } from './AgentsSidebarSection.js';
import { ProjectsList } from './listpane/ProjectsList.js';
import { PINNED_SIDEBAR_NAV_IDS } from './sidebarNavOrder.js';
import {
  AGENTS_SECTION_SORT_ID,
  GLOBAL_NAV_ORDER_KEY,
  SortableNavItem,
  SortableSidebarSection,
  WORKSPACES_SECTION_SORT_ID,
  useSortableSidebarNav
} from './sidebarSortable.js';
import { listSidebarFooterActions, subscribePluginSlots } from '../plugins/plugin-slots.js';

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

// Plugins / Skills / MCP live on the focused Extensions workspace (not
// Settings). Extensions itself is a content/discovery destination (browse +
// install, the VSCode-style store), so it earns a system-level rail entry
// alongside Settings.
const extensionsNavItem: NavEntry = { id: 'extensions', label: 'Extensions', icon: Blocks };
const settingsNavItem: NavEntry = { id: 'settings', label: 'Settings', icon: Settings };
// Fixed utility dock, separate from the movable destinations. Add future
// utility actions here; the layout remains a compact horizontal icon row.
const sidebarUtilityItems = [settingsNavItem];

const NAV_ORDER_KEY = GLOBAL_NAV_ORDER_KEY;

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
  const navHistoryRef = useRef<NavId[]>([nav]);
  const navHistoryIndexRef = useRef(0);
  const [, setNavHistoryRevision] = useState(0);
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
  const {
    pinnedNavIds,
    sortableNavIds,
    sensors,
    collisionDetection,
    onDragStart,
    onDragCancel,
    onDragEnd,
    consumeNavClick
  } = useSortableSidebarNav(
    NAV_ORDER_KEY,
    [...fixedNavItems.map((item) => item.id), AGENTS_SECTION_SORT_ID, WORKSPACES_SECTION_SORT_ID],
    PINNED_SIDEBAR_NAV_IDS
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
          if (consumeNavClick()) return;
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
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
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
