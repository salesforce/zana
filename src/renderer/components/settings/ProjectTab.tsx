import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import type {
  Project,
  ProjectSettings,
  ClaudeProjectSettings,
  ClaudeSettingsScope,
  ClaudeSettingsResult,
  HarnessFamily,
  LaunchProfileId,
  ProjectExecutionConsentGrant
} from '@shared/types';
import { executionMappingOptions, type HarnessAdapterDescriptor } from '@shared/harness-adapter';
import { providerUiSchema } from '@shared/launch-provider';
import { useData, useUi } from '../../store';
import { Section, Field, ChipField, TextArgsField } from './FormFields';
import { HarnessOptionSelect } from '../HarnessOptionSelect';
import { profileIcon } from '../../util/profileIcon';

const USE_DEFAULT = { id: '', label: 'Use default' } as const;
const CODEX_UI = providerUiSchema('codex');
const FAMILY_PROFILE: Record<HarnessFamily, LaunchProfileId> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode'
};

interface ProjectTabProps {
  project: Project | null;
  onOpen: (path: string) => void;
  onSaved: () => void;
}

export function ProjectTab({
  project,
  onOpen,
  onSaved
}: ProjectTabProps) {
  if (!project) {
    return (
      <Section title="No project selected">
        <p className="settings-help">
          Select a project in the sidebar to manage its CLI flags, MCP servers, and config files.
        </p>
      </Section>
    );
  }

  return (
    <>
      {project.remote && <ProjectRemoteSettings project={project} onSaved={onSaved} />}

      <ProjectHarnessSettings project={project} onSaved={onSaved} />

      {!project.remote && !project.quickAgent && (
        <ProjectWorktreeSettings project={project} onSaved={onSaved} />
      )}

      <ProjectExecutionConsentSettings project={project} onSaved={onSaved} />

      {!project.remote && (
        <ProjectClaudeSettings projectPath={project.path} onSaved={onSaved} onOpen={onOpen} />
      )}

      <Section title="Quick open" help="Opens project config files in Cursor.">
        <div className="settings-btn-row">
          <button className="settings-btn" onClick={() => onOpen(`${project.path}/CLAUDE.md`)}>
            {project.name}/CLAUDE.md
          </button>
          <button className="settings-btn" onClick={() => onOpen(`${project.path}/.mcp.json`)}>
            {project.name}/.mcp.json
          </button>
          <button
            className="settings-btn"
            onClick={() => onOpen(`${project.path}/.claude/settings.local.json`)}
          >
            {project.name}/.claude/settings.local.json
          </button>
        </div>
      </Section>
    </>
  );
}

export function ProjectExecutionConsentSettings({
  project,
  onSaved
}: {
  project: Project;
  onSaved: () => void;
}) {
  const [grants, setGrants] = useState<ProjectExecutionConsentGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setGrants(await window.cc.executionConsent.listProject(project.id));
    } catch (err) {
      setGrants([]);
      setError(err instanceof Error ? err.message : 'Failed to load execution grants');
    }
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setGrants(null);
    setError(null);
    window.cc.executionConsent.listProject(project.id)
      .then((value) => { if (!cancelled) setGrants(value); })
      .catch((err) => {
        if (!cancelled) {
          setGrants([]);
          setError(err instanceof Error ? err.message : 'Failed to load execution grants');
        }
      });
    return () => { cancelled = true; };
  }, [project.id]);

  const revoke = async (grant: ProjectExecutionConsentGrant) => {
    setRevokingId(grant.id);
    setError(null);
    try {
      setGrants(await window.cc.executionConsent.revokeProject(project.id, grant.id));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke execution grant');
      await load();
    } finally {
      setRevokingId(null);
    }
  };

  if (!shouldShowExecutionConsent(grants, error)) return null;

  return (
    <Section
      title="Execution consent"
      help="Execution consent lets a matching harness use an approved execution mode in this project without asking again. It is not a reusable harness preference; revoking affects this project only."
    >
      <ProjectExecutionConsentList
        projectName={project.name}
        grants={grants}
        revokingId={revokingId}
        onRevoke={(grant) => void revoke(grant)}
      />
      {error && <p className="modal-error" role="alert">{error}</p>}
    </Section>
  );
}

export function ProjectWorktreeSettings({
  project,
  onSaved
}: {
  project: Project;
  onSaved: () => void;
}) {
  const pushToast = useUi((s) => s.pushToast);
  const [value, setValue] = useState<boolean | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    window.cc.projectSettings.get(project.id)
      .then((settings) => {
        if (!cancelled) {
          setValue(settings.worktreeIsolation);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(projectSettingsErrorMessage(cause));
          setLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [project.id]);

  const save = async (next: boolean | undefined) => {
    if (saving) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const canonical = await persistProjectSettings(
        project.id,
        { worktreeIsolation: next },
        (id, patch) => window.cc.projectSettings.set(id, patch)
      );
      setValue(canonical.worktreeIsolation);
      onSaved();
    } catch (cause) {
      setValue(previous);
      const message = projectSettingsErrorMessage(cause);
      setError(message);
      pushToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Git worktrees"
      help="Choose whether new agents for this project use separate branches and checkouts. This project setting overrides the global Agents default."
    >
      {loaded ? (
        <ProjectWorktreeIsolationField
          value={value}
          disabled={saving}
          onChange={(next) => void save(next)}
        />
      ) : (
        <p className="settings-help" role="status">Loading worktree settings...</p>
      )}
      {error && <ProjectSettingsError message={error} />}
    </Section>
  );
}

export function shouldShowExecutionConsent(
  grants: ProjectExecutionConsentGrant[] | null,
  error: string | null
): boolean {
  return !!error || (grants?.length ?? 0) > 0;
}

export function ProjectExecutionConsentList({
  projectName,
  grants,
  revokingId,
  onRevoke
}: {
  projectName: string;
  grants: ProjectExecutionConsentGrant[] | null;
  revokingId: string | null;
  onRevoke: (grant: ProjectExecutionConsentGrant) => void;
}) {
  if (grants === null) {
    return <p className="settings-help" role="status">Loading execution grants...</p>;
  }
  if (grants.length === 0) {
    return <p className="settings-help" role="status">No active project execution grants.</p>;
  }
  return (
    <ul className="settings-list" aria-label={`Execution grants for ${projectName}`}>
      {grants.map((grant) => (
        <li className="settings-list-row execution-consent-row" key={grant.id}>
          <div className="execution-consent-details">
            <span className="settings-list-name">{grant.adapterId}</span>
            <span className="settings-help">
              {grant.targetId} · {grant.launchScope} · granted {new Date(grant.createdAt).toLocaleDateString()}
              {grant.expiresAt ? ` · expires ${new Date(grant.expiresAt).toLocaleDateString()}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="settings-btn danger"
            disabled={revokingId !== null}
            aria-label={`Revoke ${grant.adapterId} execution grant for ${projectName}`}
            onClick={() => onRevoke(grant)}
          >
            {revokingId === grant.id ? 'Revoking...' : 'Revoke'}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProjectHarnessSettings({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const updateProject = useData((s) => s.updateProject);
  const pushToast = useUi((s) => s.pushToast);
  const [descriptors, setDescriptors] = useState<HarnessAdapterDescriptor[] | null>(null);
  const [settingsState, setSettingsState] = useState<{ projectId: string; value: ProjectSettings } | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [openHarnesses, setOpenHarnesses] = useState<Set<string>>(() => new Set());
  const writeSequence = useRef(0);
  const currentProjectId = useRef(project.id);

  useEffect(() => {
    let cancelled = false;
    window.cc.harness.descriptors()
      .then((value) => { if (!cancelled) setDescriptors(value); })
      .catch(() => { if (!cancelled) setDescriptors([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    currentProjectId.current = project.id;
    writeSequence.current += 1;
    setSettingsState(null);
    setSettingsError(null);
    window.cc.projectSettings.get(project.id).then((value) => {
      if (!cancelled) setSettingsState({ projectId: project.id, value });
    }).catch((error) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : String(error);
        setSettingsError(`Could not load project harness settings: ${message}`);
      }
    });
    return () => { cancelled = true; };
  }, [project.id]);

  const settingsReady = settingsState?.projectId === project.id;
  const settings = settingsReady ? settingsState.value : null;

  const current = project.launchDefault?.kind === 'exact-profile'
    ? project.launchDefault.adapterId
    : '';
  const options = (descriptors ?? []).filter((entry) => entry.agentDefaultEligible);

  const save = (adapterId: string) => {
    if (!settingsReady) return;
    if (!adapterId) {
      void updateProject(project.id, {
        launchDefault: { schemaVersion: 1, kind: 'use-global', source: 'settings' }
      }).then(onSaved);
      return;
    }
    const descriptor = options.find((entry) => entry.id === adapterId);
    if (!descriptor?.defaultProfileId || descriptor.id === 'shell') return;
    void updateProject(project.id, {
      launchDefault: {
        schemaVersion: 1,
        kind: 'exact-profile',
        adapterId: descriptor.id as HarnessFamily,
        profileId: descriptor.defaultProfileId,
        source: 'settings'
      }
    }).then(onSaved);
  };

  const saveSettings = async (patch: Partial<ProjectSettings>) => {
    if (!settings) return;
    const sequence = ++writeSequence.current;
    const previous = settings;
    setSettingsError(null);
    setSettingsState({ projectId: project.id, value: { ...settings, ...patch } });
    try {
      const canonical = await persistProjectSettings(
        project.id,
        patch,
        (id, value) => window.cc.projectSettings.set(id, value)
      );
      if (project.id === currentProjectId.current && sequence === writeSequence.current) {
        setSettingsState({ projectId: project.id, value: canonical });
        onSaved();
      }
    } catch (error) {
      if (project.id !== currentProjectId.current || sequence !== writeSequence.current) return;
      const message = projectSettingsErrorMessage(error);
      setSettingsState({ projectId: project.id, value: previous });
      setSettingsError(message);
      pushToast(message, 'error');
    }
  };

  const saveRouting = (
    adapterId: HarnessFamily,
    patch: { providerTargetId?: string; modelTargetId?: string; executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous' }
  ) => {
    if (!settings) return;
    const byAdapter = { ...(settings.harnessRouting?.byAdapter ?? {}) };
    const current = byAdapter[adapterId] ?? {};
    const next = { ...current, ...patch };
    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      if (next[key] === undefined) delete next[key];
    }
    if (Object.keys(next).length) byAdapter[adapterId] = next;
    else delete byAdapter[adapterId];
    const harnessRouting = Object.keys(byAdapter).length
      ? { schemaVersion: 1 as const, byAdapter }
      : undefined;
    saveSettings({ harnessRouting });
  };

  const toggleHarness = (id: string) => {
    setOpenHarnesses((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const portableLabel = (value: string) => value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return (
    <Section
      title="Code harnesses"
      help="Project settings apply after Global defaults and before Persona and Agent choices: Global → Project → Persona → Agent. Later choices take priority when a setting cannot be combined."
    >
      <Field label="Default harness">
        {descriptors === null || !settingsReady ? (
          <span className="settings-help" role="status">Loading project harness settings...</span>
        ) : (
          <select value={current} onChange={(event) => save(event.target.value)}>
            <option value="">Use global default</option>
            {options.map((entry) => (
              <option
                key={entry.id}
                value={entry.id}
                disabled={!entry.availability.enabled || !entry.availability.installed}
              >
                {entry.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {settingsError && <ProjectSettingsError message={settingsError} />}
      <div className="opener-list">
        {settings && options.map((descriptor) => {
          const id = descriptor.id as HarnessFamily;
          const open = openHarnesses.has(id);
          const routing = settings.harnessRouting?.byAdapter?.[id];
          const executionMapping = descriptor.targets?.executionStateMapping;
          const unavailable = !descriptor.availability.enabled || !descriptor.availability.installed;
          const enabled = id === 'claude' || descriptor.availability.enabled;
          return (
            <div className={`opener-row${enabled ? '' : ' opener-row--off'}`} key={id}>
              <div className="opener-row-head">
                <button
                  type="button"
                  className="opener-row-expand"
                  aria-expanded={open}
                  aria-label={`Project settings for ${descriptor.label}`}
                  onClick={() => toggleHarness(id)}
                >
                  <ChevronRight size={14} className={open ? 'opener-row-chevron opener-row-chevron--open' : 'opener-row-chevron'} aria-hidden />
                </button>
                <span className="opener-row-glyph" aria-hidden>
                  {profileIcon(FAMILY_PROFILE[id], 17)}
                </span>
                <div className="opener-row-text">
                  <span className="opener-row-name">{descriptor.label}</span>
                  <span className="opener-row-blurb">Project-specific launch settings</span>
                </div>
              </div>
              {open ? (
                <div className="opener-row-advanced">
                  <fieldset disabled={unavailable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  {!!descriptor.targets?.providers?.length && (
                    <Field label="Default Provider" help={descriptor.targets.providerModelRelationship === 'fixed-provider'
                      ? `${descriptor.label} uses this fixed provider.`
                      : 'Selects which provider’s models appear below. Combined provider/model harnesses encode this choice in the model id.'}>
                      <select
                        value={routing?.providerTargetId
                          ?? descriptor.targets.models.find((target) => target.id === routing?.modelTargetId)?.provider
                          ?? (descriptor.targets.providerModelRelationship === 'fixed-provider' ? descriptor.targets.providers[0]?.id : '')}
                        disabled={descriptor.targets.providerModelRelationship === 'fixed-provider'}
                        onChange={(event) => {
                          const providerTargetId = event.target.value || undefined;
                          const currentModel = descriptor.targets?.models.find((target) => target.id === routing?.modelTargetId);
                          saveRouting(id, {
                            providerTargetId,
                            ...(!providerTargetId || (currentModel && currentModel.provider !== providerTargetId)
                              ? { modelTargetId: undefined }
                              : {})
                          });
                        }}
                      >
                        {descriptor.targets.providerModelRelationship !== 'fixed-provider' && <option value="">Use global default</option>}
                        {descriptor.targets.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                      </select>
                    </Field>
                  )}
                  {!!descriptor.targets?.models.length && (
                    <Field label="Default Model Level" help={`Native ${descriptor.label} models with portable mappings.`}>
                      <select
                        value={routing?.modelTargetId ?? ''}
                        onChange={(event) => saveRouting(id, { modelTargetId: event.target.value || undefined })}
                        disabled={unavailable}
                        title={unavailable ? descriptor.availability.reason ?? 'Harness unavailable' : undefined}
                      >
                        <option value="">Use global default</option>
                        {descriptor.targets.models
                          .filter((target) => !routing?.providerTargetId || !target.provider || target.provider === routing.providerTargetId)
                          .map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}{target.level ? ` [${portableLabel(target.level)}]` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {executionMapping && id !== 'codex' && (
                    <Field label="Default Execution State" help={`Native ${descriptor.label} policies with portable mappings.`}>
                      <select
                        value={routing?.executionState ?? ''}
                        onChange={(event) => saveRouting(id, {
                          executionState: (event.target.value || undefined) as
                            | 'plan'
                            | 'interactive'
                            | 'accept-edits'
                            | 'autonomous'
                            | undefined
                        })}
                        disabled={unavailable}
                        title={unavailable ? descriptor.availability.reason ?? 'Harness unavailable' : undefined}
                      >
                        <option value="">Use global default</option>
                        {executionMappingOptions(executionMapping).map(({ id, native, states }) => (
                          <option key={id} value={id}>{native} [{states.map(portableLabel).join(', ')}]</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {id === 'claude' && (
                    <ClaudeProjectLaunchFields
                      settings={settings}
                      update={(patch) => setSettingsState({ projectId: project.id, value: { ...settings, ...patch } })}
                      save={(patch) => void saveSettings(patch)}
                    />
                  )}
                  {id === 'codex' && <CodexProjectLaunchFields settings={settings} save={(patch) => void saveSettings(patch)} />}
                  {id === 'pi' && <PiProjectLaunchFields settings={settings} save={(patch) => void saveSettings(patch)} />}
                  {!descriptor.targets?.models.length && !executionMapping && id !== 'claude' && id !== 'codex' && id !== 'pi' && (
                    <p className="settings-help">No project-specific settings are available for this harness.</p>
                  )}
                  </fieldset>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export function ProjectWorktreeIsolationField({
  value,
  disabled = false,
  onChange
}: {
  value: boolean | undefined;
  disabled?: boolean;
  onChange: (value: boolean | undefined) => void;
}) {
  const selected = value === true ? 'on' : value === false ? 'off' : 'inherit';
  return (
    <Field
      label="Worktree isolation"
      help="Controls the initial Worktree choice for new agents in this project. Main still verifies the folder is a Git repository before creating a worktree."
    >
      <select
        value={selected}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === 'on' ? true : next === 'off' ? false : undefined);
        }}
      >
        <option value="inherit">Use global default</option>
        <option value="on">Always use worktrees</option>
        <option value="off">Never use worktrees</option>
      </select>
    </Field>
  );
}

export function persistProjectSettings(
  projectId: string,
  patch: Partial<ProjectSettings>,
  write: (projectId: string, patch: Partial<ProjectSettings>) => Promise<ProjectSettings>
): Promise<ProjectSettings> {
  return write(projectId, patch);
}

export function projectSettingsErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not save project harness settings: ${message}`;
}

export function ProjectSettingsError({ message }: { message: string }) {
  return <p className="settings-help" role="alert">{message}</p>;
}

function CodexProjectLaunchFields({
  settings,
  save
}: {
  settings: ProjectSettings;
  save: (patch: Partial<ProjectSettings>) => void;
}) {
  return (
    <>
      <Field
        label="Default Sandbox Policy"
        help="Controls filesystem and command isolation for this project. Bracketed text shows which portable Persona/Agent Execution State normally selects this policy."
      >
        <HarnessOptionSelect
          id="project-codex-sandbox"
          options={CODEX_UI.sandboxes}
          value={settings.codexSandbox ?? ''}
          onChange={(value) => save({ codexSandbox: (value as ProjectSettings['codexSandbox']) || undefined })}
          sentinel={USE_DEFAULT}
          dropDefaultId
        />
      </Field>
      <Field
        label="Default Approval Policy"
        help="Controls when Codex asks before acting in this project. Bracketed text shows which portable Persona/Agent Execution State normally selects this policy."
      >
        <HarnessOptionSelect
          id="project-codex-approval"
          options={CODEX_UI.approvals}
          value={settings.codexApproval ?? ''}
          onChange={(value) => save({ codexApproval: (value as ProjectSettings['codexApproval']) || undefined })}
          sentinel={USE_DEFAULT}
          dropDefaultId
        />
      </Field>
    </>
  );
}

function PiProjectLaunchFields({
  settings,
  save
}: {
  settings: ProjectSettings;
  save: (patch: Partial<ProjectSettings>) => void;
}) {
  return (
    <>
      <Field label="Default Provider" help="Passed to PI as --provider. Leave blank to inherit the Global PI provider.">
        <input
          type="text"
          value={settings.piProvider ?? ''}
          placeholder="anthropic"
          onChange={(event) => save({ piProvider: event.target.value.trim() || undefined })}
        />
      </Field>
      <Field label="Default Model" help="Passed to PI as --model. Leave blank to inherit the Global PI model.">
        <input
          type="text"
          value={settings.piModel ?? ''}
          placeholder="anthropic/claude-opus-4-8"
          onChange={(event) => save({ piModel: event.target.value.trim() || undefined })}
        />
      </Field>
      <Field label="Default Thinking Level" help="Passed to PI as --thinking. Leave Default selected to inherit PI's native behavior.">
        <select
          value={settings.piThinking ?? 'default'}
          onChange={(event) => save({ piThinking: event.target.value as ProjectSettings['piThinking'] })}
        >
          <option value="default">Default</option>
          <option value="off">Off</option>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">XHigh</option>
          <option value="max">Max</option>
        </select>
      </Field>
    </>
  );
}

/**
 * Remote (SSH) connection settings for a remote project. Today just the start
 * path — the directory the terminal `cd`s into and the Explorer roots at.
 * Setting it matters for more than convenience: a claude session launched in the
 * remote `$HOME` (the default when no path is set) gets re-prompted for
 * folder-trust on every launch, because Claude Code refuses to persist trust for
 * a home-directory start. Pointing this at the real project dir lets trust stick.
 */
function ProjectRemoteSettings({
  project,
  onSaved
}: {
  project: Project;
  onSaved: () => void;
}) {
  const updateProject = useData((s) => s.updateProject);
  // Local draft mirrors the persisted value; committed on blur (same pattern as
  // the global "Default remote path" field).
  const [draft, setDraft] = useState(project.remote?.remotePath ?? '');
  // Re-sync when the selected project changes underneath us.
  useEffect(() => {
    setDraft(project.remote?.remotePath ?? '');
  }, [project.id, project.remote?.remotePath]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === (project.remote?.remotePath ?? '')) return;
    void updateProject(project.id, { remotePath: trimmed }).then(() => onSaved());
  };

  return (
    <Section
      title="Remote connection"
      help={`SSH: ${project.remote?.user ? `${project.remote.user}@` : ''}${project.remote?.host}`}
    >
      <Field
        label="Remote start path"
        mono
        help="The directory this project's terminal and Explorer open in on the remote host. Leave blank to use the global default remote path, then the remote $HOME. Tip: point this at the real project directory — a claude session started in $HOME re-asks “trust this folder?” every launch, because trust isn't saved for a home-directory start."
      >
        <input
          type="text"
          placeholder="defaults to remote $HOME"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </Field>
    </Section>
  );
}

function ClaudeProjectLaunchFields({
  settings,
  update,
  save
}: {
  settings: ProjectSettings;
  update: (patch: Partial<ProjectSettings>) => void;
  save: (patch: Partial<ProjectSettings>) => void;
}) {
  return (
    <>
      <Field
        label="Append system prompt"
        help="Additive: appended after Global prompt text and before Persona and Agent prompt text."
      >
        <textarea
          className="settings-textarea"
          rows={4}
          value={settings.appendSystemPrompt ?? ''}
          onChange={(e) => update({ appendSystemPrompt: e.target.value })}
          onBlur={(e) => {
            const val = e.target.value.trim() || undefined;
            save({ appendSystemPrompt: val });
          }}
          placeholder="Optional"
        />
      </Field>


      <TextArgsField
        label="Extra args"
        help="Applied after Global args and before Persona and Agent args. Later settings take priority when the same option appears more than once."
        values={settings.extraArgs ?? []}
        placeholder="--plugin-dir /path/to/plugin"
        onChange={(vals) => save({ extraArgs: vals.length ? vals : undefined })}
      />

      <ChipField
        label="Add dirs"
        help="Combined with directories from Global, Persona, and Agent settings."
        values={settings.addDirs ?? []}
        placeholder="/path/to/dir"
        onChange={(vals) => save({ addDirs: vals.length ? vals : undefined })}
      />

      <ChipField
        label="Allowed tools"
        help="Combined and deduplicated with allowed tools from Global, Persona, and Agent settings."
        values={settings.allowedTools ?? []}
        placeholder="Bash(git:*)"
        onChange={(vals) => save({ allowedTools: vals.length ? vals : undefined })}
      />

      <ChipField
        label="Denied tools"
        help="Combined and deduplicated across every level. Earlier denials remain in effect."
        values={settings.deniedTools ?? []}
        placeholder="Bash(rm:*)"
        onChange={(vals) => save({ deniedTools: vals.length ? vals : undefined })}
      />
    </>
  );
}

/**
 * Editor for `<project>/.claude/settings.json` (shared, committed) and
 * `<project>/.claude/settings.local.json` (personal, gitignored). Surfaces
 * `permissions.allow/deny/defaultMode/additionalDirectories` and the
 * top-level `model`. Anything else round-trips untouched via _unknown.
 */
function ProjectClaudeSettings({
  projectPath,
  onSaved,
  onOpen
}: {
  projectPath: string;
  onSaved: () => void;
  onOpen: (path: string) => void;
}) {
  const [shared, setShared] = useState<ClaudeSettingsResult | null>(null);
  const [local, setLocal] = useState<ClaudeSettingsResult | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [activeScope, setActiveScope] = useState<ClaudeSettingsScope>('shared');

  const load = useCallback(async () => {
    // Guard against a stale preload (electron-vite HMRs the renderer but
    // not the preload — devs hitting save before a full app restart see
    // window.cc.claudeSettings undefined). Surfacing a clear hint beats
    // a hanging spinner.
    if (!window.cc?.claudeSettings?.read) {
      setBindingError('claudeSettings binding not loaded — quit (⌘Q) and relaunch the app.');
      // Mark both scopes as "not present" so the cards render and the
      // user can still see the path / open in Cursor.
      const placeholder = (scope: 'shared' | 'local'): ClaudeSettingsResult => ({
        exists: false,
        path: `${projectPath}/.claude/${scope === 'shared' ? 'settings.json' : 'settings.local.json'}`,
        settings: {}
      });
      setShared(placeholder('shared'));
      setLocal(placeholder('local'));
      return;
    }
    setBindingError(null);
    try {
      const [s, l] = await Promise.all([
        window.cc.claudeSettings.read(projectPath, 'shared'),
        window.cc.claudeSettings.read(projectPath, 'local')
      ]);
      setShared(s);
      setLocal(l);
    } catch (err) {
      setBindingError(err instanceof Error ? err.message : 'Failed to load .claude/ settings');
    }
  }, [projectPath]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (scope: ClaudeSettingsScope, patch: ClaudeProjectSettings) => {
    try {
      const next = await window.cc.claudeSettings.write(projectPath, scope, patch);
      if (scope === 'shared') setShared(next);
      else setLocal(next);
      onSaved();
    } catch {
      /* ignore */
    }
  };

  return (
    <Section
      title="Project .claude/ settings"
      help={
        <>
          Reads <code>.claude/settings.json</code> (shared, committed) and{' '}
          <code>.claude/settings.local.json</code> (personal, gitignored).
          Edits preserve unknown keys (env, hooks, outputStyle, …) verbatim.
        </>
      }
    >
      {bindingError && <p className="modal-error">{bindingError}</p>}
      <div className="claude-scope-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeScope === 'shared'}
          className={activeScope === 'shared' ? 'active' : ''}
          onClick={() => setActiveScope('shared')}
        >
          Shared
          {shared?.exists && <span className="claude-scope-dot" aria-hidden />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeScope === 'local'}
          className={activeScope === 'local' ? 'active' : ''}
          onClick={() => setActiveScope('local')}
        >
          Local
          {local?.exists && <span className="claude-scope-dot" aria-hidden />}
        </button>
      </div>
      {activeScope === 'shared' ? (
        <ClaudeScopeCard
          title="Shared (settings.json)"
          subtitle="Committed — for everyone on the project"
          result={shared}
          onSave={(patch) => save('shared', patch)}
          onOpen={onOpen}
        />
      ) : (
        <ClaudeScopeCard
          title="Local (settings.local.json)"
          subtitle="Personal — gitignored by claude-code"
          result={local}
          onSave={(patch) => save('local', patch)}
          onOpen={onOpen}
        />
      )}
    </Section>
  );
}

function ClaudeScopeCard({
  title,
  subtitle,
  result,
  onSave,
  onOpen
}: {
  title: string;
  subtitle: string;
  result: ClaudeSettingsResult | null;
  onSave: (patch: ClaudeProjectSettings) => Promise<void>;
  onOpen: (path: string) => void;
}) {
  if (!result) {
    return (
      <div className="claude-scope-card">
        <header>
          <h4>{title}</h4>
          <p className="settings-help">{subtitle}</p>
        </header>
        <p className="settings-help">Loading…</p>
      </div>
    );
  }

  const s = result.settings;
  const perm = s.permissions ?? {};
  return (
    <ClaudeScopeCardInner
      title={title}
      subtitle={subtitle}
      result={result}
      view={s}
      perm={perm}
      onSave={onSave}
      onOpen={onOpen}
    />
  );
}

function ClaudeScopeCardInner({
  title,
  subtitle,
  result,
  view: s,
  perm,
  onSave,
  onOpen
}: {
  title: string;
  subtitle: string;
  result: ClaudeSettingsResult;
  view: ClaudeProjectSettings;
  perm: NonNullable<ClaudeProjectSettings['permissions']>;
  onSave: (patch: ClaudeProjectSettings) => Promise<void>;
  onOpen: (path: string) => void;
}) {
  const [modelDraft, setModelDraft] = useState(s.model ?? '');
  // Re-sync the draft when the persisted value changes (e.g. another save lands).
  useEffect(() => {
    setModelDraft(s.model ?? '');
  }, [s.model]);
  // Show "Other keys" when the user has hand-edited fields we don't surface
  // (env, hooks, outputStyle, etc.). Read-only — they edit raw.
  const hasUnknown =
    (s._unknown && Object.keys(s._unknown).length > 0) ||
    (s._unknownPermissions && Object.keys(s._unknownPermissions).length > 0);

  return (
    <div className="claude-scope-card">
      <header>
        <h4>
          {title}
          {!result.exists && <span className="claude-scope-badge">not present</span>}
        </h4>
        <p className="settings-help">{subtitle}</p>
      </header>

      <Field label="Default permission mode">
        <select
          value={perm.defaultMode ?? ''}
          onChange={(e) =>
            onSave({
              permissions: {
                ...perm,
                defaultMode: (e.target.value || undefined) as
                  | 'default'
                  | 'acceptEdits'
                  | 'plan'
                  | 'bypassPermissions'
                  | undefined
              }
            })
          }
        >
          <option value="">Unset</option>
          <option value="default">Default</option>
          <option value="acceptEdits">Accept Edits</option>
          <option value="plan">Plan</option>
          <option value="bypassPermissions">Bypass Permissions</option>
        </select>
      </Field>

      <Field label="Model" help="Top-level `model` override (e.g. opus, sonnet, haiku).">
        <input
          type="text"
          value={modelDraft}
          onChange={(e) => setModelDraft(e.target.value)}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if ((s.model ?? '') === next) return;
            onSave({ model: next || undefined });
          }}
          placeholder="unset"
          spellCheck={false}
        />
      </Field>

      <ChipField
        label="Allow"
        help="permissions.allow — pre-approved tool patterns. Examples: Bash(git:*), Edit, Read."
        values={perm.allow ?? []}
        placeholder="Bash(git:*)"
        onChange={(vals) =>
          onSave({
            permissions: {
              ...perm,
              allow: vals.length ? vals : undefined
            }
          })
        }
      />

      <ChipField
        label="Deny"
        help="permissions.deny — blocked tool patterns. Examples: Bash(rm:*)."
        values={perm.deny ?? []}
        placeholder="Bash(rm:*)"
        onChange={(vals) =>
          onSave({
            permissions: {
              ...perm,
              deny: vals.length ? vals : undefined
            }
          })
        }
      />

      <ChipField
        label="Additional directories"
        help="permissions.additionalDirectories — extra paths claude can read/write outside the project root."
        values={perm.additionalDirectories ?? []}
        placeholder="/abs/path"
        onChange={(vals) =>
          onSave({
            permissions: {
              ...perm,
              additionalDirectories: vals.length ? vals : undefined
            }
          })
        }
      />

      {hasUnknown && (
        <div className="settings-field">
          <span className="settings-label">Other keys (read-only)</span>
          <pre className="settings-code-block">
            {JSON.stringify(
              {
                ...(s._unknown ?? {}),
                ...(s._unknownPermissions ? { permissions: s._unknownPermissions } : {})
              },
              null,
              2
            )}
          </pre>
        </div>
      )}

      <div className="settings-btn-row">
        <button className="settings-btn" onClick={() => onOpen(result.path)}>
          Edit raw JSON in Cursor
        </button>
      </div>
    </div>
  );
}
