/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanExecutionCard } from './PlanExecutionCard.js';
import {
  planCompletedCount,
  planExecutionCurrentIndex,
  planExecutionTitle,
  planTaskStatusLabel,
  planTaskVisual
} from './plan-execution-card.js';

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

describe('planTaskVisual / planTaskStatusLabel', () => {
  it('buckets provider statuses into distinct visuals', () => {
    expect(planTaskVisual('completed')).toBe('completed');
    expect(planTaskVisual('in_progress')).toBe('in_progress');
    expect(planTaskVisual('active')).toBe('in_progress');
    expect(planTaskVisual('blocked')).toBe('blocked');
    expect(planTaskVisual('canceled')).toBe('cancelled');
    expect(planTaskVisual('pending')).toBe('pending');
    expect(planTaskVisual('anything-else')).toBe('pending');
    expect(planTaskStatusLabel('completed')).toBe('Completed');
    expect(planTaskStatusLabel('in_progress')).toBe('In progress');
    expect(planTaskStatusLabel('pending')).toBe('Pending');
  });
});

describe('planCompletedCount', () => {
  it('counts only completed tasks', () => {
    expect(
      planCompletedCount([
        { id: '1', text: 'a', status: 'completed' },
        { id: '2', text: 'b', status: 'completed' },
        { id: '3', text: 'c', status: 'in_progress' },
        { id: '4', text: 'd', status: 'pending' }
      ])
    ).toBe(2);
    expect(planCompletedCount([])).toBe(0);
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

  it('shows the plan title, a done count, and every step once', () => {
    render(<PlanExecutionCard title="Force host daemon" tasks={planTasks} />);
    const card = screen.getByTestId('thread-plan-execution');
    expect(card.getAttribute('aria-label')).toBe('Force host daemon');
    const header = screen.getByRole('button');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    // Header names the plan, not the active task.
    expect(card.querySelector('.thread-plan-execution-title')?.textContent).toBe('Force host daemon');
    // Counter is completed/total, not the current position.
    expect(screen.getByTestId('thread-plan-execution-count').textContent).toBe('0/4');
    // Current task is listed once (no duplicated header line) and marked current.
    expect(screen.queryByTestId('thread-plan-execution-current')).toBeNull();
    const current = screen.getByText('Block Send on unbound remotes').closest('li');
    expect(current?.className).toContain('is-current');
    expect(current?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Reject SSH thread create')).toBeTruthy();
    expect(card.querySelectorAll('.thread-plan-execution-item').length).toBe(4);
    expect(card.querySelector('.thread-timeline-work-chevron')).not.toBeNull();
  });

  it('marks completed steps done and counts them', () => {
    render(
      <PlanExecutionCard
        title="Ship it"
        tasks={[
          { id: '1', text: 'Done first', status: 'completed' },
          { id: '2', text: 'Also done', status: 'completed' },
          { id: '3', text: 'Current work', status: 'in_progress' },
          { id: '4', text: 'Later', status: 'pending' }
        ]}
      />
    );
    expect(screen.getByTestId('thread-plan-execution-count').textContent).toBe('2/4');
    const done = screen.getByText('Done first').closest('li');
    expect(done?.className).toContain('is-done');
    expect(done?.getAttribute('data-status')).toBe('completed');
    expect(done?.getAttribute('aria-label')).toBe('Completed: Done first');
    const current = screen.getByText('Current work').closest('li');
    expect(current?.className).toContain('is-current');
    expect(current?.getAttribute('data-status')).toBe('in_progress');
  });

  it('collapses to the header on click', () => {
    render(<PlanExecutionCard title="Force host daemon" tasks={planTasks} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Reject SSH thread create')).toBeNull();
    expect(screen.getByTestId('thread-plan-execution-count').textContent).toBe('0/4');
  });

  it('falls back to the active task text when the plan has no title', () => {
    render(
      <PlanExecutionCard
        title="   "
        tasks={[{ id: '1', text: 'Only step', status: 'in_progress' }]}
      />
    );
    expect(screen.getByTestId('thread-plan-execution').getAttribute('aria-label')).toBe('Only step');
    expect(screen.getByTestId('thread-plan-execution-count').textContent).toBe('0/1');
    expect(screen.getAllByText('Only step').length).toBe(2); // header + single list row
  });

  it('renders nothing when there are no tasks', () => {
    const { container } = render(<PlanExecutionCard title="Plan" tasks={[]} />);
    expect(container.querySelector('[data-testid="thread-plan-execution"]')).toBeNull();
  });
});
