import { useMemo, useState } from 'react';
import {
  BarChart3,
  Blocks,
  Bot,
  Clock,
  Compass,
  Drama,
  FolderGit2,
  House,
  Inbox,
  Library,
  MessageCircleQuestion,
  Sparkles,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
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
import zanaMark from '../assets/zana-mark.svg';
import zanaMarkLight from '../assets/zana-mark-light.svg';
import { useMergedModules } from '../modules';
import { getHost } from '../modules/ModulePanelHost';
import { AgentTray } from './AgentTray';
import type { AppModule } from '@shared/module-api';
import { useShallow } from 'zustand/react/shallow';

interface NavEntry {
  id: NavId;
  label: string;
  icon: LucideIcon;
  /**
   * Pre-evaluated extension nav badge (from `AppModule.navBadge`). Only set for
   * app-module entries that declare one. A number, a short string, or
   * null/0/'' for no badge.
   */
  moduleBadge?: number | string | null;
}

/**
 * Evaluate a merged module's `navBadge(host)` safely. V1 simplicity: this runs
 * on every Sidebar render. Extensions with cache-backed badges call
 * `host.cache.refreshBadge()` after updating that cache, which bumps the UI
 * store revision Sidebar subscribes to below.
 *
 * A throwing or absent factory yields no badge — it never breaks the rail.
 */
function evalModuleBadge(m: { id: string; navBadge?: (host: ReturnType<typeof getHost>) => number | string | null }): number | string | null {
  if (!m.navBadge) return null;
  try {
    return m.navBadge(getHost(m.id));
  } catch {
    return null;
  }
}

/**
 * Whether a merged app-module earns a sidebar (Extensions-group) rail entry. A
 * module qualifies only when it is NOT `placement: 'settings'` AND actually
 * contributes a renderer surface — a `panel`, `commands`, or a `navBadge`. A
 * module with none (e.g. the dissolved Zana manifest) would otherwise show a
 * ghost nav entry that mounts ModulePanelHost's empty "no view" card. Generic
 * capability check — no module-id literal (Rule 6). `commands` / `navBadge` are
 * factories; a presence check tests *declaration*, the right semantics (a
 * momentarily-null badge keeps its rail entry).
 *
 * A `projectTab` module KEEPS its global sidebar entry by default (the
 * cross-project view of the tool) AND ALSO surfaces as a per-project tab — two
 * different scopes of the same panel: the sidebar entry is global
 * (host.getScopedProjectId() === null) while the project tab is filtered to one
 * project (the project-tab mount overrides getScopedProjectId()). The extension
 * decides what "scoped" means; core just exposes both surfaces.
 *
 * The one exception: a module that declares `projectTab.global === false` is
 * project-tab ONLY — its data has no meaningful cross-project view, so it is
 * excluded here and surfaces solely from a project's tab strip. Generic: this
 * reads the manifest flag, never an extension id (Rule 6).
 */
export function contributesSurface(m: AppModule): boolean {
  if (m.placement === 'settings') return false;
  if (m.projectTab && m.projectTab.global === false) return false;
  return !!(m.panel || m.commands || m.navBadge);
}

const coreNavItems: NavEntry[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'scheduler', label: 'Scheduler', icon: Clock },
  { id: 'personas', label: 'Personas', icon: Drama },
  { id: 'squads', label: 'Squads', icon: Users }
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
const usageNavItem: NavEntry = { id: 'usage', label: 'Usage', icon: BarChart3 };
const extensionsNavItem: NavEntry = { id: 'extensions', label: 'Extensions', icon: Blocks };
const settingsNavItem: NavEntry = { id: 'settings', label: 'Settings', icon: Settings };
// The full cross-project library (durable docs: findings/decisions/ideas/etc,
// Global + every project) — a content/discovery destination like Extensions,
// so it earns its own system-level rail entry rather than living only inside
// a project's left rail (ProjectScopedNav keeps its own project-scoped entry).
const libraryNavItem: NavEntry = { id: 'library', label: 'Library', icon: Library };

export function Sidebar() {
  const nav = useUi((s) => s.nav);
  // Cache mutations are intentionally not reactive. This revision lets an
  // extension request a badge-only Sidebar render after it updates its cache.
  useUi((s) => s.moduleBadgeRevision);
  const setNav = useUi((s) => s.setNav);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const unreadInbox = useUnreadInboxCount();
  const enabledSchedules = useEnabledSchedulerCount();
  const runningSchedules = useRunningSchedulerCount();
  const agentCounts = useAgentNavCounts();
  const theme = useData((s) => s.theme);
  const suggestionsEnabled = useData((s) => s.suggestionsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  const navItems = useMemo(() => {
    const items = [...coreNavItems];
    if (suggestionsEnabled) items.splice(2, 0, suggestionsNavItem);
    if (followUpsEnabled) items.splice(2, 0, followupsNavItem);
    return items;
  }, [suggestionsEnabled, followUpsEnabled]);

  // App modules (built-in plugins/* + runtime-loaded extensions) contribute
  // their own nav entries, grouped under an "Extensions" heading to set them
  // apart from the core tool. Built-ins and runtime extensions are treated
  // identically here; the merged set is reactive so a discovered extension's
  // nav appears (and a disabled one disappears) without a reload.
  const modules = useMergedModules();
  // Modules placed in Settings render as a Settings sub-section (not the
  // sidebar); a module also needs a real renderer surface to earn a rail
  // entry. See `contributesSurface` — the dissolved Zana manifest (no panel /
  // commands / navBadge) is correctly excluded, avoiding a ghost nav entry.
  const moduleNavItems: NavEntry[] = modules
    .filter(contributesSurface)
    .map((m) => ({
      id: m.id,
      label: m.title,
      icon: resolveIcon(m.icon),
      moduleBadge: evalModuleBadge(m)
    }));

  const renderNavItem = (item: NavEntry) => {
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
    // Extension-contributed badge (AppModule.navBadge), pre-evaluated when the
    // module nav entries were built. Distinct from the core inbox/scheduler
    // badges above, which are gated on their own ids — a module id never
    // collides with 'inbox'/'scheduler', so this can't disturb them.
    const moduleBadge = item.moduleBadge;
    const showModuleBadge =
      moduleBadge != null && moduleBadge !== 0 && moduleBadge !== '';
    const moduleBadgeText =
      typeof moduleBadge === 'number'
        ? moduleBadge > 99
          ? '99+'
          : String(moduleBadge)
        : String(moduleBadge);
    return (
      <button
        key={item.id}
        // Stable e2e hook (inert in prod — a plain data attr): the UI-driven
        // specs click nav entries by id (`nav-agents`, `nav-projects`, …).
        data-testid={`nav-${item.id}`}
        className={`nav-item ${nav === item.id ? 'active' : ''}`}
        onClick={() => {
          // Clicking the top-level Projects rail item always returns to the
          // un-focused home (the cross-project Agents board + project list),
          // never staying drilled into / highlighting the last project.
          if (item.id === 'projects') {
            useUi.getState().exitProjectFocus();
            useUi.getState().selectProject(null);
          }
          setNav(item.id);
        }}
        aria-current={nav === item.id ? 'page' : undefined}
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
        {showModuleBadge && (
          <span
            className="nav-badge"
            aria-label={`${moduleBadgeText} for ${item.label}`}
            title={`${moduleBadgeText} for ${item.label}`}
          >
            {moduleBadgeText}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <img
          className="brand-avatar"
          src={theme === 'light' ? zanaMarkLight : zanaMark}
          alt=""
          aria-hidden="true"
        />
        <div className="brand-name">Zana</div>
        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div>
        {navItems.map((item) => (
          <div key={item.id}>
            {renderNavItem(item)}
          </div>
        ))}

        {/* App modules (plugins/*) sit under their own heading so it's clear
         * they're extensions rather than part of the core tool. Each section
         * break is a hairline rule; a label sits below the rule when the group
         * has a name. The label is hidden on the collapsed rail (the rule
         * stands in for it there). */}
        {moduleNavItems.length > 0 && (
          <div className="nav-section">
            <div className="nav-divider" role="separator" />
            <div className="nav-section-label">Extensions</div>
            {moduleNavItems.map(renderNavItem)}
          </div>
        )}

        {/* Usage + Extensions + Settings are system-level, below the same
         * hairline rule. Usage is a cross-project analytics dashboard (not
         * per-project content), so it sits here rather than in the core content
         * group above. Extensions is the browse/install front door (its own
         * top-level view); Settings holds configuration (Plugins / Skills / MCP
         * live as tabs there, as does the per-extension versions & settings
         * section). */}
        <div className="nav-divider" role="separator" />
        {renderNavItem(libraryNavItem)}
        {renderNavItem(usageNavItem)}
        {renderNavItem(extensionsNavItem)}
        {renderNavItem(settingsNavItem)}
      </div>

      {/* Running / needs-you agents, pinned to the bottom of the rail. Renders
       * nothing when no agent is active, so it never takes space idle. */}
      <AgentTray />
    </aside>
  );
}
