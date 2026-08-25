/**
 * Process-agnostic plugin SDK entry. Safe from server or renderer.
 *
 * Subpaths:
 *   - `@zana-ai/zcc-plugin-sdk/server` — ZccPluginApi factory contract
 *   - `@zana-ai/zcc-plugin-sdk/app` — definePluginApp + v1 slots
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
  PluginRpc,
  PluginRealtime,
  PluginBackground,
  PluginAgents,
  PluginProviderDeclaration,
  PluginProviderHandle,
  PluginProviderCapabilities,
  PluginUi,
  PluginInteractionRequest,
  PluginInteractionResult,
  PluginInteractionCancelReason,
  PluginStatusApi
} from './server.js';

export type {
  PluginAppBuilder,
  PluginAppDefinition,
  PluginAppSetup,
  PluginAppSlots,
  PluginRegistrationSet,
  PluginNavPanelRegistration,
  PluginSettingsSectionRegistration,
  PluginHomepageSectionRegistration,
  PluginProjectTabRegistration,
  PluginSidebarFooterActionRegistration,
  PluginPendingInteractionRegistration,
  PluginPendingInteractionProps,
  PluginPendingInteractionView,
  PluginSlotBase
} from './app-contract.js';

export { definePluginApp, isPluginAppDefinition } from './app.js';
export { collectPluginApp, emptyRegistrationSet } from './app-contract.js';

export { shimLegacyExtensionManifest, type LegacyExtensionJson } from './legacy-shim.js';
