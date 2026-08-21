import { useEffect } from 'react';
import {
  Inbox,
  Bot,
  TerminalSquare,
  FolderTree,
  Clock,
  Target,
  MessageCircleQuestion,
  Activity,
  ChevronLeft,
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
  useAgentNavCounts,
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
import { AgentTray } from './AgentTray.js';

/**
 * The left nav rail for a single-project FOCUSED VIEW. Replaces the global
 * {@link Sidebar} — whose destinations (cross-project Agents/Projects/Scheduler/
 * …) don't apply when the shell is locked to one project. Instead it surfaces
 * exactly the views that make sense for one project, promoting the workspace
 * modes (which are horizontal tabs in the main window's Workspace) to
 * first-class rail entries:
 *
 *   Filtered Inbox · Agents · Terminals · Explorer · Feed · Goals · Follow-ups
 *
 * Inbox switches `nav`; the workspace modes set `nav='projects'` + the
 * project's `workspaceMode`, which the Workspace already renders from. Reuses
 * the global rail's `.sidebar` / `.nav-item` styles so the macOS traffic-light
 * gutter stays backstopped (a zero-width nav column broke the layout before).
 *
 * Two variants, same rail:
 * - `'window'` — a PER-PROJECT WINDOW (opened "in a new window"). The window is
 *   hard-locked to the project (URL scope); there is no "back", and global
 *   destinations live in that window's own chrome / the main window.
 * - `'focus'` — the MAIN WINDOW drilled into a project (`focusedProjectId`).
 *   Adds a "← Projects" back button (calls {@link onBack}) so the user can
 *   return to the cross-project home, plus a slim global footer (Settings,
 *   Inbox) so nothing is ever trapped behind the back button.
 */

interface ModeItem {
  mode: WorkspaceMode;
  label: string;
  icon: LucideIcon;
}

// Order: Feed first, then Agents, then the rest.
const MODE_ITEMS: ModeItem[] = [
  { mode: 'feed', label: 'Feed', icon: Activity },
  { mode: 'agents', label: 'Agents', icon: Bot },
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
   *  into a project. `'focus'` shows the back button + global footer. */
  variant?: 'window' | 'focus';
  /** Return to the cross-project home. Only used in the `'focus'` variant. */
  onBack?: () => void;
}) {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);
  const isFocus = variant === 'focus';
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  // Goals + Follow-ups are opt-in experimental features (Settings › Experimental),
  // mirroring the global rail's Teams gating. Off ⇒ their tabs are hidden.
  const goalsEnabled = useData((s) => s.goalsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  // Next Steps is opt-in like the global rail's entry. When on, it appears as a
  // top-level scoped destination (an action launcher, not a project data mode),
  // filtered to this project — the useSuggestions slice is already scoped by the
  // window (init fetch + push filter keyed on getScopedProjectId).
  const suggestionsEnabled = useData((s) => s.suggestionsEnabled);
  // The global shell owns collapse state and the one persistent trigger. This
  // rail only uses the value to shorten accessible names while it is animating
  // out of the shell.
  const collapsed = useUi((s) => s.sidebarCollapsed);
  // Terminals is the default when the project has no explicit mode yet —
  // mirror Workspace's `?? 'terminals'` so the rail's active state agrees.
  const mode = useUi((s) => s.workspaceMode[project.id]) ?? 'terminals';
  const unreadInbox = useUnreadInboxCount();
  // Scope the Agents badge to THIS project — the rail heads a per-project Agents
  // board, so the badge must count only this project's agents (a per-project
  // window already scopes via the URL lock; passing the id also narrows the
  // main-window focus variant, which the URL lock doesn't cover).
  const agentCounts = useAgentNavCounts(project.id);
  const activeGoals = useProjectActiveGoalCount(project.id);
  const openFollowUps = useProjectOpenFollowUpCount(project.id);
  const scheduleCount = useProjectScheduleCount(project.id);
  // Live plain-shell terminals (not agents) for this project — backs the
  // Terminals tab's "still running" badge.
  const runningTerminals = useProjectRunningTerminalCount(project.id);
  // Extension-contributed project tabs — generic, no extension named here.
  const projectTabModules = useProjectTabModules();

  const onProjects = nav === 'projects';

  // Hide the experimental modes when their feature flag is off. Filtering the
  // rail alone isn't enough: a project could already be parked on `goals`/
  // `followups` (persisted workspaceMode) when the flag flips off, which would
  // render a hidden mode's panel with no way back. Bounce it to `terminals`.
  const modeItems = MODE_ITEMS.filter(
    (item) =>
      (item.mode !== 'goals' || goalsEnabled) &&
      (item.mode !== 'followups' || followUpsEnabled)
  );
  useEffect(() => {
    if ((mode === 'goals' && !goalsEnabled) || (mode === 'followups' && !followUpsEnabled)) {
      setWorkspaceMode(project.id, 'terminals');
    }
  }, [mode, goalsEnabled, followUpsEnabled, project.id, setWorkspaceMode]);

  const selectMode = (m: ProjectView) => {
    setNav('projects');
    setWorkspaceMode(project.id, m);
  };

  return (
    <aside className={`sidebar project-scoped-nav ${isFocus ? 'project-focused-nav' : ''}`}>
      {/* The focused project, in the brand slot — sits at the very top of the
          rail (above the "← Projects" back button) so the rail leads with WHERE
          you are, then offers the way out, matching the global Sidebar's
          brand-first architecture. Its top padding clears the macOS traffic
          lights. */}
      <div className="brand">
        <div
          className="brand-avatar brand-avatar-text"
          style={project.color ? { background: project.color } : undefined}
          aria-hidden="true"
        >
          {project.name.trim().slice(0, 2).toUpperCase()}
        </div>
        <div className="brand-copy">
          <div className="brand-name" title={project.path}>
            {project.name}
          </div>
          <div className="brand-subtitle">Project workspace</div>
        </div>
      </div>

      {/* "← Projects" back button — focus variant only, directly under the
          brand. Returns the main window to the cross-project home. A per-project
          window is hard-locked, so it has no "back" (the window itself is the
          scope). */}
      {isFocus && onBack && (
        <button
          type="button"
          className="nav-item project-focused-back"
          onClick={onBack}
          title="Back to all projects"
          aria-label="Back to all projects"
        >
          <span className="nav-item-icon">
            <ChevronLeft size={16} />
          </span>
          <span className="nav-item-label">Projects</span>
        </button>
      )}

      <nav
        className="sidebar-nav"
        aria-label={`${project.name} navigation`}
        data-testid="sidebar-navigation"
      >
        <div className="nav-section" role="group" aria-label="Project">
          <div className="nav-section-label">Project</div>
          <button
            className={`nav-item ${nav === 'inbox' ? 'active' : ''}`}
            onClick={() => setNav('inbox')}
            aria-current={nav === 'inbox' ? 'page' : undefined}
            aria-label={collapsed ? 'Inbox' : undefined}
            title="Inbox for this project"
          >
            <span className="nav-item-icon">
              <Inbox size={16} />
            </span>
            <span className="nav-item-label">Inbox</span>
            {unreadInbox > 0 && (
              <span className="nav-badge" aria-label={`${unreadInbox} unread`} title={`${unreadInbox} unread`}>
                {unreadInbox > 99 ? '99+' : unreadInbox}
              </span>
            )}
          </button>

          {suggestionsEnabled && (
            <button
              className={`nav-item ${nav === 'suggestions' ? 'active' : ''}`}
              onClick={() => setNav('suggestions')}
              aria-current={nav === 'suggestions' ? 'page' : undefined}
              aria-label={collapsed ? 'Next Steps' : undefined}
              title="Next Steps for this project"
            >
              <span className="nav-item-icon">
                <Sparkles size={16} />
              </span>
              <span className="nav-item-label">Next Steps</span>
            </button>
          )}
        </div>

        <div className="nav-section nav-section--separated" role="group" aria-label="Workspace">
          <div className="nav-section-label">Workspace</div>
          {modeItems.map((item) => {
            const Icon = item.icon;
            const active = onProjects && mode === item.mode;
            const agentsActive = item.mode === 'agents' && agentCounts.active > 0;
            const agentsBlocked = item.mode === 'agents' && agentCounts.blocked > 0;
            const goalsActive = item.mode === 'goals' && activeGoals > 0;
            const followupsOpen = item.mode === 'followups' && openFollowUps > 0;
            const schedulerCount = item.mode === 'scheduler' && scheduleCount > 0;
            const terminalsRunning = item.mode === 'terminals' && runningTerminals > 0;
            return (
              <button
                key={item.mode}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => selectMode(item.mode)}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={item.label}
              >
                <span className="nav-item-icon">
                  <Icon size={16} />
                  {(agentsActive || goalsActive || followupsOpen || terminalsRunning) && (
                    <span className="nav-running-dot" aria-hidden="true" />
                  )}
                </span>
                <span className="nav-item-label">{item.label}</span>
                {agentsActive && (
                  <span
                    className={`nav-badge ${agentsBlocked ? 'nav-badge--blocked' : 'nav-badge--running'}`}
                    aria-label={`${agentCounts.active} active`}
                    title={
                      agentsBlocked
                        ? `${agentCounts.active} active · ${agentCounts.blocked} need you`
                        : `${agentCounts.active} active`
                    }
                  >
                    {agentCounts.active > 99 ? '99+' : agentCounts.active}
                  </span>
                )}
                {goalsActive && (
                  <span
                    className="nav-badge nav-badge--running"
                    aria-label={`${activeGoals} active goal${activeGoals === 1 ? '' : 's'}`}
                    title={`${activeGoals} active goal${activeGoals === 1 ? '' : 's'}`}
                  >
                    {activeGoals > 99 ? '99+' : activeGoals}
                  </span>
                )}
                {followupsOpen && (
                  <span
                    className="nav-badge nav-badge--running"
                    aria-label={`${openFollowUps} open follow-up${openFollowUps === 1 ? '' : 's'}`}
                    title={`${openFollowUps} open follow-up${openFollowUps === 1 ? '' : 's'}`}
                  >
                    {openFollowUps > 99 ? '99+' : openFollowUps}
                  </span>
                )}
                {schedulerCount && (
                  <span
                    className="nav-badge"
                    aria-label={`${scheduleCount} schedule${scheduleCount === 1 ? '' : 's'}`}
                    title={`${scheduleCount} schedule${scheduleCount === 1 ? '' : 's'} spawning in this project`}
                  >
                    {scheduleCount > 99 ? '99+' : scheduleCount}
                  </span>
                )}
                {terminalsRunning && (
                  <span
                    className="nav-badge nav-badge--running"
                    aria-label={`${runningTerminals} terminal${runningTerminals === 1 ? '' : 's'} running`}
                    title={`${runningTerminals} terminal${runningTerminals === 1 ? '' : 's'} running`}
                  >
                    {runningTerminals > 99 ? '99+' : runningTerminals}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Extension-contributed project tabs, under their own "Extensions"
            heading so they read as extensions rather than core modes — mirrors
            the global Sidebar's Extensions group (hairline rule + label, label
            hidden on the collapsed rail). Each selects mode = the module id,
            which the Workspace renders as that extension's panel scoped to this
            project. */}
        {projectTabModules.length > 0 && (
          <div className="nav-section nav-section--separated" role="group" aria-label="Extensions">
            <div className="nav-section-label">Extensions</div>
            {projectTabModules.map((m) => {
              const Icon = resolveIcon(m.projectTab?.icon ?? m.icon);
              const label = m.projectTab?.label ?? m.title;
              const extActive = resolveProjectTabModule(mode, [m])?.id === m.id;
              const active = onProjects && (mode === m.id || extActive);
              return (
                <button
                  key={m.id}
                  className={`nav-item ${active ? 'active' : ''}`}
                  onClick={() => selectMode(m.id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? label : undefined}
                  title={label}
                >
                  <span className="nav-item-icon">
                    <Icon size={16} />
                  </span>
                  <span className="nav-item-label">{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </nav>

      {/* Slim global footer — focus variant only. Keeps the system-level
           destination reachable in one click so "focused" never means "trapped":
          Settings jumps straight to the global panel WITHOUT leaving focus
          (`focusedProjectId` stays set, so this rail stays mounted and the back
          button is still there to return home). Inbox already has a dedicated
          rail item above (and the titlebar bell), so it isn't duplicated here. A
          per-project window omits this footer — those destinations belong to the
          main window. */}
        {isFocus && (
          <div className="project-focused-footer">
            <div className="nav-section-label">System</div>
            {/* Pop this project out into its own dedicated window. Focus variant
               only — a per-project window is already its own window, so there's
               nothing to pop out (mirrors the old ListPane header affordance the
               project-focus nav replaced). */}
            <button
              className="nav-item"
              onClick={() => void window.cc.windows.openProject(project.id)}
              title="Open this project in a new window"
              aria-label="Open this project in a new window"
            >
              <span className="nav-item-icon">
                <AppWindow size={16} />
              </span>
              <span className="nav-item-label">Open in new window</span>
            </button>
            <button
              className={`nav-item ${nav === 'settings' ? 'active' : ''}`}
              onClick={() => setNav('settings')}
              aria-current={nav === 'settings' ? 'page' : undefined}
              aria-label={collapsed ? 'Settings' : undefined}
              title="Settings"
            >
              <span className="nav-item-icon">
                <Settings size={16} />
              </span>
              <span className="nav-item-label">Settings</span>
            </button>
          </div>
        )}

      {/* Running / needs-you agents for THIS project, pinned to the bottom of
          the rail — same tray as the global Sidebar, scoped to the focused
          project so a drilled-in user still sees "needs you" without leaving.
          Renders nothing when no agent is active, so it never takes space idle. */}
      <AgentTray projectId={project.id} />
    </aside>
  );
}
