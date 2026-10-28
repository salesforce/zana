import { useId, useState } from 'react';
import { Check, MessageSquare, Plus, Search, Target, Trash2, UserRound } from 'lucide-react';
import { useStudioSplit } from './StudioResize.js';
import { SIMULATION_LIMITS, type SimulationScenarioInput } from '../../../lib/simulation-contract.js';

export type EditableScenario = SimulationScenarioInput & { key: string };
interface Props {
  storageKey?: string;
  scenarios: EditableScenario[]; included: string[]; activeKey: string; attention: Set<string>; disabled: boolean;
  onSelect(key: string): void; onToggle(key: string): void; onEdit(key: string, patch: Partial<SimulationScenarioInput>): void;
  onAdd(): void; onRemove(key: string): void;
}

/** One scenario stays in focus while the catalogue remains available beside it. */
export function SimulationScenarios({ storageKey, scenarios, included, activeKey, attention, disabled, onSelect, onToggle, onEdit, onAdd, onRemove }: Props) {
  const split = useStudioSplit({ storageKey, initial: 30, breakpoint: 460, stack: false, minPane: 170 });
  const nameId = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(false);
  const active = scenarios.find(row => row.key === activeKey) ?? scenarios[0];
  const index = scenarios.indexOf(active!);
  const rows = scenarios.filter(row => (!filter || attention.has(row.name)) && `${row.name} ${row.persona} ${row.goal}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="sf-sim-workspace" ref={split.ref} style={split.style}>
    <aside className="sf-sim-catalogue" aria-label="Scenario catalogue">
      <label className="sf-sim-search"><Search size={14} aria-hidden="true" /><input aria-label="Search scenarios" placeholder="Find a scenario…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="sf-sim-filters" role="group" aria-label="Filter scenarios">
        <button type="button" aria-pressed={!filter} onClick={() => setFilter(false)}>All <span>{scenarios.length}</span></button>
        <button type="button" aria-pressed={filter} onClick={() => setFilter(true)}>Needs attention</button>
      </div>
      <div className="sf-sim-scenarios">
        {rows.map(row => <div key={row.key} className={`sf-sim-scenario${active?.key === row.key ? ' is-active' : ''}`}>
          <input type="checkbox" aria-label={row.name || 'Untitled scenario'} checked={included.includes(row.key)} disabled={disabled} onChange={() => onToggle(row.key)} />
          <button type="button" aria-label={`Edit ${row.name || 'Untitled scenario'}`} aria-pressed={active?.key === row.key} onClick={() => onSelect(row.key)}>
            <strong>{row.name || 'Untitled scenario'}</strong><span>{row.goal || 'Define a customer goal'}</span>
            {attention.has(row.name) && <small>Needs attention</small>}
          </button>
        </div>)}
        {!rows.length && <p className="sf-sim-catalogue-empty">{filter ? 'No scenarios need attention.' : 'No matching scenarios.'}</p>}
      </div>
      <button type="button" className="sf-sim-add" disabled={disabled || scenarios.length >= SIMULATION_LIMITS.lanes} onClick={() => { setQuery(''); setFilter(false); onAdd(); }}><Plus size={14} aria-hidden="true" />Add scenario</button>
    </aside>
    {split.divider('Resize scenario catalogue and editor')}
    {active ? <fieldset className="sf-sim-editor" disabled={disabled} aria-label={`Scenario ${index + 1}`}>
      <div className="sf-sim-editor-title"><label className="sf-sim-sr" htmlFor={nameId}>Scenario {index + 1} name</label><input id={nameId} aria-label={`Scenario ${index + 1} name`} value={active.name} maxLength={80} placeholder="Name this scenario" onChange={event => onEdit(active.key, { name: event.target.value })} />
        <button type="button" className="sf-sim-icon" aria-label={`Remove scenario ${index + 1}`} title="Remove scenario" onClick={() => onRemove(active.key)}><Trash2 size={15} aria-hidden="true" /></button></div>
      <p className="sf-sim-editor-intro">Define the customer, the conversation and what success looks like.</p>
      <div className="sf-sim-fields">{([
        ['persona', 'Customer persona', UserRound], ['goal', 'Customer goal', Target],
        ['opening', 'Opening message', MessageSquare], ['criteria', 'Success criteria', Check],
      ] as const).map(([field, label, Icon]) => <label key={field} className={`sf-sim-field is-${field}`}>
        <span><Icon size={14} aria-hidden="true" />{label}</span>
        <textarea aria-label={`Scenario ${index + 1} ${field}`} value={active[field]} maxLength={field === 'persona' || field === 'goal' ? 2000 : 4000} rows={field === 'criteria' ? 4 : 3} onChange={event => onEdit(active.key, { [field]: event.target.value })} />
        {field === 'opening' && <small>The first message sent by the simulated customer.</small>}
        {field === 'criteria' && <small>The judge checks these expectations against the conversation.</small>}
      </label>)}</div>
      <div className="sf-sim-editor-footer"><label>Maximum turns<input aria-label={`Scenario ${index + 1} maximum turns`} type="number" min={1} max={8} value={active.maxTurns} onChange={event => onEdit(active.key, { maxTurns: Number(event.target.value) })} /></label><span>Edits apply to the next run</span></div>
    </fieldset> : <div className="sf-sim-editor sf-sim-placeholder"><MessageSquare size={24} aria-hidden="true" /><h3>Create your first scenario</h3><p>Describe a customer journey and the outcome you expect.</p><button type="button" className="sf-tp-btn" disabled={disabled} onClick={onAdd}>Add your first scenario</button></div>}
  </div>;
}
