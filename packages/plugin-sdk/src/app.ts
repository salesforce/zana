import type {
  ComposerView,
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
  ZccNavigate
} from './app-contract.js';
import type { PluginSettingValue, PluginSettingsSnapshot } from './server.js';

export type {
  ComposerCustomization,
  ComposerPlusMenuItem,
  ComposerView,
  MarkdownProps,
  NewThreadComposerProps,
  PluginAppBuilder,
  PluginAppComposer,
  PluginAppContentScripts,
  PluginAppDefinition,
  PluginAppSetup,
  PluginAppSlots,
  PluginComposerApi,
  PluginComposerScope,
  PluginContentScriptContext,
  PluginFileOpenerProps,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginMessageActionContext,
  PluginMessageActionRegistration,
  PluginCommandPaletteActionContext,
  PluginCommandPaletteActionRegistration,
  PluginMessageDirectiveProps,
  PluginMessageDirectiveRegistration,
  PluginNavPanelProps,
  PluginNavPanelRegistration,
  PluginNewThreadPanelActionRegistration,
  PluginPendingInteractionProps,
  PluginPendingInteractionRegistration,
  PluginPendingInteractionView,
  PluginProjectTabRegistration,
  PluginProviderIconRegistration,
  PluginRegistrationSet,
  PluginSdkApp,
  PluginSettingsState,
  PluginSettingsSectionRegistration,
  PluginSidebarFooterActionContext,
  PluginSidebarFooterActionRegistration,
  PluginSlotBase,
  PluginThreadHeaderActionProps,
  PluginThreadHeaderActionRegistration,
  PluginThreadListProps,
  PluginThreadListRegistration,
  PluginThreadPanelActionRegistration,
  PluginThreadPanelProps,
  ThreadChatProps,
  ZccContext,
  ZccNavigate
} from './app-contract.js';

export { collectPluginApp, emptyRegistrationSet } from './app-contract.js';

export interface PluginHostBridge {
  callRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
  getSettings(pluginId: string): Promise<PluginSettingsSnapshot>;
  setSettings(
    pluginId: string,
    values: Record<string, PluginSettingValue | undefined>
  ): Promise<void>;
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

export function useComposer(): PluginComposerApi {
  return pluginRuntime().useComposer?.() ?? missing('useComposer');
}

export function useComposerView(): ComposerView {
  return pluginRuntime().useComposerView?.() ?? missing('useComposerView');
}

export function experimental_useSidebarThreads() {
  return pluginRuntime().experimental_useSidebarThreads?.() ?? { status: 'loading' as const, threads: [], projects: [] };
}

export function experimental_useSidebarThreadActions() {
  return (
    pluginRuntime().experimental_useSidebarThreadActions?.() ?? {
      open: () => undefined,
      openNewThread: () => undefined
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
  name: keyof Pick<PluginSdkApp, 'ThreadChat' | 'Markdown' | 'experimental_NewThreadComposer'>,
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
