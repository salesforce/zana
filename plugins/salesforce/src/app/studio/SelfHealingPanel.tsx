import { useEffect, useRef, useState } from 'react';
import { SELF_HEALING_RPC, selfHealingActive, selfHealingPrompt, type SelfHealingRun } from '../../../lib/self-healing-contract.js';
import type { SimulationBatch } from '../../../lib/simulation-contract.js';

export interface SelfHealingPanelProps {
  path: string; source: string; batch: SimulationBatch | null; visible: boolean;
  rpc(method: string, input?: Record<string, unknown>): Promise<{ ok?: boolean; error?: string } & Record<string, unknown>>;
  onAskAgent?(prompt: string): void;
  onInvestigate?(): void;
  pollMs?: number;
}
const STATUS = { awaiting_candidate: 'Diagnosing failures', testing: 'Testing changes', passed: 'Ready for review', exhausted: 'Budget reached', stopped: 'Stopped', expired: 'Expired' } as const;
export function SelfHealingPanel({ path, source, batch, visible, rpc, onAskAgent, onInvestigate, pollMs = 3000 }: SelfHealingPanelProps) {
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
  const failures = batch ? Math.max(0, batch.counts.total - batch.counts.pass) : 0;
  if (!run && !error && (!batch || batch.status === 'running' || !failures)) return null;
  const improved = Boolean(run && run.bestPass > run.baselinePass && !active);
  return <section className="sf-sim-healing" aria-label="Improve with assistant">
    <div className="sf-healing-heading"><div><strong>{active ? 'Improving with assistant' : improved ? 'Proposed improvements are ready' : `Improve ${failures || 'the'} failing ${failures === 1 ? 'conversation' : 'conversations'}`}</strong>
      <p className="sf-tp-foot">Let the assistant propose script changes and test them against this batch. Review changes before applying.</p></div>
      <div className="sf-healing-controls">{active ? <button type="button" className="sf-tp-btn is-danger" disabled={busy} onClick={() => void perform(SELF_HEALING_RPC.stop, { runId: run.id })}>Stop improving</button>
        : <><details className="sf-healing-options"><summary>Options · up to {budget} attempts</summary><label>Maximum attempts <select aria-label="Maximum attempts" value={budget} disabled={busy} onChange={e => setBudget(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></label></details>
          {eligible && !improved ? <button type="button" className="sf-tp-btn is-primary" disabled={busy || !onAskAgent} onClick={() => void perform(SELF_HEALING_RPC.start, { batchId: batch!.id, source, maxAttempts: budget }, true)}>{busy ? 'Starting…' : 'Ask assistant to improve'}</button>
            : !improved && <button type="button" className="sf-tp-btn" disabled={busy || !onInvestigate} onClick={onInvestigate}>Ask assistant to investigate</button>}</>}
      </div>
    </div>
    {run && <>
      {batch && run.baselineBatchId !== batch.id && <p className="sf-tp-foot">This improvement run uses a previous batch. Its original conversations and variables stay fixed.</p>}
      <ol className="sf-healing-progress" aria-label="Improvement progress">{['Diagnosing', 'Testing changes', 'Ready to review'].map((label, index) => <li key={label} aria-current={(active ? run.status === 'testing' || run.attempts.length ? 1 : 0 : improved || run.status === 'passed' ? 2 : -1) === index ? 'step' : undefined}>{label}</li>)}</ol>
      <div role="status"><strong>{STATUS[run.status]}</strong> · {run.attempts.length}/{run.maxAttempts} attempts · Baseline {run.baselinePass}/{run.total} → Best {run.bestPass}/{run.total}</div>
      <details><summary>Attempt history · {run.attempts.length}</summary><ol aria-label="Candidate history">{run.attempts.map(a => <li key={a.number}>Candidate {a.number}: {a.outcome}{a.pass === undefined ? '' : ` · ${a.pass}/${a.total} pass`}{a.regressions.length ? ` · Regressions: ${a.regressions.join(', ')}` : ''}</li>)}</ol></details>
      {onAskAgent && run.status === 'awaiting_candidate' && <button type="button" className="sf-tp-btn" onClick={() => onAskAgent(selfHealingPrompt(run))}>Continue with assistant</button>}
      {improved && onAskAgent && <button type="button" className="sf-tp-btn is-primary" onClick={() => onAskAgent(selfHealingPrompt(run))}>Review proposed changes</button>}
    </>}
    {!eligible && !active && !improved && <span className="sf-tp-foot">Automatic improvement needs a completed Simulate batch without runtime errors or stopped conversations.</span>}
    {error && <div role="alert" className="sf-tp-message is-error">{error}</div>}
  </section>;
}
