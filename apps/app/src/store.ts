import { create } from 'zustand';
import type {
  AgentState,
  AgentRecord,
  AgentMessage,
  AppConfig,
  SubagentChild,
  Project,
  CloneProjectResult,
  Result,
  TerminalSession,
  LaunchProfileId,
  ClaudeSessionSummary,
  GitStatus,
  IdleTriageResult,
  CatchUpSummaryResult,
  OverseerActivity,
  InboxEntry,
  Suggestion,
  InboxDigest,
  DetailedInboxDigest,
  LibraryDoc,
  McpServerEntry,
  PluginEntry,
  SavedRecord,
  SavedRecordInput,
  ScheduledTask,
  ScheduleTemplate,
  ScheduleGroup,
  Goal,
  FollowUp,
  Persona,
  AutonomousRun,
  Team,
  UpdateProgress,
  UpdateStatus,
  ReleaseNote,
  SetupStatus,
  DependencyProgress,
  HarnessVerifyResult,
  EditorVerifyResult,
  OpenTarget
} from '@zana-ai/zcc-domain/product';
import { DEFAULT_TERMINAL_THEME, type TerminalThemeId } from '@zana-ai/zcc-domain/terminal-themes';
import { seedPromptArgs } from '@zana-ai/zcc-domain/launch-provider';
import type { UsageSummary } from '@zana-ai/zcc-domain/telemetry-events';
import { resolveRestartProfile } from './lib/sessionRestore.js';
import { getScopedProjectId, isScopedWindow } from './lib/windowScope.js';
import { appNavigate } from './lib/app-navigate.js';
import { hasDesktopBridge } from './lib/app-surface.js';
import { product } from './lib/product-client.js';
import { prefetchThreadModelCatalog, reloadThreadModelCatalog } from './components/thread/pickers/thread-model-catalog.js';
import { decodeRoutePath } from './lib/decode-route.js';
import {
  getExtensionsTabRoutePath,
  getFollowUpsRoutePath,
  getNavRoutePath,
  getPluginDetailRoutePath,
  getProjectSettingsRoutePath,
  getProjectWorkspaceRoutePath,
  getSchedulerRoutePath,
  getSettingsTabRoutePath
} from './lib/route-paths.js';
import {
  findProjectIdForSession,
  hasMissingSetup,
  pruneInboxMarkers,
  useAgentMesh,
  useAgentStatus,
  useAutonomousRuns,
  useCatchUpSummary,
  useFollowUps,
  useGoals,
  useIdleTriage,
  useInbox,
  useLibrary,
  useMcpCatalogue,
  useOverseerActivity,
  usePersonas,
  usePlugins,
  useSaved,
  useScheduleGroups,
  useScheduler,
  useScheduleTemplates,
  useSetup,
  useSubagentChildren,
  useSubagents,
  useSuggestions,
  useTeams,
  useUpdateBanner,
  useUpdates,
  useWhatsNew
} from './stores/live.js';

/**
 * localStorage key for the sidebar-collapsed preference. A per-project window
 * gets its OWN key (suffixed by project id) so collapsing its rail doesn't bleed
 * into the main window's global sidebar (they share one origin → one localStorage).
 */
function sidebarCollapsedKey(): string {
  const scoped = getScopedProjectId();
  return scoped ? `zcc.sidebarCollapsed.${scoped}` : 'zcc.sidebarCollapsed';
}

/** Built-in nav destinations. App modules (plugins/*) add their own ids. */
export type CoreNavId =
  | 'home'
  | 'projects'
  | 'agents'
  | 'inbox'
  | 'suggestions'
  | 'scheduler'
  | 'goals'
  | 'followups'
  | 'extensions'
  | 'settings';

/**
 * Runtime set of the built-in nav destinations, kept in lockstep with the
 * `CoreNavId` union above (`Set<CoreNavId>` rejects a non-core id; a
 * completeness guard test asserts every union member is present). Used to tell
 * a core nav from an app-module nav at runtime — e.g. the dangling-nav guard in
 * `App.tsx` bounces home only when `nav` is neither a core id nor a
 * currently-loaded module id (a removed/disabled extension).
 */
export const CORE_NAV_IDS = new Set<CoreNavId>([
  'home',
  'projects',
  'agents',
  'inbox',
  'suggestions',
  'scheduler',
  'goals',
  'followups',
  'extensions',
  'settings'
]);

/**
 * A nav destination: a core panel or an app-module id. The `string & {}`
 * arm keeps autocomplete for the known ids while allowing module ids
 * (resolved at runtime from the module registry) without a hard import.
 */
export type NavId = CoreNavId | (string & {});

/**
 * Active Settings sub-section. The fixed core tabs plus any settings-placed
 * module's id (`AppModule.placement === 'settings'`).
 * `'personas' | 'squads' | 'usage'` are the remaining configuration catalogues
 * (Plugins / Skills / MCP live on the top-level Extensions workspace).
 * `(string & {})` keeps the core literals in autocomplete while allowing a
 * module id.
 */
export type SettingsTab =
  | 'global'
  | 'terminal'
  | 'agents'
  | 'harness'
  | 'editor'
  | 'project'
  | 'prompts'
  | 'personas'
  | 'squads'
  | 'usage'
  | 'experimental'
  | 'about'
  | 'machines'
  | 'connectivity'
  | 'inbox'
  | (string & {});

/** The focused top-level Extensions workspace page. */
export type ExtensionsTab = 'marketplace' | 'installed' | 'skills' | 'mcp';

export interface Toast {
  id: string;
  message: string;
  kind?: 'info' | 'error';
}

/**
 * W1-5 host UX primitives: a host-rendered dialog/affordance an extension
 * requested via `host.confirm/quickPick/prompt/alert/withProgress` (renderer
 * side) OR a MAIN module requested via `ctx.host.confirm/alert` (which arrives
 * over the `hostCommand` channel and resolves back to main). Queued here and
 * drawn by `<HostDialogs />`; each carries a renderer-only `resolve` callback
 * (never serialized) the dialog invokes with the user's answer, then the entry
 * is dropped. `withProgress` additionally exposes an `abort` the Cancel button
 * fires. The queue is FIFO and shown one at a time so stacked dialogs can't
 * fight for focus.
 */
export type HostDialog =
  | {
      id: string;
      moduleId: string;
      kind: 'confirm';
      opts: {
        title: string;
        body?: string;
        confirmLabel?: string;
        cancelLabel?: string;
        danger?: boolean;
      };
      resolve: (value: boolean) => void;
    }
  | {
      id: string;
      moduleId: string;
      kind: 'prompt';
      opts: {
        title: string;
        label?: string;
        hint?: string;
        placeholder?: string;
        initialValue?: string;
        confirmLabel?: string;
      };
      resolve: (value: string | null) => void;
    }
  | {
      id: string;
      moduleId: string;
      kind: 'quickPick';
      opts: { title?: string; placeholder?: string };
      items: Array<{ label: string; description?: string; index: number }>;
      resolve: (index: number | null) => void;
    }
  | {
      id: string;
      moduleId: string;
      kind: 'alert';
      opts: {
        title: string;
        body?: string;
        kind?: 'info' | 'error';
        actions?: Array<{ id: string; label: string }>;
      };
      resolve: (actionId: string | null) => void;
    }
  | {
      id: string;
      moduleId: string;
      kind: 'progress';
      opts: { title: string; cancellable?: boolean };
      /** Fire the task's AbortSignal (only when cancellable). */
      abort: () => void;
      /** Resolved by the host when the task settles → drops the affordance. */
      resolve: () => void;
    };

/**
 * W1-4: a session launch a MAIN extension module requested via
 * `ctx.host.requestLaunch`, parked in main and awaiting human confirm. The spec
 * is ADVISORY — approving routes through the extension's own confined
 * `launchSession` path, which re-authorizes projectId/cwd/persona (Rule 1).
 */
export interface PendingLaunch {
  requestId: string;
  moduleId: string;
  spec: {
    projectId: string;
    personaId?: string;
    extraArgs?: string[];
    title?: string;
    cwd?: string;
    prompt?: string;
    label?: string;
    autoLaunch?: boolean;
  };
  parkedAt: string;
}

export type WorkspaceMode =
  | 'agents'
  | 'terminals'
  | 'explorer'
  | 'skills'
  | 'library'
  | 'scheduler'
  | 'goals'
  | 'followups'
  | 'feed';

/**
 * The active per-project view. Either a core {@link WorkspaceMode} OR an
 * extension module id, when the project's active tab is an
 * extension-contributed project tab (see the SDK `ProjectTabContribution`). An
 * extension id is an opaque string; core never enumerates them, so this widens
 * to `string` while keeping the core-mode literals for autocomplete at the
 * (many) call sites that set a core mode. Consumers that only understand core
 * modes must tolerate an unknown string (treat it as "not my mode").
 */
export type ProjectView = WorkspaceMode | (string & {});

/** Core workspace modes that round-trip to AppConfig. An extension-id project
 *  view also persists — see {@link persistWorkspaceModes}. */
export const PERSISTED_CORE_MODES: readonly WorkspaceMode[] = [
  'agents',
  'terminals',
  'explorer',
  'skills',
  'library',
  'scheduler',
  'goals',
  'followups',
  'feed'
];

export type AgentsBoardView = 'board' | 'list' | 'flow';

export type SplitLayout = 'single' | 'vertical' | 'horizontal' | 'grid';

/** Max extra panes beside the primary, indexed by layout. */
const SPLIT_CAPACITY: Record<SplitLayout, number> = {
  single: 0,
  vertical: 1,
  horizontal: 1,
  grid: 3
};

interface UiState {
  nav: NavId;
  /** Bumped by extension hosts after cache-backed nav badge data changes. */
  moduleBadgeRevision: number;
  refreshModuleBadges: () => void;
  /** When true, column 3 shows the workspaces overview instead of the
   *  per-project Workspace. Cleared when the user selects a project. */
  overviewOpen: boolean;
  setOverviewOpen: (open: boolean) => void;
  selectedProjectId: string | null;
  /** Non-null ⇒ the project list column is drilled into this project's
   *  focused session view. Kept in sync with selectedProjectId and persisted
   *  via AppConfig.focusedProjectId so focus survives relaunch. */
  focusedProjectId: string | null;
  // tabs grouped by project — selected ids per project
  selectedTabId: Record<string, string | undefined>;
  paletteOpen: boolean;
  quickOpenOpen: boolean;
  shortcutsOpen: boolean;
  resumeOpen: boolean;
  /** The rich "+" launcher modal (instruction + profile/model/mode + resume). */
  launcherOpen: boolean;
  searchOpen: boolean;
  findOpen: boolean;
  /**
   * The first-run walkthrough overlay. Auto-opens once on the first main-window
   * launch (gated on AppConfig.walkthroughCompleted in init), and re-openable
   * from Settings. A spotlight tour of start-a-thread / CLI-agent /
   * add-a-project / create-a-schedule.
   */
  walkthroughOpen: boolean;
  /**
   * While the walkthrough is pointing at New Chat, force the Thread / Legacy
   * Agent switcher so the real composer is on screen. `null` when the tour is
   * elsewhere (or closed).
   */
  walkthroughHomeMode: 'thread' | 'agent' | null;
  /**
   * The first-run setup checklist (dependency doctor) overlay. Auto-opens once
   * on the first main-window launch IF a dependency is missing AND the user
   * hasn't dismissed it (gated on AppConfig.setupDismissed in init); re-openable
   * from Settings.
   */
  setupOpen: boolean;
  /**
   * The agent-inspector modal: a peek at one agent's live terminal + metadata,
   * opened by clicking a tray row or board card — without navigating away from
   * the current view. `null` ⇒ closed. The TerminalSurface portals the live
   * xterm for this session into the modal (one-xterm-per-session invariant), so
   * scrollback is shared with its workspace tab, not duplicated.
   */
  agentModal: { sessionId: string; projectId: string } | null;
  /**
   * The thread-inspector modal: the conversation ThreadDetail surface in an
   * overlay, opened from the Agents kanban without navigating to `/threads/:id`.
   * `null` ⇒ closed. Mutually exclusive with {@link agentModal} so only one
   * inspector overlay is up at a time.
   */
  threadModal: { threadId: string } | null;
  /**
   * The agent selected in the Agents "List" view's 3-pane monitor (center-pane
   * live terminal). Like {@link agentModal} it drives TerminalSurface to portal
   * that session's real xterm into the monitor's anchor (one-xterm-per-session),
   * but it's an inline selection rather than an overlay — no backdrop, and the
   * board header/list stay put around it. `null` ⇒ nothing selected yet. A stale
   * selection is harmless: the surface only re-parents when the monitor anchor is
   * actually in the DOM (i.e. the List view is on screen).
   */
  agentMonitor: { sessionId: string; projectId: string } | null;
  /** Select an agent into the List-view monitor's center pane. */
  selectMonitorAgent: (sessionId: string, projectId: string) => void;
  /** Clear the monitor selection (e.g. its session died). */
  clearMonitorAgent: () => void;
  /**
   * The terminal session shown inside a thread secondary-panel tab. Ranked
   * below the agent modal and list monitor so those focused surfaces keep the
   * live xterm; ranked above the Projects workspace park.
   */
  threadPanelTerminal: { sessionId: string; projectId: string } | null;
  selectThreadPanelTerminal: (sessionId: string, projectId: string) => void;
  clearThreadPanelTerminal: () => void;
  toasts: Toast[];
  /**
   * W1-4 trust inversion: launches a MAIN extension module requested via
   * `ctx.host.requestLaunch`, parked in main and drained here for HUMAN CONFIRM
   * before the renderer drives them (Rule 1 — main authorizes, the renderer runs
   * the confined `launchSession` path). Drained on mount + on each `launchParked`
   * push; approving one routes through the extension's own confined launch path.
   */
  pendingLaunches: PendingLaunch[];
  /** Merge freshly-drained parked launches (dedupe by requestId). */
  addPendingLaunches: (launches: PendingLaunch[]) => void;
  /** Approve a parked launch → drive the confined renderer launch, then drop it. */
  approvePendingLaunch: (requestId: string) => Promise<void>;
  /** Dismiss a parked launch without launching. */
  dismissPendingLaunch: (requestId: string) => void;
  /**
   * W1-5 host UX: the FIFO queue of host-rendered dialogs an extension requested
   * (renderer `host.*` or a main module's `ctx.host.confirm/alert`). Shown one
   * at a time by `<HostDialogs />`.
   */
  hostDialogs: HostDialog[];
  /** Enqueue a host dialog (returns the entry so a caller can hold its id). */
  pushHostDialog: (dialog: HostDialog) => void;
  /**
   * Resolve + drop a queued dialog by id, invoking its `resolve` with the
   * user's answer. A no-op if the id already settled (double-answer guard).
   */
  settleHostDialog: (id: string, answer: unknown) => void;
  // unread tabs (received output while not active)
  unread: Record<string, boolean>;
  // workspace mode per project (default: terminals). A value may be a core
  // WorkspaceMode or an extension module id (an extension-contributed project
  // tab) — see ProjectView.
  workspaceMode: Record<string, ProjectView>;
  // Agents board layout — kanban lanes vs. a grouped vertical list. One global
  // preference shared by the cross-project and per-project boards (persisted to
  // AppConfig.agentsBoardView). Default 'board'.
  agentsBoardView: AgentsBoardView;
  setAgentsBoardView: (view: AgentsBoardView) => void;
  // Right-edge Favorites drawer: the slide-over list of starred agents the user
  // is following. Toggled from the titlebar star button. Persisted in
  // localStorage so it survives reloads (like sidebarCollapsed).
  favoritesDrawerOpen: boolean;
  toggleFavoritesDrawer: () => void;
  setFavoritesDrawerOpen: (open: boolean) => void;
  // Right-edge Notifications drawer: the slide-over quick-glance list of
  // recent/unread Inbox entries. Toggled from the titlebar bell (replacing its
  // old nav-to-Inbox behavior). Persisted in localStorage like the favorites
  // drawer, and mutually independent — both can be open at once.
  notificationsDrawerOpen: boolean;
  toggleNotificationsDrawer: () => void;
  setNotificationsDrawerOpen: (open: boolean) => void;
  // explorer: file path open in viewer per project
  explorerFile: Record<string, string | undefined>;
  // explorer: pending goto request per project (consumed by ExplorerView)
  explorerGoto: Record<string, { line: number; column: number; nonce: number } | undefined>;
  // explorer: per-project MRU of opened file paths (most recent at index 0)
  recentFiles: Record<string, string[]>;
  // explorer: per-project diff-vs-HEAD toggle for the open file
  explorerDiff: Record<string, boolean>;
  // explorer: per-project tree mode (file tree vs flat changes list)
  explorerTreeMode: Record<string, 'files' | 'changes'>;
  // sidebar: per-project expansion of the inline terminal sub-list
  projectExpanded: Record<string, boolean>;
  toggleProjectExpanded: (projectId: string) => void;
  // Set the expansion explicitly. Needed because the rail auto-expands projects
  // that have running agents (the stored default is "unset"), so a plain toggle
  // off the unset state is ambiguous — callers pass the effective next value.
  setProjectExpanded: (projectId: string, expanded: boolean) => void;
  // workspace: per-project split layout + the extra tab ids that occupy the
  // non-primary panes. The primary pane is always `selectedTabId[projectId]`.
  // - vertical:  [right]
  // - horizontal:[bottom]
  // - grid 2x2:  [top-right, bottom-left, bottom-right]
  // Slots may be undefined; render skips them and the layout collapses
  // gracefully (CSS grid handles empty cells).
  splitLayout: Record<string, SplitLayout | undefined>;
  splitTabIds: Record<string, Array<string | undefined>>;
  setSplitLayout: (projectId: string, layout: SplitLayout) => void;
  /** Place a tab in the next free split slot, or replace if already present. */
  openInSplit: (projectId: string, tabId: string) => void;
  /** Remove a tab id from the split slots (e.g. when the tab is closed). */
  removeFromSplit: (projectId: string, tabId: string) => void;
  /** Reset to single-pane (clears layout and slot ids). */
  closeSplit: (projectId: string) => void;
  setExplorerDiff: (projectId: string, on: boolean) => void;
  toggleExplorerDiff: (projectId: string) => void;
  setExplorerTreeMode: (projectId: string, mode: 'files' | 'changes') => void;
  toggleExplorerTreeMode: (projectId: string) => void;
  // sidebar: collapsed to an icon rail (labels hidden) to save horizontal
  // space. Persisted in localStorage so it survives reloads.
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  // sidebar: when true, the Projects list hides projects that have no live
  // (non-exited or background) sessions, so a long rail collapses to just the
  // ones with running agents. Persisted in localStorage so it survives reloads.
  hideIdleProjects: boolean;
  toggleHideIdleProjects: () => void;
  // scheduler rail: when true, the Project section hides projects that have no
  // schedules defined, so the list collapses to just the ones with work.
  // Persisted in localStorage so it survives reloads.
  hideSchedulelessProjects: boolean;
  toggleHideSchedulelessProjects: () => void;
  // sidebar: per-section collapse state in the list rail (Scheduler/Settings),
  // keyed by a stable section id like 'scheduler:groups'. Collapsed sections
  // hide their rows so a long rail stays scannable. Persisted in localStorage
  // as a JSON map. Absent key = expanded (the default).
  collapsedSections: Record<string, boolean>;
  toggleSection: (key: string) => void;
  setNav: (n: NavId) => void;
  /** Cross-panel deep-link prefilter: a Plugin row's "4 skills" chip writes
   *  `catalogueFilter.skills = pluginName`, then navs to skills. The skills
   *  panel reads it on mount, applies it as a search prefill, and clears
   *  the slot. Same for `catalogueFilter.mcp`. */
  catalogueFilter: { skills?: string; mcp?: string };
  setCatalogueFilter: (key: 'skills' | 'mcp', value: string | undefined) => void;
  selectProject: (id: string | null) => void;
  /** Drill the project list column into `id`'s focused session view. Keeps
   *  selection in sync (calls selectProject) and persists the focus. */
  enterProjectFocus: (id: string) => void;
  /** Leave focus mode and return the column to the full project list. */
  exitProjectFocus: () => void;
  selectTab: (projectId: string, tabId: string | undefined) => void;
  setPaletteOpen: (open: boolean) => void;
  setQuickOpenOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setResumeOpen: (open: boolean) => void;
  setLauncherOpen: (open: boolean) => void;
  /** Open / close the first-run walkthrough overlay. */
  setWalkthroughOpen: (open: boolean) => void;
  setWalkthroughHomeMode: (mode: 'thread' | 'agent' | null) => void;
  /** Open / close the first-run setup checklist (dependency doctor) overlay. */
  setSetupOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setFindOpen: (open: boolean) => void;
  /** Open the agent-inspector modal on a session (peek at its live terminal). */
  openAgentModal: (sessionId: string, projectId: string) => void;
  /** Close the agent-inspector modal. */
  closeAgentModal: () => void;
  /** Open the thread-inspector modal without leaving the current view. */
  openThreadModal: (threadId: string) => void;
  /** Close the thread-inspector modal. */
  closeThreadModal: () => void;
  /**
   * Which tab is active in the Settings panel. The fixed core tabs are
   * 'global' | 'project' | 'prompts'; a module with `placement: 'settings'`
   * (e.g. Slack) contributes a tab keyed by its module id, so this also accepts
   * an arbitrary module-id string.
   */
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  /** Open `/projects/:id/settings` for a specific project (sidebar + palette). */
  openProjectSettings: (projectId: string) => void;
  /** Page selected in the focused top-level Extensions workspace. */
  extensionsTab: ExtensionsTab;
  setExtensionsTab: (tab: ExtensionsTab) => void;
  /**
   * When the Extensions workspace is open, which module's settings the hub
   * has selected (an opaque module id — built-in or disk extension; core never
   * enumerates them, Rule 6). Drives the ExtensionsHub's detail pane.
   * `null` = default to the first. Set alongside `nav: 'extensions'` by
   * `selectSettingsExtension`.
   */
  settingsExtensionId: string | null;
  setSettingsExtensionId: (id: string | null) => void;
  /** Open the Extensions workspace focused on one installed module. */
  selectSettingsExtension: (id: string) => void;
  /**
   * Pending anchor id to scroll to after a settings-section switch (see
   * SETTINGS_SUBSECTIONS). Set by the section picker alongside `settingsTab`;
   * the SettingsPanel consumes it once the tab renders, then clears it.
   */
  settingsAnchor: string | null;
  setSettingsAnchor: (anchor: string | null) => void;
  /**
   * Which tab is active in the Scheduler panel.
   *  - 'overview'  — dashboard
   *  - 'group'     — a user-defined group (see `selectedGroupId`)
   *  - 'global'    — Ungrouped global schedules (no/unresolved group)
   *  - 'project'   — a project's checked-in schedules (see `selectedProjectId`)
   */
  schedulerTab: 'overview' | 'group' | 'global' | 'project';
  setSchedulerTab: (tab: 'overview' | 'group' | 'global' | 'project') => void;
  /**
   * Which tab is active in the Inbox list pane:
   *  - 'feed'    — the live push feed (default)
   *  - 'reports' — only entries explicitly flagged `report: true` (deliverables)
   *  - 'saved'   — the durable saved-for-later reports (`~/.zcc/saved/`)
   * Purely a view toggle; all read their own slice, so switching never mutates
   * any list. Not persisted — the feed is the natural landing tab.
   */
  inboxTab: 'feed' | 'reports' | 'saved';
  setInboxTab: (tab: 'feed' | 'reports' | 'saved') => void;
  /**
   * How the inbox Feed groups its rows within each day bucket:
   *  - 'project' — collapsible per-project subgroups (default), folded noise
   *  - 'time'    — a flat, newest-first chronological stream (signal only)
   * A real view preference (persisted to AppConfig.inboxGrouping), unlike
   * {@link inboxTab}. The day buckets (Today/Yesterday/…) apply in both modes.
   */
  inboxGrouping: 'project' | 'time';
  setInboxGrouping: (grouping: 'project' | 'time') => void;
  /** Which group the 'group' tab is showing. */
  selectedGroupId: string | null;
  /** Select a group tab and remember which group. */
  selectGroup: (groupId: string) => void;
  /**
   * A schedule the user asked to reveal (from the menu-bar tray). The panel
   * scrolls to and briefly highlights it, then clears this. Null when nothing
   * is pending.
   */
  revealScheduleId: string | null;
  /** Jump the Scheduler to the scope owning `taskId` and reveal that row. */
  revealSchedule: (taskId: string) => void;
  clearRevealSchedule: () => void;
  /**
   * Deep-link target for the Library view — the doc id another surface (the
   * Inbox Overview's Ideas rollup) asked to open. LibraryView picks it up,
   * selects that doc (expanding its scope folder), then clears this so a
   * re-render doesn't re-trigger the jump. Twin of {@link revealScheduleId}.
   * Null when nothing is pending.
   */
  revealLibraryDocId: string | null;
  /**
   * Drill into `projectId`'s Library view and reveal `docId` once it's shown.
   * `projectId` is the project whose Library to open (a global idea has no
   * owning project, so the caller passes a host project — LibraryView shows
   * global docs alongside that project's own).
   */
  revealLibraryDoc: (projectId: string, docId: string) => void;
  clearRevealLibraryDoc: () => void;
  /**
   * Deep-link target for the (unscoped) Follow-ups panel — the follow-up id
   * another surface (the Home dashboard) asked to open. FollowUpsPanel picks
   * this up, clears any search/filter that would hide the row, expands it,
   * and scrolls it into view, then clears this. Twin of {@link revealScheduleId}.
   * Null when nothing is pending.
   */
  revealFollowUpId: string | null;
  /** Jump to the global Follow-ups panel and reveal `id`. */
  revealFollowUp: (id: string) => void;
  clearRevealFollowUp: () => void;
  pushToast: (message: string, kind?: 'info' | 'error') => void;
  dismissToast: (id: string) => void;
  markUnread: (sessionId: string) => void;
  clearUnread: (sessionId: string) => void;
  setWorkspaceMode: (projectId: string, mode: ProjectView) => void;
  toggleWorkspaceMode: (projectId: string) => void;
  setExplorerFile: (projectId: string, path: string | undefined) => void;
  requestExplorerGoto: (projectId: string, line: number, column: number) => void;
}

export const LIST_PANE_MIN = 200;
export const LIST_PANE_MAX = 600;
/** Inbox list column floor. Wider than the shared list min so Feed / Reports /
 *  Saved + the ⋯ action menu stay on one row. */
export const INBOX_LIST_MIN = 345;

export function applyListPaneWidth(px: number) {
  const clamped = Math.max(LIST_PANE_MIN, Math.min(LIST_PANE_MAX, Math.round(px)));
  document.documentElement.style.setProperty('--col-list', `${clamped}px`);
}

/** Current `--col-nav` default. Dragging the sidebar cannot go narrower. */
export const SIDEBAR_MIN = 256;
export const SIDEBAR_MAX = 480;

export function applySidebarWidth(px: number) {
  const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(px)));
  document.documentElement.style.setProperty('--col-nav', `${clamped}px`);
}

/** Concrete dark/light the app should paint for a stored tri-state `theme`.
 *  'system' (WARP-A2) follows the OS `prefers-color-scheme`; anything else
 *  pins. Exported so the xterm-palette mirror resolves identically. */
export function resolveTheme(theme: AppConfig['theme'] | undefined): 'dark' | 'light' {
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';
  // 'system' (or an unknown value): follow the OS, defaulting to dark when
  // matchMedia is unavailable (headless/test), matching the historical default.
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/** The stored tri-state theme, remembered so the OS `matchMedia` listener knows
 *  whether a system-appearance flip should re-paint (only when in 'system'). */
let storedTheme: AppConfig['theme'] = 'dark';

export function applyTheme(theme: AppConfig['theme'] | undefined) {
  storedTheme = theme ?? 'dark';
  document.documentElement.dataset.theme = resolveTheme(storedTheme);
}

/**
 * Subscribe once to OS appearance changes so 'system' theme repaints live
 * (both the CSS `data-theme` cascade and the xterm palette mirror). A no-op
 * when the app theme is pinned to dark/light. Idempotent — guarded so repeated
 * calls (e.g. HMR) don't stack listeners.
 */
let systemThemeListenerBound = false;
export function bindSystemThemeListener() {
  if (systemThemeListenerBound) return;
  if (typeof window === 'undefined' || !window.matchMedia) return;
  systemThemeListenerBound = true;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (storedTheme !== 'system') return;
    const resolved = resolveTheme('system');
    document.documentElement.dataset.theme = resolved;
    // Keep the xterm-palette mirror in lock-step (canvas can't read the CSS
    // cascade), so open terminals recolor with the OS flip.
    useData.setState({ theme: resolved });
  };
  mq.addEventListener('change', onChange);
}

/**
 * The subset of AppConfig this store mirrors as reactive flags (feature gates
 * + a few UI toggles). Derived in ONE place so `init()`'s first hydrate and the
 * live `config.onChanged` re-apply can't drift — a flag toggled off in another
 * window (e.g. Follow-ups) now flips this window's gate immediately instead of
 * lingering until reload. Purely config→flag; no side effects (theme /
 * pane-width / workspace-mode application stays at the call sites).
 */
function mirroredConfigFlags(config: AppConfig) {
  return {
    defaultHarness: config.defaultHarness ?? null,
    fontSize: config.fontSize,
    // Mirror AppConfig.theme so the xterm palette (which paints to a canvas and
    // can't read the CSS `data-theme` cascade) tracks light/dark like every
    // other mirrored flag — one projection for boot + cross-window sync. The
    // stored value is tri-state ('system' follows the OS), so resolve it here.
    theme: resolveTheme(config.theme),
    // Independent xterm palette selection (see AppConfig.terminalTheme). 'auto'
    // tracks `theme`; every other id is an explicit named palette.
    terminalTheme: config.terminalTheme ?? DEFAULT_TERMINAL_THEME,
    inboxGuidanceEnabled: config.inboxGuidanceEnabled ?? true,
    terminalWheelArrowsEnabled: config.terminalWheelArrowsEnabled ?? true,
    heartbeatEnabled: config.heartbeatEnabled ?? false,
    goalsEnabled: config.goalsEnabled ?? false,
    followUpsEnabled: config.followUpsEnabled ?? false,
    idleAttentionSensitivity: config.idleAttentionSensitivity ?? 'medium',
    agentListNeedsYouFromTriage: config.agentListNeedsYouFromTriage ?? false,
    voiceInputEnabled: config.voiceInputEnabled ?? false,
    autoCloseIdleEnabled: config.autoCloseIdleEnabled ?? false,
    overseerMode: config.overseerMode ?? 'off',
    catchUpSummaryEnabled: config.catchUpSummaryEnabled ?? false,
    catchUpSummaryDelaySeconds: config.catchUpSummaryDelaySeconds ?? 20,
    feedNoiseClassifierEnabled: config.feedNoiseClassifierEnabled ?? false,
    structuredQuestionsEnabled: config.structuredQuestionsEnabled ?? true,
    reviewerApprovalMode: config.reviewerApprovalMode ?? 'ask',
    worktreeIsolationDefault: config.worktreeIsolationDefault ?? false,
    suggestionsEnabled: config.suggestionsEnabled ?? false,
    harnessCursorEnabled: config.harnessCursorEnabled ?? false,
    harnessCodexEnabled: config.harnessCodexEnabled ?? false,
    harnessPiEnabled: config.harnessPiEnabled ?? false,
    harnessOpenCodeEnabled: config.harnessOpenCodeEnabled ?? false,
    microVmEnabled: config.microVmEnabled ?? false,
    openerHiddenTargets: config.openerHiddenTargets ?? [],
    steerActiveThreadOnEnter: config.steerActiveThreadOnEnter ?? false
  };
}

// Restore the per-section collapse map persisted by toggleSection. A malformed
// or missing value just yields an empty map (everything expanded).
function readCollapsedSections(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('zcc.collapsedSections');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Debounced write of workspaceMode -> AppConfig.workspaceModes.
let persistTimer: number | null = null;
function persistWorkspaceModes() {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const map = useUi.getState().workspaceMode;
    // Every mode round-trips, INCLUDING an extension-id project view (an
    // extension-contributed project tab): the value is an opaque string, and an
    // id whose extension is gone on next launch is tolerated at render time
    // (falls back to the default view). See ProjectView.
    const persisted: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      if (v) persisted[k] = v;
    }
    product.config.set({ workspaceModes: persisted }).catch(() => {});
  }, 200);
}

// Fire-and-forget write of the global agents-board view preference. No debounce
// needed — it changes only on an explicit user toggle, not on a typing/drag.
function persistAgentsBoardView(view: AgentsBoardView) {
  product.config.set({ agentsBoardView: view }).catch(() => {});
}

// Per-project debounced git refresh. Terminal output is high-frequency, so
// we coalesce bursts (build logs, scrolling output) into one git call after
// activity quiets down for a moment.
const gitRefreshTimers = new Map<string, number>();
export function scheduleGitRefresh(projectId: string, delay = 1500) {
  const existing = gitRefreshTimers.get(projectId);
  if (existing !== undefined) window.clearTimeout(existing);
  const t = window.setTimeout(() => {
    gitRefreshTimers.delete(projectId);
    useData.getState().loadGitStatus(projectId);
  }, delay);
  gitRefreshTimers.set(projectId, t);
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

export function pushErrorToast(message: string) {
  useUi.getState().pushToast(message, 'error');
}

const RAIL_KEEPING_NAVS = new Set(['projects', 'inbox', 'suggestions', 'settings']);

function applyDestination(
  set: (partial: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => void,
  path: string,
  extra?: Partial<UiState>
) {
  const url = new URL(path, 'http://zcc.local');
  const decoded = decodeRoutePath(url.pathname, url.hash);
  set((s) => {
    const keepFocus =
      s.focusedProjectId != null &&
      decoded.focusedProjectId == null &&
      RAIL_KEEPING_NAVS.has(decoded.nav);
    return {
      nav: decoded.nav as NavId,
      settingsTab: decoded.settingsTab as SettingsTab,
      settingsAnchor: decoded.settingsAnchor,
      extensionsTab: decoded.extensionsTab,
      settingsExtensionId: decoded.settingsExtensionId,
      focusedProjectId: decoded.focusedProjectId ?? (keepFocus ? s.focusedProjectId : null),
      workspaceMode:
        decoded.focusedProjectId && decoded.workspaceMode
          ? {
              ...s.workspaceMode,
              [decoded.focusedProjectId]: decoded.workspaceMode as ProjectView
            }
          : s.workspaceMode,
      ...extra
    };
  });
  appNavigate(path);
}

export const useUi = create<UiState>((set, get) => ({
  nav: 'home',
  moduleBadgeRevision: 0,
  refreshModuleBadges: () => set((s) => ({ moduleBadgeRevision: s.moduleBadgeRevision + 1 })),
  overviewOpen: false,
  setOverviewOpen: (overviewOpen) => set({ overviewOpen }),
  revealScheduleId: null,
  revealLibraryDocId: null,
  revealFollowUpId: null,
  selectedProjectId: null,
  focusedProjectId: null,
  selectedTabId: {},
  paletteOpen: false,
  quickOpenOpen: false,
  shortcutsOpen: false,
  resumeOpen: false,
  launcherOpen: false,
  walkthroughOpen: false,
  walkthroughHomeMode: null,
  setupOpen: false,
  searchOpen: false,
  findOpen: false,
  agentModal: null,
  threadModal: null,
  agentMonitor: null,
  threadPanelTerminal: null,
  settingsTab: 'global',
  extensionsTab: 'marketplace',
  settingsExtensionId: null,
  schedulerTab: 'overview',
  selectedGroupId: null,
  toasts: [],
  pendingLaunches: [],
  hostDialogs: [],
  unread: {},
  workspaceMode: {},
  agentsBoardView: 'board',
  explorerFile: {},
  explorerGoto: {},
  recentFiles: {},
  explorerDiff: {},
  explorerTreeMode: {},
  projectExpanded: {},
  splitLayout: {},
  splitTabIds: {},
  favoritesDrawerOpen:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('zcc.favoritesDrawerOpen') === '1',
  toggleFavoritesDrawer: () =>
    set((s) => {
      const next = !s.favoritesDrawerOpen;
      try {
        localStorage.setItem('zcc.favoritesDrawerOpen', next ? '1' : '0');
      } catch {
        // ignore quota errors
      }
      return { favoritesDrawerOpen: next };
    }),
  setFavoritesDrawerOpen: (open) => {
    try {
      localStorage.setItem('zcc.favoritesDrawerOpen', open ? '1' : '0');
    } catch {
      // ignore quota errors
    }
    set({ favoritesDrawerOpen: open });
  },
  notificationsDrawerOpen:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('zcc.notificationsDrawerOpen') === '1',
  toggleNotificationsDrawer: () =>
    set((s) => {
      const next = !s.notificationsDrawerOpen;
      try {
        localStorage.setItem('zcc.notificationsDrawerOpen', next ? '1' : '0');
      } catch {
        // ignore quota errors
      }
      return { notificationsDrawerOpen: next };
    }),
  setNotificationsDrawerOpen: (open) => {
    try {
      localStorage.setItem('zcc.notificationsDrawerOpen', open ? '1' : '0');
    } catch {
      // ignore quota errors
    }
    set({ notificationsDrawerOpen: open });
  },
  sidebarCollapsed:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(sidebarCollapsedKey()) === '1',
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      try {
        localStorage.setItem(sidebarCollapsedKey(), next ? '1' : '0');
      } catch {
        // ignore quota errors
      }
      return { sidebarCollapsed: next };
    }),
  hideIdleProjects:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('zcc.hideIdleProjects') === '1',
  toggleHideIdleProjects: () =>
    set((s) => {
      const next = !s.hideIdleProjects;
      try {
        localStorage.setItem('zcc.hideIdleProjects', next ? '1' : '0');
      } catch {
        // ignore quota errors
      }
      return { hideIdleProjects: next };
    }),
  hideSchedulelessProjects:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('zcc.hideSchedulelessProjects') === '1',
  toggleHideSchedulelessProjects: () =>
    set((s) => {
      const next = !s.hideSchedulelessProjects;
      try {
        localStorage.setItem('zcc.hideSchedulelessProjects', next ? '1' : '0');
      } catch {
        // ignore quota errors
      }
      return { hideSchedulelessProjects: next };
    }),
  collapsedSections: readCollapsedSections(),
  toggleSection: (key) =>
    set((s) => {
      const next = { ...s.collapsedSections, [key]: !s.collapsedSections[key] };
      try {
        localStorage.setItem('zcc.collapsedSections', JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return { collapsedSections: next };
    }),
  // Entering the scheduler always lands on Overview — the cross-scope summary
  // is the right "home" when you click in. Switching to global/project scope
  // happens inside the panel via setSchedulerTab, so this only resets on
  // re-entry, not when the user navigates the scope rail.
  setNav: (nav) =>
    applyDestination(
      set,
      getNavRoutePath(nav),
      nav === 'scheduler' ? { schedulerTab: 'overview' } : undefined
    ),
  inboxTab: 'feed',
  setInboxTab: (inboxTab) => set({ inboxTab }),
  inboxGrouping: 'project',
  setInboxGrouping: (grouping) => {
    set({ inboxGrouping: grouping });
    product.config.set({ inboxGrouping: grouping }).catch(() => {});
  },
  catalogueFilter: {},
  setCatalogueFilter: (key, value) =>
    set((s) => ({
      catalogueFilter:
        value === undefined
          ? Object.fromEntries(Object.entries(s.catalogueFilter).filter(([k]) => k !== key))
          : { ...s.catalogueFilter, [key]: value }
    })),
  selectProject: (id) => {
    set({ selectedProjectId: id, overviewOpen: false });
    if (!id) {
      // Tell main no project is active so the per-project skills watcher
      // is torn down. touch() with a falsy id is a no-op for state but is
      // the canonical "selected changed" signal.
      product.projects.touch('').catch(() => {});
      return;
    }
    product.config.set({ lastProjectId: id }).catch(() => {});
    // Persist the touch to disk so the next launch's auto-sort reflects
    // recent use, but DON'T merge the updated lastActiveAt back into the
    // in-memory projects list — that causes the just-clicked project to
    // jump to the top of the sidebar mid-session, which is jarring.
    product.projects.touch(id).catch(() => {});
    useData.getState().loadGitStatus(id);
  },
  enterProjectFocus: (id) => {
    // Opening a workspace always lands on the Agents board. Callers that need a
    // different surface (Library, a live terminal, an extension project tab)
    // set that mode AFTER focus so this default does not win.
    set({ focusedProjectId: id, nav: 'projects' });
    // Keep selection in sync with focus so the workspace tracks the column.
    get().selectProject(id);
    get().setWorkspaceMode(id, 'agents');
    product.config.set({ focusedProjectId: id }).catch(() => {});
  },
  exitProjectFocus: () => {
    set({ focusedProjectId: null });
    product.config.set({ focusedProjectId: null }).catch(() => {});
  },
  selectTab: (projectId, tabId) => {
    set((s) => {
      const unread = { ...s.unread };
      if (tabId) delete unread[tabId];
      return { selectedTabId: { ...s.selectedTabId, [projectId]: tabId }, unread };
    });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setQuickOpenOpen: (quickOpenOpen) => set({ quickOpenOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setResumeOpen: (resumeOpen) => set({ resumeOpen }),
  setLauncherOpen: (launcherOpen) => set({ launcherOpen }),
  setWalkthroughOpen: (walkthroughOpen) =>
    set(walkthroughOpen ? { walkthroughOpen } : { walkthroughOpen, walkthroughHomeMode: null }),
  setWalkthroughHomeMode: (walkthroughHomeMode) => set({ walkthroughHomeMode }),
  setSetupOpen: (setupOpen) => set({ setupOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setFindOpen: (findOpen) => set({ findOpen }),
  openAgentModal: (sessionId, projectId) =>
    set({ agentModal: { sessionId, projectId }, threadModal: null }),
  closeAgentModal: () => set({ agentModal: null }),
  openThreadModal: (threadId) => set({ threadModal: { threadId }, agentModal: null }),
  closeThreadModal: () => set({ threadModal: null }),
  selectMonitorAgent: (sessionId, projectId) => set({ agentMonitor: { sessionId, projectId } }),
  clearMonitorAgent: () => set({ agentMonitor: null }),
  selectThreadPanelTerminal: (sessionId, projectId) => set({ threadPanelTerminal: { sessionId, projectId } }),
  clearThreadPanelTerminal: () => set({ threadPanelTerminal: null }),
  setSettingsTab: (settingsTab) =>
    applyDestination(
      set,
      getSettingsTabRoutePath(settingsTab, get().focusedProjectId ?? get().selectedProjectId)
    ),
  openProjectSettings: (projectId) => {
    get().selectProject(projectId);
    applyDestination(set, getProjectSettingsRoutePath(projectId));
  },
  setExtensionsTab: (extensionsTab) =>
    applyDestination(set, getExtensionsTabRoutePath(extensionsTab)),
  setSettingsExtensionId: (settingsExtensionId) => set({ settingsExtensionId }),
  selectSettingsExtension: (id) => applyDestination(set, getPluginDetailRoutePath(id)),
  settingsAnchor: null,
  setSettingsAnchor: (settingsAnchor) => set({ settingsAnchor }),
  setSchedulerTab: (schedulerTab) => set({ schedulerTab }),
  selectGroup: (groupId) => set({ schedulerTab: 'group', selectedGroupId: groupId }),
  revealSchedule: (taskId) => {
    const task = useScheduler.getState().tasks.find((t) => t.id === taskId);
    // applyDestination('/scheduler') forces schedulerTab back to 'overview' via
    // setNav, so set the scope tab AFTER it. A project-scoped task also needs
    // its project selected so the project scope renders the right list.
    applyDestination(set, getSchedulerRoutePath(), { revealScheduleId: taskId });
    if (task?.source && task.source !== 'global') {
      get().selectProject((task.source as { projectId: string }).projectId);
      set({ schedulerTab: 'project' });
    } else if (task?.group && useScheduleGroups.getState().groups.some((g) => g.id === task.group)) {
      // Global + resolvable group → land on that group's tab; otherwise the
      // task lives in the Ungrouped (global) bucket.
      set({ schedulerTab: 'group', selectedGroupId: task.group });
    } else {
      set({ schedulerTab: 'global' });
    }
  },
  clearRevealSchedule: () => set({ revealScheduleId: null }),
  revealLibraryDoc: (projectId, docId) => {
    // Drilling into a project focuses it and resets its mode to Agents, so set
    // the Library mode AFTER entering focus (mirrors revealSchedule ordering).
    get().enterProjectFocus(projectId);
    // `'library'` is the pre-plugin persisted alias; Workspace remaps it onto
    // the Docs plugin's project tab without naming that plugin's id here.
    get().setWorkspaceMode(projectId, 'library');
    set({ revealLibraryDocId: docId });
  },
  clearRevealLibraryDoc: () => set({ revealLibraryDocId: null }),
  revealFollowUp: (id) => {
    // Exit any lingering project focus first — the global Follow-ups panel
    // shows every project's follow-ups, and a stale focus would otherwise
    // leave the rail on the scoped nav while `nav` flips to 'followups'.
    get().exitProjectFocus();
    applyDestination(set, getFollowUpsRoutePath(), { revealFollowUpId: id });
  },
  clearRevealFollowUp: () => set({ revealFollowUpId: null }),
  pushToast: (message, kind = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  addPendingLaunches: (launches) =>
    set((s) => {
      if (launches.length === 0) return s;
      const seen = new Set(s.pendingLaunches.map((p) => p.requestId));
      const fresh = launches.filter((p) => p && p.requestId && !seen.has(p.requestId));
      if (fresh.length === 0) return s;
      return { pendingLaunches: [...s.pendingLaunches, ...fresh] };
    }),
  approvePendingLaunch: async (requestId) => {
    const entry = get().pendingLaunches.find((p) => p.requestId === requestId);
    if (!entry) return;
    // Drop it optimistically so a double-click can't launch twice.
    set((s) => ({ pendingLaunches: s.pendingLaunches.filter((p) => p.requestId !== requestId) }));
    try {
      // Route through the extension's OWN confined launch path (Rule 1): this
      // re-gates session:launch for the module, sanitizes the flags against the
      // launch denylist, re-checks projectId against the known project set, and
      // navigates the shell — exactly as a renderer-driven launch would. The
      // parked spec was only advisory.
      // Dynamic import to avoid a static cycle (host.ts imports this store).
      const { createModuleHost } = await import('./modules/host.js');
      const host = createModuleHost(entry.moduleId);
      // Seed the opening prompt using the SAME per-harness delivery + effective
      // profile that `launchSession` resolves (persona.baseProfile ?? 'claude'):
      // a leading positional for claude/cursor/codex/pi, `--prompt <text>` for
      // OpenCode (whose positional is a project DIR). `launchSession` takes no
      // `prompt` param, so we bake it into extraArgs here.
      const seedProfile =
        (entry.spec.personaId
          ? usePersonas.getState().personas.find((p) => p.id === entry.spec.personaId)?.baseProfile
          : undefined) ?? 'claude';
      const seed = entry.spec.prompt ? seedPromptArgs(seedProfile, entry.spec.prompt) : [];
      const extraArgs = seed.length
        ? [...seed, ...(entry.spec.extraArgs ?? [])]
        : entry.spec.extraArgs;
      const res = await host.launchSession({
        projectId: entry.spec.projectId,
        personaId: entry.spec.personaId,
        extraArgs,
        title: entry.spec.title,
        cwd: entry.spec.cwd
      });
      if (!res) {
        useUi.getState().pushToast(`${entry.moduleId}: launch could not be started`, 'error');
      }
    } catch (err) {
      useUi
        .getState()
        .pushToast(`${entry.moduleId}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  },
  dismissPendingLaunch: (requestId) =>
    set((s) => ({ pendingLaunches: s.pendingLaunches.filter((p) => p.requestId !== requestId) })),
  pushHostDialog: (dialog) => set((s) => ({ hostDialogs: [...s.hostDialogs, dialog] })),
  settleHostDialog: (id, answer) => {
    const entry = get().hostDialogs.find((d) => d.id === id);
    if (!entry) return; // Already settled (double-answer guard).
    // Drop first so a resolve() that re-enters the store can't see a stale entry.
    set((s) => ({ hostDialogs: s.hostDialogs.filter((d) => d.id !== id) }));
    // Invoke the renderer-only resolver with the user's answer. Each variant's
    // resolver is typed narrowly; the queue erases that, so dispatch per kind.
    switch (entry.kind) {
      case 'confirm':
        entry.resolve(answer === true);
        break;
      case 'prompt':
        entry.resolve(typeof answer === 'string' ? answer : null);
        break;
      case 'quickPick':
        entry.resolve(typeof answer === 'number' ? answer : null);
        break;
      case 'alert':
        entry.resolve(typeof answer === 'string' ? answer : null);
        break;
      case 'progress':
        entry.resolve();
        break;
    }
  },
  markUnread: (sessionId) =>
    set((s) => (s.unread[sessionId] ? s : { unread: { ...s.unread, [sessionId]: true } })),
  clearUnread: (sessionId) =>
    set((s) => {
      if (!s.unread[sessionId]) return s;
      const next = { ...s.unread };
      delete next[sessionId];
      return { unread: next };
    }),
  setWorkspaceMode: (projectId, mode) => {
    set((s) => ({
      nav: 'projects',
      focusedProjectId: s.focusedProjectId ?? projectId,
      workspaceMode: { ...s.workspaceMode, [projectId]: mode }
    }));
    persistWorkspaceModes();
    applyDestination(set, getProjectWorkspaceRoutePath(projectId, mode), {
      nav: 'projects',
      focusedProjectId: projectId
    });
  },
  setAgentsBoardView: (view) => {
    set({ agentsBoardView: view });
    persistAgentsBoardView(view);
  },
  toggleWorkspaceMode: (projectId) => {
    const cur = get().workspaceMode[projectId] ?? 'terminals';
    get().setWorkspaceMode(projectId, cur === 'terminals' ? 'explorer' : 'terminals');
  },
  setExplorerFile: (projectId, path) =>
    set((s) => {
      const next: Partial<UiState> = {
        explorerFile: { ...s.explorerFile, [projectId]: path }
      };
      if (path) {
        const prev = s.recentFiles[projectId] ?? [];
        const filtered = prev.filter((p) => p !== path);
        filtered.unshift(path);
        if (filtered.length > 30) filtered.length = 30;
        next.recentFiles = { ...s.recentFiles, [projectId]: filtered };
      }
      return next;
    }),
  setExplorerDiff: (projectId, on) =>
    set((s) => ({ explorerDiff: { ...s.explorerDiff, [projectId]: on } })),
  toggleExplorerDiff: (projectId) =>
    set((s) => ({
      explorerDiff: { ...s.explorerDiff, [projectId]: !s.explorerDiff[projectId] }
    })),
  setExplorerTreeMode: (projectId, mode) =>
    set((s) => ({ explorerTreeMode: { ...s.explorerTreeMode, [projectId]: mode } })),
  toggleExplorerTreeMode: (projectId) =>
    set((s) => {
      const cur = s.explorerTreeMode[projectId] ?? 'files';
      return {
        explorerTreeMode: {
          ...s.explorerTreeMode,
          [projectId]: cur === 'files' ? 'changes' : 'files'
        }
      };
    }),
  requestExplorerGoto: (projectId, line, column) =>
    set((s) => ({
      explorerGoto: {
        ...s.explorerGoto,
        [projectId]: { line, column, nonce: Date.now() + Math.random() }
      }
    })),
  toggleProjectExpanded: (projectId) =>
    set((s) => ({
      projectExpanded: { ...s.projectExpanded, [projectId]: !s.projectExpanded[projectId] }
    })),
  setProjectExpanded: (projectId, expanded) =>
    set((s) => ({
      projectExpanded: { ...s.projectExpanded, [projectId]: expanded }
    })),
  setSplitLayout: (projectId, layout) =>
    set((s) => {
      const cap = SPLIT_CAPACITY[layout];
      const cur = s.splitTabIds[projectId] ?? [];
      // Truncate or pad to the new layout's capacity (preserve existing ids).
      const slots = cur.slice(0, cap);
      while (slots.length < cap) slots.push(undefined);
      const layouts = { ...s.splitLayout, [projectId]: layout };
      const ids = { ...s.splitTabIds, [projectId]: slots };
      if (layout === 'single') delete layouts[projectId];
      return { splitLayout: layouts, splitTabIds: ids };
    }),
  openInSplit: (projectId, tabId) =>
    set((s) => {
      // Splitting a tab against itself is a no-op. The user invokes "Open in
      // split" from the *non-active* tab's context menu, so this branch
      // should never fire in practice — guard anyway.
      if (s.selectedTabId[projectId] === tabId) return s;
      const layout = s.splitLayout[projectId] ?? 'single';
      // If we're still single-pane, default to a vertical split when the
      // user picks "Open in split" from the menu — preserves the prior
      // one-shortcut behavior.
      const targetLayout: SplitLayout = layout === 'single' ? 'vertical' : layout;
      const cap = SPLIT_CAPACITY[targetLayout];
      const prev = s.splitTabIds[projectId] ?? [];
      const slots = prev.slice(0, cap);
      while (slots.length < cap) slots.push(undefined);
      // If the tab is already in a slot, leave it (idempotent).
      if (slots.includes(tabId)) {
        return {
          splitLayout: { ...s.splitLayout, [projectId]: targetLayout },
          splitTabIds: { ...s.splitTabIds, [projectId]: slots }
        };
      }
      // Drop into the first free slot, else replace the last one.
      const free = slots.findIndex((x) => x === undefined);
      const idx = free === -1 ? slots.length - 1 : free;
      slots[idx] = tabId;
      return {
        splitLayout: { ...s.splitLayout, [projectId]: targetLayout },
        splitTabIds: { ...s.splitTabIds, [projectId]: slots }
      };
    }),
  removeFromSplit: (projectId, tabId) =>
    set((s) => {
      const slots = s.splitTabIds[projectId];
      if (!slots || !slots.includes(tabId)) return s;
      const next = slots.map((x) => (x === tabId ? undefined : x));
      return { splitTabIds: { ...s.splitTabIds, [projectId]: next } };
    }),
  closeSplit: (projectId) =>
    set((s) => {
      const layouts = { ...s.splitLayout };
      const ids = { ...s.splitTabIds };
      delete layouts[projectId];
      delete ids[projectId];
      return { splitLayout: layouts, splitTabIds: ids };
    })
}));

export interface ClosedTab {
  profile: LaunchProfileId;
  title: string;
  extraArgs?: string[];
  /** Reopen in the same directory the closed tab ran in (else project root). */
  cwd?: string;
  /** Re-pin on reopen if the closed tab was pinned. */
  pinned?: boolean;
}

interface DataState {
  /** Main-owned global default; null keeps Claude compatibility fallback. */
  defaultHarness: AppConfig['defaultHarness'] | null;
  /** True once the first main config read completed. */
  configLoaded: boolean;
  projects: Project[];
  terminals: Record<string, TerminalSession[]>; // by project id
  claudeSessions: Record<string, ClaudeSessionSummary[]>; // by project id
  closedTabs: Record<string, ClosedTab[]>; // by project id, most recent at end
  /**
   * Session ids detached to the background, per project, most recent last.
   * Renderer-only ordering used to resume the newest-detached session first
   * (⌘⇧T). Kept separate from the session objects so main's onUpdated pushes
   * can't clobber the order.
   */
  detachedStack: Record<string, string[]>;
  gitStatus: Record<string, GitStatus | null>; // by project id
  fontSize: number;
  /** Mirror of AppConfig.theme — drives the xterm color palette (chrome theming
   *  is CSS via `data-theme`, but xterm paints to a canvas and needs an explicit
   *  theme object). Hydrated on init, kept live by the cross-window config sync. */
  theme: 'dark' | 'light';
  /** Mirror of AppConfig.terminalTheme — the xterm color palette, independent of
   *  the app light/dark `theme`. 'auto' follows `theme`; other ids are explicit
   *  named palettes. Hydrated on init, kept live by the cross-window config sync
   *  and the Settings picker. */
  terminalTheme: TerminalThemeId;
  inboxGuidanceEnabled: boolean;
  /** Mirror of AppConfig.terminalWheelArrowsEnabled — keeps xterm's wheel→arrow
   *  translation on (default true). Read live by TerminalView's custom wheel
   *  handler so a flip takes effect on open terminals without reopening them. */
  terminalWheelArrowsEnabled: boolean;
  /** Mirror of AppConfig.heartbeatEnabled — gates the per-agent Heartbeat
   *  toggle in the agent inspector. Hydrated on init, kept live by the Settings
   *  toggle. Default off. */
  heartbeatEnabled: boolean;
  /** Mirror of AppConfig.goalsEnabled — gates the experimental Goals project tab.
   *  Hydrated on init, kept live by the Settings toggle. Default off. */
  goalsEnabled: boolean;
  /** Mirror of AppConfig.followUpsEnabled — gates the experimental Follow-ups
   *  project tab. Hydrated on init, kept live by the Settings toggle. Default off. */
  followUpsEnabled: boolean;
  /** Mirror of AppConfig.idleAttentionSensitivity — drives the Agents board's
   *  "Needs you" lane promotion of triaged idle agents (advisory; main owns the
   *  verdict). Hydrated on init, kept live by the Settings select. Default
   *  'medium'. */
  idleAttentionSensitivity: 'high' | 'medium' | 'low';
  /** Mirror of AppConfig.agentListNeedsYouFromTriage — when on, the left-side
   *  AgentsListPane also promotes triaged idle agents into its "Needs you" group
   *  (the board already does). Default off. */
  agentListNeedsYouFromTriage: boolean;
  /** Mirror of AppConfig.voiceInputEnabled — gates the mic button in the prompt
   *  composer. Hydrated on init, kept live by the Settings toggle. Default off. */
  voiceInputEnabled: boolean;
  /** Mirror of AppConfig.steerActiveThreadOnEnter — Enter steers a running thread. */
  steerActiveThreadOnEnter: boolean;
  /** Mirror of AppConfig.autoCloseIdleEnabled — the master switch for closing
   *  idle agents on a timer. Backs the sidebar one-click toggle (near Agents)
   *  and the Settings toggle. Hydrated on init, kept live by both. Default off. */
  autoCloseIdleEnabled: boolean;
  /** Mirror of AppConfig.overseerMode — the experimental auto-approval cascade.
   *  Backs the sidebar one-click toggle (near Agents), which flips between 'off'
   *  and 'on'; Settings offers the full off/dryRun/on select. Default 'off'. */
  overseerMode: 'off' | 'dryRun' | 'on';
  /** Mirror of AppConfig.reviewerApprovalMode — the "Approve for me" posture.
   *  Backs the sidebar one-click toggle (off↔approveForMe) and the Settings
   *  select (full ask/approveForMe/fullAccess range). Default 'ask'. */
  reviewerApprovalMode: 'ask' | 'approveForMe' | 'fullAccess';
  /** Mirror of AppConfig.catchUpSummaryEnabled — gates the catch-up summary card
   *  in the agent modal (EXPERIMENTAL). Hydrated on init, kept live by the Settings
   *  toggle. Default off. */
  catchUpSummaryEnabled: boolean;
  /** Mirror of AppConfig.catchUpSummaryDelaySeconds — idle/blocked dwell before
   *  the add-on fires. Hydrated on init. Default 20. Used by the card to compute
   *  the shimmer threshold. */
  catchUpSummaryDelaySeconds: number;
  /** Mirror of AppConfig.feedNoiseClassifierEnabled — gates the optional inbox
   *  "Routine" demotion (EXPERIMENTAL). Hydrated on init, kept live by the
   *  Settings toggle. Default off; when off, no classify call runs and every
   *  report stays inline. */
  feedNoiseClassifierEnabled: boolean;
  /** Mirror of AppConfig.suggestionsEnabled — gates the Suggested Actions launcher
   *  rail entry + view (EXPERIMENTAL). Hydrated on init, kept live by the Settings
   *  toggle. Default off; when off the "Suggestions" nav entry is absent. */
  suggestionsEnabled: boolean;
  /** Mirror of AppConfig.structuredQuestionsEnabled — gates the interactive
   *  lettered-option question form (inbox_ask / inbox_push options / follow-up
   *  picker) vs. plain markdown + free-text reply. Hydrated on init, kept live by
   *  the Settings toggle. Default ON. */
  structuredQuestionsEnabled: boolean;
  /** Mirror of AppConfig.harnessCursorEnabled — explicit hide for Cursor. Unset
   *  plus an installed CLI still offers it in launch UI. */
  harnessCursorEnabled: boolean;
  /** Mirror of AppConfig.harnessCodexEnabled — explicit hide for Codex. */
  harnessCodexEnabled: boolean;
  /** Mirror of AppConfig.harnessPiEnabled — explicit hide for PI. */
  harnessPiEnabled: boolean;
  /** Mirror of AppConfig.harnessOpenCodeEnabled — explicit hide for OpenCode. */
  harnessOpenCodeEnabled: boolean;
  /** Last code-harness verification snapshot (Settings → Code Harness). Empty
   *  until `refreshHarnessStatus` runs; the launcher gates a harness profile on
   *  `enabled && installed`, showing an enabled-but-missing harness greyed-out. */
  harnessStatus: HarnessVerifyResult[];
  /** Re-probe every harness family's `<binary> --version` and cache the result. */
  refreshHarnessStatus: () => Promise<void>;
  /** Last external-editor verification snapshot (Settings → Editor). Empty until
   *  `refreshEditorStatus` runs. */
  editorStatus: EditorVerifyResult[];
  /** Re-probe every external editor's `<shim> --version` and cache the result. */
  refreshEditorStatus: () => Promise<void>;
  /** Mirror of AppConfig.openerHiddenTargets — opener-bar targets the user hid.
   *  `OpenerButtons` drops these from its row. Hydrated on init, kept live by the
   *  Editor settings toggles. */
  openerHiddenTargets: OpenTarget[];
  setOpenerHiddenTargets: (targets: OpenTarget[]) => void;
  /** Mirror of AppConfig.microVmEnabled — gates the microVM env in launch UI. */
  microVmEnabled: boolean;
  /** Mirror of AppConfig.worktreeIsolationDefault — the default workspace
   *  picker selection (new worktree vs this checkout), not a hidden mode.
   *  A per-project ProjectSettings.worktreeIsolation overrides it. */
  worktreeIsolationDefault: boolean;
  init: () => Promise<void>;
  loadGitStatus: (projectId: string) => Promise<void>;
  refreshAllGitStatus: () => Promise<void>;
  setFontSize: (n: number) => void;
  setTerminalTheme: (id: TerminalThemeId) => void;
  setInboxGuidanceEnabled: (on: boolean) => void;
  setTerminalWheelArrowsEnabled: (on: boolean) => void;
  setHeartbeatEnabled: (on: boolean) => void;
  setGoalsEnabled: (on: boolean) => void;
  setFollowUpsEnabled: (on: boolean) => void;
  setCatchUpSummaryEnabled: (on: boolean) => void;
  setCatchUpSummaryDelaySeconds: (seconds: number) => void;
  setFeedNoiseClassifierEnabled: (on: boolean) => void;
  setSuggestionsEnabled: (on: boolean) => void;
  setStructuredQuestionsEnabled: (on: boolean) => void;
  setHarnessCursorEnabled: (on: boolean) => void;
  setHarnessCodexEnabled: (on: boolean) => void;
  setHarnessPiEnabled: (on: boolean) => void;
  setHarnessOpenCodeEnabled: (on: boolean) => void;
  setMicroVmEnabled: (on: boolean) => void;
  setWorktreeIsolationDefault: (on: boolean) => void;
  setIdleAttentionSensitivity: (level: 'high' | 'medium' | 'low') => void;
  setAgentListNeedsYouFromTriage: (on: boolean) => void;
  setVoiceInputEnabled: (on: boolean) => void;
  /** Flip the auto-close-idle master switch and persist it (sidebar toggle). */
  setAutoCloseIdleEnabled: (on: boolean) => Promise<void>;
  /** Flip the Overseer between off/on and persist it (sidebar toggle). The
   *  Settings select still exposes the full off/dryRun/on range. */
  setOverseerMode: (mode: 'off' | 'dryRun' | 'on') => Promise<void>;
  /** Flip the "Approve for me" posture and persist it (sidebar toggle owns the
   *  round-trip). The Settings select still exposes the full range. */
  setReviewerApprovalMode: (mode: 'ask' | 'approveForMe' | 'fullAccess') => Promise<void>;
  /** Pure-local mirror for the Settings select (which drives its own config.set
   *  first); avoids a set→set round-trip loop. */
  setReviewerApprovalModeLocal: (mode: 'ask' | 'approveForMe' | 'fullAccess') => void;
  /** Toggle the per-agent Heartbeat opt-in on a live session (idle-nudge). */
  setHeartbeat: (sessionId: string, projectId: string, on: boolean) => Promise<void>;
  reopenLastClosed: (projectId: string) => Promise<TerminalSession | null>;
  /**
   * Reattach tmux sessions that survived quit. Idempotent across the app
   * launch: runs at most once, guarded by `sessionsRestored`. Called from
   * init() after live hydration. Agent cards come from the SQLite live list,
   * not a localStorage tab snapshot.
   */
  restoreSessions: (skipProjectIds?: Set<string>) => Promise<void>;
  loadProjects: () => Promise<void>;
  loadClaudeSessions: (projectId: string) => Promise<void>;
  addProject: () => Promise<Project | null>;
  addProjectByPath: (path: string, opts?: { hostId?: string }) => Promise<Project | null>;
  addRemoteProject: (input: {
    host: string;
    user?: string;
    remotePath?: string;
    proxyJump?: string;
    name?: string;
  }) => Promise<Project | null>;
  cloneProject: (input: { url: string; name?: string }) => Promise<CloneProjectResult>;
  updateProject: (
    id: string,
    patch: {
      name?: string;
      color?: string;
      defaultAgents?: string[];
      defaultPersonas?: string[];
      launchDefault?: Project['launchDefault'];
      favorite?: boolean;
      remotePath?: string;
    }
  ) => Promise<void>;
  reorderProjects: (orderedIds: string[]) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  createTerminal: (
    projectId: string,
    profile: LaunchProfileId,
    cols: number,
    rows: number,
    opts?: {
      extraArgs?: string[];
      harnessRouting?: import('@zana-ai/zcc-domain/product').HarnessModelRoutingV1;
      title?: string;
      cwd?: string;
      isolateScratch?: boolean | string;
      /** Isolated-worktree launch intent: legacy `true` (branch derived from the title/
       *  prompt) or `{ branch }` to provide a stable name. main mints a git worktree of a local
       *  project and launches the agent there. Ignored for remote/scratch/non-repo
       *  projects. See {@link CreateTerminalRequest.worktree}. */
      worktree?: boolean | { branch?: string };
      /** Workspace provision choice for host-thread spawn (browser / product API). */
      workspace?: import('@zana-ai/zcc-domain').SpawnEnvironmentChoice;
      prompt?: string;
      personaId?: string;
      /** Marks a renderer-derived project/global default; main resolves it again. */
      profileSource?: 'explicit' | 'seeded-default';
      /** Advanced Quick Agent: framework preset ids (extensions with an
       *  `agentPreset`). Resolved + MERGED main-side into ONE synthetic persona
       *  whose joined primer is injected via `--append-system-prompt`. Ignored
       *  when `personaId` set. */
      frameworkIds?: string[];
      /** Execution environment (WHERE it runs): `'sandbox'` runs the agent under
       *  an OS kernel sandbox (Seatbelt on macOS), degrading honestly when the
       *  kernel can't enforce it. `'microvm'` runs it inside a hardware-isolated
       *  microVM (microsandbox), failing closed when the runtime is unavailable.
       *  Absent/`'local'` ⇒ a plain spawn. Main re-resolves it (Rule 1). See
       *  {@link CreateTerminalRequest.environment}. */
      environment?: 'local' | 'sandbox' | 'microvm';
      /** Deny outbound network from the sandboxed agent (sandbox env only). */
      sandboxDenyNetwork?: boolean;
      /** microVM advisory hints (env `'microvm'`); re-authorized in main (Rule 1). */
      microVmImage?: string;
      microVmCpus?: number;
      microVmMemoryMib?: number;
      /** Provider-native exact-session resume target (codex `resume <uuid>`):
       *  the prior rollout id to reopen. Used by session restore for a profile
       *  whose resume dialect is a positional subcommand that can't ride
       *  `extraArgs`. Selects WHICH session the CLI reopens; never a path
       *  (Rule 1). See {@link CreateTerminalRequest.resumeSessionId}. */
      resumeSessionId?: string;
      headless?: boolean;
      scheduled?: boolean;
      autoCloseOnFinish?: boolean;
      inboxLevel?: 'silent' | 'quiet' | 'loud';
      autonomous?: boolean;
      cohort?: import('@zana-ai/zcc-domain/product').SessionCohort;
      reconnectTmuxId?: string;
      resume?: boolean;
      /** Receives a launch failure for callers needing retained inline feedback
       *  in addition to the global error toast. */
      onError?: (message: string) => void;
    }
  ) => Promise<TerminalSession | null>;
  /**
   * Terminate a session: kills the pty and removes the tab. Always drops the
   * card even when close cannot be confirmed (a remote tmux that did not die)
   * so the board cannot keep ghosts. A toast still warns when the process may
   * be alive. Pushes a restorable snapshot onto closedTabs so ⌘⇧T can reopen
   * a fresh tab with the same profile/cwd/pinned/extraArgs. Wired to the
   * tab's X button, ⌘⇧W, middle-click, and the sidebar row X.
   */
  closeTerminal: (sessionId: string, projectId: string) => Promise<void>;
  /**
   * Bulk-close the given at-rest agents in a project (the Agents board's Close
   * action and the modal's "Close with follow-up" item). When `summarize` is
   * set, asks main FIRST to fold each agent's work into ONE inbox entry AND file
   * a follow-up for anything left unfinished (transcripts are read while the
   * ptys are still alive), then closes each session via the same per-session
   * {@link closeTerminal} path. Before killing, re-checks each agent's LIVE
   * status and skips any that drifted back to working/blocked while the confirm
   * dialog was open — a manual reclaim must never terminate an agent mid-task.
   * Returns how many were closed / summarized / followed up.
   */
  closeIdleAgents: (
    projectId: string,
    sessionIds: string[],
    summarize: boolean
  ) => Promise<{ closed: number; summarized: number; followedUp: number }>;
  /**
   * READ-ONLY companion to {@link closeIdleAgents}: fold the given idle agents'
   * work into ONE inbox entry and leave every agent RUNNING (the Agents board's
   * "Summarize" button). This is the "what did they do while I was away?" action
   * — it closes nothing. Returns how many were summarized.
   */
  summarizeIdleAgents: (
    projectId: string,
    sessionIds: string[]
  ) => Promise<{ summarized: number }>;
  /**
   * Summarize one live agent's work to the inbox on demand (the terminal
   * modal's "Summarize to inbox" button). Main reads the transcript, runs the
   * LLM micro-call, and appends the entry; the inbox feed updates live via its
   * onAppended push. Toasts the outcome and returns whether an entry was
   * written so the caller can reflect button state.
   */
  summarizeSession: (sessionId: string, projectId: string) => Promise<boolean>;
  /**
   * Detach a tab to the background without killing its pty. The session
   * stays alive as a headless runner; it's surfaced by the Background (N)
   * affordance and can be resumed via restoreTerminal (which re-attaches
   * the SAME live pty, preserving scrollback). This is the explicit
   * "Send to background" action — distinct from closeTerminal.
   */
  hideTerminal: (sessionId: string, projectId: string) => Promise<void>;
  /** Resume a detached (background) session back into the tab strip. */
  restoreTerminal: (sessionId: string, projectId: string) => Promise<void>;
  /**
   * Resume the most-recently-detached background session, if any. Returns
   * the resumed session id or null when nothing is detached. Backs ⌘⇧T's
   * "prefer un-detach over reopen-closed" behavior.
   */
  restoreLastDetached: (projectId: string) => Promise<string | null>;
  restartTerminal: (sessionId: string, projectId: string) => Promise<TerminalSession | null>;
  /**
   * Re-attach a REMOTE session whose local `ssh` proxy died while the machine
   * slept (its tab is now an exited tombstone). Asks main to spawn a fresh local
   * pty that re-attaches the still-live `cc-<tmuxId>` tmux session on the box
   * (falling back to a fresh agent resuming the transcript when it's gone), then
   * swaps the tombstone for the returned live session at the same slot,
   * preserving title/pin/selection. No-op for local or still-running sessions.
   * Backs both the auto-reconnect-on-wake path and the manual "Reconnect" button.
   */
  reconnectRemote: (sessionId: string, projectId: string) => Promise<TerminalSession | null>;
  reorderTerminal: (projectId: string, fromId: string, toId: string) => void;
  renameTerminal: (projectId: string, sessionId: string, title: string) => void;
  /**
   * Adopt Claude's auto-generated task summary (from the OSC title) as the tab
   * name. No-op when the user has manually renamed the tab (`titleLocked`) or
   * when the title is unchanged. Distinct from `renameTerminal`, which is the
   * explicit user action and sets the lock.
   */
  autoTitleTerminal: (sessionId: string, title: string, source?: 'osc' | 'llm') => void;
  setPinned: (projectId: string, sessionId: string, pinned: boolean) => void;
  markExited: (sessionId: string, exitCode?: number) => void;
}

/**
 * Guards `restoreSessions` to one run per app launch. Module-level (not store
 * state) so a store re-creation during a hot reload doesn't re-trigger restore,
 * but a genuine app relaunch (fresh module graph) resets it to false.
 */
let sessionsRestored = false;

/**
 * Filter out hidden (headless) terminals from a project's tab strip. Hidden
 * sessions still have a live pty — they're just not shown in the UI. The
 * scheduler creates them this way; the user also produces them by hiding a
 * tab — the tab's X button, ⌘W, ⌘⇧W, and middle-click all route to
 * `hideTerminal`. Terminating a process (and removing the tab) happens only
 * via the tab's right-click → Delete or the project-list row's X — see
 * `closeTerminal`.
 */
export function visibleTerminals(list: TerminalSession[] | undefined): TerminalSession[] {
  return (list ?? []).filter((t) => !t.headless);
}

/**
 * Sessions a project shows in its vertical lists (focus view + the inline
 * project-row expansion): everything the user opened, whether currently shown
 * in the tab strip or hidden (closed out of the strip but still alive). Only
 * scheduler-spawned jobs are excluded — those are surfaced via the inbox, not
 * the session list. Clicking a hidden session's row re-opens it as a tab.
 */
export function listedTerminals(list: TerminalSession[] | undefined): TerminalSession[] {
  return (list ?? []).filter((t) => !t.scheduled);
}

/**
 * Live sessions for a project's inline rail expansion: listed (non-scheduler)
 * sessions whose pty hasn't exited. Exited/dismissed agents drop out of the
 * rail automatically so it stays a view of what's actually running — the full
 * history (including exited tombstones) still lives in the project's drill-in
 * focus view. Feeds the Projects rail's per-project session tree.
 */
export function liveTerminals(list: TerminalSession[] | undefined): TerminalSession[] {
  return listedTerminals(list).filter((t) => t.status !== 'exited');
}

/**
 * Hidden, still-live sessions for a project: headless and not exited. A closed
 * tab whose process keeps running lands here (also the scheduler's own runs).
 * A user-hidden session that exits on its own is downgraded to an exited
 * tombstone (and pruned from detachedStack) in markExited, so anything here
 * has a running pty. Feeds the launcher's "Still running" quick-resume list.
 */
export function backgroundTerminals(list: TerminalSession[] | undefined): TerminalSession[] {
  return (list ?? []).filter((t) => t.headless && t.status !== 'exited');
}

export function sortProjectsForDisplay(projects: Project[]): Project[] {
  const anyManual = projects.some((p) => typeof p.sortIndex === 'number');
  return projects.slice().sort((a, b) => {
    if (anyManual) {
      const ai = typeof a.sortIndex === 'number' ? a.sortIndex : Number.POSITIVE_INFINITY;
      const bi = typeof b.sortIndex === 'number' ? b.sortIndex : Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
    }
    return b.lastActiveAt - a.lastActiveAt;
  });
}

/**
 * Case-insensitive alphabetical sort by display name (path as tiebreaker). Used
 * by the Projects rail, which groups projects into Remote / Local sections and
 * orders each A→Z rather than by recency. Pure; returns a new array.
 */
export function sortProjectsAlphabetically(projects: Project[]): Project[] {
  return projects.slice().sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return byName !== 0 ? byName : a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
  });
}

export const useData = create<DataState>((set, get) => ({
  projects: [],
  terminals: {},
  claudeSessions: {},
  closedTabs: {},
  detachedStack: {},
  gitStatus: {},
  fontSize: 13,
  theme: 'dark',
  terminalTheme: DEFAULT_TERMINAL_THEME,
  inboxGuidanceEnabled: true,
  terminalWheelArrowsEnabled: true,
  heartbeatEnabled: false,
  goalsEnabled: false,
  followUpsEnabled: false,
  idleAttentionSensitivity: 'medium',
  agentListNeedsYouFromTriage: false,
  voiceInputEnabled: false,
  steerActiveThreadOnEnter: false,
  autoCloseIdleEnabled: false,
  overseerMode: 'off',
  reviewerApprovalMode: 'ask',
  catchUpSummaryEnabled: false,
  catchUpSummaryDelaySeconds: 20,
  feedNoiseClassifierEnabled: false,
  suggestionsEnabled: false,
  structuredQuestionsEnabled: true,
  defaultHarness: null,
  configLoaded: false,
  harnessCursorEnabled: false,
  harnessCodexEnabled: false,
  harnessPiEnabled: false,
  harnessOpenCodeEnabled: false,
  harnessStatus: [],
  editorStatus: [],
  openerHiddenTargets: [],
  microVmEnabled: false,
  worktreeIsolationDefault: false,

  setFontSize(n) {
    set({ fontSize: n });
  },

  setTerminalTheme(id) {
    set({ terminalTheme: id });
  },

  setInboxGuidanceEnabled(on) {
    set({ inboxGuidanceEnabled: on });
  },

  setTerminalWheelArrowsEnabled(on) {
    set({ terminalWheelArrowsEnabled: on });
  },

  setHeartbeatEnabled(on) {
    set({ heartbeatEnabled: on });
  },


  setGoalsEnabled(on) {
    set({ goalsEnabled: on });
  },

  setFollowUpsEnabled(on) {
    set({ followUpsEnabled: on });
  },

  setCatchUpSummaryEnabled(on) {
    set({ catchUpSummaryEnabled: on });
  },

  setFeedNoiseClassifierEnabled(on) {
    set({ feedNoiseClassifierEnabled: on });
  },

  setSuggestionsEnabled(on) {
    set({ suggestionsEnabled: on });
  },

  setStructuredQuestionsEnabled(on) {
    set({ structuredQuestionsEnabled: on });
  },

  setHarnessCursorEnabled(on) {
    set({ harnessCursorEnabled: on });
    void prefetchThreadModelCatalog().catch(() => undefined);
  },

  setHarnessCodexEnabled(on) {
    set({ harnessCodexEnabled: on });
    void prefetchThreadModelCatalog().catch(() => undefined);
  },

  setHarnessPiEnabled(on) {
    set({ harnessPiEnabled: on });
    void prefetchThreadModelCatalog().catch(() => undefined);
  },

  setHarnessOpenCodeEnabled(on) {
    set({ harnessOpenCodeEnabled: on });
    void prefetchThreadModelCatalog().catch(() => undefined);
  },

  async refreshHarnessStatus() {
    try {
      const status = await product.harness.verify();
      set({ harnessStatus: status });
    } catch {
      set({ harnessStatus: [] });
    }
    void reloadThreadModelCatalog().catch(() => undefined);
  },

  async refreshEditorStatus() {
    try {
      const status = await product.editor.verify();
      set({ editorStatus: status });
    } catch {
      set({ editorStatus: [] });
    }
  },

  setOpenerHiddenTargets(targets) {
    set({ openerHiddenTargets: targets });
  },

  setMicroVmEnabled(on) {
    set({ microVmEnabled: on });
  },

  setWorktreeIsolationDefault(on) {
    set({ worktreeIsolationDefault: on });
  },

  setCatchUpSummaryDelaySeconds(seconds) {
    set({ catchUpSummaryDelaySeconds: seconds });
  },

  setIdleAttentionSensitivity(level) {
    set({ idleAttentionSensitivity: level });
  },

  setAgentListNeedsYouFromTriage(on) {
    set({ agentListNeedsYouFromTriage: on });
  },

  setVoiceInputEnabled(on) {
    set({ voiceInputEnabled: on });
  },

  async setAutoCloseIdleEnabled(on) {
    // Optimistic flip, persist, roll back on failure. Unlike the pure-local
    // setters above (which the Settings panel drives after its own config.set),
    // the sidebar toggle owns the whole round-trip, so it writes config here.
    const prev = get().autoCloseIdleEnabled;
    set({ autoCloseIdleEnabled: on });
    try {
      await product.config.set({ autoCloseIdleEnabled: on });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to toggle auto-close idle'));
      set({ autoCloseIdleEnabled: prev });
    }
  },

  async setOverseerMode(mode) {
    const prev = get().overseerMode;
    set({ overseerMode: mode });
    try {
      await product.config.set({ overseerMode: mode });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to toggle overseer'));
      set({ overseerMode: prev });
    }
  },

  async setReviewerApprovalMode(mode) {
    const prev = get().reviewerApprovalMode;
    set({ reviewerApprovalMode: mode });
    try {
      await product.config.set({ reviewerApprovalMode: mode });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to change approval mode'));
      set({ reviewerApprovalMode: prev });
    }
  },

  setReviewerApprovalModeLocal(mode) {
    set({ reviewerApprovalMode: mode });
  },

  async setHeartbeat(sessionId, projectId, on) {
    // Optimistic flip; the main-side setHeartbeat emits `sessionUpdated`, which
    // the onUpdated listener reconciles. Roll back on failure.
    set((s) => ({
      terminals: {
        ...s.terminals,
        [projectId]: (s.terminals[projectId] ?? []).map((t) =>
          t.id === sessionId ? { ...t, heartbeat: on || undefined } : t
        )
      }
    }));
    try {
      await product.terminals.setHeartbeat(sessionId, on);
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to toggle heartbeat'));
      set((s) => ({
        terminals: {
          ...s.terminals,
          [projectId]: (s.terminals[projectId] ?? []).map((t) =>
            t.id === sessionId ? { ...t, heartbeat: !on || undefined } : t
          )
        }
      }));
    }
  },

  async init() {
    try {
      const [projects, config] = await Promise.all([
        product.projects.list(),
        product.config.get()
      ]);
      // Hydrate the mirrored config flags from the SAME projection the live
      // `config.onChanged` handler uses (below), so boot and cross-window sync
      // can't diverge — every gate is listed in exactly one place
      // (`mirroredConfigFlags`). Only `projects` is init-specific.
      set({ projects, ...mirroredConfigFlags(config), configLoaded: true });
      applyTheme(config.theme);
      // Repaint live when the OS appearance flips and the app is on 'system'.
      bindSystemThemeListener();
      if (typeof config.listPaneWidth === 'number') {
        applyListPaneWidth(config.listPaneWidth);
      }
      if (typeof config.sidebarWidth === 'number') {
        applySidebarWidth(config.sidebarWidth);
      }
      // Live config sync across windows: main broadcasts `config:onChanged` to
      // EVERY window after any `config:set`, so a feature toggled off in one
      // window (e.g. Follow-ups) flips this window's mirrored gate at once
      // instead of lingering until reload. Re-apply the same config→flag
      // mapping init uses, plus theme (the other visible cross-window setting).
      product.config.onChanged((next) => {
        set(mirroredConfigFlags(next));
        applyTheme(next.theme);
        if (typeof next.listPaneWidth === 'number') {
          applyListPaneWidth(next.listPaneWidth);
        }
        if (typeof next.sidebarWidth === 'number') {
          applySidebarWidth(next.sidebarWidth);
        }
      });
      if (config.workspaceModes) {
        useUi.setState({ workspaceMode: config.workspaceModes });
      }
      if (
        config.agentsBoardView === 'board' ||
        config.agentsBoardView === 'list' ||
        config.agentsBoardView === 'flow'
      ) {
        useUi.setState({ agentsBoardView: config.agentsBoardView });
      }
      if (config.inboxGrouping === 'project' || config.inboxGrouping === 'time') {
        useUi.setState({ inboxGrouping: config.inboxGrouping });
      }
      // A per-project window is locked to its scoped project: force-select and
      // focus it. The main window (scopedProjectId === null) opens with no
      // project selected or focused — see the else branch.
      const scopedProjectId = getScopedProjectId();
      if (scopedProjectId && projects.find((p) => p.id === scopedProjectId)) {
        useUi.getState().selectProject(scopedProjectId);
        useUi.setState({ focusedProjectId: scopedProjectId, nav: 'projects' });
      } else {
        // The main window opens on Home with no project selected or focused.
        // Neither lastProjectId nor focusedProjectId is restored; the user
        // picks a project explicitly each session.
        // First-run walkthrough: auto-open once, in the main window only (a
        // scoped per-project window short-circuits above and never shows it).
        // The flag is flipped true when the user finishes/skips it, so it won't
        // re-open on later launches.
        if (!config.walkthroughCompleted) {
          useUi.setState({ walkthroughOpen: true });
        }
      }
      get().refreshAllGitStatus();
      // Probe which code harnesses are actually installed so the launcher can
      // gate the profile picker on enabled && installed (fire-and-forget — an
      // empty result just leaves every enabled harness selectable, as before).
      get().refreshHarnessStatus();

      // Hydrate live terminals from main. Sessions otherwise only reach the
      // renderer via `sessionUpdated` pushes, so any pty already running before
      // this renderer mounted (a scheduler-spawned tab, or a session that
      // outlived a renderer reload) would be invisible here. That divergence
      // made "Running now" read 0 while the scheduler kept skipping fires with
      // "previous run still active". Pull the current list per project so the
      // store reflects what main actually has alive.
      // Track projects whose hydration IPC failed: we couldn't learn whether
      // they have live ptys, so restore must skip them (else we'd risk double-
      // spawning on top of an invisible running session).
      const hydrationFailed = new Set<string>();
      await Promise.all(
        projects.map(async (p) => {
          try {
            const sessions = await product.terminals.list(p.id);
            if (sessions.length > 0) {
              set((s) => ({ terminals: { ...s.terminals, [p.id]: sessions } }));
            }
          } catch {
            /* couldn't read this project's live terminals — skip it on restore */
            hydrationFailed.add(p.id);
          }
        })
      );

      // Reattach surviving tmux sessions. Runs once per app launch (guarded),
      // after live ptys have hydrated so we never double-spawn on top of a
      // session that outlived a renderer reload.
      //
      // SKIPPED in a per-project window — tmux restore spans every project and
      // belongs to the unscoped main window. The scoped window already hydrated
      // its own live ptys above (display only).
      if (!isScopedWindow() && hasDesktopBridge()) {
        await get().restoreSessions(hydrationFailed);
      }
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to initialize app state'));
    }

    // Inbox: one-shot history load + push subscriptions. We get pushes for
    // appended/removed entries, so no polling. Optimistic deletes filter
    // locally before the IPC round-trip — the onRemoved push reconciles.
    //
    // In a per-project window the inbox is scoped to that project: every entry
    // carries a (required) projectId, so we fetch only this project's slice and
    // drop foreign-project pushes on arrival. The unread badge is scoped too
    // (see useUnreadInboxCount). The main window passes no projectId → all.
    const scopedProjectId = getScopedProjectId();
    // These post-hydration loads are mutually independent (different stores, no
    // cross-dependency), so fire them CONCURRENTLY rather than awaiting each in
    // turn — four serial IPC round-trips collapse to one wall-clock wait. Each
    // keeps its own try/catch so one failure can't reject the batch or block the
    // others. Push-subscriptions below are synchronous and registered regardless.
    const loadInbox = (async () => {
      try {
        const { entries } = await product.inbox.history({
          limit: 100,
          ...(scopedProjectId ? { projectId: scopedProjectId } : {})
        });
        useInbox.setState({ entries, loading: false });
      } catch {
        useInbox.setState({ loading: false });
      }
    })();
    const loadSuggestions = (async () => {
      try {
        const { entries } = await product.suggestions.list(scopedProjectId ?? undefined);
        useSuggestions.setState({ entries, loading: false });
      } catch {
        useSuggestions.setState({ loading: false });
      }
    })();
    const loadSaved = (async () => {
      try {
        const records = await product.saved.list();
        useSaved.setState({ records, loading: false });
      } catch {
        useSaved.setState({ loading: false });
      }
    })();
    const loadMesh = (async () => {
      try {
        const [agents, messages] = await Promise.all([
          product.agents.list(),
          product.agents.messages()
        ]);
        useAgentMesh.setState({ agents, messages });
      } catch {
        /* mesh view is best-effort; leave empty on failure */
      }
    })();
    await Promise.all([loadInbox, loadSuggestions, loadSaved, loadMesh]);

    product.inbox.onAppended((entry) => {
      if (scopedProjectId && entry.projectId !== scopedProjectId) return;
      useInbox.getState().prepend(entry);
    });
    product.inbox.onRemoved((id) => {
      useInbox.getState().removeLocal(id);
      pruneInboxMarkers([id]);
    });
    product.inbox.onUpdated((entry) => {
      if (scopedProjectId && entry.projectId !== scopedProjectId) return;
      useInbox.getState().upsert(entry);
    });
    product.inbox.onPruned((removedIds) => {
      // Retention rolled these off disk: drop the rows and prune the persisted
      // read/answered/saved/keep markers so those localStorage maps stay bounded.
      useInbox.getState().removeManyLocal(removedIds);
      pruneInboxMarkers(removedIds);
    });

    // Suggested Actions (afl-03): push subscriptions (the one-shot list load ran
    // concurrently above). Scoped to the window's project like the inbox. A
    // sibling surface, not a feed category.
    product.suggestions.onAppended((entry) => {
      if (scopedProjectId && entry.projectId !== scopedProjectId) return;
      useSuggestions.getState().prepend(entry);
    });
    product.suggestions.onRemoved((id) => {
      useSuggestions.getState().removeLocal(id);
    });
    product.suggestions.onUpdated((entry) => {
      if (scopedProjectId && entry.projectId !== scopedProjectId) return;
      useSuggestions.getState().upsert(entry);
    });
    product.suggestions.onPruned((removedIds) => {
      useSuggestions.getState().removeManyLocal(removedIds);
    });

    // Saved reports: full-list push (the one-shot list load ran concurrently
    // above). Low volume, so main replaces the whole list on every save/delete.
    product.saved.onChanged((records) => {
      useSaved.setState({ records, loading: false });
    });

    // Agent mesh: live pushes (the one-shot registry + message load ran
    // concurrently above). Registry changes (register/seed/drop) re-fetch the
    // whole list; each agent→agent message prepends. Read-only — the renderer
    // never mutates the mesh, it only mirrors it for the Agents board.
    product.agents.onRegistryChanged(() => {
      product.agents
        .list()
        .then((agents) => useAgentMesh.getState().setAgents(agents))
        .catch(() => {});
    });
    product.agents.onMessage((msg) => {
      useAgentMesh.getState().prependMessage(msg);
    });
    product.agents.onMessagesPruned((removedIds) => {
      useAgentMesh.getState().removeMessages(removedIds);
    });

    // Auto-update: subscribe to the main-process event stream. The boot check
    // is kicked from main; here we mirror status into the store (for the About
    // section) and surface the key transitions as toasts. Progress is stored
    // but not toasted — the About section renders the bar.
    product.updates.onStatus((status) => {
      const prev = useUpdates.getState().status;
      useUpdates.setState({ status });
      if (status.kind === 'available') {
        // A newly-available version un-dismisses the banner (a × earlier in the
        // session shouldn't suppress a different, newer release).
        if (prev.kind !== 'available' || prev.version !== status.version) {
          useUpdateBanner.getState().reset();
        }
        // The prominent banner now carries the call to action; no toast needed
        // (a toast on every boot-check would be noise). The banner + About
        // section both drive the same electron-updater download/skip flow.
      } else if (status.kind === 'downloaded') {
        // A staged, ready-to-install update is exactly when the "Restart now"
        // prompt matters most — un-dismiss so it resurfaces even if the user
        // had dismissed the earlier `available` banner (or kicked the download
        // off from Settings → About).
        useUpdateBanner.getState().reset();
        const v = status.version ? ` v${status.version}` : '';
        useUi
          .getState()
          .pushToast(`Update${v} ready — installs when you quit`);
      } else if (status.kind === 'error') {
        useUi.getState().pushToast(`Update check failed: ${status.message ?? 'unknown error'}`, 'error');
      }
    });
    product.updates.onProgress((progress) => {
      useUpdates.setState({ progress });
    });
    // Seed from main's remembered status: the boot check runs before this
    // listener is attached, so an `available` found at launch would otherwise be
    // missed by the UI (it only lands in the inbox, which main writes directly).
    // Pull it once so the banner/footer reflect a launch-time update. Only apply
    // a meaningful status so this can't clobber a live push that raced ahead.
    product.updates
      .getStatus()
      .then((status) => {
        if (status.kind === 'idle') return;
        if (useUpdates.getState().status.kind !== 'idle') return;
        useUpdates.setState({ status });
        if (status.kind === 'available' || status.kind === 'downloaded') {
          useUpdateBanner.getState().reset();
        }
      })
      .catch(() => {});

    // "What's New" on first launch after an update: pull the window main computed
    // at boot (a pull, so this can't miss a push that raced ahead of mount). The
    // consume call also advances main's seen-baseline, so it fires exactly once.
    // We show ONLY the version the user just updated TO — a single, focused
    // "here's what's new" card, not a backlog of every version they skipped.
    // (The About tab's "What's new" link still shows the full history on demand.)
    product.updates
      .consumeWhatsNew()
      .then(async (evt) => {
        if (!evt) return;
        const notes = await product.updates.getReleaseNotes({
          fromVersion: evt.fromVersion,
          toVersion: evt.toVersion
        });
        // Keep just the latest release's notes for the auto-modal.
        const latest = notes.length > 0 ? [notes[0]] : [];
        useWhatsNew.getState().openWith(latest, evt.toVersion);
      })
      .catch(() => {});

    // First-run dependency doctor: subscribe to the main-process detection /
    // install stream. Main kicks the boot check; here we mirror the snapshot
    // and surface the checklist once on first launch when something's missing
    // and the user hasn't dismissed it (the scoped-window short-circuit above
    // means this only runs in the main window, like the walkthrough). A fresh
    // status clears the stale per-step progress captions.
    // Capture the dismissed flag once: a per-project window never auto-opens
    // (mirrors the walkthrough), and a fresh config read keeps this independent
    // of the earlier try-block's `config` binding.
    const setupDismissed = await product.config
      .get()
      .then((c) => !!c.setupDismissed)
      .catch(() => true);
    const setupScopedId = getScopedProjectId();
    product.deps.onStatus((status) => {
      useSetup.setState({ status, progress: {} });
      if (!setupScopedId && !setupDismissed && hasMissingSetup(status)) {
        // Don't fight the walkthrough for the screen on a truly fresh install —
        // only auto-open the checklist when the walkthrough isn't also opening.
        if (!useUi.getState().walkthroughOpen) {
          useUi.setState({ setupOpen: true });
        }
      }
    });
    product.deps.onProgress((p) => {
      useSetup.setState((s) => ({ progress: { ...s.progress, [p.id]: p.message } }));
    });
    // Seed the current snapshot in case the boot check already completed before
    // this subscription attached (the push is deduped, so a late subscriber
    // would otherwise miss it).
    product.deps
      .get()
      .then((status) => useSetup.setState((s) => ({ status, progress: s.progress })))
      .catch(() => {});

    // Scheduler: one-shot list + push subscription. The main process emits
    // `scheduler:onChanged` after every fire and after every CRUD action,
    // so the panel never needs to poll.
    try {
      const tasks = await product.scheduler.list();
      useScheduler.setState({ tasks, loading: false });
    } catch {
      useScheduler.setState({ loading: false });
    }
    product.scheduler.onChanged((tasks) => {
      useScheduler.setState({ tasks });
    });

    // Goals: one-shot list + push subscription, mirroring the scheduler. Main
    // emits `goals:onChanged` after every CRUD action, every iteration spawn,
    // and every evaluator verdict, so the panel never polls.
    try {
      const goals = await product.goals.list();
      useGoals.setState({ goals, loading: false });
    } catch {
      useGoals.setState({ loading: false });
    }
    product.goals.onChanged((goals) => {
      useGoals.setState({ goals });
    });

    // Follow-ups: one-shot list + push subscription, mirroring goals. Main emits
    // `followups:onChanged` after every CRUD action and every idle-triage bridge,
    // so the panel never polls.
    try {
      const followups = await product.followups.list();
      useFollowUps.setState({ followups, loading: false });
    } catch {
      useFollowUps.setState({ loading: false });
    }
    product.followups.onChanged((followups) => {
      useFollowUps.setState({ followups });
    });

    // Templates: same one-shot + push pattern. Main watches the user dir +
    // per-project dirs for hand-edited files and pushes refreshed lists.
    try {
      const templates = await product.scheduler.listTemplates();
      useScheduleTemplates.setState({ templates, loading: false });
    } catch {
      useScheduleTemplates.setState({ loading: false });
    }
    product.scheduler.onTemplatesChanged((templates) => {
      useScheduleTemplates.setState({ templates });
    });

    // Personas: one-shot list + push. Main watches the user dir + per-project
    // dirs for hand-edited persona files and pushes refreshed lists.
    try {
      const personas = await product.personas.list();
      usePersonas.setState({ personas, loading: false });
    } catch {
      usePersonas.setState({ loading: false });
    }
    product.personas.onChanged((personas) => {
      usePersonas.setState({ personas });
    });

    // Teams: one-shot list + push, mirroring personas. Main merges builtin/user/
    // project/extension teams and pushes a refreshed list on any change.
    try {
      const teams = await product.teams.list();
      useTeams.setState({ teams, loading: false });
    } catch {
      useTeams.setState({ loading: false });
    }
    product.teams.onChanged((teams) => {
      useTeams.setState({ teams });
    });

    // Autonomous runs: one-shot list + push, mirroring teams. Live-only (no
    // persistence); the main supervisor pushes a refreshed list on every change.
    try {
      const runs = await product.autonomousRuns.list();
      useAutonomousRuns.setState({ runs });
    } catch {
      /* leave empty */
    }
    product.autonomousRuns.onChanged((runs) => {
      useAutonomousRuns.setState({ runs });
    });

    // Projects: live refresh when the list changes out-of-band — notably when
    // an agent adds a cloned repo via the `register_project` MCP tool. The
    // renderer's own add/remove/reorder still drive `loadProjects()` directly;
    // this push covers mutations the renderer didn't initiate.
    product.projects.onChanged((projects) => {
      set({ projects });
    });

    // Library: one-shot list + full-list push (like saved). Reconciled on read:
    // manifest + on-disk, both scopes, newest-first.
    try {
      const docs = await product.library.list();
      useLibrary.setState({ docs, loading: false });
    } catch {
      useLibrary.setState({ loading: false });
    }
    product.library.onChanged((docs) => {
      useLibrary.setState({ docs, loading: false });
    });

    // Schedule groups: one-shot + push. Main seeds Personal/Work on first run
    // and watches ~/.zcc/groups.json for hand edits.
    try {
      const groups = await product.scheduler.groups.list();
      useScheduleGroups.setState({ groups, loading: false });
    } catch {
      useScheduleGroups.setState({ loading: false });
    }
    product.scheduler.groups.onChanged((groups) => {
      useScheduleGroups.setState({ groups });
    });

    // Plugins + MCP catalogues: same one-shot + push pattern. Main fans out
    // a single debounced fs.watch into `plugins:onChanged` and `mcp:onChanged`
    // so we never poll.
    try {
      const entries = await product.plugins.list();
      usePlugins.setState({ entries, loading: false });
    } catch {
      usePlugins.setState({ loading: false });
    }
    product.plugins.onChanged((entries) => {
      usePlugins.setState({ entries });
    });

    try {
      const entries = await product.mcp.listAll();
      useMcpCatalogue.setState({ entries, loading: false });
    } catch {
      useMcpCatalogue.setState({ loading: false });
    }
    product.mcp.onChanged((entries) => {
      useMcpCatalogue.setState({ entries });
    });

    // Session metadata changes (e.g. title/headless changes, exit transitions,
    // or a scheduler-spawned tab being broadcast) come in via this push so the
    // tab strip re-renders without polling.
    product.terminals.onUpdated((session) => {
      set((s) => {
        const list = s.terminals[session.projectId];
        if (!list) {
          return { terminals: { ...s.terminals, [session.projectId]: [session] } };
        }
        const idx = list.findIndex((t) => t.id === session.id);
        if (idx === -1) {
          return {
            terminals: { ...s.terminals, [session.projectId]: [...list, session] }
          };
        }
        const next = list.slice();
        const local = next[idx];
        const merged = { ...local, ...session };
        // Renderer-authoritative title: a user rename (titleLocked) must not be
        // overwritten by main's stale creation-time title.
        if (local.titleLocked) {
          merged.title = local.title;
          merged.titleLocked = true;
        }
        next[idx] = merged;
        return { terminals: { ...s.terminals, [session.projectId]: next } };
      });
    });

    // Live agent-state pushes land in their own store (useAgentStatus), keyed
    // by session id, with a precomputed per-project rollup. We resolve the
    // owning project from useData here so the status event itself stays a
    // lean (sessionId, state, seq) tuple.
    product.terminals.onAgentStatus((sessionId, state, seq) => {
      const projectId = findProjectIdForSession(sessionId);
      if (!projectId) return;
      useAgentStatus.getState().apply(sessionId, projectId, state, seq);
      // A triage read is about a specific idle spell — once the agent leaves
      // idle, drop its badge so a stale "done/awaiting" hint can't linger on a
      // now-working card. (The main service re-triages on the next idle edge.)
      if (state !== 'idle') useIdleTriage.getState().clear(sessionId);
      // A catch-up summary is about a specific idle/blocked spell — once the
      // agent leaves the trigger state, clear the stale summary so a fresh spell
      // starts clean (shimmer, not old text). The backend re-fires on the next edge.
      if (state !== 'idle' && state !== 'blocked') {
        useCatchUpSummary.getState().clear(sessionId);
      }
    });

    // Live sub-agent (Task tool) counts land in their own slice (useSubagents),
    // keyed by parent session id. Kept off onAgentStatus so a sub-agent
    // start/stop never rebuilds the status rollup — it only badges the parent.
    product.terminals.onSubagents((sessionId, count) => {
      useSubagents.getState().apply(sessionId, count);
    });
    // Seed sub-agent counts for any parent already fanned out before this window
    // opened — onSubagents is edge-triggered and would otherwise miss them.
    product.terminals
      .subagentSnapshot()
      .then((pairs) => {
        for (const [sessionId, count] of pairs) {
          useSubagents.getState().apply(sessionId, count);
        }
      })
      .catch(() => {
        /* best-effort seed; live pushes will catch up */
      });
    // Seed agent state via sinceSeq-based reseed: replay missed transitions when no
    // buffer gap, else fall back to a full snapshot. onAgentStatus is edge-triggered,
    // so a window opened after an agent's last transition (every per-project sub-window
    // / "Open in new window") would otherwise read `unknown` for every card.
    // Resolve the owning project the same way the live handler above does.
    product.terminals
      .agentStatusSince(useAgentStatus.getState().lastSeq)
      .then((result) => {
        if (result.mode === 'replay') {
          // Replay missed transitions in order.
          for (const [seq, sessionId, state] of result.events) {
            const projectId = findProjectIdForSession(sessionId);
            if (!projectId) continue;
            useAgentStatus.getState().apply(sessionId, projectId, state, seq);
          }
        } else {
          // Snapshot fallback: apply the full snapshot, then advance lastSeq to headSeq.
          for (const [sessionId, state] of result.snapshot) {
            const projectId = findProjectIdForSession(sessionId);
            if (!projectId) continue;
            useAgentStatus.getState().apply(sessionId, projectId, state);
          }
        }
        // Always advance lastSeq to headSeq at the end (both modes).
        const currentState = useAgentStatus.getState();
        if (result.headSeq > currentState.lastSeq) {
          useAgentStatus.setState({ lastSeq: result.headSeq });
        }
      })
      .catch(() => {
        /* best-effort seed; live pushes will catch up */
      });

    // Per-child sub-agent records (name/type + running/done) — sibling channel
    // to onSubagents, lands in its own slice for the same render-storm reason.
    product.terminals.onSubagentChildren((sessionId, children) => {
      useSubagentChildren.getState().apply(sessionId, children);
    });
    // Seed child records for parents already fanned out before this window
    // opened — edge-triggered like the count snapshot.
    product.terminals
      .subagentChildrenSnapshot()
      .then((pairs) => {
        for (const [sessionId, children] of pairs) {
          useSubagentChildren.getState().apply(sessionId, children);
        }
      })
      .catch(() => {
        /* best-effort seed; live pushes will catch up */
      });

    // Idle-triage add-on (off by default): WHY an idle agent is idle. Lands in
    // its own slice keyed by session id, surfaced as a badge on idle cards.
    product.terminals.onIdleTriage((result) => {
      useIdleTriage.getState().apply(result);
    });

    // Overseer activity (auto-approve cascade; off by default): per-session
    // counts of what the cascade auto-approved / handed back. Own slice keyed by
    // session id, surfaced as a badge on the agent card. Unlike idle-triage it's
    // NOT cleared on leaving idle — the count is about the session's lifetime, so
    // it persists until the tab closes (cleared in the close/clearProject paths).
    product.terminals.onOverseerActivity((activity) => {
      useOverseerActivity.getState().apply(activity);
    });

    // Catch-up summary add-on (EXPERIMENTAL, off by default): a precomputed
    // markdown summary of where the agent is and what changed, surfaced under
    // the terminal in the agent modal when the agent sits idle or blocked long
    // enough. Own slice keyed by session id, mirroring onIdleTriage pattern.
    product.terminals.onCatchUpSummary((result) => {
      useCatchUpSummary.getState().apply(result);
    });

    // Tab auto-rename: Claude writes a task summary into its idle OSC title;
    // main parses it and pushes it here. Adopt it as the tab name unless the
    // user has manually renamed the tab.
    product.terminals.onTitle((sessionId, title, source) => {
      get().autoTitleTerminal(sessionId, title, source);
    });

    // Machine woke from sleep: a remote tab's local `ssh` proxy dies mid-sleep
    // (the frozen TCP link RSTs on wake → ssh exits ~255, or the zombie is
    // reaped as -1), leaving an exited tombstone. But the agent itself survives
    // inside `tmux new -A -s cc-<id>` on the box, so auto-reconnect each such
    // tombstone: reconnectRemote re-attaches the live session (or resumes the
    // transcript if the box's tmux is gone).
    //
    // The reconnect predicate is deliberately narrow to avoid resurrecting a
    // session the user genuinely ended:
    //  - non-zero exitCode — a clean /exit, a finished agent, and an explicit
    //    tab close all finalize as 0, so they stay dead; a dropped link is
    //    always non-zero (255 / -1 / a signal code).
    //  - remoteTmuxId present — the session WAS wrapped in a persistent tmux
    //    session, so a live agent plausibly survives to re-attach. A remote
    //    spawned without persistence has nothing to re-attach and is left for
    //    the manual button.
    // Guarded to remote projects inside reconnectRemote too; we pre-filter here
    // to avoid churning the whole session map. Sequential to avoid a burst of
    // concurrent ssh spawns.
    product.terminals.onWake(() => {
      // The proxy's exit event may still be in flight when wake fires. Give it a
      // beat so the tombstone and its exit code are settled before we scan.
      setTimeout(() => {
        void (async () => {
          const { projects, terminals } = get();
          const remoteIds = new Set(projects.filter((p) => p.remote).map((p) => p.id));
          for (const [pid, list] of Object.entries(terminals)) {
            if (!remoteIds.has(pid)) continue;
            const stale = list.filter(
              (t) =>
                t.status === 'exited' &&
                t.exitCode != null &&
                t.exitCode !== 0 &&
                !!t.remoteTmuxId
            );
            for (const tab of stale) {
              await get().reconnectRemote(tab.id, pid);
            }
          }
        })();
      }, 1500);
    });
  },

  async loadProjects() {
    try {
      const projects = await product.projects.list();
      set({ projects });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to load projects'));
    }
  },

  async loadClaudeSessions(projectId) {
    const project = get().projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      const sessions = await product.claude.listSessions(projectId);
      set((s) => ({ claudeSessions: { ...s.claudeSessions, [projectId]: sessions } }));
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to load Claude sessions'));
    }
  },

  async addProject() {
    try {
      const path = await product.projects.pickDirectory();
      if (!path) return null;
      const result = await product.projects.add(path);
      if (!result.ok) {
        pushErrorToast(result.message);
        return null;
      }
      await get().loadProjects();
      return result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to add project'));
      return null;
    }
  },

  async addProjectByPath(path, opts) {
    try {
      const result = await product.projects.add(path, opts);
      if (!result.ok) {
        pushErrorToast(result.message);
        return null;
      }
      await get().loadProjects();
      return result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to add project'));
      return null;
    }
  },

  async addRemoteProject(input) {
    try {
      const result = await product.projects.addRemote(input);
      if (!result.ok) {
        pushErrorToast(result.message);
        return null;
      }
      await get().loadProjects();
      return result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to add remote project'));
      return null;
    }
  },

  async cloneProject(input) {
    try {
      const result = await product.projects.clone(input);
      // The dialog surfaces failures inline (it needs the code/path for the
      // DEST_EXISTS branch), so we DON'T toast here — just refresh on success.
      if (result.ok) await get().loadProjects();
      return result;
    } catch (err) {
      return {
        ok: false as const,
        code: 'CLONE_FAILED' as const,
        message: errorMessage(err, 'Failed to clone repository')
      };
    }
  },

  async updateProject(id, patch) {
    try {
      const updated = await product.projects.update(id, patch);
      if (!updated) return;
      // Preserve the in-memory lastActiveAt (and sortIndex). Disk may have a
      // newer lastActiveAt from an earlier `touch`, but adopting it here would
      // re-sort the sidebar mid-session — same reason selectProject doesn't.
      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === id
            ? { ...updated, lastActiveAt: p.lastActiveAt, sortIndex: p.sortIndex }
            : p
        )
      }));
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to update project'));
    }
  },

  async reorderProjects(orderedIds) {
    // Optimistically reorder locally to avoid drag flicker.
    set((s) => {
      const byId = new Map(s.projects.map((p) => [p.id, p]));
      const next: Project[] = [];
      let i = 0;
      for (const id of orderedIds) {
        const p = byId.get(id);
        if (!p) continue;
        next.push({ ...p, sortIndex: i++ });
        byId.delete(id);
      }
      for (const leftover of byId.values()) next.push({ ...leftover, sortIndex: i++ });
      return { projects: next };
    });
    try {
      const persisted = await product.projects.reorder(orderedIds);
      // IPC's error fallback is `[]`. Don't wipe the optimistic order (or
      // the whole sidebar) when persist returns an empty list.
      if (Array.isArray(persisted) && persisted.length > 0) {
        set({ projects: persisted });
      }
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to reorder projects'));
      await get().loadProjects();
    }
  },

  async removeProject(id) {
    try {
      await product.projects.remove(id);
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to remove project'));
      return;
    }
    // Forget the project's live agent states/rollup BEFORE we wipe terminals —
    // clearProject reads session membership from the still-populated map. Drop
    // any idle-triage badges for the project's sessions in the same window.
    for (const t of get().terminals[id] ?? []) {
      useIdleTriage.getState().clear(t.id);
      useOverseerActivity.getState().clear(t.id);
      useSubagents.getState().clear(t.id);
      useSubagentChildren.getState().clear(t.id);
      useCatchUpSummary.getState().clear(t.id);
    }
    useAgentStatus.getState().clearProject(id);
    set((s) => {
      const terminals = { ...s.terminals };
      const claudeSessions = { ...s.claudeSessions };
      const closedTabs = { ...s.closedTabs };
      const gitStatus = { ...s.gitStatus };
      delete terminals[id];
      delete claudeSessions[id];
      delete closedTabs[id];
      delete gitStatus[id];
      return {
        projects: s.projects.filter((p) => p.id !== id),
        terminals,
        claudeSessions,
        closedTabs,
        gitStatus
      };
    });
    useUi.setState((s) => {
      const patch: Partial<UiState> = {};
      const drop = <K extends keyof UiState>(key: K) => {
        const cur = s[key] as Record<string, unknown> | undefined;
        if (cur && id in cur) {
          const next = { ...cur };
          delete next[id];
          (patch as Record<string, unknown>)[key as string] = next;
        }
      };
      drop('workspaceMode');
      drop('splitLayout');
      drop('splitTabIds');
      drop('selectedTabId');
      drop('projectExpanded');
      drop('recentFiles');
      drop('explorerFile');
      drop('explorerGoto');
      drop('explorerDiff');
      drop('explorerTreeMode');
      return patch;
    });
    persistWorkspaceModes();
  },

  async createTerminal(projectId, profile, cols, rows, opts) {
    try {
      const result = await product.terminals.create({
        projectId,
        profile,
        profileSource: opts?.profileSource,
        personaId: opts?.personaId,
        frameworkIds: opts?.frameworkIds,
        cols,
        rows,
        extraArgs: opts?.extraArgs,
        harnessRouting: opts?.harnessRouting,
        title: opts?.title,
        cwd: opts?.cwd,
        isolateScratch: opts?.isolateScratch,
        worktree: opts?.worktree,
        prompt: opts?.prompt,
        environment: opts?.environment,
        sandboxDenyNetwork: opts?.sandboxDenyNetwork,
        microVmImage: opts?.microVmImage,
        microVmCpus: opts?.microVmCpus,
        microVmMemoryMib: opts?.microVmMemoryMib,
        resumeSessionId: opts?.resumeSessionId,
        cohort: opts?.cohort,
        headless: opts?.headless
      });
      if (!result.ok) {
        opts?.onError?.(result.message);
        pushErrorToast(result.message);
        console.error('terminal create failed', result);
        return null;
      }
      // Idempotent append: ptys.create() emits `sessionUpdated` synchronously,
      // which the onUpdated handler may have already appended before this IPC
      // promise resolves (the two messages race). Dedupe by id so a click
      // never yields two tabs for the same session.
      set((s) => {
        const list = s.terminals[projectId] || [];
        if (list.some((t) => t.id === result.value.id)) return s;
        return {
          terminals: { ...s.terminals, [projectId]: [...list, result.value] }
        };
      });
      return result.value;
    } catch (err) {
      const message = errorMessage(err, 'Failed to create terminal');
      opts?.onError?.(message);
      pushErrorToast(message);
      return null;
    }
  },

  async restoreSessions(skipProjectIds) {
    if (sessionsRestored) return; // once per app launch
    sessionsRestored = true;
    const { projects, terminals } = get();
    // Main owns restore capabilities and can see surviving tmux sessions.
    // This path only reattaches processes that outlived quit.
    const knownProjects = new Set(projects.filter((project) => !project.remote).map((project) => project.id));
    const liveProjects = new Set(Object.entries(terminals)
      .filter(([, sessions]) => sessions.some((session) => session.status !== 'exited'))
      .map(([projectId]) => projectId));
    const tmuxCandidates = await product.terminals.listTmuxRestoreCandidates();
    const plan = tmuxCandidates.filter((candidate) => {
      if (!knownProjects.has(candidate.projectId) || liveProjects.has(candidate.projectId)) return false;
      if (skipProjectIds?.has(candidate.projectId)) return false;
      return true;
    });
    if (plan.length === 0) return;
    // Spawn sequentially: a burst of concurrent restores can race the same
    // per-project .mcp.json write and thrash the CLI's session store.
    for (const item of plan) {
      const restored = await product.terminals.restore({
        capabilityId: item.capabilityId
      });
      const created = restored.ok ? restored.value : null;
      if (!restored.ok) pushErrorToast(restored.message);
      if (created) {
        set((state) => {
          const list = state.terminals[item.projectId] ?? [];
          if (list.some((terminal) => terminal.id === created.id)) return state;
          return { terminals: { ...state.terminals, [item.projectId]: [...list, created] } };
        });
      }
    }
  },

  async closeTerminal(sessionId, projectId) {
    const list = get().terminals[projectId] || [];
    const closing = list.find((t) => t.id === sessionId);
    // Index within the VISIBLE strip so selection advances to the visual
    // neighbor, not a hidden background session. Matches hideTerminal.
    const closingIdx = visibleTerminals(list).findIndex((t) => t.id === sessionId);
    let closeFailed = false;
    try {
      if (!await product.terminals.close(sessionId)) closeFailed = true;
    } catch {
      closeFailed = true;
    }
    if (closeFailed) {
      pushErrorToast("Removed from the board. Couldn't confirm the process stopped.");
    }
    useUi.getState().clearUnread(sessionId);
    // If the closed tab occupied any split slot, drop it from the slots.
    useUi.getState().removeFromSplit(projectId, sessionId);
    if (closing) get().loadGitStatus(projectId);
    set((s) => {
      const remaining = (s.terminals[projectId] || []).filter((t) => t.id !== sessionId);
      const stack = (s.closedTabs[projectId] || []).slice();
      if (closing) {
        // Capture enough to reopen faithfully: cwd + pinned so a warm reopen
        // lands in the same directory and re-pins. Resume-picker tabs already
        // carry `--resume <id>` in extraArgs, so those reopen as a continued
        // conversation for free.
        stack.push({
          profile: closing.profile,
          title: closing.title,
          extraArgs: closing.extraArgs,
          cwd: closing.cwd,
          pinned: closing.pinned
        });
        if (stack.length > 10) stack.splice(0, stack.length - 10);
      }
      // A closed tab is also no longer detached (covers closing a background
      // session straight from the Background list).
      const detached = (s.detachedStack[projectId] || []).filter((id) => id !== sessionId);
      return {
        terminals: { ...s.terminals, [projectId]: remaining },
        closedTabs: { ...s.closedTabs, [projectId]: stack },
        detachedStack: { ...s.detachedStack, [projectId]: detached }
      };
    });
    // Drop the session's live agent state so the project rollup dot recomputes
    // (else a closed-while-idle session leaves a stale green dot behind). Runs
    // after the terminals `set` so recomputeRollup sees the session gone.
    useAgentStatus.getState().clear(sessionId, projectId);
    useIdleTriage.getState().clear(sessionId);
    useOverseerActivity.getState().clear(sessionId);
    useSubagents.getState().clear(sessionId);
    useSubagentChildren.getState().clear(sessionId);
    useCatchUpSummary.getState().clear(sessionId);
    // Advance selection: if the closed tab was active, pick the neighbor to
    // its right (else its left, else nothing). Without this, selectedTabId
    // dangles on a removed id and the workspace renders blank.
    const ui = useUi.getState();
    if (ui.selectedTabId[projectId] === sessionId) {
      const next = visibleTerminals(get().terminals[projectId]);
      const targetIdx = Math.min(closingIdx, next.length - 1);
      const target = targetIdx >= 0 ? next[targetIdx]?.id : undefined;
      ui.selectTab(projectId, target);
    }
  },

  async closeIdleAgents(projectId, sessionIds, summarize) {
    if (sessionIds.length === 0) return { closed: 0, summarized: 0, followedUp: 0 };
    // Re-check LIVE status right before we act. The confirm dialog is an open
    // dwell window during which an idle agent can resume (a scheduled fire, a
    // human reply) — a manual reclaim must never terminate an agent mid-task, so
    // drop any that drifted back to working/blocked. useAgentStatus is the same
    // live signal the board's lanes read, so this can't disagree with what the
    // user last saw. (Ids missing from the map are treated as still-eligible —
    // an unknown state is the at-rest default here, matching isIdleAgent.)
    const status = useAgentStatus.getState().byId;
    const ids = sessionIds.filter((id) => {
      const st = status[id];
      return st !== 'working' && st !== 'blocked';
    });
    if (ids.length === 0) {
      // Everything drifted back to working/blocked since the confirm opened — say
      // so rather than closing the dialog with no visible effect.
      useUi
        .getState()
        .pushToast(
          sessionIds.length === 1
            ? 'Agent is busy again — left it running.'
            : 'Those agents are busy again — left them running.',
          'info'
        );
      return { closed: 0, summarized: 0, followedUp: 0 };
    }

    // Summarize + (optionally) file follow-ups BEFORE closing: main reads each
    // agent's live transcript, so it must run while the ptys are still alive.
    // Main confines the ids to the project and never throws, but guard anyway —
    // a lost paper trail is never a reason to abort the close the user asked for.
    let summarized = 0;
    let followedUp = 0;
    if (summarize) {
      try {
        const res = await product.terminals.closeFollowup(projectId, ids);
        summarized = res.summarized;
        followedUp = res.followedUp;
      } catch (err) {
        pushErrorToast(errorMessage(err, 'Failed to summarize agents'));
      }
    }
    // Close each via the single-agent path so selection-advance, split removal,
    // and status/triage cleanup all stay correct. Sequential to keep the
    // selection math (it reindexes the visible strip each time) deterministic.
    let closed = 0;
    for (const id of ids) {
      try {
        await get().closeTerminal(id, projectId);
        closed++;
      } catch {
        // closeTerminal already toasts on the IPC failure; keep going.
      }
    }
    if (closed > 0) {
      const bits = [`Closed ${closed} agent${closed === 1 ? '' : 's'}`];
      if (followedUp > 0) bits.push(`${followedUp} follow-up${followedUp === 1 ? '' : 's'} filed`);
      useUi.getState().pushToast(`${bits.join(' · ')}.`, 'info');
    }
    return { closed, summarized, followedUp };
  },

  async summarizeIdleAgents(projectId, sessionIds) {
    if (sessionIds.length === 0) return { summarized: 0 };
    // Read-only: fold the agents into one inbox digest and leave them running.
    // Main reads live transcripts and never throws; guard the IPC anyway.
    try {
      const res = await product.terminals.summarizeIdle(projectId, sessionIds);
      if (res.summarized > 0) {
        useUi
          .getState()
          .pushToast(
            `Summarized ${res.summarized} agent${res.summarized === 1 ? '' : 's'} to your inbox.`,
            'info'
          );
      } else {
        useUi.getState().pushToast('Nothing to summarize yet.', 'info');
      }
      return { summarized: res.summarized };
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to summarize agents'));
      return { summarized: 0 };
    }
  },

  async summarizeSession(sessionId, projectId) {
    try {
      const res = await product.terminals.summarizeSession(projectId, sessionId);
      if (res.ok) {
        useUi.getState().pushToast('Summary sent to your inbox.', 'info');
        return true;
      }
      // Map the tagged failure to a specific, non-alarming message — most of
      // these are "nothing to summarize yet", not an error the user must act on.
      const message =
        res.reason === 'empty'
          ? 'Nothing to summarize yet — the agent has not produced any output.'
          : res.reason === 'ineligible'
            ? 'This session can’t be summarized (only Claude agents have a transcript).'
            : res.reason === 'write-failed'
              ? 'Summary was generated but could not be saved to the inbox.'
              : 'Could not summarize this session — please try again.';
      useUi.getState().pushToast(message, res.reason === 'empty' ? 'info' : 'error');
      return false;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to summarize session'));
      return false;
    }
  },

  async hideTerminal(sessionId, projectId) {
    // Flip the session's headless flag in main; visibleTerminals() filters
    // headless out so it disappears from the tab strip without killing the
    // pty. The session keeps running and can be restored via the headless
    // picker. We optimistically update the local copy so the UI reacts
    // before the IPC round-trip resolves.
    const list = get().terminals[projectId] || [];
    const target = list.find((t) => t.id === sessionId);
    if (!target) return;
    const targetIdx = list.findIndex((t) => t.id === sessionId);
    set((s) => ({
      terminals: {
        ...s.terminals,
        [projectId]: (s.terminals[projectId] ?? []).map((t) =>
          t.id === sessionId ? { ...t, headless: true } : t
        )
      }
    }));
    useUi.getState().clearUnread(sessionId);
    useUi.getState().removeFromSplit(projectId, sessionId);
    try {
      await product.terminals.setHeadless(sessionId, true);
    } catch (err) {
      // Revert on failure so the tab reappears rather than vanishing
      // silently. Failure is rare (only if the pty is already gone).
      pushErrorToast(errorMessage(err, 'Failed to send tab to background'));
      set((s) => ({
        terminals: {
          ...s.terminals,
          [projectId]: (s.terminals[projectId] ?? []).map((t) =>
            t.id === sessionId ? { ...t, headless: undefined } : t
          )
        }
      }));
      return;
    }
    // Record detach order (newest last) so ⌘⇧T resumes the most recent one.
    set((s) => {
      const cur = (s.detachedStack[projectId] || []).filter((id) => id !== sessionId);
      cur.push(sessionId);
      return { detachedStack: { ...s.detachedStack, [projectId]: cur } };
    });
    // Same selection-advance logic as closeTerminal: if the hidden tab was
    // active, pick the right neighbor (or left, or none).
    const ui = useUi.getState();
    if (ui.selectedTabId[projectId] === sessionId) {
      const next = visibleTerminals(get().terminals[projectId]);
      const advanceIdx = Math.min(targetIdx, next.length - 1);
      const advance = advanceIdx >= 0 ? next[advanceIdx]?.id : undefined;
      ui.selectTab(projectId, advance);
    }
  },

  async restoreTerminal(sessionId, projectId) {
    set((s) => ({
      terminals: {
        ...s.terminals,
        [projectId]: (s.terminals[projectId] ?? []).map((t) =>
          t.id === sessionId ? { ...t, headless: undefined } : t
        )
      },
      detachedStack: {
        ...s.detachedStack,
        [projectId]: (s.detachedStack[projectId] || []).filter((id) => id !== sessionId)
      }
    }));
    let updated: TerminalSession | null = null;
    try {
      updated = await product.terminals.setHeadless(sessionId, false);
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to resume session'));
      // Re-hide on failure to keep state consistent.
      set((s) => ({
        terminals: {
          ...s.terminals,
          [projectId]: (s.terminals[projectId] ?? []).map((t) =>
            t.id === sessionId ? { ...t, headless: true } : t
          )
        },
        detachedStack: {
          ...s.detachedStack,
          [projectId]: [...(s.detachedStack[projectId] || []), sessionId]
        }
      }));
      return;
    }
    // setHeadless returns null when the pty is already gone (the session
    // exited while detached). Don't surface a hollow, dead tab — drop the
    // record and tell the user, mirroring the zombie reap in markExited.
    if (updated === null) {
      const dead = (get().terminals[projectId] || []).find((t) => t.id === sessionId);
      set((s) => ({
        terminals: {
          ...s.terminals,
          [projectId]: (s.terminals[projectId] ?? []).filter((t) => t.id !== sessionId)
        }
      }));
      useUi.getState().clearUnread(sessionId);
      useAgentStatus.getState().clear(sessionId, projectId);
      useIdleTriage.getState().clear(sessionId);
      useOverseerActivity.getState().clear(sessionId);
      useSubagents.getState().clear(sessionId);
      useSubagentChildren.getState().clear(sessionId);
      useCatchUpSummary.getState().clear(sessionId);
      useUi
        .getState()
        .pushToast(
          `“${dead?.title ?? 'Session'}” ended while in the background`,
          'info'
        );
      return;
    }
    useUi.getState().selectTab(projectId, sessionId);
  },

  async restoreLastDetached(projectId) {
    const stack = get().detachedStack[projectId] || [];
    if (stack.length === 0) return null;
    const sessionId = stack[stack.length - 1];
    await get().restoreTerminal(sessionId, projectId);
    // restoreTerminal drops the id from the stack on both success and
    // dead-pty; return it only if the session is actually visible now.
    const alive = (get().terminals[projectId] || []).some(
      (t) => t.id === sessionId && !t.headless
    );
    return alive ? sessionId : null;
  },

  async restartTerminal(sessionId, projectId) {
    const list = get().terminals[projectId] || [];
    const idx = list.findIndex((t) => t.id === sessionId);
    if (idx === -1) return null;
    const src = list[idx];
    // Snapshot what we need before kill/reset — once we close the pty the
    // session may be removed from the live map and we lose pinned/title.
    // Also carries codex/opencode's detected session ids so a restart resumes
    // THIS tab's own conversation, not the cwd's most-recent one
    // (see resolveRestartProfile).
    const snapshot = {
      profile: src.profile,
      title: src.title,
      extraArgs: src.extraArgs,
      pinned: src.pinned,
      cwd: src.cwd,
      claudeSessionId: src.claudeSessionId,
      codexSessionId: src.codexSessionId,
      openCodeSessionId: src.openCodeSessionId
    };
    try {
      if (!await product.terminals.close(sessionId)) {
        pushErrorToast('Failed to restart terminal; its remote session may still be running');
        return null;
      }
    } catch {
      /* exited tabs already have a dead pty; close is a no-op */
    }
    useUi.getState().clearUnread(sessionId);
    useUi.getState().removeFromSplit(projectId, sessionId);
    set((s) => ({
      terminals: {
        ...s.terminals,
        [projectId]: (s.terminals[projectId] || []).filter((t) => t.id !== sessionId)
      }
    }));
    // The old session id is gone; clear its agent state so the rollup doesn't
    // carry a phantom status for the pre-restart pty.
    useAgentStatus.getState().clear(sessionId, projectId);
    useIdleTriage.getState().clear(sessionId);
    useOverseerActivity.getState().clear(sessionId);
    useSubagents.getState().clear(sessionId);
    useSubagentChildren.getState().clear(sessionId);
    useCatchUpSummary.getState().clear(sessionId);
    const resolved = resolveRestartProfile(
      snapshot.profile,
      snapshot.extraArgs,
      snapshot.claudeSessionId,
      snapshot.codexSessionId,
      snapshot.openCodeSessionId
    );
    const created = await get().createTerminal(projectId, resolved.profile, 80, 24, {
      extraArgs: resolved.extraArgs,
      title: snapshot.title,
      cwd: snapshot.cwd,
      resumeSessionId: resolved.resumeSessionId
    });
    if (!created) return null;
    // Re-insert at the original slot so the tab order doesn't jump to the end,
    // and re-apply pin if the source was pinned.
    set((s) => {
      const cur = s.terminals[projectId] || [];
      const created2 = cur.find((t) => t.id === created.id);
      if (!created2) return s;
      const without = cur.filter((t) => t.id !== created.id);
      const target = Math.min(idx, without.length);
      const restored = { ...created2, pinned: snapshot.pinned };
      const next = without.slice(0, target).concat(restored, without.slice(target));
      return { terminals: { ...s.terminals, [projectId]: next } };
    });
    useUi.getState().selectTab(projectId, created.id);
    return created;
  },

  async reconnectRemote(sessionId, projectId) {
    const project = get().projects.find((p) => p.id === projectId);
    // Reconnect only applies to remote projects — a local pty that "exited"
    // really died and has no detached tmux twin to re-attach to.
    if (!project?.remote) return null;
    const list = get().terminals[projectId] || [];
    const idx = list.findIndex((t) => t.id === sessionId);
    if (idx === -1) return null;
    const src = list[idx];
    // Snapshot before the swap — the tombstone is removed below and we'd lose
    // profile/title/pin/cwd/extraArgs otherwise (mirrors restartTerminal).
    const snapshot = {
      profile: src.profile,
      title: src.title,
      extraArgs: src.extraArgs,
      pinned: src.pinned,
      cwd: src.cwd,
      titleLocked: src.titleLocked,
      autoTitledByLlm: src.autoTitledByLlm,
      autoTitledByOsc: src.autoTitledByOsc
    };
    let created: TerminalSession | null;
    try {
      const result = await product.terminals.reconnectRemote({
        capabilityId: src.restoreCapabilityId,
        legacy: src.restoreCapabilityId ? undefined : {
          projectId,
          profile: snapshot.profile,
          sessionId: src.id
        }
      });
      if (!result.ok) {
        pushErrorToast(result.message);
        console.error('remote reconnect failed', result);
        return null;
      }
      created = result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to reconnect remote session'));
      return null;
    }
    if (!created) {
      pushErrorToast('Failed to reconnect remote session');
      return null;
    }
    // Swap the tombstone out and drop the freshly-appended live session into the
    // tombstone's original slot, preserving pin + rename guards + selection.
    // The new pty carries a FRESH id (main mints one so a late `onExit` from the
    // dead proxy can't kill the replacement), so remove BOTH the old tombstone
    // and the end-appended duplicate before re-inserting at `idx`.
    set((s) => {
      const cur = s.terminals[projectId] || [];
      const created2 = cur.find((t) => t.id === created.id) ?? created;
      const without = cur.filter((t) => t.id !== created.id && t.id !== sessionId);
      const target = Math.min(idx, without.length);
      const restored = {
        ...created2,
        pinned: snapshot.pinned,
        titleLocked: snapshot.titleLocked || created2.titleLocked,
        autoTitledByLlm: snapshot.autoTitledByLlm || created2.autoTitledByLlm,
        autoTitledByOsc: snapshot.autoTitledByOsc || created2.autoTitledByOsc
      };
      const next = without.slice(0, target).concat(restored, without.slice(target));
      return { terminals: { ...s.terminals, [projectId]: next } };
    });
    // The dead tombstone's id is retired; clear any residual per-session slices
    // keyed by it so a phantom status/summary can't linger on the new tab.
    useUi.getState().clearUnread(sessionId);
    useAgentStatus.getState().clear(sessionId, projectId);
    useIdleTriage.getState().clear(sessionId);
    useOverseerActivity.getState().clear(sessionId);
    useSubagents.getState().clear(sessionId);
    useSubagentChildren.getState().clear(sessionId);
    useCatchUpSummary.getState().clear(sessionId);
    useUi.getState().selectTab(projectId, created.id);
    return created;
  },

  async reopenLastClosed(projectId) {
    const stack = get().closedTabs[projectId] || [];
    if (stack.length === 0) return null;
    const top = stack[stack.length - 1];
    set((s) => ({
      closedTabs: {
        ...s.closedTabs,
        [projectId]: (s.closedTabs[projectId] || []).slice(0, -1)
      }
    }));
    const created = await get().createTerminal(projectId, top.profile, 80, 24, {
      extraArgs: top.extraArgs,
      title: top.title,
      cwd: top.cwd
    });
    // Re-pin if the closed tab was pinned, so reopen restores tab placement.
    if (created && top.pinned) {
      get().setPinned(projectId, created.id, true);
    }
    return created;
  },

  reorderTerminal(projectId, fromId, toId) {
    if (fromId === toId) return;
    set((s) => {
      const list = s.terminals[projectId];
      if (!list) return s;
      const fromIdx = list.findIndex((t) => t.id === fromId);
      const toIdx = list.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return s;
      // Pinned and unpinned tabs can't cross — they live in separate zones.
      if (list[fromIdx].pinned !== list[toIdx].pinned) return s;
      const next = list.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { terminals: { ...s.terminals, [projectId]: next } };
    });
  },

  setPinned(projectId, sessionId, pinned) {
    set((s) => {
      const list = s.terminals[projectId];
      if (!list) return s;
      const idx = list.findIndex((t) => t.id === sessionId);
      if (idx === -1) return s;
      const updated = { ...list[idx], pinned: pinned || undefined };
      const without = list.slice(0, idx).concat(list.slice(idx + 1));
      // Insert at the boundary: end of pinned zone (= start of unpinned zone).
      let insertAt = without.findIndex((t) => !t.pinned);
      if (insertAt === -1) insertAt = without.length;
      // When unpinning, drop at the start of the unpinned zone (= same boundary).
      const next = without.slice(0, insertAt).concat(updated, without.slice(insertAt));
      return { terminals: { ...s.terminals, [projectId]: next } };
    });
  },

  renameTerminal(projectId, sessionId, title) {
    set((s) => {
      const list = s.terminals[projectId];
      if (!list) return s;
      return {
        terminals: {
          ...s.terminals,
          // A manual rename pins the title: titleLocked stops the OSC-title
          // auto-rename from overwriting the user's explicit name.
          [projectId]: list.map((t) =>
            t.id === sessionId ? { ...t, title, titleLocked: true } : t
          )
        }
      };
    });
  },

  autoTitleTerminal(sessionId, title, source = 'osc') {
    const next = title.trim();
    if (!next) return;
    const projectId = findProjectIdForSession(sessionId);
    if (!projectId) return;
    const tab = (get().terminals[projectId] ?? []).find((t) => t.id === sessionId);
    if (!tab) return;
    // Manual rename always wins (titleLocked), and skip a no-op title.
    if (tab.titleLocked || tab.title === next) return;
    // Precedence: manual > LLM > first-OSC (once) > default.
    //  - An OSC idle-title is a ONE-SHOT fallback: it names a still-unnamed tab
    //    once, then stops. Once the tab has been OSC-named (autoTitledByOsc) or
    //    LLM-named (autoTitledByLlm), a later OSC summary no longer renames it —
    //    this is what stops the per-idle-spell churn (a peer message or a new
    //    turn used to re-title the tab to whatever Claude was last doing).
    //  - An LLM name (source 'llm', the first real prompt) still upgrades over a
    //    one-shot OSC name, and pins via autoTitledByLlm.
    if (source === 'osc' && (tab.autoTitledByLlm || tab.autoTitledByOsc)) return;
    set((s) => ({
      terminals: {
        ...s.terminals,
        [projectId]: (s.terminals[projectId] ?? []).map((t) =>
          t.id === sessionId
            ? {
                ...t,
                title: next,
                autoTitledByLlm: source === 'llm' ? true : t.autoTitledByLlm,
                autoTitledByOsc: source === 'osc' ? true : t.autoTitledByOsc
              }
            : t
        )
      }
    }));
  },

  markExited(sessionId, exitCode) {
    set((s) => {
      const terminals = { ...s.terminals };
      const detachedStack = { ...s.detachedStack };
      for (const pid of Object.keys(terminals)) {
        const tab = terminals[pid].find((t) => t.id === sessionId);
        if (!tab) continue;
        // Reap scheduler jobs: a scheduled (background-job) run is surfaced via
        // the inbox, never the session list, so when it ends drop it outright
        // and toast — even if it was promoted to a visible tab from the inbox,
        // it shouldn't leave a "[session exited]" tombstone behind.
        // User-opened sessions keep their tombstone whether or not they were
        // hidden from the tab strip — a closed-but-running tab that finishes
        // stays in the vertical list under "Exited" so the user can see how it
        // ended (and dismiss it), rather than vanishing silently.
        // A dead pty no longer drives a live agent state — clear it (deferred,
        // so we don't nest a useAgentStatus `set` inside this one) so the
        // project rollup dot stops showing the session's last status. Applies
        // whether the tab is reaped (zombie) or kept as an "exited" tombstone.
        const owningProject = pid;
        queueMicrotask(() => {
          useAgentStatus.getState().clear(sessionId, owningProject);
          useIdleTriage.getState().clear(sessionId);
          useOverseerActivity.getState().clear(sessionId);
          useSubagents.getState().clear(sessionId);
          useSubagentChildren.getState().clear(sessionId);
          useCatchUpSummary.getState().clear(sessionId);
        });
        if (tab.scheduled) {
          terminals[pid] = terminals[pid].filter((t) => t.id !== sessionId);
          detachedStack[pid] = (detachedStack[pid] || []).filter((id) => id !== sessionId);
          const code = exitCode ?? tab.exitCode;
          queueMicrotask(() => {
            // Drop the orphaned unread key too (mirrors restoreTerminal's
            // dead-pty path) so it doesn't linger in the unread map.
            useUi.getState().clearUnread(sessionId);
            useUi
              .getState()
              .pushToast(
                `Scheduled run “${tab.title}” ended${
                  code != null && code !== 0 ? ` (exit ${code})` : ''
                }`,
                code != null && code !== 0 ? 'error' : 'info'
              );
          });
        } else {
          terminals[pid] = terminals[pid].map((t) =>
            t.id === sessionId
              ? {
                  ...t,
                  status: 'exited' as const,
                  exitCode: exitCode ?? t.exitCode,
                  // Stamp the run-end once (don't overwrite if a duplicate exit
                  // fires) so the Agents view can show an exact run length.
                  finishedAt: t.finishedAt ?? Date.now()
                }
              : t
          );
          // It's now an exited tombstone, not a restorable hidden session, so
          // drop it from the detach stack — otherwise ⌘⇧T would pop this dead
          // id and the dead-pty path in restoreTerminal would silently delete
          // the tombstone instead of restoring a live session. detachedStack
          // must only ever hold sessions with a running pty (see
          // backgroundTerminals' contract).
          detachedStack[pid] = (detachedStack[pid] || []).filter((id) => id !== sessionId);
        }
      }
      return { terminals, detachedStack };
    });
  },

  async loadGitStatus(projectId) {
    const project = get().projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      const status = await product.git.status(project.path);
      set((s) => ({ gitStatus: { ...s.gitStatus, [projectId]: status } }));
    } catch {
      set((s) => ({ gitStatus: { ...s.gitStatus, [projectId]: null } }));
    }
  },

  async refreshAllGitStatus() {
    const projects = get().projects;
    // Sequential to avoid spawning N git processes at once.
    for (const p of projects) {
      try {
        const status = await product.git.status(p.path);
        set((s) => ({ gitStatus: { ...s.gitStatus, [p.id]: status } }));
      } catch {
        /* ignore */
      }
    }
  }
}));


export * from './stores/live.js';
