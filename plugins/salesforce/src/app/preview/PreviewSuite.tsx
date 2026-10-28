import { useId, useState } from 'react';
import type { ScenarioSuite } from '../../../lib/studio-contract.js';
import { suiteChip, suiteTally, type ChipState } from '../agentforce-preview-logic.js';

const LABELS: Record<ChipState, string> = { pass: 'Passed', fail: 'Failed', inconclusive: 'Inconclusive', unrun: 'Not run' };
export const PREVIEW_SUITE_STYLES = `
.sf-pw-suite { flex-shrink:0; display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:10px 14px; border-bottom:1px solid var(--sf-border); font-size:11px; }
.sf-pw-suite strong { font-weight:600; }
.sf-pw-suite-count { color:var(--sf-muted); }
.sf-pw-suite-count.is-pass { color:var(--sf-success); }
.sf-pw-suite-count.is-fail { color:var(--sf-danger); }
.sf-pw-suite-count.is-inconclusive { color:var(--sf-warn); }
.sf-pw-suite-meter { width:56px; height:5px; background:var(--sf-border); border-radius:8px; overflow:hidden; flex-shrink:0; }
.sf-pw-suite-meter i { display:block; height:100%; background:var(--sf-success); }
.sf-pw-suite-panel { display:flex; flex-direction:column; min-height:0; max-height:40%; flex-shrink:1; border-bottom:1px solid var(--sf-border); }
.sf-pw-suite-filters { display:flex; flex-wrap:wrap; gap:8px; padding:10px 14px; }
.sf-pw-suite-filters input { flex:1; min-width:100px; }
.sf-pw-suite-filters input, .sf-pw-suite-filters select { font:inherit; color:var(--sf-text); background:var(--sf-bg); padding:6px 8px; border:1px solid var(--sf-border); border-radius:6px; }
.sf-pw-suite-cases { overflow:auto; min-height:0; padding:0 14px 8px; user-select:text; -webkit-user-select:text; }
.sf-pw-suite-case { display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--sf-border); }
.sf-pw-suite-case-name { flex:1; min-width:0; overflow-wrap:anywhere; }
.sf-pw-suite-case-status { font-size:10px; min-width:70px; }
.sf-pw-suite-empty { color:var(--sf-muted); padding:8px 0; }
`;

/** Preview keeps the conversation in view; scenario evidence expands on demand. */
export function PreviewSuite({ suite, busy, disabled, onRun }: { suite: ScenarioSuite | null; busy: string; disabled: boolean; onRun(caseIds?: string[]): void }) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const id = useId();
  const tally = suite ? suiteTally(suite) : null;
  const inconclusive = suite?.cases.filter(c => suiteChip(suite, c.id) === 'inconclusive').length ?? 0;
  const unrun = tally ? tally.total - tally.pass - tally.fail - inconclusive : 0;
  const cases = suite?.cases.filter(c => c.name.toLowerCase().includes(search.trim().toLowerCase()) && (filter === 'all' || suiteChip(suite, c.id) === filter)) ?? [];
  return <>
    <div className="sf-pw-suite" aria-label="Scenario suite">
      <strong>{tally ? `${tally.pass}/${tally.total} pass` : 'Scenario suite'}</strong>
      {tally && <><span className="sf-pw-suite-meter" aria-hidden="true"><i style={{ width: `${tally.total ? tally.pass / tally.total * 100 : 0}%` }} /></span>
        {tally.fail > 0 && <span className="sf-pw-suite-count is-fail">{tally.fail} failed</span>}
        {inconclusive > 0 && <span className="sf-pw-suite-count is-inconclusive">{inconclusive} inconclusive</span>}
        {unrun > 0 && <span className="sf-pw-suite-count">{unrun} not run</span>}</>}
      <span className="sf-pw-spacer" />
      <button type="button" className="sf-pw-btn" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>Inspect {tally?.total ?? 0} cases {expanded ? '▴' : '▾'}</button>
      {busy ? <span role="status">{busy}</span> : <button type="button" className="sf-pw-btn" disabled={disabled} onClick={() => onRun()}>Run suite</button>}
    </div>
    {expanded && <div id={id} className="sf-pw-suite-panel" role="region" aria-label="Scenario cases">
      <div className="sf-pw-suite-filters">
        <input type="search" aria-label="Search scenarios" placeholder="Search scenarios…" value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Scenario result filter" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All results</option>{Object.entries(LABELS).map(([state, label]) => <option key={state} value={state}>{label}</option>)}
        </select>
      </div>
      <div className="sf-pw-suite-cases">
        {cases.map(c => { const state = suiteChip(suite!, c.id); return <div key={c.id} className="sf-pw-suite-case" data-state={state}>
          <span className={`sf-pw-suite-count sf-pw-suite-case-status is-${state}`}>{state === 'pass' ? '✓ ' : state === 'fail' ? '✗ ' : ''}{LABELS[state]}</span>
          <span className="sf-pw-suite-case-name">{c.name}</span>
          <button type="button" className="sf-pw-btn" aria-label={`Rerun ${c.name}`} disabled={disabled || Boolean(busy)} onClick={() => onRun([c.id])}>Rerun</button>
        </div>; })}
        {!cases.length && <div className="sf-pw-suite-empty" role="status">No scenarios match your filters.</div>}
      </div>
    </div>}
  </>;
}
