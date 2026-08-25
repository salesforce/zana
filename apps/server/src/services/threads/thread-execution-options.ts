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
  listThreadProviders,
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
  modelLoadError: { providerId: string; code: ThreadModelLoadErrorCode } | null;
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
  if (providerId === 'codex' || providerId === 'pi') return providerId;
  return null;
}

export function isThreadProviderOffered(
  provider: Pick<ThreadProviderRecord, 'id'>,
  availability: readonly HarnessVerifyResult[]
): boolean {
  if (provider.id === 'fake') return true;
  const family = threadProviderFamily(provider.id);
  if (!family) return true;
  const status = availability.find((row) => row.family === family);
  if (!status) return true;
  return status.installed && status.enabled;
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
    displayName: provider.displayName,
    logoUrl: null,
    available,
    composerActions: provider.composerActions ?? [],
    capabilities: {
      supportsThreadArchive: provider.capabilities.supportsThreadArchive,
      supportsThreadRename: provider.capabilities.supportsThreadRename,
      supportsServiceTier: provider.capabilities.supportsServiceTier,
      supportsNativeUserQuestion: provider.capabilities.supportsNativeUserQuestion === true,
      supportsFork: fork !== 'none',
      supportsSessionRewind: fork === 'checkpoint',
      permissionModes: parsePermissionModes(provider.capabilities.permissionModes)
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
    return withClaudeEfforts(CLAUDE_FALLBACK_MODELS, 'claude-opus-5[1m]');
  }
  if (providerId === 'codex') {
    return withCatalogEfforts(CODEX_FALLBACK_MODELS, CODEX_REASONING_LEVELS, 'gpt-5.5');
  }
  if (providerId === 'fake') {
    return withCatalogEfforts(FAKE_FALLBACK_MODELS, ['low', 'medium', 'high'], 'fake-model');
  }
  return [];
}

export function selectedOnlyModelsForThreadProvider(providerId: string): AvailableModel[] {
  if (providerId === 'claude-code') return withClaudeEfforts(CLAUDE_MORE_MODELS);
  return [];
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
    || text.includes('cursor_api_key')
    || text.includes('cursor_auth_token')
  ) {
    return 'auth_required';
  }
  if (code === 'enoent' || text.includes('enoent')) {
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
  listed?: { models: AvailableModel[]; selectedOnlyModels: AvailableModel[] } | null;
  listError?: ThreadModelLoadErrorCode | null;
}): ThreadExecutionOptionsResponse {
  const catalog = listThreadProviders();
  const offered = catalog.filter((provider) => isThreadProviderOffered(provider, input.availability));
  const requested = input.providerId
    ? catalog.find((provider) => provider.id === input.providerId) ?? offered[0]
    : offered[0];
  const staticModels = requested
    ? modelsForThreadProvider(requested.id, requested.capabilities.reasoningLevels ?? [])
    : [];
  const staticMore = requested ? selectedOnlyModelsForThreadProvider(requested.id) : [];
  const useListed = Boolean(input.listed && input.listed.models.length > 0);
  const modelLoadError = !requested && input.providerId
    ? { providerId: input.providerId, code: 'provider_unavailable' as const }
    : requested && input.listError
      ? { providerId: requested.id, code: input.listError }
      : null;
  return {
    providers: offered.map((provider) => toProviderInfo(provider, true)),
    permissionCeiling: 'full',
    models: useListed ? input.listed!.models : staticModels,
    selectedOnlyModels: useListed ? input.listed!.selectedOnlyModels : staticMore,
    modelLoadError
  };
}
