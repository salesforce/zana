export { EDITOR_SELECTION_MIME, MAX_EDITOR_SELECTION_TEXT, parseEditorSelection, editorSelectionFromClipboard, editorSelectionLabel, editorSelectionPrompt, type EditorSelection } from './editor-selection.js';
import type {
  ComposerView,
  HarnessRoutingEditorProps,
  MarkdownProps,
  NewThreadComposerProps,
  PluginAppDefinition,
  PluginAppSetup,
  PluginComposerApi,
  PluginRpcClient,
  PluginSdkApp,
  PluginSettingsState,
  ThreadChatProps,
  ZccContext,
  ZccDeepLinkOpenResult,
  ZccDeepLinkRejectReason,
  ZccDeepLinks,
  ZccNavigate,
  ZccWindowTitle
} from './app-contract.js';
import type { PluginSettingValue, PluginSettingsSnapshot } from './server.js';
import type { PluginApprovalRequest, PluginApprovalResult } from './approval-contract.js';
export type { PluginApprovalBinding, PluginApprovalRequest, PluginApprovalResult } from './approval-contract.js';

export type {
  ComposerCustomization,
  ComposerPlusMenuItem,
  ComposerView,
  HarnessRoutingEditorPatch,
  HarnessRoutingEditorProps,
  HarnessRoutingEditorRowCopy,
  MarkdownProps,
  NewThreadComposerProps,
  PluginHarnessOverride,
  PluginAppBuilder,
  PluginAppComposer,
  PluginAppContentScripts,
  PluginAppDefinition,
  PluginAppSetup,
  PluginAppSlots,
  PluginComposerApi,
  PluginComposerLaunchPatch,
  PluginComposerScope,
  PluginComposerScopeKind,
  PluginContentScriptContext,
  PluginFileOpenerProps,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginMessageActionContext,
  PluginMessageActionRegistration,
  PluginAgentCardActionContext,
  PluginAgentCardActionRegistration,
  PluginThreadCardActionContext,
  PluginThreadCardActionRegistration,
  PluginAgentsBoardActionContext,
  PluginAgentsBoardActionRegistration,
  PluginAgentsViewRegistration,
  PluginAgentsViewProps,
  PluginFleetMember,
  PluginFleetSchedule,
  PluginFleetExecution,
  PluginTimelineRendererProps,
  PluginTimelineRendererRegistration,
  PluginCommandPaletteActionContext,
  PluginCommandPaletteActionRegistration,
  PluginMessageDirectiveProps,
  PluginMessageDirectiveRegistration,
  PluginNavPanelPlacement,
  PluginNavPanelProps,
  PluginNavPanelRegistration,
  PluginNewThreadPanelActionRegistration,
  PluginPendingInteractionProps,
  PluginInteractionQuestion,
  PluginInteractionAnswers,
  PluginQuestionForm,
  PluginPendingInteractionRegistration,
  PluginPendingInteractionView,
  PluginDetachedTabProps,
  PluginProjectTabRegistration,
  PluginProjectMenuActionRegistration,
  PluginProjectMenuActionContext,
  PluginCreateProjectActionRegistration,
  PluginCreateProjectActionContext,
  PluginCreateProjectDialogProps,
  ZccNavigateToProjectOptions,
  ZccPanelAgentOptions,
  ZccPanelToolOptions,
  ZccPanelScope,
  PluginProviderIconRegistration,
  PluginRegistrationSet,
  PluginSdkApp,
  PluginSettingsState,
  PluginSettingsSectionRegistration,
  PluginSidebarFooterActionContext,
  PluginSidebarFooterActionRegistration,
  PluginProjectStatusbarAlign,
  PluginProjectStatusbarDialogProps,
  PluginProjectStatusbarItemContext,
  PluginProjectStatusbarItemProps,
  PluginProjectStatusbarItemRegistration,
  PluginProjectStatusbarMenuItem,
  PluginSlotBase,
  PluginThreadHeaderActionProps,
  PluginThreadHeaderActionRegistration,
  PluginThreadListProps,
  PluginSidebarThread,
  PluginSidebarThreadActions,
  PluginThreadListRegistration,
  PluginThreadPanelActionContext,
  PluginThreadPanelActionRegistration,
  PluginThreadPanelProps,
  PluginThreadPanelPage,
  PluginThreadPanelScope,
  ThreadChatMessageAction,
  ThreadChatMessageReference,
  ThreadChatProps,
  ZccContext,
  ZccDeepLinkOpenResult,
  ZccDeepLinkRejectReason,
  ZccDeepLinks,
  ZccNavigate,
  ZccSurface,
  ZccWindowTitle,
  ZccWindowTitleTone
} from './app-contract.js';

export {
  collectPluginApp,
  DEFAULT_PLUGIN_THREAD_PANEL_SCOPES,
  emptyRegistrationSet,
  navPanelListsInExtensionsHub,
  navPanelListsInSidebar,
  PLUGIN_COMPOSER_SCOPE_KINDS,
  PLUGIN_NAV_PANEL_PLACEMENTS,
  PLUGIN_PROJECT_STATUSBAR_ALIGNS,
  PLUGIN_THREAD_PANEL_SCOPES,
  threadPanelActionMatchesScope
} from './app-contract.js';

export interface PluginHostBridge {
  callRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
  getSettings(pluginId: string): Promise<PluginSettingsSnapshot>;
  setSettings(
    pluginId: string,
    values: Record<string, PluginSettingValue | undefined>
  ): Promise<void>;
  /** Absent on hosts that cannot draw an approval sheet (web, mobile). */
  requestApproval?(pluginId: string, request: PluginApprovalRequest): Promise<PluginApprovalResult>;
}

function pluginHost(): PluginHostBridge {
  const host = (globalThis as { __ZCC_PLUGIN_HOST__?: PluginHostBridge }).__ZCC_PLUGIN_HOST__;
  if (!host) throw new Error('plugin host is not available');
  return host;
}

function pluginRuntime(): Partial<PluginSdkApp> {
  return (
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: Partial<PluginSdkApp> }).__ZCC_PLUGIN_RUNTIME__ ?? {}
  );
}

function missing(name: string): never {
  throw new Error(`${name} is not available until the host plugin runtime is installed`);
}

/** Call a server `zcc.rpc.method` from a plugin app bundle. */
export async function callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown> {
  return pluginHost().callRpc(pluginId, method, args);
}

/**
 * Ask the host to draw an approval sheet for an action the user started from
 * this plugin's own UI, such as a Publish button. The host shows the binding,
 * collects any typed confirmation, and returns a single-use token signed for
 * that binding; pass it to your server, which rebuilds the binding and calls
 * `zcc.ui.experimental_consumeApproval`. Resolves `unavailable` where no
 * desktop host can draw the sheet, so the action must fail closed there.
 */
export async function experimental_requestApproval(
  pluginId: string,
  request: PluginApprovalRequest
): Promise<PluginApprovalResult> {
  const host = (globalThis as { __ZCC_PLUGIN_HOST__?: PluginHostBridge }).__ZCC_PLUGIN_HOST__;
  if (!host?.requestApproval) return { approved: false, reason: 'unavailable' };
  return host.requestApproval(pluginId, request);
}

export async function getPluginSettings(pluginId: string): Promise<PluginSettingsSnapshot> {
  return pluginHost().getSettings(pluginId);
}

export async function setPluginSettings(
  pluginId: string,
  values: Record<string, PluginSettingValue | undefined>
): Promise<void> {
  return pluginHost().setSettings(pluginId, values);
}

export function definePluginApp(setup: PluginAppSetup): PluginAppDefinition {
  // Pure factory. Do not delegate to `__ZCC_PLUGIN_RUNTIME__.definePluginApp`:
  // the host installs this same function on the runtime, which would recurse
  // until "Maximum call stack size exceeded".
  return { __zccPluginApp: true, setup };
}

export function isPluginAppDefinition(value: unknown): value is PluginAppDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PluginAppDefinition).__zccPluginApp === true &&
    typeof (value as PluginAppDefinition).setup === 'function'
  );
}

export function useRpc(): PluginRpcClient {
  return pluginRuntime().useRpc?.() ?? missing('useRpc');
}

export function useRealtime(channel: string, handler: (payload: unknown) => void): void {
  pluginRuntime().useRealtime?.(channel, handler);
}

export function useRealtimeConnectionState() {
  return pluginRuntime().useRealtimeConnectionState?.() ?? 'connecting';
}

export function useSettings(): PluginSettingsState {
  return pluginRuntime().useSettings?.() ?? { values: undefined, isLoading: true };
}

export function useZccContext(): ZccContext {
  return pluginRuntime().useZccContext?.() ?? { projectId: null, threadId: null };
}

export function useZccNavigate(): ZccNavigate {
  return pluginRuntime().useZccNavigate?.() ?? missing('useZccNavigate');
}

const unavailableDeepLinks: ZccDeepLinks = {
  base: () => null,
  on: () => () => undefined,
  open: async () => ({ ok: false, reason: 'unavailable' })
};

/**
 * Deep links for this plugin: `base()`, `on(route, handler)` and `open(rawLink)`.
 * On hosts without deep links `base()` is null, `on` never fires and `open`
 * resolves `unavailable`, so callers can use it unconditionally.
 */
export function useZccDeepLinks(): ZccDeepLinks {
  return pluginRuntime().useZccDeepLinks?.() ?? unavailableDeepLinks;
}

/**
 * Titles this plugin's own window (a detachable project tab opened with `openInWindow`) while
 * the calling component is mounted; pass null to keep the tab label. With several callers the
 * one mounted last shows, and a changed title keeps its caller's place. It does nothing in the
 * main or a project window, whose title belongs to the host, and on hosts that predate it.
 */
export function useWindowTitle(title: ZccWindowTitle | null | undefined): void {
  pluginRuntime().useWindowTitle?.(title);
}

export function useWindowCloseHandler(handler: ((signal: AbortSignal) => void | Promise<void>) | null): void {
  pluginRuntime().useWindowCloseHandler?.(handler);
}

export function useComposer(): PluginComposerApi {
  return pluginRuntime().useComposer?.() ?? missing('useComposer');
}

export function useComposerView(): ComposerView {
  return pluginRuntime().useComposerView?.() ?? missing('useComposerView');
}

export function experimental_useSidebarThreads() {
  return pluginRuntime().experimental_useSidebarThreads?.() ?? { status: 'loading' as const, threads: [], projects: [] };
}

export function experimental_useSidebarThreadActions(): ReturnType<PluginSdkApp['experimental_useSidebarThreadActions']> {
  return (
    pluginRuntime().experimental_useSidebarThreadActions?.() ?? {
      open: () => undefined,
      openNewThread: () => undefined,
      setPinned: async () => missing('setPinned'),
      setRead: async () => missing('setRead'),
      rename: async () => missing('rename'),
      archive: async () => missing('archive'),
      stop: async () => missing('stop'),
      closeFollowup: async () => missing('closeFollowup')
    }
  );
}

export function experimental_useSidebarThreadPullRequest(threadId: string) {
  return pluginRuntime().experimental_useSidebarThreadPullRequest?.(threadId) ?? {
    isLoading: false,
    pullRequest: null
  };
}

export function experimental_useSidebarThreadSplit(threadId: string) {
  return (
    pluginRuntime().experimental_useSidebarThreadSplit?.(threadId) ?? {
      isAvailable: false,
      splitProps: {},
      layout: null
    }
  );
}

function hostReact(): typeof import('react') | undefined {
  return (globalThis as { __ZCC_HOST_REACT__?: typeof import('react') }).__ZCC_HOST_REACT__;
}

function renderHostComponent<P extends object>(
  name: keyof Pick<PluginSdkApp, 'ThreadChat' | 'Markdown' | 'experimental_NewThreadComposer' | 'experimental_HarnessRoutingEditor'>,
  props: P
) {
  const React = hostReact();
  const Impl = pluginRuntime()[name] as import('react').ComponentType<P> | undefined;
  if (!React || !Impl) return null;
  return React.createElement(Impl, props);
}

export function ThreadChat(props: ThreadChatProps) {
  return renderHostComponent('ThreadChat', props);
}

export function Markdown(props: MarkdownProps) {
  return renderHostComponent('Markdown', props);
}

export function experimental_NewThreadComposer(props: NewThreadComposerProps) {
  return renderHostComponent('experimental_NewThreadComposer', props);
}

export function experimental_HarnessRoutingEditor(props: HarnessRoutingEditorProps) {
  return renderHostComponent('experimental_HarnessRoutingEditor', props);
}
