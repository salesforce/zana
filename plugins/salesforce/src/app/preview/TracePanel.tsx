import { useState } from 'react';
import type { TraceStep, TurnTrace } from '../../../lib/studio-contract.js';
import { REHEARSE_LABEL, traceSummary } from '../agentforce-preview-logic.js';

/** Planner trace of one turn. Only --sf-* tokens (studio-tokens.ts); no raw colors. */
export interface TracePanelProps {
  trace: TurnTrace | null;
  loading?: boolean;
  /** Rehearse runs have no planner; shows the approximation label instead of a trace. */
  approximation?: boolean;
  onRevealSource?(path: string, line: number): void;
}

export const TRACE_PANEL_STYLES = `
.sf-trace { display:flex; flex-direction:column; gap:2px; padding:8px 10px; border:1px solid var(--sf-border); border-radius:8px; background:var(--sf-bg); color:var(--sf-text); font-size:11px; min-width:0; }
.sf-trace-head { display:flex; flex-wrap:wrap; gap:10px; align-items:center; color:var(--sf-muted); padding-bottom:6px; }
.sf-trace-head strong { color:var(--sf-text); }
.sf-trace-toggle { margin-left:auto; font:inherit; border:0; border-radius:4px; background:transparent; color:var(--sf-accent); cursor:pointer; padding:3px; }
.sf-trace-route { color:var(--sf-accent); overflow-wrap:anywhere; line-height:1.6; padding-bottom:6px; }
.sf-trace-steps { max-height:340px; overflow:auto; min-height:0; }
.sf-trace-step { border-top:1px solid var(--sf-border); padding:4px 0; }
.sf-trace-note { color:var(--sf-warn); font-size:11px; }
.sf-trace-note.is-approx { font-style:italic; }
.sf-trace-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 8px; align-items:center; padding:3px 6px; border-radius:6px; border:0; background:transparent; color:inherit; font:inherit; text-align:left; width:100%; }
button.sf-trace-row { cursor:pointer; }
button.sf-trace-row:hover { background:var(--sf-border); }
button.sf-trace-row:focus-visible { outline:2px solid var(--sf-accent); outline-offset:1px; }
.sf-trace-row.is-nested { margin-left:14px; width:calc(100% - 14px); }
.sf-trace-row.k-topic { font-weight:600; }
.sf-trace-label { display:flex; gap:6px; align-items:baseline; min-width:0; }
.sf-trace-kind { flex-shrink:0; font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--sf-muted); }
.sf-trace-kind.k-topic, .sf-trace-kind.k-transition { color:var(--sf-accent); }
.sf-trace-kind.k-action { color:var(--sf-success); }
.sf-trace-kind.k-unknown { color:var(--sf-danger); }
.sf-trace-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-trace-line { color:var(--sf-muted); font-size:10px; }
.sf-trace-ms { color:var(--sf-muted); font-variant-numeric:tabular-nums; }
.sf-trace-bar { grid-column:1 / -1; justify-self:end; width:80px; height:3px; border-radius:2px; background:var(--sf-border); overflow:hidden; }
.sf-trace-bar > i { display:block; height:100%; background:var(--sf-accent); }
.sf-trace-io { margin:2px 6px; color:var(--sf-muted); font-size:10px; }
.sf-trace-io summary { cursor:pointer; padding:4px 0; }
.sf-trace-io pre { white-space:pre-wrap; overflow-wrap:anywhere; font:10px/1.6 ui-monospace,monospace; margin:4px 0; padding:8px; border:1px solid var(--sf-border); border-radius:5px; }
.sf-trace-io b { color:var(--sf-text); font-weight:500; }
.sf-trace-toggle:focus-visible, .sf-trace-io summary:focus-visible { outline:2px solid var(--sf-accent); outline-offset:1px; }
`;

const KIND_LABEL: Record<TraceStep['kind'], string> = {
  input: 'user', llm: 'llm', tools: 'tools', topic: 'topic', action: 'action', variable: 'var',
  transition: 'route', response: 'reply', delegate: 'agent', unknown: 'step'
};

export function TracePanel({ trace, loading, approximation, onRevealSource }: TracePanelProps) {
  if (approximation) {
    return <div className="sf-trace" data-testid="sf-trace"><style>{TRACE_PANEL_STYLES}</style><span className="sf-trace-note is-approx">{REHEARSE_LABEL}</span></div>;
  }
  if (loading) return <div className="sf-trace" data-testid="sf-trace" role="status"><style>{TRACE_PANEL_STYLES}</style><span className="sf-trace-head">Loading trace…</span></div>;
  if (!trace) return null;
  if (!trace.available) {
    return <div className="sf-trace" data-testid="sf-trace"><style>{TRACE_PANEL_STYLES}</style><span className="sf-trace-note">{trace.reason || 'No runtime trace is available for this turn.'}</span></div>;
  }
  return <TraceSteps key={`${trace.runId}:${trace.planId}:${trace.turn}`} trace={trace} onRevealSource={onRevealSource} />;
}

function TraceSteps({ trace, onRevealSource }: { trace: TurnTrace; onRevealSource?: TracePanelProps['onRevealSource'] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const summary = traceSummary(trace);
  const max = Math.max(1, ...trace.steps.map(s => s.latencyMs ?? 0));
  const payloads = trace.steps.flatMap((s, i) => s.inputPreview || s.outputPreview ? [i] : []);
  const allOpen = payloads.length > 0 && payloads.every(i => open[i]);
  const topics = trace.steps.filter(s => s.kind === 'topic').map(s => s.label).filter((name, i, list) => i === 0 || name !== list[i - 1]);
  let grouped = false; // steps after the first topic are nested under it
  return (
    <div className="sf-trace" data-testid="sf-trace" role="region" aria-label="Planner trace">
      <style>{TRACE_PANEL_STYLES}</style>
      <div className="sf-trace-head"><strong>Planner trace</strong><span>{summary.steps} steps</span><span>{summary.totalMs ? `${(summary.totalMs / 1000).toFixed(2)}s total` : ''}</span>
        {payloads.length > 0 && <button type="button" className="sf-trace-toggle" onClick={() => setOpen(Object.fromEntries(payloads.map(i => [i, !allOpen])))}>{allOpen ? 'Collapse all payloads' : 'Expand all payloads'}</button>}
      </div>
      {topics.length > 0 && <div className="sf-trace-route" aria-label="Topic route">{topics.join(' → ')}</div>}
      {trace.reason && <span className="sf-trace-note">{trace.reason}</span>}
      <div className="sf-trace-steps" role="list" aria-label="Trace steps">
      {trace.steps.map((step, i) => {
        if (step.kind === 'topic') grouped = true;
        const nested = grouped && step.kind !== 'topic' && step.kind !== 'input';
        const source = step.source;
        const body = (
          <>
            <span className="sf-trace-label">
              <span className={`sf-trace-kind k-${step.kind}`}>{KIND_LABEL[step.kind]}</span>
              <span className="sf-trace-name" title={step.label}>{step.label}</span>
              {source && <span className="sf-trace-line">L{source.line}</span>}
            </span>
            <span className="sf-trace-ms">{step.latencyMs !== undefined ? `${step.latencyMs}ms` : ''}</span>
            {step.latencyMs ? <span className="sf-trace-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, Math.round((step.latencyMs / max) * 100))}%` }} /></span> : null}
          </>
        );
        const cls = `sf-trace-row k-${step.kind}${nested ? ' is-nested' : ''}`;
        return <div key={i} role="listitem" className="sf-trace-step">
          {source && onRevealSource
            ? <button type="button" className={cls} onClick={() => onRevealSource(source.path, source.line)} title={`Reveal ${source.path}:${source.line}`}>{body}</button>
            : <div className={cls}>{body}</div>}
          {(step.inputPreview || step.outputPreview) && <details className="sf-trace-io" open={Boolean(open[i])} onToggle={e => { const value = e.currentTarget.open; setOpen(prior => prior[i] === value ? prior : { ...prior, [i]: value }); }}>
            <summary>Inspect {step.inputPreview && step.outputPreview ? 'input / output' : step.inputPreview ? 'input' : 'output'}</summary>
            {step.inputPreview && <pre><b>in</b> {step.inputPreview}</pre>}
            {step.outputPreview && <pre><b>{step.kind === 'variable' ? '→' : 'out'}</b> {step.outputPreview}</pre>}
          </details>}
        </div>;
      })}
      </div>
    </div>
  );
}
