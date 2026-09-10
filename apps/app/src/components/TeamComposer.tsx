import { product } from '../lib/product-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, FileText, Folder, Loader2, Mic, Paperclip, Users, X } from 'lucide-react';
import type { ExecutionSourceCapabilityView, Project, TeamCoordinationMode } from '@zana-ai/zcc-domain/product';
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
import { composerProjectOptions, resolveComposerProjectId, type ComposerProjectSelectionProps } from './composer-project-default.js';
import { PluginComposerChrome } from '../plugins/PluginComposerChrome.js';
import { ComposerPromptField } from './composer/ComposerPromptField.js';
import { useComposerPromptField } from './composer/use-composer-prompt-field.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { defaultAutonomousTeamId } from './autonomous-team-composer.js';
import {
  absolutePathMentions,
  assembleCliLaunchPrompt,
  rewritePromptPaths
} from './legacy-agent-home.js';

/** One durable Team launch surface for inferred and user-provided plans. */
export function TeamComposer({
  project: pinnedProject,
  composerProjectId,
  onComposerProjectIdChange,
  initialText,
  onClose
}: {
  project?: Project;
  initialText?: string;
  onClose?: () => void;
} & ComposerProjectSelectionProps) {
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const teams = useTeams(useShallow((s) => s.teams));
  const pushToast = useUi((s) => s.pushToast);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const lastProjectId = useData((s) => s.lastProjectId);
  const [internalProjectId, setInternalProjectId] = useState(pinnedProject?.id ?? composerProjectId ?? '');
  const projectId = pinnedProject?.id
    ?? (onComposerProjectIdChange ? (composerProjectId || internalProjectId) : internalProjectId);
  const setProjectId = (nextProjectId: string | ((current: string) => string)) => {
    const resolved = typeof nextProjectId === 'function' ? nextProjectId(projectId) : nextProjectId;
    if (!onComposerProjectIdChange) setInternalProjectId(resolved);
    onComposerProjectIdChange?.(resolved);
  };
  const preferredProjectId = selectedProjectId ?? lastProjectId;
  const [teamId, setTeamId] = useState('');
  const [coordinationMode, setCoordinationMode] = useState<Extract<TeamCoordinationMode, 'structured' | 'freeform'>>('freeform');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [jobSources, setJobSources] = useState<ExecutionSourceCapabilityView[]>([]);
  const [pickingSources, setPickingSources] = useState(false);
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
    testId: 'team-command-input',
    ariaLabel: 'Goal for the team',
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
  }, [loadProjects, pinnedProject, preferredProjectId, projectId, projects, selectedTeam?.defaultProjectId]);

  // A previous project's picked source capabilities are meaningless (and
  // unsafe to submit) once the effective project changes — clear them so a
  // stale capability id from project A never rides along with a job launched
  // against project B.
  useEffect(() => {
    setJobSources([]);
  }, [project?.id]);

  const goalReady = field.text.trim().length > 0 || field.images.length > 0;
  const canLaunch = Boolean(teamId && project && goalReady && !launching);

  const pickSources = async () => {
    if (!project) return;
    setPickingSources(true);
    try {
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
    } catch (err) {
      const message = `Failed to attach sources: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[TeamComposer] pickSources failed', err);
      setError(message);
      pushToast(message, 'error');
    } finally {
      setPickingSources(false);
    }
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
        // Upload concurrently — the awaits are independent per file. Each
        // file still reports its own success/failure via its own toast
        // (order preserved), but we preserve the original semantics of
        // aborting the launch if any upload failed, since a partially
        // uploaded mention set is not safe to submit as a job goal.
        const remoteHost = project.remote.host;
        const uploads = await Promise.all(
          absolutePathMentions(serialized.mentions).map(async (localPath) => ({
            localPath,
            result: await product.fs.uploadToRemote(project.id, localPath, '.')
          }))
        );
        const uploaded: Array<{ from: string; to: string }> = [];
        let uploadFailed = false;
        for (const { localPath, result } of uploads) {
          if (!result.ok || !result.path) {
            pushToast(result.message ?? `Failed to upload ${attachmentName(localPath)}`, 'error');
            uploadFailed = true;
            continue;
          }
          uploaded.push({ from: localPath, to: posixQuote(result.path) });
          pushToast(`Uploaded ${attachmentName(localPath)} to ${remoteHost}`);
        }
        if (uploadFailed) return;
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
        coordinationMode,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(jobSources.length ? { sourceCapabilityIds: jobSources.map(({ id }) => id) } : {})
      });
      if (!res.ok) {
        const message = `Team launch failed: ${res.message ?? res.code}`;
        setError(message);
        pushToast(message, 'error');
        return;
      }
      field.clear();
      setTitle('');
      setSummary('');
      setJobSources([]);
      pushToast('Team launched. Open Agents board to monitor it.');
      onClose?.();
    } catch (err) {
      const message = `Team launch failed: ${err instanceof Error ? err.message : String(err)}`;
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
      <span id="team-command-label" className="thread-command-label">Team composer</span>
      {error ? (
        <p className="thread-command-error" data-testid="team-command-error">{error}</p>
      ) : null}
      {teams.length === 0 ? (
        <p className="thread-command-error" role="status">No teams configured.</p>
      ) : null}
      <CommandComposer
        className="home-agent-command thread-command-card"
        labelledBy="team-command-label"
        aria-busy={launching}
      >
        <ComposerPromptField
          editor={field.editor}
          images={field.images}
          onRemoveImage={field.removeImage}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((current) => !current)}
          expandTestId="team-command-expand"
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
                    id="team-picker"
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
                <div className="thread-command-chip">
                  <PopoverPicklist
                    id="team-coordination-mode"
                    value={coordinationMode}
                    ariaLabel="Team planning"
                    searchable={false}
                    options={[
                      { value: 'freeform', label: 'Infer plan from goal' },
                      { value: 'structured', label: 'Plan provided in goal' }
                    ]}
                    onChange={(value) => setCoordinationMode(value as typeof coordinationMode)}
                  />
                </div>
              </div>
              <div className="thread-command-footer-end">
                <span className="composer-control-tooltip" data-tooltip={field.canAttach ? 'Attach files' : 'File attachments require the desktop app'}>
                  <ComposerIconButton
                    onClick={() => { if (!field.canAttach) return; field.attachPickedFiles(); }}
                    disabled={!field.canAttach}
                    aria-label="Attach files"
                  >
                    <Paperclip size={14} aria-hidden="true" />
                  </ComposerIconButton>
                </span>
                <span className="composer-control-tooltip" data-tooltip="Attach source files for the team to work from">
                  <ComposerIconButton
                    onClick={() => void pickSources()}
                    disabled={!project || pickingSources}
                    aria-label="Attach sources"
                  >
                    <FileText size={14} aria-hidden="true" />
                  </ComposerIconButton>
                </span>
                <span className="composer-control-tooltip" data-tooltip={
                  !voice.isSupported
                    ? 'Voice input is not supported in this browser'
                    : !voice.available
                      ? 'Host daemon is not connected'
                      : 'Start voice input'
                }>
                  <ComposerIconButton
                    className="voice-input-btn voice-input-btn--icon"
                    aria-label={
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
                </span>
                <ComposerIconButton
                    className={`thread-command-send${launching ? ' is-sending' : ''}`}
                    aria-label={launching ? 'Launching team' : 'Launch team'}
                    title={launching ? 'Launching team' : 'Launch team'}
                    aria-busy={launching}
                    data-testid="team-command-send"
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
      <div className="launch-job-details" role="group" aria-label="Team details">
        <label className="workflow-arg-field" htmlFor="team-title">
          <span>Title <span className="launch-optional">Optional</span></span>
          <input
            id="team-title"
            type="text"
            maxLength={256}
            value={title}
            placeholder="Defaults from goal"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="workflow-arg-field" htmlFor="team-summary">
          <span>Summary <span className="launch-optional">Optional</span></span>
          <textarea
            id="team-summary"
            rows={3}
            maxLength={4000}
            value={summary}
            placeholder="Add context for this team"
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
