/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';
import { PlanReviewDisclosure, planHasMustFix } from './PlanReviewDisclosure.js';

const teams = vi.hoisted(() => ({ messageProposer: vi.fn(), recheckProposalPlan: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { teams } }));
const copy = vi.hoisted(() => ({ copyTextOrFail: vi.fn() }));
vi.mock('../lib/copy-text.js', () => copy);

const blocking: SquadPlanFinding = {
  stepId: 'review', requirement: 'required-role', severity: 'blocking',
  candidateSlots: [{ slotId: 's1', label: 'Builder', personaId: 'dev', reason: 'missing reviewer' }],
  suggestion: 'Change the required role to one this Squad offers: Builder.'
};
const warning: SquadPlanFinding = { stepId: 'build', requirement: 'prefer-role', severity: 'warning', candidateSlots: [], suggestion: '' };
const repair: SquadPlanFinding = { requirement: 'format', severity: 'repair', candidateSlots: [], suggestion: '', detail: 'a heading was reformatted' };

describe('PlanReviewDisclosure', () => {
  afterEach(cleanup);

  it('shows the canonical plan text in its own disclosure, even with no findings', () => {
    render(<PlanReviewDisclosure prefill={{ planCanonicalText: '## Execution Plan\n\n### a: A' }} />);
    expect(screen.getByTestId('plan-canonical').textContent).toContain('The plan the Squad will run');
    expect(screen.getByTestId('plan-canonical-text').textContent).toBe('## Execution Plan\n\n### a: A');
  });

  it('renders nothing without plan data and reports no Must fix', () => {
    const { container } = render(<PlanReviewDisclosure prefill={{}} />);
    expect(container.firstChild).toBeNull();
    expect(planHasMustFix(undefined)).toBe(false);
    expect(planHasMustFix({ planFindings: [warning] })).toBe(false);
  });

  it('groups findings by severity label, opens on a Must fix and shows the binding table', () => {
    render(<PlanReviewDisclosure prefill={{
      planSummary: '1 Must fix before this can launch, 1 to check, 1 fixed for you',
      planFindings: [blocking, warning, repair], planFindingsHidden: 2,
      planBindings: [{ stepId: 'build', label: 'Builder', personaId: 'dev' }, { stepId: 'review', unbound: true }, { stepId: 'ship', personaId: 'dev' }, { stepId: 'x' }],
      planBindingsHidden: 3
    }} />);
    expect(planHasMustFix({ planFindings: [blocking] })).toBe(true);
    const details = screen.getByTestId('team-composer-plan-review') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(screen.getByText("Can't launch yet: 1 Must fix")).toBeTruthy();
    expect(screen.getByTestId('plan-findings-blocking').textContent).toContain('Must fix');
    expect(screen.getByTestId('plan-findings-blocking').textContent).toContain('Step review asks for a role this Squad does not have.');
    expect(screen.getByTestId('plan-findings-warning').textContent).toContain('Check');
    expect(screen.getByTestId('plan-findings-repair').textContent).toContain('Fixed for you');
    expect(screen.getByText('and 2 more')).toBeTruthy();
    const table = screen.getByTestId('plan-bindings').textContent ?? '';
    expect(table).toContain('Builder');
    expect(table).toContain('No member can run this step');
    expect(table).toContain('dev');
    expect(table).toContain('Chosen when it starts');
    expect(screen.getByText('and 3 more')).toBeTruthy();
    expect(screen.getByTestId('plan-findings-blocking').textContent).not.toContain('Ask the agent');
    expect(screen.queryByTestId('plan-fix-actions')).toBeNull();
  });

  describe('fix actions', () => {
    const plan = { planFindings: [blocking], planSummary: 's' };
    afterEach(() => { teams.messageProposer.mockReset(); teams.recheckProposalPlan.mockReset(); });

    it('shows what each button does, naming the plan file for Re-check', () => {
      render(<PlanReviewDisclosure prefill={plan} proposalId="p1" proposerTitle="Atlas chat" planFiles={['plans/must-fix.md']} />);
      const hint = () => screen.getByTestId('plan-action-hint').textContent;
      expect(hint()).toContain('fix plans/must-fix.md yourself');
      fireEvent.mouseEnter(screen.getByTestId('plan-recheck'));
      expect(hint()).toContain('Reads plans/must-fix.md from disk again');
      fireEvent.mouseLeave(screen.getByTestId('plan-recheck'));
      fireEvent.focus(screen.getByTestId('plan-send-fix'));
      expect(hint()).toContain('Sends the problems above to the agent “Atlas chat”');
      fireEvent.blur(screen.getByTestId('plan-send-fix'));
      fireEvent.mouseEnter(screen.getByTestId('plan-copy-fix'));
      expect(hint()).toContain('Paste it into the agent “Atlas chat” yourself');
    });

    it('clears the last result when another button is pointed at', async () => {
      copy.copyTextOrFail.mockResolvedValueOnce(undefined);
      render(<PlanReviewDisclosure prefill={plan} proposalId="p1" proposerTitle="Atlas chat" />);
      fireEvent.mouseEnter(screen.getByTestId('plan-copy-fix'));
      fireEvent.click(screen.getByTestId('plan-copy-fix'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status')).toBeTruthy());
      fireEvent.mouseEnter(screen.getByTestId('plan-send-fix'));
      expect(screen.queryByTestId('plan-action-status')).toBeNull();
      expect(screen.getByTestId('plan-other-options').textContent).toContain('different Squad');
    });

    it('says a pasted plan cannot be re-read when there is no plan file', () => {
      render(<PlanReviewDisclosure prefill={plan} proposalId="p1" />);
      fireEvent.mouseEnter(screen.getByTestId('plan-recheck'));
      expect(screen.getByTestId('plan-action-hint').textContent).toContain('cannot be re-read');
    });

    it('copies the problem-only request', async () => {
      copy.copyTextOrFail.mockResolvedValueOnce(undefined);
      render(<PlanReviewDisclosure prefill={plan} proposalId="p1" proposerTitle="Atlas chat" />);
      fireEvent.click(screen.getByTestId('plan-copy-fix'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status').textContent).toBe('Copied. Paste it into the agent “Atlas chat”.'));
      expect(copy.copyTextOrFail.mock.calls[0]![0]).toContain('Step review asks for a role this Squad does not have.');
    });

    it('reports a copy failure', async () => {
      copy.copyTextOrFail.mockRejectedValueOnce(new Error('no'));
      render(<PlanReviewDisclosure prefill={plan} proposalId="p1" />);
      fireEvent.click(screen.getByTestId('plan-copy-fix'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status').textContent).toContain('Could not copy'));
    });

    it('sends to the conversation by proposal id only, and reports failure', async () => {
      teams.messageProposer.mockResolvedValueOnce({ ok: true, value: { delivered: true } });
      const onSent = vi.fn();
      render(<PlanReviewDisclosure prefill={plan} proposalId="p1" proposerTitle="Atlas chat" onSent={onSent} />);
      fireEvent.click(screen.getByTestId('plan-send-fix'));
      await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
      expect(teams.messageProposer).toHaveBeenCalledWith('p1');
      teams.messageProposer.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'That conversation is no longer open.' });
      fireEvent.click(screen.getByTestId('plan-send-fix'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status').textContent).toBe('That conversation is no longer open.'));
      teams.messageProposer.mockRejectedValueOnce(new Error('ipc'));
      fireEvent.click(screen.getByTestId('plan-send-fix'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status').textContent).toContain('Could not send'));
    });

    it('re-checks and hands the fresh plan to the parent', async () => {
      const onRechecked = vi.fn();
      teams.recheckProposalPlan.mockResolvedValueOnce({ ok: true, value: { planFindings: [blocking] } });
      render(<PlanReviewDisclosure prefill={plan} proposalId="p1" onRechecked={onRechecked} />);
      fireEvent.click(screen.getByTestId('plan-recheck'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status').textContent).toBe('Re-checked: 1 Must fix remains.'));
      expect(onRechecked).toHaveBeenCalledWith({ planFindings: [blocking] });
      teams.recheckProposalPlan.mockResolvedValueOnce({ ok: true, value: {} });
      fireEvent.click(screen.getByTestId('plan-recheck'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status').textContent).toContain('nothing left to fix'));
      teams.recheckProposalPlan.mockResolvedValueOnce({ ok: false, code: 'INVALID', message: 'Launch target changed.' });
      fireEvent.click(screen.getByTestId('plan-recheck'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status').textContent).toBe('Launch target changed.'));
      teams.recheckProposalPlan.mockRejectedValueOnce(new Error('ipc'));
      fireEvent.click(screen.getByTestId('plan-recheck'));
      await waitFor(() => expect(screen.getByTestId('plan-action-status').textContent).toBe('Could not re-check the plan.'));
    });
  });

  it('stays closed with no alert when nothing must be fixed', () => {
    render(<PlanReviewDisclosure prefill={{ planSummary: 'No problems found', planFindings: [] }} />);
    expect((screen.getByTestId('team-composer-plan-review') as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
