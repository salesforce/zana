import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  reconcileReasoningLevel,
  reasoningLevelSchema,
  type AvailableModel,
  type ReasoningLevel
} from '@zana-ai/zcc-domain/thread-runtime';
import { availableModelsToPickerOptions, type ModelPickerOption, type PickerOption } from './model-picker-option.js';
import { REASONING_LABELS, visibleComposerReasoningLevels } from './reasoning-labels.js';
import {
  composerProvidersFromCatalog,
  fallbackModelsForProvider,
  fallbackMoreModelsForProvider,
  snapNewThreadProviderId,
  type ThreadComposerProviderOption
} from './fallback-models.js';
import {
  defaultOfferedComposerModel,
  preferredComposerModel,
  rememberComposerSelection,
  rememberedProviderId,
  rememberedSelectionFor
} from './composer-selection-preference.js';
import { threadModelCatalogForHost } from './thread-model-catalog.js';
import { nextAcpModeSelection } from './acp-mode-selection.js';
import { useComposerSession, useComposerSetting } from '../../composer/ComposerDraft.js';
import type { ComposerSession } from '../../composer/composer-session.js';

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
  session?: ComposerSession;
  threadId?: string;
  lockedProviderId?: string;
  initialModel?: string | null;
  initialReasoningLevel?: string | null;
  initialAcpMode?: string | null;
  preferredProviderId?: string | null;
  hostId?: string;
  projectId?: string;
  /** True while the host roster is still hydrating — do not treat missing hostId as a machine change. */
  hostPending?: boolean;
}) {
  const fallbackSession = useComposerSession();
  const session = input.session ?? fallbackSession;
  const [savedProvider, saveProvider, hasProvider] = useComposerSetting<string | undefined>(session, 'modern.provider', undefined);
  const [savedModel, saveModel, hasModel, clearModel] = useComposerSetting<string | undefined>(session, 'modern.model', undefined);
  const [savedReasoning, saveReasoning, hasReasoning, clearReasoning] = useComposerSetting<ReasoningLevel | undefined>(session, 'modern.reasoning', undefined);
  const [savedAcpMode, saveAcpMode, hasAcpMode, clearAcpMode] = useComposerSetting<string | undefined>(session, 'modern.acpMode', undefined);
  const hostCatalog = threadModelCatalogForHost(input.hostId, input.projectId);
  const catalog = useSyncExternalStore(hostCatalog.subscribe, hostCatalog.getSnapshot, hostCatalog.getSnapshot);
  const [providerId, setProviderIdState] = useState(
    () => input.lockedProviderId ?? savedProvider ?? rememberedProviderId() ?? 'claude-code'
  );
  const [model, setModelState] = useState(() => {
    if (hasModel) return savedModel ?? '';
    if (input.initialModel) return input.initialModel;
    const provider = input.lockedProviderId ?? savedProvider ?? rememberedProviderId() ?? 'claude-code';
    return restoreProviderSelection(provider).model;
  });
  const [reasoningLevel, setReasoningLevelState] = useState<ReasoningLevel>(() => {
    if (hasReasoning) return savedReasoning ?? 'medium';
    if (input.initialReasoningLevel) {
      return asReasoningLevel(input.initialReasoningLevel, 'medium');
    }
    const provider = input.lockedProviderId ?? savedProvider ?? rememberedProviderId() ?? 'claude-code';
    return restoreProviderSelection(provider).reasoningLevel;
  });
  const [acpMode, setAcpModeState] = useState<string | undefined>(() => hasAcpMode ? savedAcpMode : input.initialAcpMode ?? undefined);
  const setAcpMode = useCallback((value: string | undefined) => { saveAcpMode(value); setAcpModeState(value); }, [saveAcpMode]);
  const appliedRequestedAcpModeRef = useRef<string | undefined>(undefined);
  const persistSelection = !input.threadId;

  const setModel = useCallback((value: string) => {
    saveModel(value);
    setModelState(value);
    rememberComposerSelection({ providerId, model: value, reasoningLevel });
  }, [providerId, reasoningLevel, saveModel]);

  const setReasoningLevel = useCallback((value: ReasoningLevel) => {
    saveReasoning(value);
    setReasoningLevelState(value);
    rememberComposerSelection({ providerId, model, reasoningLevel: value });
  }, [model, providerId, saveReasoning]);

  const setProviderId = useCallback((value: string) => {
    if (value === providerId) return;
    rememberComposerSelection({ providerId, model, reasoningLevel });
    setProviderIdState(value);
    saveProvider(value);
    const restored = restoreProviderSelection(value);
    setModelState(restored.model);
    setReasoningLevelState(restored.reasoningLevel);
    // The restored values are defaults, not picks: clear the explicit choices so
    // the new provider's catalog can reconcile model, reasoning and native role.
    clearModel();
    clearReasoning();
    clearAcpMode();
    setAcpModeState(undefined);
    rememberComposerSelection({
      providerId: value,
      model: restored.model,
      reasoningLevel: restored.reasoningLevel
    });
  }, [model, providerId, reasoningLevel, saveProvider, clearModel, clearReasoning, clearAcpMode]);

  useEffect(() => {
    if (hasProvider && !input.lockedProviderId && savedProvider) setProviderIdState(savedProvider);
    if (hasModel) setModelState(savedModel ?? '');
    if (hasReasoning && savedReasoning) setReasoningLevelState(savedReasoning);
    if (hasAcpMode) setAcpModeState(savedAcpMode);
  }, [hasProvider, input.lockedProviderId, savedProvider, hasModel, savedModel, hasReasoning, savedReasoning, hasAcpMode, savedAcpMode]);

  const refreshModels = useCallback(() => hostCatalog.refresh(providerId), [hostCatalog, providerId]);

  useEffect(() => {
    if (input.lockedProviderId) setProviderIdState(input.lockedProviderId);
  }, [input.lockedProviderId]);

  useEffect(() => {
    if (input.initialModel && !hasModel) setModelState(input.initialModel);
    if (input.initialReasoningLevel && !hasReasoning) {
      setReasoningLevelState(asReasoningLevel(input.initialReasoningLevel, 'medium'));
    }
  }, [input.initialModel, input.initialReasoningLevel, hasModel, hasReasoning]);

  useEffect(() => {
    // Adopt the existing thread's persisted native role once the fetch resolves,
    // so the picker shows the mode the thread is actually running (not neutral).
    // This effect only re-fires when `initialAcpMode` itself changes value, which
    // only happens once the caller's fetch for the CURRENT thread resolves (an
    // unresolved/pending render repeats the same value, so no spurious re-fire
    // clobbers a pick the user already made this session). Unconditional so a
    // thread reused with a persisted mode of `null` (explicit "no role") clears a
    // previous thread's mode instead of leaving it selected.
    if (!hasAcpMode) setAcpModeState(input.initialAcpMode ?? undefined);
  }, [input.initialAcpMode, hasAcpMode]);

  useEffect(() => {
    if (input.hostPending) return;
    void hostCatalog.ensure();
  }, [hostCatalog, input.hostPending]);

  const providerLocked = Boolean(input.threadId || input.lockedProviderId);
  const providers = useMemo(() => composerProvidersFromCatalog(
    catalog.providers,
    providerLocked,
    providerId
  ), [catalog.providers, providerLocked, providerId]);
  const rosterReady = catalog.providers.length > 0 || Boolean(input.threadId || input.lockedProviderId);
  const registeredProviderIds = catalog.providers.map((row) => row.id);
  const cached = catalog.byProvider[providerId];
  const models = cached?.models ?? fallbackModelsForProvider(providerId);
  const moreModels = cached?.selectedOnlyModels ?? fallbackMoreModelsForProvider(providerId);
  const loading = Boolean(input.hostPending) || (!cached && catalog.inflight.has(providerId));
  // Warm rows inherited from another project stay visible, but are not
  // authoritative enough to snap a model or report a saved choice as unavailable.
  const settling = loading || catalog.provisionalProviders.has(providerId);
  const modelLoadError = cached?.modelLoadError ?? null;
  const modelLoadErrorDetail = cached?.modelLoadErrorDetail ?? null;
  const acpModeOptions = cached?.acpMode?.options ?? [];

  useEffect(() => {
    if (input.hostPending || cached) return;
    void hostCatalog.ensureProvider(providerId);
  }, [hostCatalog, input.hostPending, providerId, cached]);

  useEffect(() => {
    appliedRequestedAcpModeRef.current = undefined;
  }, [input.threadId]);

  useEffect(() => {
    if (hasAcpMode) return;
    const requested = input.initialAcpMode?.trim() || undefined;
    const requestedValid = Boolean(
      requested && acpModeOptions.some((option) => option.value === requested)
    );
    if (requestedValid && requested !== appliedRequestedAcpModeRef.current) {
      appliedRequestedAcpModeRef.current = requested;
      if (acpMode !== requested) setAcpModeState(requested);
      return;
    }

    // Existing threads: never auto-seed or reset the native role. There is NO
    // per-thread source for the running mode (the catalog `currentValue` is a
    // sessionless provider probe, always the default e.g. `build`), so seeding it
    // would (1) mislead the picker into showing a mode the thread may not be
    // running and (2) force that default onto every follow-up turn, silently
    // resetting a thread launched under another role. Leave acpMode undefined
    // until the user explicitly picks; an omitted acpMode leaves the running mode
    // untouched. Only a NEW thread seeds the provider default at compose time.
    if (input.threadId) return;
    const next = nextAcpModeSelection({
      current: cached?.acpMode?.currentValue,
      selected: acpMode,
      options: acpModeOptions
    });
    if (next !== undefined && next !== acpMode) setAcpModeState(next);
  }, [hasAcpMode, input.threadId, acpMode, acpModeOptions, cached?.acpMode?.currentValue, input.initialAcpMode]);

  useEffect(() => {
    if (input.threadId || input.lockedProviderId || hasProvider) return;
    if (catalog.providers.length === 0) return;
    const next = snapNewThreadProviderId(
      catalog.providers.map((row) => row.id),
      providerId,
      input.preferredProviderId
    );
    if (!next) return;
    setProviderIdState(next);
    const restored = restoreProviderSelection(next);
    setModelState(restored.model);
    setReasoningLevelState(restored.reasoningLevel);
    rememberComposerSelection({
      providerId: next,
      model: restored.model,
      reasoningLevel: restored.reasoningLevel
    });
  }, [hasProvider, input.threadId, input.lockedProviderId, input.preferredProviderId, catalog.providers, providerId]);

  const activeModel = useMemo(
    () => {
      const offered = models.concat(moreModels);
      return offered.find((row) => row.model === model) ?? defaultOfferedComposerModel(models, moreModels);
    },
    [model, models, moreModels]
  );

  useEffect(() => {
    if (hasModel) return;
    const offeredRows = models.concat(moreModels);
    const offeredIds = offeredRows.map((row) => row.model);
    if (offeredIds.length === 0) {
      if (!settling && model) setModelState('');
      return;
    }
    const fallback = defaultOfferedComposerModel(models, moreModels)?.model ?? offeredIds[0]!;
    const nextModel = preferredComposerModel({
      rememberedModel: persistSelection ? rememberedSelectionFor(providerId)?.model : undefined,
      currentModel: model,
      persistRemembered: persistSelection,
      offeredModels: offeredIds,
      fallbackModel: fallback,
      loading: settling
    });
    if (!nextModel) return;
    if (nextModel !== model) setModelState(nextModel);
    rememberComposerSelection({ providerId, model: nextModel, reasoningLevel });
  }, [hasModel, settling, model, models, moreModels, persistSelection, providerId, reasoningLevel]);

  // Reasoning reconciles independently: an explicitly picked model must still
  // snap a defaulted reasoning level onto what that model supports.
  useEffect(() => {
    if (hasReasoning || !activeModel) return;
    const supported = visibleComposerReasoningLevels(
      activeModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
    );
    if (supported.length === 0) return;
    const next = reconcileReasoningLevel(reasoningLevel, supported);
    if (next !== reasoningLevel) setReasoningLevelState(next);
  }, [hasReasoning, activeModel, reasoningLevel]);

  const providerOptions: PickerOption<string>[] = providers.map((row) => ({
    value: row.id,
    label: row.displayName
  }));
  const modelOptions: ModelPickerOption[] = availableModelsToPickerOptions(models);
  const moreModelOptions: ModelPickerOption[] = availableModelsToPickerOptions(moreModels);
  const reasoningOptions: PickerOption<ReasoningLevel>[] = visibleComposerReasoningLevels(
    (activeModel?.supportedReasoningEfforts ?? []).map((effort) => effort.reasoningEffort)
  ).map((level) => ({
    value: level,
    label: REASONING_LABELS[level]
  }));
  const provider = providers.find((row) => row.id === providerId) ?? providers[0];
  const selectionError = settling || !cached
    ? null
    : hasModel && model && !models.concat(moreModels).some(row => row.model === model)
      ? 'The saved model is unavailable. Choose an available model before sending.'
      : hasAcpMode && acpMode && !acpModeOptions.some(row => row.value === acpMode)
        ? 'The saved role is unavailable. Choose an available role before sending.'
        : hasReasoning && reasoningOptions.length > 0 && !reasoningOptions.some(row => row.value === reasoningLevel)
          ? 'The saved reasoning level is unavailable. Choose an available level before sending.'
          : null;

  return {
    providers,
    provider,
    providerId,
    setProviderId,
    providerOptions,
    rosterReady,
    registeredProviderIds,
    model,
    setModel,
    acpMode,
    setAcpMode,
    acpModeOptions,
    refreshAcpModeOptions: refreshModels,
    refreshModels,
    modelOptions,
    moreModelOptions,
    modelIsLoading: loading,
    /** The provider's own discovery result is in, so saved choices can be validated. */
    catalogSettled: Boolean(cached) && !settling,
    modelLoadError,
    modelLoadErrorDetail,
    reasoningLevel,
    setReasoningLevel,
    reasoningOptions,
    serviceTierOptions: catalog.providers.find(row => row.id === providerId)?.serviceTiers ?? [],
    selectionError
  };
}
