import { useEffect, useState } from 'react';
import type { ScenarioCase, SuiteProgress } from '../../../lib/studio-contract.js';

const STAGE: Record<SuiteProgress['stage'], string> = {
  starting: 'Starting session', conversation: 'Waiting for agent response',
  trace: 'Checking topics and actions', judging: 'Evaluating criteria',
  saving: 'Finishing run', 'org-eval': 'Waiting for Salesforce evaluation results'
};

/** Counts completed cases only; org eval exposes no per-case progress until it returns. */
export function SuiteRunProgress({ progress, cases, startedAt, orgEval = false }: {
  progress?: SuiteProgress; cases: ScenarioCase[]; startedAt: number; orgEval?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - (progress?.startedAt ?? startedAt)) / 1000));
  const duration = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const mode = progress?.mode ?? (orgEval ? 'org-eval' : 'simulate');
  const label = mode === 'compare' ? `Compare ${progress?.comparisonPhase === 'reference' ? 'saved source' : 'editor draft'}` : mode === 'org-eval' ? 'Org eval' : mode === 'proposal' ? 'Proposal' : 'Simulate';
  const current = cases.find(c => c.id === progress?.currentCaseId);
  const total = progress?.caseIds.length ?? cases.length;
  const stage = progress ? STAGE[progress.stage] : 'Starting run';
  return <div className="sf-tp-run" data-testid="tests-run-progress">
    <div role="status" aria-live="polite" className="sf-tp-head">
      <strong>{label} · {mode === 'org-eval' ? 'Running' : `${progress?.completed ?? 0} of ${total} cases complete`}</strong>
      {current && <span className="sf-tp-run-case">{current.name}</span>}
      <span className="sf-tp-sub">{stage}{progress?.stage === 'conversation' ? ` · turn ${progress.turn} of ${progress.totalTurns}` : ''}</span>
    </div>
    <div className="sf-tp-head">
      {mode !== 'org-eval' && <progress aria-label="Completed test cases" max={Math.max(1, total)} value={progress?.completed ?? 0} />}
      <span className="sf-tp-sub" data-testid="tests-run-elapsed">Elapsed {duration}</span>
      {mode === 'org-eval' && <span className="sf-tp-sub">Case results appear when Salesforce finishes.</span>}
    </div>
  </div>;
}
