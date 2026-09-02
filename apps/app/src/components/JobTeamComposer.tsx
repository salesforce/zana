import { product } from '../lib/product-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, FileText, Folder, Loader2, Mic, Paperclip, Users, X } from 'lucide-react';
import type { ExecutionSourceCapabilityView, Project } from '@zana-ai/zcc-domain/product';
import {
  CommandComposer,
  ComposerIconButton,
  ComposerToolbar
} from './ui/CommandComposer.js';
import { VoiceRecordingBar } from './thread/voice/VoiceRecordingBar.js';
import { useVoiceInput } from './thread/voice/useVoiceInput.js';
import { useData, useTeams, useUi } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { posixQuote } from '../lib/quote.js';
import { attachmentName } from '../lib/attachments.js';
import { persistComposerImages } from '../lib/prompt-attachments.js';
import { ComposerProjectPicker } from './ComposerProjectPicker.js';
import { composerProjectOptions, resolveComposerProjectId } from './composer-project-default.js';
import { PluginComposerChrome } from '../plugins/PluginComposerChrome.js';
import { ComposerPromptField } from './composer/ComposerPromptField.js';
import { useComposerPromptField } from './composer/use-composer-prompt-field.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { defaultAutonomousTeamId } from './autonomous-team-composer.js';
import { titleFromPrompt } from '../lib/promptTitle.js';
import {
  absolutePathMentions,
  assembleCliLaunchPrompt,
  rewritePromptPaths
} from './legacy-agent-home.js';

/**
 * New Chat / launcher surface for a durable **Job Team** run — the persistent,
 * orchestrator-led team execution that survives closing the launcher and shows
 * on the Agents board. Mirrors AutonomousTeamComposer, but launches via
 * `teams.startJob` (durable) rather than `teams.launchAutonomous`, and adds the
 * optional Title/Summary fields and attached source capabilities that a job
 * carries. This file is the only composer caller of `teams.startJob`.
 */
export function JobTeamComposer({
  project: pinnedProject,
  initialText,
  onClose
}: {
  project?: Project;
  initialText?: string;
  onClose?: () => void;
}) {
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const teams = useTeams(useShallow((s) => s.teams));
  const pushToast = useUi((s) => s.pushToast);
  const [projectId, setProjectId] = useState(pinnedProject?.id ?? '');
  const [teamId, setTeamId] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [jobSources, setJobSources] = useState<ExecutionSourceCapabilityView[]>([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ensureScratchRef = useRef(false);
  const launchRef = useRef<() => void>(() => undefined);
  const launchProjects = useMemo(() => composerProjectOptions(projects), [projects]);
  const project = pinnedProject ?? launchProjects.find((candidate) => candidate.id === projectId);
  const selectedTeam = teams.find((team) => team.id === teamId);

  const field = useComposerPromptField({
    placeholder: 'Describe the GOAL for the team to reach (⌘↵ to launch). Attach or drop supporting files.',
    testId: 'job-team-command-input',
    ariaLabel: 'Goal for the job team',
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
    setTeamId((current) => defaultAutonomousTeamId(teams, current));
  }, [teams]);

  useEffect(() => {
    if (pinnedProject) {
      setProjectId(pinnedProject.id);
      return;
    }
    const preferred = selectedTeam?.defaultProjectId;
    if (!projectId && preferred && projects.some((row) => row.id === preferred)) {
      setProjectId(preferred);
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
  }, [loadProjects, pinnedProject, projectId, projects, selectedTeam?.defaultProjectId]);

  const goalReady = field.text.trim().length > 0 || field.images.length > 0;
  const canLaunch = Boolean(teamId && project && goalReady && !launching);

  const pickSources = async () => {
    if (!project) return;
    const result = await product.executionSources.pick(project.id);
    if (!result.ok) {
      const message = result.message ?? result.code;
      setError(message);
      pushToast(message, 'error');
      return;
    }
    setJobSources((current) => {
      const ids = new Set(current.map(({ id }) => id));
      return [...current, ...result.value.filter(({ id }) => !ids.has(id))];
    });
  };

  const launch = async () => {
    if (!teamId || !project || launching) return;
    if (field.typeaheadOpen) return;
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
      const goal = assembleCliLaunchPrompt({ text: promptText, imagePaths });
      if (!goal) {
        setError('Describe a goal for the team');
        return;
      }
      const res = await product.teams.startJob({
        teamId,
        projectId: project.id,
        goal,
        title: title.trim() || titleFromPrompt(goal),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(jobSources.length ? { sourceCapabilityIds: jobSources.map(({ id }) => id) } : {})
      });
      if (!res.ok) {
        const message = `Job launch failed: ${res.message ?? res.code}`;
        setError(message);
        pushToast(message, 'error');
        return;
      }
      field.clear();
      setTitle('');
      setSummary('');
      setJobSources([]);
      pushToast('Job launched. Open Agents board to monitor it.');
      onClose?.();
    } catch (err) {
      const message = `Job launch failed: ${err instanceof Error ? err.message : String(err)}`;
      setError(message);
      pushToast(message, 'error');
    } finally {
      setLaunching(false);
    }
  };
  launchRef.current = () => {
    void launch();
  };

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
      <span id="job-team-command-label" className="thread-command-label">Job team composer</span>
      {error ? (
        <p className="thread-command-error" data-testid="job-team-command-error">{error}</p>
      ) : null}
      {teams.length === 0 ? (
        <p className="thread-command-error" role="status">No teams configured.</p>
      ) : null}
      <CommandComposer
        className="home-agent-command thread-command-card"
        labelledBy="job-team-command-label"
        aria-busy={launching}
      >
        <ComposerPromptField
          editor={field.editor}
          images={field.images}
          onRemoveImage={field.removeImage}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((current) => !current)}
          expandTestId="job-team-command-expand"
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
                <div className="thread-command-chip">
                  <Users size={14} aria-hidden="true" />
                  <PopoverPicklist
                    id="job-team-picker"
                    value={teamId}
                    ariaLabel="Team"
                    placeholder="Select a team"
                    searchable={teams.length > 6}
                    options={teams.map((team) => ({
                      value: team.id,
                      label: team.name,
                      ...(team.description ? { description: team.description } : {})
                    }))}
                    onChange={setTeamId}
                    disabled={teams.length === 0}
                    emptyHint="No teams configured"
                  />
                </div>
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
                  onClick={() => void pickSources()}
                  disabled={!project}
                  title="Attach source files for the team to work from"
                  aria-label="Attach sources"
                >
                  <FileText size={14} aria-hidden="true" />
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
                    aria-label={launching ? 'Launching job team' : 'Launch job team'}
                    title={launching ? 'Launching job team' : 'Launch job team'}
                    aria-busy={launching}
                    data-testid="job-team-command-send"
                    disabled={!canLaunch}
                    onClick={() => void launch()}
                    onMouseDown={(event) => event.preventDefault()}
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
      {jobSources.length > 0 ? (
        <ul className="launch-attachment-list" aria-label="Attached sources">
          {jobSources.map((source) => (
            <li key={source.id} className="launch-attachment-pill">
              <FileText size={12} aria-hidden="true" />
              <span>{source.name}</span>
              <button
                type="button"
                aria-label={`Remove ${source.name}`}
                onClick={() => setJobSources((current) => current.filter(({ id }) => id !== source.id))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="launch-job-details" role="group" aria-label="Job details">
        <label className="workflow-arg-field" htmlFor="job-team-title">
          <span>Title <span className="launch-optional">Optional</span></span>
          <input
            id="job-team-title"
            type="text"
            maxLength={256}
            value={title}
            placeholder="Defaults from goal"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="workflow-arg-field" htmlFor="job-team-summary">
          <span>Summary <span className="launch-optional">Optional</span></span>
          <textarea
            id="job-team-summary"
            rows={3}
            maxLength={4000}
            value={summary}
            placeholder="Add context for this job"
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
      </div>
      <div className="thread-command-composer-meta">
        <div className="thread-command-composer-meta-start">
          <div className="thread-command-chip">
            <Folder size={14} aria-hidden="true" />
            <ComposerProjectPicker
              projects={projects}
              value={projectId}
              onChange={setProjectId}
              disabled={Boolean(pinnedProject)}
              title={pinnedProject ? 'Workspace is locked to this project' : undefined}
            />
          </div>
        </div>
      </div>
    </div>
    </PluginComposerChrome>
  );
}
