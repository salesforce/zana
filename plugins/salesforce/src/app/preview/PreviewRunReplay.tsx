import { useEffect, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { LabSnapshot } from '../../../lib/agentforce-lab-contract.js';
import { STUDIO_RPC, type TurnTrace } from '../../../lib/studio-contract.js';
import { TracePanel } from './TracePanel.js';

export const RUN_REPLAY_STYLES = `
.sf-run { display:flex; flex-direction:column; gap:12px; flex:1; min-height:0; overflow:auto; padding:16px 20px; user-select:text; -webkit-user-select:text; }
.sf-run-head { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:11px; color:var(--sf-muted); }
.sf-run-head strong { color:var(--sf-text); font-weight:600; }
.sf-run-head .sf-run-close { margin-left:auto; }
.sf-run .af-message.is-agent > button { all:unset; display:block; cursor:pointer; border-radius:12px; }
.sf-run .af-message.is-agent > button:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
.sf-run .af-message.is-selected .af-message-text { border-color:var(--sf-accent); }
`;

type Loaded = { state: 'loading' } | { state: 'ready'; run: LabSnapshot } | { state: 'missing'; message: string };

const unavailable = (runId: string, reason: string): TurnTrace => ({ runId, turn: 0, available: false, reason, steps: [] });

/**
 * Reopens one lab run read-only: its transcript, the chosen turn and that turn's planner trace.
 * The run lives in the plugin process, so it is gone after a restart, 30 idle minutes or a newer run.
 */
export function PreviewRunReplay(props: {
  pluginId: string;
  projectId?: string;
  runId: string;
  turn?: number;
  onRevealSource?(path: string, line: number): void;
  onClose(): void;
}) {
  const { pluginId, projectId, runId } = props;
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [selected, setSelected] = useState<number | null>(props.turn ?? null);
  const [trace, setTrace] = useState<TurnTrace | null>(null);
  const [tracing, setTracing] = useState(false);
  const scope = projectId ? { projectId } : {};

  useEffect(() => {
    let alive = true;
    setLoaded({ state: 'loading' });
    void callPluginRpc(pluginId, 'agentLab.get', { ...scope, id: runId }).then(
      (result) => {
        if (!alive) return;
        const row = result as { ok?: boolean; data?: LabSnapshot; error?: string } | null;
        setLoaded(row?.ok && row.data ? { state: 'ready', run: row.data } : { state: 'missing', message: row?.error || 'This run is no longer available.' });
      },
      (error: unknown) => { if (alive) setLoaded({ state: 'missing', message: error instanceof Error ? error.message : String(error) }); }
    );
    return () => { alive = false; };
  }, [pluginId, projectId, runId]);

  const run = loaded.state === 'ready' ? loaded.run : null;
  const agentTurns = run ? run.turns.filter((turn) => turn.role === 'agent') : [];
  // Default to the latest reply; a turn past the end (a stale card) also lands there.
  const current = agentTurns.length ? Math.min(selected ?? agentTurns.length, agentTurns.length) : 0;
  const planId = current ? agentTurns[current - 1]?.planId : undefined;

  useEffect(() => {
    if (!run || run.engine === 'rehearsal' || !current) { setTrace(null); return; }
    if (!planId) { setTrace(unavailable(runId, 'This reply has no plan to trace.')); return; }
    let alive = true;
    setTracing(true);
    void callPluginRpc(pluginId, STUDIO_RPC.trace, { ...scope, id: runId, planId, turn: current, ...(run.path ? { path: run.path } : {}) }).then(
      (result) => {
        const row = result as { ok?: boolean; data?: TurnTrace; error?: string } | null;
        if (alive) setTrace(row?.ok && row.data ? row.data : unavailable(runId, row?.error || 'Trace request failed.'));
      },
      (error: unknown) => { if (alive) setTrace(unavailable(runId, error instanceof Error ? error.message : String(error))); }
    ).finally(() => { if (alive) setTracing(false); });
    return () => { alive = false; };
  }, [pluginId, projectId, runId, run, current, planId]);

  if (loaded.state === 'loading') {
    return <div className="sf-run" data-testid="salesforce-preview-run" role="status"><style>{RUN_REPLAY_STYLES}</style>Loading run…</div>;
  }
  if (!run) {
    return (
      <div className="sf-run" data-testid="salesforce-preview-run">
        <style>{RUN_REPLAY_STYLES}</style>
        <div className="sf-as-banner is-error" role="alert">
          {loaded.state === 'missing' ? loaded.message : ''} Runs are kept for 30 idle minutes, until the app restarts or a newer run replaces a finished one.
        </div>
        <div><button type="button" className="sf-as-save" onClick={props.onClose}>Start a new preview</button></div>
      </div>
    );
  }
  let reply = 0;
  return (
    <section className="sf-run" data-testid="salesforce-preview-run" aria-label="Preview run">
      <style>{RUN_REPLAY_STYLES}</style>
      <div className="sf-run-head">
        <strong>{run.engine === 'preview' ? 'Simulate run' : 'Rehearse run'}</strong>
        <span>{run.orgAlias}</span>
        {run.path ? <span title={run.path}>{run.path.split('/').pop()}</span> : null}
        <span>{run.closed ? 'Ended' : run.failed ? 'Stopped' : 'Still open'}</span>
        <button type="button" className="sf-as-save sf-run-close" onClick={props.onClose}>Close run</button>
      </div>
      <div className="af-transcript" role="log" aria-label="Run conversation">
        {run.turns.length === 0 ? <p className="af-caption">This run has no turns yet.</p> : run.turns.map((turn, index) => {
          if (turn.role === 'user') {
            return <article key={index} className="af-message is-user"><div className="af-message-meta"><strong>Customer</strong></div><div className="af-message-text">{turn.text}</div></article>;
          }
          const number = ++reply;
          const isSelected = number === current;
          return (
            <article key={index} className={`af-message is-agent${isSelected ? ' is-selected' : ''}`}>
              <button type="button" aria-pressed={isSelected} aria-label={`Turn ${number}`} onClick={() => setSelected(number)}>
                <div className="af-message-meta"><strong>Agentforce</strong><span>turn {number}</span>{turn.latencyMs !== undefined ? <span>{(turn.latencyMs / 1000).toFixed(1)}s</span> : null}</div>
                <div className="af-message-text">{turn.text}</div>
              </button>
            </article>
          );
        })}
      </div>
      {current ? <TracePanel trace={trace} loading={tracing} approximation={run.engine === 'rehearsal'} onRevealSource={props.onRevealSource} /> : null}
    </section>
  );
}
