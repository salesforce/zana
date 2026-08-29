import { product } from '../lib/product-client.js';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  TerminalSquare,
  FolderTree,
  Clock,
  Target,
  MessageCircleQuestion,
  Activity,
  ArrowLeft,
  AppWindow,
  Sparkles,
  Bot,
  type LucideIcon
} from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  useData,
  useUi,
  useUnreadInboxCount,
  useAgentNavCounts,
  useProjectActiveGoalCount,
  useProjectOpenFollowUpCount,
  useProjectScheduleCount,
  useProjectRunningTerminalCount,
  type WorkspaceMode
} from '../store.js';
import { useProjectTabModules } from '../modules/index.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { resolveProjectTabModule } from '../lib/libraryPlugin.js';
import { useAppSettingsRouteMemory } from '../hooks/useAppSettingsRouteMemory.js';
import { useRouteState } from '../hooks/useRouteState.js';
import {
  getInboxRoutePath,
  getProjectWorkspaceRoutePath,
  getSuggestionsRoutePath
} from '../lib/route-paths.js';
import {
  PINNED_PROJECT_NAV_IDS,
  PROJECT_NAV_ORDER_KEY
} from './sidebarSortable.js';
import {
  SidebarCountBadge,
  SidebarRail,
  type SidebarRailItem
} from './SidebarRail.js';

/**
 * The left nav rail for a single-project FOCUSED VIEW. Replaces the global
 * {@link Sidebar} with the same chrome, flat destination list, utility dock,
 * and drag-and-drop reorder — only the destinations change (this project's
 * workspace modes instead of Home / Workspaces).
 *
 * Inbox is pinned (same as the global rail). Everything else, including
 * Agents, can be reordered and is persisted separately from the global sidebar.
 *
 * Inbox switches `nav`; workspace modes set `nav='projects'` + the project's
 * `workspaceMode`. Agents is an ordinary destination: it opens this project's
 * Agents board.
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
  { mode: 'agents', label: 'Agents', icon: Bot },
  { mode: 'feed', label: 'Feed', icon: Activity },
  { mode: 'terminals', label: 'Terminals', icon: TerminalSquare },
  { mode: 'explorer', label: 'Explorer', icon: FolderTree },
  { mode: 'scheduler', label: 'Scheduler', icon: Clock },
  { mode: 'goals', label: 'Goals', icon: Target },
  { mode: 'followups', label: 'Follow-ups', icon: MessageCircleQuestion }
];

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
  const route = useRouteState();
  const nav = route.nav;
  const isFocus = variant === 'focus';
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const goalsEnabled = useData((s) => s.goalsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  const suggestionsEnabled = useData((s) => s.suggestionsEnabled);
  const mode = route.workspaceMode ?? 'agents';
  const routeMemory = useAppSettingsRouteMemory();
  const navigate = useNavigate();
  const unreadInbox = useUnreadInboxCount();
  const agentCounts = useAgentNavCounts(project.id);
  const activeGoals = useProjectActiveGoalCount(project.id);
  const openFollowUps = useProjectOpenFollowUpCount(project.id);
  const scheduleCount = useProjectScheduleCount(project.id);
  const runningTerminals = useProjectRunningTerminalCount(project.id);
  const projectTabModules = useProjectTabModules();
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

  const handleBack = () => {
    useUi.getState().exitProjectFocus();
    onBack?.();
    void navigate(routeMemory.projectBackRoutePath);
  };

  const items: SidebarRailItem[] = [
    {
      kind: 'row',
      id: 'inbox',
      label: 'Inbox',
      icon: <Inbox size={16} />,
      to: getInboxRoutePath(),
      testId: 'project-nav-inbox',
      active: nav === 'inbox',
      title: 'Inbox for this project',
      badge:
        unreadInbox > 0 ? (
          <SidebarCountBadge
            count={unreadInbox}
            label={`${unreadInbox} unread`}
            title={`${unreadInbox} unread`}
          />
        ) : null
    },
    ...(suggestionsEnabled
      ? [
          {
            kind: 'row' as const,
            id: 'suggestions',
            label: 'Next Steps',
            icon: <Sparkles size={16} />,
            to: getSuggestionsRoutePath(),
            testId: 'project-nav-suggestions',
            active: nav === 'suggestions',
            title: 'Next Steps for this project'
          } satisfies SidebarRailItem
        ]
      : []),
    ...modeItems.map((item): SidebarRailItem => {
      const Icon = item.icon;
      const active = onProjects && mode === item.mode;
      const agentsLive = item.mode === 'agents' && agentCounts.active > 0;
      const goalsActive = item.mode === 'goals' && activeGoals > 0;
      const followupsOpen = item.mode === 'followups' && openFollowUps > 0;
      const schedulerCount = item.mode === 'scheduler' && scheduleCount > 0;
      const terminalsRunning = item.mode === 'terminals' && runningTerminals > 0;
      const agentsTitle =
        agentCounts.blocked > 0
          ? `${agentCounts.active} active · ${agentCounts.blocked} need you`
          : `${agentCounts.active} active`;
      let badge: ReactNode = null;
      if (agentsLive) {
        badge = (
          <SidebarCountBadge
            count={agentCounts.active}
            label={agentsTitle}
            title={agentsTitle}
            kind={agentCounts.blocked > 0 ? 'blocked' : 'running'}
          />
        );
      } else if (goalsActive) {
        badge = (
          <SidebarCountBadge
            count={activeGoals}
            label={`${activeGoals} active goal${activeGoals === 1 ? '' : 's'}`}
            title={`${activeGoals} active goal${activeGoals === 1 ? '' : 's'}`}
            kind="running"
          />
        );
      } else if (followupsOpen) {
        badge = (
          <SidebarCountBadge
            count={openFollowUps}
            label={`${openFollowUps} open follow-up${openFollowUps === 1 ? '' : 's'}`}
            title={`${openFollowUps} open follow-up${openFollowUps === 1 ? '' : 's'}`}
            kind="running"
          />
        );
      } else if (schedulerCount) {
        badge = (
          <SidebarCountBadge
            count={scheduleCount}
            label={`${scheduleCount} schedule${scheduleCount === 1 ? '' : 's'}`}
            title={`${scheduleCount} schedule${scheduleCount === 1 ? '' : 's'} spawning in this project`}
          />
        );
      } else if (terminalsRunning) {
        badge = (
          <SidebarCountBadge
            count={runningTerminals}
            label={`${runningTerminals} terminal${runningTerminals === 1 ? '' : 's'} running`}
            title={`${runningTerminals} terminal${runningTerminals === 1 ? '' : 's'} running`}
            kind="running"
          />
        );
      }
      return {
        kind: 'row',
        id: item.mode,
        label: item.label,
        icon: <Icon size={16} />,
        to: getProjectWorkspaceRoutePath(project.id, item.mode),
        testId: `project-nav-${item.mode}`,
        active,
        running: agentsLive || goalsActive || followupsOpen || terminalsRunning,
        badge
      };
    }),
    ...projectTabModules.map((m): SidebarRailItem => {
      const Icon = resolveIcon(m.projectTab?.icon ?? m.icon);
      const label = m.projectTab?.label ?? m.title;
      const extActive = resolveProjectTabModule(mode, [m])?.id === m.id;
      return {
        kind: 'row',
        id: m.id,
        label,
        icon: <Icon size={16} />,
        to: getProjectWorkspaceRoutePath(project.id, m.id),
        testId: `project-nav-${m.id}`,
        active: onProjects && (mode === m.id || extActive)
      };
    })
  ];

  return (
    <SidebarRail
      className={`sidebar sidebar--titlebar-controls project-scoped-nav ${
        isFocus ? 'project-focused-nav' : ''
      }`}
      navAriaLabel={`${project.name} navigation`}
      storageKey={PROJECT_NAV_ORDER_KEY}
      pinnedIds={PINNED_PROJECT_NAV_IDS}
      items={items}
      header={
        isFocus ? (
          <button
            type="button"
            className="settings-app-back"
            onClick={handleBack}
            aria-label="Back to all projects"
          >
            <ArrowLeft size={17} aria-hidden="true" />
            Back
          </button>
        ) : null
      }
      utilityStart={
        isFocus ? (
          <button
            type="button"
            className="sidebar-utility-button"
            title="Open this project in a new window"
            aria-label="Open this project in a new window"
            onClick={() => void product.windows.openProject(project.id)}
          >
            <AppWindow size={18} />
          </button>
        ) : null
      }
    />
  );
}
