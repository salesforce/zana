/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquadPlanBinding, SquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';
import { PlanReviewDisclosure } from './PlanReviewDisclosure.js';

vi.mock('../lib/product-client.js', () => ({ product: { teams: { messageProposer: vi.fn(), recheckProposalPlan: vi.fn() } } }));
vi.mock('../lib/copy-text.js', () => ({ copyTextOrFail: vi.fn() }));

const bind = (stepId: string, skipsIfFailed?: string[]): SquadPlanBinding => ({ stepId, slotId: 'w1', label: 'Builder', personaId: 'dev', ...(skipsIfFailed ? { skipsIfFailed } : {}) });
const rowOf = (stepId: string) => screen.getByRole('rowheader', { name: stepId }).closest('tr')!;

describe('launch card skip impact (REQ-9, REQ-8)', () => {
  afterEach(cleanup);

  it('shows, on the row of each step that has dependents, which steps will not run if it fails', () => {
    render(<PlanReviewDisclosure prefill={{ planSummary: 'No problems found', planBindings: [bind('a', ['b', 'c']), bind('b', ['c']), bind('c')] }} />);
    expect(rowOf('a').textContent).toContain('If this step fails, these steps will not run: b, c');
    expect(rowOf('b').textContent).toContain('If this step fails, these steps will not run: c');
    expect(rowOf('c').textContent).not.toContain('If this step fails');
  });
  it('shows the first five and "and N more" after that', () => {
    render(<PlanReviewDisclosure prefill={{ planSummary: 'x', planBindings: [bind('s1', ['s2', 's3', 's4', 's5', 's6', 's7', 's8']), bind('s2')] }} />);
    expect(rowOf('s1').textContent).toContain('If this step fails, these steps will not run: s2, s3, s4, s5, s6 and 2 more');
    expect(rowOf('s1').textContent).not.toContain('s7,');
  });
  it('shows exactly five names with no "more"', () => {
    render(<PlanReviewDisclosure prefill={{ planSummary: 'x', planBindings: [bind('s1', ['a', 'b', 'c', 'd', 'e'])] }} />);
    expect(rowOf('s1').textContent).toContain('will not run: a, b, c, d, e');
    expect(rowOf('s1').textContent).not.toMatch(/more/);
  });
  it('shows nothing extra for old bindings without the field (existing proposals)', () => {
    render(<PlanReviewDisclosure prefill={{ planSummary: 'No problems found', planBindings: [bind('a'), bind('b')] }} />);
    expect(screen.getByTestId('plan-bindings').textContent).not.toContain('If this step fails');
  });
  it('still shows the member column and the Check findings beside the skip line', () => {
    const check: SquadPlanFinding = { requirement: 'plan', severity: 'warning', candidateSlots: [], suggestion: '', detail: 'Only 1 step can run at the same time, but this Squad has 2 workers. The others will wait.' };
    render(<PlanReviewDisclosure prefill={{ planSummary: '1 to check', planFindings: [check], planBindings: [bind('a', ['b']), bind('b')] }} />);
    expect(rowOf('a').textContent).toContain('Builder');
    expect(screen.getByTestId('plan-findings-warning').textContent).toContain('Only 1 step can run at the same time');
    expect(screen.getByTestId('plan-findings-warning').textContent).toContain('Launch is still allowed');
  });
  it('A3: shows the retry wording when the step has a retry policy', () => {
    render(<PlanReviewDisclosure prefill={{ planSummary: 'x', planBindings: [{ ...bind('a', ['b']), failurePolicy: 'retry' }, bind('b')] }} />);
    expect(rowOf('a').textContent).toContain('If this step fails and a retry does not fix it, these steps will not run: b');
  });
});
