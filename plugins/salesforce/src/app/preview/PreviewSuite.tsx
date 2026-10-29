import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Play, Square } from 'lucide-react';
import type { ScenarioSuite } from '../../../lib/studio-contract.js';
import { suiteChip, suiteTally, type ChipState } from '../agentforce-preview-logic.js';
import { STUDIO_RESIZE_STYLES, useStudioSplit } from '../studio/StudioResize.js';
import { ScenarioCaseDetails } from './ScenarioCaseDetails.js';

const LABELS: Record<ChipState, string> = { pass: 'Passed', fail: 'Failed', inconclusive: 'Inconclusive', unrun: 'Not run' };
export const PREVIEW_SUITE_STYLES = `
${STUDIO_RESIZE_STYLES}
.sf-pw-suite-page { display:flex; flex:1; min-height:0; flex-direction:column; }
.sf-pw-suite-heading { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding:14px 18px; border-bottom:1px solid var(--sf-border); }
.sf-pw-suite-heading h3 { margin:0; font-size:14px; }
.sf-pw-suite-heading p { margin:3px 0 0; color:var(--sf-muted); }
.sf-pw-suite-mode { color:var(--sf-muted); border:1px solid var(--sf-border); border-radius:4px; padding:2px 6px; font-size:11px; }
.sf-pw-suite-notice { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 18px; border-bottom:1px solid var(--sf-border); color:var(--sf-muted); background:var(--sf-soft); }
.sf-pw-suite-footer { padding:8px 18px; border-top:1px solid var(--sf-border); color:var(--sf-muted); font-size:11px; }
.sf-pw-suite { flex-shrink:0; display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:10px 14px; border-bottom:1px solid var(--sf-border); font-size:11px; }
.sf-pw-suite strong { font-weight:600; }
.sf-pw-suite-count { color:var(--sf-muted); }
.sf-pw-suite-count.is-pass { color:var(--sf-success); }
.sf-pw-suite-count.is-fail { color:var(--sf-danger); }
.sf-pw-suite-count.is-inconclusive { color:var(--sf-warn); }
.sf-pw-suite-meter { width:56px; height:5px; background:var(--sf-border); border-radius:8px; overflow:hidden; flex-shrink:0; }
.sf-pw-suite-meter i { display:block; height:100%; background:var(--sf-success); }
.sf-pw-suite-panel { display:flex; flex-direction:column; min-height:0; flex:1; border-bottom:1px solid var(--sf-border); container:sf-suite / inline-size; }
.sf-pw-suite-filters { display:flex; flex-shrink:0; flex-wrap:wrap; gap:8px; padding:10px 14px; }
.sf-pw-suite-filters input { flex:1; min-width:100px; }
.sf-pw-suite-filters input, .sf-pw-suite-filters select { font:inherit; color:var(--sf-text); background:var(--sf-bg); padding:6px 8px; border:1px solid var(--sf-border); border-radius:6px; }
.sf-pw-suite-workspace { display:flex; flex:1; min-height:0; min-width:0; }
.sf-pw-suite-cases { flex:var(--sf-pane-ratio,50) 1 0; min-width:0; overflow:auto; min-height:0; padding:0 14px 8px; overscroll-behavior:contain; user-select:text; -webkit-user-select:text; }
.sf-pw-suite-detail { flex:calc(100 - var(--sf-pane-ratio,50)) 1 0; min-width:0; overflow:auto; overscroll-behavior:contain; padding:12px 14px; }
.sf-pw-suite-case-name { display:flex; align-items:center; gap:10px; }
.sf-pw-suite-case-name button { flex:1; display:flex; align-items:center; justify-content:space-between; gap:12px; border:0; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; padding:6px 0; }
.sf-pw-suite-case[data-selected=true] { background:var(--sf-soft); }
.sf-pw-suite-case-name button svg { flex-shrink:0; color:var(--sf-muted); }
.sf-pw-suite-case-name button:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
@container sf-suite (max-width:700px) { .sf-pw-suite-workspace:has(.sf-pw-suite-detail) > .sf-pw-suite-cases { display:none; } .sf-pw-suite-detail { border-left:0; } }
.sf-pw-suite-case { display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--sf-border); }
.sf-pw-suite-case-name { flex:1; min-width:0; overflow-wrap:anywhere; }
.sf-pw-suite-case-status { font-size:10px; min-width:70px; }
.sf-pw-suite-empty { color:var(--sf-muted); padding:8px 0; }
`;

/** Saved scenarios occupy their own full-height view; mounting it across tab switches preserves inspection state. */
export function PreviewSuite({ pluginId, projectId, suite, busy, disabled, disabledReason, onRun, onStop, stopping = false, onConversation }: {
  pluginId: string; projectId?: string; suite: ScenarioSuite | null; busy: string; disabled: boolean;
  disabledReason?: string; onRun(caseIds?: string[]): void; onStop?(): void; stopping?: boolean; onConversation?(): void;
}) {
  const split = useStudioSplit({ storageKey: `salesforce:studio:cases:${projectId ?? 'draft'}`, breakpoint: 700, stack: false });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (selected === null) opener.current?.focus(); }, [selected]);
  const tally = suite ? suiteTally(suite) : null;
  const inconclusive = suite?.cases.filter(c => suiteChip(suite, c.id) === 'inconclusive').length ?? 0;
  const unrun = tally ? tally.total - tally.pass - tally.fail - inconclusive : 0;
  const cases = suite?.cases.filter(c => c.name.toLowerCase().includes(search.trim().toLowerCase()) && (filter === 'all' || suiteChip(suite, c.id) === filter)) ?? [];
  const scenario = cases.find(c => c.id === selected);
  useEffect(() => { if (selected && !scenario) setSelected(null); }, [selected, scenario]);
  return <section className="sf-pw-suite-page" aria-label="Saved scenarios">
    <div className="sf-pw-suite-heading">
      <div><h3>Saved scenarios</h3><p>Run repeatable tests against this agent.</p></div><span className="sf-pw-suite-mode">Simulate</span>
      <span className="sf-pw-spacer" />
      {busy && onStop ? <button type="button" className="sf-pw-btn is-danger" disabled={stopping} onClick={onStop}><Square size={13} aria-hidden="true" />{stopping ? 'Stopping…' : 'Stop suite'}</button>
        : <button type="button" className="sf-pw-btn is-primary" disabled={disabled || Boolean(busy) || !suite?.cases.length} onClick={() => onRun()}><Play size={13} aria-hidden="true" />Run {tally?.total ?? 0} scenarios</button>}
    </div>
    <div className="sf-pw-suite-notice">{disabledReason || 'Scenarios use simulated actions. The Live / Simulate choice applies only to your manual conversation.'}
      {disabledReason && onConversation && <button type="button" className="sf-pw-btn" onClick={onConversation}>Return to conversation</button>}
    </div>
    <div className="sf-pw-suite" aria-label="Scenario suite">
      <strong>{tally ? `${tally.pass}/${tally.total} pass` : 'No saved results'}</strong>
      {tally && <><span className="sf-pw-suite-meter" aria-hidden="true"><i style={{ width: `${tally.total ? tally.pass / tally.total * 100 : 0}%` }} /></span>
        {tally.fail > 0 && <span className="sf-pw-suite-count is-fail">{tally.fail} failed</span>}
        {inconclusive > 0 && <span className="sf-pw-suite-count is-inconclusive">{inconclusive} inconclusive</span>}
        {unrun > 0 && <span className="sf-pw-suite-count">{unrun} not run</span>}</>}
      <span className="sf-pw-spacer" />
      {busy && <span role="status">{busy}</span>}
    </div>
    <div className="sf-pw-suite-panel" role="region" aria-label="Scenario cases">
      <div className="sf-pw-suite-filters">
        <input type="search" aria-label="Search scenarios" placeholder="Search scenarios…" value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Scenario result filter" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All results</option>{Object.entries(LABELS).map(([state, label]) => <option key={state} value={state}>{label}</option>)}
        </select>
      </div>
      <div className="sf-pw-suite-workspace" ref={split.ref} style={scenario ? split.style : undefined}><div className="sf-pw-suite-cases" tabIndex={0} role="region" aria-label="Scenario list">
        {cases.map(c => { const state = suiteChip(suite!, c.id); return <div key={c.id} className="sf-pw-suite-case" data-state={state} data-selected={selected === c.id}>
          <span className={`sf-pw-suite-count sf-pw-suite-case-status is-${state}`}>{state === 'pass' ? '✓ ' : state === 'fail' ? '✗ ' : ''}{LABELS[state]}</span>
          <span className="sf-pw-suite-case-name"><button type="button" aria-label={`View details for ${c.name}`} aria-expanded={selected === c.id} onClick={event => { opener.current = event.currentTarget; setSelected(selected === c.id ? null : c.id); }}>{c.name}<ChevronRight size={18} aria-hidden="true" /></button></span>
          <button type="button" className="sf-pw-btn" aria-label={`Rerun ${c.name}`} disabled={disabled || Boolean(busy)} onClick={() => onRun([c.id])}>Rerun</button>
        </div>; })}
        {!cases.length && <div className="sf-pw-suite-empty" role="status">{suite?.cases.length ? 'No scenarios match your filters.' : 'No saved scenarios yet. Save a conversation as a scenario to create your first test.'}</div>}
      </div>{scenario && split.divider('Resize scenario list and details')}{scenario && <div className="sf-pw-suite-detail" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSelected(null); } }}>
        <ScenarioCaseDetails key={`${scenario.id}:${suite?.lastResults?.[scenario.id]?.runId}:${suite?.lastResults?.[scenario.id]?.at}`} pluginId={pluginId} projectId={projectId} scenario={scenario} result={suite?.lastResults?.[scenario.id]} onClose={() => setSelected(null)} />
      </div>}</div>
    </div>
    <div className="sf-pw-suite-footer">Select a scenario to inspect its checks and recorded conversation.</div>
  </section>;
}
