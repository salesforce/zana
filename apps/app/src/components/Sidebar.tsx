import { useMemo, type ReactNode } from 'react';
import {
  Blocks,
  Clock,
  House,
  Inbox,
  MessageCircleQuestion,
  Sparkles,
  type LucideIcon
} from 'lucide-react';
import {
  useUi,
  useData,
  useUnreadInboxCount,
  useEnabledSchedulerCount,
  useRunningSchedulerCount,
  type NavId
} from '../store.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { getNavRoutePath } from '../lib/route-paths.js';
import { useMergedModules } from '../modules/index.js';
import { useAppSettingsRouteMemory } from '../hooks/useAppSettingsRouteMemory.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { AgentsSidebarSection } from './AgentsSidebarSection.js';
import { ProjectsList } from './listpane/ProjectsList.js';
import { PINNED_SIDEBAR_NAV_IDS } from './sidebarNavOrder.js';
import {
  AGENTS_SECTION_SORT_ID,
  GLOBAL_NAV_ORDER_KEY,
  WORKSPACES_SECTION_SORT_ID
} from './sidebarSortable.js';
import {
  SidebarCountBadge,
  SidebarRail,
  type SidebarRailItem
} from './SidebarRail.js';

interface NavEntry {
  id: NavId;
  label: string;
  icon: LucideIcon;
}

const homeNavItem: NavEntry = { id: 'home', label: 'Home', icon: House };
const inboxNavItem: NavEntry = { id: 'inbox', label: 'Inbox', icon: Inbox };
const schedulerNavItem: NavEntry = { id: 'scheduler', label: 'Scheduler', icon: Clock };

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

export function Sidebar() {
  const { nav } = useRouteState();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const unreadInbox = useUnreadInboxCount();
  const enabledSchedules = useEnabledSchedulerCount();
  const runningSchedules = useRunningSchedulerCount();
  const suggestionsEnabled = useData((s) => s.suggestionsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  const routeMemory = useAppSettingsRouteMemory();
  const modules = useMergedModules();
  const extraItems = useMemo(() => {
    const extras: NavEntry[] = [];
    if (followUpsEnabled) extras.push(followupsNavItem);
    if (suggestionsEnabled) extras.push(suggestionsNavItem);
    return extras;
  }, [followUpsEnabled, suggestionsEnabled]);
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

  const toRow = (item: NavEntry): SidebarRailItem => {
    const Icon = item.icon;
    const showBadge = item.id === 'inbox' && unreadInbox > 0;
    // Scheduler badge only appears when a scheduled agent is running right now;
    // it shows that live count in gold and adds a pulsing dot on the icon so
    // the "running" state reads at a glance. An armed-but-idle schedule shows
    // no badge.
    const isScheduler = item.id === 'scheduler';
    const running = isScheduler && runningSchedules > 0;
    const scheduleTitle = `${runningSchedules} running · ${enabledSchedules} scheduled`;
    let badge: ReactNode;
    if (showBadge) {
      badge = (
        <SidebarCountBadge
          count={unreadInbox}
          label={`${unreadInbox} unread`}
          title={`${unreadInbox} unread`}
        />
      );
    } else if (running) {
      badge = (
        <SidebarCountBadge
          count={runningSchedules}
          label={scheduleTitle}
          title={scheduleTitle}
          kind="running"
        />
      );
    }
    return {
      kind: 'row',
      id: item.id,
      label: item.label,
      icon: <Icon size={16} />,
      to: item.id === 'extensions' ? routeMemory.toolsRoutePath : getNavRoutePath(item.id),
      testId: `nav-${item.id}`,
      active: nav === item.id,
      running,
      badge,
      title: collapsed
        ? running
          ? `${item.label} — ${scheduleTitle}`
          : item.label
        : undefined
    };
  };

  const items: SidebarRailItem[] = [
    toRow(homeNavItem),
    toRow(inboxNavItem),
    ...extraItems.map(toRow),
    toRow(schedulerNavItem),
    toRow(extensionsNavItem),
    ...moduleNavItems.map(toRow),
    {
      kind: 'section',
      id: AGENTS_SECTION_SORT_ID,
      node: <AgentsSidebarSection />
    },
    {
      kind: 'section',
      id: WORKSPACES_SECTION_SORT_ID,
      node: <ProjectsList placement="sidebar" />
    }
  ];

  // The shell owns the single persistent toggle. Returning no rail removes the
  // navigation column while its fixed trigger stays available above the shell.
  if (collapsed) return null;

  return (
    <SidebarRail
      className="sidebar sidebar--global"
      navAriaLabel="Main navigation"
      storageKey={GLOBAL_NAV_ORDER_KEY}
      pinnedIds={PINNED_SIDEBAR_NAV_IDS}
      items={items}
    />
  );
}
