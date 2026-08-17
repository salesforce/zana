import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Trash2, Copy, Pencil, Plus, GripVertical, Crown } from 'lucide-react';
import { ImprovePromptButton } from './ImprovePromptButton';
import type { Persona, Team, TeamInput, TeamSlot } from '@shared/types';
import { usePersonas, useData, useUi } from '../store';
import { resolveIcon } from '../util/resolveIcon';
import { personaIcon } from '../util/profileIcon';
import { PERSONA_ICON_NAMES, personaIconByName } from '../util/profileIcon';
import { getScopedProjectId } from '../util/windowScope';
import { PopoverPicklist } from './ui/PopoverPicklist';

/**
 * Team detail + editor modal — the Teams counterpart of {@link PersonaEditor}.
 * Three modes, driven by the team's source (mirrors the persona editor):
 *  - `builtin` → read-only detail with "Edit override" (saves a user shadow with
 *    the same id) — built-ins are never written.
 *  - `user` → fully editable, with Delete (removes the user file).
 *  - project / extension → read-only detail; "Duplicate to user" bases a personal
 *    copy on it (extension teams are in-memory, so they can only be duplicated).
 *
 * Saving / deleting go through `cc.teams.save` / `.delete`, which write to
 * `~/.zcc/teams/` in main (the renderer is untrusted; main validates + clamps).
 * A Team is a bundle of persona slots; launching opens one tab per slot quantity,
 * orchestrator first carrying the opening prompt.
 */

const TEAM_SLOT_MAX = 16;

/** A team whose source is an object is project- or extension-scoped (not user/builtin). */
function sourceIsForeign(source: Team['source']): boolean {
  return !!source && typeof source === 'object';
}

function isExtensionSource(source: Team['source']): boolean {
  return !!source && typeof source === 'object' && 'extensionId' in source;
}

function totalTabs(slots: TeamSlot[]): number {
  return slots.reduce((sum, s) => sum + Math.max(1, Math.min(TEAM_SLOT_MAX, s.quantity ?? 1)), 0);
}

export function SquadEditor({
  team,
  mode: initialMode,
  onClose
}: {
  /** The team to view/edit, or null for a brand-new one. */
  team: Team | null;
  /** 'view' opens read-only (builtins/project/extension); 'edit' opens the form. */
  mode: 'view' | 'edit';
  onClose: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const ref = useRef<HTMLDivElement | null>(null);

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
        className="modal persona-editor-modal team-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={team ? team.name : 'New team'}
        tabIndex={-1}
      >
        {mode === 'view' && team ? (
          <TeamDetail team={team} onClose={onClose} onEdit={() => setMode('edit')} />
        ) : (
          <TeamForm team={team} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

/** Read-only detail view for builtins / project / extension teams. */
function TeamDetail({
  team,
  onClose,
  onEdit
}: {
  team: Team;
  onClose: () => void;
  onEdit: () => void;
}) {
  const personas = usePersonas((s) => s.personas);
  const byId = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
  const isForeign = sourceIsForeign(team.source);
  const isExtension = isExtensionSource(team.source);
  const isBuiltin = team.source === 'builtin';
  const Icon = resolveIcon(team.icon ?? 'Users');

  return (
    <>
      <header className="modal-header">
        <h3>
          <span className="persona-detail-icon" aria-hidden>
            <Icon size={16} />
          </span>
          {team.name}
        </h3>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>
      <div className="modal-body persona-detail-body">
        {team.description && <p className="persona-detail-desc">{team.description}</p>}
        <div className="persona-detail-block">
          <span className="persona-detail-label">
            Slots — {totalTabs(team.slots)} tab{totalTabs(team.slots) === 1 ? '' : 's'} total
          </span>
          <ul className="team-slot-list team-slot-list--readonly">
            {team.slots.map((slot, i) => {
              const p = byId.get(slot.personaId);
              const isOrch = team.orchestratorPersonaId === slot.personaId;
              return (
                <li key={`${slot.personaId}-${i}`} className="team-slot-readonly">
                  <span className="tab-profile-icon" aria-hidden>
                    {p ? personaIcon(p) : <span className="team-slot-missing-dot" />}
                  </span>
                  <span className="team-slot-name">
                    {slot.label || p?.name || slot.personaId}
                    {isOrch && (
                      <span className="team-slot-orch-badge" title="Orchestrator — launched first">
                        <Crown size={11} /> Orchestrator
                      </span>
                    )}
                    {!p && <span className="team-slot-missing"> · unknown persona</span>}
                  </span>
                  <span className="scheduler-pill">
                    ×{Math.max(1, Math.min(TEAM_SLOT_MAX, slot.quantity ?? 1))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {team.initialPrompt && (
          <div className="persona-detail-block">
            <span className="persona-detail-label">Opening prompt</span>
            <pre className="persona-detail-pre">{team.initialPrompt}</pre>
          </div>
        )}
      </div>
      <footer className="modal-footer">
        {isExtension ? (
          <span className="persona-detail-note">
            Extension team — defined by an extension. Use Duplicate to make an editable copy.
          </span>
        ) : isForeign ? (
          <span className="persona-detail-note">
            Project team — edit its file in the repo. Use Duplicate to make a personal copy.
          </span>
        ) : isBuiltin ? (
          <span className="persona-detail-note">
            Built-in — editing saves a personal override you can reset anytime.
          </span>
        ) : null}
        <button className="btn primary" onClick={onEdit}>
          {isForeign ? (
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

/** Working copy of a slot in the form. */
interface SlotDraft {
  personaId: string;
  quantity: number;
  label: string;
}

/** The create/edit form. */
function TeamForm({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const pushToast = useUi((s) => s.pushToast);
  const allPersonas = usePersonas((s) => s.personas);
  const projects = useData((s) => s.projects);
  const scopedProjectId = getScopedProjectId();

  // Personas a slot can pick. In a per-project window, hide other projects'
  // project-personas (mirrors PersonasPanel's scoping).
  const personas = useMemo(() => {
    const list = !scopedProjectId
      ? allPersonas
      : allPersonas.filter(
          (p) =>
            typeof p.source !== 'object' ||
            p.source === null ||
            !('projectId' in p.source) ||
            p.source.projectId === scopedProjectId
        );
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [allPersonas, scopedProjectId]);

  // A project/extension team opened for "edit" becomes a NEW user team (we never
  // write back into the repo / an extension's memory), so we drop its id.
  const isForeignSource = sourceIsForeign(team?.source);
  const editingExisting = !!team && !isForeignSource;
  const keepsId = editingExisting; // user OR builtin shadow keeps the id

  const [name, setName] = useState(team?.name ?? '');
  const [icon, setIcon] = useState(team?.icon ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [initialPrompt, setInitialPrompt] = useState(team?.initialPrompt ?? '');
  const [orchestratorPersonaId, setOrchestratorPersonaId] = useState(
    team?.orchestratorPersonaId ?? ''
  );
  const [defaultProjectId, setDefaultProjectId] = useState(team?.defaultProjectId ?? '');
  const [slots, setSlots] = useState<SlotDraft[]>(
    (team?.slots ?? []).map((s) => ({
      personaId: s.personaId,
      quantity: Math.max(1, Math.min(TEAM_SLOT_MAX, s.quantity ?? 1)),
      label: s.label ?? ''
    }))
  );
  const [saving, setSaving] = useState(false);

  const tabs = totalTabs(slots.map((s) => ({ personaId: s.personaId, quantity: s.quantity })));
  const hasValidSlot = slots.some((s) => s.personaId.trim().length > 0);
  const canSave = name.trim().length > 0 && hasValidSlot && !saving;

  const addSlot = () => {
    const firstUnused =
      personas.find((p) => !slots.some((s) => s.personaId === p.id))?.id ??
      personas[0]?.id ??
      '';
    setSlots((prev) => [...prev, { personaId: firstUnused, quantity: 1, label: '' }]);
  };

  const updateSlot = (idx: number, patch: Partial<SlotDraft>) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => {
      const removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      // If we just removed the orchestrator's slot, clear the orchestrator too.
      if (removed && orchestratorPersonaId === removed.personaId) {
        if (!next.some((s) => s.personaId === removed.personaId)) setOrchestratorPersonaId('');
      }
      return next;
    });
  };

  const moveSlot = (idx: number, dir: -1 | 1) => {
    setSlots((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const personaById = useMemo(() => new Map(allPersonas.map((p) => [p.id, p])), [allPersonas]);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const cleanSlots: TeamSlot[] = slots
      .filter((s) => s.personaId.trim().length > 0)
      .map((s) => ({
        personaId: s.personaId.trim(),
        quantity: Math.max(1, Math.min(TEAM_SLOT_MAX, s.quantity || 1)),
        ...(s.label.trim() ? { label: s.label.trim() } : {})
      }));
    // Keep orchestrator only if it's still one of the slots.
    const orch =
      orchestratorPersonaId && cleanSlots.some((s) => s.personaId === orchestratorPersonaId)
        ? orchestratorPersonaId
        : undefined;
    const input: TeamInput = {
      name: name.trim(),
      icon: icon || undefined,
      description: description.trim() || undefined,
      orchestratorPersonaId: orch,
      slots: cleanSlots,
      initialPrompt: initialPrompt.trim() || undefined,
      defaultProjectId: defaultProjectId || undefined
    };
    if (keepsId && team) input.id = team.id;

    const result = await window.cc.teams.save(input);
    if (!result.ok) {
      pushToast(`Save failed: ${result.message}`, 'error');
      setSaving(false);
      return;
    }
    pushToast(`Saved team “${result.value.name}”`, 'info');
    onClose();
  };

  const remove = async () => {
    if (!team) return;
    const result = await window.cc.teams.delete(team.id);
    if (!result.ok) {
      pushToast(`Delete failed: ${result.message}`, 'error');
      return;
    }
    pushToast(
      team.id.startsWith('builtin:')
        ? `Reset “${team.name}” to the built-in default`
        : `Deleted team “${team.name}”`,
      'info'
    );
    onClose();
  };

  const isUserTeam = team?.source === 'user';
  const title = !team
    ? 'New team'
    : isForeignSource
      ? `Duplicate ${team.name}`
      : team.source === 'builtin'
        ? `Override ${team.name}`
        : `Edit ${team.name}`;

  return (
    <>
      <header className="modal-header">
        <h3>{title}</h3>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>
      <div className="modal-body persona-form-body">
        <div className="scheduler-form-field">
          <label htmlFor="team-name">Name</label>
          <input
            id="team-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="e.g. Review Squad"
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
          <label htmlFor="team-desc">Description</label>
          <input
            id="team-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line shown in the catalogue"
          />
        </div>

        <div className="scheduler-form-field">
          <div className="team-slots-head">
            <label>
              Slots {slots.length > 0 && <span className="team-slots-count">· {tabs} tab{tabs === 1 ? '' : 's'}</span>}
            </label>
            <button
              type="button"
              className="settings-btn"
              onClick={addSlot}
              disabled={personas.length === 0}
              title={personas.length === 0 ? 'No personas available' : 'Add a slot'}
            >
              <Plus size={12} /> Add slot
            </button>
          </div>
          {slots.length === 0 ? (
            <p className="settings-help team-slots-empty">
              {personas.length === 0
                ? 'No personas found — create a persona first, then add slots.'
                : 'No slots yet. Add at least one persona slot to launch this team.'}
            </p>
          ) : (
            <ul className="team-slot-list">
              {slots.map((slot, idx) => {
                const known = personaById.has(slot.personaId);
                return (
                  <li key={idx} className="team-slot-edit">
                    <div className="team-slot-reorder">
                      <button
                        type="button"
                        className="icon-button team-slot-move"
                        onClick={() => moveSlot(idx, -1)}
                        disabled={idx === 0}
                        aria-label="Move up"
                        title="Move up"
                      >
                        ▲
                      </button>
                      <GripVertical size={12} className="team-slot-grip" aria-hidden />
                      <button
                        type="button"
                        className="icon-button team-slot-move"
                        onClick={() => moveSlot(idx, 1)}
                        disabled={idx === slots.length - 1}
                        aria-label="Move down"
                        title="Move down"
                      >
                        ▼
                      </button>
                    </div>
                    <PopoverPicklist
                      className="team-slot-persona"
                      value={slot.personaId}
                      ariaLabel="Slot persona"
                      onChange={(personaId) => updateSlot(idx, { personaId })}
                      placeholder="Choose persona"
                      searchPlaceholder="Search personas"
                      options={[
                        // Keep an unknown id selectable so editing a team that references a
                        // not-yet-loaded persona does not silently drop it.
                        ...(!known && slot.personaId ? [{ value: slot.personaId, label: `${slot.personaId} (unknown)` }] : []),
                        ...personas.map((persona) => ({ value: persona.id, label: persona.name }))
                      ]}
                    />
                    <input
                      className="team-slot-label-input"
                      type="text"
                      value={slot.label}
                      onChange={(e) => updateSlot(idx, { label: e.target.value })}
                      placeholder="Label (optional)"
                      aria-label="Slot label"
                    />
                    <input
                      className="team-slot-qty"
                      type="number"
                      min={1}
                      max={TEAM_SLOT_MAX}
                      value={slot.quantity}
                      onChange={(e) =>
                        updateSlot(idx, {
                          quantity: Math.max(
                            1,
                            Math.min(TEAM_SLOT_MAX, Number(e.target.value) || 1)
                          )
                        })
                      }
                      aria-label="Tab count"
                      title="Tabs to open for this slot"
                    />
                    <button
                      type="button"
                      className={`icon-button team-slot-orch-toggle ${orchestratorPersonaId === slot.personaId ? 'is-active' : ''}`}
                      onClick={() =>
                        setOrchestratorPersonaId(
                          orchestratorPersonaId === slot.personaId ? '' : slot.personaId
                        )
                      }
                      aria-pressed={orchestratorPersonaId === slot.personaId}
                      aria-label="Mark as orchestrator"
                      title="Orchestrator — launched first, carries the opening prompt"
                    >
                      <Crown size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button team-slot-remove"
                      onClick={() => removeSlot(idx)}
                      aria-label="Remove slot"
                      title="Remove slot"
                    >
                      <X size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="scheduler-form-field">
          <label htmlFor="team-prompt">Opening prompt</label>
          <textarea
            id="team-prompt"
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            rows={3}
            placeholder="Handed to the orchestrator's tab after it starts"
          />
          <ImprovePromptButton value={initialPrompt} onChange={setInitialPrompt} />
        </div>

        <div className="scheduler-form-field">
          <label htmlFor="team-project">Default project</label>
          <PopoverPicklist
            id="team-project"
            ariaLabel="Default project"
            value={defaultProjectId}
            onChange={setDefaultProjectId}
            placeholder="None — choose at launch"
            searchPlaceholder="Search projects"
            options={[
              { value: '', label: 'None — choose at launch' },
              ...projects.map((project) => ({ value: project.id, label: project.name }))
            ]}
          />
        </div>

        <p className="settings-help persona-form-hint">
          Launching opens one tab per slot quantity — the orchestrator first,
          carrying the opening prompt. Saved to <code>~/.zcc/teams</code>.
        </p>
      </div>
      <footer className="modal-footer persona-form-footer">
        {(isUserTeam || team?.source === 'builtin') && team ? (
          <button
            className="btn danger persona-form-delete"
            onClick={remove}
            title={team.source === 'builtin' ? 'Reset to the built-in default' : 'Delete this team'}
          >
            <Trash2 size={14} /> {team.source === 'builtin' ? 'Reset' : 'Delete'}
          </button>
        ) : null}
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={save}
          disabled={!canSave}
          title={!hasValidSlot ? 'Add at least one slot' : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </>
  );
}
