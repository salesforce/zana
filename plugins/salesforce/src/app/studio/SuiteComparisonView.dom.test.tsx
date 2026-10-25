/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { comparisonSummary, SuiteComparisonView } from './SuiteComparisonView.js';
import type { CaseOutcome, CaseResult, SuiteComparison } from '../../../lib/studio-contract.js';
afterEach(cleanup);
const row = (outcome: CaseOutcome, extra = {}): CaseResult => ({ outcome, at: 1, runId: 'r', ...extra });
it('distinguishes improvements, regressions, unchanged failures and uncertain comparisons', () => {
  const comparison: SuiteComparison = { referenceHash: 'same', candidateHash: 'same', suiteHash: 's', at: 1,
    reference: { a: row('fail'), b: row('pass'), c: row('inconclusive'), d: row('pass'), e: row('fail') },
    candidate: { a: row('pass'), b: row('fail'), c: row('pass'), e: row('fail') } };
  expect(comparisonSummary(comparison)).toEqual({ total: 5, improved: 1, regressed: 1, unclear: 2, referencePass: 2, candidatePass: 2 });
  render(<SuiteComparisonView comparison={comparison} cases={[]} stale={false} />);
  expect(screen.getByText(/Both sources are identical/)).toBeTruthy();
  expect(screen.getByText('d: pass → inconclusive')).toBeTruthy();
  expect(screen.getAllByText('No reply recorded').length).toBe(10);
  expect(screen.queryByText(/editor or cases changed/)).toBeNull();
});
