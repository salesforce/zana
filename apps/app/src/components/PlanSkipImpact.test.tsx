/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanSkipImpact, riskySkipImpact, stepLabel } from './PlanSkipImpact.js';
import { PlanReviewDisclosure } from './PlanReviewDisclosure.js';

const rows = [
  { stepId: 'surface', title: 'Surface', skips: ['a', 'b'] },
  { stepId: 'conflict-review-ui', title: 'Conflict UI', skips: ['s1', 's2', 's3', 's4', 's5', 's6'] },
  { stepId: 'ui-rename', title: 'Rename', skips: ['s1', 's2', 's3', 's4', 's5', 's6'] },
  { stepId: 'runbook', title: 'Runbook', skips: ['verify-all'] }
];

describe('PlanSkipImpact', () => {
  afterEach(cleanup);

  it('marks only the units with the largest skip count as risky', () => {
    expect([...riskySkipImpact(rows)].sort()).toEqual(['conflict-review-ui', 'ui-rename']);
    expect(riskySkipImpact([{ stepId: 'a', title: 'A', skips: ['b'] }]).size).toBe(0);
    expect(riskySkipImpact([]).size).toBe(0);
  });

  it('renders nothing for no rows', () => {
    const { container } = render(<PlanSkipImpact rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('is collapsed by default, shows counts largest first and expands names with aria-expanded', () => {
    render(<PlanSkipImpact rows={rows} hidden={3} />);
    expect((screen.getByTestId('plan-skip-impact') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText('If a step fails (2 steps are risky)')).toBeTruthy();
    expect(screen.getByTestId('plan-skip-count-conflict-review-ui').textContent).toBe('skips 6');
    expect(screen.getByTestId('plan-skip-count-runbook').textContent).toBe('skips 1');
    expect(screen.getByTestId('plan-skip-risky-ui-rename')).toBeTruthy();
    expect(screen.queryByTestId('plan-skip-risky-surface')).toBeNull();
    expect(screen.getByText('and 3 more')).toBeTruthy();
    const button = screen.getByLabelText('conflict-review-ui: Conflict UI: skips 6, risky. Show the skipped steps');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('plan-skip-list-conflict-review-ui')).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('plan-skip-list-conflict-review-ui').querySelectorAll('li')).toHaveLength(6);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('plan-skip-list-conflict-review-ui')).toBeNull();
  });

  it('summarizes a plan with no risky step by how many steps block others, singular and plural', () => {
    const { rerender } = render(<PlanSkipImpact rows={[{ stepId: 'a', title: 'A', skips: ['b'] }]} />);
    expect(screen.getByText('If a step fails (1 step blocks others)')).toBeTruthy();
    rerender(<PlanSkipImpact rows={[{ stepId: 'a', title: 'A', skips: ['b', 'c'] }]} />);
    expect(screen.getByText('If a step fails (1 step is risky)')).toBeTruthy();
  });

  it('sits inside the plan review disclosure and keeps it rendered with skip data alone', () => {
    render(<PlanReviewDisclosure prefill={{ planSkipImpact: rows }} />);
    expect(screen.getByTestId('team-composer-plan-review').contains(screen.getByTestId('plan-skip-impact'))).toBe(true);
  });

  it('names each step by id and title, in the rows and in the skipped list', () => {
    render(<PlanSkipImpact rows={[{ stepId: 'r1', title: 'Read step 1', skips: ['r2', 'r3', 'r4'], skipTitles: ['Read step 2', 'Read step 3', ''] }]} />);
    expect(screen.getByText('r1: Read step 1')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('r1: Read step 1: skips 3, risky. Show the skipped steps'));
    expect(Array.from(screen.getByTestId('plan-skip-list-r1').querySelectorAll('li')).map((li) => li.textContent)).toEqual(['r2: Read step 2', 'r3: Read step 3', 'r4']);
  });

  it('falls back to the bare id without a title', () => {
    expect(stepLabel('r4')).toBe('r4');
    expect(stepLabel('r4', '  ')).toBe('r4');
    expect(stepLabel('r4', ' Read step 4 ')).toBe('r4: Read step 4');
  });
});
