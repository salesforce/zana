import { useEffect, useRef, useState } from 'react';
import { SELF_HEALING_RPC, selfHealingActive, selfHealingPrompt, type SelfHealingRun } from '../../../lib/self-healing-contract.js';
import type { SimulationBatch } from '../../../lib/simulation-contract.js';

export interface SelfHealingPanelProps {
  path: string; source: string; batch: SimulationBatch | null; visible: boolean;
  rpc(method: string, input?: Record<string, unknown>): Promise<{ ok?: boolean; error?: string } & Record<string, unknown>>;
  onAskAgent?(prompt: string): void;
  pollMs?: number;
}
const STATUS = { awaiting_candidate: 'Waiting for the agent', testing: 'Testing candidate', passed: 'Ready for review', exhausted: 'Budget reached', stopped: 'Stopped', expired: 'Expired' } as const;
export function SelfHealingPanel({ path, source, batch, visible, rpc, onAskAgent, pollMs = 3000 }: SelfHealingPanelProps) {
  const [run, setRun] = useState<SelfHealingRun | null>(null);
  const [budget, setBudget] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const version = generation.current;
      try {
        const result = await rpc(SELF_HEALING_RPC.status, { agentPath: path });
        if (alive && version === generation.current && result.ok !== false) setRun(result.run as SelfHealingRun | null);
      } catch { /* A transient refresh failure must not erase the last visible evidence. */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => { alive = false; clearInterval(timer); };
  }, [visible, path, rpc, pollMs]);
  const active = run && selfHealingActive(run);
  const eligible = batch?.status === 'done' && batch.engine === 'preview' && !batch.counts.error && !batch.counts.stopped && batch.counts.pass < batch.counts.total;
  const perform = async (method: string, input: Record<string, unknown>, handoff = false) => {
    generation.current++;
    setBusy(true); setError('');
    try {
      const result = await rpc(method, input);
      if (!aliveRef.current) return;
      if (result.ok === false) throw Error(result.error || 'Self-healing could not continue.');
      const next = result.run as SelfHealingRun;
      setRun(next);
      if (handoff) onAskAgent?.(selfHealingPrompt(next));
    } catch (e) { if (aliveRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (aliveRef.current) setBusy(false); }
  };
  return <section className="sf-sim-healing" aria-label="Self-healing" style={{ border: '1px solid var(--sf-border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div className="sf-tp-bar"><strong>Self-healing</strong><span className="sf-tp-spacer" />
      {active ? <button type="button" className="sf-tp-btn" disabled={busy} onClick={() => void perform(SELF_HEALING_RPC.stop, { runId: run.id })}>Stop self-healing</button>
        : <><label>Candidate attempts <select aria-label="Candidate attempts" value={budget} disabled={busy} onChange={e => setBudget(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <button type="button" className="sf-tp-btn is-primary" disabled={busy || !eligible || !onAskAgent} onClick={() => void perform(SELF_HEALING_RPC.start, { batchId: batch!.id, source, maxAttempts: budget }, true)}>Start self-healing</button></>}
    </div>
    <p className="sf-tp-foot" style={{ margin: 0 }}>The agent diagnoses failures, tests changes on these same conversations, and keeps the best result without regressing passing cases. Review the proposed change before saving.</p>
    {run && <>
      <div role="status"><strong>{STATUS[run.status]}</strong> · {run.attempts.length}/{run.maxAttempts} attempts · Baseline {run.baselinePass}/{run.total} → Best {run.bestPass}/{run.total}</div>
      <ol style={{ margin: 0, paddingLeft: 20 }} aria-label="Candidate history">{run.attempts.map(a => <li key={a.number}>Candidate {a.number}: {a.outcome}{a.pass === undefined ? '' : ` · ${a.pass}/${a.total} pass`}{a.regressions.length ? ` · Regressions: ${a.regressions.join(', ')}` : ''}</li>)}</ol>
      {onAskAgent && run.status === 'awaiting_candidate' && <button type="button" className="sf-tp-btn" onClick={() => onAskAgent(selfHealingPrompt(run))}>Continue with agent</button>}
      {run.bestPass > run.baselinePass && !active && onAskAgent && <button type="button" className="sf-tp-btn" onClick={() => onAskAgent(selfHealingPrompt(run))}>Review best candidate with agent</button>}
    </>}
    {!run && !eligible && <span className="sf-tp-foot">First complete a Simulate batch with failing conversations and no runtime errors.</span>}
    {error && <div role="alert" className="sf-tp-message is-error">{error}</div>}
  </section>;
}
