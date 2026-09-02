import { product } from '../lib/product-client.js';
import { useEffect, useRef, useState } from 'react';
import { X, Trash2, Copy, Pencil, FolderOpen, ChevronRight } from 'lucide-react';
import type { HarnessAdapterDescriptor, HarnessAgentDiscoveryResult, HarnessRoleTarget } from '@zana-ai/zcc-domain/harness-adapter';
import type { HarnessFamily, LaunchProfileId, Persona, PersonaInput } from '@zana-ai/zcc-domain/product';
import {
  harnessFamilyOf,
  profileLabel,
  providerCapabilities,
  providerUiSchema,
  VALID_PROFILES
} from '@zana-ai/zcc-domain/launch-provider';
import { useUi, useData } from '../store.js';
import { ImprovePromptButton } from './ImprovePromptButton.js';
import { StencilForm } from './ui/Skeleton.js';
import { HarnessOptionSelect } from './HarnessOptionSelect.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { effectivePersonaRouting } from '../lib/personaRouting.js';
import {
  PERSONA_ICON_NAMES,
  personaIconByName,
  personaIcon,
  profileIcon
} from '../lib/profileIcon.js';

/**
 * Persona detail + editor modal. Three modes driven by the persona's source:
 *  - `builtin` → read-only detail with "Fork to edit" (saves a user shadow with
 *    the same id) and "Duplicate" (a new id). Built-ins are never written.
 *  - `user` → fully editable, with Delete (removes the user file).
 *  - project → read-only detail (its file lives in the repo, not the user dir);
 *    "Duplicate to user" lets the operator base a personal copy on it.
 *
 * Saving and deleting both go through `cc.personas.save` / `.delete`, which write
 * to `~/.zcc/personas/` in main (the renderer is untrusted; main validates).
 */

// The base-profile picker offers EVERY launch profile (a resume variant is a
// runtime toggle, not a persona identity, so we drop those two from the list) —
// so a codex/cursor persona is now creatable, not just claude/shell. Labels +
// the canonical set come from the shared single-source-of-truth (Rule 6: no
// profile literals inlined here).
const PROFILES: Array<{ id: LaunchProfileId; label: string }> = VALID_PROFILES.filter(
  (p) => !p.endsWith('-resume')
).map((id) => ({ id, label: profileLabel(id) }));

/** Split a comma/newline-separated tool/dir list into a clean string[]. */
function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sourceIsProject(source: Persona['source']): boolean {
  return !!source && typeof source === 'object';
}

function ClaudePersonaOptions({
  allowedTools,
  deniedTools,
  addDirs,
  onAllowedToolsChange,
  onDeniedToolsChange,
  onAddDirsChange,
  disabled = false
}: {
  allowedTools: string;
  deniedTools: string;
  addDirs: string;
  onAllowedToolsChange?: (value: string) => void;
  onDeniedToolsChange?: (value: string) => void;
  onAddDirsChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const editable = !!onAllowedToolsChange && !!onDeniedToolsChange && !!onAddDirsChange;
  const [open, setOpen] = useState(() => editable && !!(allowedTools || deniedTools || addDirs));

  return (
    <div
      className={`opener-list persona-claude-options${disabled ? ' opener-row--off' : ''}`}
      data-testid="persona-claude-options"
    >
      <div className="opener-row">
        <div className="opener-row-head">
          <button
            type="button"
            className="opener-row-expand"
            aria-expanded={open}
            aria-label="Persona settings for Claude Code"
            onClick={() => setOpen((value) => !value)}
            disabled={disabled}
          >
            <ChevronRight
              size={14}
              className={`opener-row-chevron${open ? ' opener-row-chevron--open' : ''}`}
              aria-hidden
            />
          </button>
          <span className="opener-row-glyph" aria-hidden>{profileIcon('claude', 17)}</span>
          <div className="opener-row-text">
            <span className="opener-row-name">Claude Code</span>
            <span className="opener-row-blurb">Persona tool policy and context directories</span>
          </div>
          <span className="opener-row-always">{disabled ? 'Unavailable' : 'Claude only'}</span>
        </div>
        {open ? (
          <div className="opener-row-advanced">
            {editable ? (
              <fieldset disabled={disabled} className="persona-harness-fieldset">
              <>
                <div className="persona-form-row">
                  <div className="scheduler-form-field">
                    <label htmlFor="persona-allowed">Allowed tools</label>
                    <input
                      id="persona-allowed"
                      type="text"
                      value={allowedTools}
                      onChange={(event) => onAllowedToolsChange(event.target.value)}
                      placeholder="Read, Grep, Glob"
                    />
                    <p className="settings-help persona-form-hint">Combined and deduplicated with other levels.</p>
                  </div>
                  <div className="scheduler-form-field">
                    <label htmlFor="persona-denied">Denied tools</label>
                    <input
                      id="persona-denied"
                      type="text"
                      value={deniedTools}
                      onChange={(event) => onDeniedToolsChange(event.target.value)}
                      placeholder="Write, Bash"
                    />
                    <p className="settings-help persona-form-hint">Combined across every level; earlier denials remain effective.</p>
                  </div>
                </div>
                <div className="scheduler-form-field">
                  <label htmlFor="persona-dirs">Extra dirs</label>
                  <input
                    id="persona-dirs"
                    type="text"
                    value={addDirs}
                    onChange={(event) => onAddDirsChange(event.target.value)}
                    placeholder="../sibling-repo"
                  />
                  <p className="settings-help persona-form-hint">Combined with directories from other levels.</p>
                </div>
              </>
              </fieldset>
            ) : (
              <dl className="persona-detail-grid">
                <PersonaField label="Allowed tools" value={allowedTools || 'Not set'} />
                <PersonaField label="Denied tools" value={deniedTools || 'Not set'} />
                <PersonaField label="Extra dirs" value={addDirs || 'Not set'} />
              </dl>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type PersonaRouting = NonNullable<Persona['harnessRouting']>['byAdapter'];

function portableLabel(value: string): string {
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function PersonaHarnessRoutingFields({
  descriptor,
  routing,
  projectId,
  onChange
}: {
  descriptor: HarnessAdapterDescriptor;
  routing: NonNullable<PersonaRouting[HarnessFamily]>;
  projectId?: string;
  onChange: (patch: Partial<NonNullable<PersonaRouting[HarnessFamily]>>) => void;
}) {
  const targets = descriptor.targets;
  const relationship = targets?.providerModelRelationship;
  const inferredProvider = routing.modelTargetId
    ? targets?.models.find((target) => target.id === routing.modelTargetId)?.provider
    : undefined;
  const selectedProvider = routing.providerTargetId
    ?? inferredProvider
    ?? (relationship === 'fixed-provider' ? targets?.providers?.[0]?.id : '');
  const visibleModels = selectedProvider && relationship !== 'fixed-provider'
    ? (targets?.models ?? []).filter((target) => !target.provider || target.provider === selectedProvider)
    : targets?.models ?? [];
  const codexUi = providerUiSchema('codex');

  const [agentDiscovery, setAgentDiscovery] = useState<HarnessAgentDiscoveryResult | { status: 'loading' }>({ status: 'success', descriptors: [] });
  const dynamicAgentsActive = descriptor.id === 'opencode';
  const roleOptions: readonly HarnessRoleTarget[] = dynamicAgentsActive && agentDiscovery.status === 'success'
    ? agentDiscovery.descriptors.filter((agent) => agent.directLaunchAllowed).map((agent) => ({ id: agent.id, label: agent.label, scope: ['local'] }))
    : dynamicAgentsActive ? [] : targets?.roles ?? [];
  const refreshAgents = () => {
    if (!projectId || !dynamicAgentsActive) return;
    setAgentDiscovery({ status: 'loading' });
    void product.harness.agentDescriptors(projectId, 'opencode', true)
      .then(setAgentDiscovery)
      .catch(() => setAgentDiscovery({ status: 'failure' }));
  };

  useEffect(() => {
    if (!projectId || !dynamicAgentsActive) return;
    setAgentDiscovery({ status: 'loading' });
    let cancelled = false;
    void product.harness.agentDescriptors(projectId, 'opencode').then((result) => {
      if (!cancelled) setAgentDiscovery(result);
    }).catch(() => {
      if (!cancelled) setAgentDiscovery({ status: 'failure' });
    });
    return () => { cancelled = true; };
  }, [projectId, dynamicAgentsActive]);

  return (
    <div className="persona-harness-routing" data-testid="persona-harness-routing">
      {!!targets?.roles.length && !targets.executionStateMapping && (
        <div className="scheduler-form-field">
          <label htmlFor="persona-role-target">{dynamicAgentsActive ? 'Effective OpenCode agent' : 'Native role'}</label>
          {dynamicAgentsActive ? (
            <div className="launch-opencode-role-control">
              <select
                id="persona-role-target"
                value={roleOptions.some((target) => target.id === routing.roleTargetId) ? routing.roleTargetId ?? '' : ''}
                disabled={!projectId || agentDiscovery.status === 'loading' || agentDiscovery.status === 'failure'}
                onChange={(event) => onChange({ roleTargetId: event.target.value || undefined })}
              >
                <option value="">{agentDiscovery.status === 'loading' ? 'Loading agents…' : 'Use harness default'}</option>
                {roleOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
              </select>
              <button type="button" className="launch-advanced-toggle" onClick={refreshAgents} disabled={!projectId || agentDiscovery.status === 'loading'}>↻</button>
            </div>
          ) : (
            <>
              <input id="persona-role-target" list={`persona-role-targets-${descriptor.id}`} value={routing.roleTargetId ?? ''} onChange={(event) => onChange({ roleTargetId: event.target.value || undefined })} placeholder="Use harness default" />
              <datalist id={`persona-role-targets-${descriptor.id}`}>{roleOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</datalist>
            </>
          )}
        </div>
      )}
      {!!targets?.providers?.length && (
        <div className="scheduler-form-field">
          <label htmlFor="persona-provider-target">Provider</label>
          <PopoverPicklist
            id="persona-provider-target"
            value={selectedProvider ?? ''}
            ariaLabel="Provider"
            searchable={false}
            disabled={relationship === 'fixed-provider'}
            onChange={(providerId) => {
              const providerTargetId = providerId || undefined;
              const currentModel = targets.models.find((target) => target.id === routing.modelTargetId);
              onChange({
                providerTargetId,
                ...(!providerTargetId || (currentModel && currentModel.provider !== providerTargetId)
                  ? { modelTargetId: undefined }
                  : {})
              });
            }}
            options={[
              ...(relationship !== 'fixed-provider' ? [{ value: '', label: 'Use project/global default' }] : []),
              ...targets.providers.map((provider) => ({ value: provider.id, label: provider.label }))
            ]}
          />
        </div>
      )}
      {!!targets?.models.length && (
        <div className="scheduler-form-field">
          <label htmlFor="persona-model-target">Model</label>
          <PopoverPicklist
            id="persona-model-target"
            value={routing.modelTargetId ?? ''}
            ariaLabel="Model"
            onChange={(modelTargetId) => onChange({ modelTargetId: modelTargetId || undefined })}
            options={[
              { value: '', label: 'Use project/global default' },
              ...visibleModels.map((target) => ({
                value: target.id,
                label: `${target.label}${target.level ? ` [${portableLabel(target.level)}]` : ''}`
              }))
            ]}
          />
        </div>
      )}
      {targets?.executionStateMapping && descriptor.id !== 'codex' && (
        <div className="scheduler-form-field">
          <label htmlFor="persona-execution-target">Execution state</label>
          <PopoverPicklist
            id="persona-execution-target"
            value={routing.executionState ?? ''}
            ariaLabel="Execution state"
            searchable={false}
            onChange={(executionState) => onChange({
              executionState: (executionState || undefined) as NonNullable<typeof routing.executionState> | undefined
            })}
            options={[
              { value: '', label: 'Use project/global default' },
              ...Object.entries(targets.executionStateMapping).map(([state, native]) => ({
                value: state,
                label: `${native} [${portableLabel(state)}]`
              }))
            ]}
          />
        </div>
      )}
      {descriptor.id === 'codex' && (
        <div className="persona-form-row">
          <div className="scheduler-form-field">
            <label htmlFor="persona-codex-sandbox">Sandbox policy</label>
            <HarnessOptionSelect
              id="persona-codex-sandbox"
              options={codexUi.sandboxes}
              value={routing.compatibility?.codexSandbox ?? ''}
              onChange={(value) => onChange({
                compatibility: { ...routing.compatibility, codexSandbox: value || undefined }
              })}
              sentinel={{ id: '', label: 'Use project/global default' }}
              dropDefaultId
            />
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="persona-codex-approval">Approval policy</label>
            <HarnessOptionSelect
              id="persona-codex-approval"
              options={codexUi.approvals}
              value={routing.compatibility?.codexApproval ?? ''}
              onChange={(value) => onChange({
                compatibility: { ...routing.compatibility, codexApproval: value || undefined }
              })}
              sentinel={{ id: '', label: 'Use project/global default' }}
              dropDefaultId
            />
          </div>
        </div>
      )}
      {!targets?.models.length && !targets?.executionStateMapping && descriptor.id !== 'codex' && (
        <p className="settings-help">No Persona-specific routing settings are available for this harness.</p>
      )}
      <p className="settings-help persona-form-hint">
        Native {descriptor.label} overrides. Blank values inherit Project and Global settings.
        {targets?.roles.length && targets.executionStateMapping
          ? ' Execution state selects the compatible native role policy.'
          : ''}
      </p>
    </div>
  );
}

export function PersonaEditor({
  persona,
  mode: initialMode,
  projectId,
  onClose
}: {
  /** The persona to view/edit, or null for a brand-new one. */
  persona: Persona | null;
  /** 'view' opens read-only (builtins/project); 'edit' opens the form. */
  mode: 'view' | 'edit';
  /** Registered project used only for main-authorized dynamic native agent discovery. */
  projectId?: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const ref = useRef<HTMLDivElement | null>(null);
  const renderKey = `${mode}:${persona?.id ?? 'new'}`;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    node.addEventListener('keydown', onKey);
    node.focus();
    return () => node.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="modal persona-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={persona ? persona.name : 'New persona'}
        tabIndex={-1}
      >
        {mode === 'view' && persona ? (
          <PersonaDetail
            key={renderKey}
            persona={persona}
            onClose={onClose}
            onEdit={() => setMode('edit')}
          />
        ) : (
          <PersonaForm key={renderKey} persona={persona} projectId={projectId} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

/** Read-only detail view for builtins / project personas. */
function PersonaDetail({
  persona,
  onClose,
  onEdit
}: {
  persona: Persona;
  onClose: () => void;
  onEdit: () => void;
}) {
  const isProject = sourceIsProject(persona.source);
  const isBuiltin = persona.source === 'builtin';

  return (
    <>
      <header className="modal-header">
        <h3>
          <span className="persona-detail-icon" aria-hidden>
            {personaIcon(persona, 16)}
          </span>
          {persona.name}
        </h3>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>
      <div className="modal-body persona-detail-body">
        <p className="settings-help persona-form-hint">
          Persona settings apply after Global and Project defaults, and before Agent choices: Global → Project → Persona → Agent.
        </p>
        {persona.description && <p className="persona-detail-desc">{persona.description}</p>}
        <dl className="persona-detail-grid">
          <PersonaField label="Harness profile" value={persona.baseProfile ? profileLabel(persona.baseProfile) : 'Use launch harness (neutral)'} />
          {persona.modelLevel && (
            <PersonaField label="Model level" value={persona.modelLevel} />
          )}
          {persona.executionState && (
            <PersonaField label="Execution state" value={persona.executionState} />
          )}
          {persona.microVmImage ? (
            <PersonaField label="microVM image" value={persona.microVmImage} />
          ) : null}
        </dl>
        {persona.appendSystemPrompt && (
          <div className="persona-detail-block">
            <span className="persona-detail-label">System prompt</span>
            <pre className="persona-detail-pre">{persona.appendSystemPrompt}</pre>
          </div>
        )}
        {persona.initialPrompt && (
          <div className="persona-detail-block">
            <span className="persona-detail-label">Opening prompt</span>
            <pre className="persona-detail-pre">{persona.initialPrompt}</pre>
          </div>
        )}
        <ClaudePersonaOptions
          allowedTools={persona.allowedTools?.join(', ') ?? ''}
          deniedTools={persona.deniedTools?.join(', ') ?? ''}
          addDirs={persona.addDirs?.join(', ') ?? ''}
        />
      </div>
      <footer className="modal-footer">
        {isProject ? (
          <span className="persona-detail-note">
            Project persona — edit its file in the repo. Use Duplicate to make a personal copy.
          </span>
        ) : isBuiltin ? (
          <span className="persona-detail-note">
            Built-in — editing saves a personal override you can reset anytime.
          </span>
        ) : null}
        <button className="btn primary" onClick={onEdit}>
          {isProject ? (
            <>
              <Copy size={14} /> Duplicate to user
            </>
          ) : isBuiltin ? (
            <>
              <Pencil size={14} /> Edit override
            </>
          ) : (
            <>
              <Pencil size={14} /> Edit
            </>
          )}
        </button>
      </footer>
    </>
  );
}

function PersonaField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="persona-detail-label">{label}</dt>
      <dd className="persona-detail-value">{value}</dd>
    </>
  );
}

/** The create/edit form. */
function PersonaForm({ persona, projectId, onClose }: { persona: Persona | null; projectId?: string; onClose: () => void }) {
  const pushToast = useUi((s) => s.pushToast);

  // A project persona opened for "edit" becomes a NEW user persona (we never
  // write back into the repo), so we drop its id to force a fresh slug.
  const isProjectSource = sourceIsProject(persona?.source);
  const editingExisting = !!persona && !isProjectSource;
  const keepsId = editingExisting; // user OR builtin shadow keeps the id

  const [name, setName] = useState(persona?.name ?? '');
  const [icon, setIcon] = useState(persona?.icon ?? '');
  const [description, setDescription] = useState(persona?.description ?? '');
  const [baseProfile, setBaseProfile] = useState<LaunchProfileId | ''>(persona?.baseProfile ?? '');
  const [modelLevel, setModelLevel] = useState<string>(persona?.modelLevel ?? 'default');
  const [executionState, setExecutionState] = useState<string>(persona?.executionState ?? 'default');
  const [descriptors, setDescriptors] = useState<HarnessAdapterDescriptor[]>([]);
  const [harnessRouting, setHarnessRouting] = useState<PersonaRouting>(
    () => effectivePersonaRouting(persona)
  );
  const [appendSystemPrompt, setAppendSystemPrompt] = useState(persona?.appendSystemPrompt ?? '');
  const [initialPrompt, setInitialPrompt] = useState(persona?.initialPrompt ?? '');
  const [allowedTools, setAllowedTools] = useState((persona?.allowedTools ?? []).join(', '));
  const [deniedTools, setDeniedTools] = useState((persona?.deniedTools ?? []).join(', '));
  const [addDirs, setAddDirs] = useState((persona?.addDirs ?? []).join(', '));
  const [microVmImage, setMicroVmImage] = useState(persona?.microVmImage ?? '');
  const [saving, setSaving] = useState(false);

  // The microVM image field is only meaningful when the (experimental) microVM
  // isolation env is enabled; hide it otherwise so the form doesn't advertise an
  // off feature. Unlike launcher capability facets, the image applies to any
  // base profile (it selects WHERE the agent runs, not launcher argv), so it is
  // harness profile. Main re-authorizes it against the closed image allowlist at
  // spawn (Rule 1), so a stale value is rejected, not honored.
  const microVmEnabled = useData((s) => s.microVmEnabled);

  useEffect(() => {
    let cancelled = false;
    product.harness.descriptors()
      .then((value) => { if (!cancelled) setDescriptors(value); })
      .catch(() => { if (!cancelled) setDescriptors([]); });
    return () => { cancelled = true; };
  }, []);

  const selectedFamily = baseProfile ? harnessFamilyOf(baseProfile) : null;
  const selectedDescriptor = selectedFamily
    ? descriptors.find((descriptor) => descriptor.id === selectedFamily)
    : undefined;
  const selectedRouting = selectedFamily ? harnessRouting[selectedFamily] ?? {} : {};
  const claudeOptionsDisabled = !!selectedFamily && selectedFamily !== 'claude';

  const updateSelectedRouting = (
    patch: Partial<NonNullable<PersonaRouting[HarnessFamily]>>
  ) => {
    if (!selectedFamily) return;
    setHarnessRouting((current) => {
      const nextEntry = { ...(current[selectedFamily] ?? {}), ...patch };
      if (nextEntry.compatibility) {
        const compatibility = Object.fromEntries(
          Object.entries(nextEntry.compatibility).filter(([, value]) => value !== undefined)
        );
        nextEntry.compatibility = Object.keys(compatibility).length ? compatibility : undefined;
      }
      for (const key of Object.keys(nextEntry) as Array<keyof typeof nextEntry>) {
        if (nextEntry[key] === undefined) delete nextEntry[key];
      }
      const next = { ...current };
      if (Object.keys(nextEntry).length) next[selectedFamily] = nextEntry;
      else delete next[selectedFamily];
      return next;
    });
  };

  const canSave = name.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const input: PersonaInput = {
      name: name.trim(),
      icon: icon || undefined,
      description: description.trim() || undefined,
      baseProfile: baseProfile || undefined,
      modelLevel: !baseProfile && modelLevel !== 'default' ? modelLevel as any : undefined,
      executionState: !baseProfile && executionState !== 'default' ? executionState as any : undefined,
      // Structured controls replace legacy routing fields. Keeping old values
      // here makes a profile change silently route through hidden stale state.
      model: undefined,
      permissionMode: undefined,
      codexSandbox: undefined,
      codexApproval: undefined,
      // Portable model level is the persona model contract. Exact harness targets
      // belong to launch/project settings, not a reusable persona.
      harnessRouting: Object.keys(harnessRouting).length
        ? { schemaVersion: 1, byAdapter: harnessRouting }
        : undefined,
      // Portable persona capabilities remain stored even when a selected harness
      // cannot express them. Existing MCP references are legacy Claude-local data:
      // preserve them on edit, but do not advertise an inert free-text control.
      appendSystemPrompt: appendSystemPrompt.trim() || undefined,
      initialPrompt: initialPrompt.trim() || undefined,
      allowedTools: parseList(allowedTools),
      deniedTools: parseList(deniedTools),
      addDirs: parseList(addDirs),
      mcpServers: persona?.mcpServers,
      // Persist the microVM image only while the feature is enabled AND a value
      // is set; base-profile-agnostic (applies in the microVM env for any CLI).
      microVmImage: microVmEnabled && microVmImage.trim() ? microVmImage.trim() : undefined
    };
    if (keepsId && persona) input.id = persona.id;

    const result = await savePersona(input, (value) => product.personas.save(value));
    if (!result.ok) {
      pushToast(`Save failed: ${result.message}`, 'error');
      setSaving(false);
      return;
    }
    pushToast(`Saved persona “${result.value.name}”`, 'info');
    onClose();
  };

  const remove = async () => {
    if (!persona) return;
    const result = await product.personas.delete(persona.id);
    if (!result.ok) {
      pushToast(`Delete failed: ${result.message}`, 'error');
      return;
    }
    pushToast(
      persona.id.startsWith('builtin:')
        ? `Reset “${persona.name}” to the built-in default`
        : `Deleted persona “${persona.name}”`,
      'info'
    );
    onClose();
  };

  const isUserPersona = persona?.source === 'user';
  const title = !persona
    ? 'New persona'
    : isProjectSource
      ? `Duplicate ${persona.name}`
      : persona.source === 'builtin'
        ? `Override ${persona.name}`
        : `Edit ${persona.name}`;

  return (
    <>
      <header className="modal-header">
        <h3>{title}</h3>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>
      <div className="modal-body persona-form-body">
        <p className="settings-help persona-form-hint">
          Persona settings apply after Global and Project defaults, and before Agent choices: Global → Project → Persona → Agent. Agent choices take priority when a setting cannot be combined.
        </p>
        <div className="scheduler-form-field">
          <label htmlFor="persona-name">Name</label>
          <input
            id="persona-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="e.g. Backend Engineer"
          />
        </div>

        <div className="scheduler-form-field">
          <label>Icon</label>
          <div className="scheduler-icon-picker">
            {PERSONA_ICON_NAMES.map((nm) => (
              <button
                key={nm}
                type="button"
                className={`scheduler-icon-swatch ${icon === nm ? 'is-active' : ''}`}
                onClick={() => setIcon(icon === nm ? '' : nm)}
                aria-label={`Icon ${nm}`}
                title={nm}
              >
                {personaIconByName(nm)}
              </button>
            ))}
          </div>
        </div>

        <div className="scheduler-form-field">
          <label htmlFor="persona-desc">Description</label>
          <input
            id="persona-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line shown in the catalogue and pickers"
          />
        </div>

        <div className={`persona-routing-grid persona-routing-grid--${baseProfile ? 'pinned' : 'neutral'}`}>
          <div className="scheduler-form-field">
            <label htmlFor="persona-profile">Harness profile</label>
            <PopoverPicklist
              id="persona-profile"
              value={baseProfile}
              ariaLabel="Harness profile"
              searchable={false}
              onChange={(profile) => setBaseProfile(profile as LaunchProfileId | '')}
              options={[
                { value: '', label: 'Use launch harness (neutral)' },
                ...PROFILES.map((item) => ({ value: item.id, label: item.label }))
              ]}
            />
          </div>

        {!baseProfile ? (
          <div className="persona-portable-routing" data-testid="persona-portable-routing">
              <div className="scheduler-form-field">
                <label htmlFor="persona-model-level">Model level</label>
                <PopoverPicklist
                  id="persona-model-level"
                  value={modelLevel}
                  ariaLabel="Model level"
                  searchable={false}
                  onChange={setModelLevel}
                  options={[
                    { value: 'default', label: 'Use harness default (unset)' },
                    { value: 'low', label: 'Low (speed/cost sensitive)' },
                    { value: 'medium', label: 'Medium (balanced normal)' },
                    { value: 'high', label: 'High (frontier reasoning)' },
                    { value: 'extra-high', label: 'Extra-high (deep reasoning)' }
                  ]}
                />
              </div>
              <div className="scheduler-form-field">
                <label htmlFor="persona-execution-state">Execution state</label>
                <PopoverPicklist
                  id="persona-execution-state"
                  value={executionState}
                  ariaLabel="Execution state"
                  searchable={false}
                  onChange={setExecutionState}
                  options={[
                    { value: 'default', label: 'Use harness default (unset)' },
                    { value: 'plan', label: 'Plan (planning only)' },
                    { value: 'interactive', label: 'Interactive (human-in-loop)' },
                    { value: 'accept-edits', label: 'Accept Edits (auto-approve edits)' },
                    { value: 'autonomous', label: 'Autonomous (fully auto)' }
                  ]}
                />
              </div>
          </div>
        ) : selectedDescriptor ? (
          <PersonaHarnessRoutingFields
            descriptor={selectedDescriptor}
            routing={selectedRouting}
            projectId={projectId}
            onChange={updateSelectedRouting}
          />
        ) : (
          <StencilForm label={`Loading ${profileLabel(baseProfile as LaunchProfileId)} settings`} />
        )}
        </div>

        {!baseProfile && (
          <p className="settings-help persona-form-hint">
            Harness-neutral persona: base profile, model level, and execution state follow the selected harness at launch. Facets like system prompts, allowed tools, etc., are applied where supported by the launcher adapter.
          </p>
        )}

        <>
            <div className="scheduler-form-field">
              <label htmlFor="persona-system">System prompt (appended)</label>
              <textarea
                id="persona-system"
                value={appendSystemPrompt}
                onChange={(e) => setAppendSystemPrompt(e.target.value)}
                rows={5}
                placeholder="You are a…"
              />
              <ImprovePromptButton value={appendSystemPrompt} onChange={setAppendSystemPrompt} />
              <p className="settings-help persona-form-hint">Additive: appended after Global and Project prompt text, and before Agent prompt text.</p>
            </div>
            <div className="scheduler-form-field">
              <label htmlFor="persona-opening">Opening prompt</label>
              <textarea
                id="persona-opening"
                value={initialPrompt}
                onChange={(e) => setInitialPrompt(e.target.value)}
                rows={2}
                placeholder="Written to the session after it starts"
              />
              <ImprovePromptButton value={initialPrompt} onChange={setInitialPrompt} />
            </div>
            {/* Claude owns these facets today. Promote a facet to the portable
                section only after another adapter implements it. */}
            <ClaudePersonaOptions
              allowedTools={allowedTools}
              deniedTools={deniedTools}
              addDirs={addDirs}
              onAllowedToolsChange={setAllowedTools}
              onDeniedToolsChange={setDeniedTools}
              onAddDirsChange={setAddDirs}
              disabled={claudeOptionsDisabled}
            />
          </>
        {microVmEnabled && (
          <div className="scheduler-form-field">
            <label htmlFor="persona-microvm-image">microVM image</label>
            <input
              id="persona-microvm-image"
              type="text"
              value={microVmImage}
              onChange={(e) => setMicroVmImage(e.target.value)}
              placeholder="node, python, alpine, ubuntu…"
            />
            <p className="settings-help persona-form-hint">
              Default OCI image when this persona launches in the microVM
              environment. Must be an allowlisted image; an explicit launcher
              choice overrides it. Ignored outside microVM.
            </p>
          </div>
        )}
        <p className="settings-help persona-form-hint">
          Tools and dirs are comma- or newline-separated. Saved to{' '}
          <code>~/.zcc/personas</code>.
        </p>
      </div>
      <footer className="modal-footer persona-form-footer">
        {(isUserPersona || persona?.source === 'builtin') && persona ? (
          <button
            className="btn danger persona-form-delete"
            onClick={remove}
            title={
              persona.source === 'builtin'
                ? 'Reset to the built-in default'
                : 'Delete this persona'
            }
          >
            <Trash2 size={14} /> {persona.source === 'builtin' ? 'Reset' : 'Delete'}
          </button>
        ) : null}
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </>
  );
}

export async function savePersona(
  input: PersonaInput,
  save: (value: PersonaInput) => Promise<{ ok: true; value: Persona } | { ok: false; message: string }>
): Promise<{ ok: true; value: Persona } | { ok: false; message: string }> {
  try {
    return await save(input);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

/** Small "reveal personas dir" affordance reused by the panel header. */
export function RevealPersonasButton() {
  return (
    <button
      type="button"
      className="settings-btn"
      onClick={() => product.personas.revealDir().catch(() => {})}
      title="Open the personas directory in Finder"
    >
      <FolderOpen size={12} /> Reveal personas dir
    </button>
  );
}
