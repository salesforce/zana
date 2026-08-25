import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  reconcileReasoningLevel,
  reasoningLevelSchema,
  type AvailableModel,
  type ReasoningLevel
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ModelPickerOption, PickerOption } from './model-picker-option.js';
import { REASONING_LABELS, visibleComposerReasoningLevels } from './reasoning-labels.js';
import {
  fallbackModelsForProvider,
  fallbackMoreModelsForProvider,
  fallbackProviderOption,
  type ThreadComposerProviderOption
} from './fallback-models.js';
import {
  ensureThreadProviderModels,
  getThreadModelCatalog,
  prefetchThreadModelCatalog,
  subscribeThreadModelCatalog
} from './thread-model-catalog.js';

export type { ThreadComposerProviderOption };

function asReasoningLevel(value: string | undefined, fallback: ReasoningLevel): ReasoningLevel {
  const parsed = reasoningLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function defaultFallbackModel(providerId: string): AvailableModel | undefined {
  const rows = fallbackModelsForProvider(providerId);
  return rows.find((row) => row.isDefault) ?? rows[0];
}

export function useThreadComposerOptions(input: {
  threadId?: string;
  lockedProviderId?: string;
  initialModel?: string | null;
  initialReasoningLevel?: string | null;
}) {
  const catalog = useSyncExternalStore(
    subscribeThreadModelCatalog,
    getThreadModelCatalog,
    getThreadModelCatalog
  );
  const [providerId, setProviderId] = useState(input.lockedProviderId ?? 'claude-code');
  const [model, setModel] = useState(
    input.initialModel
      ?? defaultFallbackModel(input.lockedProviderId ?? 'claude-code')?.model
      ?? ''
  );
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(
    asReasoningLevel(
      input.initialReasoningLevel ?? undefined,
      defaultFallbackModel(input.lockedProviderId ?? 'claude-code')?.defaultReasoningEffort ?? 'medium'
    )
  );

  useEffect(() => {
    if (input.lockedProviderId) setProviderId(input.lockedProviderId);
  }, [input.lockedProviderId]);

  useEffect(() => {
    if (input.initialModel) setModel(input.initialModel);
    if (input.initialReasoningLevel) {
      setReasoningLevel(asReasoningLevel(input.initialReasoningLevel, 'medium'));
    }
  }, [input.initialModel, input.initialReasoningLevel]);

  useEffect(() => {
    void prefetchThreadModelCatalog();
  }, []);

  useEffect(() => {
    void ensureThreadProviderModels(providerId);
  }, [providerId]);

  const providers = catalog.providers.length > 0
    ? catalog.providers
    : [fallbackProviderOption(providerId)];
  const cached = catalog.byProvider[providerId];
  const models = cached?.models ?? fallbackModelsForProvider(providerId);
  const moreModels = cached?.selectedOnlyModels ?? fallbackMoreModelsForProvider(providerId);
  const loading = !cached;
  const modelLoadError = cached?.modelLoadError ?? null;

  useEffect(() => {
    if (input.threadId || input.lockedProviderId) return;
    if (catalog.providers.length === 0) return;
    const offered = catalog.providers.some((row) => row.id === providerId);
    if (!offered && catalog.providers[0]) setProviderId(catalog.providers[0].id);
  }, [input.threadId, input.lockedProviderId, catalog.providers, providerId]);

  const activeModel = useMemo(
    () => models.concat(moreModels).find((row) => row.model === model) ?? models.find((row) => row.isDefault) ?? models[0],
    [model, models, moreModels]
  );

  useEffect(() => {
    if (!activeModel) return;
    if (!model) {
      setModel(activeModel.model);
      const supported = visibleComposerReasoningLevels(
        activeModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
      );
      setReasoningLevel(
        supported.length > 0
          ? reconcileReasoningLevel(activeModel.defaultReasoningEffort, supported)
          : activeModel.defaultReasoningEffort
      );
      return;
    }
    const supported = visibleComposerReasoningLevels(
      activeModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
    );
    if (supported.length === 0) return;
    const next = reconcileReasoningLevel(reasoningLevel, supported);
    if (next !== reasoningLevel) setReasoningLevel(next);
  }, [activeModel, model, reasoningLevel]);

  const providerOptions: PickerOption<string>[] = providers.map((row) => ({
    value: row.id,
    label: row.displayName
  }));
  const modelOptions: ModelPickerOption[] = models.map((row) => ({
    value: row.model,
    label: row.displayName,
    ...(row.routeProviderId ? { routeProviderId: row.routeProviderId } : {})
  }));
  const moreModelOptions: ModelPickerOption[] = moreModels.map((row) => ({
    value: row.model,
    label: row.displayName,
    ...(row.routeProviderId ? { routeProviderId: row.routeProviderId } : {})
  }));
  const reasoningOptions: PickerOption<ReasoningLevel>[] = visibleComposerReasoningLevels(
    (activeModel?.supportedReasoningEfforts ?? []).map((effort) => effort.reasoningEffort)
  ).map((level) => ({
    value: level,
    label: REASONING_LABELS[level]
  }));
  const provider = providers.find((row) => row.id === providerId) ?? providers[0];

  return {
    providers,
    provider,
    providerId,
    setProviderId,
    providerOptions,
    model,
    setModel,
    modelOptions,
    moreModelOptions,
    modelIsLoading: loading,
    modelLoadError,
    reasoningLevel,
    setReasoningLevel,
    reasoningOptions
  };
}
