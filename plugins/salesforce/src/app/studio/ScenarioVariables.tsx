import { useId, useState } from 'react';
import { CONTEXT_TYPES, validateContextEntries, parsePreviewContext, type ContextEntry, type ContextType, type PreviewContextField, type PreviewContextVariable } from '../../../lib/preview-context.js';
import type { ContextPreset } from '../../../lib/preview-context-preset-contract.js';
import { VariablePresetPicker } from './VariablePresetPicker.js';

export const contextEntries = (values: PreviewContextVariable[] = []): Record<string, ContextEntry> => Object.fromEntries(values.map(row => [row.name, { type: row.type, text: row.value === null ? '' : typeof row.value === 'string' ? row.value : JSON.stringify(row.value), ...(row.value === null ? { isNull: true } : {}) }]));

/** The renderer keeps incomplete values; only a completely valid scenario can start. */
export function ScenarioVariables({ entries, fields = [], inherited = [], onChange, presets, presetsLoading, presetsError, onReloadPresets, defaultsLabel = 'Batch defaults', description = 'Override values for this scenario only.' }: {
  entries: Record<string, ContextEntry>; fields?: PreviewContextField[]; inherited?: PreviewContextVariable[];
  onChange(entries: Record<string, ContextEntry>): void;
  presets?: ContextPreset[]; presetsLoading?: boolean; presetsError?: string | null; onReloadPresets?(): void;
  defaultsLabel?: string; description?: string;
}) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ContextType>('Text');
  const [error, setError] = useState('');
  const issues = validateContextEntries(entries);
  const update = (name: string, patch: Partial<ContextEntry>) => onChange({ ...entries, [name]: { ...entries[name], ...patch } });
  const add = () => {
    try {
      const trimmed = name.trim();
      const field = fields.find(row => row.name === trimmed) ?? inherited.find(row => row.name === trimmed);
      const selectedType = field?.type ?? type;
      parsePreviewContext([{ name: trimmed, type: selectedType, value: null }]);
      if (Object.hasOwn(entries, trimmed)) throw Error('That variable is already overridden.');
      if (Object.keys(entries).length >= 100) throw Error('A scenario supports at most 100 variables.');
      const existing = inherited.find(row => row.name === trimmed);
      const defaults = fields.find(row => row.name === trimmed)?.defaultValue;
      const initial = existing ? contextEntries([existing])[trimmed] : defaults !== undefined ? contextEntries([{ name: trimmed, type: selectedType, value: defaults }])[trimmed]
        : { type: selectedType, text: selectedType === 'Boolean' ? 'false' : selectedType === 'Number' ? '0' : selectedType === 'Json' ? '{}' : ['List', 'Object'].includes(selectedType) ? '[]' : '' };
      onChange({ ...entries, [trimmed]: initial }); setAdding(false); setName(''); setError('');
    } catch (error) { setError((error as Error).message); }
  };
  return <section className="sf-sim-variables" aria-label="Scenario starting variables">
    <div className="sf-sim-variables-heading"><div><h3>Starting variables <small>{Object.keys(entries).length ? `· ${Object.keys(entries).length} ${Object.keys(entries).length === 1 ? 'override' : 'overrides'}` : ''}</small></h3><p>{description}</p></div><button type="button" onClick={() => setAdding(true)}>Add variable</button></div>
    {presets && <VariablePresetPicker presets={presets} fields={fields} values={issues.values} custom={Object.keys(entries).length > 0 && (issues.errors.length > 0 || Object.keys(issues.fieldErrors).length > 0)} loading={presetsLoading} error={presetsError} onReload={onReloadPresets} defaultsLabel={defaultsLabel} onApply={values => onChange(contextEntries(values))} />}
    <p className="sf-sim-variables-default">{inherited.length ? `${inherited.length} ${inherited.length === 1 ? 'variable' : 'variables'} inherited from the batch.` : 'Using agent defaults.'} {defaultsLabel === 'Runtime defaults' ? ' Saved values override runtime defaults for this setup.' : ' Scenario values replace matching batch values.'}</p>
    {Object.entries(entries).map(([name, entry], index) => {
      const inputId = `${id}-${index}`;
      const issue = issues.fieldErrors[name];
      return <div className="sf-sim-variable" key={name}>
        <div className="sf-sim-variable-heading"><label htmlFor={inputId}>{fields.find(row => row.name === name)?.label ?? name}</label><small>{entry.type}</small><button type="button" aria-label={`Reset ${name} to ${defaultsLabel === 'Runtime defaults' ? 'runtime' : 'batch'} default`} onClick={() => { const next = { ...entries }; delete next[name]; onChange(next); }}>Reset</button></div>
        {entry.isNull ? <div id={inputId} className="sf-sim-variable-null">null</div> : entry.type === 'Boolean'
          ? <select id={inputId} aria-label={`${name} value`} value={entry.text} onChange={event => update(name, { text: event.target.value })}><option value="false">False</option><option value="true">True</option></select>
          : ['Json', 'List', 'Object'].includes(entry.type) ? <textarea id={inputId} aria-label={`${name} value`} aria-invalid={Boolean(issue)} value={entry.text} rows={3} onChange={event => update(name, { text: event.target.value })} />
          : <input id={inputId} aria-label={`${name} value`} aria-invalid={Boolean(issue)} type={entry.type === 'Date' ? 'date' : 'text'} inputMode={entry.type === 'Number' ? 'decimal' : undefined} value={entry.text} onChange={event => update(name, { text: event.target.value })} />}
        <label className="sf-sim-variable-null-toggle"><input type="checkbox" aria-label={`Set ${name} to null`} checked={Boolean(entry.isNull)} onChange={event => update(name, { isNull: event.target.checked })} />Set to null</label>
        {issue && <p role="alert">{issue}</p>}
      </div>;
    })}
    {!Object.keys(entries).length && <p>{defaultsLabel === 'Runtime defaults' ? 'No saved overrides. This setup uses runtime defaults.' : 'No scenario overrides. Add a variable when this conversation needs different starting values.'}</p>}
    {adding && <div className="sf-sim-variable-add" onKeyDown={event => { if (event.key === 'Escape') { setAdding(false); setError(''); event.stopPropagation(); } }}>
      <label>Variable name<input autoFocus aria-label="New scenario variable name" list={`${id}-fields`} value={name} onChange={event => { setName(event.target.value); const field = fields.find(row => row.name === event.target.value) ?? inherited.find(row => row.name === event.target.value); if (field) setType(field.type); }} placeholder="Choose or enter a variable…" /></label>
      <datalist id={`${id}-fields`}>{[...new Set([...fields.map(row => row.name), ...inherited.map(row => row.name)])].filter(name => !Object.hasOwn(entries, name)).map(name => <option key={name} value={name} />)}</datalist>
      <label>Type<select aria-label="New scenario variable type" value={type} disabled={fields.some(row => row.name === name) || inherited.some(row => row.name === name)} onChange={event => setType(event.target.value as ContextType)}>{CONTEXT_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
      <div><button type="button" onClick={add}>Add override</button><button type="button" onClick={() => { setAdding(false); setError(''); }}>Cancel</button></div>{error && <p role="alert">{error}</p>}
    </div>}
    {issues.errors.map(issue => <p key={issue} role="alert">{issue}</p>)}
  </section>;
}
