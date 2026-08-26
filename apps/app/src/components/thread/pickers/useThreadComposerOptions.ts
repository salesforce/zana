import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
  rememberComposerSelection,
  rememberedProviderId,
  rememberedSelectionFor
} from './composer-selection-preference.js';
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

function restoreProviderSelection(nextProviderId: string): {
  model: string;
  reasoningLevel: ReasoningLevel;
} {
  const remembered = rememberedSelectionFor(nextProviderId);
  const fallback = defaultFallbackModel(nextProviderId);
  return {
    model: remembered?.model ?? fallback?.model ?? '',
    reasoningLevel: asReasoningLevel(
      remembered?.reasoningLevel,
      fallback?.defaultReasoningEffort ?? 'medium'
    )
  };
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
  const [providerId, setProviderIdState] = useState(
    () => input.lockedProviderId ?? rememberedProviderId() ?? 'claude-code'
  );
  const [model, setModelState] = useState(() => {
    if (input.initialModel) return input.initialModel;
    const provider = input.lockedProviderId ?? rememberedProviderId() ?? 'claude-code';
    return restoreProviderSelection(provider).model;
  });
  const [reasoningLevel, setReasoningLevelState] = useState<ReasoningLevel>(() => {
    if (input.initialReasoningLevel) {
      return asReasoningLevel(input.initialReasoningLevel, 'medium');
    }
    const provider = input.lockedProviderId ?? rememberedProviderId() ?? 'claude-code';
    return restoreProviderSelection(provider).reasoningLevel;
  });

  const setModel = useCallback((value: string) => {
    setModelState(value);
    rememberComposerSelection({ providerId, model: value, reasoningLevel });
  }, [providerId, reasoningLevel]);

  const setReasoningLevel = useCallback((value: ReasoningLevel) => {
    setReasoningLevelState(value);
    rememberComposerSelection({ providerId, model, reasoningLevel: value });
  }, [model, providerId]);

  const setProviderId = useCallback((value: string) => {
    if (value === providerId) return;
    rememberComposerSelection({ providerId, model, reasoningLevel });
    setProviderIdState(value);
    const restored = restoreProviderSelection(value);
    setModelState(restored.model);
    setReasoningLevelState(restored.reasoningLevel);
    if (restored.model) {
      rememberComposerSelection({
        providerId: value,
        model: restored.model,
        reasoningLevel: restored.reasoningLevel
      });
    }
  }, [model, providerId, reasoningLevel]);

  useEffect(() => {
    if (input.lockedProviderId) setProviderIdState(input.lockedProviderId);
  }, [input.lockedProviderId]);

  useEffect(() => {
    if (input.initialModel) setModelState(input.initialModel);
    if (input.initialReasoningLevel) {
      setReasoningLevelState(asReasoningLevel(input.initialReasoningLevel, 'medium'));
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
    : input.threadId || input.lockedProviderId
      ? [fallbackProviderOption(providerId)]
      : [];
  const cached = catalog.byProvider[providerId];
  const models = cached?.models ?? fallbackModelsForProvider(providerId);
  const moreModels = cached?.selectedOnlyModels ?? fallbackMoreModelsForProvider(providerId);
  const loading = !cached;
  const modelLoadError = cached?.modelLoadError ?? null;

  useEffect(() => {
    if (input.threadId || input.lockedProviderId) return;
    if (catalog.providers.length === 0) return;
    const offered = catalog.providers.some((row) => row.id === providerId);
    if (!offered && catalog.providers[0]) {
      const next = catalog.providers[0].id;
      setProviderIdState(next);
      const restored = restoreProviderSelection(next);
      setModelState(restored.model);
      setReasoningLevelState(restored.reasoningLevel);
    }
  }, [input.threadId, input.lockedProviderId, catalog.providers, providerId]);

  const activeModel = useMemo(
    () => models.concat(moreModels).find((row) => row.model === model) ?? models.find((row) => row.isDefault) ?? models[0],
    [model, models, moreModels]
  );

  useEffect(() => {
    if (!activeModel) return;
    if (!model) {
      setModelState(activeModel.model);
      const supported = visibleComposerReasoningLevels(
        activeModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
      );
      setReasoningLevelState(
        supported.length > 0
          ? reconcileReasoningLevel(activeModel.defaultReasoningEffort, supported)
          : activeModel.defaultReasoningEffort
      );
      return;
    }
    const offered = models.concat(moreModels).some((row) => row.model === model);
    if (!loading && models.length + moreModels.length > 0 && !offered) {
      setModelState(activeModel.model);
      return;
    }
    const supported = visibleComposerReasoningLevels(
      activeModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
    );
    if (supported.length === 0) return;
    const next = reconcileReasoningLevel(reasoningLevel, supported);
    if (next !== reasoningLevel) setReasoningLevelState(next);
  }, [activeModel, loading, model, models, moreModels, reasoningLevel]);

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
