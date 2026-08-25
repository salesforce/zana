import {
  reasoningEffortsForLevels,
  type AvailableModel,
  type ReasoningLevel
} from '@zana-ai/zcc-domain/thread-runtime';

export interface ThreadComposerProviderOption {
  id: string;
  displayName: string;
  permissionModes: string[];
  composerActions: string[];
}

const CLAUDE_REASONING_LEVELS: readonly ReasoningLevel[] = [
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

const FALLBACK_PROVIDERS: readonly ThreadComposerProviderOption[] = [
  { id: 'claude-code', displayName: 'Claude Code', permissionModes: ['accept-edits', 'auto', 'full'], composerActions: ['plan'] },
  { id: 'codex', displayName: 'Codex', permissionModes: ['accept-edits', 'auto', 'full'], composerActions: ['plan', 'goal'] },
  { id: 'pi', displayName: 'Pi', permissionModes: ['full'], composerActions: [] },
  { id: 'acp-cursor', displayName: 'Cursor', permissionModes: ['accept-edits', 'full'], composerActions: [] },
  { id: 'acp-opencode', displayName: 'OpenCode', permissionModes: ['accept-edits', 'full'], composerActions: [] },
  { id: 'fake', displayName: 'Fake', permissionModes: ['full'], composerActions: ['plan'] }
];

export function fallbackProviderOption(providerId: string): ThreadComposerProviderOption {
  return FALLBACK_PROVIDERS.find((row) => row.id === providerId)
    ?? { id: providerId, displayName: providerId, permissionModes: ['accept-edits', 'full'], composerActions: [] };
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
  const efforts = reasoningEffortsForLevels(CLAUDE_REASONING_LEVELS);
  return entries.map((entry) => ({
    ...entry,
    supportedReasoningEfforts: efforts.map((effort) => ({ ...effort })),
    isDefault: defaultModel ? entry.model === defaultModel : false
  }));
}

const CODEX_REASONING_LEVELS: readonly ReasoningLevel[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

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

export function fallbackModelsForProvider(providerId: string): AvailableModel[] {
  if (providerId === 'claude-code' || providerId === 'claude') {
    return withClaudeEfforts(CLAUDE_FALLBACK_MODELS, 'claude-opus-5[1m]');
  }
  if (providerId === 'codex') {
    return withCatalogEfforts(CODEX_FALLBACK_MODELS, CODEX_REASONING_LEVELS, 'gpt-5.5');
  }
  if (providerId === 'fake') {
    return withCatalogEfforts([{
      id: 'fake-model',
      model: 'fake-model',
      displayName: 'Fake Model',
      description: 'In-process fake provider model',
      defaultReasoningEffort: 'medium'
    }], ['low', 'medium', 'high'], 'fake-model');
  }
  return [];
}

export function fallbackMoreModelsForProvider(providerId: string): AvailableModel[] {
  if (providerId === 'claude-code' || providerId === 'claude') {
    return withClaudeEfforts(CLAUDE_MORE_MODELS);
  }
  return [];
}
