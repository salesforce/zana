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
.sf-trace-head { display:flex; gap:10px; color:var(--sf-muted); padding-bottom:4px; }
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
.sf-trace-bar { grid-column:1 / -1; height:3px; border-radius:2px; background:var(--sf-border); overflow:hidden; }
.sf-trace-bar > i { display:block; height:100%; background:var(--sf-accent); }
.sf-trace-io { grid-column:1 / -1; color:var(--sf-muted); overflow-wrap:anywhere; font-family:ui-monospace,monospace; font-size:10px; }
.sf-trace-io b { color:var(--sf-text); font-weight:500; }
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
  const summary = traceSummary(trace);
  const max = Math.max(1, ...trace.steps.map(s => s.latencyMs ?? 0));
  let grouped = false; // steps after the first topic are nested under it
  return (
    <div className="sf-trace" data-testid="sf-trace" role="list" aria-label="Planner trace">
      <style>{TRACE_PANEL_STYLES}</style>
      <div className="sf-trace-head"><span>{summary.steps} steps</span><span>{summary.totalMs ? `${(summary.totalMs / 1000).toFixed(2)}s total` : ''}</span></div>
      {trace.reason && <span className="sf-trace-note">{trace.reason}</span>}
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
            {step.inputPreview && <span className="sf-trace-io"><b>in</b> {step.inputPreview}</span>}
            {step.outputPreview && <span className="sf-trace-io"><b>{step.kind === 'variable' ? '→' : 'out'}</b> {step.outputPreview}</span>}
          </>
        );
        const cls = `sf-trace-row k-${step.kind}${nested ? ' is-nested' : ''}`;
        return source && onRevealSource
          ? <button key={i} type="button" role="listitem" className={cls} onClick={() => onRevealSource(source.path, source.line)} title={`Reveal ${source.path}:${source.line}`}>{body}</button>
          : <div key={i} role="listitem" className={cls}>{body}</div>;
      })}
    </div>
  );
}
