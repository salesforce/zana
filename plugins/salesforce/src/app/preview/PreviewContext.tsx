import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Braces, Ellipsis, Link2, MessageSquare, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { CONTEXT_TYPES, parsePreviewContext, type ContextType, type PreviewContextField, type PreviewContextVariable } from '../../../lib/preview-context.js';

import { usePreviewContext, type PreviewContextState } from './usePreviewContext.js';
export { usePreviewContext };
export type { PreviewContextState };
const valueText = (row: PreviewContextVariable) => typeof row.value === 'string' ? row.value : JSON.stringify(row.value);

function ContextPresetPicker({ context }: { context: PreviewContextState }) {
  const nameId = useId();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const scope = context.scope;
  useEffect(() => { setNaming(false); setName(''); }, [scope]);
  if (!context.presetsEnabled) return null;
  const save = async () => { if (await context.savePreset(name)) { setNaming(false); setName(''); } };
  return <div className="sf-context-presets">
    <div className="sf-context-preset-bar">
      <label className="sf-context-preset-select"><span>Preset</span><select aria-label="Context preset" disabled={context.presetLoading || context.saving || context.loading || !context.presetScope}
        value={context.selected?.id ?? (context.count ? '__custom' : '')} onChange={event => { context.loadPreset(context.presets.find(p => p.id === event.target.value) ?? null); setNaming(false); }}>
        <option value="">Runtime defaults</option>{context.count > 0 && !context.selected && <option value="__custom" disabled>Custom context</option>}
        {context.presets.map(p => <option key={p.id} value={p.id}>{p.name}{p.savedBy === 'agent' ? ' · by agent' : ''}</option>)}</select></label>
      {context.selected && (context.needsReview || context.edited) && <span className="sf-context-preset-badge" data-review={context.needsReview}>{context.needsReview ? 'Needs review' : 'Edited'}</span>}
      <button type="button" className="sf-context-save-as" disabled={context.saving || context.presetLoading || context.loading || Boolean(context.error) || !context.presetScope} onClick={() => setNaming(true)}>Save as…</button>
      {context.selected && <details className="sf-context-options sf-context-preset-options"><summary aria-label="Preset options"><Ellipsis size={16} aria-hidden="true" /></summary><div className="sf-context-options-menu">
        <button type="button" disabled={!context.edited || Boolean(context.error) || context.saving || context.loading} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void context.savePreset(context.selected!.name, true); }}>Update preset</button>
        <button type="button" onClick={event => { context.loadPreset(context.presets.find(p => p.id === context.selected?.id) ?? context.selected); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Restore saved values</button>
        <button type="button" disabled={context.presetLoading || context.saving} onClick={event => { context.reloadPresets(); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Reload presets</button>
      </div></details>}
    </div>
    {naming && <form className="sf-context-preset-name" onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setNaming(false); } }}>
      <label className="sf-context-sr" htmlFor={`${nameId}-preset-name`}>Preset name</label><input autoFocus id={`${nameId}-preset-name`} placeholder="Name this context…" maxLength={60} value={name} disabled={context.saving} onChange={event => setName(event.target.value)} />
      <button className="is-primary" type="submit" disabled={context.saving || !name.trim() || Boolean(context.error)}>{context.saving ? 'Saving…' : 'Save preset'}</button><button type="button" aria-label="Cancel saving preset" disabled={context.saving} onClick={() => setNaming(false)}><X size={14} /></button>
    </form>}
    <div className="sf-context-preset-meta"><span>{context.presetLoading ? 'Loading presets…' : context.orgLabel ? `Saved for this agent · ${context.orgLabel}` : 'Presets are stored in this project.'}</span>{context.canUndo && <button type="button" onClick={context.undo}><RotateCcw size={11} aria-hidden="true" />Undo</button>}</div>
    {context.selected && context.presets.some(p => p.id === context.selected?.id && p.revision > context.selected.revision) && <p className="sf-context-preset-error" role="status">A newer revision is available. Restore saved values from the preset menu, or save a copy.</p>}
    {context.presetError && <p className="sf-context-preset-error" role="status">{context.presetError} <button type="button" disabled={context.presetLoading} onClick={context.reloadPresets}>Reload presets</button></p>}
  </div>;
}

export function PreviewContextTabs({ context }: { context: PreviewContextState }) {
  const id = context.id;
  return <div className="sf-context-tabs" role="tablist" aria-label="Preview panels">
    {(['conversation', 'context'] as const).map((tab, index) => <button key={tab} type="button" role="tab" id={`${id}-${tab}`}
      aria-selected={context.tab === tab} aria-controls={`${id}-${tab}-panel`} tabIndex={context.tab === tab ? 0 : -1}
      onClick={() => context.setTab(tab)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
        context.setTab(next === 0 ? 'conversation' : 'context');
        (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
      }}>{tab === 'conversation' ? <><MessageSquare size={14} aria-hidden="true" />Conversation</> : <><SlidersHorizontal size={14} aria-hidden="true" />Context <span>{context.count}</span></>}</button>)}
  </div>;
}

function AppliedContext({ values, preset }: { values: PreviewContextVariable[]; preset: PreviewContextState['appliedPreset'] }) {
  return <details className="sf-context-applied"><summary>Applied to this run · {values.length} {values.length === 1 ? 'variable' : 'variables'}</summary>
    {preset && <p className="sf-context-preset-provenance">{preset.name} · revision {preset.revision}{preset.edited ? ' · edited values' : ''}</p>}
    {values.length ? <dl>{values.map(row => <div key={row.name}><dt>{row.name} <small>{row.type}</small></dt><dd>{valueText(row)}</dd></div>)}</dl> : <p>No overrides. The runtime uses its defaults.</p>}
  </details>;
}

export function PreviewContextEditor({ context, running = false, onRestart, dialog = false }: { context: PreviewContextState; running?: boolean; onRestart?(): void; dialog?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ContextType>('Text');
  const [addError, setAddError] = useState('');
  const id = useId();
  const editor = useRef<HTMLDivElement>(null);
  // One options menu at a time; a press anywhere outside it closes it.
  useEffect(() => {
    const root = editor.current;
    if (!root) return;
    const close = (event: Event) => {
      for (const menu of root.querySelectorAll<HTMLDetailsElement>('details.sf-context-options[open]')) {
        if (!menu.contains(event.target as Node)) menu.open = false;
      }
    };
    const doc = root.ownerDocument;
    doc.addEventListener('pointerdown', close, true);
    doc.addEventListener('focusin', close, true);
    return () => { doc.removeEventListener('pointerdown', close, true); doc.removeEventListener('focusin', close, true); };
  }, []);
  const setEntry = (field: PreviewContextField, text: string | undefined) => { context.clearAgent(field.name); context.setEntries(prev => {
    if (text !== undefined) return { ...prev, [field.name]: { type: field.type, text } };
    const next = { ...prev }; delete next[field.name]; return next;
  }); };
  const initialText = (field: PreviewContextField) => field.defaultValue !== undefined
    ? typeof field.defaultValue === 'string' ? field.defaultValue : JSON.stringify(field.defaultValue)
    : field.type === 'Boolean' ? 'false' : '';
  const displayLabel = (field: PreviewContextField) => field.label === field.name
    ? field.label.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
    : field.label;
  const groups = [
    { label: 'Agent variables', linked: false, icon: Braces },
    { label: 'Session context', linked: true, icon: Link2 }
  ];
  function add() {
    try {
      const initial = type === 'Boolean' ? false : type === 'Number' ? 0 : type === 'Json' ? {} : type === 'Object' || type === 'List' ? [] : type === 'Date' ? '2026-01-01' : type === 'DateTime' ? '2026-01-01T00:00:00Z' : '';
      parsePreviewContext([{ name: name.trim(), type, value: initial }]);
      if (context.fields.length >= 100) throw Error('A preview supports at most 100 context variables.');
      if (context.fields.some(f => f.name === name.trim())) throw Error('That variable is already listed.');
      context.setManual(prev => [...prev, { name: name.trim(), label: name.trim(), type }]);
      setName(''); setAdding(false); setAddError('');
    } catch (error) { setAddError((error as Error).message); }
  }
  return <div className="sf-context-editor" ref={editor}>
    {!dialog && <div className="sf-context-heading"><div><h3>Starting context</h3><p>Edit a value to override its default for the next run.</p></div>{context.count > 0 && <button type="button" className="sf-context-reset" onClick={() => context.reset()} aria-label="Clear overrides"><RotateCcw size={13} aria-hidden="true" />Reset</button>}</div>}
    <ContextPresetPicker context={context} />
    {context.discoveryError && <p className="sf-context-warning" role="status">Could not discover variables: {context.discoveryError} You can add them manually.</p>}
    {context.loading && <p role="status">Finding variables…</p>}
    {!context.loading && !context.fields.length && <div className="sf-context-empty">No externally settable variables found.<br />Add a variable manually for a published agent or a runtime-specific input.</div>}
    {groups.map(group => {
      const rows = context.fields.filter(field => field.name.startsWith('$Context.') === group.linked);
      if (!rows.length) return null;
      const Icon = group.icon;
      return <section className="sf-context-group" key={group.label} aria-label={group.label}>
        <div className="sf-context-group-title"><Icon size={13} aria-hidden="true" /><h4>{group.label}</h4><span>{rows.length}</span></div>
        <div className="sf-context-rows">{rows.map(field => {
      const entry = Object.hasOwn(context.entries, field.name) ? context.entries[field.name] : undefined;
      const fieldId = `${id}-${context.fields.indexOf(field)}`;
      const helperId = `${fieldId}-help`;
      const issue = context.fieldErrors[field.name];
      const showIssue = Boolean(issue && (context.touched[field.name] || context.reviewErrors || context.compatibilityErrors[field.name]));
      const accessibility = { 'aria-invalid': showIssue || undefined, 'aria-describedby': `${helperId}${showIssue ? ` ${fieldId}-error` : ''}`, onBlur: () => context.touch(field.name), 'data-context-name': field.name };
      const defaultText = field.defaultValue === undefined ? 'Enter a value…' : typeof field.defaultValue === 'string' ? field.defaultValue || 'Empty text' : JSON.stringify(field.defaultValue);
      return <div className="sf-context-field" key={field.name} data-custom={Boolean(entry)} data-invalid={showIssue}>
        <div className="sf-context-field-head"><label htmlFor={fieldId}>{displayLabel(field)}</label><span className="sf-context-type">{field.type}{context.agentSet[field.name] && <span className="sf-context-agent" title="Set by an agent. Edit it to make it yours.">Agent</span>}</span>
          <label className="sf-context-mode" title={entry ? 'Use the runtime default' : 'Set a custom value'}><input type="checkbox" aria-label={`Set ${field.label}`} checked={Boolean(entry)} onChange={event => setEntry(field, event.target.checked ? initialText(field) : undefined)} /><span>{entry?.isNull ? 'Null' : entry ? 'Custom' : field.defaultValue === undefined ? 'Unset' : 'Default'}</span></label>
          <details className="sf-context-options" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation(); } }}>
            <summary aria-label={`Options for ${field.label}`}><Ellipsis size={16} aria-hidden="true" /></summary>
            <div className="sf-context-options-menu"><code>{field.name}</code>
              <button type="button" aria-label={`Set ${field.label} to null`} aria-pressed={Boolean(entry?.isNull)} onClick={event => { context.clearAgent(field.name); context.setEntries(prev => ({ ...prev, [field.name]: { type: field.type, text: prev[field.name]?.text ?? initialText(field), isNull: !entry?.isNull } })); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{entry?.isNull ? 'Use a value' : 'Set to null'}</button>
              <button type="button" onClick={event => { setEntry(field, undefined); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Use runtime default</button>
              {context.manual.some(f => f.name === field.name) && <button type="button" className="is-danger" aria-label={`Remove ${field.label}`} onClick={() => { setEntry(field, undefined); context.setManual(prev => prev.filter(f => f.name !== field.name)); }}>Remove variable</button>}
            </div>
          </details></div>
        <div className="sf-context-value">
        <label className="sf-context-sr" htmlFor={fieldId}>{field.label} value</label>
        {entry?.isNull ? <div className="sf-context-null-value" id={fieldId} tabIndex={-1} {...accessibility}>null</div>
          : field.type === 'Boolean' ? <select id={fieldId} aria-label={`${field.label} value`} {...accessibility} value={entry?.text ?? ''} onChange={event => setEntry(field, event.target.value)}><option value="" disabled>{field.defaultValue === undefined ? 'Choose a value…' : `${field.defaultValue ? 'True' : 'False'} (default)`}</option><option value="false">False</option><option value="true">True</option></select>
          : ['Json', 'List', 'Object'].includes(field.type) ? <textarea id={fieldId} aria-label={`${field.label} value`} {...accessibility} value={entry?.text ?? ''} placeholder={field.defaultValue !== undefined ? defaultText : field.type === 'Json' ? '{"key": "value"}' : '[]'} onChange={event => setEntry(field, event.target.value)} rows={2} maxLength={64_000} spellCheck={false} />
          : <input id={fieldId} aria-label={`${field.label} value`} {...accessibility} type={field.type === 'Date' ? 'date' : 'text'} inputMode={field.type === 'Number' ? 'decimal' : undefined} value={entry?.text ?? (field.type === 'Date' && typeof field.defaultValue === 'string' ? field.defaultValue : '')} placeholder={defaultText} maxLength={64_000} onChange={event => setEntry(field, event.target.value)} />}
        </div>
        {showIssue && <p className="sf-context-field-error" role="alert" id={`${fieldId}-error`}>{issue}</p>}
        <p id={helperId} className={field.description || field.source ? 'sf-context-field-help' : 'sf-context-sr'}>{field.description || field.source || field.name}{field.description && field.source ? ` · ${field.source}` : ''}</p>
      </div>;
    })}</div></section>;
    })}
    {!adding && <button type="button" className="sf-context-add" onClick={() => setAdding(true)} aria-label="+ Add variable" aria-expanded={false}><Plus size={14} aria-hidden="true" />Add variable</button>}
    {adding && <div className="sf-context-manual" role="group" aria-label="New context variable" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); add(); } if (event.key === 'Escape') { event.stopPropagation(); setAdding(false); setAddError(''); } }}><div className="sf-context-manual-heading"><strong>Add a variable</strong><button type="button" aria-label="Cancel adding variable" onClick={() => { setAdding(false); setAddError(''); }}><X size={14} aria-hidden="true" /></button></div><label>Variable name<input autoFocus aria-label="Variable name" value={name} maxLength={140} placeholder="e.g. $Context.locale" onChange={event => setName(event.target.value)} /></label><label>Type<select aria-label="Variable type" value={type} onChange={event => setType(event.target.value as ContextType)}>{CONTEXT_TYPES.map(t => <option key={t}>{t}</option>)}</select></label><button type="button" className="is-primary" onClick={add}>Add</button>{addError && <p role="alert">{addError}</p>}</div>}
    {Object.keys(context.fieldErrors).length > 0 && <button type="button" className="sf-context-validation" onClick={() => {
      context.revealErrors();
      const target = [...(editor.current?.querySelectorAll<HTMLElement>('[data-context-name]') ?? [])].find(el => context.fieldErrors[el.dataset.contextName ?? '']);
      target?.focus();
    }}>{Object.keys(context.fieldErrors).length} {Object.keys(context.fieldErrors).length === 1 ? 'value needs' : 'values need'} attention</button>}
    {context.aggregateErrors.map(message => <p key={message} className="sf-context-error" role="alert">{message}</p>)}
    {!dialog && context.applied !== null && <AppliedContext values={context.applied} preset={context.appliedPreset} />}
    {!dialog && context.changed && <div className="sf-context-warning">{running ? 'These edits apply to a new run. The current conversation keeps its original context.' : 'These edits will apply when you start a new run.'}{running && onRestart && <button type="button" onClick={onRestart}>Review & restart</button>}</div>}
  </div>;
}

export function PreviewContextSetup({ context, busy, running, error, onStart, onClose }: { context: PreviewContextState; busy: boolean; running: boolean; error?: string | null; onStart(): void; onClose(): void }) {
  const element = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    element.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { previous?.focus(); };
  }, []);
  useEffect(() => { if (busy) element.current?.focus(); }, [busy]);
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busyRef.current) { event.stopPropagation(); close.current(); }
    if (event.key !== 'Tab') return;
    const controls = [...element.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')].filter(control => !control.closest('fieldset:disabled') && (!control.closest('details:not([open])') || control.tagName === 'SUMMARY'));
    if (!controls.length) { event.preventDefault(); return; }
    if (document.activeElement === element.current) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus(); return; }
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  };
  return createPortal(<div className="sf-context-backdrop"><div ref={element} tabIndex={-1} className="sf-context-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={key}>
    <header><div><span className="sf-context-eyebrow"><SlidersHorizontal size={13} aria-hidden="true" />Preview setup</span><h3 id={`${id}-title`}>{running ? 'Restart with new context' : 'Start a conversation'}</h3></div><button type="button" aria-label="Close preview setup" disabled={busy} onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
    <p className="sf-context-dialog-intro">{running ? 'Restarting ends the current conversation. Review the values for your next run.' : 'Review the starting context. You can leave variables unset to use their defaults.'}</p>
    <div className="sf-context-dialog-body"><fieldset disabled={busy}><PreviewContextEditor context={context} dialog /></fieldset>{error && <p className="sf-context-error" role="alert">{error}</p>}</div>
    <footer><span>{context.count} {context.count === 1 ? 'override' : 'overrides'}</span><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="is-primary" disabled={busy || context.loading || Boolean(context.error)} onClick={onStart}>{busy ? 'Starting…' : running ? 'Restart preview' : 'Start preview'}</button></footer>
  </div></div>, document.body);
}

export const PREVIEW_CONTEXT_STYLES = `
.sf-context-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--sf-border);flex-shrink:0}
.sf-context-tabs button{display:flex;align-items:center;gap:7px;font:inherit;font-size:12px;font-weight:500;background:none;border:0;border-radius:6px;padding:7px 10px;color:var(--sf-muted);cursor:pointer;transition:background .12s,color .12s}
.sf-context-tabs button:hover{background:var(--sf-sunken);color:var(--sf-text)}
.sf-context-tabs button[aria-selected=true]{background:var(--sf-soft);color:var(--sf-accent)}
.sf-context-tabs span{font-size:10px;line-height:16px;min-width:16px;text-align:center;border-radius:5px;background:color-mix(in srgb,currentColor 10%,transparent);padding:0 4px}
.sf-context-panel{flex:1;min-height:0;overflow:auto}
.sf-context-conversation{display:flex;flex:1;flex-direction:column;min-height:0}.sf-context-conversation[hidden]{display:none}
.sf-context-editor{container-type:inline-size;padding:20px;max-width:680px;margin:0 auto;user-select:text;-webkit-user-select:text;color:var(--sf-text);font-size:12px;box-sizing:border-box;width:100%}
.sf-context-editor button,.sf-context-dialog button{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;border:1px solid var(--sf-border);border-radius:6px;background:var(--sf-bg);color:var(--sf-text);padding:6px 9px;cursor:pointer}
.sf-context-editor button:hover,.sf-context-dialog button:hover{background:var(--sf-sunken)}
.sf-context-editor button:disabled,.sf-context-dialog button:disabled{opacity:.5;cursor:default}
.sf-context-heading{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
.sf-context-heading h3{font-size:15px;font-weight:650;letter-spacing:-.02em;margin:0 0 6px}.sf-context-heading p{margin:0;color:var(--sf-muted);line-height:1.5}
.sf-context-editor .sf-context-reset{flex-shrink:0;border:0;background:none;padding:3px 0;color:var(--sf-muted);font-size:11px}
.sf-context-presets{margin:-5px 0 20px}.sf-context-preset-bar{display:flex;align-items:center;gap:8px;min-width:0}.sf-context-preset-select{display:flex;flex:1;min-width:0;align-items:center;gap:9px;font-size:11px;color:var(--sf-muted)}.sf-context-preset-select select{width:100%;min-width:0;max-width:280px;font:inherit;font-size:12px;color:var(--sf-text);background:var(--sf-bg);border:1px solid var(--sf-border);border-radius:6px;padding:7px 9px;overflow:hidden;text-overflow:ellipsis}.sf-context-preset-badge{font-size:10px;color:var(--sf-muted);white-space:nowrap}.sf-context-preset-badge[data-review=true]{color:var(--sf-warn)}.sf-context-editor .sf-context-save-as{flex-shrink:0;font-size:11px;border:0;color:var(--sf-accent);background:none;padding:6px 2px}.sf-context-preset-options{display:block;flex-shrink:0}.sf-context-preset-meta{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:10px;color:var(--sf-muted);margin:7px 0 0;min-height:20px}.sf-context-preset-meta>span{overflow-wrap:anywhere}.sf-context-editor .sf-context-preset-meta button{border:0;background:none;padding:2px;color:var(--sf-accent);font-size:10px}.sf-context-preset-name{display:flex;gap:6px;margin-top:10px}.sf-context-preset-name input{min-width:0;flex:1;border:1px solid var(--sf-border);background:var(--sf-bg);color:var(--sf-text);border-radius:6px;font:inherit;padding:7px 9px}.sf-context-preset-error{font-size:11px;line-height:1.6;color:var(--sf-muted);margin:6px 0 0;overflow-wrap:anywhere}.sf-context-editor .sf-context-preset-error button{border:0;background:none;padding:0;color:var(--sf-accent);text-decoration:underline}.sf-context-field[data-invalid=true] .sf-context-value>:is(input,textarea,select){border-color:var(--sf-danger)}.sf-context-field-error{grid-column:1 / -1;margin:7px 0 0;color:var(--sf-danger);font-size:11px;line-height:1.5;overflow-wrap:anywhere}.sf-context-editor .sf-context-validation{margin-top:12px;border:0;background:none;padding:0;color:var(--sf-danger);font-size:11px}.sf-context-preset-provenance{color:var(--sf-muted);font-size:11px}
.sf-context-group{margin:0 0 18px}.sf-context-group-title{display:flex;align-items:center;gap:7px;margin:0 0 9px;color:var(--sf-muted)}.sf-context-group-title h4{font-size:11px;font-weight:600;margin:0}.sf-context-group-title>span{margin-left:auto;font-size:10px}
.sf-context-rows{border:1px solid var(--sf-border);border-radius:9px;background:color-mix(in srgb,var(--sf-sunken) 28%,var(--sf-bg))}
.sf-context-field{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:0 16px;align-items:center;padding:12px}
.sf-context-field+.sf-context-field{border-top:1px solid color-mix(in srgb,var(--sf-border) 65%,transparent)}
.sf-context-field-head{display:grid;grid-template-columns:minmax(0,1fr) auto 22px;gap:3px 7px;align-items:center;min-width:0}
.sf-context-field-head>label:first-child{grid-column:1;grid-row:1;font-size:12px;font-weight:550;overflow-wrap:anywhere}
.sf-context-type{grid-column:1;grid-row:2;font-size:10px;color:var(--sf-muted)}
.sf-context-agent{margin-left:6px;padding:0 5px;border-radius:4px;font-size:9px;line-height:14px;font-weight:600;background:color-mix(in srgb,var(--sf-accent) 12%,transparent);color:var(--sf-accent)}
.sf-context-mode{grid-column:2;grid-row:1 / span 2;position:relative;cursor:pointer;user-select:none}
.sf-context-mode input{position:absolute;inset:0;opacity:0;width:100%;height:100%;margin:0;cursor:inherit}
.sf-context-mode span{display:inline-block;padding:3px 6px;border-radius:4px;font-size:10px;line-height:14px;background:var(--sf-sunken);color:var(--sf-muted)}
.sf-context-mode input:checked+span{background:var(--sf-soft);color:var(--sf-accent)}.sf-context-mode:focus-within{outline:2px solid var(--sf-accent);outline-offset:2px;border-radius:4px}
.sf-context-options{grid-column:3;grid-row:1 / span 2;position:relative;align-self:center}
.sf-context-options summary{list-style:none;display:flex;align-items:center;justify-content:center;width:22px;height:26px;border-radius:4px;color:var(--sf-muted);cursor:pointer}.sf-context-options summary::-webkit-details-marker{display:none}.sf-context-options summary:hover,.sf-context-options[open] summary{background:var(--sf-sunken);color:var(--sf-text)}
.sf-context-options-menu{position:absolute;right:0;top:30px;width:185px;z-index:25;display:flex;flex-direction:column;padding:5px;background:var(--sf-bg);border:1px solid var(--sf-border);border-radius:8px;box-shadow:0 5px 18px #0002}
.sf-context-options-menu code{font-size:10px;color:var(--sf-muted);overflow-wrap:anywhere;padding:6px 7px 8px;border-bottom:1px solid var(--sf-border);margin-bottom:4px}
.sf-context-editor .sf-context-options-menu button{justify-content:flex-start;border:0;text-align:left;font-size:11px;padding:7px}.sf-context-options-menu .is-danger{color:var(--sf-danger)}
.sf-context-value{min-width:0;display:flex;align-items:center}
.sf-context-value>input,.sf-context-value>select,.sf-context-value>textarea,.sf-context-manual input,.sf-context-manual select{width:100%;min-width:0;box-sizing:border-box;font:inherit;border:1px solid var(--sf-border);border-radius:6px;padding:8px 9px;background:var(--sf-bg);color:var(--sf-text)}
.sf-context-value :is(input,select){height:34px}.sf-context-value input::placeholder,.sf-context-value textarea::placeholder{color:var(--sf-muted);opacity:.72}
.sf-context-value>textarea{font:11px/1.6 ui-monospace,monospace;resize:vertical}.sf-context-field[data-custom=false] .sf-context-value select{color:var(--sf-muted)}
.sf-context-null-value{width:100%;padding:8px 9px;box-sizing:border-box;border:1px dashed var(--sf-border);border-radius:6px;font:12px ui-monospace,monospace;color:var(--sf-muted)}
.sf-context-field-help{grid-column:1 / -1;font-size:10px;line-height:1.5;color:var(--sf-muted);overflow-wrap:anywhere;margin:7px 0 0}
.sf-context-empty{border:1px dashed var(--sf-border);border-radius:9px;padding:24px 16px;line-height:1.7;color:var(--sf-muted);text-align:center;margin-bottom:14px}
.sf-context-editor .sf-context-add{width:100%;justify-content:center;border-style:dashed;background:none;color:var(--sf-muted);padding:9px}
.sf-context-manual{display:grid;grid-template-columns:minmax(0,1fr) 105px auto;gap:12px 8px;align-items:end;padding:12px;border:1px solid var(--sf-border);border-radius:9px;background:var(--sf-sunken)}
.sf-context-manual-heading{grid-column:1 / -1;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}.sf-context-editor .sf-context-manual-heading button{padding:3px;border:0;background:none;color:var(--sf-muted)}
.sf-context-manual label{min-width:0;display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--sf-muted)}.sf-context-manual input,.sf-context-manual select{height:34px;font-size:12px}.sf-context-manual p{grid-column:1 / -1;margin:0}
.sf-context-error{color:var(--sf-danger);overflow-wrap:anywhere;line-height:1.6}.sf-context-warning{background:color-mix(in srgb,var(--sf-warn) 7%,var(--sf-bg));border:1px solid color-mix(in srgb,var(--sf-warn) 28%,var(--sf-border));border-radius:8px;padding:12px;line-height:1.6;margin:14px 0}.sf-context-warning button{margin-top:9px}
.sf-context-applied{margin-top:18px;border:1px solid var(--sf-border);padding:11px 12px;border-radius:8px}.sf-context-applied summary{cursor:pointer;font-weight:500;font-size:11px}.sf-context-applied dl{margin:10px 0 0}.sf-context-applied dl>div{padding:8px 0;border-top:1px solid var(--sf-border)}.sf-context-applied dt{font-size:11px}.sf-context-applied small{color:var(--sf-muted);font-weight:400}.sf-context-applied dd{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px ui-monospace,monospace}
.sf-context-backdrop{position:fixed;inset:0;z-index:1000;background:#0005;backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:16px}
.sf-context-dialog{width:min(580px,100%);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:var(--sf-bg);color:var(--sf-text);border:1px solid var(--sf-border);border-radius:14px;box-shadow:0 20px 80px #0003;font-size:12px}
.sf-context-dialog header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 22px 10px}.sf-context-dialog header>button{border:0;padding:4px;color:var(--sf-muted)}.sf-context-dialog h3{margin:10px 0 0;font-size:19px;letter-spacing:-.025em;font-weight:650}.sf-context-eyebrow{display:flex;align-items:center;gap:6px;color:var(--sf-muted);font-size:11px;font-weight:500}.sf-context-dialog-intro{margin:0;padding:0 22px;color:var(--sf-muted);line-height:1.6}.sf-context-dialog-body{overflow:auto;min-height:0}.sf-context-dialog .sf-context-editor{padding:20px 22px}.sf-context-dialog fieldset{margin:0;padding:0;border:0;min-width:0}.sf-context-dialog footer{display:flex;align-items:center;gap:8px;padding:14px 22px;border-top:1px solid var(--sf-border);background:var(--sf-sunken);border-radius:0 0 14px 14px}.sf-context-dialog footer span{flex:1;color:var(--sf-muted);font-size:11px}.sf-context-dialog .is-primary,.sf-context-editor .is-primary{background:var(--sf-accent);color:#fff;border-color:var(--sf-accent)}.sf-context-dialog .is-primary:hover,.sf-context-editor .is-primary:hover{filter:brightness(1.06);background:var(--sf-accent)}
.sf-context-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.sf-context-tabs button:focus-visible,.sf-context-editor :is(button,input,textarea,select,summary):focus-visible,.sf-context-dialog button:focus-visible{outline:2px solid var(--sf-accent);outline-offset:2px}
@container (max-width:460px){.sf-context-field{grid-template-columns:minmax(0,1fr);gap:9px}.sf-context-field-help{margin:0}.sf-context-manual{grid-template-columns:minmax(0,1fr) 92px}.sf-context-manual>.is-primary{grid-column:1 / -1}.sf-context-heading{margin-bottom:20px}}
@media (prefers-reduced-motion:reduce){.sf-context-tabs button{transition:none}}
`;
