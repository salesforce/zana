/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanExecutionCard } from './PlanExecutionCard.js';
import { planExecutionCurrentIndex, planExecutionTitle } from './plan-execution-card.js';

describe('planExecutionTitle', () => {
  it('uses the first markdown heading, else Plan', () => {
    expect(planExecutionTitle('# Force host daemon\n\nBody')).toBe('Force host daemon');
    expect(planExecutionTitle('No heading')).toBe('No heading');
    expect(planExecutionTitle('  \n')).toBe('Plan');
    expect(planExecutionTitle(null)).toBe('Plan');
  });
});

describe('planExecutionCurrentIndex', () => {
  it('prefers in-progress, then pending', () => {
    expect(planExecutionCurrentIndex([
      { id: 'a', text: 'one', status: 'completed' },
      { id: 'b', text: 'two', status: 'in_progress' },
      { id: 'c', text: 'three', status: 'pending' }
    ])).toBe(1);
    expect(planExecutionCurrentIndex([
      { id: 'a', text: 'one', status: 'pending' },
      { id: 'b', text: 'two', status: 'pending' }
    ])).toBe(0);
    expect(planExecutionCurrentIndex([
      { id: 'a', text: 'one', status: 'completed' },
      { id: 'b', text: 'two', status: 'completed' }
    ])).toBe(1);
  });
});

const planTasks = [
  { id: '1', text: 'Block Send on unbound remotes', status: 'in_progress' },
  { id: '2', text: 'Reject SSH thread create', status: 'pending' },
  { id: '3', text: 'Remove skip-install', status: 'pending' },
  { id: '4', text: 'Update docs and tests', status: 'pending' }
];

describe('PlanExecutionCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the current task expanded with remaining steps', () => {
    render(<PlanExecutionCard title="Force host daemon" tasks={planTasks} />);
    const card = screen.getByTestId('thread-plan-execution');
    expect(card.getAttribute('aria-label')).toBe('Force host daemon');
    const header = screen.getByRole('button');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('thread-plan-execution-count').textContent).toBe('1/4');
    expect(screen.getByTestId('thread-plan-execution-current').textContent)
      .toBe('Block Send on unbound remotes');
    expect(screen.getByText('Reject SSH thread create')).toBeTruthy();
    expect(card.querySelector('.thread-timeline-work-chevron')).not.toBeNull();
  });

  it('collapses to the header on click', () => {
    render(<PlanExecutionCard title="Force host daemon" tasks={planTasks} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('thread-plan-execution-current')).toBeNull();
    expect(screen.queryByText('Reject SSH thread create')).toBeNull();
    expect(screen.getByTestId('thread-plan-execution-count').textContent).toBe('1/4');
  });

  it('renders nothing when there are no tasks', () => {
    const { container } = render(<PlanExecutionCard title="Plan" tasks={[]} />);
    expect(container.querySelector('[data-testid="thread-plan-execution"]')).toBeNull();
  });

  it('dims completed remaining steps and skips the list for a single task', () => {
    render(
      <PlanExecutionCard
        title="Plan"
        tasks={[
          { id: '1', text: 'Done first', status: 'completed' },
          { id: '2', text: 'Current work', status: 'in_progress' }
        ]}
      />
    );
    expect(screen.getByText('Done first').closest('li')?.className).toContain('is-done');
    cleanup();
    const { container } = render(
      <PlanExecutionCard title="Plan" tasks={[{ id: '1', text: 'Only step', status: 'in_progress' }]} />
    );
    expect(container.querySelector('.thread-plan-execution-list')).toBeNull();
    expect(screen.getByTestId('thread-plan-execution-count').textContent).toBe('1/1');
  });
});
