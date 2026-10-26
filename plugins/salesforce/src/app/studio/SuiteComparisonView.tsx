import type { ScenarioCase, SuiteComparison } from '../../../lib/studio-contract.js';

export function comparisonSummary(comparison: SuiteComparison) {
  let improved = 0, regressed = 0, unclear = 0, referencePass = 0, candidatePass = 0;
  const ids = Object.keys(comparison.reference);
  for (const id of ids) {
    const a = comparison.reference[id]?.outcome, b = comparison.candidate[id]?.outcome;
    if (a === 'pass') referencePass++;
    if (b === 'pass') candidatePass++;
    if (!a || !b || a === 'inconclusive' || b === 'inconclusive') unclear++;
    else if (a === 'fail' && b === 'pass') improved++;
    else if (a === 'pass' && b === 'fail') regressed++;
  }
  return { total: ids.length, improved, regressed, unclear, referencePass, candidatePass };
}

/** Read-only snapshots. Comparing must never save a draft or replace the suite's normal results. */
export function SuiteComparisonView({ comparison, cases, stale }: { comparison: SuiteComparison; cases: ScenarioCase[]; stale: boolean }) {
  const counts = comparisonSummary(comparison);
  return <section aria-label="Saved source versus editor draft" className="sf-tp-loop">
    <strong>Saved source → Editor draft: {counts.referencePass}/{counts.total} → {counts.candidatePass}/{counts.total} pass</strong>
    <div role="status">{counts.improved} improved · {counts.regressed} regressed · {counts.unclear} unclear</div>
    <p className="sf-tp-foot">Same scripted messages and context, in Simulate. Actions are simulated. Each reply is generated afresh; one run does not establish statistical improvement.</p>
    {comparison.referenceHash === comparison.candidateHash && <p className="sf-tp-foot">Both sources are identical. This run checks variation between repeated conversations.</p>}
    {stale && <p role="status">The editor or cases changed after this comparison. Run it again to compare the current draft.</p>}
    <small className="sf-tp-sub">Reference {comparison.referenceHash.slice(0, 12)} · Candidate {comparison.candidateHash.slice(0, 12)}</small>
    {Object.keys(comparison.reference).map(id => <details key={id}>
      <summary>{cases.find(c => c.id === id)?.name ?? id}: {comparison.reference[id]?.outcome ?? 'inconclusive'} → {comparison.candidate[id]?.outcome ?? 'inconclusive'}</summary>
      <div className="sf-tp-compare">
        {(['reference', 'candidate'] as const).map(side => {
          const result = comparison[side][id];
          return <div key={side}><h4>{side === 'reference' ? 'Saved source' : 'Editor draft'}</h4>
            <p className="sf-tp-reply">{result?.reply ?? 'No reply recorded'}</p>
            <p>Actions: {result?.observed?.actions.join(', ') || 'None recorded'}<br />Maximum response latency: {result?.latencyMs !== undefined ? `${result.latencyMs} ms` : 'Unavailable'}</p>
            {result?.notes?.map((note, i) => <p key={i}>{note}</p>)}
          </div>;
        })}
      </div>
    </details>)}
  </section>;
}
