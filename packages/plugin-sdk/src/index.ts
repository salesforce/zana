/**
 * Process-agnostic plugin SDK entry. Safe from server or renderer.
 *
 * Subpaths:
 *   - `@zana-ai/zcc-plugin-sdk/server` — ZccPluginApi factory contract
 *   - `@zana-ai/zcc-plugin-sdk/app` — definePluginApp + v1 slots
 *   - `@zana-ai/zcc-plugin-sdk/testing` — fake host for plugin unit tests
 */

export const PLUGIN_SDK_VERSION = '0.1.0';
/** Integer contract version; `engines.zccPluginSdk` ranges gate against this major. */
export const PLUGIN_SDK_API_MAJOR = 1;

export {
  BUILTIN_NAV_SENTINEL,
  derivePluginId,
  isPluginId,
  readPluginManifest,
  pluginPackageJsonSchema,
  parsePluginSource,
  satisfiesRange,
  compareVersions,
  type PluginManifest,
  type PluginPackageJson,
  type ParsedPluginSource
} from '@zana-ai/zcc-domain';

export type {
  ZccPluginApi,
  ZccPluginFactory,
  PluginLogger,
  PluginSettings,
  PluginSettingDescriptor,
  PluginStorage,
  PluginKvStorage,
  PluginDatabase,
  PluginDatabaseStatement,
  PluginRpc,
  PluginHttp,
  PluginHttpMethod,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginRealtime,
  PluginBackground,
  PluginCli,
  PluginCliRegistration,
  PluginCliCommandInfo,
  PluginCliResult,
  PluginCliContext,
  PluginCliExecutionResult,
  PluginCliOutputLimitError,
  PluginAgents,
  PluginAgentToolRegistration,
  PluginAgentToolContext,
  PluginEvents,
  PluginThreadEvent,
  PluginThreadEventName,
  PluginSdk,
  PluginSdkInbox,
  PluginSdkInboxPushArgs,
  PluginSdkProject,
  PluginSdkProjects,
  PluginSdkThreadEventListArgs,
  PluginSdkThreadEventRow,
  PluginSdkThreadIdArgs,
  PluginSdkThreadSendArgs,
  PluginSdkThreadSummary,
  PluginSdkThreads,
  PluginHostApi,
  PluginHostClient,
  PluginAgentConfigureContext,
  PluginAgentConfigureResult,
  PluginMentionProviderRegistration,
  PluginMentionResolveResult,
  PluginMentionSearchContext,
  PluginMentionSuggestion,
  PluginMentionTrigger,
  PluginProviderDeclaration,
  PluginProviderHandle,
  PluginProviderCapabilities,
  PluginUi,
  PluginInteractionRequest,
  PluginInteractionResult,
  PluginInteractionCancelReason,
  PluginStatusApi,
  PluginSettingsSnapshot
} from './server.js';

export {
  PLUGIN_CLI_OUTPUT_MAX_BYTES,
  PLUGIN_MENTION_TRIGGERS,
  enforcePluginCliOutputLimit,
  experimental_defineHostEntry,
  isPluginHostEntryDefinition
} from './server.js';

export type {
  PluginAppBuilder,
  PluginAppComposer,
  PluginAppContentScripts,
  PluginAppDefinition,
  PluginAppSetup,
  PluginAppSlots,
  PluginRegistrationSet,
  PluginNavPanelRegistration,
  PluginSettingsSectionRegistration,
  PluginHomepageSectionRegistration,
  PluginProjectTabRegistration,
  PluginProjectMenuActionRegistration,
  PluginProjectMenuActionContext,
  PluginSidebarFooterActionRegistration,
  PluginSidebarFooterActionContext,
  PluginPendingInteractionRegistration,
  PluginPendingInteractionProps,
  PluginPendingInteractionView,
  PluginThreadPanelActionRegistration,
  PluginNewThreadPanelActionRegistration,
  PluginThreadListRegistration,
  PluginThreadHeaderActionRegistration,
  PluginFileOpenerRegistration,
  PluginMessageDirectiveRegistration,
  PluginMessageActionRegistration,
  PluginAgentCardActionContext,
  PluginAgentCardActionRegistration,
  PluginAgentsBoardActionContext,
  PluginAgentsBoardActionRegistration,
  PluginTimelineRendererProps,
  PluginTimelineRendererRegistration,
  PluginCommandPaletteActionRegistration,
  PluginCommandPaletteActionContext,
  PluginProviderIconRegistration,
  PluginContentScriptRegistration,
  ComposerCustomization,
  PluginSdkApp,
  PluginSlotBase
} from './app-contract.js';

export {
  definePluginApp,
  isPluginAppDefinition,
  callPluginRpc,
  getPluginSettings,
  setPluginSettings,
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
  useSettings,
  useZccContext,
  useZccNavigate,
  useComposer,
  useComposerView,
  experimental_useSidebarThreads,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  ThreadChat,
  Markdown,
  experimental_NewThreadComposer
} from './app.js';
export type { PluginHostBridge } from './app.js';
export { collectPluginApp, emptyRegistrationSet } from './app-contract.js';
export { cronMatches, cronMinuteKey } from './cron.js';

export { shimLegacyExtensionManifest, type LegacyExtensionJson } from './legacy-shim.js';
