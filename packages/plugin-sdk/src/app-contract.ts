import type { ComponentType, ReactNode, HTMLAttributes } from 'react';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';

export const PLUGIN_SLOT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export interface PluginSlotBase {
  id: string;
  pluginId: string;
  generation: number;
}

export interface PluginNavPanelProps {
  pluginId: string;
  subPath: string;
}

export const PLUGIN_NAV_PANEL_PLACEMENTS = ['sidebar', 'extensions', 'unlisted'] as const;
export type PluginNavPanelPlacement = (typeof PLUGIN_NAV_PANEL_PLACEMENTS)[number];

/** True when the panel is a global rail row (`sidebar`, or omitted). */
export function navPanelListsInSidebar(placement?: PluginNavPanelPlacement): boolean {
  return placement !== 'extensions' && placement !== 'unlisted';
}

/** True when the panel is listed under Plugins instead of the rail. */
export function navPanelListsInExtensionsHub(placement?: PluginNavPanelPlacement): boolean {
  return placement === 'extensions';
}

export interface PluginNavPanelRegistration extends PluginSlotBase {
  title: string;
  icon: string;
  path?: string;
  /**
   * `sidebar` (default) is a global rail row. `extensions` lists the page
   * under Plugins instead of on the main sidebar. `unlisted` is a full
   * `/plugins/<id>/<path>` page with no rail row and no hub listing — open it
   * from `sidebarFooterAction` / `commandPaletteAction` via `toPluginPanel`.
   */
  placement?: PluginNavPanelPlacement;
  component: ComponentType<PluginNavPanelProps>;
  experimental_sidebarAccessory?: ComponentType;
  headerContent?: ComponentType<PluginNavPanelProps>;
}

export interface PluginSettingsSectionRegistration extends PluginSlotBase {
  title?: string;
  description?: string;
  component: ComponentType<{ pluginId: string }>;
}

export interface PluginHomepageSectionRegistration extends PluginSlotBase {
  title: string;
  component: ComponentType<{ pluginId: string; projectId: string | null }>;
}

export interface PluginProjectTabRegistration extends PluginSlotBase {
  label: string;
  icon?: string;
  order?: number;
  global?: boolean;
  /** Own the toolbar instead of adding a host title row. Render the supplied headerActions in it. */
  header?: 'custom';
  /**
   * Let the user open this tab in its own OS window (desktop only). While it is
   * open there, the tab is not mounted in other windows; they show
   * `detachedPlaceholder`, or a host card when it is omitted.
   */
  detachable?: boolean;
  /** Shown in place of the tab while it is open in its own window. */
  detachedPlaceholder?: ComponentType<PluginDetachedTabProps>;
  component: ComponentType<{ pluginId: string; projectId: string; headerActions?: ReactNode }>;
}

export interface PluginDetachedTabProps {
  pluginId: string;
  projectId: string;
  /** Bring the tab's window to the front. */
  focusWindow(): void;
  /** Close the tab's window and show the tab here again. */
  bringBack(): void;
}

export interface ZccNavigateToProjectOptions {
  /** Open this plugin's `projectTab` with the given slot id. */
  tabId?: string;
}

export interface PluginProjectMenuActionContext {
  projectId: string | null;
  toProject(projectId: string, options?: ZccNavigateToProjectOptions): void;
}

export interface PluginProjectMenuActionRegistration extends PluginSlotBase {
  title: string;
  /** Resolve a project-specific label when its menu opens. Failure retains title. */
  titleForProject?: (projectId: string) => string | Promise<string>;
  icon?: string;
  /** `project` = row overflow; `workspace` = Projects list-header organize menu (legacy name kept) */
  placement: 'project' | 'workspace';
  run: (ctx: PluginProjectMenuActionContext) => void | Promise<void>;
}

export interface PluginCreateProjectActionContext {
  pickDirectory(): Promise<string | null>;
  addProject(path: string): Promise<{ id: string } | null>;
  cloneRoot(): Promise<string | null>;
  toProject(projectId: string, options?: ZccNavigateToProjectOptions): void;
  openDialog(options?: { title?: string; params?: JsonValue }): boolean;
}

export interface PluginCreateProjectDialogProps {
  pluginId: string;
  params: JsonValue | null;
  pickDirectory(): Promise<string | null>;
  addProject(path: string): Promise<{ id: string } | null>;
  cloneRoot(): Promise<string | null>;
  toProject(projectId: string, options?: ZccNavigateToProjectOptions): void;
  close(): void;
}

export interface PluginCreateProjectActionRegistration extends PluginSlotBase {
  title: string;
  icon?: string;
  component?: ComponentType<PluginCreateProjectDialogProps>;
  run: (ctx: PluginCreateProjectActionContext) => void | Promise<void>;
}

export interface PluginSidebarFooterActionContext {
  openSettings(): void;
  /**
   * Navigate to one of this plugin's `navPanel` routes. Returns true when a
   * router consumed the navigation.
   */
  toPluginPanel(path: string, options?: { subPath?: string; replace?: boolean }): boolean;
}

export interface PluginSidebarFooterActionRegistration extends PluginSlotBase {
  title: string;
  icon: string;
  run: (context: PluginSidebarFooterActionContext) => void | Promise<void>;
}

export const PLUGIN_PROJECT_STATUSBAR_ALIGNS = ['left', 'right'] as const;
export type PluginProjectStatusbarAlign = (typeof PLUGIN_PROJECT_STATUSBAR_ALIGNS)[number];

export interface PluginProjectStatusbarMenuItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  run(): void | Promise<void>;
}

export interface PluginProjectStatusbarItemContext {
  projectId: string;
  toProject(projectId: string, options?: ZccNavigateToProjectOptions): boolean;
  toPluginPanel(path?: string, options?: { subPath?: string; replace?: boolean }): boolean;
  openDialog(options?: { title?: string; params?: JsonValue }): boolean;
  openMenu(items: readonly PluginProjectStatusbarMenuItem[]): boolean;
}

export interface PluginProjectStatusbarItemProps extends PluginProjectStatusbarItemContext {
  pluginId: string;
}

export interface PluginProjectStatusbarDialogProps {
  pluginId: string;
  projectId: string;
  params: JsonValue | null;
  close(): void;
  toProject(projectId: string, options?: ZccNavigateToProjectOptions): boolean;
  toPluginPanel(path?: string, options?: { subPath?: string; replace?: boolean }): boolean;
}

export interface PluginProjectStatusbarItemRegistration extends PluginSlotBase {
  /** `left` sits after path/git; `right` (default) sits before terminal meta. */
  align?: PluginProjectStatusbarAlign;
  order?: number;
  tooltip?: string;
  icon?: string;
  /** Host-rendered label. Required unless `item` supplies live chrome. */
  label?: string;
  /** Live chip; when set, the host does not auto-call `run`. */
  item?: ComponentType<PluginProjectStatusbarItemProps>;
  /** Modal body mounted by `openDialog`. */
  component?: ComponentType<PluginProjectStatusbarDialogProps>;
  run?: (ctx: PluginProjectStatusbarItemContext) => void | Promise<void>;
}

export interface PluginPendingInteractionView {
  id: string;
  threadId: string;
  title: string;
  payload: JsonValue;
  createdAt: number;
  expiresAt: number | null;
}

export interface PluginPendingInteractionProps {
  interaction: PluginPendingInteractionView;
  submit(value: JsonValue): Promise<void>;
  cancel(): Promise<void>;
}

/** Host-rendered questions share the native harness question UI and retained drafts. */
export interface PluginInteractionQuestion {
  id: string;
  prompt: string;
  shortLabel?: string;
  multiSelect: boolean;
  allowFreeText: boolean;
  options?: Array<{ value: string; label: string; description?: string }>;
}

export type PluginInteractionAnswers = Record<string, { selected: string[]; freeText?: string }>;

export interface PluginQuestionForm {
  questions: PluginInteractionQuestion[];
  /** Convert the host's answers to this plugin's existing response contract. */
  toResponse(answers: PluginInteractionAnswers): JsonValue;
}

export interface PluginPendingInteractionRegistration extends PluginSlotBase {
  /** Provide exactly one of component or questionForm. */
  component?: ComponentType<PluginPendingInteractionProps>;
  questionForm?: (interaction: PluginPendingInteractionView) => PluginQuestionForm;
}

export const PLUGIN_THREAD_PANEL_SCOPES = ['thread', 'agent-session', 'plugin-page'] as const;
export type PluginThreadPanelScope = (typeof PLUGIN_THREAD_PANEL_SCOPES)[number];
export const DEFAULT_PLUGIN_THREAD_PANEL_SCOPES: readonly PluginThreadPanelScope[] = ['thread'];

/** The plugin page whose side panel lists actions (`'plugin-page'` scope): its owner and page id. */
export interface PluginThreadPanelPage {
  pluginId: string;
  /** The page's `projectTab` or `navPanel` id. */
  page: string;
}

/**
 * Whether a New Tab launcher lists an action. A plugin page's side panel lists
 * only its owner's `'plugin-page'` actions, narrowed by `pages` when set; a
 * `'plugin-page'` check without the page matches nothing.
 */
export function threadPanelActionMatchesScope(
  action: { pluginId?: string; scopes?: readonly PluginThreadPanelScope[]; pages?: readonly string[] },
  scope: PluginThreadPanelScope,
  page?: PluginThreadPanelPage
): boolean {
  const scopes = action.scopes ?? DEFAULT_PLUGIN_THREAD_PANEL_SCOPES;
  if (!scopes.includes(scope)) return false;
  if (scope !== 'plugin-page') return true;
  if (!page || action.pluginId !== page.pluginId) return false;
  return !action.pages || action.pages.includes(page.page);
}

export interface PluginThreadPanelProps {
  pluginId: string;
  /** Owning thread or CLI-agent project, independent of the focused route. */
  projectId?: string;
  /**
   * The thread id, or the CLI-agent session id when this tab was opened from
   * an agent-session side panel (`scopes` includes `"agent-session"`). Empty
   * in a plugin page's side panel, which no conversation owns.
   */
  threadId: string;
  params: JsonValue | null;
  /** Which side panel shows the tab. Absent on hosts before `'plugin-page'`; treat that as `'thread'`. */
  surface?: PluginThreadPanelScope;
  /**
   * The side-panel tab showing the component. It stays the same while the user
   * switches tabs and differs once the tab is closed and opened again, so a
   * component can keep state across switches and start fresh in a new tab.
   * Absent on older hosts.
   */
  tabId?: string;
}

export interface PluginThreadPanelActionContext {
  threadId: string;
  /** Returns true when the host opened this action's side panel. */
  openPanel(options?: { title?: string; params?: JsonValue }): boolean;
}

export interface PluginThreadPanelActionRegistration extends PluginSlotBase {
  title: string;
  /** New Tab category. Defaults to the installed plugin's name. */
  category?: string;
  icon?: string;
  component: ComponentType<PluginThreadPanelProps>;
  layout?: 'padded' | 'flush';
  /**
   * New Tab launchers that list this action. Default `['thread']` — thread
   * workbench only. Include `'agent-session'` to also list it on the CLI-agent
   * inspector side panel, and `'plugin-page'` to list it in the side panel of
   * this plugin's own pages (never another plugin's).
   */
  scopes?: readonly PluginThreadPanelScope[];
  /**
   * With `'plugin-page'`: the `projectTab` / `navPanel` ids whose side panel
   * lists this action. Omit to list it beside every page of this plugin.
   */
  pages?: readonly string[];
  run?(context: PluginThreadPanelActionContext): void | Promise<void>;
}

export interface PluginNewThreadPanelProps {
  pluginId: string;
  projectId: string | null;
  params: JsonValue | null;
}

export interface PluginNewThreadPanelActionContext {
  projectId: string | null;
  /** Returns true when the host opened this action's compose-time panel. */
  openPanel(options?: { title?: string; params?: JsonValue }): boolean;
}

export interface PluginNewThreadPanelActionRegistration extends PluginSlotBase {
  title: string;
  /** New Tab category. Defaults to the installed plugin's name. */
  category?: string;
  icon?: string;
  component: ComponentType<PluginNewThreadPanelProps>;
  layout?: 'padded' | 'flush';
  run?(context: PluginNewThreadPanelActionContext): void | Promise<void>;
}

export interface PluginThreadListProps {
  pluginId: string;
  activeThreadId: string | null;
  activeProjectId: string | null;
  isCompactViewport: boolean;
  onNavigate: () => void;
  searchQuery: string;
  experimental_Original: ComponentType;
}

export interface PluginThreadListRegistration extends PluginSlotBase {
  title: string;
  description?: string;
  component: ComponentType<PluginThreadListProps>;
}

export interface PluginThreadHeaderActionProps {
  pluginId: string;
  threadId: string;
  projectId: string;
  isCompactViewport: boolean;
}

export interface PluginThreadHeaderActionRegistration extends PluginSlotBase {
  title: string;
  component: ComponentType<PluginThreadHeaderActionProps>;
}

export interface PluginFileOpenerSource {
  kind: 'workspace' | 'host' | 'thread-storage';
  threadId: string | null;
  environmentId: string | null;
  projectId: string | null;
  hostId?: string;
}

export interface PluginFileOpenerProps {
  pluginId: string;
  path: string;
  source: PluginFileOpenerSource;
  /** 1-based line to reveal when the host opened this preview with --line / preview_file. */
  lineNumber?: number | null;
  experimental_Original: ComponentType;
}

export interface PluginFileOpenerRegistration extends PluginSlotBase {
  title: string;
  extensions: readonly string[];
  component: ComponentType<PluginFileOpenerProps>;
}

export interface PluginMessageDirectiveMessage {
  id: string;
  threadId: string;
  turnId: string | null;
  projectId: string | null;
}

export interface PluginMessageDirectiveProps {
  pluginId: string;
  attributes: Readonly<Record<string, string>>;
  source: string;
  message: PluginMessageDirectiveMessage;
  openWorkspaceFile: ((path: string) => boolean) | null;
}

export interface PluginMessageDirectiveRegistration extends PluginSlotBase {
  component: ComponentType<PluginMessageDirectiveProps>;
}

export interface ThreadChatMessageReference {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  text: string;
  sourceSeqEnd: number;
}

export interface PluginMessageActionThreadPanelOptions {
  actionId: string;
  title?: string;
  params?: JsonValue;
}

export interface PluginMessageActionContext {
  threadId: string;
  message: ThreadChatMessageReference;
  selectedText?: string;
  openPanel(options: PluginMessageActionThreadPanelOptions): boolean;
}

export interface PluginMessageActionRegistration extends PluginSlotBase {
  title: string;
  icon?: string;
  run: (context: PluginMessageActionContext) => void | Promise<void>;
}

/** Context for a right-click item on an Agents board card. */
export interface PluginAgentCardActionContext {
  sessionId: string;
  projectId: string;
}

export interface PluginAgentCardActionRegistration extends PluginSlotBase {
  title: string;
  icon?: string;
  isAvailable?(context: PluginAgentCardActionContext): boolean;
  run(context: PluginAgentCardActionContext): void | Promise<void>;
}

/** Context for a right-click item on a Modern conversation card. */
export interface PluginThreadCardActionContext {
  threadId: string;
  /** `null` when the thread is not associated with a registered project. */
  projectId: string | null;
}

export interface PluginThreadCardActionRegistration extends PluginSlotBase {
  title: string;
  icon?: string;
  isAvailable?(context: PluginThreadCardActionContext): boolean;
  run(context: PluginThreadCardActionContext): void | Promise<void>;
}

/** Context for a toolbar control on the global or project Agents board. */
export interface PluginAgentsBoardActionContext {
  /** `null` on the cross-project Agents nav. */
  projectId: string | null;
}

export interface PluginAgentsBoardActionRegistration extends PluginSlotBase {
  title: string;
  icon?: string;
  run(context: PluginAgentsBoardActionContext): void | Promise<void>;
}

/** Read-only fleet projection shared with the built-in Agents views. */
export interface PluginFleetMember {
  /** Opaque, kind-qualified key. Pass this to onInspect. */
  key: string;
  kind: 'agent' | 'thread';
  title: string;
  projectId: string;
  status: 'working' | 'needs-you' | 'idle' | 'done' | 'error' | 'unknown';
  /** Done means the process exited, not that its task succeeded. */
  detail: string;
  live: boolean;
  scheduled: boolean;
  /** Display name of the session's harness, shared across thread and CLI surfaces. */
  harness?: string;
  teamId?: string;
}
export interface PluginFleetSchedule {
  key: string;
  title: string;
  projectId: string;
  enabled: boolean;
  nextRunAt: string | null;
  running: boolean;
  /** Configured launch harness; a plan is not a live session. */
  harness?: string;
}
export interface PluginFleetExecution {
  key: string;
  projectId: string;
  title: string;
  state: string;
  needsAttention: boolean;
}
export interface PluginAgentsViewProps {
  projectId: string | null;
  projects: readonly { id: string; name: string; color?: string }[];
  members: readonly PluginFleetMember[];
  schedules: readonly PluginFleetSchedule[];
  executions: readonly PluginFleetExecution[];
  /** Full scoped population, before search. Use for stable spatial layouts; older hosts omit it. */
  population?: {
    members: readonly PluginFleetMember[];
    schedules: readonly PluginFleetSchedule[];
    executions: readonly PluginFleetExecution[];
  };
  includeScheduled: boolean;
  searchQuery: string;
  /** Host resolves only keys in the current scoped population, including search-hidden items. */
  onInspect(key: string): void;
}
export interface PluginAgentsViewRegistration extends PluginSlotBase {
  title: string;
  icon?: string;
  component: ComponentType<PluginAgentsViewProps>;
}

export type PluginTimelineRowStatus = 'pending' | 'completed' | 'error' | 'interrupted';

export interface PluginTimelineRendererRow {
  id: string;
  threadId: string;
  turnId: string | null;
  kind: string;
  toolName: string | null;
  status: PluginTimelineRowStatus;
  startedAt: number;
  completedAt: number | null;
}

export interface PluginTimelineRendererProps {
  row: PluginTimelineRendererRow;
  payload: JsonValue;
  presentation: { label: { pending: string; completed: string }; title?: string; detail?: string } | null;
  thread: { id: string; providerId: string | null };
  Original: ComponentType<Record<never, never>>;
}

export interface PluginTimelineRendererRegistration extends PluginSlotBase {
  kind: string;
  component: ComponentType<PluginTimelineRendererProps>;
}

/** Context handed to a `commandPaletteAction`'s `isAvailable` and `run`. */
export interface PluginCommandPaletteActionContext {
  threadId: string | null;
  projectId: string | null;
  /**
   * Open one of this plugin's `threadPanelAction` components in the current
   * thread's side panel. Returns true when the host accepted the open.
   */
  openPanel(options: PluginMessageActionThreadPanelOptions): boolean;
  /**
   * Navigate to one of this plugin's `navPanel` routes. Returns true when a
   * router consumed the navigation.
   */
  toPluginPanel(path: string, options?: { subPath?: string; replace?: boolean }): boolean;
  /**
   * Focus a ZCC project and, when `tabId` is set, open that plugin project tab.
   * Returns true when a router consumed the navigation.
   */
  toProject(projectId: string, options?: ZccNavigateToProjectOptions): boolean;
}

/**
 * A row in the host command palette (⌘P), listed under Extensions beside
 * core commands. The plugin supplies a title and `run`; the host owns matching.
 */
export interface PluginCommandPaletteActionRegistration extends PluginSlotBase {
  title: string;
  isAvailable?(context: PluginCommandPaletteActionContext): boolean;
  run(context: PluginCommandPaletteActionContext): void | Promise<void>;
}

export interface PluginProviderIconRegistration {
  pluginId: string;
  generation: number;
  providerId: string;
  icon: ComponentType<{ className?: string }>;
}

export const PLUGIN_COMPOSER_SCOPE_KINDS = [
  'thread',
  'queued-message',
  'side-chat',
  'new-thread',
  'cli-agent'
] as const;

export type PluginComposerScopeKind = (typeof PLUGIN_COMPOSER_SCOPE_KINDS)[number];

export type PluginComposerScope =
  | { kind: 'thread'; threadId: string }
  | { kind: 'queued-message'; threadId: string; queuedMessageId: string }
  | {
      kind: 'side-chat';
      projectId: string;
      parentThreadId: string;
      tabId: string;
      childThreadId: string | null;
    }
  | { kind: 'new-thread'; projectId: string | null }
  | { kind: 'cli-agent'; projectId: string | null };

export interface ComposerView {
  scope: PluginComposerScope;
  layout: 'expanded' | 'compact' | 'zen';
  draft: { text: string; isEmpty: boolean; attachmentCount: number };
  run: { isRunning: boolean; isSubmitting: boolean };
  /** Selected CLI harness family (`claude`, `codex`, …) when the composer is CLI Agent. */
  familyId?: string;
  /** Selected thread/CLI provider id (`claude-code`, `codex`, …). */
  providerId?: string;
}

/**
 * Advisory spawn overlay a composer customization may attach. The host merges
 * patches at send time; main still authorizes cwd/profile and sanitizes args.
 */
export interface PluginComposerLaunchPatch {
  extraArgs?: string[];
  profileId?: string;
  harnessRouting?: {
    schemaVersion: 1;
    byAdapter: Record<
      string,
      {
        roleTargetId?: string;
        modelTargetId?: string;
        executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
      }
    >;
  };
}

export interface ComposerPlusMenuItem {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  disabled?: boolean | ((view: ComposerView) => boolean);
  run(context: { composer: PluginComposerApi; view: ComposerView }): void | Promise<void>;
}

export interface ComposerStructuredDraft {
  text: string;
  mentions: readonly { from: number; to: number; provider: string; id: string; label: string }[];
}

export interface ComposerRichTextSpec {
  effects?: readonly {
    id: string;
    match(text: string): readonly { from: number; to: number }[];
    className: string;
  }[];
  onDraftChange?(draft: ComposerStructuredDraft, view: ComposerView): void;
}

export interface ComposerCustomization {
  id: string;
  pluginId: string;
  generation: number;
  scopes?: readonly PluginComposerScopeKind[];
  actions?: readonly { id: string; component: ComponentType }[];
  banners?: readonly { id: string; chrome?: 'card' | 'bare'; component: ComponentType }[];
  plusMenu?: readonly ComposerPlusMenuItem[];
  richText?: ComposerRichTextSpec;
  /** Chips in the composer meta row (project / environment / permission). */
  meta?: readonly { id: string; component: ComponentType }[];
  /** Fields inside the host-owned Customize launch disclosure. */
  advanced?: readonly { id: string; component: ComponentType }[];
}

export interface PluginComposerTextEffect {
  className: string;
}

export interface PluginComposerMention {
  provider: string;
  id: string;
  label: string;
}

export interface PluginComposerApi {
  scope: PluginComposerScope;
  readonly text: string;
  setText(next: string): void;
  updateText(updater: (current: string) => string): void;
  clear(): void;
  setTextEffect(effect: PluginComposerTextEffect | null): void;
  setInputLock(locked: boolean): void;
  addQuote(text: string): void;
  insertMention(mention: PluginComposerMention): void;
  focus(): void;
  /**
   * Overlay spawn options for this plugin. Pass `null` to clear. The host
   * merges every plugin's patch at send; main still authorizes.
   */
  experimental_setLaunchPatch(patch: PluginComposerLaunchPatch | null): void;
  /** Restore prompt metadata; main validates attachment provenance on send. */
  experimental_replacePrompt?(input: readonly import('@zana-ai/zcc-domain/thread-runtime').PromptInput[], sourceThreadId?: string): void;
}

export interface PluginComposerThreadRowStatus {
  icon: string;
  label: string;
  tone?: 'default' | 'running' | 'success' | 'error';
}

export interface PluginContentScriptContext {
  readonly pluginId: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly experimental_setThreadRowStatus?: (
    threadId: string,
    status: PluginComposerThreadRowStatus | null
  ) => void;
}

export type PluginContentScriptDisposer = () => void | Promise<void>;

export interface PluginContentScriptRegistration extends PluginSlotBase {
  mount(
    context: PluginContentScriptContext
  ): void | PluginContentScriptDisposer | Promise<void | PluginContentScriptDisposer>;
}

export interface PluginAppComposer {
  customize(registration: Omit<ComposerCustomization, 'pluginId' | 'generation'>): void;
}

export interface PluginAppContentScripts {
  register(
    registration: Omit<PluginContentScriptRegistration, 'pluginId' | 'generation'>
  ): void;
}

export interface PluginAppSlots {
  navPanel(registration: Omit<PluginNavPanelRegistration, 'generation' | 'pluginId'>): void;
  settingsSection(registration: Omit<PluginSettingsSectionRegistration, 'generation' | 'pluginId'>): void;
  homepageSection(registration: Omit<PluginHomepageSectionRegistration, 'generation' | 'pluginId'>): void;
  projectTab(registration: Omit<PluginProjectTabRegistration, 'generation' | 'pluginId'>): void;
  experimental_projectMenuAction(
    registration: Omit<PluginProjectMenuActionRegistration, 'generation' | 'pluginId'>
  ): void;
  experimental_createProjectAction(
    registration: Omit<PluginCreateProjectActionRegistration, 'generation' | 'pluginId'>
  ): void;
  sidebarFooterAction(registration: Omit<PluginSidebarFooterActionRegistration, 'generation' | 'pluginId'>): void;
  projectStatusbarItem(
    registration: Omit<PluginProjectStatusbarItemRegistration, 'generation' | 'pluginId'>
  ): void;
  pendingInteraction(registration: Omit<PluginPendingInteractionRegistration, 'generation' | 'pluginId'>): void;
  threadPanelAction(registration: Omit<PluginThreadPanelActionRegistration, 'generation' | 'pluginId'>): void;
  experimental_newThreadPanelAction(
    registration: Omit<PluginNewThreadPanelActionRegistration, 'generation' | 'pluginId'>
  ): void;
  experimental_threadList(registration: Omit<PluginThreadListRegistration, 'generation' | 'pluginId'>): void;
  experimental_threadHeaderAction(
    registration: Omit<PluginThreadHeaderActionRegistration, 'generation' | 'pluginId'>
  ): void;
  fileOpener(registration: Omit<PluginFileOpenerRegistration, 'generation' | 'pluginId'>): void;
  messageDirective(registration: Omit<PluginMessageDirectiveRegistration, 'generation' | 'pluginId'>): void;
  messageAction(registration: Omit<PluginMessageActionRegistration, 'generation' | 'pluginId'>): void;
  experimental_agentCardAction(
    registration: Omit<PluginAgentCardActionRegistration, 'generation' | 'pluginId'>
  ): void;
  experimental_agentsView(registration: Omit<PluginAgentsViewRegistration, 'generation' | 'pluginId'>): void;
  experimental_threadCardAction(
    registration: Omit<PluginThreadCardActionRegistration, 'generation' | 'pluginId'>
  ): void;
  experimental_agentsBoardAction(
    registration: Omit<PluginAgentsBoardActionRegistration, 'generation' | 'pluginId'>
  ): void;
  experimental_timelineRenderer(
    registration: Omit<PluginTimelineRendererRegistration, 'generation' | 'pluginId' | 'id'>
  ): void;
  commandPaletteAction(
    registration: Omit<PluginCommandPaletteActionRegistration, 'generation' | 'pluginId'>
  ): void;
  experimental_providerIcon(registration: Omit<PluginProviderIconRegistration, 'generation' | 'pluginId'>): void;
}

export interface PluginAppBuilder {
  slots: PluginAppSlots;
  composer: PluginAppComposer;
  contentScripts: PluginAppContentScripts;
}

export type PluginAppSetup = (app: PluginAppBuilder) => void;

export interface PluginAppDefinition {
  readonly __zccPluginApp: true;
  readonly setup: PluginAppSetup;
}

export interface PluginRegistrationSet {
  pluginId: string;
  generation: number;
  navPanels: PluginNavPanelRegistration[];
  settingsSections: PluginSettingsSectionRegistration[];
  homepageSections: PluginHomepageSectionRegistration[];
  projectTabs: PluginProjectTabRegistration[];
  projectMenuActions: PluginProjectMenuActionRegistration[];
  createProjectActions: PluginCreateProjectActionRegistration[];
  sidebarFooterActions: PluginSidebarFooterActionRegistration[];
  projectStatusbarItems: PluginProjectStatusbarItemRegistration[];
  pendingInteractions: PluginPendingInteractionRegistration[];
  threadPanelActions: PluginThreadPanelActionRegistration[];
  newThreadPanelActions: PluginNewThreadPanelActionRegistration[];
  threadLists: PluginThreadListRegistration[];
  threadHeaderActions: PluginThreadHeaderActionRegistration[];
  fileOpeners: PluginFileOpenerRegistration[];
  messageDirectives: PluginMessageDirectiveRegistration[];
  messageActions: PluginMessageActionRegistration[];
  agentCardActions: PluginAgentCardActionRegistration[];
  threadCardActions: PluginThreadCardActionRegistration[];
  agentsBoardActions: PluginAgentsBoardActionRegistration[];
  agentsViews: PluginAgentsViewRegistration[];
  timelineRenderers: PluginTimelineRendererRegistration[];
  commandPaletteActions: PluginCommandPaletteActionRegistration[];
  providerIcons: PluginProviderIconRegistration[];
  composerCustomizations: ComposerCustomization[];
  contentScripts: PluginContentScriptRegistration[];
}

export interface PluginSettingsState {
  values: Record<string, string | number | boolean> | undefined;
  isLoading: boolean;
}

export type PluginRealtimeConnectionState = 'connecting' | 'connected' | 'reconnecting';

/**
 * Where plugin UI renders: the main window, a per-project window, or a
 * detachable project tab open in its own window (`plugin-view`).
 */
export type ZccSurface = 'main' | 'project-window' | 'plugin-view';

export interface ZccContext {
  projectId: string | null;
  threadId: string | null;
  /** Absent on hosts that predate detachable tabs. */
  surface?: ZccSurface;
  /**
   * True when this page sits beside a host side panel, so `openPanelAgent`
   * and `openPanelTool` can show tabs there. Absent or false elsewhere
   * (thread-panel tabs, older hosts). Nav pages, project tabs and detached
   * plugin windows share the host's rail and tabbed panel, including web hosts.
   */
  sidePanel?: boolean;
  /**
   * With `sidePanel`, whether that panel is showing right now, whatever tab it
   * shows. Absent on hosts that predate it.
   */
  sidePanelOpen?: boolean;
}

/** How much a window badge should stand out: `danger` for work that could hurt, `warning` for the unknown. */
export type ZccWindowTitleTone = 'neutral' | 'warning' | 'danger';

/**
 * What a plugin's own window shows in its title strip and OS title (see `useWindowTitle`).
 * The host trims each part and caps `title` at 120, `detail` at 80 and `badge` at 24 characters.
 */
export interface ZccWindowTitle {
  /** Replaces the tab label, e.g. "Agentforce · Help". */
  title: string;
  /** Follows the project name, e.g. the account or environment in use. */
  detail?: string;
  /** A short risk marker shown as a pill and leading the OS title, e.g. "Production". */
  badge?: string;
  /** Defaults to `neutral`. */
  tone?: ZccWindowTitleTone;
}

export interface ZccNavigate {
  toThread(threadId: string): void;
  toProject(projectId: string, options?: ZccNavigateToProjectOptions): void;
  toPluginPanel(path: string, options?: { subPath?: string; replace?: boolean }): void;
  toCompose(options?: { initialPrompt?: string; focusPrompt?: boolean }): void;
  /**
   * Open one of this plugin's thread-panel actions beside the conversation.
   * `threadId` hints which conversation owns the panel when the URL does not.
   * The host prefers the visible side panel over this hint.
   */
  openThreadPanel(options: {
    actionId: string;
    title?: string;
    params?: JsonValue;
    threadId?: string;
  }): boolean;
  /**
   * Show a conversation in the agent tab of this plugin page's side panel,
   * focusing its tab when one is already open. With `draft`, open the panel's
   * composer prefilled with `draft.prompt` instead: the user picks the harness
   * and model and sends it, and the thread is bound to this page like any
   * panel conversation. False when the page has no side panel (nested thread
   * tools or older hosts; hosts before drafts also return false for a
   * draft); fall back to `openThreadPanel`, `toThread` or `toCompose`.
   */
  openPanelAgent(options: ZccPanelAgentOptions): boolean;
  /**
   * Open one of this plugin's `threadPanelAction` tabs in this page's side
   * panel; the action must list `'plugin-page'` in `scopes` (and this page in
   * `pages`, when set). An open tab for the same action is focused and given
   * the new `params` instead of duplicated. False when the page has no side
   * panel (`useZccContext().sidePanel` is not true) or the action does not
   * match. Absent on older hosts.
   */
  openPanelTool?(options: ZccPanelToolOptions): boolean;
  /**
   * Open one of this plugin's `detachable` project tabs in its own window, or
   * focus that window when it is already open. Resolves `false` outside the
   * desktop app or when the tab is not detachable. Absent on older hosts.
   */
  openInWindow?(projectId: string, options?: ZccNavigateToProjectOptions): Promise<boolean>;
}

/** Why a pasted deep link was not routed. `unavailable` outside the desktop app and on older hosts. */
export type ZccDeepLinkRejectReason =
  | 'unavailable'
  | 'not-a-string'
  | 'too-long'
  | 'control-characters'
  | 'malformed'
  | 'wrong-scheme'
  | 'bad-plugin-id'
  | 'bad-route'
  | 'bad-query'
  | 'bad-encoding'
  | 'payload-too-long';

export type ZccDeepLinkOpenResult =
  | { ok: true; pluginId: string; route: string }
  | { ok: false; reason: ZccDeepLinkRejectReason };

/**
 * Links of the form `<base>plugin/<pluginId>/<route>?d=<payload>`. A link never
 * performs an action: the host routes `(route, payload)` to the plugin's handler
 * and the plugin must show its own confirmation before acting. `payload` is an
 * opaque, untrusted string (at most 4096 characters, no whitespace or control
 * characters); treat it like any user-pasted input.
 */
export interface ZccDeepLinks {
  /**
   * The link prefix for this build: `zana://` when packaged, `zana-dev://` in
   * `pnpm run dev`, null where links are not supported (E2E, web, older hosts).
   * Build a link as `${base}plugin/${pluginId}/${route}?d=${encodeURIComponent(payload)}`.
   */
  base(): string | null;
  /**
   * Receive links for `route` (lowercase `[a-z0-9-]` segments joined by `/`,
   * without leading or trailing slash). Links that arrived before a handler for
   * the route was registered (for example the plugin view was not mounted yet)
   * are queued by the host for a short time and delivered on registration, in
   * order. Returns an unsubscribe function; call it on unmount.
   */
  on(route: string, handler: (payload: string | null) => void): () => void;
  /**
   * Validate and route a pasted link (any known scheme, for example from an
   * "Open link" field). The host re-validates; the link may name any plugin.
   */
  open(rawLink: string): Promise<ZccDeepLinkOpenResult>;
}

/** A `'plugin-page'` thread-panel action to show in the page's side panel. */
export interface ZccPanelToolOptions {
  actionId: string;
  /** Tab label. Defaults to the action's title. */
  title?: string;
  params?: JsonValue;
}

/** A conversation to show, or a draft to prefill the side panel's composer with. */
export type ZccPanelAgentOptions =
  | { threadId: string; title?: string }
  | {
      /**
       * `projectId` preselects the composer's project; the user can still change it.
       * `view` is what the conversation is about, in the page's route form (e.g. a
       * doc id); it is recorded as the agent's starting view in place of the page's
       * current route, so a page without routes (a project tab) can still name it.
       */
      draft: { prompt: string; projectId?: string; view?: string };
      title?: string;
    };

export interface ThreadChatMessageAction {
  id: string;
  title: string;
  icon?: string;
  roles?: readonly ('user' | 'assistant')[];
  run(message: ThreadChatMessageReference): void | Promise<void>;
}

export interface ThreadChatProps {
  threadId: string;
  variant?: 'full' | 'compact' | 'timeline';
  layout?: 'contained' | 'document';
  focusRequest?: number;
  permissionPolicy?: 'inherit' | 'editable';
  className?: string;
  leadingContent?: ReactNode;
  messageActions?: readonly ThreadChatMessageAction[];
  includePluginMessageActions?: boolean;
}

export interface MarkdownProps {
  content: string;
  className?: string;
}

export interface NewThreadComposerProps {
  defaultProjectId?: string;
  defaultProviderId?: string;
  defaultModel?: string;
  initialPrompt?: string;
  placeholder?: string;
  layout?: 'contained' | 'document';
  focusRequest?: number;
  className?: string;
  draftKey?: string;
  onSubmit: (request: { projectId: string; providerId: string; input: unknown[] }) => void | Promise<void>;
}

export interface PluginRpcClient {
  call(method: string, args?: unknown): Promise<unknown>;
}

export interface PluginSidebarThread {
  id: string;
  projectId: string;
  title: string | null;
  providerId: string;
  status: string;
  createdAt: number;
  updatedAt?: number;
  pinnedAt?: number | null;
  pinOrder?: number | null;
  hasPendingInteraction?: boolean;
  lastReadSeq?: number | null;
  maxSeq?: number;
  branchName?: string | null;
}

export interface PluginSidebarThreadActions {
  open(threadId: string): void;
  openNewThread(options?: { projectId?: string }): void;
  setPinned(threadId: string, pinned: boolean): Promise<void>;
  setRead(threadId: string, read: boolean): Promise<void>;
  rename(threadId: string, title: string): Promise<void>;
  archive(threadId: string): Promise<void>;
  stop(threadId: string): Promise<void>;
  closeFollowup(threadId: string): Promise<void>;
}

export interface PluginSdkApp {
  definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
  useRpc(): PluginRpcClient;
  useRealtime(channel: string, handler: (payload: unknown) => void): void;
  useRealtimeConnectionState(): PluginRealtimeConnectionState;
  useSettings(): PluginSettingsState;
  useZccContext(): ZccContext;
  useZccNavigate(): ZccNavigate;
  /** Deep links for the calling plugin. Absent on hosts that predate them. */
  useZccDeepLinks?(): ZccDeepLinks;
  useWindowTitle(title: ZccWindowTitle | null | undefined): void;
  useComposer(): PluginComposerApi;
  useComposerView(): ComposerView;
  experimental_useSidebarThreads(): { status: 'loading' | 'ready' | 'error'; threads: PluginSidebarThread[]; projects: { id: string; name: string }[] };
  experimental_useSidebarThreadActions(): PluginSidebarThreadActions;
  experimental_useSidebarThreadPullRequest(threadId: string): {
    isLoading: boolean;
    pullRequest: unknown | null;
  };
  experimental_useSidebarThreadSplit(threadId: string): {
    isAvailable: boolean;
    splitProps: HTMLAttributes<HTMLElement>;
    layout: null;
    openInSplit?: () => void;
    consumeClick?: () => boolean;
  };
  ThreadChat: ComponentType<ThreadChatProps>;
  Markdown: ComponentType<MarkdownProps>;
  experimental_NewThreadComposer: ComponentType<NewThreadComposerProps>;
  /** Host-only toast helper; not a public SDK export. */
  toast?(message: string, kind?: 'info' | 'error'): void;
}

export function emptyRegistrationSet(pluginId: string, generation: number): PluginRegistrationSet {
  return {
    pluginId,
    generation,
    navPanels: [],
    settingsSections: [],
    homepageSections: [],
    projectTabs: [],
    projectMenuActions: [],
    createProjectActions: [],
    sidebarFooterActions: [],
    projectStatusbarItems: [],
    pendingInteractions: [],
    threadPanelActions: [],
    newThreadPanelActions: [],
    threadLists: [],
    threadHeaderActions: [],
    fileOpeners: [],
    messageDirectives: [],
    messageActions: [],
    agentCardActions: [],
    threadCardActions: [],
    agentsBoardActions: [],
    agentsViews: [],
    timelineRenderers: [],
    commandPaletteActions: [],
    providerIcons: [],
    composerCustomizations: [],
    contentScripts: []
  };
}

function requireSlotId(kind: string, value: unknown): string {
  if (typeof value !== 'string' || !PLUGIN_SLOT_ID_PATTERN.test(value)) {
    throw new Error(`${kind}: "id" must match ${String(PLUGIN_SLOT_ID_PATTERN)}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireUniqueId(kind: string, seen: Set<string>, id: string): void {
  if (seen.has(id)) throw new Error(`${kind}: duplicate id ${JSON.stringify(id)}`);
  seen.add(id);
}

function requireNonEmptyString(kind: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${kind}: "${field}" must be a non-empty string`);
  }
  return value;
}

function requireOptionalString(kind: string, field: string, value: unknown): string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${kind}: "${field}" must be a string when set`);
  }
  return value;
}

function requireComponent<T>(kind: string, field: string, value: unknown): T {
  if (typeof value !== 'function') {
    throw new Error(`${kind}: "${field}" must be a React component function`);
  }
  return value as T;
}

function requireLayout(kind: string, value: unknown): 'padded' | 'flush' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'padded' && value !== 'flush') {
    throw new Error(`${kind}: "layout" must be "padded" or "flush"`);
  }
  return value;
}

function requireThreadPanelPages(
  kind: string,
  value: unknown,
  scopes: readonly PluginThreadPanelScope[] | undefined
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!scopes?.includes('plugin-page')) {
    throw new Error(`${kind}: "pages" needs "plugin-page" in "scopes"`);
  }
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${kind}: "pages" must be a non-empty array of page ids`);
  }
  return [...new Set(value.map((item: string) => item.trim()))];
}

function requireThreadPanelScopes(
  kind: string,
  value: unknown
): readonly PluginThreadPanelScope[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${kind}: "scopes" must be a non-empty array of "thread" | "agent-session" | "plugin-page"`);
  }
  const allowed = new Set<string>(PLUGIN_THREAD_PANEL_SCOPES);
  const out: PluginThreadPanelScope[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      throw new Error(`${kind}: "scopes" must be a non-empty array of "thread" | "agent-session" | "plugin-page"`);
    }
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item as PluginThreadPanelScope);
  }
  return out;
}

export function collectPluginApp(
  pluginId: string,
  generation: number,
  definition: PluginAppDefinition
): PluginRegistrationSet {
  const set = emptyRegistrationSet(pluginId, generation);
  const stamp = <T extends object>(row: T): T & { generation: number; pluginId: string } => ({
    ...row,
    generation,
    pluginId
  });
  const seen = {
    homepageSection: new Set<string>(),
    settingsSection: new Set<string>(),
    navPanel: new Set<string>(),
    projectTab: new Set<string>(),
    projectMenuAction: new Set<string>(),
    createProjectAction: new Set<string>(),
    threadPanelAction: new Set<string>(),
    newThreadPanelAction: new Set<string>(),
    composerCustomization: new Set<string>(),
    pendingInteraction: new Set<string>(),
    sidebarFooterAction: new Set<string>(),
    projectStatusbarItem: new Set<string>(),
    threadList: new Set<string>(),
    threadHeaderAction: new Set<string>(),
    fileOpener: new Set<string>(),
    messageDirective: new Set<string>(),
    messageAction: new Set<string>(),
    agentCardAction: new Set<string>(),
    threadCardAction: new Set<string>(),
    agentsBoardAction: new Set<string>(),
    agentsView: new Set<string>(),
    timelineRenderer: new Set<string>(),
    commandPaletteAction: new Set<string>(),
    providerIcon: new Set<string>(),
    contentScript: new Set<string>()
  };

  definition.setup({
    slots: {
      homepageSection: (registration) => {
        const kind = 'slots.homepageSection';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.homepageSection, id);
        set.homepageSections.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            component: requireComponent(kind, 'component', registration.component)
          })
        );
      },
      settingsSection: (registration) => {
        const kind = 'slots.settingsSection';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.settingsSection, id);
        const title = requireOptionalString(kind, 'title', registration.title);
        const description = requireOptionalString(kind, 'description', registration.description);
        set.settingsSections.push(
          stamp({
            id,
            ...(title !== undefined ? { title } : {}),
            ...(description !== undefined ? { description } : {}),
            component: requireComponent(kind, 'component', registration.component)
          })
        );
      },
      navPanel: (registration) => {
        const kind = 'slots.navPanel';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.navPanel, id);
        const path = registration.path ?? id;
        if (!PLUGIN_SLOT_ID_PATTERN.test(path)) {
          throw new Error(
            `${kind}: "path" must match ${String(PLUGIN_SLOT_ID_PATTERN)} (it becomes a URL segment), got ${JSON.stringify(path)}`
          );
        }
        if (registration.headerContent !== undefined && typeof registration.headerContent !== 'function') {
          throw new Error(`${kind}: "headerContent" must be a React component function when set`);
        }
        if (
          registration.experimental_sidebarAccessory !== undefined &&
          typeof registration.experimental_sidebarAccessory !== 'function'
        ) {
          throw new Error(`${kind}: "experimental_sidebarAccessory" must be a React component function when set`);
        }
        if (
          registration.placement !== undefined &&
          !PLUGIN_NAV_PANEL_PLACEMENTS.includes(registration.placement)
        ) {
          throw new Error(`${kind}: "placement" must be "sidebar", "extensions", or "unlisted"`);
        }
        set.navPanels.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            icon: requireNonEmptyString(kind, 'icon', registration.icon),
            path,
            ...(registration.placement ? { placement: registration.placement } : {}),
            component: requireComponent(kind, 'component', registration.component),
            ...(registration.experimental_sidebarAccessory
              ? { experimental_sidebarAccessory: registration.experimental_sidebarAccessory }
              : {}),
            ...(registration.headerContent ? { headerContent: registration.headerContent } : {})
          })
        );
      },
      projectTab: (registration) => {
        const kind = 'slots.projectTab';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.projectTab, id);
        set.projectTabs.push(stamp(registration));
      },
      experimental_projectMenuAction: (registration) => {
        const kind = 'slots.experimental_projectMenuAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.projectMenuAction, id);
        if (registration.placement !== 'project' && registration.placement !== 'workspace') {
          throw new Error(`${kind}: "placement" must be "project" or "workspace"`);
        }
        if (typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function`);
        }
        if (registration.titleForProject !== undefined && typeof registration.titleForProject !== 'function') {
          throw new Error(`${kind}: "titleForProject" must be a function`);
        }
        set.projectMenuActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.titleForProject ? { titleForProject: registration.titleForProject } : {}),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            placement: registration.placement,
            run: registration.run
          })
        );
      },
      experimental_createProjectAction: (registration) => {
        const kind = 'slots.experimental_createProjectAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.createProjectAction, id);
        if (typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function`);
        }
        if (registration.component !== undefined) {
          requireComponent(kind, 'component', registration.component);
        }
        set.createProjectActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            ...(registration.component !== undefined ? { component: registration.component } : {}),
            run: registration.run
          })
        );
      },
      sidebarFooterAction: (registration) => {
        const kind = 'slots.sidebarFooterAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.sidebarFooterAction, id);
        if (typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function`);
        }
        set.sidebarFooterActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            icon: requireNonEmptyString(kind, 'icon', registration.icon),
            run: registration.run
          })
        );
      },
      projectStatusbarItem: (registration) => {
        const kind = 'slots.projectStatusbarItem';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.projectStatusbarItem, id);
        const align = registration.align ?? 'right';
        if (align !== 'left' && align !== 'right') {
          throw new Error(`${kind}: "align" must be "left" or "right"`);
        }
        if (registration.item !== undefined) {
          requireComponent(kind, 'item', registration.item);
        }
        if (registration.component !== undefined) {
          requireComponent(kind, 'component', registration.component);
        }
        if (registration.run !== undefined && typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function when set`);
        }
        const label = requireOptionalString(kind, 'label', registration.label);
        if (!registration.item && (label === undefined || label.length === 0)) {
          throw new Error(`${kind}: "label" is required unless "item" is set`);
        }
        if (
          registration.order !== undefined &&
          (typeof registration.order !== 'number' || !Number.isFinite(registration.order))
        ) {
          throw new Error(`${kind}: "order" must be a finite number when set`);
        }
        const tooltip = requireOptionalString(kind, 'tooltip', registration.tooltip);
        set.projectStatusbarItems.push(
          stamp({
            id,
            align,
            ...(registration.order !== undefined ? { order: registration.order } : {}),
            ...(tooltip !== undefined ? { tooltip } : {}),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            ...(label !== undefined && label.length > 0 ? { label } : {}),
            ...(registration.item !== undefined ? { item: registration.item } : {}),
            ...(registration.component !== undefined ? { component: registration.component } : {}),
            ...(registration.run !== undefined ? { run: registration.run } : {})
          })
        );
      },
      pendingInteraction: (registration) => {
        const kind = 'slots.pendingInteraction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.pendingInteraction, id);
        if (registration.questionForm !== undefined) {
          if (registration.component !== undefined || typeof registration.questionForm !== 'function') {
            throw new Error(`${kind}: provide either a component or a questionForm function`);
          }
          set.pendingInteractions.push(stamp({ id, questionForm: registration.questionForm }));
        } else {
          set.pendingInteractions.push(stamp({ id, component: requireComponent(kind, 'component', registration.component) }));
        }
      },
      threadPanelAction: (registration) => {
        const kind = 'slots.threadPanelAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.threadPanelAction, id);
        if (registration.run !== undefined && typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function when set`);
        }
        const scopes = requireThreadPanelScopes(kind, registration.scopes);
        const pages = requireThreadPanelPages(kind, registration.pages, scopes);
        const category = requireOptionalString(kind, 'category', registration.category)?.trim();
        set.threadPanelActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(category ? { category } : {}),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            component: requireComponent(kind, 'component', registration.component),
            ...(requireLayout(kind, registration.layout)
              ? { layout: registration.layout }
              : {}),
            ...(scopes !== undefined ? { scopes } : {}),
            ...(pages !== undefined ? { pages } : {}),
            ...(registration.run !== undefined ? { run: registration.run } : {})
          })
        );
      },
      experimental_newThreadPanelAction: (registration) => {
        const kind = 'slots.experimental_newThreadPanelAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.newThreadPanelAction, id);
        if (registration.run !== undefined && typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function when set`);
        }
        const category = requireOptionalString(kind, 'category', registration.category)?.trim();
        set.newThreadPanelActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(category ? { category } : {}),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            component: requireComponent(kind, 'component', registration.component),
            ...(requireLayout(kind, registration.layout)
              ? { layout: registration.layout }
              : {}),
            ...(registration.run !== undefined ? { run: registration.run } : {})
          })
        );
      },
      experimental_agentsView: (registration) => {
        const kind = 'slots.experimental_agentsView';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.agentsView, id);
        set.agentsViews.push(stamp({
          id,
          title: requireNonEmptyString(kind, 'title', registration.title),
          ...(registration.icon !== undefined ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) } : {}),
          component: requireComponent(kind, 'component', registration.component)
        }));
      },
      experimental_threadList: (registration) => {
        const kind = 'slots.experimental_threadList';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.threadList, id);
        const description = requireOptionalString(kind, 'description', registration.description);
        set.threadLists.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(description !== undefined ? { description } : {}),
            component: requireComponent(kind, 'component', registration.component)
          })
        );
      },
      experimental_threadHeaderAction: (registration) => {
        const kind = 'slots.experimental_threadHeaderAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.threadHeaderAction, id);
        set.threadHeaderActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            component: requireComponent(kind, 'component', registration.component)
          })
        );
      },
      fileOpener: (registration) => {
        const kind = 'slots.fileOpener';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.fileOpener, id);
        const rawExtensions = registration.extensions;
        if (!Array.isArray(rawExtensions) || rawExtensions.length === 0) {
          throw new Error(
            `${kind}: "extensions" must be a non-empty array of lowercase extensions without the dot`
          );
        }
        const extensions = rawExtensions.map((extension) => {
          if (typeof extension !== 'string' || !/^[a-z0-9]+$/.test(extension)) {
            throw new Error(
              `${kind}: extensions must be lowercase alphanumerics without the dot, got ${JSON.stringify(extension)}`
            );
          }
          return extension;
        });
        set.fileOpeners.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            extensions,
            component: requireComponent(kind, 'component', registration.component)
          })
        );
      },
      messageDirective: (registration) => {
        const kind = 'slots.messageDirective';
        if (
          typeof registration.id !== 'string' ||
          !PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN.test(registration.id)
        ) {
          throw new Error(
            `${kind}: "id" must match ${String(PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN)}, got ${JSON.stringify(registration.id)}`
          );
        }
        requireUniqueId(kind, seen.messageDirective, registration.id);
        set.messageDirectives.push(
          stamp({
            id: registration.id,
            component: requireComponent(kind, 'component', registration.component)
          })
        );
      },
      messageAction: (registration) => {
        const kind = 'slots.messageAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.messageAction, id);
        if (typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function`);
        }
        set.messageActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            run: registration.run
          })
        );
      },
      experimental_agentCardAction: (registration) => {
        const kind = 'slots.experimental_agentCardAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.agentCardAction, id);
        if (typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function`);
        }
        if (registration.isAvailable !== undefined && typeof registration.isAvailable !== 'function') {
          throw new Error(`${kind}: "isAvailable" must be a function when set`);
        }
        set.agentCardActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            ...(registration.isAvailable !== undefined ? { isAvailable: registration.isAvailable } : {}),
            run: registration.run
          })
        );
      },
      experimental_threadCardAction: (registration) => {
        const kind = 'slots.experimental_threadCardAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.threadCardAction, id);
        if (typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function`);
        }
        if (registration.isAvailable !== undefined && typeof registration.isAvailable !== 'function') {
          throw new Error(`${kind}: "isAvailable" must be a function when set`);
        }
        set.threadCardActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            ...(registration.isAvailable !== undefined ? { isAvailable: registration.isAvailable } : {}),
            run: registration.run
          })
        );
      },
      experimental_agentsBoardAction: (registration) => {
        const kind = 'slots.experimental_agentsBoardAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.agentsBoardAction, id);
        if (typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function`);
        }
        set.agentsBoardActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            run: registration.run
          })
        );
      },
      experimental_timelineRenderer: (registration) => {
        const kind = 'slots.experimental_timelineRenderer';
        const rendererKind = requireNonEmptyString(kind, 'kind', registration.kind);
        requireUniqueId(kind, seen.timelineRenderer, rendererKind);
        set.timelineRenderers.push(
          stamp({
            id: rendererKind,
            kind: rendererKind,
            component: requireComponent(kind, 'component', registration.component)
          })
        );
      },
      commandPaletteAction: (registration) => {
        const kind = 'slots.commandPaletteAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.commandPaletteAction, id);
        if (typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function`);
        }
        if (registration.isAvailable !== undefined && typeof registration.isAvailable !== 'function') {
          throw new Error(`${kind}: "isAvailable" must be a function when set`);
        }
        set.commandPaletteActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.isAvailable !== undefined ? { isAvailable: registration.isAvailable } : {}),
            run: registration.run
          })
        );
      },
      experimental_providerIcon: (registration) => {
        const kind = 'slots.experimental_providerIcon';
        const providerId = requireNonEmptyString(kind, 'providerId', registration.providerId);
        if (!PLUGIN_SLOT_ID_PATTERN.test(providerId)) {
          throw new Error(
            `${kind}: "providerId" must match ${String(PLUGIN_SLOT_ID_PATTERN)}, got ${JSON.stringify(providerId)}`
          );
        }
        requireUniqueId(kind, seen.providerIcon, providerId);
        set.providerIcons.push(
          stamp({
            providerId,
            icon: requireComponent(kind, 'icon', registration.icon)
          })
        );
      }
    },
      composer: {
        customize: (registration) => {
          const kind = 'composer.customize';
          const id = requireSlotId(kind, registration.id);
          requireUniqueId(kind, seen.composerCustomization, id);
          const scopes = registration.scopes;
          if (scopes !== undefined) {
            if (!Array.isArray(scopes) || scopes.length === 0) {
              throw new Error(`${kind}: "scopes" must be a non-empty array when set`);
            }
            for (const scope of scopes) {
              if (!PLUGIN_COMPOSER_SCOPE_KINDS.includes(scope as PluginComposerScopeKind)) {
                throw new Error(`${kind}: invalid scope kind ${JSON.stringify(scope)}`);
              }
            }
          }
          set.composerCustomizations.push(stamp({ ...registration, id }));
        }
      },
    contentScripts: {
      register: (registration) => {
        const kind = 'contentScripts.register';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.contentScript, id);
        if (typeof registration.mount !== 'function') {
          throw new Error(`${kind}: "mount" must be a function`);
        }
        set.contentScripts.push(stamp({ id, mount: registration.mount }));
      }
    }
  });
  return set;
}
