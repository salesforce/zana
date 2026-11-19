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
  fallbackProviderOption,
  fallbackModelsForProvider,
  fallbackMoreModelsForProvider,
  type ThreadComposerProviderOption
} from './fallback-models.js';
import {
  defaultOfferedComposerModel,
  preferredComposerModel,
  rememberComposerSelection,
  rememberedSelectionFor
} from './composer-selection-preference.js';
import { threadModelCatalogForHost } from './thread-model-catalog.js';
import { nextAcpModeSelection } from './acp-mode-selection.js';
import { useComposerSession, useComposerSetting } from '../../composer/ComposerDraft.js';
import { isEmptyComposerDocument, type ComposerSession } from '../../composer/composer-session.js';

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
  /**
   * An existing thread's own project/host isn't known yet, so hostId/projectId point at the
   * previously selected scope. That catalog is settled but not the thread's: don't validate.
   */
  scopePending?: boolean;
}) {
  const fallbackSession = useComposerSession();
  const session = input.session ?? fallbackSession;
  const [savedProvider, saveProvider, hasProvider, clearProvider] = useComposerSetting<string | undefined>(session, 'modern.provider', undefined);
  const [draftProvider, saveDraftProvider, , clearDraftProvider] = useComposerSetting<string | undefined>(session, 'modern.draftProvider', undefined);
  const draft = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const hasContent = !isEmptyComposerDocument(draft.document) || draft.images.length > 0 || draft.attachments.length > 0;
  const initialProvider = input.lockedProviderId ?? savedProvider ?? (hasContent ? draftProvider : undefined) ?? input.preferredProviderId ?? 'claude-code';
  const [savedModel, saveModel, hasModel, clearModel] = useComposerSetting<string | undefined>(session, 'modern.model', undefined);
  const [savedReasoning, saveReasoning, hasReasoning, clearReasoning] = useComposerSetting<ReasoningLevel | undefined>(session, 'modern.reasoning', undefined);
  const [savedAcpMode, saveAcpMode, hasAcpMode, clearAcpMode] = useComposerSetting<string | undefined>(session, 'modern.acpMode', undefined);
  const hostCatalog = threadModelCatalogForHost(input.hostId, input.projectId);
  const catalog = useSyncExternalStore(hostCatalog.subscribe, hostCatalog.getSnapshot, hostCatalog.getSnapshot);
  const [providerId, setProviderIdState] = useState(
    () => initialProvider
  );
  const [model, setModelState] = useState(() => {
    if (hasModel) return savedModel ?? '';
    if (input.initialModel) return input.initialModel;
    return restoreProviderSelection(initialProvider).model;
  });
  const [reasoningLevel, setReasoningLevelState] = useState<ReasoningLevel>(() => {
    if (hasReasoning) return savedReasoning ?? 'medium';
    if (input.initialReasoningLevel) {
      return asReasoningLevel(input.initialReasoningLevel, 'medium');
    }
    return restoreProviderSelection(initialProvider).reasoningLevel;
  });
  const [acpMode, setAcpModeState] = useState<string | undefined>(() => hasAcpMode ? savedAcpMode : input.initialAcpMode ?? undefined);
  const setAcpMode = useCallback((value: string | undefined) => {
    if (!input.threadId) saveProvider(providerId);
    saveAcpMode(value); setAcpModeState(value);
  }, [input.threadId, providerId, saveProvider, saveAcpMode]);
  const appliedRequestedAcpModeRef = useRef<string | undefined>(undefined);
  const persistSelection = !input.threadId;

  const setModel = useCallback((value: string) => {
    if (!input.threadId) saveProvider(providerId);
    saveModel(value);
    setModelState(value);
    rememberComposerSelection({ providerId, model: value, reasoningLevel, rememberProvider: false });
  }, [input.threadId, providerId, reasoningLevel, saveModel, saveProvider]);

  const setReasoningLevel = useCallback((value: ReasoningLevel) => {
    if (!input.threadId) saveProvider(providerId);
    saveReasoning(value);
    setReasoningLevelState(value);
    rememberComposerSelection({ providerId, model, reasoningLevel: value, rememberProvider: false });
  }, [input.threadId, model, providerId, saveReasoning, saveProvider]);

  const setProviderId = useCallback((value: string) => {
    if (value === providerId) return;
    rememberComposerSelection({ providerId, model, reasoningLevel, rememberProvider: false });
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
      reasoningLevel: restored.reasoningLevel,
      rememberProvider: false
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
  const settling = loading || Boolean(input.scopePending) || catalog.provisionalProviders.has(providerId);
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
    if (input.threadId || input.lockedProviderId) return;
    if (hasContent && !draftProvider) saveDraftProvider(providerId);
    if (!hasContent && draftProvider) clearDraftProvider();
    // An explicit choice or unsent draft belongs to this composer alone.
    const next = savedProvider ?? (hasContent ? draftProvider ?? providerId : undefined)
      ?? input.preferredProviderId ?? catalog.providers[0]?.id ?? 'claude-code';
    if (next === providerId) return;
    setProviderIdState(next);
    const restored = restoreProviderSelection(next);
    setModelState(restored.model);
    setReasoningLevelState(restored.reasoningLevel);
    setAcpModeState(undefined);
  }, [session, hasContent, draftProvider, saveDraftProvider, clearDraftProvider, savedProvider, input.threadId, input.lockedProviderId, input.preferredProviderId, catalog.providers, providerId]);

  const useDefaultProvider = useCallback(() => {
    clearProvider();
    clearDraftProvider();
    clearModel();
    clearReasoning();
    clearAcpMode();
    const next = input.preferredProviderId ?? catalog.providers[0]?.id ?? 'claude-code';
    if (hasContent) saveDraftProvider(next);
    setProviderIdState(next);
    const restored = restoreProviderSelection(next);
    setModelState(restored.model);
    setReasoningLevelState(restored.reasoningLevel);
    setAcpModeState(undefined);
  }, [clearProvider, clearDraftProvider, clearModel, clearReasoning, clearAcpMode, input.preferredProviderId, catalog.providers, hasContent, saveDraftProvider]);

  const resetForNewThread = useCallback(() => {
    // A pending send owns its submitted choices, not a later pick for the next draft.
    const current = session.getSnapshot().settings;
    if (current['modern.provider'] !== savedProvider || current['modern.model'] !== savedModel
      || current['modern.reasoning'] !== savedReasoning || current['modern.acpMode'] !== savedAcpMode) return;
    clearProvider(); clearDraftProvider(); clearModel(); clearReasoning(); clearAcpMode();
    setAcpModeState(undefined);
  }, [session, savedProvider, savedModel, savedReasoning, savedAcpMode, clearProvider, clearDraftProvider, clearModel, clearReasoning, clearAcpMode]);

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
    rememberComposerSelection({ providerId, model: nextModel, reasoningLevel, rememberProvider: false });
  }, [hasModel, settling, model, models, moreModels, persistSelection, providerId, reasoningLevel]);

  // Reasoning reconciles independently: an explicitly picked model must still
  // snap a defaulted reasoning level onto what that model supports.
  useEffect(() => {
    if (hasReasoning || !activeModel) return;
    const supported = visibleComposerReasoningLevels(
      activeModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
    );
    if (supported.length === 0) return;
    // Discovery may temporarily show a default model with fewer levels. Keep
    // the thread's inherited preference until the user picks a model or level.
    const preferred = !hasModel && input.initialReasoningLevel
      ? asReasoningLevel(input.initialReasoningLevel, reasoningLevel)
      : reasoningLevel;
    const next = reconcileReasoningLevel(preferred, supported);
    if (next !== reasoningLevel) setReasoningLevelState(next);
  }, [hasReasoning, hasModel, input.initialReasoningLevel, activeModel, reasoningLevel]);

  const providerOptions: PickerOption<string>[] = providers.map((row) => ({
    value: row.id,
    label: row.displayName
  }));
  if (!providerOptions.some(row => row.value === providerId)) {
    providerOptions.push({ value: providerId, label: `${fallbackProviderOption(providerId).displayName} (unavailable)` });
  }
  const modelOptions: ModelPickerOption[] = availableModelsToPickerOptions(models);
  const moreModelOptions: ModelPickerOption[] = availableModelsToPickerOptions(moreModels);
  const reasoningOptions: PickerOption<ReasoningLevel>[] = visibleComposerReasoningLevels(
    (activeModel?.supportedReasoningEfforts ?? []).map((effort) => effort.reasoningEffort)
  ).map((level) => ({
    value: level,
    label: REASONING_LABELS[level]
  }));
  const provider = useMemo(() => providers.find((row) => row.id === providerId) ?? fallbackProviderOption(providerId), [providers, providerId]);
  const providerUnavailable = !input.threadId && !input.hostPending && !settling && (modelLoadError === 'provider_unavailable'
    || (catalog.rosterReady && !catalog.rosterError && !registeredProviderIds.includes(providerId)));
  const selectionError = providerUnavailable
    ? 'The selected harness is unavailable on this machine. Choose an available harness or change the thread default in Settings.'
    : settling || !cached
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
    useDefaultProvider,
    resetForNewThread,
    providerSelectionSource: hasProvider ? 'choice' as const : hasContent && draftProvider ? 'draft' as const : 'default' as const,
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
