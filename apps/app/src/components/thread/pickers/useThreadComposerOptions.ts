import { useEffect, useMemo, useState } from 'react';
import {
  reconcileReasoningLevel,
  reasoningLevelSchema,
  type AvailableModel,
  type ReasoningLevel
} from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';
import type { ModelPickerOption, PickerOption } from './model-picker-option.js';
import { REASONING_LABELS, visibleComposerReasoningLevels } from './reasoning-labels.js';
import { composerActionsFromProvider } from './composer-mode.js';
import {
  fallbackModelsForProvider,
  fallbackMoreModelsForProvider,
  fallbackProviderOption,
  type ThreadComposerProviderOption
} from './fallback-models.js';

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
  const [providers, setProviders] = useState<ThreadComposerProviderOption[]>(() => [
    fallbackProviderOption(input.lockedProviderId ?? 'claude-code')
  ]);
  const [models, setModels] = useState<AvailableModel[]>(() =>
    fallbackModelsForProvider(input.lockedProviderId ?? 'claude-code')
  );
  const [moreModels, setMoreModels] = useState<AvailableModel[]>(() =>
    fallbackMoreModelsForProvider(input.lockedProviderId ?? 'claude-code')
  );
  const [loading, setLoading] = useState(false);
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
    let cancelled = false;
    const fallbackModels = fallbackModelsForProvider(providerId);
    const fallbackMore = fallbackMoreModelsForProvider(providerId);
    setModels(fallbackModels);
    setMoreModels(fallbackMore);
    setLoading(true);
    void product.threads.executionOptions({ providerId }).then((body) => {
      if (cancelled) return;
      const nextProviders = (body.providers ?? []).map((row) => ({
        id: row.id,
        displayName: row.displayName,
        permissionModes: row.capabilities?.permissionModes ?? [],
        composerActions: composerActionsFromProvider(row.composerActions)
      }));
      if (nextProviders.length > 0) setProviders(nextProviders);
      else setProviders([fallbackProviderOption(providerId)]);
      const nextModels = (body.models ?? []) as AvailableModel[];
      setModels(nextModels.length > 0 ? nextModels : fallbackModels);
      const nextMore = (body.selectedOnlyModels ?? []) as AvailableModel[];
      setMoreModels(nextMore.length > 0 ? nextMore : fallbackMore);
      if (!input.threadId) {
        const offered = nextProviders.some((row) => row.id === providerId);
        if (!offered && nextProviders[0]) setProviderId(nextProviders[0].id);
      }
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setProviders([fallbackProviderOption(providerId)]);
      setModels(fallbackModels);
      setMoreModels(fallbackMore);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [input.threadId, providerId]);

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
    reasoningLevel,
    setReasoningLevel,
    reasoningOptions
  };
}
