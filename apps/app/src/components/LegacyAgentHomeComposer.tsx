import { product } from '../lib/product-client.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Folder, Loader2, Maximize2, Mic, Minimize2, Paperclip } from 'lucide-react';
import type { HarnessAdapterDescriptor, HarnessModelTarget } from '@zana-ai/zcc-domain/harness-adapter';
import type {
  EffectiveHarnessDefaultResult,
  HarnessFamily,
  HarnessModelRoutingV1,
  LaunchProfileId,
  Project
} from '@zana-ai/zcc-domain/product';
import { buildLaunchArgs } from './AgentLauncher.js';
import { LauncherModelPicker } from './LauncherModelPicker.js';
import { EnvironmentPicker, defaultWorkspaceChoice, type WorkspacePickerValue } from './EnvironmentPicker.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import {
  CommandComposer,
  ComposerIconButton,
  ComposerToolbar
} from './ui/CommandComposer.js';
import { AttachmentPills } from './ui/AttachmentPills.js';
import { ComposerModePicker } from './thread/pickers/ComposerModePicker.js';
import { VoiceRecordingBar } from './thread/voice/VoiceRecordingBar.js';
import { useVoiceInput } from './thread/voice/useVoiceInput.js';
import { useData, usePersonas, useUi } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { useFileDrop } from '../hooks/useFileDrop.js';
import { posixQuote } from '../lib/quote.js';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { appendAttachmentContext, attachmentName, mergeAttachmentPaths } from '../lib/attachments.js';
import {
  composerProjectLabel,
  composerProjectOptions,
  DEFAULT_COMPOSER_WORKSPACE_LABEL,
  resolveComposerProjectId
} from './composer-project-default.js';
import { availableAgentHarnesses, PROFILE_BY_FAMILY } from './legacy-agent-home.js';

const EMPTY_MODELS: readonly HarnessModelTarget[] = [];

/**
 * Home PTY launch surface. Thread create stays in ThreadCommandComposer;
 * this file is the only home-page caller of `createTerminal`.
 */
export function LegacyAgentHomeComposer({
  project: pinnedProject,
  onSelectThread
}: {
  project?: Project;
  onSelectThread: () => void;
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
  const [prompt, setPrompt] = useState('');
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
  const [attachments, setAttachments] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<WorkspacePickerValue>(() => defaultWorkspaceChoice(false));
  const canAttach = hasDesktopBridge();
  const ensureScratchRef = useRef(false);
  const selectionGeneration = useRef(0);
  const descriptorGeneration = useRef(0);
  const launchProjects = useMemo(() => composerProjectOptions(projects), [projects]);
  const projectOptions = launchProjects;
  const harnesses = useMemo(() => availableAgentHarnesses(descriptors), [descriptors]);
  const project = pinnedProject ?? launchProjects.find((candidate) => candidate.id === projectId);
  const selectedHarness = harnesses.find((descriptor) => descriptor.id === familyId);
  const models: readonly HarnessModelTarget[] = selectedHarness?.targets?.models ?? EMPTY_MODELS;
  const addAttachments = (paths: string[]) => {
    setAttachments((current) => mergeAttachmentPaths(current, paths));
  };
  const { dropOver, dropHandlers } = useFileDrop(
    (paths) => addAttachments(paths.split('\n')),
    (paths) => paths.join('\n')
  );
  const insertVoiceTranscript = useCallback((text: string) => {
    setPrompt((current) => {
      const next = text.endsWith(' ') ? text : `${text} `;
      if (!current) return next;
      return current.endsWith(' ') || current.endsWith('\n') ? `${current}${next}` : `${current} ${next}`;
    });
  }, []);
  const voice = useVoiceInput({ onTranscript: insertVoiceTranscript });
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
    const profile = selectionProvenance === 'automatic'
      ? automaticProfile
      : selectedHarness?.defaultProfileId ?? PROFILE_BY_FAMILY[familyId];
    if (!profile) return;
    setError(null);
    setLaunching(true);
    try {
      let attachmentPaths = attachments;
      if (project.remote && attachments.length > 0) {
        const uploaded: string[] = [];
        for (const localPath of attachments) {
          const result = await product.fs.uploadToRemote(project.id, localPath, '.');
          if (!result.ok || !result.path) {
            pushToast(result.message ?? `Failed to upload ${attachmentName(localPath)}`, 'error');
            return;
          }
          uploaded.push(result.path);
          pushToast(`Uploaded ${attachmentName(localPath)} to ${project.remote.host}`);
        }
        attachmentPaths = uploaded.map(posixQuote);
      }
      const launchedPrompt = appendAttachmentContext(prompt, attachmentPaths);
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
      setPrompt('');
      setAttachments([]);
      useUi.getState().enterProjectFocus(project.id);
      selectTab(project.id, session.id);
      useUi.getState().openAgentModal(session.id, project.id);
    } catch (err) {
      const message = `Agent launch failed: ${err instanceof Error ? err.message : String(err)}`;
      setError(message);
      pushToast(message, 'error');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div
      className={`thread-command-composer${expanded ? ' is-expanded' : ''}${dropOver ? ' is-drop-over' : ''}${launching ? ' is-sending' : ''}`}
      {...dropHandlers}
    >
      <span id="legacy-agent-command-label" className="thread-command-label">Legacy agent composer</span>
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
        <AttachmentPills
          paths={attachments}
          onRemove={(path) => setAttachments((current) => current.filter((item) => item !== path))}
        />
        <div className="thread-command-editor-slot">
          <ComposerIconButton
            className="thread-command-expand"
            aria-label={expanded ? 'Make prompt box smaller' : 'Make prompt box larger'}
            title={expanded ? 'Make prompt box smaller' : 'Make prompt box larger'}
            data-testid="legacy-agent-command-expand"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </ComposerIconButton>
          <textarea
            className="thread-command-editor"
            data-testid="legacy-agent-command-input"
            value={prompt}
            placeholder="Describe the task… Leave empty to open an interactive session"
            aria-label="Instruction for the legacy agent"
            disabled={launching}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void launch();
              }
            }}
          />
        </div>
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
                <ComposerModePicker
                  value="agent"
                  modes={['agent']}
                  onChange={onSelectThread}
                  showLegacyAgent
                  legacyAgentSelected
                  onSelectLegacyAgent={() => undefined}
                />
                <PopoverPicklist
                  ariaLabel="Agent harness"
                  value={familyId}
                  disabled={harnesses.length === 0}
                  searchable={false}
                  placeholder={
                    harnesses.length === 0
                      ? 'No agent harness available'
                      : selectionState === 'unavailable'
                        ? 'Choose an available harness'
                        : 'Resolving default harness'
                  }
                  options={harnesses.map((descriptor) => ({ value: descriptor.id, label: descriptor.label }))}
                  onChange={(nextFamilyId) => {
                    selectionGeneration.current += 1;
                    setFamilyId(nextFamilyId as HarnessFamily);
                    setAutomaticProfile(null);
                    setModelId('');
                    setSelectionProvenance('explicit');
                    setSelectionState('resolved');
                    setResolvedProjectId(projectId);
                    setSelectionMessage(null);
                  }}
                />
                {models.length > 0 && (
                  <LauncherModelPicker
                    id="home-legacy-agent-model"
                    models={models}
                    value={modelId}
                    onChange={setModelId}
                  />
                )}
              </div>
              <div className="thread-command-footer-end">
                <ComposerIconButton
                  onClick={() => { if (!canAttach) return; void product.fs.pickFiles().then(addAttachments); }}
                  disabled={!canAttach}
                  title={canAttach ? 'Attach files' : 'File attachments require the desktop app'}
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
            <PopoverPicklist
              value={projectId}
              options={projectOptions.map((row) => ({ value: row.id, label: composerProjectLabel(row) }))}
              onChange={(nextProjectId) => {
                selectionGeneration.current += 1;
                setResolvedProjectId(null);
                setSelectionState('loading');
                setFamilyId('');
                setAutomaticProfile(null);
                setModelId('');
                setProjectId(nextProjectId);
              }}
              ariaLabel="Project"
              placeholder={DEFAULT_COMPOSER_WORKSPACE_LABEL}
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
  );
}
