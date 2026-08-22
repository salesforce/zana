import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
} from '@shared/types';
import { DEFAULT_TERMINAL_THEME, type TerminalThemeId } from '@shared/terminalThemes';
import { seedPromptArgs } from '@shared/launch-provider';
import type { UsageSummary } from '@shared/telemetry-events';
import {
  snapshotTabs,
  planRestore,
  readSnapshot,
  writeSnapshot,
  resolveRestartProfile,
  type SessionSnapshotMap
} from './util/sessionRestore';
import { getScopedProjectId, isScopedWindow } from './util/windowScope';
import { isClaudeProfile, knownProfile, projectDefaultProfile } from './util/launchProfile';
import { buildFollowUpAnswerPrompt, followUpAgentTitle } from './util/followUpPrompt';
import { classifyEntry } from './util/feedCategories';

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
  | 'personas'
  | 'squads'
  | 'library'
  | 'usage'
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
  'personas',
  'squads',
  'library',
  'usage',
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
 * module's id (`AppModule.placement === 'settings'`). `'extensions'` is the
 * Extensions hub (lists every module + mounts its `settingsPanel`).
 * `'plugins' | 'skills' | 'mcp'` are the configuration catalogues, folded in
 * from their former top-level rail destinations. `(string & {})` keeps the
 * core literals in autocomplete while allowing a module id.
 */
export type SettingsTab =
  | 'global'
  | 'terminal'
  | 'agents'
  | 'harness'
  | 'editor'
  | 'project'
  | 'prompts'
  | 'extensions'
  | 'plugins'
  | 'skills'
  | 'mcp'
  | 'experimental'
  | 'about'
  | (string & {});

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
   * from Settings. A spotlight tour of launch-an-agent / add-a-project /
   * create-a-schedule.
   */
  walkthroughOpen: boolean;
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
  /** Open / close the first-run setup checklist (dependency doctor) overlay. */
  setSetupOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setFindOpen: (open: boolean) => void;
  /** Open the agent-inspector modal on a session (peek at its live terminal). */
  openAgentModal: (sessionId: string, projectId: string) => void;
  /** Close the agent-inspector modal. */
  closeAgentModal: () => void;
  /**
   * Which tab is active in the Settings panel. The fixed core tabs are
   * 'global' | 'project' | 'prompts'; a module with `placement: 'settings'`
   * (e.g. Slack) contributes a tab keyed by its module id, so this also accepts
   * an arbitrary module-id string.
   */
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  /**
   * When the Extensions section is open, which module's settings the picker
   * has selected (an opaque module id — built-in or disk extension; core never
   * enumerates them, Rule 6). Drives the ExtensionsHub's detail pane so the
   * picker sub-list and the hub stay in sync. `null` = default to the first.
   * Set alongside `settingsTab: 'extensions'` by `selectSettingsExtension`.
   */
  settingsExtensionId: string | null;
  setSettingsExtensionId: (id: string | null) => void;
  /** Open the Extensions section focused on one module (picker jump-link). */
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

export function applyListPaneWidth(px: number) {
  const clamped = Math.max(LIST_PANE_MIN, Math.min(LIST_PANE_MAX, Math.round(px)));
  document.documentElement.style.setProperty('--col-list', `${clamped}px`);
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
    teamJobLaunchEnabled: config.teamJobLaunchEnabled ?? false,
    openerHiddenTargets: config.openerHiddenTargets ?? []
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
    window.cc.config.set({ workspaceModes: persisted }).catch(() => {});
  }, 200);
}

// Fire-and-forget write of the global agents-board view preference. No debounce
// needed — it changes only on an explicit user toggle, not on a typing/drag.
function persistAgentsBoardView(view: AgentsBoardView) {
  window.cc.config.set({ agentsBoardView: view }).catch(() => {});
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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

function pushErrorToast(message: string) {
  useUi.getState().pushToast(message, 'error');
}

export const useUi = create<UiState>((set, get) => ({
  nav: 'projects',
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
  setupOpen: false,
  searchOpen: false,
  findOpen: false,
  agentModal: null,
  agentMonitor: null,
  settingsTab: 'global',
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
    set(nav === 'scheduler' ? { nav, schedulerTab: 'overview' } : { nav }),
  inboxTab: 'feed',
  setInboxTab: (inboxTab) => set({ inboxTab }),
  inboxGrouping: 'project',
  setInboxGrouping: (grouping) => {
    set({ inboxGrouping: grouping });
    window.cc.config.set({ inboxGrouping: grouping }).catch(() => {});
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
      window.cc.projects.touch('').catch(() => {});
      return;
    }
    window.cc.config.set({ lastProjectId: id }).catch(() => {});
    // Persist the touch to disk so the next launch's auto-sort reflects
    // recent use, but DON'T merge the updated lastActiveAt back into the
    // in-memory projects list — that causes the just-clicked project to
    // jump to the top of the sidebar mid-session, which is jarring.
    window.cc.projects.touch(id).catch(() => {});
    useData.getState().loadGitStatus(id);
  },
  enterProjectFocus: (id) => {
    set({ focusedProjectId: id });
    // Keep selection in sync with focus so the workspace tracks the column.
    get().selectProject(id);
    // Selecting a project always lands on the Agents board first, not whatever
    // mode it was left in. The user switches to Terminals/Explorer/etc. from
    // there if they want it.
    get().setWorkspaceMode(id, 'agents');
    window.cc.config.set({ focusedProjectId: id }).catch(() => {});
  },
  exitProjectFocus: () => {
    set({ focusedProjectId: null });
    window.cc.config.set({ focusedProjectId: null }).catch(() => {});
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
  setWalkthroughOpen: (walkthroughOpen) => set({ walkthroughOpen }),
  setSetupOpen: (setupOpen) => set({ setupOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setFindOpen: (findOpen) => set({ findOpen }),
  openAgentModal: (sessionId, projectId) => set({ agentModal: { sessionId, projectId } }),
  closeAgentModal: () => set({ agentModal: null }),
  selectMonitorAgent: (sessionId, projectId) => set({ agentMonitor: { sessionId, projectId } }),
  clearMonitorAgent: () => set({ agentMonitor: null }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setSettingsExtensionId: (settingsExtensionId) => set({ settingsExtensionId }),
  selectSettingsExtension: (id) => set({ settingsTab: 'extensions', settingsExtensionId: id }),
  settingsAnchor: null,
  setSettingsAnchor: (settingsAnchor) => set({ settingsAnchor }),
  setSchedulerTab: (schedulerTab) => set({ schedulerTab }),
  selectGroup: (groupId) => set({ schedulerTab: 'group', selectedGroupId: groupId }),
  revealSchedule: (taskId) => {
    const task = useScheduler.getState().tasks.find((t) => t.id === taskId);
    // setNav('scheduler') forces schedulerTab back to 'overview', so set the
    // scope tab AFTER it. A project-scoped task also needs its project selected
    // so the project scope renders the right list.
    set({ nav: 'scheduler', revealScheduleId: taskId });
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
    // Ensure the UI actually lands in the project workspace (not still on Inbox)
    // before drilling into Library. Without this, the state updates can occur
    // "behind" the inbox view and appear as a no-op to the user.
    set({ nav: 'projects' });
    // Drilling into a project focuses it and resets its mode to Agents, so set
    // the Library mode AFTER entering focus (mirrors revealSchedule ordering).
    // The deep-link id is set alongside so LibraryView selects the doc as soon
    // as it renders in the project's Library.
    get().enterProjectFocus(projectId);
    get().setWorkspaceMode(projectId, 'library');
    set({ revealLibraryDocId: docId });
  },
  clearRevealLibraryDoc: () => set({ revealLibraryDocId: null }),
  revealFollowUp: (id) => {
    // Exit any lingering project focus first — the global Follow-ups panel
    // shows every project's follow-ups, and a stale focus would otherwise
    // leave the rail on the scoped nav while `nav` flips to 'followups'.
    get().exitProjectFocus();
    set({ nav: 'followups', revealFollowUpId: id });
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
      const { createModuleHost } = await import('./modules/host');
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
    set((s) => ({ workspaceMode: { ...s.workspaceMode, [projectId]: mode } }));
    persistWorkspaceModes();
  },
  setAgentsBoardView: (view) => {
    set({ agentsBoardView: view });
    persistAgentsBoardView(view);
  },
  toggleWorkspaceMode: (projectId) => {
    set((s) => {
      const cur = s.workspaceMode[projectId] ?? 'terminals';
      return {
        workspaceMode: {
          ...s.workspaceMode,
          [projectId]: cur === 'terminals' ? 'explorer' : 'terminals'
        }
      };
    });
    persistWorkspaceModes();
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
  /** Mirror of AppConfig.harnessCursorEnabled — gates Cursor in launch profile UI. */
  harnessCursorEnabled: boolean;
  /** Mirror of AppConfig.harnessCodexEnabled — gates Codex in launch profile UI. */
  harnessCodexEnabled: boolean;
  /** Mirror of AppConfig.harnessPiEnabled — gates PI in launch profile UI. */
  harnessPiEnabled: boolean;
  /** Mirror of AppConfig.harnessOpenCodeEnabled — gates OpenCode in launch profile UI. */
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
  /** Mirror of AppConfig.teamJobLaunchEnabled — gates durable Team job launch. */
  teamJobLaunchEnabled: boolean;
  /** Mirror of AppConfig.worktreeIsolationDefault — the global default for the
   *  agent launcher's "Isolate in a git worktree" toggle. A per-project
   *  ProjectSettings.worktreeIsolation overrides it. Hydrated on init, kept live
   *  by the Settings toggle. Default off. */
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
   * Re-spawn the visible tabs that were open last launch (claude tabs resume
   * via `--continue`). Idempotent across the app launch: runs at most once,
   * guarded by `sessionsRestored`. Called from init() after live hydration.
   */
  restoreSessions: (skipProjectIds?: Set<string>) => Promise<void>;
  /**
   * Persist the current per-project visible-tab layout to localStorage so the
   * next launch can restore it. Cheap; called after any tab create/close.
   */
  persistOpenSessions: () => void;
  loadProjects: () => Promise<void>;
  loadClaudeSessions: (projectId: string) => Promise<void>;
  addProject: () => Promise<Project | null>;
  addProjectByPath: (path: string) => Promise<Project | null>;
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
      harnessRouting?: import('@shared/types').HarnessModelRoutingV1;
      title?: string;
      cwd?: string;
      isolateScratch?: boolean | string;
      /** Isolated-worktree launch intent: legacy `true` (branch derived from the title/
       *  prompt) or `{ branch }` to provide a stable name. main mints a git worktree of a local
       *  project and launches the agent there. Ignored for remote/scratch/non-repo
       *  projects. See {@link CreateTerminalRequest.worktree}. */
      worktree?: boolean | { branch?: string };
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
      /** Receives a launch failure for callers needing retained inline feedback
       *  in addition to the global error toast. */
      onError?: (message: string) => void;
    }
  ) => Promise<TerminalSession | null>;
  /**
   * Terminate a session: kills the pty and removes the tab. Pushes a
   * restorable snapshot onto closedTabs so ⌘⇧T can reopen a fresh tab
   * with the same profile/cwd/pinned/extraArgs. Wired to the tab's X
   * button, ⌘W, middle-click, and the sidebar row X.
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
 * True only while `restoreSessions` is spawning its planned tabs. Suppresses
 * `persistOpenSessions` for the duration so the in-loop createTerminal /
 * markExited calls can't rewrite (and partially clobber) the snapshot before
 * the whole plan has been consumed — an interrupted restore would otherwise
 * lose the un-spawned tail. We persist once, explicitly, after the loop.
 */
let restoringSessions = false;

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
  teamJobLaunchEnabled: false,
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
  },

  setHarnessCodexEnabled(on) {
    set({ harnessCodexEnabled: on });
  },

  setHarnessPiEnabled(on) {
    set({ harnessPiEnabled: on });
  },

  setHarnessOpenCodeEnabled(on) {
    set({ harnessOpenCodeEnabled: on });
  },

  async refreshHarnessStatus() {
    try {
      const status = await window.cc.harness.verify();
      set({ harnessStatus: status });
    } catch {
      set({ harnessStatus: [] });
    }
  },

  async refreshEditorStatus() {
    try {
      const status = await window.cc.editor.verify();
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
      await window.cc.config.set({ autoCloseIdleEnabled: on });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to toggle auto-close idle'));
      set({ autoCloseIdleEnabled: prev });
    }
  },

  async setOverseerMode(mode) {
    const prev = get().overseerMode;
    set({ overseerMode: mode });
    try {
      await window.cc.config.set({ overseerMode: mode });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to toggle overseer'));
      set({ overseerMode: prev });
    }
  },

  async setReviewerApprovalMode(mode) {
    const prev = get().reviewerApprovalMode;
    set({ reviewerApprovalMode: mode });
    try {
      await window.cc.config.set({ reviewerApprovalMode: mode });
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
      await window.cc.terminals.setHeartbeat(sessionId, on);
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
        window.cc.projects.list(),
        window.cc.config.get()
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
      // Live config sync across windows: main broadcasts `config:onChanged` to
      // EVERY window after any `config:set`, so a feature toggled off in one
      // window (e.g. Follow-ups) flips this window's mirrored gate at once
      // instead of lingering until reload. Re-apply the same config→flag
      // mapping init uses, plus theme (the other visible cross-window setting).
      window.cc.config.onChanged((next) => {
        set(mirroredConfigFlags(next));
        applyTheme(next.theme);
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
        useUi.setState({ focusedProjectId: scopedProjectId });
      } else {
        // The main window opens with NO project selected or focused — the
        // Projects list starts unhighlighted and the cross-project Agents board
        // is the home. Neither lastProjectId nor focusedProjectId is restored;
        // the user picks a project explicitly each session.
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
            const sessions = await window.cc.terminals.list(p.id);
            if (sessions.length > 0) {
              set((s) => ({ terminals: { ...s.terminals, [p.id]: sessions } }));
            }
          } catch {
            /* couldn't read this project's live terminals — skip it on restore */
            hydrationFailed.add(p.id);
          }
        })
      );

      // Silently restore the tabs that were open last launch. Runs once per
      // app launch (guarded), after live ptys have hydrated above so we never
      // double-spawn on top of a session that outlived a renderer reload.
      // planRestore() folds each claude tab's own `--resume <session-id>` in so
      // it resumes ITS prior conversation (legacy snapshots without an id fall
      // back to `--continue`), and skips deleted/remote/already-live projects.
      //
      // SKIPPED in a per-project window. Restore reads the shared (per-origin)
      // `zcc.openSessions` snapshot, which spans EVERY project — running it in a
      // scoped window would spawn tabs for other projects and race the main
      // window over the same snapshot. The scoped window already hydrated its
      // own live ptys above (display only); spawning + snapshot ownership belong
      // to the unscoped main window. (persistOpenSessions is likewise gated.)
      if (!isScopedWindow()) {
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
        const { entries } = await window.cc.inbox.history({
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
        const { entries } = await window.cc.suggestions.list(scopedProjectId ?? undefined);
        useSuggestions.setState({ entries, loading: false });
      } catch {
        useSuggestions.setState({ loading: false });
      }
    })();
    const loadSaved = (async () => {
      try {
        const records = await window.cc.saved.list();
        useSaved.setState({ records, loading: false });
      } catch {
        useSaved.setState({ loading: false });
      }
    })();
    const loadMesh = (async () => {
      try {
        const [agents, messages] = await Promise.all([
          window.cc.agents.list(),
          window.cc.agents.messages()
        ]);
        useAgentMesh.setState({ agents, messages });
      } catch {
        /* mesh view is best-effort; leave empty on failure */
      }
    })();
    await Promise.all([loadInbox, loadSuggestions, loadSaved, loadMesh]);

    window.cc.inbox.onAppended((entry) => {
      if (scopedProjectId && entry.projectId !== scopedProjectId) return;
      useInbox.getState().prepend(entry);
    });
    window.cc.inbox.onRemoved((id) => {
      useInbox.getState().removeLocal(id);
      pruneInboxMarkers([id]);
    });
    window.cc.inbox.onUpdated((entry) => {
      if (scopedProjectId && entry.projectId !== scopedProjectId) return;
      useInbox.getState().upsert(entry);
    });
    window.cc.inbox.onPruned((removedIds) => {
      // Retention rolled these off disk: drop the rows and prune the persisted
      // read/answered/saved/keep markers so those localStorage maps stay bounded.
      useInbox.getState().removeManyLocal(removedIds);
      pruneInboxMarkers(removedIds);
    });

    // Suggested Actions (afl-03): push subscriptions (the one-shot list load ran
    // concurrently above). Scoped to the window's project like the inbox. A
    // sibling surface, not a feed category.
    window.cc.suggestions.onAppended((entry) => {
      if (scopedProjectId && entry.projectId !== scopedProjectId) return;
      useSuggestions.getState().prepend(entry);
    });
    window.cc.suggestions.onRemoved((id) => {
      useSuggestions.getState().removeLocal(id);
    });
    window.cc.suggestions.onUpdated((entry) => {
      if (scopedProjectId && entry.projectId !== scopedProjectId) return;
      useSuggestions.getState().upsert(entry);
    });
    window.cc.suggestions.onPruned((removedIds) => {
      useSuggestions.getState().removeManyLocal(removedIds);
    });

    // Saved reports: full-list push (the one-shot list load ran concurrently
    // above). Low volume, so main replaces the whole list on every save/delete.
    window.cc.saved.onChanged((records) => {
      useSaved.setState({ records, loading: false });
    });

    // Agent mesh: live pushes (the one-shot registry + message load ran
    // concurrently above). Registry changes (register/seed/drop) re-fetch the
    // whole list; each agent→agent message prepends. Read-only — the renderer
    // never mutates the mesh, it only mirrors it for the Agents board.
    window.cc.agents.onRegistryChanged(() => {
      window.cc.agents
        .list()
        .then((agents) => useAgentMesh.getState().setAgents(agents))
        .catch(() => {});
    });
    window.cc.agents.onMessage((msg) => {
      useAgentMesh.getState().prependMessage(msg);
    });
    window.cc.agents.onMessagesPruned((removedIds) => {
      useAgentMesh.getState().removeMessages(removedIds);
    });

    // Auto-update: subscribe to the main-process event stream. The boot check
    // is kicked from main; here we mirror status into the store (for the About
    // section) and surface the key transitions as toasts. Progress is stored
    // but not toasted — the About section renders the bar.
    window.cc.updates.onStatus((status) => {
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
    window.cc.updates.onProgress((progress) => {
      useUpdates.setState({ progress });
    });
    // Seed from main's remembered status: the boot check runs before this
    // listener is attached, so an `available` found at launch would otherwise be
    // missed by the UI (it only lands in the inbox, which main writes directly).
    // Pull it once so the banner/footer reflect a launch-time update. Only apply
    // a meaningful status so this can't clobber a live push that raced ahead.
    window.cc.updates
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
    window.cc.updates
      .consumeWhatsNew()
      .then(async (evt) => {
        if (!evt) return;
        const notes = await window.cc.updates.getReleaseNotes({
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
    const setupDismissed = await window.cc.config
      .get()
      .then((c) => !!c.setupDismissed)
      .catch(() => true);
    const setupScopedId = getScopedProjectId();
    window.cc.deps.onStatus((status) => {
      useSetup.setState({ status, progress: {} });
      if (!setupScopedId && !setupDismissed && hasMissingSetup(status)) {
        // Don't fight the walkthrough for the screen on a truly fresh install —
        // only auto-open the checklist when the walkthrough isn't also opening.
        if (!useUi.getState().walkthroughOpen) {
          useUi.setState({ setupOpen: true });
        }
      }
    });
    window.cc.deps.onProgress((p) => {
      useSetup.setState((s) => ({ progress: { ...s.progress, [p.id]: p.message } }));
    });
    // Seed the current snapshot in case the boot check already completed before
    // this subscription attached (the push is deduped, so a late subscriber
    // would otherwise miss it).
    window.cc.deps
      .get()
      .then((status) => useSetup.setState((s) => ({ status, progress: s.progress })))
      .catch(() => {});

    // Scheduler: one-shot list + push subscription. The main process emits
    // `scheduler:onChanged` after every fire and after every CRUD action,
    // so the panel never needs to poll.
    try {
      const tasks = await window.cc.scheduler.list();
      useScheduler.setState({ tasks, loading: false });
    } catch {
      useScheduler.setState({ loading: false });
    }
    window.cc.scheduler.onChanged((tasks) => {
      useScheduler.setState({ tasks });
    });

    // Goals: one-shot list + push subscription, mirroring the scheduler. Main
    // emits `goals:onChanged` after every CRUD action, every iteration spawn,
    // and every evaluator verdict, so the panel never polls.
    try {
      const goals = await window.cc.goals.list();
      useGoals.setState({ goals, loading: false });
    } catch {
      useGoals.setState({ loading: false });
    }
    window.cc.goals.onChanged((goals) => {
      useGoals.setState({ goals });
    });

    // Follow-ups: one-shot list + push subscription, mirroring goals. Main emits
    // `followups:onChanged` after every CRUD action and every idle-triage bridge,
    // so the panel never polls.
    try {
      const followups = await window.cc.followups.list();
      useFollowUps.setState({ followups, loading: false });
    } catch {
      useFollowUps.setState({ loading: false });
    }
    window.cc.followups.onChanged((followups) => {
      useFollowUps.setState({ followups });
    });

    // Templates: same one-shot + push pattern. Main watches the user dir +
    // per-project dirs for hand-edited files and pushes refreshed lists.
    try {
      const templates = await window.cc.scheduler.listTemplates();
      useScheduleTemplates.setState({ templates, loading: false });
    } catch {
      useScheduleTemplates.setState({ loading: false });
    }
    window.cc.scheduler.onTemplatesChanged((templates) => {
      useScheduleTemplates.setState({ templates });
    });

    // Personas: one-shot list + push. Main watches the user dir + per-project
    // dirs for hand-edited persona files and pushes refreshed lists.
    try {
      const personas = await window.cc.personas.list();
      usePersonas.setState({ personas, loading: false });
    } catch {
      usePersonas.setState({ loading: false });
    }
    window.cc.personas.onChanged((personas) => {
      usePersonas.setState({ personas });
    });

    // Teams: one-shot list + push, mirroring personas. Main merges builtin/user/
    // project/extension teams and pushes a refreshed list on any change.
    try {
      const teams = await window.cc.teams.list();
      useTeams.setState({ teams, loading: false });
    } catch {
      useTeams.setState({ loading: false });
    }
    window.cc.teams.onChanged((teams) => {
      useTeams.setState({ teams });
    });

    // Autonomous runs: one-shot list + push, mirroring teams. Live-only (no
    // persistence); the main supervisor pushes a refreshed list on every change.
    try {
      const runs = await window.cc.autonomousRuns.list();
      useAutonomousRuns.setState({ runs });
    } catch {
      /* leave empty */
    }
    window.cc.autonomousRuns.onChanged((runs) => {
      useAutonomousRuns.setState({ runs });
    });

    // Projects: live refresh when the list changes out-of-band — notably when
    // an agent adds a cloned repo via the `register_project` MCP tool. The
    // renderer's own add/remove/reorder still drive `loadProjects()` directly;
    // this push covers mutations the renderer didn't initiate.
    window.cc.projects.onChanged((projects) => {
      set({ projects });
    });

    // Library: one-shot list + full-list push (like saved). Reconciled on read:
    // manifest + on-disk, both scopes, newest-first.
    try {
      const docs = await window.cc.library.list();
      useLibrary.setState({ docs, loading: false });
    } catch {
      useLibrary.setState({ loading: false });
    }
    window.cc.library.onChanged((docs) => {
      useLibrary.setState({ docs, loading: false });
    });

    // Schedule groups: one-shot + push. Main seeds Personal/Work on first run
    // and watches ~/.zcc/groups.json for hand edits.
    try {
      const groups = await window.cc.scheduler.groups.list();
      useScheduleGroups.setState({ groups, loading: false });
    } catch {
      useScheduleGroups.setState({ loading: false });
    }
    window.cc.scheduler.groups.onChanged((groups) => {
      useScheduleGroups.setState({ groups });
    });

    // Plugins + MCP catalogues: same one-shot + push pattern. Main fans out
    // a single debounced fs.watch into `plugins:onChanged` and `mcp:onChanged`
    // so we never poll.
    try {
      const entries = await window.cc.plugins.list();
      usePlugins.setState({ entries, loading: false });
    } catch {
      usePlugins.setState({ loading: false });
    }
    window.cc.plugins.onChanged((entries) => {
      usePlugins.setState({ entries });
    });

    try {
      const entries = await window.cc.mcp.listAll();
      useMcpCatalogue.setState({ entries, loading: false });
    } catch {
      useMcpCatalogue.setState({ loading: false });
    }
    window.cc.mcp.onChanged((entries) => {
      useMcpCatalogue.setState({ entries });
    });

    // Session metadata changes (e.g. title/headless changes, exit transitions,
    // or a scheduler-spawned tab being broadcast) come in via this push so the
    // tab strip re-renders without polling.
    window.cc.terminals.onUpdated((session) => {
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
      // Main-created sessions (including structured Team workers) arrive only
      // through this push, not createTerminal(). Keep restore snapshot current
      // after every metadata update so a quit can reattach them on next boot.
      get().persistOpenSessions();
    });

    // Live agent-state pushes land in their own store (useAgentStatus), keyed
    // by session id, with a precomputed per-project rollup. We resolve the
    // owning project from useData here so the status event itself stays a
    // lean (sessionId, state, seq) tuple.
    window.cc.terminals.onAgentStatus((sessionId, state, seq) => {
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
    window.cc.terminals.onSubagents((sessionId, count) => {
      useSubagents.getState().apply(sessionId, count);
    });
    // Seed sub-agent counts for any parent already fanned out before this window
    // opened — onSubagents is edge-triggered and would otherwise miss them.
    window.cc.terminals
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
    window.cc.terminals
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
    window.cc.terminals.onSubagentChildren((sessionId, children) => {
      useSubagentChildren.getState().apply(sessionId, children);
    });
    // Seed child records for parents already fanned out before this window
    // opened — edge-triggered like the count snapshot.
    window.cc.terminals
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
    window.cc.terminals.onIdleTriage((result) => {
      useIdleTriage.getState().apply(result);
    });

    // Overseer activity (auto-approve cascade; off by default): per-session
    // counts of what the cascade auto-approved / handed back. Own slice keyed by
    // session id, surfaced as a badge on the agent card. Unlike idle-triage it's
    // NOT cleared on leaving idle — the count is about the session's lifetime, so
    // it persists until the tab closes (cleared in the close/clearProject paths).
    window.cc.terminals.onOverseerActivity((activity) => {
      useOverseerActivity.getState().apply(activity);
    });

    // Catch-up summary add-on (EXPERIMENTAL, off by default): a precomputed
    // markdown summary of where the agent is and what changed, surfaced under
    // the terminal in the agent modal when the agent sits idle or blocked long
    // enough. Own slice keyed by session id, mirroring onIdleTriage pattern.
    window.cc.terminals.onCatchUpSummary((result) => {
      useCatchUpSummary.getState().apply(result);
    });

    // Tab auto-rename: Claude writes a task summary into its idle OSC title;
    // main parses it and pushes it here. Adopt it as the tab name unless the
    // user has manually renamed the tab.
    window.cc.terminals.onTitle((sessionId, title, source) => {
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
    window.cc.terminals.onWake(() => {
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
      const projects = await window.cc.projects.list();
      set({ projects });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to load projects'));
    }
  },

  async loadClaudeSessions(projectId) {
    const project = get().projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      const sessions = await window.cc.claude.listSessions(projectId);
      set((s) => ({ claudeSessions: { ...s.claudeSessions, [projectId]: sessions } }));
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to load Claude sessions'));
    }
  },

  async addProject() {
    try {
      const path = await window.cc.projects.pickDirectory();
      if (!path) return null;
      const result = await window.cc.projects.add(path);
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

  async addProjectByPath(path) {
    try {
      const result = await window.cc.projects.add(path);
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
      const result = await window.cc.projects.addRemote(input);
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
      const result = await window.cc.projects.clone(input);
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
      const updated = await window.cc.projects.update(id, patch);
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
      const persisted = await window.cc.projects.reorder(orderedIds);
      set({ projects: persisted });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to reorder projects'));
      await get().loadProjects();
    }
  },

  async removeProject(id) {
    try {
      await window.cc.projects.remove(id);
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
      const result = await window.cc.terminals.create({
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
        resumeSessionId: opts?.resumeSessionId
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
      get().persistOpenSessions();
      return result.value;
    } catch (err) {
      const message = errorMessage(err, 'Failed to create terminal');
      opts?.onError?.(message);
      pushErrorToast(message);
      return null;
    }
  },

  persistOpenSessions() {
    // A per-project window never owns the shared `zcc.openSessions` snapshot:
    // its `terminals` map only meaningfully holds its one scoped project, so
    // writing here would clobber the other projects' tab layout the main window
    // restored. Snapshot ownership is the unscoped main window's, mirroring how
    // `windowBounds` is persisted only by the unscoped window (main side).
    if (isScopedWindow()) return;
    // Suppressed during restore: the in-loop createTerminal/markExited calls
    // would otherwise rewrite the snapshot from a partially-restored state and
    // an interruption could drop the un-spawned tail. restoreSessions persists
    // once when it finishes.
    if (restoringSessions) return;
    const { terminals } = get();
    const snapshot: SessionSnapshotMap = {};
    for (const [projectId, list] of Object.entries(terminals)) {
      const snap = snapshotTabs(list);
      if (snap.length > 0) snapshot[projectId] = snap;
    }
    writeSnapshot(snapshot);
  },

  async restoreSessions(skipProjectIds) {
    if (sessionsRestored) return; // once per app launch
    sessionsRestored = true;
    const { projects, terminals } = get();
    const plan = planRestore(readSnapshot(), projects, terminals, skipProjectIds);
    // Main owns authoritative restore capabilities and can see surviving tmux
    // sessions. Merge those candidates so a main-created Team worker cannot be
    // lost when its renderer push raced listener registration/localStorage.
    const plannedCapabilities = new Set(plan.flatMap((item) => item.restoreCapabilityId ? [item.restoreCapabilityId] : []));
    const knownProjects = new Set(projects.filter((project) => !project.remote).map((project) => project.id));
    const liveProjects = new Set(Object.entries(terminals)
      .filter(([, sessions]) => sessions.some((session) => session.status !== 'exited'))
      .map(([projectId]) => projectId));
    const tmuxCandidates = await window.cc.terminals.listTmuxRestoreCandidates();
    for (const candidate of tmuxCandidates) {
      if (plannedCapabilities.has(candidate.capabilityId)) continue;
      if (!knownProjects.has(candidate.projectId) || liveProjects.has(candidate.projectId)) continue;
      if (skipProjectIds?.has(candidate.projectId)) continue;
      plan.push({
        restoreCapabilityId: candidate.capabilityId,
        projectId: candidate.projectId,
        profile: 'shell',
        title: ''
      });
    }
    if (plan.length === 0) return;
    restoringSessions = true;
    try {
      // Spawn sequentially: a burst of concurrent claude --continue launches
      // can race the same per-project .mcp.json write and thrash the CLI's
      // session store. Order within a project is preserved (plan is tab order).
      for (const item of plan) {
        const restored = await window.cc.terminals.restore({
          capabilityId: item.restoreCapabilityId,
          legacyRequest: item.restoreCapabilityId ? undefined : {
            projectId: item.projectId,
            profile: item.profile,
            cols: 80,
            rows: 24,
            extraArgs: item.extraArgs,
            title: item.title,
            cwd: item.worktree ? undefined : item.cwd,
            worktree: item.worktree
              ? { branch: item.worktree.branch.replace(/^zcc\//, '') }
              : undefined,
            resumeSessionId: item.resumeSessionId
          }
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
        if (created && item.pinned) {
          get().setPinned(item.projectId, created.id, true);
        }
        // Re-apply the rename guards so the restored tab keeps its name:
        //  - titleLocked: the user's manual rename stays suppressed-from-auto.
        //  - autoTitledBy{Llm,Osc}: an auto-named tab isn't re-renamed by the
        //    first post-restore OSC idle-title (the "renamed on restore" bug).
        if (created && (item.titleLocked || item.autoTitledByLlm || item.autoTitledByOsc)) {
          set((s) => ({
            terminals: {
              ...s.terminals,
              [item.projectId]: (s.terminals[item.projectId] ?? []).map((t) =>
                t.id === created.id
                  ? {
                      ...t,
                      titleLocked: item.titleLocked || t.titleLocked,
                      autoTitledByLlm: item.autoTitledByLlm || t.autoTitledByLlm,
                      autoTitledByOsc: item.autoTitledByOsc || t.autoTitledByOsc
                    }
                  : t
              )
            }
          }));
        }
      }
    } finally {
      // Clear first, then persist once so the snapshot reflects the fully
      // restored layout (and survives even if a spawn above threw).
      restoringSessions = false;
      get().persistOpenSessions();
    }
  },

  async closeTerminal(sessionId, projectId) {
    const list = get().terminals[projectId] || [];
    const closing = list.find((t) => t.id === sessionId);
    // Index within the VISIBLE strip so selection advances to the visual
    // neighbor, not a hidden background session. Matches hideTerminal.
    const closingIdx = visibleTerminals(list).findIndex((t) => t.id === sessionId);
    try {
      if (!await window.cc.terminals.close(sessionId)) {
        pushErrorToast('Failed to close terminal; its remote session may still be running');
        return;
      }
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to close terminal'));
      return;
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
    get().persistOpenSessions();
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
        const res = await window.cc.terminals.closeFollowup(projectId, ids);
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
      const res = await window.cc.terminals.summarizeIdle(projectId, sessionIds);
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
      const res = await window.cc.terminals.summarizeSession(projectId, sessionId);
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
      await window.cc.terminals.setHeadless(sessionId, true);
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
      updated = await window.cc.terminals.setHeadless(sessionId, false);
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
    // THIS tab's own conversation, not the cwd's most-recent one (same as
    // sessionRestore's planRestore — see resolveRestartProfile).
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
      if (!await window.cc.terminals.close(sessionId)) {
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
    let result: Result<TerminalSession>;
    try {
      result = await window.cc.terminals.reconnectRemote({
        capabilityId: src.restoreCapabilityId,
        legacy: src.restoreCapabilityId ? undefined : {
          projectId,
          profile: snapshot.profile,
          sessionId: src.id
        }
      });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to reconnect remote session'));
      return null;
    }
    if (!result.ok) {
      pushErrorToast(result.message);
      console.error('remote reconnect failed', result);
      return null;
    }
    const created = result.value;
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
    get().persistOpenSessions();
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
    get().persistOpenSessions();
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
    get().persistOpenSessions();
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
    get().persistOpenSessions();
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
    get().persistOpenSessions();
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
    // A tab that just exited (headless reaped, or a visible shell/claude that
    // ended) should drop out of the restore snapshot so next launch doesn't
    // resurrect a session the user let die. snapshotTabs filters exited tabs.
    get().persistOpenSessions();
  },

  async loadGitStatus(projectId) {
    const project = get().projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      const status = await window.cc.git.status(project.path);
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
        const status = await window.cc.git.status(p.path);
        set((s) => ({ gitStatus: { ...s.gitStatus, [p.id]: status } }));
      } catch {
        /* ignore */
      }
    }
  }
}));

// ============================================================================
// Inbox — entries feed, selection, per-entry read tracking.
//
// Three cooperating pieces of live state:
// - feed: push-driven (onAppended/onRemoved), no polling. Initial load is
//   one history call from useData.init().
// - selection: ephemeral, not persisted.
// - read: per-entry, persisted to localStorage. SELECTION marks read —
//   never bulk-on-visibility, since bulk-on-view destroys triage in an
//   inbox-flow product.
// ============================================================================

interface InboxLiveState {
  entries: InboxEntry[];
  loading: boolean;
  /** Replace the current list (used by initial load + reconciliation). */
  setEntries: (entries: InboxEntry[]) => void;
  /** Push a freshly-appended entry to the front. */
  prepend: (entry: InboxEntry) => void;
  /**
   * Apply a coalesced (`onUpdated`) entry: replace the existing row with the
   * same id and re-sort it to the front (its `ts` was just bumped). Falls back
   * to a prepend if the id isn't present (e.g. it was evicted/cleared) so a
   * coalesce can't silently drop the refreshed entry.
   */
  upsert: (entry: InboxEntry) => void;
  /** Remove an entry from local state (optimistic delete or push echo). */
  removeLocal: (id: string) => void;
  /** Remove many entries at once (optimistic bulk clear). */
  removeManyLocal: (ids: string[]) => void;
}

export const useInbox = create<InboxLiveState>((set) => ({
  entries: [],
  loading: true,
  setEntries: (entries) => set({ entries, loading: false }),
  prepend: (entry) =>
    set((s) =>
      s.entries.some((e) => e.id === entry.id)
        ? s
        : { entries: [entry, ...s.entries] }
    ),
  upsert: (entry) =>
    set((s) => {
      const rest = s.entries.filter((e) => e.id !== entry.id);
      // Re-front: the coalesced entry's ts was just bumped, so it's newest.
      return { entries: [entry, ...rest] };
    }),
  removeLocal: (id) =>
    set((s) => {
      if (!s.entries.some((e) => e.id === id)) return s;
      return { entries: s.entries.filter((e) => e.id !== id) };
    }),
  removeManyLocal: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const drop = new Set(ids);
      const next = s.entries.filter((e) => !drop.has(e.id));
      return next.length === s.entries.length ? s : { entries: next };
    })
}));

// ============================================================================
// Suggested Actions launcher (afl-03) — a SIBLING store to the inbox, NOT a feed
// category. Mirrors `useInbox`'s live shape (setEntries / prepend / upsert /
// removeLocal / removeManyLocal) fed by the `suggestions:on*` IPC pushes. The
// entries are runnable actions the operator triggers with one click; `run`
// happens in main (each step re-authorized, Rule 1/2). Empty when the feature is
// off (no rail entry, no fetch).
// ============================================================================

interface SuggestionsLiveState {
  entries: Suggestion[];
  loading: boolean;
  setEntries: (entries: Suggestion[]) => void;
  prepend: (entry: Suggestion) => void;
  upsert: (entry: Suggestion) => void;
  removeLocal: (id: string) => void;
  removeManyLocal: (ids: string[]) => void;
}

export const useSuggestions = create<SuggestionsLiveState>((set) => ({
  entries: [],
  loading: true,
  setEntries: (entries) => set({ entries, loading: false }),
  prepend: (entry) =>
    set((s) =>
      s.entries.some((e) => e.id === entry.id)
        ? s
        : { entries: [entry, ...s.entries] }
    ),
  upsert: (entry) =>
    set((s) => {
      const rest = s.entries.filter((e) => e.id !== entry.id);
      return { entries: [entry, ...rest] };
    }),
  removeLocal: (id) =>
    set((s) => {
      if (!s.entries.some((e) => e.id === id)) return s;
      return { entries: s.entries.filter((e) => e.id !== id) };
    }),
  removeManyLocal: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const drop = new Set(ids);
      const next = s.entries.filter((e) => !drop.has(e.id));
      return next.length === s.entries.length ? s : { entries: next };
    })
}));

/**
 * Live agent status (working / blocked / done / idle), kept in its OWN store —
 * deliberately not on the `TerminalSession` objects in `useData`. Status ticks
 * far more often than session metadata; routing it through `useData` would
 * rebuild the `terminals` map on every tick and re-render every list/strip that
 * selects it (the render-storm the arch council made binding — BC 7/10).
 *
 * `byId` is the per-session state. `rollup` is the precomputed per-project
 * most-urgent state, updated imperatively in `apply` (O(affected project), not
 * O(projects × sessions)) so consumers read `rollup[projectId]` as a stable
 * primitive and never run a fresh-object selector — the zustand infinite-loop
 * trap (see MEMORY `zustand-selector-stable-ref`).
 */
const AGENT_STATE_RANK: Record<AgentState, number> = {
  blocked: 4,
  done: 3,
  working: 2,
  idle: 1,
  unknown: 0
};

/** Resolve which project a session belongs to from the live terminals map.
 *  Returns null if the session isn't known yet (e.g. a status push that races
 *  ahead of the sessionUpdated that registers the tab). */
function findProjectIdForSession(sessionId: string): string | null {
  const { terminals } = useData.getState();
  for (const [projectId, list] of Object.entries(terminals)) {
    if (list.some((t) => t.id === sessionId)) return projectId;
  }
  return null;
}

interface AgentStatusState {
  byId: Record<string, AgentState>;
  /**
   * Timestamp (ms, renderer clock) at which each session ENTERED its current
   * state. Set on every real state change in {@link apply} (a deduped re-apply
   * of the same state leaves it untouched, so it marks the *start* of the
   * current spell, not the last tick). Lets the Idle lane show "idle for X" and
   * order itself most-recently-idle first. Dropped with the session.
   */
  since: Record<string, number>;
  rollup: Record<string, AgentState>;
  /** Last seq we've seen (the cursor for {@link agentStatusSince}). Starts at 0
   *  (a fresh renderer), advanced by {@link apply} on each live push. Main owns
   *  the seq; this is the advisory cursor (Rule 1). */
  lastSeq: number;
  /** Per-session high-water seq mark. The GLOBAL {@link lastSeq} can't gate a
   *  write (seq is global, so an unrelated session's push would suppress this
   *  session's replay), so we track the freshest seq applied PER session. Guards
   *  the reseed-vs-live-push race: a replayed/snapshot state can't clobber a
   *  newer live push that raced ahead of the async {@link agentStatusSince}
   *  reseed on init. Dropped with the session. */
  seqById: Record<string, number>;
  /** Apply one session's new state. `projectId` lets us recompute that one
   *  project's rollup without scanning every project. The optional `seq` is
   *  passed through from the live push or replay event to advance {@link lastSeq}. */
  apply: (sessionId: string, projectId: string, state: AgentState, seq?: number) => void;
  /** Drop a session (pty exited / tab closed) and refresh its project rollup. */
  clear: (sessionId: string, projectId: string) => void;
  /** Drop a whole project (project removed): forget every session's state and
   *  its rollup entry so no phantom dot lingers. */
  clearProject: (projectId: string) => void;
}

export const useAgentStatus = create<AgentStatusState>((set, get) => ({
  byId: {},
  since: {},
  rollup: {},
  lastSeq: 0,
  seqById: {},
  apply: (sessionId, projectId, state, seq) =>
    set((s) => {
      // Per-session staleness guard (Rule 1: seq is main's, authoritative). A
      // write carrying a seq NO NEWER than the freshest we've applied for this
      // session is a stale reseed event that raced behind a live push — drop it
      // so it can't clobber the newer state. We still advance the GLOBAL cursor
      // (a stale-for-this-session seq may be the newest overall), but never touch
      // byId. Writes without a seq (snapshot fallback) skip the guard.
      if (seq !== undefined && s.seqById[sessionId] !== undefined && seq <= s.seqById[sessionId]) {
        return seq > s.lastSeq ? { ...s, lastSeq: seq } : s;
      }
      if (s.byId[sessionId] === state) {
        // State unchanged — but advance the cursors if a (fresher) seq is given.
        if (seq !== undefined) {
          const seqById =
            seq > (s.seqById[sessionId] ?? 0) ? { ...s.seqById, [sessionId]: seq } : s.seqById;
          const lastSeq = Math.max(s.lastSeq, seq);
          if (seqById !== s.seqById || lastSeq !== s.lastSeq) return { ...s, seqById, lastSeq };
        }
        return s;
      }
      const byId = { ...s.byId, [sessionId]: state };
      // Stamp the moment this session entered its new state. Deduped above, so
      // this only advances on a *real* transition — i.e. it marks when the
      // current (idle/working/…) spell began, which the Idle lane reads to show
      // "idle for X" and to order most-recently-idle first.
      const since = { ...s.since, [sessionId]: Date.now() };
      const lastSeq = seq !== undefined ? Math.max(s.lastSeq, seq) : s.lastSeq;
      const seqById =
        seq !== undefined ? { ...s.seqById, [sessionId]: seq } : s.seqById;
      return { byId, since, rollup: recomputeRollup(byId, projectId, s.rollup), lastSeq, seqById };
    }),
  clear: (sessionId, projectId) =>
    set((s) => {
      if (!(sessionId in s.byId) && !(sessionId in s.seqById)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      const since = { ...s.since };
      delete since[sessionId];
      // Drop the high-water mark too, so a reused session id starts clean.
      const seqById = { ...s.seqById };
      delete seqById[sessionId];
      return { byId, since, seqById, rollup: recomputeRollup(byId, projectId, s.rollup) };
    }),
  clearProject: (projectId) =>
    set((s) => {
      // Read membership before the caller wipes the terminals map. Drop every
      // session's state plus the project's rollup entry in one pass.
      const sessions = useData.getState().terminals[projectId] ?? [];
      const ids = new Set(sessions.map((t) => t.id));
      const hadRollup = projectId in s.rollup;
      if (ids.size === 0 && !hadRollup) return s;
      const byId = { ...s.byId };
      const since = { ...s.since };
      const seqById = { ...s.seqById };
      for (const id of ids) {
        delete byId[id];
        delete since[id];
        delete seqById[id];
      }
      const rollup = { ...s.rollup };
      delete rollup[projectId];
      return { byId, since, seqById, rollup };
    })
}));

/**
 * Recompute one project's rollup = the most-urgent agent state across its live
 * sessions. Reads session→project membership from `useData` so we don't have to
 * thread it through every status event. Returns a new `rollup` object only when
 * that project's value actually changed (keeps the reference stable otherwise).
 */
function recomputeRollup(
  byId: Record<string, AgentState>,
  projectId: string,
  prev: Record<string, AgentState>
): Record<string, AgentState> {
  const sessions = useData.getState().terminals[projectId] ?? [];
  let best: AgentState = 'unknown';
  for (const sess of sessions) {
    const st = byId[sess.id];
    if (st && AGENT_STATE_RANK[st] > AGENT_STATE_RANK[best]) best = st;
  }
  if (prev[projectId] === best) return prev;
  return { ...prev, [projectId]: best };
}

/**
 * Idle-triage results (idle-agent add-on; off by default). Keyed by session id,
 * holding the latest {@link IdleTriageResult} for an agent's current idle spell.
 * Deliberately a SEPARATE slice from {@link useAgentStatus} — the badge it backs
 * updates on its own cadence (an LLM call), and keeping it apart means a triage
 * push never invalidates the status/session selectors (render-storm guard).
 */
interface IdleTriageState {
  byId: Record<string, IdleTriageResult>;
  apply: (result: IdleTriageResult) => void;
  /** Drop one session's triage (agent left idle, or tab closed). */
  clear: (sessionId: string) => void;
}

export const useIdleTriage = create<IdleTriageState>((set) => ({
  byId: {},
  apply: (result) =>
    set((s) => {
      const prev = s.byId[result.sessionId];
      // Skip a no-op re-apply (same resolution + summary) so subscribers with a
      // stable-ref selector don't churn.
      if (prev && prev.resolution === result.resolution && prev.summary === result.summary) {
        return s;
      }
      return { byId: { ...s.byId, [result.sessionId]: result } };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      return { byId };
    })
}));

/**
 * Per-session Overseer activity (auto-approve cascade; experimental, off by
 * default). Keyed by session id, holding the latest {@link OverseerActivity}
 * rollup main pushes for an agent. A SEPARATE slice from {@link useAgentStatus}
 * for the same reason as {@link useIdleTriage}: it updates on its own cadence
 * (every decided tool call, debounced) and must never invalidate the
 * status/session selectors (render-storm guard). Backs the "auto-approved ×N"
 * card badge.
 */
interface OverseerActivityState {
  byId: Record<string, OverseerActivity>;
  apply: (activity: OverseerActivity) => void;
  /** Drop one session's activity (tab closed / project removed). */
  clear: (sessionId: string) => void;
}

export const useOverseerActivity = create<OverseerActivityState>((set) => ({
  byId: {},
  apply: (activity) =>
    set((s) => {
      const prev = s.byId[activity.sessionId];
      // Skip a no-op re-apply (identical counts) so stable-ref subscribers don't
      // churn — the debounced push can repeat the same rollup.
      if (
        prev &&
        prev.autoApproved === activity.autoApproved &&
        prev.wouldApprove === activity.wouldApprove &&
        prev.askedBack === activity.askedBack
      ) {
        return s;
      }
      return { byId: { ...s.byId, [activity.sessionId]: activity } };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      return { byId };
    })
}));

/**
 * Catch-up summary results (catch-up-summary add-on; EXPERIMENTAL, off by
 * default). Keyed by session id, holding the latest {@link CatchUpSummaryResult}
 * for an agent that sat idle or blocked long enough for the add-on to fire. A
 * SEPARATE slice from {@link useAgentStatus} — the summary is precomputed
 * background LLM work, and keeping it apart means a summary push never
 * invalidates the status/session selectors (render-storm guard, same pattern as
 * {@link useIdleTriage} and {@link useOverseerActivity}).
 */
interface CatchUpSummaryState {
  bySession: Record<string, CatchUpSummaryResult>;
  apply: (result: CatchUpSummaryResult) => void;
  /** Drop one session's summary (tab closed). */
  clear: (sessionId: string) => void;
  /** Drop all summaries for a project (project closed / removed). */
  clearProject: (projectId: string) => void;
}

export const useCatchUpSummary = create<CatchUpSummaryState>((set) => ({
  bySession: {},
  apply: (result) =>
    set((s) => {
      const prev = s.bySession[result.sessionId];
      // Skip a no-op re-apply (same text + trigger) so subscribers with a
      // stable-ref selector don't churn.
      if (prev && prev.text === result.text && prev.trigger === result.trigger) {
        return s;
      }
      return { bySession: { ...s.bySession, [result.sessionId]: result } };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.bySession)) return s;
      const bySession = { ...s.bySession };
      delete bySession[sessionId];
      return { bySession };
    }),
  clearProject: (projectId) =>
    set((s) => {
      // Read membership before the caller wipes the terminals map. Drop every
      // session's summary in one pass.
      const sessions = useData.getState().terminals[projectId] ?? [];
      const ids = new Set(sessions.map((t) => t.id));
      if (ids.size === 0) return s;
      const bySession = { ...s.bySession };
      let changed = false;
      for (const id of ids) {
        if (id in bySession) {
          delete bySession[id];
          changed = true;
        }
      }
      return changed ? { bySession } : s;
    })
}));

/**
 * Live sub-agent (Task tool) spawn counts, keyed by parent session id. A
 * SEPARATE slice from {@link useAgentStatus} on purpose: a session running
 * sub-agents is still `working`, so the count rides its own channel and must
 * never invalidate the status/session selectors (render-storm guard). Backs the
 * "N sub-agents running" badge on the parent's card. Zero is the default, so
 * entries are dropped (not stored as 0) once the count drains.
 */
interface SubagentsState {
  byId: Record<string, number>;
  /** Apply one session's new sub-agent count. Drops the entry at 0 so the
   *  map only ever holds live fan-outs. */
  apply: (sessionId: string, count: number) => void;
  /** Drop one session (pty exited / tab closed). */
  clear: (sessionId: string) => void;
}

export const useSubagents = create<SubagentsState>((set) => ({
  byId: {},
  apply: (sessionId, count) =>
    set((s) => {
      const next = count > 0 ? count : 0;
      if ((s.byId[sessionId] ?? 0) === next) return s;
      const byId = { ...s.byId };
      if (next === 0) delete byId[sessionId];
      else byId[sessionId] = next;
      return { byId };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      return { byId };
    })
}));

/**
 * Per-child sub-agent records keyed by parent session id (A3 — the addressable
 * version of {@link useSubagents}'s count). Mirrors that slice: its own channel
 * + store slice so a start/stop never rebuilds the status/session selectors
 * (render-storm guard). Backs the named child nodes under each Squad Flow
 * parent; entries with no children are dropped (the count badge is the
 * fallback). Pushed as the full array per session (not deltas), so `apply` is a
 * trivial replace.
 */
interface SubagentChildrenState {
  byId: Record<string, SubagentChild[]>;
  /** Replace one session's child list. Drops the entry when empty. */
  apply: (sessionId: string, children: SubagentChild[]) => void;
  /** Drop one session (pty exited / tab closed). */
  clear: (sessionId: string) => void;
}

export const useSubagentChildren = create<SubagentChildrenState>((set) => ({
  byId: {},
  apply: (sessionId, children) =>
    set((s) => {
      if (!children || children.length === 0) {
        if (!(sessionId in s.byId)) return s;
        const byId = { ...s.byId };
        delete byId[sessionId];
        return { byId };
      }
      return { byId: { ...s.byId, [sessionId]: children } };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      return { byId };
    })
}));

interface InboxSelectionState {
  selectedEntryId: string | null;
  select: (id: string | null) => void;
}

export const useInboxSelection = create<InboxSelectionState>((set) => ({
  selectedEntryId: null,
  select: (id) => set({ selectedEntryId: id })
}));

interface InboxReadState {
  /** Object-shaped (not Set) so Zustand `persist` can JSON-serialise it. */
  readIds: Record<string, true>;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  /** Reserved for an explicit "Mark all read" affordance — not auto-fired. */
  markAllRead: (ids: string[]) => void;
  /** Drop read flags for the given ids (entry removed or evicted by retention). */
  pruneRead: (removedIds: string[]) => void;
}

export const useInboxRead = create<InboxReadState>()(
  persist(
    (set) => ({
      readIds: {},
      markRead: (id) =>
        set((s) => (s.readIds[id] ? s : { readIds: { ...s.readIds, [id]: true } })),
      markUnread: (id) =>
        set((s) => {
          if (!s.readIds[id]) return s;
          const next = { ...s.readIds };
          delete next[id];
          return { readIds: next };
        }),
      markAllRead: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const next = { ...s.readIds };
          for (const id of ids) next[id] = true;
          return { readIds: next };
        }),
      pruneRead: (removedIds) =>
        set((s) => {
          let changed = false;
          const next = { ...s.readIds };
          for (const id of removedIds) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { readIds: next } : s;
        })
    }),
    { name: 'zcc.inbox-read.v1', version: 1 }
  )
);

interface InboxAnsweredState {
  /**
   * Entries the user has replied to via the inbox reply box. Object-shaped
   * (not Set) so Zustand `persist` can JSON-serialise it. Mirrors
   * `useInboxRead` — read and answered are independent axes (an entry can be
   * read but unanswered, or answered which implies read).
   */
  answeredIds: Record<string, true>;
  markAnswered: (id: string) => void;
  /** Drop answered flags for the given ids (entry removed or evicted). */
  pruneAnswered: (removedIds: string[]) => void;
}

export const useInboxAnswered = create<InboxAnsweredState>()(
  persist(
    (set) => ({
      answeredIds: {},
      markAnswered: (id) =>
        set((s) =>
          s.answeredIds[id] ? s : { answeredIds: { ...s.answeredIds, [id]: true } }
        ),
      pruneAnswered: (removedIds) =>
        set((s) => {
          let changed = false;
          const next = { ...s.answeredIds };
          for (const id of removedIds) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { answeredIds: next } : s;
        })
    }),
    { name: 'zcc.inbox-answered.v1', version: 1 }
  )
);

interface SchedulerLiveState {
  tasks: ScheduledTask[];
  loading: boolean;
}

export const useScheduler = create<SchedulerLiveState>(() => ({
  tasks: [],
  loading: true
}));

interface GoalsLiveState {
  goals: Goal[];
  loading: boolean;
}

/**
 * Live goal list — driven by the `goals:onChanged` push from the main process,
 * which fires after every CRUD action, every iteration spawn, and every
 * evaluator verdict. Like {@link useScheduler}, the panel never polls.
 */
export const useGoals = create<GoalsLiveState>(() => ({
  goals: [],
  loading: true
}));

interface FollowUpsLiveState {
  followups: FollowUp[];
  loading: boolean;
}

/**
 * Live follow-up list — driven by the `followups:onChanged` push from the main
 * process, which fires after every CRUD action and every idle-triage →
 * follow-up bridge. Like {@link useGoals}, the panel never polls.
 */
export const useFollowUps = create<FollowUpsLiveState>(() => ({
  followups: [],
  loading: true
}));

/**
 * Auto-update state — driven by the `updates:onStatus`/`onProgress` pushes from
 * the main process (electron-updater). `progress` is only meaningful while
 * `status.kind === 'downloading'`.
 */
interface UpdatesLiveState {
  status: UpdateStatus;
  progress: UpdateProgress | null;
}

export const useUpdates = create<UpdatesLiveState>(() => ({
  status: { kind: 'idle' },
  progress: null
}));

/**
 * "What's New" modal state. `notes` are the curated release-notes docs to show;
 * `open` gates the modal. Opened two ways: automatically on first launch after
 * an update (the boot `consumeWhatsNew` pull, which also advances the seen
 * baseline in main), or on demand from the About tab (`openWhatsNewAll`). Kept
 * separate from `useUpdates` so the modal is independent of the live updater
 * status stream.
 */
interface WhatsNewState {
  open: boolean;
  notes: ReleaseNote[];
  /** Heading context — the version range this batch covers, when known. */
  toVersion: string | null;
  openWith(notes: ReleaseNote[], toVersion: string | null): void;
  close(): void;
}

export const useWhatsNew = create<WhatsNewState>((set) => ({
  open: false,
  notes: [],
  toVersion: null,
  openWith(notes, toVersion) {
    if (notes.length === 0) return;
    set({ open: true, notes, toVersion });
  },
  close() {
    set({ open: false });
  }
}));

/**
 * Open the What's New modal with ALL bundled release notes (the About-tab
 * on-demand path — no version clamp). Best-effort: a read failure or an empty
 * set simply doesn't open the modal.
 */
export async function openWhatsNewAll(): Promise<void> {
  try {
    const notes = await window.cc.updates.getReleaseNotes();
    useWhatsNew.getState().openWith(notes, notes[0]?.version ?? null);
  } catch {
    // Degrade closed — the About tab keeps its "View on GitHub" fallback link.
  }
}

/**
 * First-run dependency-doctor state — driven by `deps:onStatus`/`onProgress`
 * pushes from the main process. `status` is the full setup snapshot (every
 * tracked dependency + its phase); `progress` is the most recent per-step
 * install log line, keyed by dependency id (cleared when a fresh status lands).
 */
interface SetupLiveState {
  status: SetupStatus;
  /** Latest install log line per dependency id (for the spinner caption). */
  progress: Record<string, string>;
}

export const useSetup = create<SetupLiveState>(() => ({
  status: { busy: false, items: [] },
  progress: {}
}));

/**
 * Whether the setup checklist has anything worth showing — any dependency that
 * is missing or failed to install. Gates the first-run auto-open and the
 * Sidebar/Settings affordance.
 */
export function hasMissingSetup(status: SetupStatus): boolean {
  return status.items.some((i) => i.phase === 'missing' || i.phase === 'failed');
}

/**
 * Session-scoped dismissal for the update banner. The banner's data (whether an
 * update is available / downloading / downloaded, and the target version) comes
 * straight from `useUpdates` (the electron-updater status stream). This slice
 * only tracks the per-session "I clicked ×" choice — a persisted "skip this
 * version" goes through `window.cc.updates.skip`, which the updater honors
 * across launches. Kept tiny and separate so the banner can hide without
 * disturbing the shared updater status the About section also reads.
 */
interface UpdateBannerState {
  dismissed: boolean;
  dismiss: () => void;
  /** Re-show (e.g. a newer version arrives after an earlier dismiss). */
  reset: () => void;
}

export const useUpdateBanner = create<UpdateBannerState>((set) => ({
  dismissed: false,
  dismiss() {
    set({ dismissed: true });
  },
  reset() {
    set({ dismissed: false });
  }
}));

/**
 * Single source of truth for "is the update banner showing". Both the banner
 * component (its render gate) and App.tsx (which reserves the shell grid row)
 * call this, so the row can't reserve space without a banner or vice-versa.
 */
export function isUpdateBannerVisible(kind: UpdateStatus['kind'], dismissed: boolean): boolean {
  if (dismissed) return false;
  return kind === 'available' || kind === 'downloading' || kind === 'downloaded';
}

/**
 * Saved inbox reports — live mirror of `~/.zcc/saved/`. Full-list
 * replacement on every `saved:onChanged` push (low volume), like useScheduler.
 */
interface SavedLiveState {
  records: SavedRecord[];
  loading: boolean;
}

export const useSaved = create<SavedLiveState>(() => ({
  records: [],
  loading: true
}));

/**
 * Which saved report is open in the detail pane. Mirrors {@link
 * useInboxSelection} — the Saved tab's list drives it, the detail pane reads it.
 * A separate store (not shared with the inbox selection) so switching tabs
 * preserves each side's own selection.
 */
interface SavedSelectionState {
  selectedSavedId: string | null;
  selectSaved: (id: string | null) => void;
}

export const useSavedSelection = create<SavedSelectionState>((set) => ({
  selectedSavedId: null,
  selectSaved: (id) => set({ selectedSavedId: id })
}));

/**
 * Inter-agent mesh, read-only mirror for the Agents board: the live discovery
 * registry (`agents`) and the agent↔agent message history (`messages`). Kept in
 * its own store — distinct from `useInbox` (agent→User) and from `useData`'s
 * session list. Registry changes re-fetch the whole list (cheap, like
 * `useSaved`); messages prepend per push. `setAll`/`prependMessage` are called
 * from the boot subscriptions in `initApp`.
 */
interface AgentMeshState {
  agents: AgentRecord[];
  messages: AgentMessage[];
  setAgents: (agents: AgentRecord[]) => void;
  setMessages: (messages: AgentMessage[]) => void;
  prependMessage: (msg: AgentMessage) => void;
  /** Drop messages evicted by main's retention sweep (the onMessagesPruned push). */
  removeMessages: (removedIds: string[]) => void;
}

export const useAgentMesh = create<AgentMeshState>((set) => ({
  agents: [],
  messages: [],
  setAgents: (agents) => set({ agents }),
  setMessages: (messages) => set({ messages }),
  prependMessage: (msg) =>
    set((s) =>
      s.messages.some((m) => m.id === msg.id) ? s : { messages: [msg, ...s.messages] }
    ),
  removeMessages: (removedIds) =>
    set((s) => {
      if (removedIds.length === 0) return s;
      const drop = new Set(removedIds);
      const next = s.messages.filter((m) => !drop.has(m.id));
      return next.length === s.messages.length ? s : { messages: next };
    })
}));

/**
 * Per-inbox-entry "saved" marker, persisted to localStorage (mirrors
 * useInboxAnswered). Lets the detail view show a "Saved ✓" state without
 * scanning the saved records for a matching sourceEntryId on every render.
 */
interface SavedMarkState {
  savedEntryIds: Record<string, true>;
  markSaved: (entryId: string) => void;
  /** Drop saved-marks for the given ids (entry removed or evicted). */
  pruneSaved: (removedIds: string[]) => void;
}

export const useSavedMark = create<SavedMarkState>()(
  persist(
    (set) => ({
      savedEntryIds: {},
      markSaved: (entryId) =>
        set((s) =>
          s.savedEntryIds[entryId]
            ? s
            : { savedEntryIds: { ...s.savedEntryIds, [entryId]: true } }
        ),
      pruneSaved: (removedIds) =>
        set((s) => {
          let changed = false;
          const next = { ...s.savedEntryIds };
          for (const id of removedIds) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { savedEntryIds: next } : s;
        })
    }),
    { name: 'zcc.inbox-saved.v1', version: 1 }
  )
);

/**
 * The persisted identity of a starred agent. We key on `claudeSessionId` when
 * present, NOT the live `session.id`: `session.id` is an ephemeral UUID minted
 * fresh on every pty spawn (and a restored tab gets a brand-new one — see
 * sessionRestore.ts), so a star keyed on it could never survive a relaunch. The
 * `claudeSessionId` is the conversation id we force with `--session-id` and
 * resume with `--resume <id>`, so it's STABLE across restart — a restored agent
 * comes back carrying the same one, and its star reattaches. Non-claude agents
 * (no claudeSessionId) fall back to `session.id`: they aren't restored anyway,
 * so the star is session-scoped for them, matching the old behavior.
 */
export function favoriteKey(s: { id: string; claudeSessionId?: string }): string {
  return s.claudeSessionId ?? s.id;
}

/**
 * Starred ("favorite") agents — a set of {@link favoriteKey}s the user has
 * flagged to follow, surfaced in the right-edge Favorites drawer. Persisted to
 * localStorage (like the inbox-saved store) so the set survives relaunch, and
 * wired into {@link installInboxCrossWindowSync} so starring in one window
 * reflects in every other open window. A starred key whose agent isn't
 * currently live is simply filtered out at render (the badge count uses the
 * same live intersection, so the two can't diverge); a restored agent that
 * comes back with the same `claudeSessionId` keeps its star.
 *
 * v2: the key scheme changed from the ephemeral `session.id` to {@link
 * favoriteKey}. Old v1 entries are session-id-keyed and can never match a
 * restored agent, so the migration drops them (the user re-stars — they were
 * already non-functional across restart, which is the bug this fixes).
 */
interface FavoriteAgentsState {
  favoriteIds: Record<string, true>;
  toggleFavorite: (key: string) => void;
}

export const useFavoriteAgents = create<FavoriteAgentsState>()(
  persist(
    (set) => ({
      favoriteIds: {},
      toggleFavorite: (key) =>
        set((s) => {
          const next = { ...s.favoriteIds };
          if (next[key]) delete next[key];
          else next[key] = true;
          return { favoriteIds: next };
        })
    }),
    {
      name: 'zcc.favorite-agents.v1',
      version: 2,
      // v1 → v2: drop the old session-id-keyed set (incompatible + unrecoverable).
      migrate: () => ({ favoriteIds: {} })
    }
  )
);

/**
 * Library docs — live mirror of both scopes (global + per-project). Full-list
 * replacement on every `library:onChanged` push (low volume), like useScheduler.
 * CRITICAL: expose the raw `docs` slice — do NOT add selectors that return fresh
 * `?? []` / `.filter()` arrays (infinite-loop trap, see `zustand-selector-stable-ref`).
 */
interface LibraryLiveState {
  docs: LibraryDoc[];
  loading: boolean;
}

export const useLibrary = create<LibraryLiveState>(() => ({
  docs: [],
  loading: true
}));

/**
 * Per-inbox-entry "Keep" flag (star), persisted to localStorage like the other
 * inbox marker stores. A kept entry is protected from "Clear inbox" — it's the
 * user's explicit "don't sweep this away" signal, independent of read/answered/
 * saved. Toggleable (unlike the one-way markers) since keep is a user decision
 * they may reverse.
 */
interface InboxKeepState {
  keptIds: Record<string, true>;
  toggleKeep: (entryId: string) => void;
  /** Drop keep flags for ids no longer present (housekeeping after a clear). */
  pruneKeep: (presentIds: string[]) => void;
  /** Drop keep flags for the given REMOVED ids (entry deleted or evicted). */
  pruneKeptByIds: (removedIds: string[]) => void;
}

export const useInboxKeep = create<InboxKeepState>()(
  persist(
    (set) => ({
      keptIds: {},
      toggleKeep: (entryId) =>
        set((s) => {
          const next = { ...s.keptIds };
          if (next[entryId]) delete next[entryId];
          else next[entryId] = true;
          return { keptIds: next };
        }),
      pruneKeep: (presentIds) =>
        set((s) => {
          const present = new Set(presentIds);
          const next: Record<string, true> = {};
          let changed = false;
          for (const id of Object.keys(s.keptIds)) {
            if (present.has(id)) next[id] = true;
            else changed = true;
          }
          return changed ? { keptIds: next } : s;
        }),
      pruneKeptByIds: (removedIds) =>
        set((s) => {
          let changed = false;
          const next = { ...s.keptIds };
          for (const id of removedIds) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { keptIds: next } : s;
        })
    }),
    { name: 'zcc.inbox-keep.v1', version: 1 }
  )
);

/**
 * Persisted inbox subgroup-collapse state. The sidebar groups entries by time
 * bucket → project; this remembers which (bucket, project) subgroups the user
 * folded so expanding "Today / my-project" doesn't auto-expand "Yesterday /
 * my-project". Keyed by `subGroupKey(bucket, projectId)`.
 *
 * The render layer also AUTO-folds a project whose entries are all read (an
 * implicit default); this store only records EXPLICIT user toggles, so an
 * explicit choice always wins over the all-read default (see InboxSidebar).
 */
interface InboxCollapsedState {
  /** Explicitly user-toggled subgroup keys → their collapsed bool. Absence means
   *  "no explicit choice" → fall back to the all-read auto-fold default. */
  byKey: Record<string, boolean>;
  /** Flip one subgroup key's explicit collapsed state. */
  toggle: (key: string) => void;
  /** Set every given subgroup key's explicit state at once (header collapse-all). */
  setMany: (keys: string[], collapsed: boolean) => void;
}

export const useInboxCollapsed = create<InboxCollapsedState>()(
  persist(
    (set) => ({
      byKey: {},
      toggle: (key) =>
        set((s) => ({
          byKey: { ...s.byKey, [key]: !s.byKey[key] }
        })),
      setMany: (keys, collapsed) =>
        set((s) => {
          if (keys.length === 0) return s;
          const next = { ...s.byKey };
          for (const key of keys) next[key] = collapsed;
          return { byKey: next };
        })
    }),
    { name: 'zcc.inbox-collapsed.v2', version: 2 }
  )
);

/**
 * Persisted collapse state for the agent detail panel — the right-hand rail that
 * shows one agent's facts + transcript insights beside its live terminal. Two
 * independent surfaces host it (the List-view monitor and the agent-inspector
 * modal), so each remembers its own preference under a distinct key: collapsing
 * the panel in the modal shouldn't fold the monitor's rail and vice-versa.
 * Collapsed gives the terminal the width; the choice sticks across reloads.
 */
interface AgentPanelState {
  /** Per-surface collapsed bit. Absence ⇒ expanded (the default). */
  collapsed: Record<'monitor' | 'modal', boolean>;
  toggle: (surface: 'monitor' | 'modal') => void;
}

export const useAgentPanel = create<AgentPanelState>()(
  persist(
    (set) => ({
      collapsed: { monitor: false, modal: false },
      toggle: (surface) =>
        set((s) => ({ collapsed: { ...s.collapsed, [surface]: !s.collapsed[surface] } }))
    }),
    { name: 'zcc.agent-panel.v1', version: 1 }
  )
);

/**
 * The Inbox "AI Summary" card state, keyed by scope: `'__all__'` for the
 * cross-project digest, else a projectId for the focused/scoped digest. Each
 * scope caches its last digest plus the inbox-content `signature` it was
 * generated from, so we only spend a (paid) micro-call when the inbox actually
 * changed and the prior digest has gone stale. In-memory only — a digest is
 * cheap to regenerate and a persisted one would just show stale on next launch.
 */
const ALL_SCOPE_KEY = '__all__';
/** Minimum gap between AUTOMATIC (view-driven) regenerations of one scope, so an
 *  inbox that's churning doesn't trigger a call on every push. A manual refresh
 *  (the card's button) bypasses this. 10 min mirrors the "every X minutes if
 *  changed" cadence without a background timer — the card asks when viewed. */
export const INBOX_SUMMARY_AUTO_MIN_MS = 10 * 60_000;

export interface InboxSummaryCacheItem {
  digest: InboxDigest | null;
  /** Epoch ms of the last successful generation, or null if never generated. */
  generatedAt: number | null;
  loading: boolean;
  /** 'empty' (nothing to summarize) | 'failed' | null. Drives the card's fallback. */
  error: 'empty' | 'failed' | null;
  /** Inbox-content signature the cached digest reflects (see inboxContentSignature). */
  signature: string;
}

interface InboxSummaryState {
  byScope: Record<string, InboxSummaryCacheItem>;
  setItem: (scopeKey: string, patch: Partial<InboxSummaryCacheItem>) => void;
}

export const useInboxSummary = create<InboxSummaryState>((set) => ({
  byScope: {},
  setItem: (scopeKey, patch) =>
    set((s) => {
      const prev = s.byScope[scopeKey] ?? {
        digest: null,
        generatedAt: null,
        loading: false,
        error: null,
        signature: ''
      };
      return { byScope: { ...s.byScope, [scopeKey]: { ...prev, ...patch } } };
    })
}));

export const scopeKeyFor = (projectId: string | null): string => projectId ?? ALL_SCOPE_KEY;

/**
 * A stable signature of the inbox entries in a scope — id + timestamp +
 * occurrence count per entry. Changes whenever an entry is added, removed, or
 * coalesced (which bumps ts/occurrences), so it's exactly "did the inbox change
 * in a way worth re-summarizing". Order-independent count + a cheap join keep it
 * O(n) without hashing. Pure.
 */
export function inboxContentSignature(entries: InboxEntry[]): string {
  if (entries.length === 0) return '0';
  // entries are newest-first and stable-ordered; join is enough (no sort needed).
  let sig = `${entries.length}:`;
  for (const e of entries) sig += `${e.id}@${e.ts}#${e.occurrences ?? 1};`;
  return sig;
}

/**
 * Run the inbox-summary micro-call for one scope and fold the result into the
 * cache. Sets `loading` around the call. Never throws (the IPC resolves to a
 * tagged result). `signature` is stamped so a later staleness check can tell the
 * digest still reflects the current inbox.
 */
export async function refreshInboxSummary(
  projectId: string | null,
  signature: string
): Promise<void> {
  const scopeKey = scopeKeyFor(projectId);
  const { setItem } = useInboxSummary.getState();
  setItem(scopeKey, { loading: true });
  try {
    const res = await window.cc.inbox.summarize(projectId);
    if (res.ok) {
      setItem(scopeKey, {
        digest: res.digest,
        generatedAt: Date.now(),
        loading: false,
        error: null,
        signature
      });
    } else {
      setItem(scopeKey, {
        loading: false,
        error: res.reason === 'empty' ? 'empty' : 'failed',
        // Stamp the signature even on a soft failure so we don't hammer the model
        // on every render for an inbox that simply can't be summarized yet.
        signature
      });
    }
  } catch {
    setItem(scopeKey, { loading: false, error: 'failed', signature });
  }
}

/**
 * View-driven, throttled auto-refresh of a scope's AI summary. Called by the
 * card when the Inbox is open: regenerates only when (a) not already loading,
 * (b) the inbox content changed since the cached digest (or there is none), and
 * (c) it's been at least {@link INBOX_SUMMARY_AUTO_MIN_MS} since the last
 * generation. This is the "regenerate every X minutes if things changed" rule
 * without a background timer — nothing runs while the user isn't looking.
 */
export function maybeRefreshInboxSummary(projectId: string | null, entries: InboxEntry[]): void {
  const scopeKey = scopeKeyFor(projectId);
  const item = useInboxSummary.getState().byScope[scopeKey];
  if (item?.loading) return;
  const signature = inboxContentSignature(entries);
  const unchanged = item && item.signature === signature && item.generatedAt !== null;
  if (unchanged) return; // inbox hasn't changed since last (success OR soft-fail)
  // Throttle automatic regens: if we generated recently, wait — a manual refresh
  // bypasses this by calling refreshInboxSummary directly.
  if (item?.generatedAt && Date.now() - item.generatedAt < INBOX_SUMMARY_AUTO_MIN_MS) return;
  void refreshInboxSummary(projectId, signature);
}

/* ------------------------------------------------------------------------- *
 * Feed-noise classifier overlay — the OPTIONAL "Routine" demotion.          *
 * ------------------------------------------------------------------------- *
 * Mirrors {@link useInboxSummary}: an advisory, per-scope cache of the entry
 * ids main judged routine, keyed by the same {@link inboxContentSignature} so a
 * stable inbox never re-spends tokens. NON-PERSISTED — recomputed each session,
 * applied only as a grouping overlay ({@link groupByBucketThenProject}'s
 * `routineIds`). Gated by `feedNoiseClassifierEnabled`; when off, the hook never
 * fetches and the overlay stays empty (every report inline). */
export interface FeedNoiseCacheItem {
  /** Ids to demote into the folded "Routine" section. */
  routineIds: Set<string>;
  generatedAt: number | null;
  loading: boolean;
  /** Inbox-content signature the cached verdict reflects. */
  signature: string;
}

interface FeedNoiseState {
  byScope: Record<string, FeedNoiseCacheItem>;
  setItem: (scopeKey: string, patch: Partial<FeedNoiseCacheItem>) => void;
}

export const useFeedNoise = create<FeedNoiseState>((set) => ({
  byScope: {},
  setItem: (scopeKey, patch) =>
    set((s) => {
      const prev = s.byScope[scopeKey] ?? {
        routineIds: new Set<string>(),
        generatedAt: null,
        loading: false,
        signature: ''
      };
      return { byScope: { ...s.byScope, [scopeKey]: { ...prev, ...patch } } };
    })
}));

/**
 * Run the feed-noise classify call for one scope and fold the id set into the
 * cache. Never throws (the IPC resolves to `{ routineIds: [] }` on failure).
 */
export async function refreshFeedNoise(
  projectId: string | null,
  signature: string
): Promise<void> {
  const scopeKey = scopeKeyFor(projectId);
  const { setItem } = useFeedNoise.getState();
  setItem(scopeKey, { loading: true });
  try {
    const res = await window.cc.inbox.classifyNoise(projectId);
    setItem(scopeKey, {
      routineIds: new Set(res.routineIds),
      generatedAt: Date.now(),
      loading: false,
      signature
    });
  } catch {
    // Degrade to "nothing demoted" — the overlay is advisory, never load-bearing.
    setItem(scopeKey, { routineIds: new Set(), loading: false, signature });
  }
}

/**
 * View-driven, throttled refresh of a scope's routine overlay — the classifier
 * twin of {@link maybeRefreshInboxSummary}, same discipline: only when enabled,
 * not already loading, the inbox changed since the cached verdict, and it's been
 * at least {@link INBOX_SUMMARY_AUTO_MIN_MS} since the last run. When disabled it
 * is a no-op (and the caller ignores the empty overlay).
 */
export function maybeRefreshFeedNoise(
  projectId: string | null,
  entries: InboxEntry[],
  enabled: boolean
): void {
  if (!enabled) return;
  const scopeKey = scopeKeyFor(projectId);
  const item = useFeedNoise.getState().byScope[scopeKey];
  if (item?.loading) return;
  const signature = inboxContentSignature(entries);
  const unchanged = item && item.signature === signature && item.generatedAt !== null;
  if (unchanged) return;
  if (item?.generatedAt && Date.now() - item.generatedAt < INBOX_SUMMARY_AUTO_MIN_MS) return;
  void refreshFeedNoise(projectId, signature);
}

/* ------------------------------------------------------------------------- *
 * Detailed inbox digest — backs the "Details" modal on the AI Summary card. *
 * ------------------------------------------------------------------------- *
 * Unlike the short card digest, the detailed one is ON-DEMAND ONLY: it is
 * never background-warmed (no standing pre-warm justification for the deeper,
 * pricier call). It's cached per scope keyed by the same
 * {@link inboxContentSignature}, so reopening the modal while the inbox hasn't
 * changed is free; a content change (or a manual regen) re-fetches. */
export interface DetailedInboxSummaryCacheItem {
  digest: DetailedInboxDigest | null;
  generatedAt: number | null;
  loading: boolean;
  error: 'empty' | 'failed' | null;
  /** Inbox-content signature the cached digest reflects (see inboxContentSignature). */
  signature: string;
}

interface DetailedInboxSummaryState {
  byScope: Record<string, DetailedInboxSummaryCacheItem>;
  setItem: (scopeKey: string, patch: Partial<DetailedInboxSummaryCacheItem>) => void;
}

export const useInboxDetailedSummary = create<DetailedInboxSummaryState>((set) => ({
  byScope: {},
  setItem: (scopeKey, patch) =>
    set((s) => {
      const prev = s.byScope[scopeKey] ?? {
        digest: null,
        generatedAt: null,
        loading: false,
        error: null,
        signature: ''
      };
      return { byScope: { ...s.byScope, [scopeKey]: { ...prev, ...patch } } };
    })
}));

/**
 * Run the detailed inbox-summary micro-call for one scope and fold the result
 * into the cache. Sets `loading` around the call; loading-guarded so a double
 * open can't fire two calls. Never throws (the IPC resolves to a tagged result).
 * `force` bypasses the signature cache-hit check (the modal's "regenerate").
 */
export async function refreshDetailedInboxSummary(
  projectId: string | null,
  signature: string,
  force = false
): Promise<void> {
  const scopeKey = scopeKeyFor(projectId);
  const { byScope, setItem } = useInboxDetailedSummary.getState();
  const item = byScope[scopeKey];
  if (item?.loading) return;
  // Cache hit: same inbox content since the last successful gen → nothing to do.
  if (!force && item?.digest && item.signature === signature && item.generatedAt !== null) return;
  setItem(scopeKey, { loading: true });
  try {
    const res = await window.cc.inbox.summarizeDetailed(projectId);
    if (res.ok) {
      setItem(scopeKey, {
        digest: res.digest,
        generatedAt: Date.now(),
        loading: false,
        error: null,
        signature
      });
    } else {
      setItem(scopeKey, {
        loading: false,
        error: res.reason === 'empty' ? 'empty' : 'failed',
        signature
      });
    }
  } catch {
    setItem(scopeKey, { loading: false, error: 'failed', signature });
  }
}

/**
 * Usage / cost dashboard state (WARP R2 B7). Holds the last {@link UsageSummary}
 * fetched from main, plus a loading flag. The summary is a whole-workspace
 * rollup (not scoped), so a single cached value is enough — the panel calls
 * {@link UsageState.refresh} on mount and on an explicit refresh click.
 */
interface UsageState {
  summary: UsageSummary | null;
  loading: boolean;
  /** True once a fetch has completed at least once (so we can tell "not loaded
   *  yet" from "loaded an empty summary"). */
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useUsage = create<UsageState>((set, get) => ({
  summary: null,
  loading: false,
  loaded: false,
  refresh: async () => {
    // De-dupe concurrent refreshes (mount effect + a click can race).
    if (get().loading) return;
    set({ loading: true });
    try {
      // getSummary never throws — main resolves to an empty summary on failure.
      const summary = await window.cc.usage.getSummary();
      set({ summary, loading: false, loaded: true });
    } catch {
      // Defensive: even if the bridge itself rejects, don't wedge the panel.
      set({ loading: false, loaded: true });
    }
  }
}));

/**
 * Prune every persisted per-entry marker for a set of removed/evicted entry ids.
 * Called from the inbox `onRemoved` (single delete) and `onPruned` (retention
 * eviction) subscriptions so the read/answered/saved/keep localStorage maps
 * don't accumulate dead ids as inbox history rolls over. A no-op per store when
 * none of the ids were marked (each pruner returns the same state ref).
 */
function pruneInboxMarkers(removedIds: string[]): void {
  if (removedIds.length === 0) return;
  useInboxRead.getState().pruneRead(removedIds);
  useInboxAnswered.getState().pruneAnswered(removedIds);
  useSavedMark.getState().pruneSaved(removedIds);
  useInboxKeep.getState().pruneKeptByIds(removedIds);
}

/**
 * Cross-window sync for the inbox user-state stores. These four are Zustand
 * `persist` stores backed by localStorage, which is shared across every window
 * of the app (same origin) — but `persist` only READS localStorage at boot, so
 * a change made in one window (e.g. marking an entry read in a per-project
 * window) wouldn't reach an already-open main window until it reloaded.
 *
 * The browser `storage` event fires in OTHER windows when localStorage changes
 * (never in the window that made the write), so re-hydrating the matching store
 * on that event keeps read / answered / saved / kept state live across windows.
 * Call once at app init; returns an unsubscribe.
 */
const INBOX_PERSIST_STORES: Record<string, { persist: { rehydrate: () => void | Promise<void> } }> = {
  'zcc.inbox-read.v1': useInboxRead,
  'zcc.inbox-answered.v1': useInboxAnswered,
  'zcc.inbox-saved.v1': useSavedMark,
  'zcc.inbox-keep.v1': useInboxKeep,
  // Not strictly inbox state, but the same localStorage-only persist store that
  // wants to stay live across windows — starring an agent in one window should
  // update the Favorites drawer in every other window.
  'zcc.favorite-agents.v1': useFavoriteAgents,
  // Agent detail-panel collapse: keep the folded/expanded rail consistent across
  // windows so the terminal-vs-details split doesn't jump when you switch.
  'zcc.agent-panel.v1': useAgentPanel
};

export function installInboxCrossWindowSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (!e.key) return; // null key ⇒ storage.clear(); ignore
    const store = INBOX_PERSIST_STORES[e.key];
    if (store) void store.persist.rehydrate();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

interface ScheduleTemplatesState {
  templates: ScheduleTemplate[];
  loading: boolean;
}

export const useScheduleTemplates = create<ScheduleTemplatesState>(() => ({
  templates: [],
  loading: true
}));

interface PersonasState {
  personas: Persona[];
  loading: boolean;
}

/**
 * Launchable personas — fed from `zcc.personas.list` on boot and refreshed by
 * the main process's `personas:onChanged` push (same one-shot + push pattern as
 * useScheduleTemplates). Read-only in the renderer; authoring is by editing the
 * JSON files the "Reveal" action opens.
 */
export const usePersonas = create<PersonasState>(() => ({
  personas: [],
  loading: true
}));

interface TeamsState {
  teams: Team[];
  loading: boolean;
}

/**
 * Launchable teams — fed from `cc.teams.list` on boot and refreshed by the main
 * process's `teams:onChanged` push (same one-shot + push pattern as
 * usePersonas). Read-only in the renderer; authoring is by the editor / the JSON
 * files the "Reveal" action opens.
 */
export const useTeams = create<TeamsState>(() => ({
  teams: [],
  loading: true
}));

interface AutonomousRunsState {
  runs: AutonomousRun[];
}

/**
 * In-memory autonomous team runs, fed from `cc.autonomousRuns.list` on boot and
 * refreshed by the main process's `autonomousRuns:onChanged` push. Runs are
 * live-only (die with the app), so there is no persistence here.
 */
export const useAutonomousRuns = create<AutonomousRunsState>(() => ({
  runs: []
}));

interface ScheduleGroupsState {
  groups: ScheduleGroup[];
  loading: boolean;
}

export const useScheduleGroups = create<ScheduleGroupsState>(() => ({
  groups: [],
  loading: true
}));

interface PluginsLiveState {
  entries: PluginEntry[];
  loading: boolean;
}

export const usePlugins = create<PluginsLiveState>(() => ({
  entries: [],
  loading: true
}));

interface McpLiveState {
  entries: McpServerEntry[];
  loading: boolean;
}

export const useMcpCatalogue = create<McpLiveState>(() => ({
  entries: [],
  loading: true
}));

/**
 * Sidebar/titlebar notification count for inbox: unread entries whose feed
 * category is SIGNAL we want to actively notify about (`question` or `report`).
 * Everything else (goal outcomes + folded/noise categories) stays in inbox but
 * does not increment the notification badge.
 */
/**
 * The project the inbox is currently scoped to, or `null` for all-projects.
 * A per-project WINDOW (hard URL lock via {@link getScopedProjectId}) wins;
 * absent that, the MAIN WINDOW's `focusedProjectId` (soft, store-driven focus).
 * This is the inbox twin of {@link isProjectFocusedView} — when the shell is
 * drilled into one project, the inbox shows only that project's entries.
 */
export function useInboxScopeProjectId(): string | null {
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  return getScopedProjectId() ?? focusedProjectId;
}

export function useUnreadInboxCount(): number {
  const entries = useInbox((s) => s.entries);
  const readIds = useInboxRead((s) => s.readIds);
  // Scope to the focused/scoped project so the badge tracks exactly what the
  // Inbox view shows. A scoped window's `entries` are already project-filtered
  // at the source (see init); a focused main window holds every project's
  // entries, so this filter is what actually narrows the count there.
  const scopeProjectId = useInboxScopeProjectId();
  let n = 0;
  for (const e of entries) {
    if (scopeProjectId && e.projectId !== scopeProjectId) continue;
    if (readIds[e.id]) continue;
    const category = classifyEntry(e);
    if (category !== 'question' && category !== 'report') continue;
    n += 1;
  }
  return n;
}

/** Sidebar-badge count: scheduled tasks that are enabled (armed to fire). */
export function useEnabledSchedulerCount(): number {
  const tasks = useScheduler((s) => s.tasks);
  let n = 0;
  for (const t of tasks) if (t.enabled) n += 1;
  return n;
}

/**
 * Sidebar-badge count: scheduled tasks with a live terminal session right
 * now. Mirrors the "Running now" computation in SchedulerOverview — a task
 * counts as running when any of its run-history records points at a session
 * that is still `running`/`starting` in the project's terminals.
 */
export function useRunningSchedulerCount(): number {
  const tasks = useScheduler((s) => s.tasks);
  const terminals = useData((s) => s.terminals);
  const live = new Set<string>();
  for (const [pid, list] of Object.entries(terminals)) {
    for (const s of list) {
      if (s.status === 'running' || s.status === 'starting') {
        live.add(`${pid}:${s.id}`);
      }
    }
  }
  let n = 0;
  for (const t of tasks) {
    for (const r of t.status?.runs ?? []) {
      if (r.sessionId && live.has(`${t.projectId}:${r.sessionId}`)) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

/** Sidebar-badge count: goals that are armed (status `active`) right now. */
export function useActiveGoalCount(): number {
  const goals = useGoals((s) => s.goals);
  let n = 0;
  for (const g of goals) if (g.status === 'active') n += 1;
  return n;
}

/** Sidebar-badge count: open (unresolved) follow-ups across all projects. */
export function useOpenFollowUpCount(): number {
  const followups = useFollowUps((s) => s.followups);
  let n = 0;
  for (const f of followups) if (f.status === 'open') n += 1;
  return n;
}

/** Count of `active` goals for ONE project — backs the per-project Goals tab badge. */
export function useProjectActiveGoalCount(projectId: string): number {
  const goals = useGoals((s) => s.goals);
  let n = 0;
  for (const g of goals) if (g.projectId === projectId && g.status === 'active') n += 1;
  return n;
}

/**
 * Count of schedules that spawn a terminal in ONE project — backs the
 * per-project Scheduler tab badge. Counts by `t.projectId` (the spawn target),
 * NOT `t.source` (where the JSON lives), so a global-scoped schedule that runs
 * in this project is still counted here. Matches the per-project SchedulerPanel
 * filter.
 */
export function useProjectScheduleCount(projectId: string): number {
  const tasks = useScheduler((s) => s.tasks);
  let n = 0;
  for (const t of tasks) if (t.projectId === projectId) n += 1;
  return n;
}

/**
 * Count of live plain SHELL terminals in ONE project — backs the per-project
 * Terminals tab badge. Deliberately counts only `profile === 'shell'` sessions
 * (the Agents badge, `useAgentNavCounts`, owns the agent profiles), so this
 * badge answers "do I have a plain terminal still running here?" without
 * double-counting a working/blocked agent. Uses `listedTerminals` (drops
 * scheduler jobs) and keeps only non-exited sessions, matching the "live" set
 * the Terminals view treats as running.
 */
export function useProjectRunningTerminalCount(projectId: string): number {
  const terminals = useData((s) => s.terminals);
  return liveTerminals(terminals[projectId]).filter((t) => t.profile === 'shell').length;
}

/** Count of `open` follow-ups for ONE project — backs the per-project Follow-ups tab badge. */
export function useProjectOpenFollowUpCount(projectId: string): number {
  const followups = useFollowUps((s) => s.followups);
  let n = 0;
  for (const f of followups) if (f.projectId === projectId && f.status === 'open') n += 1;
  return n;
}

/**
 * Sidebar-badge counts for the Agents nav item. `active` is every agent that
 * is working or blocked right now (headless included — same set the bottom tray
 * surfaces); `blocked` is how many of those need the user. The Agents nav shows
 * `active` as the badge and reds it when `blocked`. Reads the same two stores
 * the Agents list does (terminals + agent status).
 *
 * Scope: a per-project WINDOW (hard URL lock via {@link getScopedProjectId})
 * always wins; absent that, an explicit `projectId` narrows the count to one
 * project (the {@link ProjectScopedNav} rail, which heads a per-project Agents
 * board). With neither, it counts the whole fleet across every project (the
 * global {@link Sidebar}). This mirrors {@link useInboxScopeProjectId}: the
 * scoped-rail badge must track exactly what its scoped board shows, not the
 * fleet — otherwise a project-focused rail reads the whole fleet's count.
 */
export function useAgentNavCounts(projectId?: string): { active: number; blocked: number } {
  const terminals = useData((s) => s.terminals);
  const byId = useAgentStatus((s) => s.byId);
  const scopeProjectId = getScopedProjectId() ?? projectId ?? null;
  const lists = scopeProjectId
    ? [terminals[scopeProjectId] ?? []]
    : Object.values(terminals);
  let active = 0;
  let blocked = 0;
  for (const list of lists) {
    for (const session of list) {
      // A `shell` tab is not an agent — the Agents board / list exclude it, so
      // the "Agents" badge must too, or a shell that happens to emit a spinner
      // (npm install, a manually-launched claude) would be counted as "working"
      // here while showing zero rows in the list it heads. Match the list.
      if (session.profile === 'shell') continue;
      const state = byId[session.id];
      if (state === 'blocked') {
        active += 1;
        blocked += 1;
      } else if (state === 'working') {
        active += 1;
      }
    }
  }
  return { active, blocked };
}

/**
 * Optimistic delete + IPC. Called from the detail view's trash button and
 * the Delete/Backspace shortcut. Removes locally first so the UI doesn't
 * lag the IPC round-trip; the main process's onRemoved push echoes back
 * and is a no-op (already filtered out).
 */
export async function deleteInboxEntry(id: string): Promise<void> {
  useInbox.getState().removeLocal(id);
  try {
    await window.cc.inbox.delete(id);
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to delete inbox entry'));
  }
}

/**
 * Clear the inbox, preserving entries the user has flagged "Keep" (star).
 *
 * We compute the explicit list of ids to REMOVE from the current visible
 * entries minus the kept set — never "keep only these" — so the main store
 * deletes exactly what the user saw, and any entry appended after this call
 * survives. Optimistic local removal first, then one bulk IPC. Returns the
 * number removed (0 when there was nothing to clear).
 */
export async function clearInbox(projectId?: string | null): Promise<number> {
  const { entries, removeManyLocal } = useInbox.getState();
  const { keptIds } = useInboxKeep.getState();
  // When scoped to a project (focused/scoped view), only clear that project's
  // entries — the button's count and the view already reflect that scope.
  const toRemove = entries
    .filter((e) => !keptIds[e.id] && (!projectId || e.projectId === projectId))
    .map((e) => e.id);
  if (toRemove.length === 0) return 0;

  removeManyLocal(toRemove);
  try {
    await window.cc.inbox.deleteMany(toRemove);
    useUi.getState().pushToast(
      `Cleared ${toRemove.length} ${toRemove.length === 1 ? 'message' : 'messages'}`,
      'info'
    );
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to clear inbox'));
  }
  return toRemove.length;
}

/** Toggle the "Keep" flag on an entry (protects it from Clear inbox). */
export function toggleInboxKeep(entryId: string): void {
  useInboxKeep.getState().toggleKeep(entryId);
}

/**
 * Save an inbox report for later reuse. The caller (InboxDetail) assembles the
 * `SavedRecordInput` — it already holds the resolved project + freshly-read doc
 * snapshots — and this just persists it via IPC, marks the source entry saved
 * (so the UI can show "Saved ✓"), and toasts. Main returns null on failure.
 */
export async function saveInboxEntry(
  input: SavedRecordInput,
  sourceEntryId?: string
): Promise<boolean> {
  try {
    const rec = await window.cc.saved.save(input);
    if (!rec) throw new Error('save returned null');
    if (sourceEntryId) useSavedMark.getState().markSaved(sourceEntryId);
    useUi.getState().pushToast('Saved for later', 'info');
    return true;
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to save report'));
    return false;
  }
}

/** Delete a saved report by id. The onChanged push reconciles the list. */
export async function deleteSavedRecord(id: string): Promise<void> {
  try {
    await window.cc.saved.delete(id);
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to delete saved report'));
  }
}

/**
 * Reply to an inbox entry's originating terminal — the write-back half of the
 * inbox question/answer loop. The agent pushes a question via `inbox_push`
 * (stamped with its sessionId); this sends the user's answer straight to that
 * pty's stdin, so the conversation continues without leaving the inbox.
 *
 * If the session is headless (e.g. a background scheduled run), we DON'T
 * promote it to a visible tab — replying in place is the whole point. The
 * "Open in session" button remains the explicit promotion path. We mark the
 * entry answered (localStorage, mirrors read-state) and toast confirmation.
 *
 * Returns true on success. A dead session (pty already exited) is reported as
 * an error toast and returns false — the caller's UI already shows a tombstone
 * in that case, so this is the belt-and-braces path for a race.
 */
export async function replyToInboxEntry(
  entryId: string,
  sessionId: string,
  text: string
): Promise<boolean> {
  const body = text.trim();
  if (!body) return false;
  try {
    // The pty reply is best-effort but NOT always deliverable: `terminals.reply`
    // resolves false when the target pty already exited (the agent died between
    // the question landing in the inbox and the user answering). Don't claim
    // success or mark the entry answered in that case — surface it so the user
    // reopens the agent (resume/fresh) instead of losing the reply silently.
    const delivered = await window.cc.terminals.reply(sessionId, body);
    if (!delivered) {
      pushErrorToast('Agent is no longer running — reopen it to continue.');
      return false;
    }
    useInboxAnswered.getState().markAnswered(entryId);
    useUi.getState().pushToast('Reply sent', 'info');
    return true;
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to send reply'));
    return false;
  }
}

/** How a follow-up's answer was delivered — drives the caller's toast + navigation. */
export interface FollowUpAnswerResult {
  ok: boolean;
  /** Which tier fired: injected into a live tab, resumed the transcript, or a fresh spawn. */
  tier?: 'inject' | 'resume' | 'spawn';
  /** The live/created session to navigate to (absent for the inject tier when it stays headless). */
  session?: TerminalSession | null;
  /** The follow-up's project (so the caller can navigate without re-looking-up). */
  project?: Project;
}

/**
 * Answer a follow-up — the write-back half of the Follow-ups question loop, the
 * durable twin of {@link replyToInboxEntry} + the inbox three-tier reopen. The
 * agent parked a question via `followup_create` (or it was bridged from idle);
 * this delivers the human's answer to the RIGHT agent, best-to-worst:
 *
 *  1. **inject** — the originating pty is still alive → send the answer to its
 *     stdin (`terminals.reply`), exactly like an inbox reply. No new tab.
 *  2. **resume** — the tab is gone but the origin captured a resumable claude
 *     transcript → spawn `claude --resume <id> <answer>`: the answer lands as the
 *     next turn in the exact conversation that asked, full history intact.
 *  3. **spawn** — no resumable transcript (user-filed / non-claude / legacy) →
 *     spawn a FRESH agent seeded with the question AND the answer so it can act.
 *
 * On success the follow-up is marked resolved with the answer as its resolution
 * (tiers 2/3 also `markSpawned` for the in-progress lock). Returns a result the
 * caller uses to toast + navigate. The originating session id / resume coords are
 * host-stamped on the follow-up (Rule 1) — this never trusts renderer state for
 * the reopen target beyond what main already authorized.
 */
export async function answerFollowUp(
  followUp: FollowUp,
  answer: string
): Promise<FollowUpAnswerResult> {
  const body = answer.trim();
  if (!body) return { ok: false };
  const project = useData.getState().projects.find((p) => p.id === followUp.projectId);
  if (!project) {
    pushErrorToast('Answer failed: this follow-up’s project is no longer registered.');
    return { ok: false };
  }

  const origin = followUp.origin;
  const originSessionId = origin.source !== 'user' ? origin.sessionId : undefined;
  const resume = origin.source !== 'user' ? origin.resume : undefined;

  // Tier 1 — inject into the live originating tab if it's still running (not a
  // tombstoned/exited pty, which would silently drop the write).
  const liveOrigin = originSessionId
    ? (useData.getState().terminals[followUp.projectId] ?? []).find(
        (t) => t.id === originSessionId && t.status !== 'exited'
      )
    : undefined;

  try {
    if (liveOrigin) {
      const delivered = await window.cc.terminals.reply(liveOrigin.id, body);
      if (!delivered) {
        // Raced: the agent died between parking and answering. Fall through to
        // the resume/spawn tiers rather than losing the answer silently.
      } else {
        await markFollowUpAnswered(followUp.id, body);
        useUi.getState().pushToast(`Answer sent to ${liveOrigin.title}`, 'info');
        return { ok: true, tier: 'inject', session: liveOrigin, project };
      }
    }

    // Tier 2 — resume the exact conversation, delivering the answer as its next
    // turn. Only when the origin captured a claude transcript id + a claude-family
    // profile to relaunch on (the resume coords are host-stamped — Rule 1).
    const resumeProfile = knownProfile(resume?.profile) ?? 'claude';
    const canResume = !!resume?.claudeSessionId && isClaudeProfile(resumeProfile);
    if (canResume) {
      const created = await useData.getState().createTerminal(project.id, resumeProfile, 80, 24, {
        // `--resume <id>` as extraArgs + the answer as the positional prompt →
        // `claude --resume <id> <answer>` (persona-store appends prompt last).
        extraArgs: ['--resume', resume!.claudeSessionId!],
        prompt: body,
        personaId: resume?.personaId,
        cwd: resume?.cwd,
        title: `↺ ${followUpAgentTitle(followUp)}`
      });
      if (created) {
        await markFollowUpAnswered(followUp.id, body);
        void window.cc.followups.markSpawned(followUp.id);
        useUi.getState().pushToast('Resumed the agent with your answer', 'info');
        return { ok: true, tier: 'resume', session: created, project };
      }
      // createTerminal already toasted its failure; don't double-report.
      return { ok: false };
    }

    // Tier 3 — fresh agent seeded with the question + the answer so it can act on
    // the decision the human just made.
    const freshProfile =
      knownProfile(resume?.profile) ?? projectDefaultProfile(project);
    const created = await useData.getState().createTerminal(project.id, freshProfile, 80, 24, {
      prompt: buildFollowUpAnswerPrompt(followUp, body),
      personaId: resume?.personaId,
      profileSource: resume?.profile ? undefined : 'seeded-default',
      cwd: resume?.cwd,
      title: `↺ ${followUpAgentTitle(followUp)}`
    });
    if (created) {
      await markFollowUpAnswered(followUp.id, body);
      void window.cc.followups.markSpawned(followUp.id);
      useUi.getState().pushToast('Spawned an agent with your answer', 'info');
      return { ok: true, tier: 'spawn', session: created, project };
    }
    return { ok: false };
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to send answer'));
    return { ok: false };
  }
}

/**
 * Resolve a follow-up recording the human's answer as its resolution — the
 * common tail of every {@link answerFollowUp} tier. Best-effort: the answer was
 * already delivered to the agent, so a failed status write only means the record
 * stays open (it doesn't undo the delivery), and we surface it quietly.
 */
async function markFollowUpAnswered(id: string, answer: string): Promise<void> {
  try {
    const resolution = answer.length > 140 ? `${answer.slice(0, 139)}…` : answer;
    const result = await window.cc.followups.setStatus(id, 'resolved', resolution);
    if (!result.ok) {
      useUi.getState().pushToast(`Answer sent, but marking resolved failed: ${result.message}`, 'error');
    }
  } catch {
    /* delivery already succeeded — a failed resolve is non-fatal */
  }
}
