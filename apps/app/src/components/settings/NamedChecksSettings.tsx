import { useEffect, useId, useRef, useState } from 'react';
import { NamedCheckSchema, NamedChecksSchema, type NamedCheck, type NamedCheckScope } from '@zana-ai/zcc-contracts/project-settings';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { Field, Section } from './FormFields.js';
import './NamedChecksSettings.css';

const SEARCH_TARGETS = {
  global: { searchId: 'global.named-checks' },
  project: { searchId: 'project.named-checks' }
} as const;
type CheckDraft = NamedCheck & { id: number; persisted: boolean };

export function NamedChecksSettings({ projectId }: { projectId?: string }) {
  const [draft, setDraft] = useState<CheckDraft[] | null>(null);
  const [baseline, setBaseline] = useState<NamedCheck[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const nextId = useRef(0);
  const scopeGeneration = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const editButtons = useRef(new Map<number, HTMLButtonElement>());
  const fieldId = useId();
  const [global, setGlobal] = useState<NamedCheck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const desktop = hasDesktopBridge();
  const scope: NamedCheckScope = projectId ? { kind: 'project', projectId } : { kind: 'global' };

  useEffect(() => {
    scopeGeneration.current++;
    let cancelled = false;
    setDraft(null); setError(null); setGlobal([]); setSaved(false); setEditingId(null); setBaseline([]); setBusy(false);
    if (!desktop) return;
    void Promise.all([
      product.namedChecks.get(projectId ? { kind: 'project', projectId } : { kind: 'global' }),
      projectId ? product.namedChecks.get({ kind: 'global' }) : Promise.resolve([])
    ]).then(([checks, defaults]) => {
      if (!cancelled) {
        setDraft(checks.map((check) => ({ ...check, id: nextId.current++, persisted: true })));
        setBaseline(checks); setGlobal(defaults);
      }
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load checks.');
    });
    return () => { cancelled = true; scopeGeneration.current++; };
  }, [projectId, desktop]);

  useEffect(() => { if (editingId !== null) nameInput.current?.focus(); }, [editingId]);

  const update = (checks: CheckDraft[]) => { setDraft(checks); setSaved(false); };
  const checks = draft?.map(({ name, command }) => ({ name, command })) ?? [];
  const dirty = JSON.stringify(checks) !== JSON.stringify(baseline);
  const save = async () => {
    if (!draft) return;
    const generation = scopeGeneration.current;
    setBusy(true); setError(null); setSaved(false);
    try {
      const savedChecks = await product.namedChecks.set(scope, NamedChecksSchema.parse(checks));
      if (generation !== scopeGeneration.current) return;
      setDraft(savedChecks.map((check, index) => ({ ...check, id: draft[index]?.id ?? nextId.current++, persisted: true })));
      setBaseline(savedChecks);
      setSaved(true);
    } catch (cause) {
      if (generation === scopeGeneration.current) setError(cause instanceof Error ? cause.message : 'Could not save checks.');
    } finally { if (generation === scopeGeneration.current) setBusy(false); }
  };
  const inherited = global.filter((check) => !draft?.some((entry) => entry.name === check.name));
  const valid = draft !== null && NamedChecksSchema.safeParse(checks).success;
  const add = (check: NamedCheck) => {
    if (!draft) return;
    const id = nextId.current++;
    update([...draft, { ...check, id, persisted: false }]);
    setEditingId(id);
  };

  return (
    <Section title="Named checks" {...SEARCH_TARGETS[projectId ? 'project' : 'global']} anchorId="named-checks" help={projectId
      ? 'Project commands override global checks with the same name. Remove an override to inherit again.'
      : 'Owner-managed shell commands. Plans and agents reference check:<name>; they cannot author commands.'}>
      {!desktop && <p className="settings-help">Manage named checks in the owner desktop window.</p>}
      {desktop && !draft && !error && <p className="settings-help" role="status">Loading checks…</p>}
      {error && <p className="modal-error" role="alert">{error}</p>}
      {desktop && draft && <div className="named-checks">
        <p className="settings-help">Commands run in the authorized checkout with your shell environment. Output is untrusted. Only add commands you trust.</p>
        {draft.length + inherited.length === 0 ? <p className="settings-help">No named checks yet. Add a check to reference it in a Squad plan.</p> : <>
        <div className="named-checks-row named-checks-heading" aria-hidden="true"><span>Name</span><span>Command</span><span>Scope</span><span>Actions</span></div>
        <ul className="named-checks-list" aria-label="Named checks">
        {draft.map((check, index) => {
          const nameError = !NamedCheckSchema.shape.name.safeParse(check.name).success
            ? 'Start with a letter or underscore; use letters, numbers, underscores or hyphens. Maximum 100 characters.'
            : draft.some((entry) => entry.id !== check.id && entry.name === check.name) ? 'Check names must be unique within this scope.' : undefined;
          const commandError = !NamedCheckSchema.shape.command.safeParse(check.command).success ? 'Enter a non-empty command, up to 16,384 characters, without null characters.' : undefined;
          const isOverride = Boolean(projectId && global.some((entry) => entry.name === check.name));
          const open = editingId === check.id;
          const label = check.name || 'New check';
          const nameErrorId = `${fieldId}-${check.id}-name-error`;
          const commandErrorId = `${fieldId}-${check.id}-command-error`;
          return <li key={check.id} className="named-checks-item">
            <div className="named-checks-row">
              <span className="named-checks-name">{label}{nameError || commandError ? <span className="named-checks-invalid">Needs attention</span> : null}</span>
              <code className="named-checks-command" title={check.command}>{check.command.split(/\r?\n/)[0] || 'No command'}{check.command.includes('\n') ? ' [multiline]' : ''}</code>
              <span className="named-checks-scope">{projectId ? isOverride ? 'Project override' : 'Project' : 'Global'}</span>
              <div className="named-checks-actions">
                <button ref={(button) => { if (button) editButtons.current.set(check.id, button); else editButtons.current.delete(check.id); }} type="button" className="settings-btn" disabled={busy} aria-label={`Edit ${label}`} aria-expanded={open} aria-controls={`${fieldId}-${check.id}-editor`} onClick={() => setEditingId(open ? null : check.id)}>{open ? 'Editing' : 'Edit'}</button>
                <button type="button" className="settings-btn" disabled={busy} aria-label={`Remove check ${index + 1}`} title={isOverride ? 'Restores the global check after saving.' : undefined} onClick={() => {
                  update(draft.filter((entry) => entry.id !== check.id));
                  if (open) setEditingId(null);
                  addButton.current?.focus();
                }}>{isOverride ? 'Remove override' : check.persisted ? 'Remove' : 'Discard'}</button>
              </div>
            </div>
            {open ? <div id={`${fieldId}-${check.id}-editor`} className="named-checks-editor">
              <Field label={`Check name ${index + 1}`}>
                <input ref={nameInput} value={check.name} maxLength={100} disabled={busy} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? nameErrorId : undefined} spellCheck={false} onChange={(event) => update(draft.map((entry) => entry.id === check.id ? { ...entry, name: event.target.value } : entry))} />
              </Field>
              {nameError ? <p id={nameErrorId} className="named-checks-invalid">{nameError}</p> : null}
              <Field label={`Command ${index + 1}`} mono>
                <textarea value={check.command} maxLength={16_384} rows={3} disabled={busy} aria-invalid={Boolean(commandError)} aria-describedby={commandError ? commandErrorId : undefined} spellCheck={false} onChange={(event) => update(draft.map((entry) => entry.id === check.id ? { ...entry, command: event.target.value } : entry))} />
              </Field>
              {commandError ? <p id={commandErrorId} className="named-checks-invalid">{commandError}</p> : null}
              <div className="named-checks-actions"><span className="settings-help">Done editing closes this editor. Save checks applies all changes.</span><button type="button" className="settings-btn" disabled={busy} onClick={() => { setEditingId(null); editButtons.current.get(check.id)?.focus(); }}>Done editing</button></div>
            </div> : null}
          </li>;
        })}
        {inherited.map((check) => <li className="named-checks-item" key={`global-${check.name}`}>
          <div className="named-checks-row">
            <span className="named-checks-name">{check.name}</span>
            <code className="named-checks-command" title={check.command}>{check.command.split(/\r?\n/)[0]}{check.command.includes('\n') ? ' [multiline]' : ''}</code>
            <span className="named-checks-scope">Inherited</span>
            <div className="named-checks-actions"><button type="button" className="settings-btn" disabled={busy || draft.length >= 64} aria-label={`Override ${check.name}`} onClick={() => add(check)}>Override</button></div>
          </div>
        </li>)}
        </ul>
        </>}
        <div className="named-checks-footer">
          <button ref={addButton} type="button" className="settings-btn" disabled={busy || draft.length >= 64} onClick={() => add({ name: '', command: '' })}>Add check</button>
          <span className="settings-help" role="status">{dirty ? 'Unsaved changes' : ''}</span>
          <button type="button" className="settings-btn" disabled={busy || !valid || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save checks'}</button>
        </div>
        {!valid && <p className="settings-help">Review checks marked Needs attention before saving.</p>}
        {saved && <p className="settings-help" role="status">Checks saved.</p>}
      </div>}
    </Section>
  );
}
