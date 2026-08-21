import { Fragment, useEffect, useSyncExternalStore, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  Inbox,
  TerminalSquare,
  FolderTree,
  Clock,
  Target,
  MessageCircleQuestion,
  Activity,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Settings,
  AppWindow,
  Sparkles,
  type LucideIcon
} from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  useData,
  useUi,
  useUnreadInboxCount,
  useProjectActiveGoalCount,
  useProjectOpenFollowUpCount,
  useProjectScheduleCount,
  useProjectRunningTerminalCount,
  type WorkspaceMode,
  type ProjectView
} from '../store.js';
import { useProjectTabModules } from '../modules/index.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { resolveProjectTabModule } from '../lib/libraryPlugin.js';
import { listSidebarFooterActions, subscribePluginSlots } from '../plugins/plugin-slots.js';
import { AgentsSidebarSection } from './AgentsSidebarSection.js';
import {
  AGENTS_SECTION_SORT_ID,
  PINNED_PROJECT_NAV_IDS,
  PROJECT_NAV_ORDER_KEY,
  SortableNavItem,
  SortableSidebarSection,
  useSortableSidebarNav
} from './sidebarSortable.js';

/**
 * The left nav rail for a single-project FOCUSED VIEW. Replaces the global
 * {@link Sidebar} with the same chrome, flat destination list, utility dock,
 * and drag-and-drop reorder — only the destinations change (this project's
 * workspace modes instead of Home / Workspaces).
 *
 * Inbox is pinned (same as the global rail). Everything else, including the
 * Agents collection, can be reordered and is persisted separately from the
 * global sidebar.
 *
 * Inbox switches `nav`; workspace modes set `nav='projects'` + the project's
 * `workspaceMode`. Agents is a collapsible collection (same chrome as the
 * global Sidebar), not a destination row — the dashboard control opens the
 * project Agents board.
 *
 * Two variants, same rail:
 * - `'window'` — a PER-PROJECT WINDOW (opened "in a new window"). The window is
 *   hard-locked to the project (URL scope); there is no "back".
 * - `'focus'` — the MAIN WINDOW drilled into a project (`focusedProjectId`).
 *   History back returns to the cross-project home; Settings stays one click
 *   away in the utility dock.
 */

interface ModeItem {
  mode: WorkspaceMode;
  label: string;
  icon: LucideIcon;
}

const MODE_ITEMS: ModeItem[] = [
  { mode: 'feed', label: 'Feed', icon: Activity },
  { mode: 'terminals', label: 'Terminals', icon: TerminalSquare },
  { mode: 'explorer', label: 'Explorer', icon: FolderTree },
  { mode: 'scheduler', label: 'Scheduler', icon: Clock },
  { mode: 'goals', label: 'Goals', icon: Target },
  { mode: 'followups', label: 'Follow-ups', icon: MessageCircleQuestion }
];

/** Must forward extra button props — SortableNavItem cloneElement's dnd-kit
 *  listeners onto this component, not onto a host <button>. */
function NavRow({
  label,
  icon,
  active,
  collapsed,
  title,
  testId,
  badge,
  running,
  onClick,
  ...rest
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  collapsed: boolean;
  title?: string;
  testId?: string;
  badge?: ReactNode;
  running?: boolean;
  onClick: () => void;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'children' | 'title'>): ReactElement<ButtonHTMLAttributes<HTMLButtonElement>> {
  return (
    <button
      type="button"
      data-testid={testId}
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      title={title ?? label}
      {...rest}
    >
      <span className="nav-item-icon">
        {icon}
        {running && <span className="nav-running-dot" aria-hidden="true" />}
      </span>
      <span className="nav-item-label">{label}</span>
      {badge}
    </button>
  );
}

function CountBadge({
  count,
  label,
  title,
  kind
}: {
  count: number;
  label: string;
  title: string;
  kind?: 'running' | 'blocked';
}) {
  return (
    <span
      className={`nav-badge${kind ? ` nav-badge--${kind}` : ''}`}
      aria-label={label}
      title={title}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function ProjectScopedNav({
  project,
  variant = 'window',
  onBack
}: {
  project: Project;
  /** `'window'` for a per-project window, `'focus'` for the main window drilled
   *  into a project. `'focus'` shows the back control + Settings dock. */
  variant?: 'window' | 'focus';
  /** Return to the cross-project home. Only used in the `'focus'` variant. */
  onBack?: () => void;
}) {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);
  const isFocus = variant === 'focus';
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const goalsEnabled = useData((s) => s.goalsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  const suggestionsEnabled = useData((s) => s.suggestionsEnabled);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const mode = useUi((s) => s.workspaceMode[project.id]) ?? 'agents';
  const unreadInbox = useUnreadInboxCount();
  const activeGoals = useProjectActiveGoalCount(project.id);
  const openFollowUps = useProjectOpenFollowUpCount(project.id);
  const scheduleCount = useProjectScheduleCount(project.id);
  const runningTerminals = useProjectRunningTerminalCount(project.id);
  const projectTabModules = useProjectTabModules();
  const footerActions = useSyncExternalStore(
    subscribePluginSlots,
    listSidebarFooterActions,
    listSidebarFooterActions
  );

  const onProjects = nav === 'projects';

  const modeItems = MODE_ITEMS.filter(
    (item) =>
      (item.mode !== 'goals' || goalsEnabled) &&
      (item.mode !== 'followups' || followUpsEnabled)
  );
  useEffect(() => {
    if ((mode === 'goals' && !goalsEnabled) || (mode === 'followups' && !followUpsEnabled)) {
      setWorkspaceMode(project.id, 'agents');
    }
  }, [mode, goalsEnabled, followUpsEnabled, project.id, setWorkspaceMode]);

  const selectMode = (m: ProjectView) => {
    setNav('projects');
    setWorkspaceMode(project.id, m);
  };

  const availableIds = [
    'inbox',
    ...(suggestionsEnabled ? ['suggestions'] : []),
    ...modeItems.map((item) => item.mode),
    ...projectTabModules.map((m) => m.id),
    AGENTS_SECTION_SORT_ID
  ];
  const {
    pinnedNavIds,
    sortableNavIds,
    sensors,
    collisionDetection,
    onDragStart,
    onDragCancel,
    onDragEnd,
    consumeNavClick
  } = useSortableSidebarNav(PROJECT_NAV_ORDER_KEY, availableIds, PINNED_PROJECT_NAV_IDS);

  const click = (fn: () => void) => () => {
    if (consumeNavClick()) return;
    fn();
  };

  const renderInbox = () => (
    <NavRow
      label="Inbox"
      icon={<Inbox size={16} />}
      active={nav === 'inbox'}
      collapsed={collapsed}
      title="Inbox for this project"
      testId="project-nav-inbox"
      onClick={click(() => setNav('inbox'))}
      badge={
        unreadInbox > 0 ? (
          <CountBadge
            count={unreadInbox}
            label={`${unreadInbox} unread`}
            title={`${unreadInbox} unread`}
          />
        ) : null
      }
    />
  );

  const renderSuggestions = () => (
    <NavRow
      label="Next Steps"
      icon={<Sparkles size={16} />}
      active={nav === 'suggestions'}
      collapsed={collapsed}
      title="Next Steps for this project"
      testId="project-nav-suggestions"
      onClick={click(() => setNav('suggestions'))}
    />
  );

  const renderModeRow = (item: ModeItem) => {
    const Icon = item.icon;
    const active = onProjects && mode === item.mode;
    const goalsActive = item.mode === 'goals' && activeGoals > 0;
    const followupsOpen = item.mode === 'followups' && openFollowUps > 0;
    const schedulerCount = item.mode === 'scheduler' && scheduleCount > 0;
    const terminalsRunning = item.mode === 'terminals' && runningTerminals > 0;
    let badge: ReactNode = null;
    if (goalsActive) {
      badge = (
        <CountBadge
          count={activeGoals}
          label={`${activeGoals} active goal${activeGoals === 1 ? '' : 's'}`}
          title={`${activeGoals} active goal${activeGoals === 1 ? '' : 's'}`}
          kind="running"
        />
      );
    } else if (followupsOpen) {
      badge = (
        <CountBadge
          count={openFollowUps}
          label={`${openFollowUps} open follow-up${openFollowUps === 1 ? '' : 's'}`}
          title={`${openFollowUps} open follow-up${openFollowUps === 1 ? '' : 's'}`}
          kind="running"
        />
      );
    } else if (schedulerCount) {
      badge = (
        <CountBadge
          count={scheduleCount}
          label={`${scheduleCount} schedule${scheduleCount === 1 ? '' : 's'}`}
          title={`${scheduleCount} schedule${scheduleCount === 1 ? '' : 's'} spawning in this project`}
        />
      );
    } else if (terminalsRunning) {
      badge = (
        <CountBadge
          count={runningTerminals}
          label={`${runningTerminals} terminal${runningTerminals === 1 ? '' : 's'} running`}
          title={`${runningTerminals} terminal${runningTerminals === 1 ? '' : 's'} running`}
          kind="running"
        />
      );
    }
    return (
      <NavRow
        label={item.label}
        icon={<Icon size={16} />}
        active={active}
        collapsed={collapsed}
        testId={`project-nav-${item.mode}`}
        onClick={click(() => selectMode(item.mode))}
        running={goalsActive || followupsOpen || terminalsRunning}
        badge={badge}
      />
    );
  };

  const renderModuleRow = (id: string) => {
    const m = projectTabModules.find((mod) => mod.id === id);
    if (!m) return null;
    const Icon = resolveIcon(m.projectTab?.icon ?? m.icon);
    const label = m.projectTab?.label ?? m.title;
    const extActive = resolveProjectTabModule(mode, [m])?.id === m.id;
    const active = onProjects && (mode === m.id || extActive);
    return (
      <NavRow
        label={label}
        icon={<Icon size={16} />}
        active={active}
        collapsed={collapsed}
        testId={`project-nav-${m.id}`}
        onClick={click(() => selectMode(m.id))}
      />
    );
  };

  const renderSortableItem = (id: string) => {
    if (id === 'suggestions') {
      return (
        <SortableNavItem key={id} id={id}>
          {renderSuggestions()}
        </SortableNavItem>
      );
    }
    const modeItem = modeItems.find((item) => item.mode === id);
    if (modeItem) {
      return (
        <SortableNavItem key={id} id={id}>
          {renderModeRow(modeItem)}
        </SortableNavItem>
      );
    }
    if (id === AGENTS_SECTION_SORT_ID) {
      return (
        <SortableSidebarSection key={id} id={id}>
          <AgentsSidebarSection
            projectId={project.id}
            onOpenDashboard={() => selectMode('agents')}
          />
        </SortableSidebarSection>
      );
    }
    const row = renderModuleRow(id);
    if (!row) return null;
    return (
      <SortableNavItem key={id} id={id}>
        {row}
      </SortableNavItem>
    );
  };

  return (
    <aside
      className={`sidebar sidebar--titlebar-controls project-scoped-nav ${
        isFocus ? 'project-focused-nav' : ''
      }`}
    >
      <div className="sidebar-chrome">
        <div className="sidebar-history-controls" aria-label={`${project.name} navigation history`}>
          <button
            type="button"
            aria-label={isFocus && onBack ? 'Back to all projects' : 'Go back'}
            title={isFocus && onBack ? 'Back to all projects' : 'Go back'}
            disabled={!(isFocus && onBack)}
            onClick={onBack}
          >
            <ChevronLeft size={19} />
          </button>
          <button type="button" aria-label="No next view" title="No next view" disabled>
            <ChevronRight size={19} />
          </button>
        </div>
      </div>

      {isFocus && onBack && (
        <button
          type="button"
          className="settings-app-back"
          onClick={onBack}
          aria-label="Back to all projects"
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Back
        </button>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        <div className="sidebar-sections">
          <nav
            className="sidebar-nav sidebar-nav--sortable"
            aria-label={`${project.name} navigation`}
            data-testid="sidebar-navigation"
          >
            {pinnedNavIds.map((id) =>
              id === 'inbox' ? <Fragment key={id}>{renderInbox()}</Fragment> : null
            )}
            <SortableContext items={sortableNavIds} strategy={verticalListSortingStrategy}>
              {sortableNavIds.map((id) => renderSortableItem(id))}
            </SortableContext>
          </nav>
        </div>
      </DndContext>

      <div className="sidebar-utility-bar" aria-label="Sidebar utilities">
        {isFocus && (
          <button
            type="button"
            className="sidebar-utility-button"
            title="Open this project in a new window"
            aria-label="Open this project in a new window"
            onClick={() => void window.cc.windows.openProject(project.id)}
          >
            <AppWindow size={18} />
          </button>
        )}
        <button
          type="button"
          className={`sidebar-utility-button ${nav === 'settings' ? 'active' : ''}`}
          aria-label="Settings"
          aria-current={nav === 'settings' ? 'page' : undefined}
          title="Settings"
          onClick={() => setNav('settings')}
        >
          <Settings size={18} />
        </button>
        {footerActions.map((action) => {
          const Icon = resolveIcon(action.icon);
          return (
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
              <Icon size={18} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
