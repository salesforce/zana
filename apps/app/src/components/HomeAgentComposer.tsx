import { product } from '../lib/product-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, FolderGit2, Paperclip, Server } from 'lucide-react';
import type { HarnessAdapterDescriptor, HarnessModelTarget } from '@zana-ai/zcc-domain/harness-adapter';
import type { EffectiveHarnessDefaultResult, HarnessFamily, HarnessModelRoutingV1, LaunchProfileId, Project } from '@zana-ai/zcc-domain/product';
import { buildLaunchArgs } from './AgentLauncher.js';
import { LauncherModelPicker } from './LauncherModelPicker.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import {
  AutoGrowTextarea,
  CommandComposer,
  ComposerIconButton,
  ComposerToolbar
} from './ui/CommandComposer.js';
import { AttachmentPills } from './ui/AttachmentPills.js';
import { VoiceInputButton } from './VoiceInputButton.js';
import { useData, usePersonas, useUi } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { useFileDrop } from '../hooks/useFileDrop.js';
import { posixQuote } from '../lib/quote.js';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { appendAttachmentContext, attachmentName, mergeAttachmentPaths } from '../lib/attachments.js';

const PROFILE_BY_FAMILY: Record<HarnessFamily, LaunchProfileId> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode'
};
const HOME_LAUNCHER_PREFERENCES_KEY = 'zcc.homeLauncher.preferences';

export interface HomeLauncherPreferences {
  projectId?: string;
  modelId?: string;
}

export function parseHomeLauncherPreferences(raw: string | null): HomeLauncherPreferences {
  try {
    const value = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    return {
      projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
      modelId: typeof value.modelId === 'string' ? value.modelId : undefined
    };
  } catch {
    return {};
  }
}

function readHomeLauncherPreferences(): HomeLauncherPreferences {
  return parseHomeLauncherPreferences(localStorage.getItem(HOME_LAUNCHER_PREFERENCES_KEY));
}

function writeHomeLauncherPreferences(preferences: HomeLauncherPreferences) {
  try {
    localStorage.setItem(HOME_LAUNCHER_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are a convenience; an unavailable storage area must not block launching.
  }
}

function availableAgentHarnesses(descriptors: HarnessAdapterDescriptor[]) {
  return descriptors.filter((descriptor) =>
    descriptor.agentDefaultEligible &&
    descriptor.availability.enabled &&
    descriptor.availability.installed
  );
}

/**
 * Compact launch surface for Home and empty Agents boards. It reuses the prompt,
 * voice, and model-picker controls used by the full launcher. Pass `project` to
 * pin launches to one workspace (hides the picker; skips the scratch default).
 */
export function HomeAgentComposer({ project: pinnedProject }: { project?: Project } = {}) {
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const createTerminal = useData((s) => s.createTerminal);
  const personas = usePersonas(useShallow((s) => s.personas));
  const defaultHarness = useData((s) => s.defaultHarness);
  const harnessCursorEnabled = useData((s) => s.harnessCursorEnabled);
  const harnessCodexEnabled = useData((s) => s.harnessCodexEnabled);
  const harnessPiEnabled = useData((s) => s.harnessPiEnabled);
  const harnessOpenCodeEnabled = useData((s) => s.harnessOpenCodeEnabled);
  const selectTab = useUi((s) => s.selectTab);
  const pushToast = useUi((s) => s.pushToast);
  const [preferences, setPreferences] = useState(readHomeLauncherPreferences);
  const [prompt, setPrompt] = useState('');
  const [projectId, setProjectId] = useState(pinnedProject?.id ?? preferences.projectId ?? '');
  const [familyId, setFamilyId] = useState<HarnessFamily | ''>('');
  const [automaticProfile, setAutomaticProfile] = useState<LaunchProfileId | null>(null);
  const [selectionState, setSelectionState] = useState<'loading' | 'resolved' | 'unavailable'>('loading');
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [selectionProvenance, setSelectionProvenance] = useState<'automatic' | 'explicit'>('automatic');
  const [modelId, setModelId] = useState(preferences.modelId ?? '');
  const [descriptors, setDescriptors] = useState<HarnessAdapterDescriptor[]>([]);
  const [launching, setLaunching] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [quickWorkspaceReady, setQuickWorkspaceReady] = useState(false);
  const canLaunch = hasDesktopBridge();
  const selectionGeneration = useRef(0);
  const descriptorGeneration = useRef(0);

  const launchProjects = useMemo(
    () => [...projects].sort((left, right) => Number(Boolean(right.quickAgent)) - Number(Boolean(left.quickAgent))),
    [projects]
  );
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
      setQuickWorkspaceReady(true);
      return;
    }
    let cancelled = false;
    void product.projects.ensureQuickAgent()
      .then((result) => {
        if (cancelled || !result.ok) return;
        if (!projects.some((candidate) => candidate.id === result.value.id)) void loadProjects();
        setProjectId((current) => current || result.value.id);
      })
      .finally(() => { if (!cancelled) setQuickWorkspaceReady(true); });
    return () => { cancelled = true; };
  }, [loadProjects, pinnedProject, projects]);

  useEffect(() => {
    if (pinnedProject) return;
    if (quickWorkspaceReady && !projectId && launchProjects[0]) setProjectId(launchProjects[0].id);
  }, [launchProjects, pinnedProject, projectId, quickWorkspaceReady]);

  useEffect(() => {
    if (selectionState !== 'resolved' || (modelId && models.some((model) => model.id === modelId))) return;
    setModelId('');
  }, [modelId, models, selectionState]);

  useEffect(() => {
    if (pinnedProject) return;
    const next = { projectId, modelId: modelId || undefined };
    setPreferences(next);
    writeHomeLauncherPreferences(next);
  }, [pinnedProject, projectId, modelId]);

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

  const launch = async () => {
    if (!canLaunch) return;
    if (!project || !familyId || !prompt.trim() || launching || selectionState !== 'resolved' || resolvedProjectId !== projectId) return;
    if (selectionProvenance === 'explicit' && !selectedHarness) return;
    const profile = selectionProvenance === 'automatic'
      ? automaticProfile
      : selectedHarness?.defaultProfileId ?? PROFILE_BY_FAMILY[familyId];
    if (!profile) return;
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
      const args = buildLaunchArgs(
        appendAttachmentContext(prompt, attachmentPaths),
        selectedHarness?.label ?? familyId
      );
      const validModelId = models.some((model) => model.id === modelId) ? modelId : '';
      const harnessRouting: HarnessModelRoutingV1 | undefined = validModelId
        ? { schemaVersion: 1, byAdapter: { [familyId]: { modelTargetId: modelId } } }
        : undefined;

      const session = await createTerminal(project.id, profile, 80, 24, {
        ...args,
        harnessRouting,
        profileSource: selectionProvenance === 'automatic' ? 'seeded-default' : 'explicit'
      });
      if (!session) return;
      setPrompt('');
      setAttachments([]);
      useUi.getState().enterProjectFocus(project.id);
      selectTab(project.id, session.id);
      useUi.getState().openAgentModal(session.id, project.id);
    } catch (err) {
      pushToast(`Agent launch failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <section className="home-agent-composer" aria-labelledby="home-agent-composer-title">
      <div className="home-agent-composer-heading">
        <div>
          <p className="home-agent-composer-kicker">Start a focused session</p>
          <h3 id="home-agent-composer-title">What do you want to work on?</h3>
        </div>
      </div>

      <CommandComposer className={`home-agent-command${dropOver ? ' is-drop-over' : ''}`} labelledBy="home-agent-composer-title" {...dropHandlers}>
        <AttachmentPills
          paths={attachments}
          onRemove={(path) => setAttachments((current) => current.filter((item) => item !== path))}
        />
        <AutoGrowTextarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void launch();
            }
          }}
          placeholder="Plan, build, or ask an agent to investigate..."
          aria-label="Instruction for the new agent"
        />

        <ComposerToolbar>
          <ComposerIconButton
            onClick={() => { if (!canLaunch) return; void product.fs.pickFiles().then(addAttachments); }}
            disabled={!canLaunch}
            title={canLaunch ? 'Attach files' : 'File attachments require the desktop app'}
            aria-label="Attach files"
          >
            <Paperclip size={16} aria-hidden="true" />
          </ComposerIconButton>
          {!pinnedProject && (
          <div className="home-agent-select home-agent-project-picker">
            <FolderGit2 size={15} aria-hidden="true" />
            <PopoverPicklist
              ariaLabel="Project"
              value={projectId}
              placeholder="Choose project"
              searchPlaceholder="Search projects"
              emptyHint="No matching projects"
              triggerClassName="home-agent-project-picker-trigger"
              minWidth={360}
              anchorToParent
              options={launchProjects.map((candidate) => ({
                value: candidate.id,
                label: projectLabel(candidate),
                className: 'home-agent-project-option',
                content: (
                  <span className="home-agent-project-option-details">
                    {candidate.remote ? <Server size={15} aria-hidden="true" /> : <FolderGit2 size={15} aria-hidden="true" />}
                    <span>
                      <span className="home-agent-project-option-name">{projectLabel(candidate)}</span>
                      {candidate.remote && (
                        <span className="home-agent-project-option-meta">
                          remote · {candidate.remote.user ? `${candidate.remote.user}@` : ''}{candidate.remote.host}
                        </span>
                      )}
                    </span>
                  </span>
                )
              }))}
              onChange={(nextProjectId) => {
                selectionGeneration.current += 1;
                setResolvedProjectId(null);
                setSelectionState('loading');
                setFamilyId('');
                setAutomaticProfile(null);
                setModelId('');
                setProjectId(nextProjectId);
              }}
            />
          </div>
          )}

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

          {selectionState === 'unavailable' && (
            <span className="home-agent-launch-status" role="status">{selectionMessage}</span>
          )}

          {models.length > 0 && (
            <LauncherModelPicker
              id="home-agent-model"
              models={models}
              value={modelId}
              onChange={setModelId}
            />
          )}

          <div className="home-agent-command-actions">
            <VoiceInputButton value={prompt} onChange={setPrompt} iconOnly className="home-agent-voice" />
            <ComposerIconButton
              className="home-agent-launch"
              onClick={() => { void launch(); }}
              disabled={!canLaunch || !project || !familyId || !prompt.trim() || launching || selectionState !== 'resolved' || resolvedProjectId !== projectId || (selectionProvenance === 'explicit' && !selectedHarness)}
              aria-label={launching ? 'Launching agent' : 'Launch agent'}
              title={
                !canLaunch
                  ? 'Launching agents requires the desktop app'
                  : launching
                    ? 'Launching agent'
                    : 'Launch agent'
              }
            >
              <ArrowUp size={17} aria-hidden="true" />
          </ComposerIconButton>
          </div>
        </ComposerToolbar>
      </CommandComposer>
    </section>
  );
}

const EMPTY_MODELS: readonly HarnessModelTarget[] = [];

function projectLabel(project: Project): string {
  return project.quickAgent ? 'Quick workspace (scratch)' : project.name;
}
