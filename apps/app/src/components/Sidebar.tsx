import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  Blocks,
  Bot,
  Clock,
  Inbox,
  MessageCircleQuestion,
  Sparkles,
  SquarePen,
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
import { getNavRoutePath } from '../lib/route-paths.js';
import { hrefForPluginNavPanel } from '../plugins/plugin-nav-href.js';
import { useMergedModules } from '../modules/index.js';
import { useAppSettingsRouteMemory } from '../hooks/useAppSettingsRouteMemory.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { ProjectsList } from './listpane/ProjectsList.js';
import { PINNED_SIDEBAR_NAV_IDS, PROJECTS_SECTION_SORT_ID } from './sidebarNavOrder.js';
import {
  GLOBAL_NAV_ORDER_KEY
} from './sidebarSortable.js';
import {
  SidebarCountBadge,
  SidebarRail,
  type SidebarRailItem
} from './SidebarRail.js';
import { listNavPanels, subscribePluginSlots } from '../plugins/plugin-slots.js';

interface NavEntry {
  id: NavId;
  label: string;
  icon: LucideIcon;
}

const homeNavItem: NavEntry = { id: 'home', label: 'New Chat', icon: SquarePen };
const inboxNavItem: NavEntry = { id: 'inbox', label: 'Inbox', icon: Inbox };
const agentsNavItem: NavEntry = { id: 'agents', label: 'Agents', icon: Bot };
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
const extensionsNavItem: NavEntry = { id: 'extensions', label: 'Plugins', icon: Blocks };

export function Sidebar() {
  const route = useRouteState();
  const { nav, pluginPanelPath } = route;
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const unreadInbox = useUnreadInboxCount();
  const enabledSchedules = useEnabledSchedulerCount();
  const runningSchedules = useRunningSchedulerCount();
  const agentCounts = useAgentNavCounts();
  const suggestionsEnabled = useData((s) => s.suggestionsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  const routeMemory = useAppSettingsRouteMemory();
  const modules = useMergedModules();
  const navPanels = useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  const pluginIds = useMemo(
    () => new Set(navPanels.map((panel) => panel.pluginId)),
    [navPanels]
  );
  const pluginPanels = useMemo(
    () => navPanels.filter((panel) => panel.placement !== 'extensions'),
    [navPanels]
  );
  const extraItems = useMemo(() => {
    const extras: NavEntry[] = [];
    if (followUpsEnabled) extras.push(followupsNavItem);
    if (suggestionsEnabled) extras.push(suggestionsNavItem);
    return extras;
  }, [followUpsEnabled, suggestionsEnabled]);
  // Built-ins and legacy disk modules with a real panel keep a rail shortcut.
  // Plugin navPanels are listed separately so every path is reachable. A
  // plugin-app load error must not grow a fake panel — those stay off this list.
  const moduleNavItems: NavEntry[] = modules
    .filter((module) =>
      !!module.panel &&
      !('loadError' in module && (module as { loadError?: string }).loadError) &&
      module.placement !== 'settings' &&
      module.projectTab?.global !== false &&
      !pluginIds.has(module.id)
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
    const isAgents = item.id === 'agents';
    const running = (isScheduler && runningSchedules > 0) || (isAgents && agentCounts.active > 0);
    const scheduleTitle = `${runningSchedules} running · ${enabledSchedules} scheduled`;
    const agentsTitle =
      agentCounts.blocked > 0
        ? `${agentCounts.active} active · ${agentCounts.blocked} need you`
        : `${agentCounts.active} active`;
    let badge: ReactNode;
    if (showBadge) {
      badge = (
        <SidebarCountBadge
          count={unreadInbox}
          label={`${unreadInbox} unread`}
          title={`${unreadInbox} unread`}
        />
      );
    } else if (isScheduler && running) {
      badge = (
        <SidebarCountBadge
          count={runningSchedules}
          label={scheduleTitle}
          title={scheduleTitle}
          kind="running"
        />
      );
    } else if (isAgents && agentCounts.active > 0) {
      badge = (
        <SidebarCountBadge
          count={agentCounts.active}
          label={agentsTitle}
          title={agentsTitle}
          kind={agentCounts.blocked > 0 ? 'blocked' : 'running'}
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
          ? `${item.label} — ${isAgents ? agentsTitle : scheduleTitle}`
          : item.label
        : undefined
    };
  };

  const items: SidebarRailItem[] = [
    toRow(homeNavItem),
    toRow(inboxNavItem),
    ...extraItems.map(toRow),
    toRow(agentsNavItem),
    toRow(schedulerNavItem),
    toRow(extensionsNavItem),
    ...moduleNavItems.map(toRow),
    ...pluginPanels.map((panel): SidebarRailItem => {
      const path = panel.path ?? panel.id;
      const Icon = resolveIcon(panel.icon);
      const id = `${panel.pluginId}/${path}`;
      const active = nav === panel.pluginId && (pluginPanelPath === path || pluginPanelPath === null);
      return {
        kind: 'row',
        id,
        label: panel.title,
        icon: <Icon size={16} />,
        to: hrefForPluginNavPanel(panel.pluginId, path),
        testId: `nav-${id}`,
        active,
        title: collapsed ? panel.title : undefined
      };
    }),
    {
      kind: 'section',
      id: PROJECTS_SECTION_SORT_ID,
      node: <ProjectsList placement="sidebar" />
    }
  ];

  // The shell owns the single persistent toggle. Returning no rail removes the
  // navigation column while its fixed trigger stays available above the shell.
  if (collapsed) return null;

  return (
    <SidebarRail
      className="sidebar sidebar--global"
      data-sidebar="sidebar"
      navAriaLabel="Main navigation"
      storageKey={GLOBAL_NAV_ORDER_KEY}
      pinnedIds={PINNED_SIDEBAR_NAV_IDS}
      items={items}
    />
  );
}
