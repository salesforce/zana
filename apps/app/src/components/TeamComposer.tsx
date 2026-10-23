import { product } from '../lib/product-client.js';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, FileText, Folder, Loader2, Paperclip, Users, X } from 'lucide-react';
import type { ExecutionSourceCapabilityView, Project, TeamAvailabilityUnknown, TeamCoordinationMode, TeamRequirementFailure } from '@zana-ai/zcc-domain/product';
import {
  CommandComposer,
  ComposerIconButton,
  ComposerToolbar
} from './ui/CommandComposer.js';
import { planningToCoordinationMode, type SquadLaunchPrefill } from '@zana-ai/zcc-domain/squad-proposal';
import { VoiceRecordingBar } from './thread/voice/VoiceRecordingBar.js';
import { useVoiceInput } from './thread/voice/useVoiceInput.js';
import { VoiceMicButton } from './thread/voice/VoiceMicButton.js';
import { useData, useTeams, useUi } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { posixQuote } from '../lib/quote.js';
import { attachmentName } from '../lib/attachments.js';
import { persistComposerImages } from '../lib/prompt-attachments.js';
import { ComposerProjectPicker } from './ComposerProjectPicker.js';
import { composerProjectOptions, preferredComposerProjectId, resolveComposerProjectId, type ComposerProjectSelectionProps } from './composer-project-default.js';
import { PluginComposerChrome } from '../plugins/PluginComposerChrome.js';
import { ComposerPromptField } from './composer/ComposerPromptField.js';
import { useComposerPromptField } from './composer/use-composer-prompt-field.js';
import { useComposerSession, useComposerSetting } from './composer/ComposerDraft.js';
import { applyRenewedSources } from './team-composer-sources.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { squadPicklistOption } from './SquadTransportChip.js';
import { defaultAutonomousTeamId } from './autonomous-team-composer.js';
import {
  assembleCliLaunchPrompt,
  composerDropProjectRoot,
  stageRemoteComposerAttachments
} from './legacy-agent-home.js';
import { platformShortcut } from '../lib/platformShortcut.js';
import { sortCatalogueByName } from '../lib/catalogue-sort.js';

/** A source chip. A file outside the project (proposed from HOME or the clone root) shows its path. */
type ComposerSource = ExecutionSourceCapabilityView & { path?: string; outsideProject?: boolean };

/** One durable Team launch surface for inferred and user-provided plans. */
export function TeamComposer({
  project: pinnedProject,
  composerProjectId,
  onComposerProjectIdChange,
  initialText,
  prefill,
  onClose
}: {
  project?: Project;
  initialText?: string;
  /** A reviewed proposal from a conversation; seeds the form and tags the launch with its id. */
  prefill?: SquadLaunchPrefill;
  onClose?: () => void;
} & ComposerProjectSelectionProps) {
  const session = useComposerSession();
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const teams = useTeams(useShallow((s) => s.teams));
  const pushToast = useUi((s) => s.pushToast);
  const openProjectSettings = useUi((s) => s.openProjectSettings);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const lastProjectId = useData((s) => s.lastProjectId);
  const [internalProjectId, setInternalProjectId] = useComposerSetting(session, 'projectId', pinnedProject?.id ?? (composerProjectId || prefill?.projectId) ?? '');
  const projectId = pinnedProject?.id
    ?? (onComposerProjectIdChange ? (composerProjectId || internalProjectId) : internalProjectId);
  const setProjectId = (nextProjectId: string | ((current: string) => string)) => {
    const resolved = typeof nextProjectId === 'function' ? nextProjectId(projectId) : nextProjectId;
    if (!onComposerProjectIdChange) setInternalProjectId(resolved);
    onComposerProjectIdChange?.(resolved);
  };
  const preferredProjectId = preferredComposerProjectId({ projects, lastProjectId, selectedProjectId });
  const [teamId, setTeamId] = useComposerSetting(session, 'team.id', prefill?.teamId ?? '');
  const [coordinationMode, setCoordinationMode] = useComposerSetting<Extract<TeamCoordinationMode, 'structured' | 'freeform'>>(session, 'team.coordination',
    () => prefill?.coordinationMode ?? useData.getState().teamDefaultCoordinationMode
  );
  const [title, setTitle] = useComposerSetting(session, 'team.title', prefill?.title ?? '', { content: true });
  const [summary, setSummary] = useComposerSetting(session, 'team.summary', prefill?.summary ?? '', { content: true });
  const [jobSources, setJobSources] = useState<ComposerSource[]>(() => prefill?.sources ?? []);
  // Pre-filled sources belong to `prefill.projectId`; keep them while the
  // project is still resolving to it.
  const prefillSourcesGuardRef = useRef(Boolean(prefill?.sources.length));
  const [pickingSources, setPickingSources] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobSourcesRef = useRef(jobSources);
  jobSourcesRef.current = jobSources;
  const [requirementFailure, setRequirementFailure] = useState<TeamRequirementFailure | null>(null);
  const [availabilityUnknown, setAvailabilityUnknown] = useState<TeamAvailabilityUnknown | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ensureScratchRef = useRef(false);
  const launchRef = useRef<() => void>(() => undefined);
  const launchProjects = useMemo(() => composerProjectOptions(projects), [projects]);
  const project = pinnedProject ?? launchProjects.find((candidate) => candidate.id === projectId);
  const sortedTeams = useMemo(() => sortCatalogueByName(teams), [teams]);
  const selectedTeam = teams.find((team) => team.id === teamId);

  const field = useComposerPromptField({
    placeholder: platformShortcut('Describe the GOAL for the squad to reach (⌘↵ to launch). Attach or drop supporting files.'),
    testId: 'team-command-input',
    ariaLabel: 'Goal for the squad',
    projectId,
    projectRoot: composerDropProjectRoot(project),
    projects,
    disabled: launching,
    initialText: initialText ?? prefill?.goal,
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

  // The selected Squad's planning default applies, whether picked or auto-selected, until
  // the user picks a planning mode themselves. A reviewed proposal keeps its own mode.
  const planningTouchedRef = useRef(false);
  const selectedTeamPlanning = selectedTeam?.defaultPlanning;
  useEffect(() => {
    if (prefill || planningTouchedRef.current || !selectedTeamPlanning) return;
    setCoordinationMode(planningToCoordinationMode(selectedTeamPlanning));
  }, [prefill, selectedTeamPlanning]);

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
    if (prefillSourcesGuardRef.current) {
      if (!project?.id) return;
      prefillSourcesGuardRef.current = false;
      if (project.id === prefill?.projectId) return;
    }
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
    if (field.typeaheadOpen && field.suggestions.length > 0) return;
    setError(null);
    setRequirementFailure(null);
    setAvailabilityUnknown(null);
    setLaunching(true);
    const revision = field.captureRevision();
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
      const goal = assembleCliLaunchPrompt({ text: promptText, imagePaths });
      if (!goal) {
        setError('Describe a goal for the squad');
        return;
      }
      const res = await product.teams.startJob({
        teamId,
        projectId: project.id,
        goal,
        coordinationMode,
        ...(prefill ? { proposalId: prefill.proposalId } : {}),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(jobSources.length ? { sourceCapabilityIds: jobSources.map(({ id }) => id) } : {})
      });
      if (!res.ok) {
        // The failed launch consumed the attached files; swap in the re-issued ones so Launch/Retry work.
        let notices: string[] = [];
        if (res.sources) {
          notices = applyRenewedSources(jobSourcesRef.current, res.sources).notices;
          const renewal = res.sources;
          setJobSources((current) => applyRenewedSources(current, renewal).sources);
        }
        if (res.code === 'REQUIREMENT_UNAVAILABLE' && 'requirementFailure' in res) {
          setRequirementFailure(res.requirementFailure);
          for (const notice of notices) pushToast(notice, 'error');
          return;
        }
        if (res.code === 'CAPABILITY_AVAILABILITY_UNKNOWN' && 'availabilityUnknown' in res) {
          setAvailabilityUnknown(res.availabilityUnknown);
          for (const notice of notices) pushToast(notice, 'error');
          return;
        }
        const message = `Squad launch failed: ${res.message ?? res.code}`;
        setError([notices.length ? message.replace(/[.!?]?$/, '.') : message, ...notices].join(' '));
        pushToast(message, 'error');
        for (const notice of notices) pushToast(notice, 'error');
        return;
      }
      field.clearIfRevision(revision);
      setTitle('');
      setSummary('');
      setJobSources([]);
      pushToast('Squad launched. Open Agents board to monitor it.');
      onClose?.();
    } catch (err) {
      const message = `Squad launch failed: ${err instanceof Error ? err.message : String(err)}`;
      setError(message);
      pushToast(message, 'error');
    } finally {
      setLaunching(false);
    }
  };
  const cancelRequirementFailure = () => {
    // Admission rejected before execution claim, authorization, or worker spawn.
    setRequirementFailure(null);
    setAvailabilityUnknown(null);
    onClose?.();
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
      <span id="team-command-label" className="thread-command-label">Squad composer</span>
      {requirementFailure ? (
        <section className="team-requirement-failure" role="alert" aria-labelledby="team-requirement-failure-title">
          <h2 id="team-requirement-failure-title">Squad requirements need attention</h2>
          <p>No workers started. Resolve requirements, then launch again.</p>
          {requirementFailure.workUnits.map((unit) => (
            <article key={unit.id} className="team-requirement-failure-unit">
              <h3>{unit.title}</h3>
              {unit.missingSkills.length ? <><h4>Missing Skills</h4><ul>{unit.missingSkills.map((skill) => <li key={skill}>{skill}</li>)}</ul></> : null}
              {unit.missingMcpServers.length ? <><h4>Missing MCP servers</h4><ul>{unit.missingMcpServers.map((server) => <li key={server}>{server}</li>)}</ul></> : null}
              <p>Configure this project or edit this plan to meet requirements. A listed Skill or MCP server may be missing or installed but disabled.</p>
              <p>Choose another project with project selector below, or ask a normal agent: “Complete this work without these Skills or MCP servers.”</p>
            </article>
          ))}
          <div className="team-requirement-failure-actions">
            {project ? <button type="button" className="btn" onClick={() => openProjectSettings(project.id)}>Configure project</button> : null}
            <button type="button" className="btn" onClick={() => { setRequirementFailure(null); field.focus(); }}>Edit plan</button>
            <button type="button" className="btn" onClick={cancelRequirementFailure}>Cancel</button>
          </div>
          <details>
            <summary>Details</summary>
            <dl>
              <dt>Error code</dt><dd><code>REQUIREMENT_UNAVAILABLE</code></dd>
              {requirementFailure.workUnits.map((unit) => <Fragment key={unit.id}><dt>Work unit ID</dt><dd><code>{unit.id}</code></dd></Fragment>)}
            </dl>
          </details>
        </section>
      ) : null}
      {availabilityUnknown ? (
        <section className="team-requirement-failure" role="alert" aria-labelledby="team-availability-unknown-title">
          <h2 id="team-availability-unknown-title">Project capabilities could not be verified</h2>
          <p>No workers started. Retry after connection or capability discovery is available.</p>
          <div className="team-requirement-failure-actions">
            <button type="button" className="btn" onClick={() => { void launch(); }}>Retry</button>
            <button type="button" className="btn" onClick={cancelRequirementFailure}>Cancel</button>
          </div>
          <details>
            <summary>Details</summary>
            <dl>
              <dt>Error code</dt><dd><code>CAPABILITY_AVAILABILITY_UNKNOWN</code></dd>
              <dt>Failed sources</dt><dd>{availabilityUnknown.failedSources.map((source) => source === 'skills' ? 'Skills' : 'MCP servers').join(', ')}</dd>
            </dl>
          </details>
        </section>
      ) : null}
      {prefill ? (
        <section className="team-composer-origin-banner" role="note" aria-label="Prepared by a conversation">
          <strong>Prepared by “{prefill.proposerTitle ?? 'a conversation'}”</strong>
          <p>
            {prefill.planStepCount != null ? `Plan checked: ${prefill.planStepCount} ${prefill.planStepCount === 1 ? 'step' : 'steps'}. ` : ''}
            Files are captured when you press Launch, so later edits are not included. When the Squad finishes or needs you, it reports back to that conversation.
          </p>
        </section>
      ) : null}
      {error ? (
        <p className="thread-command-error" data-testid="team-command-error">{error}</p>
      ) : null}
      {teams.length === 0 ? (
        <p className="thread-command-error" role="status">No squads configured.</p>
      ) : null}
      <CommandComposer
        className="home-agent-command thread-command-card"
        labelledBy="team-command-label"
        aria-busy={launching}
      >
        <ComposerPromptField
          editor={field.editor}
          imageInputProps={field.imageInputProps}
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
                    ariaLabel="Squad"
                    placeholder="Select a squad"
                    searchable={teams.length > 6}
                    options={sortedTeams.map((team) => squadPicklistOption(team, { withDescription: true }))}
                    // The selected Squad's planning default is applied by the effect above, which
                    // keeps a planning mode the user (or a reviewed proposal) already chose.
                    onChange={setTeamId}
                    disabled={teams.length === 0}
                    emptyHint="No squads configured"
                  />
                </div>
                <div className="thread-command-chip">
                  <PopoverPicklist
                    id="team-coordination-mode"
                    value={coordinationMode}
                    ariaLabel="Squad planning"
                    searchable={false}
                    options={[
                      { value: 'freeform', label: 'Infer plan from goal' },
                      { value: 'structured', label: 'Plan provided in goal' }
                    ]}
                    onChange={(value) => {
                      planningTouchedRef.current = true;
                      setCoordinationMode(value as typeof coordinationMode);
                    }}
                  />
                </div>
              </div>
              <div className="thread-command-footer-end">
                <span className="composer-control-tooltip" data-tooltip={field.canAttach ? 'Attach files' : 'Attachments are unavailable while sending'}>
                  <ComposerIconButton
                    onClick={() => { if (!field.canAttach) return; field.attachPickedFiles(); }}
                    disabled={!field.canAttach}
                    aria-label="Attach files"
                  >
                    <Paperclip size={14} aria-hidden="true" />
                  </ComposerIconButton>
                </span>
                <span className="composer-control-tooltip" data-tooltip="Attach source files for the squad to work from">
                  <ComposerIconButton
                    onClick={() => void pickSources()}
                    disabled={!project || pickingSources}
                    aria-label="Attach sources"
                  >
                    <FileText size={14} aria-hidden="true" />
                  </ComposerIconButton>
                </span>
                <VoiceMicButton voice={voice} />
                <ComposerIconButton
                    className={`thread-command-send${launching ? ' is-sending' : ''}`}
                    aria-label={launching ? 'Launching squad' : 'Launch squad'}
                    title={launching ? 'Launching squad' : 'Launch squad'}
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
            <li key={source.id} className="launch-attachment-pill" {...(source.outsideProject ? { title: source.path } : {})}>
              <FileText size={12} aria-hidden="true" />
              <span>{source.outsideProject && source.path ? source.path : source.name}</span>
              {source.outsideProject ? <span className="launch-attachment-outside">outside the Project</span> : null}
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
      <div className="launch-job-details" role="group" aria-label="Squad details">
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
            placeholder="Add context for this squad"
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
