import type { ComponentType, ReactNode } from 'react';
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

export interface PluginNavPanelRegistration extends PluginSlotBase {
  title: string;
  icon: string;
  path?: string;
  /**
   * `sidebar` (default) is a global rail row. `extensions` lists the page
   * under Plugins instead of on the main sidebar.
   */
  placement?: 'sidebar' | 'extensions';
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
  component: ComponentType<{ pluginId: string; projectId: string }>;
}

export interface PluginProjectMenuActionContext {
  projectId: string | null;
}

export interface PluginProjectMenuActionRegistration extends PluginSlotBase {
  title: string;
  icon?: string;
  /** `project` = row overflow; `workspace` = Projects list-header organize menu (legacy name kept) */
  placement: 'project' | 'workspace';
  run: (ctx: PluginProjectMenuActionContext) => void | Promise<void>;
}

export interface PluginSidebarFooterActionContext {
  openSettings(): void;
}

export interface PluginSidebarFooterActionRegistration extends PluginSlotBase {
  title: string;
  icon: string;
  run: (context: PluginSidebarFooterActionContext) => void | Promise<void>;
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

export interface PluginPendingInteractionRegistration extends PluginSlotBase {
  component: ComponentType<PluginPendingInteractionProps>;
}

export const PLUGIN_THREAD_PANEL_SCOPES = ['thread', 'agent-session'] as const;
export type PluginThreadPanelScope = (typeof PLUGIN_THREAD_PANEL_SCOPES)[number];
export const DEFAULT_PLUGIN_THREAD_PANEL_SCOPES: readonly PluginThreadPanelScope[] = ['thread'];

export function threadPanelActionMatchesScope(
  action: { scopes?: readonly PluginThreadPanelScope[] },
  scope: PluginThreadPanelScope
): boolean {
  const scopes = action.scopes ?? DEFAULT_PLUGIN_THREAD_PANEL_SCOPES;
  return scopes.includes(scope);
}

export interface PluginThreadPanelProps {
  pluginId: string;
  /**
   * The thread id, or the CLI-agent session id when this tab was opened from
   * an agent-session side panel (`scopes` includes `"agent-session"`).
   */
  threadId: string;
  params: JsonValue | null;
}

export interface PluginThreadPanelActionContext {
  threadId: string;
  /** Returns true when the host opened this action's side panel. */
  openPanel(options?: { title?: string; params?: JsonValue }): boolean;
}

export interface PluginThreadPanelActionRegistration extends PluginSlotBase {
  title: string;
  icon?: string;
  component: ComponentType<PluginThreadPanelProps>;
  layout?: 'padded' | 'flush';
  /**
   * New Tab launchers that list this action. Default `['thread']` — thread
   * workbench only. Include `'agent-session'` to also list it on the CLI-agent
   * inspector side panel.
   */
  scopes?: readonly PluginThreadPanelScope[];
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
}

export interface PluginFileOpenerProps {
  pluginId: string;
  path: string;
  source: PluginFileOpenerSource;
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

export type PluginComposerScopeKind = 'thread' | 'queued-message' | 'side-chat' | 'new-thread';

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
  | { kind: 'new-thread'; projectId: string | null };

export interface ComposerView {
  scope: PluginComposerScope;
  layout: 'expanded' | 'compact' | 'zen';
  draft: { text: string; isEmpty: boolean; attachmentCount: number };
  run: { isRunning: boolean; isSubmitting: boolean };
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
  sidebarFooterAction(registration: Omit<PluginSidebarFooterActionRegistration, 'generation' | 'pluginId'>): void;
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
  sidebarFooterActions: PluginSidebarFooterActionRegistration[];
  pendingInteractions: PluginPendingInteractionRegistration[];
  threadPanelActions: PluginThreadPanelActionRegistration[];
  newThreadPanelActions: PluginNewThreadPanelActionRegistration[];
  threadLists: PluginThreadListRegistration[];
  threadHeaderActions: PluginThreadHeaderActionRegistration[];
  fileOpeners: PluginFileOpenerRegistration[];
  messageDirectives: PluginMessageDirectiveRegistration[];
  messageActions: PluginMessageActionRegistration[];
  agentCardActions: PluginAgentCardActionRegistration[];
  agentsBoardActions: PluginAgentsBoardActionRegistration[];
  timelineRenderers: PluginTimelineRendererRegistration[];
  commandPaletteActions: PluginCommandPaletteActionRegistration[];
  providerIcons: PluginProviderIconRegistration[];
  composerCustomizations: ComposerCustomization[];
  contentScripts: PluginContentScriptRegistration[];
}

export interface PluginSettingsState {
  values: Record<string, string | boolean> | undefined;
  isLoading: boolean;
}

export type PluginRealtimeConnectionState = 'connecting' | 'connected' | 'reconnecting';

export interface ZccContext {
  projectId: string | null;
  threadId: string | null;
}

export interface ZccNavigate {
  toThread(threadId: string): void;
  toProject(projectId: string): void;
  toPluginPanel(path: string, options?: { subPath?: string; replace?: boolean }): void;
  toCompose(options?: { initialPrompt?: string; focusPrompt?: boolean }): void;
  openThreadPanel(options: { actionId: string; title?: string; params?: JsonValue }): boolean;
}

export interface ThreadChatProps {
  threadId: string;
  variant?: 'full' | 'compact' | 'timeline';
  layout?: 'contained' | 'document';
  focusRequest?: number;
  permissionPolicy?: 'inherit' | 'editable';
  className?: string;
  leadingContent?: ReactNode;
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

export interface PluginSdkApp {
  definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
  useRpc(): PluginRpcClient;
  useRealtime(channel: string, handler: (payload: unknown) => void): void;
  useRealtimeConnectionState(): PluginRealtimeConnectionState;
  useSettings(): PluginSettingsState;
  useZccContext(): ZccContext;
  useZccNavigate(): ZccNavigate;
  useComposer(): PluginComposerApi;
  useComposerView(): ComposerView;
  experimental_useSidebarThreads(): { status: 'loading' | 'ready' | 'error'; threads: unknown[]; projects: unknown[] };
  experimental_useSidebarThreadActions(): {
    open(threadId: string): void;
    openNewThread(options?: { projectId?: string }): void;
  };
  experimental_useSidebarThreadPullRequest(threadId: string): {
    isLoading: boolean;
    pullRequest: unknown | null;
  };
  experimental_useSidebarThreadSplit(threadId: string): { isAvailable: boolean; splitProps: object; layout: null };
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
    sidebarFooterActions: [],
    pendingInteractions: [],
    threadPanelActions: [],
    newThreadPanelActions: [],
    threadLists: [],
    threadHeaderActions: [],
    fileOpeners: [],
    messageDirectives: [],
    messageActions: [],
    agentCardActions: [],
    agentsBoardActions: [],
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

function requireThreadPanelScopes(
  kind: string,
  value: unknown
): readonly PluginThreadPanelScope[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${kind}: "scopes" must be a non-empty array of "thread" | "agent-session"`);
  }
  const allowed = new Set<string>(PLUGIN_THREAD_PANEL_SCOPES);
  const out: PluginThreadPanelScope[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      throw new Error(`${kind}: "scopes" must be a non-empty array of "thread" | "agent-session"`);
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
    threadPanelAction: new Set<string>(),
    newThreadPanelAction: new Set<string>(),
    composerCustomization: new Set<string>(),
    pendingInteraction: new Set<string>(),
    sidebarFooterAction: new Set<string>(),
    threadList: new Set<string>(),
    threadHeaderAction: new Set<string>(),
    fileOpener: new Set<string>(),
    messageDirective: new Set<string>(),
    messageAction: new Set<string>(),
    agentCardAction: new Set<string>(),
    agentsBoardAction: new Set<string>(),
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
        if (registration.placement !== undefined && registration.placement !== 'sidebar' && registration.placement !== 'extensions') {
          throw new Error(`${kind}: "placement" must be "sidebar" or "extensions"`);
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
        set.projectMenuActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            placement: registration.placement,
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
      pendingInteraction: (registration) => {
        const kind = 'slots.pendingInteraction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.pendingInteraction, id);
        set.pendingInteractions.push(
          stamp({
            id,
            component: requireComponent(kind, 'component', registration.component)
          })
        );
      },
      threadPanelAction: (registration) => {
        const kind = 'slots.threadPanelAction';
        const id = requireSlotId(kind, registration.id);
        requireUniqueId(kind, seen.threadPanelAction, id);
        if (registration.run !== undefined && typeof registration.run !== 'function') {
          throw new Error(`${kind}: "run" must be a function when set`);
        }
        const scopes = requireThreadPanelScopes(kind, registration.scopes);
        set.threadPanelActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
            ...(registration.icon !== undefined
              ? { icon: requireNonEmptyString(kind, 'icon', registration.icon) }
              : {}),
            component: requireComponent(kind, 'component', registration.component),
            ...(requireLayout(kind, registration.layout)
              ? { layout: registration.layout }
              : {}),
            ...(scopes !== undefined ? { scopes } : {}),
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
        set.newThreadPanelActions.push(
          stamp({
            id,
            title: requireNonEmptyString(kind, 'title', registration.title),
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
