import {
  permissionModeSchema,
  reasoningEffortsForLevels,
  type AvailableModel,
  type PermissionMode,
  type ProviderInfo,
  type ReasoningLevel
} from '@zana-ai/zcc-domain/thread-runtime';
import type { HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import {
  getThreadProvider,
  listThreadProviders,
  permissionModeForLaunchProfile,
  type ThreadProviderRecord
} from './thread-provider-catalog.js';

export type ThreadExecutionProviderInfo = Omit<ProviderInfo, 'composerActions'> & {
  composerActions: string[];
};

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

const CLAUDE_REASONING_LEVELS: readonly ReasoningLevel[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'ultracode',
  'max'
];

const CLAUDE_FALLBACK_MODELS: ReadonlyArray<{
  id: string;
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: ReasoningLevel;
}> = [
  {
    id: 'claude-fable-5',
    model: 'claude-fable-5',
    displayName: 'Fable 5',
    description: 'Fable 5 for demanding reasoning; requires Claude Code v2.1.170+',
    defaultReasoningEffort: 'high'
  },
  {
    id: 'claude-opus-5[1m]',
    model: 'claude-opus-5[1m]',
    displayName: 'Opus 5 (1M)',
    description: 'Opus 5 with 1M context for complex long coding sessions',
    defaultReasoningEffort: 'high'
  },
  {
    id: 'claude-opus-4-8[1m]',
    model: 'claude-opus-4-8[1m]',
    displayName: 'Opus 4.8 (1M)',
    description: 'Opus 4.8 with 1M context for complex long coding sessions',
    defaultReasoningEffort: 'high'
  },
  {
    id: 'claude-opus-4-7[1m]',
    model: 'claude-opus-4-7[1m]',
    displayName: 'Opus 4.7 (1M)',
    description: 'Opus 4.7 with 1M context for complex long coding sessions',
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'claude-sonnet-5',
    model: 'claude-sonnet-5',
    displayName: 'Sonnet 5',
    description: 'Sonnet 5 for everyday coding tasks with deeper reasoning',
    defaultReasoningEffort: 'medium'
  }
];

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
  // A found family CLI is the source of truth. ACP health (`which` in a plugin
  // child) must not hide OpenCode that `opencode --version` already found, and
  // Settings hide (`enabled: false`) must still win.
  if (status?.installed) return status.enabled;
  if (provider.visibility === 'installed' && extraInstalled && provider.id in extraInstalled) {
    return extraInstalled[provider.id] === true;
  }
  if (status) return false;
  if (provider.visibility === 'installed') return false;
  return true;
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
    // Sessionless maintenance requests are resolved at runtime through the
    // bridge, not from this static options builder; none are advertised here.
    maintenance: { health: false, usage: false, installation: false },
    composerActions: provider.composerActions ?? [],
    capabilities: {
      supportsThreadArchive: provider.capabilities.supportsThreadArchive,
      supportsThreadRename: provider.capabilities.supportsThreadRename,
      supportsServiceTier: provider.capabilities.supportsServiceTier,
      supportsNativeUserQuestion: provider.capabilities.supportsNativeUserQuestion === true,
      supportsFork: fork !== 'none',
      supportsSessionRewind: fork === 'checkpoint',
      permissionModes: parsePermissionModes(provider.capabilities.permissionModes),
      // PluginProviderCapabilities does not carry the provider-declared model
      // catalogue scope; default to host-scoped to match the runtime's own
      // fallback (provider-registry.ts) until it is threaded through.
      modelCatalogScope: 'host'
    }
  };
}

const CLAUDE_MORE_MODELS: ReadonlyArray<{
  id: string;
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: ReasoningLevel;
}> = [
  {
    id: 'opus[1m]',
    model: 'opus[1m]',
    displayName: 'Opus Alias (1M, Current)',
    description: 'Moving Opus 1M alias; resolves to the current Opus 1M model',
    defaultReasoningEffort: 'high'
  },
  {
    id: 'opus',
    model: 'opus',
    displayName: 'Opus Alias (Current)',
    description: 'Moving Opus alias; resolves to the current Opus model',
    defaultReasoningEffort: 'high'
  },
  {
    id: 'sonnet[1m]',
    model: 'sonnet[1m]',
    displayName: 'Sonnet Alias (1M, Legacy)',
    description: 'Legacy moving Sonnet 1M alias',
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'sonnet',
    model: 'sonnet',
    displayName: 'Sonnet Alias (Legacy)',
    description: 'Legacy moving Sonnet alias',
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'haiku',
    model: 'haiku',
    displayName: 'Haiku Alias (Legacy)',
    description: 'Legacy moving Haiku alias',
    defaultReasoningEffort: 'low'
  },
  {
    id: 'fable',
    model: 'fable',
    displayName: 'Fable Alias',
    description: 'Moving Fable alias; resolves to Claude Fable 5',
    defaultReasoningEffort: 'high'
  },
  {
    id: 'best',
    model: 'best',
    displayName: 'Best Alias',
    description: 'Moving best alias; resolves to Fable 5 where available',
    defaultReasoningEffort: 'high'
  }
];

const CODEX_REASONING_LEVELS: readonly ReasoningLevel[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
];

const CODEX_FALLBACK_MODELS: ReadonlyArray<{
  id: string;
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: ReasoningLevel;
}> = [
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: 'GPT-5.5 for everyday Codex coding tasks',
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'gpt-5.4',
    model: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: 'GPT-5.4 for faster Codex turns',
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'gpt-5.4-mini',
    model: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini',
    description: 'Smaller GPT-5.4 variant for cheap Codex turns',
    defaultReasoningEffort: 'low'
  },
  {
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    description: 'GPT-5.6 Sol for demanding Codex reasoning',
    defaultReasoningEffort: 'high'
  }
];

const FAKE_FALLBACK_MODELS: ReadonlyArray<{
  id: string;
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: ReasoningLevel;
}> = [
  {
    id: 'fake-model',
    model: 'fake-model',
    displayName: 'Fake Model',
    description: 'In-process fake provider model',
    defaultReasoningEffort: 'medium'
  }
];

function withCatalogEfforts(
  entries: ReadonlyArray<{
    id: string;
    model: string;
    displayName: string;
    description: string;
    defaultReasoningEffort: ReasoningLevel;
  }>,
  levels: readonly ReasoningLevel[],
  defaultModel?: string
): AvailableModel[] {
  const efforts = reasoningEffortsForLevels(levels);
  return entries.map((entry) => ({
    ...entry,
    supportedReasoningEfforts: efforts.map((effort) => ({ ...effort })),
    isDefault: defaultModel ? entry.model === defaultModel : false
  }));
}

function withClaudeEfforts(
  entries: ReadonlyArray<{
    id: string;
    model: string;
    displayName: string;
    description: string;
    defaultReasoningEffort: ReasoningLevel;
  }>,
  defaultModel?: string
): AvailableModel[] {
  return withCatalogEfforts(entries, CLAUDE_REASONING_LEVELS, defaultModel);
}

export function modelsForThreadProvider(
  providerId: string,
  _reasoningLevels: readonly string[]
): AvailableModel[] {
  if (providerId === 'claude-code') {
    return withClaudeEfforts(CLAUDE_FALLBACK_MODELS, 'claude-sonnet-5');
  }
  if (providerId === 'codex') {
    return withCatalogEfforts(CODEX_FALLBACK_MODELS, CODEX_REASONING_LEVELS, 'gpt-5.5');
  }
  if (providerId === 'fake') {
    return withCatalogEfforts(FAKE_FALLBACK_MODELS, ['low', 'medium', 'high'], 'fake-model');
  }
  return [];
}

export interface PluginHostModelRow {
  id: string;
  model: string;
  isDefault?: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
}

/** Static model catalog for in-process plugin host APIs (no live daemon list). */
export function pluginHostModelCatalog(providerId: string): {
  models: PluginHostModelRow[];
  selectedOnlyModels: PluginHostModelRow[];
  modelLoadError: null;
} {
  const provider = getThreadProvider(providerId);
  const declared = provider?.models?.fallback ?? [];
  const rows: PluginHostModelRow[] = declared.length > 0
    ? declared.map((model) => ({
        id: model.id,
        model: model.id,
        isDefault: model.isDefault,
        supportedReasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
          reasoningEffort: effort.reasoningEffort
        }))
      }))
    : modelsForThreadProvider(providerId, provider?.capabilities.reasoningLevels ?? []).map((model) => ({
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
}): {
  model: string;
  reasoningLevel: string;
  permissionMode: PermissionMode;
} {
  const provider = getThreadProvider(input.providerId);
  const catalog = pluginHostModelCatalog(input.providerId);
  const defaultRow = catalog.models.find((row) => row.isDefault) ?? catalog.models[0];
  const lastRow = input.lastModel
    ? catalog.models.find((row) => row.id === input.lastModel || row.model === input.lastModel)
    : undefined;
  const modelRow = lastRow ?? defaultRow;
  const model = modelRow?.model ?? modelRow?.id ?? input.providerId;
  const allowedReasons = new Set(
    (modelRow?.supportedReasoningEfforts ?? []).map((effort) => effort.reasoningEffort)
  );
  const reasoningLevel = (
    [input.lastReasoningLevel, 'medium', 'low', 'high', 'none'] as const
  ).find((level): level is string => typeof level === 'string' && allowedReasons.has(level))
    ?? [...allowedReasons][0]
    ?? 'medium';
  const allowedModes = provider?.capabilities.permissionModes ?? ['accept-edits'];
  const profileMode = permissionModeForLaunchProfile(input.providerId);
  const permissionMode = permissionModeSchema.parse(
    (allowedModes.includes(profileMode) ? profileMode : allowedModes[0]) ?? 'full'
  );
  return { model, reasoningLevel, permissionMode };
}

export function selectedOnlyModelsForThreadProvider(providerId: string): AvailableModel[] {
  if (providerId === 'claude-code') return withClaudeEfforts(CLAUDE_MORE_MODELS);
  return [];
}

export function modelListErrorDetail(error: unknown, maxChars = 300): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const collapsed = message.replace(/\s+/gu, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > maxChars ? collapsed.slice(0, maxChars) : collapsed;
}

export function classifyModelListError(error: unknown): Exclude<ThreadModelLoadErrorCode, 'provider_unavailable'> {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  const text = `${code}\n${message}`.toLowerCase();
  if (
    code === 'auth_required'
    || text.includes('not authenticated')
    || text.includes('authentication required')
    || text.includes('agent login')
    || text.includes('codex login')
    || text.includes('opencode auth')
    || text.includes('opencode login')
    || text.includes('cursor_api_key')
    || text.includes('cursor_auth_token')
  ) {
    return 'auth_required';
  }
  if (
    code === 'missing_executable'
    || code === 'enoent'
    || code === '-32004'
    || text.includes('enoent')
    || (text.includes('could not find the') && text.includes('cli'))
  ) {
    return 'missing_executable';
  }
  if (text.includes('timed out') || text.includes('timeout')) {
    return 'timeout';
  }
  return 'failed';
}

export function buildThreadExecutionOptions(input: {
  providerId?: string;
  availability: readonly HarnessVerifyResult[];
  extraInstalled?: Readonly<Record<string, boolean>>;
  listed?: { models: AvailableModel[]; selectedOnlyModels: AvailableModel[]; acpMode?: { currentValue?: string; options: Array<{ value: string; name?: string }> } } | null;
  listError?: ThreadModelLoadErrorCode | null;
  listErrorDetail?: string | null;
}): ThreadExecutionOptionsResponse {
  const catalog = listThreadProviders();
  const offered = catalog.filter((provider) => isThreadProviderOffered(provider, input.availability, input.extraInstalled));
  const requested = input.providerId
    ? catalog.find((provider) => provider.id === input.providerId) ?? offered[0]
    : offered[0];
  const staticModels = requested
    ? modelsForThreadProvider(requested.id, requested.capabilities.reasoningLevels ?? [])
    : [];
  const staticMore = requested ? selectedOnlyModelsForThreadProvider(requested.id) : [];
  const useListed = Boolean(input.listed && input.listed.models.length > 0);
  const detail = input.listErrorDetail ?? null;
  const modelLoadError = !requested && input.providerId
    ? { providerId: input.providerId, code: 'provider_unavailable' as const, detail: null }
    : requested && input.listError
      ? { providerId: requested.id, code: input.listError, detail }
      : null;
  return {
    providers: offered.map((provider) => toProviderInfo(provider, true)),
    permissionCeiling: 'full',
    models: useListed ? input.listed!.models : staticModels,
    selectedOnlyModels: useListed ? input.listed!.selectedOnlyModels : staticMore,
    modelLoadError,
    ...(input.listed?.acpMode ? { acpMode: input.listed.acpMode } : {})
  };
}
