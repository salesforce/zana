import {
  permissionModeSchema,
  reasoningLevelSchema,
  reasoningEffortsForLevels,
  type AvailableModel,
  type PermissionMode,
  type ProviderInfo
} from '@zana-ai/zcc-domain/thread-runtime';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import {
  getThreadProvider,
  listThreadProviders,
  permissionModeForLaunchProfile,
  type ThreadProviderRecord
} from './thread-provider-catalog.js';

export type ThreadExecutionProviderInfo = Omit<ProviderInfo, 'composerActions'> & { composerActions: string[] };
export type ThreadModelLoadErrorCode =
  | 'provider_unavailable'
  | 'missing_executable'
  | 'auth_required'
  | 'timeout'
  | 'failed';

export interface ThreadExecutionOptionsResponse {
  providers: ThreadExecutionProviderInfo[];
  permissionCeiling: PermissionMode;
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  modelLoadError: { providerId: string; code: ThreadModelLoadErrorCode; detail: string | null } | null;
  acpMode?: { currentValue?: string; options: Array<{ value: string; name?: string }> };
}

/** Thread provider ids → PTY harness families used by provider.status. */
export function threadProviderFamily(providerId: string): string | null {
  if (providerId === 'claude-code') return 'claude';
  if (providerId === 'acp-cursor') return 'cursor';
  if (providerId === 'acp-opencode') return 'opencode';
  if (providerId === 'acp-grok') return 'grok';
  if (providerId === 'acp-mastracode') return 'mastracode';
  if (providerId === 'acp-afcode') return 'afcode';
  if (providerId === 'codex' || providerId === 'pi') return providerId;
  return null;
}

export function isThreadProviderOffered(
  provider: Pick<ThreadProviderRecord, 'id' | 'visibility'>,
  availability: readonly HarnessVerifyResult[],
  extraInstalled?: Readonly<Record<string, boolean>>
): boolean {
  if (provider.id === 'fake') return true;
  const family = threadProviderFamily(provider.id);
  const status = family ? availability.find((row) => row.family === family) : undefined;
  if (status?.installed) return status.enabled;
  if (provider.visibility === 'installed' && extraInstalled && provider.id in extraInstalled) {
    return extraInstalled[provider.id] === true;
  }
  if (status) return false;
  return provider.visibility !== 'installed';
}

function parsePermissionModes(values: readonly string[]): PermissionMode[] {
  const modes = values.flatMap((value) => {
    const parsed = permissionModeSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  return modes.length > 0 ? modes : ['full'];
}

function toProviderInfo(provider: ThreadProviderRecord, available: boolean): ThreadExecutionProviderInfo {
  const fork = provider.capabilities.fork;
  return {
    id: provider.id,
    pluginId: provider.pluginId,
    displayName: provider.displayName,
    logoUrl: null,
    available,
    maintenance: { health: false, usage: false, installation: false },
    composerActions: provider.composerActions ?? [],
    serviceTiers: provider.serviceTiers
      ? [{id:'default',label:'Default'}, ...provider.serviceTiers.filter(tier => tier.id !== 'default')]
      : (provider.capabilities.supportsServiceTier ? [{id:'default',label:'Default'},{id:'fast',label:'Fast'}] : []),
    capabilities: {
      supportsThreadArchive: provider.capabilities.supportsThreadArchive,
      supportsThreadRename: provider.capabilities.supportsThreadRename,
      supportsServiceTier: provider.capabilities.supportsServiceTier,
      supportsNativeUserQuestion: provider.capabilities.supportsNativeUserQuestion === true,
      supportsFork: fork !== 'none',
      supportsSessionRewind: fork === 'checkpoint',
      permissionModes: parsePermissionModes(provider.capabilities.permissionModes),
      modelCatalogScope: provider.models?.scope ?? 'workspace'
    }
  };
}

/** Only provider-declared cold fallbacks are allowed; core owns no model ids. */
export function modelsForThreadProvider(providerId: string, _reasoningLevels: readonly string[]): AvailableModel[] {
  return (getThreadProvider(providerId)?.models?.fallback ?? []).map((entry) => ({
    id: entry.id,
    model: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    defaultReasoningEffort: entry.defaultReasoningEffort,
    supportedReasoningEfforts: entry.supportedReasoningEfforts.map((effort) => ({ ...effort })),
    isDefault: entry.isDefault
  }));
}

export function selectedOnlyModelsForThreadProvider(_providerId: string): AvailableModel[] {
  return [];
}

export interface PluginHostModelRow {
  id: string;
  model: string;
  isDefault?: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
}

export function pluginHostModelCatalog(providerId: string): {
  models: PluginHostModelRow[];
  selectedOnlyModels: PluginHostModelRow[];
  modelLoadError: null;
} {
  const provider = getThreadProvider(providerId);
  const rows = modelsForThreadProvider(providerId, provider?.capabilities.reasoningLevels ?? []).map((model) => ({
    id: model.id,
    model: model.model,
    isDefault: model.isDefault,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
      reasoningEffort: effort.reasoningEffort
    }))
  }));
  return { models: rows, selectedOnlyModels: rows, modelLoadError: null };
}

export function resolvePluginDefaultExecutionOptions(input: {
  providerId: string;
  lastModel: string | null;
  lastReasoningLevel: string | null;
  catalog?: { models: PluginHostModelRow[] };
}): { model: string; reasoningLevel: string; permissionMode: PermissionMode } {
  const provider = getThreadProvider(input.providerId);
  const catalog = input.catalog ?? pluginHostModelCatalog(input.providerId);
  const defaultRow = catalog.models.find((row) => row.isDefault) ?? catalog.models[0];
  const lastRow = input.lastModel
    ? catalog.models.find((row) => row.id === input.lastModel || row.model === input.lastModel)
    : undefined;
  const modelRow = lastRow ?? defaultRow;
  const model = modelRow?.model ?? modelRow?.id ?? input.lastModel ?? input.providerId;
  const allowedReasons = new Set((modelRow?.supportedReasoningEfforts ?? []).map((row) => row.reasoningEffort));
  const reasoningLevel = allowedReasons.size === 0
    ? input.lastReasoningLevel ?? 'medium'
    : [input.lastReasoningLevel, 'medium', 'low', 'high', 'none']
      .find((level): level is string => typeof level === 'string' && allowedReasons.has(level))
      ?? [...allowedReasons][0]
      ?? 'medium';
  const allowedModes = provider?.capabilities.permissionModes ?? ['accept-edits'];
  const profileMode = permissionModeForLaunchProfile(input.providerId);
  const permissionMode = permissionModeSchema.parse(
    (allowedModes.includes(profileMode) ? profileMode : allowedModes[0]) ?? 'full'
  );
  return { model, reasoningLevel, permissionMode };
}

export function overlayCustomModels(
  listed: Pick<ThreadExecutionOptionsResponse, 'models' | 'selectedOnlyModels'>,
  config: Pick<AppConfig, 'customModels'>,
  provider: ThreadProviderRecord | undefined
): Pick<ThreadExecutionOptionsResponse, 'models' | 'selectedOnlyModels'> {
  if (!provider || provider.unavailableReason || !Array.isArray(config.customModels)) return listed;
  const levels = (provider.capabilities.reasoningLevels ?? []).flatMap((value) => {
    const parsed = reasoningLevelSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  const efforts = reasoningEffortsForLevels(levels.length > 0 ? levels : ['medium']);
  const custom = config.customModels.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const providerId = typeof value.providerId === 'string' ? value.providerId.trim() : '';
    const model = typeof value.model === 'string' ? value.model.trim() : '';
    if (providerId !== provider.id || !model || model.length > 512) return [];
    return [{
      id: model,
      model,
      displayName: typeof value.displayName === 'string' && value.displayName.trim()
        ? value.displayName.trim().slice(0, 256) : model,
      description: typeof value.description === 'string' && value.description.trim()
        ? value.description.trim().slice(0, 1000) : 'Custom model',
      supportedReasoningEfforts: efforts.map((effort) => ({ ...effort })),
      defaultReasoningEffort: efforts.some((effort) => effort.reasoningEffort === 'medium')
        ? 'medium' as const : efforts[0]?.reasoningEffort ?? 'medium' as const,
      isDefault: false
    } satisfies AvailableModel];
  }).slice(0, 100);
  const seen = new Set([...listed.models, ...listed.selectedOnlyModels].flatMap((row) => [row.id, row.model]));
  const models = [...listed.models, ...custom.filter((row) => !seen.has(row.id))];
  if (!models.some((row) => row.isDefault) && models[0]) models[0] = { ...models[0], isDefault: true };
  return { models, selectedOnlyModels: listed.selectedOnlyModels };
}

export function modelListErrorDetail(error: unknown, maxChars = 300): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const collapsed = message.replace(/\s+/gu, ' ').trim();
  return collapsed ? collapsed.slice(0, maxChars) : null;
}

export function classifyModelListError(error: unknown): Exclude<ThreadModelLoadErrorCode, 'provider_unavailable'> {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  const text = `${code}\n${error instanceof Error ? error.message : String(error ?? '')}`.toLowerCase();
  if (code === 'auth_required' || /not authenticated|authentication required|agent login|codex login|opencode (auth|login)|cursor_api_key|cursor_auth_token/u.test(text)) return 'auth_required';
  if (code === 'missing_executable' || code === 'enoent' || code === '-32004' || text.includes('enoent') || (text.includes('could not find the') && text.includes('cli'))) return 'missing_executable';
  if (/timed out|timeout/u.test(text)) return 'timeout';
  return 'failed';
}

export function buildThreadExecutionOptions(input: {
  providerId?: string;
  availability: readonly HarnessVerifyResult[];
  extraInstalled?: Readonly<Record<string, boolean>>;
  providerServiceTiersDisabled?: boolean;
  listed?: { models: AvailableModel[]; selectedOnlyModels: AvailableModel[]; acpMode?: { currentValue?: string; options: Array<{ value: string; name?: string }> } } | null;
  listError?: ThreadModelLoadErrorCode | null;
  listErrorDetail?: string | null;
}): ThreadExecutionOptionsResponse {
  const catalog = listThreadProviders();
  const offered = catalog.filter((provider) => provider.unavailableReason || isThreadProviderOffered(provider, input.availability, input.extraInstalled));
  const requested = input.providerId ? getThreadProvider(input.providerId) : offered.find((provider) => !provider.unavailableReason);
  const staticModels = requested ? modelsForThreadProvider(requested.id, requested.capabilities.reasoningLevels ?? []) : [];
  const useListed = Boolean(input.listed && input.listed.models.length > 0);
  const modelLoadError = requested?.unavailableReason
    ? { providerId: requested.id, code: 'provider_unavailable' as const, detail: `${requested.displayName} could not load. Open Plugins to reload or update ${requested.pluginId}. ${requested.unavailableReason}` }
    : !requested && input.providerId
    ? { providerId: input.providerId, code: 'provider_unavailable' as const, detail: null }
    : requested && input.listError
      ? { providerId: requested.id, code: input.listError, detail: input.listErrorDetail ?? null }
      : null;
  return {
    providers: offered.map((provider) => {
      const info = toProviderInfo(provider, !provider.unavailableReason);
      if (input.providerServiceTiersDisabled) info.serviceTiers = [];
      return info;
    }),
    permissionCeiling: 'full',
    models: modelLoadError?.code === 'provider_unavailable' ? [] : useListed ? input.listed!.models : staticModels,
    selectedOnlyModels: modelLoadError?.code === 'provider_unavailable' ? [] : useListed ? input.listed!.selectedOnlyModels : [],
    modelLoadError,
    ...(input.listed?.acpMode && !requested?.unavailableReason ? { acpMode: input.listed.acpMode } : {})
  };
}
