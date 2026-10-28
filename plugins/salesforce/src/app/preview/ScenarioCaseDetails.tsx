import { useEffect, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { LabSnapshot, LabTurn } from '../../../lib/agentforce-lab-contract.js';
import { STUDIO_RPC, type CaseResult, type ScenarioCase, type TurnTrace } from '../../../lib/studio-contract.js';
import { caseChecks } from '../../../lib/case-checks.js';
import { TracePanel } from './TracePanel.js';

export const SCENARIO_DETAIL_STYLES = `
.sf-case-detail { min-width:0; color:var(--sf-text); font-size:12px; user-select:text; -webkit-user-select:text; }
.sf-case-detail-head { position:sticky; top:0; z-index:1; display:flex; align-items:flex-start; gap:12px; padding:8px 0; background:var(--sf-bg); border-bottom:1px solid var(--sf-border); }
.sf-case-detail-head h3 { flex:1; margin:0; font-size:13px; overflow-wrap:anywhere; }
.sf-case-detail h4 { margin:18px 0 8px; font-size:12px; }
.sf-case-detail p, .sf-case-detail li { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.6; }
.sf-case-detail ol, .sf-case-detail ul { padding-left:20px; }
.sf-case-check { padding:8px; border:1px solid var(--sf-border); border-radius:6px; margin:6px 0; overflow-wrap:anywhere; }
.sf-case-check.is-ko { border-left:3px solid var(--sf-danger); }
.sf-case-check.is-ok { border-left:3px solid var(--sf-success); }
.sf-case-check.is-na { border-left:3px solid var(--sf-muted); }
.sf-case-message { padding:10px; margin:8px 0; border:1px solid var(--sf-border); border-radius:6px; }
.sf-case-message p { margin:6px 0; }
.sf-case-muted { color:var(--sf-muted); }
.sf-case-notes { border-left:3px solid var(--sf-warn); padding-left:10px; }
.sf-case-detail button { font:inherit; color:var(--sf-text); background:var(--sf-bg); border:1px solid var(--sf-border); border-radius:5px; padding:5px 8px; cursor:pointer; }
.sf-case-detail button:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
`;

/** Reads the recording on demand; saved checks and replies remain useful after the runtime run expires. */
export function ScenarioCaseDetails({ pluginId, projectId, scenario, result, onClose, call = callPluginRpc }: {
  pluginId: string; projectId?: string; scenario: ScenarioCase; result?: CaseResult;
  onClose(): void; call?: typeof callPluginRpc;
}) {
  const [recording, setRecording] = useState<LabSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(result?.runId));
  const [missing, setMissing] = useState('');
  const [trace, setTrace] = useState<TurnTrace | null>(null);
  const [traceTurn, setTraceTurn] = useState<number | null>(null);
  const [tracing, setTracing] = useState(false);
  const runId = result?.runId;
  useEffect(() => {
    let cancelled = false;
    setRecording(null); setMissing(''); setLoading(Boolean(runId)); setTrace(null); setTraceTurn(null);
    if (runId) void call(pluginId, 'agentLab.get', { ...(projectId ? { projectId } : {}), id: runId }).then(value => {
      if (cancelled) return;
      const reply = value as { ok?: boolean; data?: LabSnapshot; error?: string } | null;
      if (reply?.ok && reply.data) setRecording(reply.data);
      else setMissing(reply?.error || 'The full recording is no longer available.');
    }, (error: unknown) => { if (!cancelled) setMissing(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [call, pluginId, projectId, runId]);

  // Fetch a trace only for the reply the reader selects, and discard stale replies on selection changes.
  const agentTurns = recording?.turns.filter(turn => turn.role === 'agent') ?? [];
  const selected = traceTurn === null ? undefined : agentTurns[traceTurn - 1];
  useEffect(() => {
    let cancelled = false;
    setTrace(null); setTracing(false);
    if (!selected?.planId || !runId || traceTurn === null) return;
    setTracing(true);
    const unavailable = (reason: string): TurnTrace => ({ runId, turn: traceTurn, available: false, reason, steps: [] });
    void call(pluginId, STUDIO_RPC.trace, { ...(projectId ? { projectId } : {}), id: runId, planId: selected.planId, turn: traceTurn, ...(recording?.path ? { path: recording.path } : {}) }).then(value => {
      const reply = value as { ok?: boolean; data?: TurnTrace; error?: string } | null;
      if (!cancelled) setTrace(reply?.ok && reply.data ? reply.data : unavailable(reply?.error || 'Trace unavailable.'));
    }, (error: unknown) => { if (!cancelled) setTrace(unavailable(error instanceof Error ? error.message : String(error))); })
      .finally(() => { if (!cancelled) setTracing(false); });
    return () => { cancelled = true; };
  }, [call, pluginId, projectId, runId, selected?.planId, traceTurn, recording?.path]);

  const checks = caseChecks(scenario.expect, result);
  const savedTurns: LabTurn[] = result?.conversation?.length ? result.conversation.map(turn => ({ role: turn.role, text: turn.message })) : result?.history?.length ? [
    ...result.history.map(turn => ({ role: turn.role, text: turn.message })),
    { role: 'user', text: scenario.utterances[scenario.utterances.length - 1] ?? '' },
    ...(result.reply ? [{ role: 'agent' as const, text: result.reply }] : [])
  ] : result?.reply ? [{ role: 'agent', text: result.reply }] : [];
  const turns = recording?.turns ?? savedTurns;
  let agentTurn = 0;
  return <section className="sf-case-detail" aria-label={`Details for ${scenario.name}`}>
    <style>{SCENARIO_DETAIL_STYLES}</style>
    <div className="sf-case-detail-head"><h3>{scenario.name}</h3><button type="button" autoFocus onClick={onClose}>Close details</button></div>
    <p><strong>{result ? { pass: 'Passed', fail: 'Failed', inconclusive: 'Inconclusive' }[result.outcome] : 'Not run'}</strong></p>
    {scenario.prerequisites?.length ? <><h4>Setup required</h4><ul>{scenario.prerequisites.map((text, i) => <li key={i}>{text}</li>)}</ul></> : null}
    <h4>Case inputs</h4><ol>{scenario.utterances.map((text, i) => <li key={i}>{text}</li>)}</ol>
    <h4>Expected vs actual</h4>
    {checks.length ? checks.map((check, i) => <div key={i} className={`sf-case-check is-${check.state}`}>
      <strong>{check.state === 'ok' ? '✓ Passed' : check.state === 'ko' ? '✗ Failed' : '— Not verified'}</strong>
      <p>Expected: {check.expected}</p><p>Actual: {check.actual}</p>
    </div>) : <p className="sf-case-muted">No checks defined for this case.</p>}
    {result?.notes?.length ? <div className="sf-case-notes"><h4>Result details</h4><ul>{result.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></div> : null}
    <h4>Recorded conversation</h4>
    {loading && <p role="status">Loading conversation…</p>}
    {!loading && !recording && <p className="sf-case-muted">{!result ? 'Run this case to record a conversation.' : result.conversation?.length ? 'Showing the saved conversation. The live recording and detailed trace are unavailable.' : `${missing || 'A full recording was not saved.'} Showing saved evidence only.`}</p>}
    {!recording && result?.conversationTruncated && <p className="sf-case-muted">This saved conversation was shortened to fit the recording limit.</p>}
    <div role="log" aria-label="Case conversation">{turns.map((turn, i) => {
      const number = turn.role === 'agent' ? ++agentTurn : null;
      return <article key={i} className="sf-case-message"><strong>{turn.role === 'user' ? 'Customer' : 'Agentforce'}{recording && number ? ` · reply ${number}` : ''}</strong><p>{turn.text}</p>
        {recording?.engine === 'preview' && number && turn.planId ? <button type="button" aria-pressed={traceTurn === number} onClick={() => setTraceTurn(traceTurn === number ? null : number)}>View trace for reply {number}</button> : null}
      </article>;
    })}</div>
    {recording && !turns.length && <p className="sf-case-muted">No messages were recorded.</p>}
    {traceTurn !== null && <TracePanel trace={trace} loading={tracing} />}
    {result?.observed && <><h4>Observed routing and actions</h4><p>Topics: {result.observed.topics.join(', ') || 'None recorded'}</p><p>Actions: {result.observed.actions.join(', ') || 'None recorded'}</p>
      {(!result.observed.traced || result.observed.traceComplete === false) && <p className="sf-case-muted">The runtime trace is unavailable or incomplete.</p>}</>}
  </section>;
}
