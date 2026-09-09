import { product } from '../lib/product-client.js';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Folder, Loader2, Mic, Paperclip } from 'lucide-react';
import type { HarnessAdapterDescriptor, HarnessModelTarget } from '@zana-ai/zcc-domain/harness-adapter';
import type {
  EffectiveHarnessDefaultResult,
  HarnessFamily,
  HarnessModelRoutingV1,
  LaunchProfileId,
  Project,
  TerminalSession
} from '@zana-ai/zcc-domain/product';
import { buildLaunchArgs } from './AgentLauncher.js';
import { agentCardRuntimeLabel } from './fleet-item.js';
import { EnvironmentPicker, defaultWorkspaceChoice, type WorkspacePickerValue } from './EnvironmentPicker.js';
import {
  CommandComposer,
  ComposerIconButton,
  ComposerToolbar
} from './ui/CommandComposer.js';
import { VoiceRecordingBar } from './thread/voice/VoiceRecordingBar.js';
import { useVoiceInput } from './thread/voice/useVoiceInput.js';
import { useData, usePersonas, useUi } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { posixQuote } from '../lib/quote.js';
import { attachmentName } from '../lib/attachments.js';
import { persistComposerImages } from '../lib/prompt-attachments.js';
import { ComposerProjectPicker } from './ComposerProjectPicker.js';
import {
  composerProjectOptions,
  isRemoteWorkspaceProject,
  resolveComposerProjectId,
  type ComposerProjectSelectionProps
} from './composer-project-default.js';
import { ModelReasoningPicker } from './thread/pickers/ModelReasoningPicker.js';
import { NativeRolePicker } from './thread/pickers/NativeRolePicker.js';
import { ComposerModePicker } from './thread/pickers/ComposerModePicker.js';
import { consumeComposerModeCycle, type ComposerWorkMode } from './thread/pickers/composer-mode.js';
import { PluginComposerChrome } from '../plugins/PluginComposerChrome.js';
import { PluginComposerAdvanced, PluginComposerMeta } from '../plugins/PluginComposerSlots.js';
import {
  getMergedLaunchPatch,
  subscribeLaunchPatches
} from '../plugins/plugin-composer-api.js';
import { ComposerPromptField } from './composer/ComposerPromptField.js';
import { useComposerPromptField } from './composer/use-composer-prompt-field.js';
import { composerProvidersFromCatalog, fallbackProviderOption } from './thread/pickers/fallback-models.js';
import { permissionModeOptionsFor } from './thread/pickers/permission-mode-options.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { TextArgsField } from './settings/FormFields.js';
import {
  assembleCliLaunchPrompt,
  availableAgentHarnesses,
  applyLaunchPatch,
  cliAgentCatalogProviders,
  cliAgentFamilyIdsFromCatalog,
  cliAgentModelOptions,
  cliAgentMoreModelOptions,
  CLI_WORK_MODES,
  cliComposerModeChip,
  cliLaunchExecutionState,
  cliLaunchFromPermissionMode,
  cliPermissionModesFor,
  composerDropProjectRoot,
  familyForThreadProviderId,
  PROFILE_BY_FAMILY,
  readCliExtraArgs,
  resolveCliAgentFamily,
  resolveCliLaunchProfile,
  stageRemoteComposerAttachments,
  threadProviderIdForFamily,
  unrestrictedProfileId,
  withExecutionState,
  writeCliExtraArgs
} from './legacy-agent-home.js';
import {
  pickOfferedComposerModel,
  rememberComposerSelection,
  rememberedProviderId,
  rememberedSelectionFor
} from './thread/pickers/composer-selection-preference.js';
import {
  ensureThreadProviderModels,
  getThreadModelCatalog,
  prefetchThreadModelCatalog,
  reloadThreadProviderModels,
  setThreadModelCatalogHost,
  subscribeThreadModelCatalog
} from './thread/pickers/thread-model-catalog.js';
import { defaultHostId, useHosts } from '../hooks/useHosts.js';

const EMPTY_MODELS: readonly HarnessModelTarget[] = [];

/**
 * Home PTY launch surface. Thread create stays in ThreadCommandComposer;
 * this file is the only home-page caller of `createTerminal`.
 */
export function LegacyAgentHomeComposer({
  project: pinnedProject,
  composerProjectId,
  onComposerProjectIdChange,
  initialText,
  onLaunched,
  onClose
}: {
  project?: Project;
  initialText?: string;
  onLaunched?: (session: TerminalSession, projectId: string) => void;
  onClose?: () => void;
} & ComposerProjectSelectionProps) {
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const createTerminal = useData((s) => s.createTerminal);
  const worktreeIsolationDefault = useData((s) => s.worktreeIsolationDefault);
  const personas = usePersonas(useShallow((s) => s.personas));
  const defaultHarness = useData((s) => s.defaultHarness);
  const harnessCursorEnabled = useData((s) => s.harnessCursorEnabled);
  const harnessCodexEnabled = useData((s) => s.harnessCodexEnabled);
  const harnessPiEnabled = useData((s) => s.harnessPiEnabled);
  const harnessOpenCodeEnabled = useData((s) => s.harnessOpenCodeEnabled);
  const cliRemoteHostCatalogEnabled = useData((s) => s.cliRemoteHostCatalogEnabled);
  const selectTab = useUi((s) => s.selectTab);
  const pushToast = useUi((s) => s.pushToast);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const lastProjectId = useData((s) => s.lastProjectId);
  const [internalProjectId, setInternalProjectId] = useState(
    pinnedProject?.id ?? composerProjectId ?? ''
  );
  const projectId = pinnedProject?.id
    ?? (onComposerProjectIdChange ? (composerProjectId || internalProjectId) : internalProjectId);
  const setProjectId = (nextProjectId: string | ((current: string) => string)) => {
    const resolved = typeof nextProjectId === 'function' ? nextProjectId(projectId) : nextProjectId;
    if (!onComposerProjectIdChange) setInternalProjectId(resolved);
    onComposerProjectIdChange?.(resolved);
  };
  const preferredProjectId = selectedProjectId ?? lastProjectId;
  const [familyId, setFamilyId] = useState<HarnessFamily | ''>('');
  const [automaticProfile, setAutomaticProfile] = useState<LaunchProfileId | null>(null);
  const [selectionState, setSelectionState] = useState<'loading' | 'resolved' | 'unavailable'>('loading');
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [selectionProvenance, setSelectionProvenance] = useState<'automatic' | 'explicit'>('automatic');
  const [modelId, setModelId] = useState('');
  // OpenCode native-role selection (`--agent <role>`). Roles come from the SAME
  // ACP session-mode list the Modern composer uses (`catalogEntry.acpMode`), so
  // both surfaces show an identical, plain-named list. Non-opencode harnesses
  // have no role axis.
  const [roleTargetId, setRoleTargetId] = useState<string | undefined>(undefined);
  const [descriptors, setDescriptors] = useState<HarnessAdapterDescriptor[]>([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePickerValue>(() => defaultWorkspaceChoice(false));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [extraArgs, setExtraArgs] = useState<string[]>([]);
  const [personaId, setPersonaId] = useState('');
  const [permissionMode, setPermissionMode] = useState('accept-edits');
  const [workMode, setWorkMode] = useState<ComposerWorkMode>('agent');
  const launchPatch = useSyncExternalStore(
    subscribeLaunchPatches,
    getMergedLaunchPatch,
    getMergedLaunchPatch
  );
  const ensureScratchRef = useRef(false);
  const selectionGeneration = useRef(0);
  const descriptorGeneration = useRef(0);
  const launchRef = useRef<() => void>(() => undefined);
  const launchProjects = useMemo(() => composerProjectOptions(projects), [projects]);
  const harnesses = useMemo(() => availableAgentHarnesses(descriptors), [descriptors]);
  const harnessesRef = useRef(harnesses);
  const familyIdRef = useRef(familyId);
  harnessesRef.current = harnesses;
  familyIdRef.current = familyId;
  const project = pinnedProject ?? launchProjects.find((candidate) => candidate.id === projectId);
  const hosts = useHosts();
  const executionHostId = defaultHostId(hosts, project);
  const selectedHarness = harnesses.find((descriptor) => descriptor.id === familyId);
  const unrestrictedId = unrestrictedProfileId(selectedHarness?.profiles);

  useEffect(() => {
    setExtraArgs(readCliExtraArgs(familyId));
    setWorkMode('agent');
  }, [familyId]);
  const cliRuntimeProfile = automaticProfile
    ?? selectedHarness?.defaultProfileId
    ?? (familyId ? PROFILE_BY_FAMILY[familyId] : 'claude');
  const catalog = useSyncExternalStore(
    subscribeThreadModelCatalog,
    getThreadModelCatalog,
    getThreadModelCatalog
  );
  const selectedProviderId = (familyId && threadProviderIdForFamily(familyId)) || '';
  const catalogEntry = selectedProviderId ? catalog.byProvider[selectedProviderId] : undefined;
  const catalogPermissionModes = useMemo(() => {
    const fromCatalog = catalog.providers.find((row) => row.id === selectedProviderId)?.permissionModes;
    if (fromCatalog && fromCatalog.length > 0) return fromCatalog;
    return selectedProviderId ? fallbackProviderOption(selectedProviderId).permissionModes : [];
  }, [catalog.providers, selectedProviderId]);
  const permissionModeIds = useMemo(
    () => cliPermissionModesFor({
      catalogModes: catalogPermissionModes,
      hasUnrestrictedProfile: Boolean(unrestrictedId)
    }),
    [catalogPermissionModes, unrestrictedId]
  );
  const permissionOptions = permissionModeOptionsFor(permissionModeIds);
  const preferHostModels = cliRemoteHostCatalogEnabled && isRemoteWorkspaceProject(project);
  const models = cliAgentModelOptions({
    adapterModels: selectedHarness?.targets?.models ?? EMPTY_MODELS,
    catalogModels: catalogEntry?.models ?? [],
    preferCatalog: preferHostModels,
    catalogReady: Boolean(catalogEntry)
  });
  const moreModelOptions = cliAgentMoreModelOptions({
    adapterModelCount: selectedHarness?.targets?.models?.length ?? 0,
    catalogMoreModels: catalogEntry?.selectedOnlyModels ?? [],
    preferCatalog: preferHostModels
  });
  const catalogModelsLoading = Boolean(
    selectedProviderId
    && (preferHostModels || (selectedHarness?.targets?.models?.length ?? 0) === 0)
    && (catalog.inflight.has(selectedProviderId) || !catalogEntry)
  );
  const offeredModelIds = useMemo(() => {
    const ids = models.map((model) => model.id);
    if (!preferHostModels && (selectedHarness?.targets?.models?.length ?? 0) > 0) return ids;
    for (const row of catalogEntry?.selectedOnlyModels ?? []) {
      if (!ids.includes(row.model)) ids.push(row.model);
    }
    return ids;
  }, [catalogEntry?.selectedOnlyModels, models, preferHostModels, selectedHarness?.targets?.models]);
  // OpenCode native roles = the ACP session-mode list (identical to Modern).
  const roleOptions = familyId === 'opencode'
    ? catalogEntry?.acpMode?.options ?? []
    : [];
  const modeChip = cliComposerModeChip(familyId);

  const field = useComposerPromptField({
    placeholder: 'Describe the task… Leave empty to open an interactive session',
    testId: 'legacy-agent-command-input',
    ariaLabel: 'Instruction for the CLI agent',
    projectId,
    projectRoot: composerDropProjectRoot(project),
    projects,
    disabled: launching,
    initialText,
    slashCatalog: { kind: 'cli' },
    onSubmit: () => {
      launchRef.current();
    },
    interceptKeyDown: (event) => {
      if (modeChip === 'native-role') {
        return consumeComposerModeCycle(event, {
          kind: 'native',
          options: roleOptions,
          current: roleTargetId,
          onChange: setRoleTargetId
        });
      }
      if (modeChip === 'work-mode') {
        return consumeComposerModeCycle(event, {
          kind: 'work',
          modes: CLI_WORK_MODES,
          current: workMode,
          onChange: setWorkMode
        });
      }
      return false;
    },
    onError: setError
  });
  const voice = useVoiceInput({ onTranscript: field.insertText });
  const voiceBusy = voice.state === 'recording' || voice.state === 'transcribing';

  useEffect(() => {
    if (cliRemoteHostCatalogEnabled) {
      void setThreadModelCatalogHost(executionHostId);
      return;
    }
    void prefetchThreadModelCatalog();
  }, [cliRemoteHostCatalogEnabled, executionHostId]);

  useEffect(() => {
    if (selectedProviderId) void ensureThreadProviderModels(selectedProviderId);
  }, [selectedProviderId]);

  // Keep the role pick coherent with the ACP mode list (same discipline as the
  // Modern composer): seed from `acpMode.currentValue` when unset, and drop a
  // selection the freshly-loaded list no longer offers.
  useEffect(() => {
    if (familyId !== 'opencode') {
      if (roleTargetId) setRoleTargetId(undefined);
      return;
    }
    const options = catalogEntry?.acpMode?.options;
    if (!options) return;
    if (roleTargetId && !options.some((option) => option.value === roleTargetId)) {
      setRoleTargetId(catalogEntry?.acpMode?.currentValue);
      return;
    }
    if (!roleTargetId && catalogEntry?.acpMode?.currentValue) {
      setRoleTargetId(catalogEntry.acpMode.currentValue);
    }
  }, [familyId, catalogEntry?.acpMode, roleTargetId]);

  useEffect(() => {
    if (permissionModeIds.length > 0 && !permissionModeIds.includes(permissionMode)) {
      setPermissionMode(permissionModeIds[0]!);
    }
  }, [permissionMode, permissionModeIds]);

  useEffect(() => {
    const generation = ++descriptorGeneration.current;
    void product.harness.descriptors().then((next) => {
      if (generation !== descriptorGeneration.current) return;
      setDescriptors(next);
    }).catch(() => {
      if (generation !== descriptorGeneration.current) return;
      setDescriptors([]);
    });
  }, [harnessCursorEnabled, harnessCodexEnabled, harnessPiEnabled, harnessOpenCodeEnabled]);

  useEffect(() => {
    if (pinnedProject) {
      setProjectId(pinnedProject.id);
      return;
    }
    const nextId = resolveComposerProjectId(projects, projectId, undefined, preferredProjectId);
    if (nextId && nextId !== projectId) {
      setProjectId(nextId);
      return;
    }
    if (nextId || ensureScratchRef.current) return;
    ensureScratchRef.current = true;
    let cancelled = false;
    void product.projects.ensureQuickAgent().then(async (result) => {
      if (cancelled || !result.ok) return;
      if (!useData.getState().projects.some((row) => row.id === result.value.id)) {
        await loadProjects();
      }
      if (!cancelled) setProjectId((current) => current || result.value.id);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadProjects, pinnedProject, preferredProjectId, projectId, projects]);

  useEffect(() => {
    if (!project) return;
    setWorkspace(
      project.quickAgent || project.remote
        ? { kind: 'personal' }
        : defaultWorkspaceChoice(worktreeIsolationDefault)
    );
  }, [project?.id, project?.quickAgent, project?.remote, worktreeIsolationDefault]);

  // Resolve a concrete model like the Modern composer instead of resting on
  // "Select model": keep a still-valid pick, otherwise adopt the remembered or
  // default model for the provider. Clears only when no models are offered.
  useEffect(() => {
    if (selectionState !== 'resolved' || catalogModelsLoading) return;
    const next = pickOfferedComposerModel({
      rememberedModel: selectedProviderId ? rememberedSelectionFor(selectedProviderId)?.model : undefined,
      currentModel: modelId,
      offeredModels: offeredModelIds
    });
    if (next !== modelId) setModelId(next);
    if (next && selectedProviderId) {
      rememberComposerSelection({ providerId: selectedProviderId, model: next });
    }
  }, [catalogModelsLoading, modelId, offeredModelIds, selectedProviderId, selectionState]);

  // Default the harness like the Modern composer: keep the current pick, else
  // the last-used (remembered) family, else the project's effective default —
  // all filtered to installed harnesses via resolveCliAgentFamily.
  useEffect(() => {
    if (!projectId) return;
    const generation = ++selectionGeneration.current;
    const availableFamilyIds: string[] = cliRemoteHostCatalogEnabled
      ? (catalog.providers.length > 0 ? cliAgentFamilyIdsFromCatalog(catalog.providers) : [])
      : harnesses.map((row) => row.id);
    const rememberedFamily = familyForThreadProviderId(rememberedProviderId() ?? '');
    const currentFamilyId = familyIdRef.current;
    const kept = resolveCliAgentFamily({
      currentFamilyId,
      availableFamilyIds,
      rememberedFamilyId: rememberedFamily,
      effectiveDefaultFamilyId: null
    });
    if (kept && (availableFamilyIds.length === 0 || availableFamilyIds.includes(kept))) {
      if (kept !== currentFamilyId) {
        setFamilyId(kept as HarnessFamily);
        if (kept === rememberedFamily) {
          setSelectionProvenance('explicit');
          setAutomaticProfile(null);
          const providerId = threadProviderIdForFamily(kept);
          const restored = providerId ? rememberedSelectionFor(providerId)?.model ?? '' : '';
          if (restored) setModelId(restored);
        }
      }
      if (availableFamilyIds.length > 0) {
        setSelectionState('resolved');
        setResolvedProjectId(projectId);
        setSelectionMessage(null);
        return;
      }
    }

    if (!currentFamilyId && !kept) setSelectionState('loading');
    void product.harness.effectiveDefault(projectId).then((result: EffectiveHarnessDefaultResult) => {
      if (generation !== selectionGeneration.current) return;
      const liveIds = cliRemoteHostCatalogEnabled
        ? (catalog.providers.length > 0 ? cliAgentFamilyIdsFromCatalog(catalog.providers) : [])
        : harnessesRef.current.map((row) => row.id);
      const currentFamily = familyIdRef.current;
      const remembered = familyForThreadProviderId(rememberedProviderId() ?? '');
      const nextFamily = resolveCliAgentFamily({
        currentFamilyId: currentFamily,
        availableFamilyIds: liveIds,
        rememberedFamilyId: remembered,
        effectiveDefaultFamilyId: result.ok ? result.family : null
      });
      if (!nextFamily) {
        setSelectionState('unavailable');
        setSelectionMessage(result.ok ? 'Default harness unavailable' : result.message);
        return;
      }
      if (nextFamily !== currentFamily) {
        setFamilyId(nextFamily as HarnessFamily);
        if (nextFamily === remembered) {
          setSelectionProvenance('explicit');
          setAutomaticProfile(null);
          const providerId = threadProviderIdForFamily(nextFamily);
          const restored = providerId ? rememberedSelectionFor(providerId)?.model ?? '' : '';
          if (restored) setModelId(restored);
        } else {
          setSelectionProvenance('automatic');
          setAutomaticProfile(result.ok ? result.profile : null);
        }
      } else if (result.ok && nextFamily === result.family) {
        setAutomaticProfile((current) => current ?? result.profile);
      }
      setSelectionState('resolved');
      setResolvedProjectId(projectId);
      setSelectionMessage(null);
    }).catch(() => {
      if (generation !== selectionGeneration.current) return;
      if (familyIdRef.current) {
        setSelectionState('resolved');
        setResolvedProjectId(projectId);
        return;
      }
      setSelectionState('unavailable');
      setSelectionMessage('Default harness unavailable');
    });
  }, [
    projectId,
    harnesses,
    project?.launchDefault,
    project?.defaultAgents,
    project?.defaultPersonas,
    personas,
    defaultHarness,
    harnessCursorEnabled,
    harnessCodexEnabled,
    harnessPiEnabled,
    harnessOpenCodeEnabled,
    cliRemoteHostCatalogEnabled,
    catalog.providers
  ]);

  const canLaunch = Boolean(
    project
    && familyId
    && selectionState === 'resolved'
    && resolvedProjectId === projectId
    && (selectionProvenance !== 'explicit'
      || selectedHarness
      || (cliRemoteHostCatalogEnabled && Boolean(PROFILE_BY_FAMILY[familyId])))
    && !launching
  );

  const launch = async () => {
    if (!project || !familyId || launching || selectionState !== 'resolved' || resolvedProjectId !== projectId) return;
    if (selectionProvenance === 'explicit' && !selectedHarness
      && !(cliRemoteHostCatalogEnabled && PROFILE_BY_FAMILY[familyId])) return;
    if (field.typeaheadOpen) return;
    const profile = selectionProvenance === 'automatic'
      ? automaticProfile
      : selectedHarness?.defaultProfileId ?? PROFILE_BY_FAMILY[familyId];
    if (!profile) return;
    setError(null);
    setLaunching(true);
    try {
      const serialized = field.serialize();
      let promptText = serialized.text;
      let imagePaths: string[] = [];
      if (project.remote) {
        const staged = await stageRemoteComposerAttachments({
          promptText,
          mentions: serialized.mentions,
          images: field.images,
          projectId: project.id,
          uploadLocalPath: (localPath) => product.fs.uploadToRemote(project.id, localPath, '.'),
          persistImages: persistComposerImages,
          uploadPersistedAttachment: (relativePath) =>
            product.fs.uploadProjectAttachmentToRemote(project.id, relativePath),
          quoteRemotePath: posixQuote
        });
        if (!staged.ok) {
          pushToast(staged.message ?? `Failed to upload ${attachmentName(staged.localPath)}`, 'error');
          return;
        }
        for (const row of staged.uploaded) {
          pushToast(`Uploaded ${attachmentName(row.localPath)} to ${project.remote.host}`);
        }
        promptText = staged.promptText;
        imagePaths = staged.imagePaths;
      } else if (field.images.length > 0) {
        imagePaths = await persistComposerImages(project.id, field.images);
      }
      const launchedPrompt = assembleCliLaunchPrompt({ text: promptText, imagePaths });
      const args = buildLaunchArgs(
        launchedPrompt,
        selectedHarness?.label ?? familyId
      );
      const validModelId = offeredModelIds.includes(modelId) ? modelId : '';
      const validRoleId = familyId === 'opencode'
        && roleTargetId
        && roleOptions.some((role) => role.value === roleTargetId)
        ? roleTargetId
        : '';
      // A picked OpenCode native agent pins its OWN model. Forcing a catalog
      // `--model` alongside `--agent <role>` overrides that pin and dies with
      // ProviderModelNotFoundError on any install whose provider inventory
      // differs from the static `aisuite/*` snapshot (e.g. an `llmgw`-backed
      // setup) — the exit-64 dead-session bug. So a native role and a forced
      // model are mutually exclusive here: the role wins and carries no model.
      const adapterEntry = validRoleId
        ? { roleTargetId: validRoleId }
        : validModelId
          ? { modelTargetId: validModelId }
          : {};
      const coreRouting: HarnessModelRoutingV1 | undefined = Object.keys(adapterEntry).length
        ? { schemaVersion: 1, byAdapter: { [familyId]: adapterEntry } }
        : undefined;
      const permLaunch = permissionModeIds.includes(permissionMode)
        ? cliLaunchFromPermissionMode({
            mode: permissionMode,
            unrestrictedProfileId: unrestrictedId
          })
        : {};
      // OpenCode treats a native `--agent` role as the execution policy. Sending
      // Edits (`accept-edits`) alongside a role fails preflight with "require
      // one compatible role policy". Same XOR as role-vs-model above. Plan for
      // Claude/Cursor/Codex also XOR's Edits via cliLaunchExecutionState.
      const executionState = cliLaunchExecutionState({
        familyId,
        workMode: workMode === 'plan' ? 'plan' : 'agent',
        permissionExecutionState: permLaunch.executionState,
        hasNativeRole: Boolean(validRoleId),
        unrestrictedProfileSelected: Boolean(permLaunch.profileId)
      });
      const withState = executionState
        ? withExecutionState(coreRouting, familyId, executionState)
        : coreRouting;
      const merged = applyLaunchPatch({
        baseProfile: resolveCliLaunchProfile({
          baseProfile: profile,
          patchProfileId: permLaunch.profileId
        }),
        extraArgs,
        harnessRouting: withState,
        patch: launchPatch
      });

      const session = await createTerminal(project.id, merged.profile, 80, 24, {
        ...args,
        extraArgs: merged.extraArgs,
        harnessRouting: merged.harnessRouting,
        personaId: personaId || undefined,
        profileSource: selectionProvenance === 'automatic' ? 'seeded-default' : 'explicit',
        workspace: project.quickAgent ? { kind: 'personal' } : workspace,
        isolateScratch: project.quickAgent ? args.title || true : undefined,
        onError: setError
      });
      if (!session) return;
      field.clear();
      if (onLaunched) {
        onLaunched(session, project.id);
      } else {
        useUi.getState().enterProjectFocus(project.id);
        selectTab(project.id, session.id);
        if (!onClose) useUi.getState().openAgentModal(session.id, project.id);
      }
      onClose?.();
    } catch (err) {
      const message = `Agent launch failed: ${err instanceof Error ? err.message : String(err)}`;
      setError(message);
      pushToast(message, 'error');
    } finally {
      setLaunching(false);
    }
  };
  launchRef.current = () => {
    void launch();
  };

  const harnessProviderOptions = composerProvidersFromCatalog(
    cliRemoteHostCatalogEnabled
      ? cliAgentCatalogProviders(catalog.providers)
      : harnesses.flatMap((descriptor) => {
        const providerId = threadProviderIdForFamily(descriptor.id);
        if (!providerId) return [];
        const fallback = fallbackProviderOption(providerId);
        return [{
          id: providerId,
          displayName: descriptor.label,
          permissionModes: fallback.permissionModes,
          composerActions: fallback.composerActions
        }];
      }),
    false,
    'claude-code'
  ).map((row) => ({ value: row.id, label: row.displayName }));

  return (
    <PluginComposerChrome
      scope={{ kind: 'cli-agent', projectId: projectId || null }}
      text={field.text}
      setText={field.setText}
      focus={field.focus}
      familyId={familyId || undefined}
      providerId={selectedProviderId || undefined}
    >
    <div
      className={`thread-command-composer${expanded ? ' is-expanded' : ''}${field.dropOver ? ' is-drop-over' : ''}${launching ? ' is-sending' : ''}`}
      onKeyDown={field.handleChromeKeyDown}
      {...field.dropHandlers}
    >
      <span id="legacy-agent-command-label" className="thread-command-label">CLI agent composer</span>
      {error ? (
        <p className="thread-command-error" data-testid="legacy-agent-command-error">{error}</p>
      ) : null}
      {selectionState === 'unavailable' && selectionMessage ? (
        <p className="thread-command-error" role="status">{selectionMessage}</p>
      ) : null}
      <CommandComposer
        className="home-agent-command thread-command-card"
        labelledBy="legacy-agent-command-label"
        aria-busy={launching}
      >
        <ComposerPromptField
          editor={field.editor}
          images={field.images}
          onRemoveImage={field.removeImage}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((current) => !current)}
          expandTestId="legacy-agent-command-expand"
          menuOpen={field.menuOpen}
          suggestions={field.suggestions}
          selectedIndex={field.highlighted}
          triggerKind={field.triggerKind}
          onApply={field.applySuggestion}
        />
        <ComposerToolbar>
          {voiceBusy ? (
            <VoiceRecordingBar
              state={voice.state === 'transcribing' ? 'transcribing' : 'recording'}
              stream={voice.stream}
              onConfirm={voice.stop}
              onCancel={voice.cancel}
            />
          ) : (
            <>
              <div className="thread-command-footer-start">
                <ModelReasoningPicker
                  providerOptions={harnessProviderOptions}
                  selectedProviderId={
                    (familyId && threadProviderIdForFamily(familyId))
                    || harnessProviderOptions[0]?.value
                    || ''
                  }
                  onSelectedProviderChange={(nextProviderId) => {
                    const nextFamilyId = familyForThreadProviderId(nextProviderId);
                    if (!nextFamilyId) return;
                    selectionGeneration.current += 1;
                    setFamilyId(nextFamilyId);
                    setAutomaticProfile(null);
                    const restored = rememberedSelectionFor(nextProviderId)?.model ?? '';
                    setModelId(restored);
                    if (restored) {
                      rememberComposerSelection({ providerId: nextProviderId, model: restored });
                    }
                    setRoleTargetId(undefined);
                    setWorkMode('agent');
                    setSelectionProvenance('explicit');
                    setSelectionState('resolved');
                    setResolvedProjectId(projectId);
                    setSelectionMessage(null);
                  }}
                  modelValue={modelId}
                  modelOptions={models.map((model) => ({ value: model.id, label: model.label }))}
                  moreModelOptions={moreModelOptions}
                  modelIsLoading={selectionState === 'loading' || catalogModelsLoading}
                  modelLoadError={
                    preferHostModels || (selectedHarness?.targets?.models?.length ?? 0) === 0
                      ? catalogEntry?.modelLoadError ?? null
                      : null
                  }
                  onModelChange={(value) => {
                    setModelId(value);
                    if (selectedProviderId && value) {
                      rememberComposerSelection({ providerId: selectedProviderId, model: value });
                    }
                  }}
                  disabled={harnessProviderOptions.length === 0}
                />
                {familyId === 'opencode' ? (
                  <NativeRolePicker
                    value={roleTargetId}
                    options={roleOptions.map((role) => ({ value: role.value, name: role.name }))}
                    onChange={setRoleTargetId}
                    onRefresh={() => {
                      if (selectedProviderId) void reloadThreadProviderModels(selectedProviderId);
                    }}
                  />
                ) : modeChip === 'work-mode' ? (
                  <ComposerModePicker
                    value={workMode === 'plan' ? 'plan' : 'agent'}
                    modes={CLI_WORK_MODES}
                    onChange={setWorkMode}
                  />
                ) : null}
              </div>
              <div className="thread-command-footer-end">
                <ComposerIconButton
                  onClick={() => { if (!field.canAttach) return; field.attachPickedFiles(); }}
                  disabled={!field.canAttach}
                  title={field.canAttach ? 'Attach files' : 'File attachments require the desktop app'}
                  aria-label="Attach files"
                >
                  <Paperclip size={14} aria-hidden="true" />
                </ComposerIconButton>
                <ComposerIconButton
                  className="voice-input-btn voice-input-btn--icon"
                  aria-label={
                    !voice.isSupported
                      ? 'Voice input is not supported in this browser'
                      : !voice.available
                        ? 'Host daemon is not connected'
                        : 'Start voice input'
                  }
                  title={
                    !voice.isSupported
                      ? 'Voice input is not supported in this browser'
                      : !voice.available
                        ? 'Host daemon is not connected'
                        : 'Start voice input'
                  }
                  disabled={!voice.canStart}
                  onClick={() => void voice.start()}
                >
                  <Mic size={14} />
                </ComposerIconButton>
                <ComposerIconButton
                    className={`thread-command-send${launching ? ' is-sending' : ''}`}
                    aria-label={launching ? 'Launching agent' : 'Launch agent'}
                    title={launching ? 'Launching agent' : 'Launch agent'}
                    aria-busy={launching}
                    data-testid="legacy-agent-command-send"
                    disabled={!canLaunch}
                    onClick={() => void launch()}
                  >
                    {launching ? (
                      <Loader2 size={16} className="thread-command-send-spin" aria-hidden="true" />
                    ) : (
                      <ArrowUp size={16} />
                    )}
                  </ComposerIconButton>
              </div>
            </>
          )}
        </ComposerToolbar>
      </CommandComposer>
      <div className="thread-command-composer-meta">
        <div className="thread-command-composer-meta-start">
          <div className="thread-command-chip">
            <Folder size={14} aria-hidden="true" />
            <ComposerProjectPicker
              projects={projects}
              value={projectId}
              onChange={(nextProjectId) => {
                setProjectId(nextProjectId);
              }}
              disabled={Boolean(pinnedProject)}
              title={pinnedProject ? 'Locked to this project' : undefined}
            />
          </div>
          {project?.remote ? (
            <span className="thread-command-chip" data-testid="composer-remote-host-mark">
              {agentCardRuntimeLabel({
                profile: cliRuntimeProfile,
                remote: true
              })}
            </span>
          ) : project ? (
            <EnvironmentPicker
              projectId={project.id}
              value={workspace}
              onChange={setWorkspace}
              allowPersonal={Boolean(project.quickAgent)}
              disabled={launching}
            />
          ) : null}
          <button
            type="button"
            className="launch-advanced-toggle"
            aria-expanded={advancedOpen}
            data-testid="legacy-agent-customize-launch"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            Customize launch
            {(extraArgs.length > 0 || personaId) ? (
              <span className="launch-advanced-badge">
                {(extraArgs.length > 0 ? 1 : 0) + (personaId ? 1 : 0)}
              </span>
            ) : null}
          </button>
        </div>
        <div className="thread-command-composer-meta-end">
          {permissionOptions.length > 1 && (
            <PopoverPicklist
              value={permissionMode}
              options={permissionOptions.map((row) => ({
                value: row.value,
                label: row.label,
                compactLabel: row.compactLabel,
                description: row.description,
                ...(row.tone ? { tone: row.tone } : {})
              }))}
              onChange={setPermissionMode}
              ariaLabel="Permission mode"
              searchable={false}
              minWidth={280}
            />
          )}
          <PluginComposerMeta scope={{ kind: 'cli-agent', projectId: projectId || null }} />
        </div>
      </div>
      {advancedOpen ? (
        <div className="launch-advanced-wrap">
          <div className="launch-advanced launch-advanced-card" data-testid="legacy-agent-advanced">
            <div className="launch-extra-args">
              <TextArgsField
                label="Extra args"
                help="Passed to the CLI after project and persona args. Later flags win when the same option appears twice."
                values={extraArgs}
                placeholder="--plugin-dir /path/to/plugin"
                onChange={(values) => {
                  setExtraArgs(values);
                  writeCliExtraArgs(familyId, values);
                }}
              />
            </div>
            <div className="launch-row">
              <span className="launch-row-label">Persona</span>
              <PopoverPicklist
                value={personaId}
                ariaLabel="Persona"
                searchable={false}
                onChange={setPersonaId}
                options={[
                  { value: '', label: 'None' },
                  ...personas.map((persona) => ({ value: persona.id, label: persona.name }))
                ]}
              />
            </div>
            <PluginComposerAdvanced scope={{ kind: 'cli-agent', projectId: projectId || null }} />
          </div>
        </div>
      ) : null}
    </div>
    </PluginComposerChrome>
  );
}
