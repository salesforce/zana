import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import type {
  Project,
  ProjectSettings,
  ClaudeProjectSettings,
  ClaudeSettingsScope,
  ClaudeSettingsResult,
  CodexProjectSettings,
  CodexSettingsResult,
  OpenCodeProjectSettings,
  OpenCodeSettingsResult,
  HarnessFamily,
  LaunchProfileId,
  ProjectExecutionConsentGrant
} from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { providerUiSchema } from '@zana-ai/zcc-domain/launch-provider';
import { useData, useUi } from '@/store';
import { Section, Field, ChipField, TextArgsField, CheckboxField } from '@/components/settings/FormFields';
import { HarnessOptionSelect } from '@/components/HarnessOptionSelect';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { profileIcon } from '@/lib/profileIcon';

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

export function ProjectSettingsView({
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

      <ProjectHarnessSettings project={project} onOpen={onOpen} onSaved={onSaved} />

      {!project.remote && !project.quickAgent && (
        <ProjectWorktreeSettings project={project} onSaved={onSaved} />
      )}

      <ProjectExecutionConsentSettings project={project} onSaved={onSaved} />

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
      setGrants(await product.executionConsent.listProject(project.id));
    } catch (err) {
      setGrants([]);
      setError(err instanceof Error ? err.message : 'Failed to load execution grants');
    }
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setGrants(null);
    setError(null);
    product.executionConsent.listProject(project.id)
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
      setGrants(await product.executionConsent.revokeProject(project.id, grant.id));
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
  const savingRef = useRef(false);
  const currentProjectId = useRef(project.id);

  useEffect(() => {
    let cancelled = false;
    currentProjectId.current = project.id;
    setLoaded(false);
    setError(null);
    product.projectSettings.get(project.id)
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

  useEffect(() => product.projectSettings.onChanged((projectId) => {
    if (projectId !== project.id || savingRef.current) return;
    void product.projectSettings.get(projectId).then((settings) => {
      if (projectId === currentProjectId.current) setValue(settings.worktreeIsolation);
    }).catch(() => {
      // A background refresh is advisory and must not replace an already-rendered value.
    });
  }), [project.id]);

  const save = async (next: boolean | undefined) => {
    if (saving) return;
    const previous = value;
    setValue(next);
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const canonical = await persistProjectSettings(
        project.id,
        { worktreeIsolation: next },
        (id, patch) => product.projectSettings.set(id, patch)
      );
      setValue(canonical.worktreeIsolation);
      onSaved();
    } catch (cause) {
      setValue(previous);
      const message = projectSettingsErrorMessage(cause);
      setError(message);
      pushToast(message, 'error');
    } finally {
      savingRef.current = false;
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

export function ProjectHarnessSettings({
  project,
  onOpen,
  onSaved
}: {
  project: Project;
  onOpen: (path: string) => void;
  onSaved: () => void;
}) {
  const updateProject = useData((s) => s.updateProject);
  const pushToast = useUi((s) => s.pushToast);
  const [descriptors, setDescriptors] = useState<HarnessAdapterDescriptor[] | null>(null);
  const [settingsState, setSettingsState] = useState<{ projectId: string; value: ProjectSettings } | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [openHarnesses, setOpenHarnesses] = useState<Set<string>>(() => new Set());
  const [activeHarnessTabs, setActiveHarnessTabs] = useState<Record<string, 'launch' | 'harness' | 'files'>>({});
  const writeSequence = useRef(0);
  const currentProjectId = useRef(project.id);
  const pendingSettingsWrites = useRef(0);

  useEffect(() => {
    let cancelled = false;
    product.harness.descriptors()
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
    product.projectSettings.get(project.id).then((value) => {
      if (!cancelled) setSettingsState({ projectId: project.id, value });
    }).catch((error) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : String(error);
        setSettingsError(`Could not load project harness settings: ${message}`);
      }
    });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => product.projectSettings.onChanged((projectId) => {
    if (projectId !== project.id || pendingSettingsWrites.current > 0) return;
    void product.projectSettings.get(projectId).then((value) => {
      if (projectId === currentProjectId.current) setSettingsState({ projectId, value });
    }).catch(() => {
      // The normal load path renders a useful error. A background refresh is
      // advisory and must not erase an already-visible settings projection.
    });
  }), [project.id]);

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
    pendingSettingsWrites.current += 1;
    setSettingsError(null);
    setSettingsState({ projectId: project.id, value: { ...settings, ...patch } });
    try {
      const canonical = await persistProjectSettings(
        project.id,
        patch,
        (id, value) => product.projectSettings.set(id, value)
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
    } finally {
      pendingSettingsWrites.current -= 1;
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
          <PopoverPicklist
            ariaLabel="Default harness"
            value={current}
            onChange={save}
            options={[
              { value: '', label: 'Use global default' },
              ...options.map((entry) => ({
                value: entry.id,
                label: entry.label,
                disabled: !entry.availability.enabled || !entry.availability.installed
              }))
            ]}
          />
        )}
      </Field>
      {settingsError && <ProjectSettingsError message={settingsError} />}
      <div className="opener-list">
      {settings && options.map((descriptor) => {
          const id = descriptor.id as HarnessFamily;
          const open = openHarnesses.has(id);
          const activeTab = activeHarnessTabs[id] ?? 'launch';
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
                  <div className="harness-settings-tabs" role="tablist" aria-label={`${descriptor.label} settings`}>
                    {([
                      ['launch', 'Zana Settings'],
                      ['harness', 'Harness Settings'],
                      ['files', 'Harness Files']
                    ] as const).map(([tab, label]) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab}
                        className={activeTab === tab ? 'active' : ''}
                        onClick={() => setActiveHarnessTabs((current) => ({ ...current, [id]: tab }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {activeTab === 'launch' && <section className="harness-settings-group">
                  <p className="settings-help">Launch and routing settings affect Zana-created sessions only.</p>
                  <fieldset disabled={unavailable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  {!!descriptor.targets?.providers?.length && (
                    <Field label="Default Provider" help={descriptor.targets.providerModelRelationship === 'fixed-provider'
                      ? `${descriptor.label} uses this fixed provider.`
                      : 'Selects which provider’s models appear below. Combined provider/model harnesses encode this choice in the model id.'}>
                      <PopoverPicklist
                        value={routing?.providerTargetId
                          ?? descriptor.targets.models.find((target) => target.id === routing?.modelTargetId)?.provider
                          ?? (descriptor.targets.providerModelRelationship === 'fixed-provider' ? descriptor.targets.providers[0]?.id : '')}
                        ariaLabel="Default provider"
                        searchable={false}
                        disabled={descriptor.targets.providerModelRelationship === 'fixed-provider'}
                        onChange={(providerId) => {
                          const providerTargetId = providerId || undefined;
                          const currentModel = descriptor.targets?.models.find((target) => target.id === routing?.modelTargetId);
                          saveRouting(id, {
                            providerTargetId,
                            ...(!providerTargetId || (currentModel && currentModel.provider !== providerTargetId)
                              ? { modelTargetId: undefined }
                              : {})
                          });
                        }}
                        options={[
                          ...(descriptor.targets.providerModelRelationship !== 'fixed-provider' ? [{ value: '', label: 'Use global default' }] : []),
                          ...descriptor.targets.providers.map((provider) => ({ value: provider.id, label: provider.label }))
                        ]}
                      />
                    </Field>
                  )}
                  {!!descriptor.targets?.models.length && (
                    <Field label="Default Model Level" help={`Native ${descriptor.label} models with portable mappings.`}>
                      <PopoverPicklist
                        value={routing?.modelTargetId ?? ''}
                        ariaLabel="Default model level"
                        onChange={(modelTargetId) => saveRouting(id, { modelTargetId: modelTargetId || undefined })}
                        disabled={unavailable}
                        title={unavailable ? descriptor.availability.reason ?? 'Harness unavailable' : undefined}
                        options={[
                          { value: '', label: 'Use global default' },
                          ...descriptor.targets.models
                          .filter((target) => !routing?.providerTargetId || !target.provider || target.provider === routing.providerTargetId)
                          .map((target) => ({
                            value: target.id,
                            label: `${target.label}${target.level ? ` [${portableLabel(target.level)}]` : ''}`
                          }))
                        ]}
                      />
                    </Field>
                  )}
                  {executionMapping && id !== 'codex' && (
                    <Field label="Default Execution State" help={`Native ${descriptor.label} policies with portable mappings.`}>
                      <PopoverPicklist
                        value={routing?.executionState ?? ''}
                        ariaLabel="Default execution state"
                        searchable={false}
                        onChange={(executionState) => saveRouting(id, {
                          executionState: (executionState || undefined) as
                            | 'plan'
                            | 'interactive'
                            | 'accept-edits'
                            | 'autonomous'
                            | undefined
                        })}
                        disabled={unavailable}
                        title={unavailable ? descriptor.availability.reason ?? 'Harness unavailable' : undefined}
                        options={[
                          { value: '', label: 'Use global default' },
                          ...Object.entries(executionMapping).map(([state, native]) => ({
                            value: state,
                            label: `${native} [${portableLabel(state)}]`
                          }))
                        ]}
                      />
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
                  </section>}
                  {activeTab === 'harness' && <section className="harness-settings-group">
                  {descriptor.id === 'claude' && !project.remote ? (
                    <ProjectClaudeSettings projectId={project.id} onSaved={onSaved} compact />
                  ) : descriptor.id === 'codex' && !project.remote ? (
                    <ProjectCodexSettings projectId={project.id} descriptor={descriptor} onSaved={onSaved} />
                  ) : descriptor.id === 'opencode' && !project.remote ? (
                    <ProjectOpenCodeSettings projectId={project.id} descriptor={descriptor} onSaved={onSaved} />
                  ) : <p className="settings-help">{descriptor.configFiles[0]?.reason ?? 'No native harness settings are available.'}</p>}
                  </section>}
                  {activeTab === 'files' && <section className="harness-settings-group">
                  {descriptor.id === 'claude' ? (
                    <ClaudeHarnessFiles projectPath={project.path} onOpen={onOpen} />
                  ) : descriptor.id === 'cursor' ? (
                    <CursorHarnessFiles projectPath={project.path} onOpen={onOpen} />
                  ) : descriptor.id === 'opencode' ? (
                    <OpenCodeHarnessFiles projectPath={project.path} onOpen={onOpen} />
                  ) : descriptor.id === 'codex' ? (
                    <CodexHarnessFiles projectPath={project.path} onOpen={onOpen} />
                  ) : descriptor.configFiles.map((file) => (
                    <div className="settings-field" key={file.id}>
                      <span className="settings-label">{file.label}</span>
                      <span className="settings-help harness-file-status">
                        {file.effect === 'native-file' ? 'Native file' : file.effect === 'argv-app-store' ? 'Zana app/argv' : 'Unsupported'} —
                        {' '}
                        {file.effect === 'native-file'
                          ? `${file.scopes.join(' + ')}; structured edit available; raw edit ${file.rawEdit ? 'available' : 'unavailable'}.`
                          : file.reason ?? 'Unsupported'}
                      </span>
                    </div>
                  ))}
                  </section>}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export function ClaudeHarnessFiles({
  projectPath,
  onOpen
}: {
  projectPath: string;
  onOpen: (path: string) => void;
}) {
  const files = ['CLAUDE.md', '.mcp.json', '.claude/settings.json', '.claude/settings.local.json'];
  return (
    <div className="settings-btn-row">
      {files.map((path) => (
        <button className="settings-btn" key={path} onClick={() => onOpen(`${projectPath}/${path}`)}>
          {path}
        </button>
      ))}
    </div>
  );
}

export function CursorHarnessFiles({
  projectPath,
  onOpen
}: {
  projectPath: string;
  onOpen: (path: string) => void;
}) {
  const files = ['.cursor/mcp.json', '.cursor/rules'];
  return (
    <div className="settings-btn-row">
      {files.map((path) => (
        <button className="settings-btn" key={path} onClick={() => onOpen(`${projectPath}/${path}`)}>
          {path}
        </button>
      ))}
    </div>
  );
}

export function OpenCodeHarnessFiles({
  projectPath,
  onOpen
}: {
  projectPath: string;
  onOpen: (path: string) => void;
}) {
  const files = ['opencode.json', 'opencode.jsonc', 'tui.json', '.opencode'];
  return (
    <div className="settings-btn-row">
      {files.map((path) => (
        <button className="settings-btn" key={path} onClick={() => onOpen(`${projectPath}/${path}`)}>
          {path}
        </button>
      ))}
    </div>
  );
}

export function CodexHarnessFiles({
  projectPath,
  onOpen
}: {
  projectPath: string;
  onOpen: (path: string) => void;
}) {
  const files = ['.codex/config.toml', 'AGENTS.md', 'AGENTS.override.md'];
  return (
    <div className="settings-btn-row">
      {files.map((path) => (
        <button className="settings-btn" key={path} onClick={() => onOpen(`${projectPath}/${path}`)}>
          {path}
        </button>
      ))}
    </div>
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
      <PopoverPicklist
        value={selected}
        disabled={disabled}
        ariaLabel="Worktree isolation"
        searchable={false}
        onChange={(next) => {
          onChange(next === 'on' ? true : next === 'off' ? false : undefined);
        }}
        options={[
          { value: 'inherit', label: 'Use global default' },
          { value: 'on', label: 'Always use worktrees' },
          { value: 'off', label: 'Never use worktrees' }
        ]}
      />
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
        <PopoverPicklist
          value={settings.piThinking ?? 'default'}
          ariaLabel="Default thinking level"
          searchable={false}
          onChange={(piThinking) => save({ piThinking: piThinking as ProjectSettings['piThinking'] })}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'off', label: 'Off' },
            { value: 'minimal', label: 'Minimal' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' },
            { value: 'max', label: 'Max' }
          ]}
        />
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
  const pushToast = useUi((s) => s.pushToast);
  // Local draft mirrors the persisted value; committed on blur (same pattern as
  // the global "Default remote path" field).
  const [draft, setDraft] = useState(project.remote?.remotePath ?? '');
  const [remoteToolProxy, setRemoteToolProxy] = useState(false);
  const [proxyLoaded, setProxyLoaded] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const savingProxyRef = useRef(false);
  const currentProjectId = useRef(project.id);
  // Re-sync when the selected project changes underneath us.
  useEffect(() => {
    setDraft(project.remote?.remotePath ?? '');
  }, [project.id, project.remote?.remotePath]);

  useEffect(() => {
    let cancelled = false;
    currentProjectId.current = project.id;
    setProxyLoaded(false);
    product.projectSettings.get(project.id)
      .then((settings) => {
        if (!cancelled) {
          setRemoteToolProxy(settings.remoteToolProxy === true);
          setProxyLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setProxyLoaded(true);
      });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => product.projectSettings.onChanged((projectId) => {
    if (projectId !== project.id || savingProxyRef.current) return;
    void product.projectSettings.get(projectId).then((settings) => {
      if (projectId === currentProjectId.current) {
        setRemoteToolProxy(settings.remoteToolProxy === true);
      }
    }).catch(() => {
      // A background refresh is advisory and must not replace an already-rendered value.
    });
  }), [project.id]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === (project.remote?.remotePath ?? '')) return;
    void updateProject(project.id, { remotePath: trimmed }).then(() => onSaved());
  };

  const saveProxy = async (next: boolean) => {
    if (savingProxy) return;
    const previous = remoteToolProxy;
    setRemoteToolProxy(next);
    savingProxyRef.current = true;
    setSavingProxy(true);
    try {
      const canonical = await persistProjectSettings(
        project.id,
        { remoteToolProxy: next },
        (id, patch) => product.projectSettings.set(id, patch)
      );
      setRemoteToolProxy(canonical.remoteToolProxy === true);
      onSaved();
    } catch (cause) {
      setRemoteToolProxy(previous);
      pushToast(projectSettingsErrorMessage(cause), 'error');
    } finally {
      savingProxyRef.current = false;
      setSavingProxy(false);
    }
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
      {proxyLoaded ? (
        <CheckboxField
          label="Local agent, remote tools"
          help="Run the coding agent on this machine and execute Read, Write, Edit, Glob, Grep, and Shell on the remote over SSH. Off keeps the default: the CLI itself runs on the box (`ssh -t`). Install a host daemon later if you want the whole agent on that machine."
          checked={remoteToolProxy}
          onChange={(v) => void saveProxy(v)}
          disabled={savingProxy || Boolean(project.hostId)}
        />
      ) : null}
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
  projectId,
  onSaved,
  compact = false
}: {
  projectId: string;
  onSaved: () => void;
  compact?: boolean;
}) {
  const [shared, setShared] = useState<ClaudeSettingsResult | null>(null);
  const [local, setLocal] = useState<ClaudeSettingsResult | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [activeScope, setActiveScope] = useState<ClaudeSettingsScope>('shared');
  const saveQueue = useRef(Promise.resolve());
  const settingsRef = useRef<{ shared: ClaudeSettingsResult | null; local: ClaudeSettingsResult | null }>({
    shared: null,
    local: null
  });
  const requestRef = useRef(0);
  const setScopeResult = (scope: ClaudeSettingsScope, result: ClaudeSettingsResult) => {
    settingsRef.current[scope] = result;
    if (scope === 'shared') setShared(result);
    else setLocal(result);
  };

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    settingsRef.current = { shared: null, local: null };
    setShared(null);
    setLocal(null);
    // Guard against a stale preload (electron-vite HMRs the renderer but
    // not the preload — devs hitting save before a full app restart see
    // product.claudeSettings undefined). Surfacing a clear hint beats
    // a hanging spinner.
    if (!hasDesktopBridge()) {
      setBindingError('claudeSettings binding not loaded — quit (⌘Q) and relaunch the app.');
      return;
    }
    setBindingError(null);
    try {
      const [s, l] = await Promise.all([
        product.claudeSettings.read(projectId, 'shared'),
        product.claudeSettings.read(projectId, 'local')
      ]);
      if (request !== requestRef.current) return;
      settingsRef.current = { shared: s, local: l };
      setShared(s);
      setLocal(l);
    } catch (err) {
      if (request !== requestRef.current) return;
      setBindingError(err instanceof Error ? err.message : 'Failed to load .claude/ settings');
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (scope: ClaudeSettingsScope, patch: ClaudeProjectSettings) => {
    saveQueue.current = saveQueue.current.then(async () => {
      const current = settingsRef.current[scope];
      if (!current || (current.state !== 'missing' && current.state !== 'valid')) return;
      try {
        const next = await product.claudeSettings.write(projectId, scope, patch, current.hash);
        if (next.state === 'valid') {
          setScopeResult(scope, next);
          onSaved();
        } else if (next.state === 'invalid' || next.state === 'io-error') {
          setBindingError(next.message);
        }
      } catch (err) {
        setBindingError(err instanceof Error ? err.message : 'Failed to save Claude settings');
      }
    });
    await saveQueue.current;
  };

  const content = <>
      {bindingError && <p className="modal-error">{bindingError}</p>}
      <div className="settings-btn-row">
        <button className="settings-btn" onClick={() => void load()}>Reload</button>
      </div>
      <div className="claude-scope-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeScope === 'shared'}
          className={activeScope === 'shared' ? 'active' : ''}
          onClick={() => setActiveScope('shared')}
        >
          Shared
          {shared?.state === 'valid' && <span className="claude-scope-dot" aria-hidden />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeScope === 'local'}
          className={activeScope === 'local' ? 'active' : ''}
          onClick={() => setActiveScope('local')}
        >
          Local
          {local?.state === 'valid' && <span className="claude-scope-dot" aria-hidden />}
        </button>
      </div>
      {activeScope === 'shared' ? (
        <ClaudeScopeCard
          title="Shared (settings.json)"
          subtitle="Committed — for everyone on the project"
          result={shared}
          onSave={(patch) => save('shared', patch)}
        />
      ) : (
        <ClaudeScopeCard
          title="Local (settings.local.json)"
          subtitle="Personal — gitignored by claude-code"
          result={local}
          onSave={(patch) => save('local', patch)}
        />
      )}
    </>;
  if (compact) return <div className="claude-harness-settings">{content}</div>;
  return (
    <Section title="Project .claude/ settings" help={<>Reads <code>.claude/settings.json</code> (shared, committed) and <code>.claude/settings.local.json</code> (personal, gitignored).</>}>
      {content}
    </Section>
  );
}

export function ProjectCodexSettings({
  projectId,
  descriptor,
  onSaved
}: {
  projectId: string;
  descriptor: HarnessAdapterDescriptor;
  onSaved: () => void;
}) {
  const [result, setResult] = useState<CodexSettingsResult | null>(null);
  const load = useCallback(() => product.codexSettings.read(projectId).then(setResult), [projectId]);
  useEffect(() => { void load(); }, [load]);
  const save = async (patch: CodexProjectSettings) => {
    if (!result || (result.state !== 'missing' && result.state !== 'valid')) return;
    const next = await product.codexSettings.write(projectId, patch, result.hash);
    setResult(next);
    if (next.state === 'valid') onSaved();
  };
  if (!result) return <p className="settings-help">Loading Codex settings...</p>;
  if (result.state === 'invalid' || result.state === 'io-error') return <p className="modal-error">{result.message}</p>;
  const settings = result.settings;
  return <>
    <div className="settings-btn-row"><button className="settings-btn" onClick={() => void load()}>Reload</button></div>
    <Field label="Model" help="Project `.codex/config.toml` model override. Models come from Codex's account-visible catalog.">
      <select value={settings.model ?? ''} onChange={(e) => void save({ model: e.target.value || undefined })}>
        <option value="">Unset</option>
        {modelOptions(descriptor, settings.model).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </Field>
    <Field label="Approval policy">
      <select value={settings.approvalPolicy ?? ''} onChange={(e) => void save({ approvalPolicy: (e.target.value || undefined) as CodexProjectSettings['approvalPolicy'] })}>
        <option value="">Unset</option><option value="untrusted">Untrusted</option><option value="on-request">On request</option><option value="never">Never</option>
      </select>
    </Field>
    <Field label="Sandbox mode">
      <select value={settings.sandboxMode ?? ''} onChange={(e) => void save({ sandboxMode: (e.target.value || undefined) as CodexProjectSettings['sandboxMode'] })}>
        <option value="">Unset</option><option value="read-only">Read-only</option><option value="workspace-write">Workspace write</option><option value="danger-full-access">Danger full access</option>
      </select>
    </Field>
    {settings._unknown?.length ? <p className="settings-help">Other keys (read-only): {settings._unknown.join(', ')}</p> : null}
  </>;
}

export function ProjectOpenCodeSettings({
  projectId,
  descriptor,
  onSaved
}: {
  projectId: string;
  descriptor: HarnessAdapterDescriptor;
  onSaved: () => void;
}) {
  const [result, setResult] = useState<OpenCodeSettingsResult | null>(null);
  const load = useCallback(() => product.openCodeSettings.read(projectId).then(setResult), [projectId]);
  useEffect(() => { void load(); }, [load]);
  const save = async (patch: OpenCodeProjectSettings) => {
    if (!result || (result.state !== 'missing' && result.state !== 'valid')) return;
    const next = await product.openCodeSettings.write(projectId, patch, result.hash);
    setResult(next);
    if (next.state === 'valid') onSaved();
  };
  if (!result) return <p className="settings-help">Loading OpenCode settings...</p>;
  if (result.state === 'invalid' || result.state === 'io-error') return <p className="modal-error">{result.message}</p>;
  const settings = result.settings;
  const modelField = (label: string, key: 'model' | 'smallModel', help: string) => (
    <Field label={label} help={help}>
      <select value={settings[key] ?? ''} onChange={(e) => void save({ [key]: e.target.value || undefined })}>
        <option value="">Unset</option>
        {modelOptions(descriptor, settings[key]).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </Field>
  );
  return <>
    <div className="settings-btn-row"><button className="settings-btn" onClick={() => void load()}>Reload</button></div>
    {modelField('Model', 'model', 'Project `opencode.json` model override.')}
    {modelField('Small model', 'smallModel', 'Model for lightweight OpenCode tasks.')}
    <Field label="Default agent" help="Primary agent used when no `--agent` is selected.">
      <select value={settings.defaultAgent ?? ''} onChange={(e) => void save({ defaultAgent: e.target.value || undefined })}>
        <option value="">Unset</option>
        {roleOptions(descriptor, settings.defaultAgent).map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
      </select>
    </Field>
    {settings._unknown?.length ? <p className="settings-help">Other keys (read-only): {settings._unknown.join(', ')}</p> : null}
  </>;
}

export function modelOptions(descriptor: HarnessAdapterDescriptor, selected?: string) {
  const models = [...(descriptor.targets?.models ?? [])];
  if (selected && !models.some((model) => model.id === selected)) models.unshift({ id: selected, label: `${selected} (configured)`, scope: [] });
  return models;
}

export function roleOptions(descriptor: HarnessAdapterDescriptor, selected?: string) {
  const roles = [...(descriptor.targets?.roles ?? [])];
  if (selected && !roles.some((role) => role.id === selected)) roles.unshift({ id: selected, label: `${selected} (configured)`, scope: [] });
  return roles;
}

function ClaudeScopeCard({
  title,
  subtitle,
  result,
  onSave
}: {
  title: string;
  subtitle: string;
  result: ClaudeSettingsResult | null;
  onSave: (patch: ClaudeProjectSettings) => Promise<void>;
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

  if (result.state === 'invalid' || result.state === 'io-error') {
    return (
      <div className="claude-scope-card">
        <header>
          <h4>{title}</h4>
          <p className="settings-help">{subtitle}</p>
        </header>
        <p className="modal-error">{result.message}</p>
        <p className="settings-help">Structured editing is disabled. Reload after fixing raw JSON.</p>
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
    />
  );
}

function ClaudeScopeCardInner({
  title,
  subtitle,
  result,
  view: s,
  perm,
  onSave
}: {
  title: string;
  subtitle: string;
  result: ClaudeSettingsResult;
  view: ClaudeProjectSettings;
  perm: NonNullable<ClaudeProjectSettings['permissions']>;
  onSave: (patch: ClaudeProjectSettings) => Promise<void>;
}) {
  const [modelDraft, setModelDraft] = useState(s.model ?? '');
  // Re-sync the draft when the persisted value changes (e.g. another save lands).
  useEffect(() => {
    setModelDraft(s.model ?? '');
  }, [s.model]);
  // Show "Other keys" when the user has hand-edited fields we don't surface
  // (env, hooks, outputStyle, etc.). Read-only — they edit raw.
  const hasUnknown =
    (s._unknown && s._unknown.length > 0) ||
    (s._unknownPermissions && s._unknownPermissions.length > 0);

  return (
    <div className="claude-scope-card">
      <header>
        <h4>
          {title}
          {result.state === 'missing' && <span className="claude-scope-badge">not present</span>}
        </h4>
        <p className="settings-help">{subtitle}</p>
      </header>

      <Field label="Default permission mode">
        <PopoverPicklist
          value={perm.defaultMode ?? ''}
          ariaLabel="Default permission mode"
          searchable={false}
          onChange={(defaultMode) =>
            onSave({
              permissions: {
                ...perm,
                defaultMode: (defaultMode || undefined) as
                  | 'default'
                  | 'acceptEdits'
                  | 'plan'
                  | 'bypassPermissions'
                  | undefined
              }
            })
          }
          options={[
            { value: '', label: 'Unset' },
            { value: 'default', label: 'Default' },
            { value: 'acceptEdits', label: 'Accept Edits' },
            { value: 'plan', label: 'Plan' },
            { value: 'bypassPermissions', label: 'Bypass Permissions' }
          ]}
        />
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
            {JSON.stringify({ keys: s._unknown ?? [], permissionKeys: s._unknownPermissions ?? [] }, null, 2)}
          </pre>
        </div>
      )}

    </div>
  );
}

export { ProjectSettingsView as ProjectTab };
