import { product } from '../lib/product-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { composerProjectOptions, resolveComposerProjectId } from './composer-project-default.js';
import { ModelReasoningPicker } from './thread/pickers/ModelReasoningPicker.js';
import { PluginComposerChrome } from '../plugins/PluginComposerChrome.js';
import { ComposerPromptField } from './composer/ComposerPromptField.js';
import { useComposerPromptField } from './composer/use-composer-prompt-field.js';
import { composerProvidersFromCatalog } from './thread/pickers/fallback-models.js';
import {
  absolutePathMentions,
  assembleCliLaunchPrompt,
  availableAgentHarnesses,
  familyForThreadProviderId,
  PROFILE_BY_FAMILY,
  rewritePromptPaths,
  threadProviderIdForFamily
} from './legacy-agent-home.js';

const EMPTY_MODELS: readonly HarnessModelTarget[] = [];

/**
 * Home PTY launch surface. Thread create stays in ThreadCommandComposer;
 * this file is the only home-page caller of `createTerminal`.
 */
export function LegacyAgentHomeComposer({
  project: pinnedProject,
  initialText,
  onLaunched,
  onClose
}: {
  project?: Project;
  initialText?: string;
  onLaunched?: (session: TerminalSession, projectId: string) => void;
  onClose?: () => void;
}) {
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
  const selectTab = useUi((s) => s.selectTab);
  const pushToast = useUi((s) => s.pushToast);
  const [projectId, setProjectId] = useState(pinnedProject?.id ?? '');
  const [familyId, setFamilyId] = useState<HarnessFamily | ''>('');
  const [automaticProfile, setAutomaticProfile] = useState<LaunchProfileId | null>(null);
  const [selectionState, setSelectionState] = useState<'loading' | 'resolved' | 'unavailable'>('loading');
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [selectionProvenance, setSelectionProvenance] = useState<'automatic' | 'explicit'>('automatic');
  const [modelId, setModelId] = useState('');
  const [descriptors, setDescriptors] = useState<HarnessAdapterDescriptor[]>([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePickerValue>(() => defaultWorkspaceChoice(false));
  const ensureScratchRef = useRef(false);
  const selectionGeneration = useRef(0);
  const descriptorGeneration = useRef(0);
  const launchRef = useRef<() => void>(() => undefined);
  const launchProjects = useMemo(() => composerProjectOptions(projects), [projects]);
  const harnesses = useMemo(() => availableAgentHarnesses(descriptors), [descriptors]);
  const project = pinnedProject ?? launchProjects.find((candidate) => candidate.id === projectId);
  const selectedHarness = harnesses.find((descriptor) => descriptor.id === familyId);
  const models: readonly HarnessModelTarget[] = selectedHarness?.targets?.models ?? EMPTY_MODELS;

  const field = useComposerPromptField({
    placeholder: 'Describe the task… Leave empty to open an interactive session',
    testId: 'legacy-agent-command-input',
    ariaLabel: 'Instruction for the CLI agent',
    projectId,
    projectRoot: project?.path,
    projects,
    disabled: launching,
    initialText,
    slashCatalog: { kind: 'cli' },
    onSubmit: () => {
      launchRef.current();
    },
    onError: setError
  });
  const voice = useVoiceInput({ onTranscript: field.insertText });
  const voiceBusy = voice.state === 'recording' || voice.state === 'transcribing';

  useEffect(() => {
    const generation = ++descriptorGeneration.current;
    void product.harness.descriptors().then((next) => {
      if (generation === descriptorGeneration.current) setDescriptors(next);
    }).catch(() => {
      if (generation === descriptorGeneration.current) setDescriptors([]);
    });
  }, [harnessCursorEnabled, harnessCodexEnabled, harnessPiEnabled, harnessOpenCodeEnabled]);

  useEffect(() => {
    if (pinnedProject) {
      setProjectId(pinnedProject.id);
      return;
    }
    const nextId = resolveComposerProjectId(projects, projectId);
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
  }, [loadProjects, pinnedProject, projectId, projects]);

  useEffect(() => {
    if (!project) return;
    setWorkspace(
      project.quickAgent || project.remote
        ? { kind: 'personal' }
        : defaultWorkspaceChoice(worktreeIsolationDefault)
    );
  }, [project?.id, project?.quickAgent, project?.remote, worktreeIsolationDefault]);

  useEffect(() => {
    if (selectionState !== 'resolved' || (modelId && models.some((model) => model.id === modelId))) return;
    setModelId('');
  }, [modelId, models, selectionState]);

  useEffect(() => {
    if (!projectId) return;
    const generation = ++selectionGeneration.current;
    setSelectionProvenance('automatic');
    setSelectionState('loading');
    setResolvedProjectId(null);
    setSelectionMessage(null);
    setFamilyId('');
    setAutomaticProfile(null);
    void product.harness.effectiveDefault(projectId).then((result: EffectiveHarnessDefaultResult) => {
      if (generation !== selectionGeneration.current) return;
      if (result.ok) {
        setFamilyId(result.family);
        setAutomaticProfile(result.profile);
        setSelectionState('resolved');
        setResolvedProjectId(projectId);
      } else {
        setSelectionState('unavailable');
        setSelectionMessage(result.message);
      }
    }).catch(() => {
      if (generation !== selectionGeneration.current) return;
      setSelectionState('unavailable');
      setSelectionMessage('Default harness unavailable');
    });
  }, [
    projectId,
    project?.launchDefault,
    project?.defaultAgents,
    project?.defaultPersonas,
    personas,
    defaultHarness,
    harnessCursorEnabled,
    harnessCodexEnabled,
    harnessPiEnabled,
    harnessOpenCodeEnabled
  ]);

  const canLaunch = Boolean(
    project
    && familyId
    && selectionState === 'resolved'
    && resolvedProjectId === projectId
    && (selectionProvenance !== 'explicit' || selectedHarness)
    && !launching
  );

  const launch = async () => {
    if (!project || !familyId || launching || selectionState !== 'resolved' || resolvedProjectId !== projectId) return;
    if (selectionProvenance === 'explicit' && !selectedHarness) return;
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
      if (project.remote) {
        const uploaded: Array<{ from: string; to: string }> = [];
        for (const localPath of absolutePathMentions(serialized.mentions)) {
          const result = await product.fs.uploadToRemote(project.id, localPath, '.');
          if (!result.ok || !result.path) {
            pushToast(result.message ?? `Failed to upload ${attachmentName(localPath)}`, 'error');
            return;
          }
          uploaded.push({ from: localPath, to: posixQuote(result.path) });
          pushToast(`Uploaded ${attachmentName(localPath)} to ${project.remote.host}`);
        }
        promptText = rewritePromptPaths(promptText, uploaded);
      }
      const imagePaths = field.images.length === 0
        ? []
        : await persistComposerImages(project.id, field.images);
      const launchedPrompt = assembleCliLaunchPrompt({ text: promptText, imagePaths });
      const args = buildLaunchArgs(
        launchedPrompt,
        selectedHarness?.label ?? familyId
      );
      const validModelId = models.some((model) => model.id === modelId) ? modelId : '';
      const harnessRouting: HarnessModelRoutingV1 | undefined = validModelId
        ? { schemaVersion: 1, byAdapter: { [familyId]: { modelTargetId: modelId } } }
        : undefined;

      const session = await createTerminal(project.id, profile, 80, 24, {
        ...args,
        harnessRouting,
        profileSource: selectionProvenance === 'automatic' ? 'seeded-default' : 'explicit',
        workspace: project.quickAgent ? { kind: 'personal' } : workspace,
        isolateScratch: project.quickAgent ? args.title || true : undefined
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
    harnesses.flatMap((descriptor) => {
      const providerId = threadProviderIdForFamily(descriptor.id);
      return providerId
        ? [{ id: providerId, displayName: descriptor.label, permissionModes: [], composerActions: [] }]
        : [];
    }),
    false,
    'claude-code'
  ).map((row) => ({ value: row.id, label: row.displayName }));

  return (
    <PluginComposerChrome
      scope={{ kind: 'new-thread', projectId: projectId || null }}
      text={field.text}
      setText={field.setText}
      focus={field.focus}
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
                    setModelId('');
                    setSelectionProvenance('explicit');
                    setSelectionState('resolved');
                    setResolvedProjectId(projectId);
                    setSelectionMessage(null);
                  }}
                  modelValue={modelId}
                  modelOptions={models.map((model) => ({ value: model.id, label: model.label }))}
                  modelIsLoading={selectionState === 'loading'}
                  onModelChange={setModelId}
                  disabled={harnessProviderOptions.length === 0}
                />
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
                selectionGeneration.current += 1;
                setResolvedProjectId(null);
                setSelectionState('loading');
                setFamilyId('');
                setAutomaticProfile(null);
                setModelId('');
                setProjectId(nextProjectId);
              }}
              disabled={Boolean(pinnedProject)}
              title={pinnedProject ? 'Workspace is locked to this project' : undefined}
            />
          </div>
          {project && !project.remote && (
            <EnvironmentPicker
              projectId={project.id}
              value={workspace}
              onChange={setWorkspace}
              allowPersonal={Boolean(project.quickAgent)}
              disabled={launching}
            />
          )}
        </div>
      </div>
    </div>
    </PluginComposerChrome>
  );
}
