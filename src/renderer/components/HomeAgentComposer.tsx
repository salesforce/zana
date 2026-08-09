import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Check, ChevronDown, FileText, FolderGit2, Paperclip, Search, Server, X } from 'lucide-react';
import type { HarnessAdapterDescriptor, HarnessModelTarget } from '@shared/harness-adapter';
import type { EffectiveHarnessDefaultResult, HarnessFamily, HarnessModelRoutingV1, LaunchProfileId, Project } from '@shared/types';
import { buildLaunchArgs } from './AgentLauncher';
import { LauncherModelPicker } from './LauncherModelPicker';
import {
  AutoGrowTextarea,
  CommandComposer,
  ComposerIconButton,
  ComposerToolbar
} from './ui/CommandComposer';
import { VoiceInputButton } from './VoiceInputButton';
import { useData, usePersonas, useUi } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useFileDrop } from '../util/useFileDrop';

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

function attachmentName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function availableAgentHarnesses(descriptors: HarnessAdapterDescriptor[]) {
  return descriptors.filter((descriptor) =>
    descriptor.agentDefaultEligible &&
    descriptor.availability.enabled &&
    descriptor.availability.installed
  );
}

/**
 * Compact launch surface for Home. It deliberately reuses the prompt, voice, and
 * model-picker controls used by the full launcher while keeping first-run choices
 * to the project and harness needed to start work immediately.
 */
export function HomeAgentComposer() {
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const createTerminal = useData((s) => s.createTerminal);
  const personas = usePersonas(useShallow((s) => s.personas));
  const defaultHarness = useData((s) => s.defaultHarness);
  const harnessCursorEnabled = useData((s) => s.harnessCursorEnabled);
  const harnessCodexEnabled = useData((s) => s.harnessCodexEnabled);
  const harnessPiEnabled = useData((s) => s.harnessPiEnabled);
  const harnessOpenCodeEnabled = useData((s) => s.harnessOpenCodeEnabled);
  const setNav = useUi((s) => s.setNav);
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const [preferences, setPreferences] = useState(readHomeLauncherPreferences);
  const [prompt, setPrompt] = useState('');
  const [projectId, setProjectId] = useState(preferences.projectId ?? '');
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
  const selectionGeneration = useRef(0);
  const descriptorGeneration = useRef(0);

  const launchProjects = useMemo(
    () => [...projects].sort((left, right) => Number(Boolean(right.quickAgent)) - Number(Boolean(left.quickAgent))),
    [projects]
  );
  const harnesses = useMemo(() => availableAgentHarnesses(descriptors), [descriptors]);
  const project = launchProjects.find((candidate) => candidate.id === projectId);
  const selectedHarness = harnesses.find((descriptor) => descriptor.id === familyId);
  const models: readonly HarnessModelTarget[] = selectedHarness?.targets?.models ?? EMPTY_MODELS;
  const addAttachments = (paths: string[]) => {
    setAttachments((current) => [...new Set([...current, ...paths.map((path) => path.trim()).filter(Boolean)])]);
  };
  const { dropOver, dropHandlers } = useFileDrop(
    (paths) => addAttachments(paths.split('\n')),
    (paths) => paths.join('\n')
  );
  useEffect(() => {
    const generation = ++descriptorGeneration.current;
    void window.cc.harness.descriptors().then((next) => {
      if (generation === descriptorGeneration.current) setDescriptors(next);
    }).catch(() => {
      if (generation === descriptorGeneration.current) setDescriptors([]);
    });
  }, [harnessCursorEnabled, harnessCodexEnabled, harnessPiEnabled, harnessOpenCodeEnabled]);

  useEffect(() => {
    let cancelled = false;
    void window.cc.projects.ensureQuickAgent()
      .then((result) => {
        if (cancelled || !result.ok) return;
        if (!projects.some((candidate) => candidate.id === result.value.id)) void loadProjects();
        setProjectId((current) => current || result.value.id);
      })
      .finally(() => { if (!cancelled) setQuickWorkspaceReady(true); });
    return () => { cancelled = true; };
  }, [loadProjects, projects]);

  useEffect(() => {
    if (quickWorkspaceReady && !projectId && launchProjects[0]) setProjectId(launchProjects[0].id);
  }, [launchProjects, projectId, quickWorkspaceReady]);

  useEffect(() => {
    if (selectionState !== 'resolved' || (modelId && models.some((model) => model.id === modelId))) return;
    setModelId('');
  }, [modelId, models, selectionState]);

  useEffect(() => {
    const next = { projectId, modelId: modelId || undefined };
    setPreferences(next);
    writeHomeLauncherPreferences(next);
  }, [projectId, modelId]);

  useEffect(() => {
    if (!projectId) return;
    const generation = ++selectionGeneration.current;
    setSelectionProvenance('automatic');
    setSelectionState('loading');
    setResolvedProjectId(null);
    setSelectionMessage(null);
    setFamilyId('');
    setAutomaticProfile(null);
    void window.cc.harness.effectiveDefault(projectId).then((result: EffectiveHarnessDefaultResult) => {
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
    if (!project || !familyId || !prompt.trim() || launching || selectionState !== 'resolved' || resolvedProjectId !== projectId) return;
    if (selectionProvenance === 'explicit' && !selectedHarness) return;
    const profile = selectionProvenance === 'automatic'
      ? automaticProfile
      : selectedHarness?.defaultProfileId ?? PROFILE_BY_FAMILY[familyId];
    if (!profile) return;
    const attachmentContext = attachments.length
      ? `\n\nAttached files:\n${attachments.map((path) => `- ${path}`).join('\n')}`
      : '';
    const args = buildLaunchArgs(`${prompt}${attachmentContext}`, selectedHarness?.label ?? familyId);
    const validModelId = models.some((model) => model.id === modelId) ? modelId : '';
    const harnessRouting: HarnessModelRoutingV1 | undefined = validModelId
      ? { schemaVersion: 1, byAdapter: { [familyId]: { modelTargetId: modelId } } }
      : undefined;

    setLaunching(true);
    const session = await createTerminal(project.id, profile, 80, 24, {
      ...args,
      harnessRouting,
      profileSource: selectionProvenance === 'automatic' ? 'seeded-default' : 'explicit'
    });
    setLaunching(false);
    if (!session) return;
    setPrompt('');
    setAttachments([]);
    setNav('projects');
    selectProject(project.id);
    selectTab(project.id, session.id);
    useUi.getState().openAgentModal(session.id, project.id);
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
        {attachments.length > 0 && (
          <div className="home-agent-attachments" aria-label="Attached files">
            {attachments.map((path) => (
              <span key={path} className="home-agent-attachment" title={path}>
                <FileText size={14} aria-hidden="true" />
                <span>{attachmentName(path)}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((item) => item !== path))}
                  aria-label={`Remove ${attachmentName(path)}`}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
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
            onClick={() => { void window.cc.fs.pickFiles().then(addAttachments); }}
            title="Attach files"
            aria-label="Attach files"
          >
            <Paperclip size={16} aria-hidden="true" />
          </ComposerIconButton>
          <div className="home-agent-select home-agent-project-picker">
            <FolderGit2 size={15} aria-hidden="true" />
            <HomeProjectPicker
              projects={launchProjects}
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
            />
          </div>

          <label className="home-agent-select">
            <select
              aria-label="Agent harness"
              value={familyId}
              onChange={(event) => {
                selectionGeneration.current += 1;
                setFamilyId(event.target.value as HarnessFamily);
                setAutomaticProfile(null);
                setModelId('');
                setSelectionProvenance('explicit');
                setSelectionState('resolved');
                setResolvedProjectId(projectId);
                setSelectionMessage(null);
              }}
              disabled={harnesses.length === 0}
            >
              {!familyId && (
                <option value="" disabled>
                  {selectionState === 'unavailable' ? 'Choose an available harness' : 'Resolving default harness'}
                </option>
              )}
              {harnesses.length === 0 && <option value="">No agent harness available</option>}
              {harnesses.map((descriptor) => (
                <option key={descriptor.id} value={descriptor.id}>{descriptor.label}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>

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
              disabled={!project || !familyId || !prompt.trim() || launching || selectionState !== 'resolved' || resolvedProjectId !== projectId || (selectionProvenance === 'explicit' && !selectedHarness)}
              aria-label={launching ? 'Launching agent' : 'Launch agent'}
              title={launching ? 'Launching agent' : 'Launch agent'}
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

function HomeProjectPicker({
  projects,
  value,
  onChange
}: {
  projects: readonly Project[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = projects.find((project) => project.id === value);
  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery
      ? projects.filter((project) => projectLabel(project).toLowerCase().includes(normalizedQuery))
      : projects;
  }, [projects, query]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    // Anchor to the whole project control, including its folder icon, rather
    // than the text-only button so the popover's left edge aligns with the field.
    const rect = triggerRef.current.parentElement?.getBoundingClientRect() ?? triggerRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 360) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery('');
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="home-agent-project-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Project"
      >
        <span>{selected ? projectLabel(selected) : 'Choose project'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="launch-model-picker-menu"
          role="listbox"
          aria-label="Project"
          style={position ? { left: position.left, top: position.top, width: position.width } : { visibility: 'hidden' }}
        >
          <div className="launch-model-picker-search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
            />
          </div>
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`launch-model-picker-option home-agent-project-option${value === project.id ? ' is-selected' : ''}`}
              role="option"
              aria-selected={value === project.id}
              onClick={() => { onChange(project.id); setOpen(false); }}
            >
              <span className="home-agent-project-option-details">
                {project.remote ? <Server size={15} aria-hidden="true" /> : <FolderGit2 size={15} aria-hidden="true" />}
                <span>
                  <span className="home-agent-project-option-name">{projectLabel(project)}</span>
                  {project.remote && (
                    <span className="home-agent-project-option-meta">
                      remote · {project.remote.user ? `${project.remote.user}@` : ''}{project.remote.host}
                    </span>
                  )}
                </span>
              </span>
              {value === project.id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
          {visibleProjects.length === 0 && <div className="launch-model-picker-hint">No matching projects</div>}
        </div>,
        document.body
      )}
    </>
  );
}
