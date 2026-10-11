/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import { PlanExecutionCard } from './PlanExecutionCard.js';
import { TimelineRows } from './TimelineRows.js';
import {
  planCompletedCount,
  planExecutionCurrentIndex,
  planExecutionFinished,
  planExecutionStateKey,
  planExecutionTitle,
  planTaskStatusLabel,
  planTaskVisual,
  timelinePlanExecution,
  visiblePlanExecution
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

describe('planExecutionFinished / visiblePlanExecution', () => {
  const done = [
    { id: '1', text: 'a', status: 'completed' },
    { id: '2', text: 'b', status: 'cancelled' }
  ];
  const live = [
    { id: '1', text: 'a', status: 'completed' },
    { id: '2', text: 'b', status: 'blocked' }
  ];

  it('treats a plan as finished only when every step is done or cancelled', () => {
    expect(planExecutionFinished(done)).toBe(true);
    expect(planExecutionFinished(live)).toBe(false);
    expect(planExecutionFinished([{ id: '1', text: 'a', status: 'pending' }])).toBe(false);
    expect(planExecutionFinished([])).toBe(false);
  });

  it('drops a finished or empty plan, and keeps a live one', () => {
    expect(visiblePlanExecution({ title: 'Plan', tasks: done })).toBeNull();
    expect(visiblePlanExecution({ title: 'Plan', tasks: live })?.tasks).toBe(live);
    expect(visiblePlanExecution({ title: 'Plan', tasks: [] })).toBeNull();
    expect(visiblePlanExecution(null)).toBeNull();
  });
});

describe('planExecutionStateKey', () => {
  it('scopes a choice to the thread, the plan, and its revision', () => {
    const key = planExecutionStateKey('t1', 'plan-1', 2);
    expect(planExecutionStateKey('t1', 'plan-1', 2)).toBe(key);
    expect(planExecutionStateKey('t1', 'plan-1', 3)).not.toBe(key);
    expect(planExecutionStateKey('t2', 'plan-1', 2)).not.toBe(key);
    expect(planExecutionStateKey('t1', null, 2)).toBe(planExecutionStateKey('t1', undefined, 2));
    expect(planExecutionStateKey('t1', null, 2)).not.toBe(key);
  });
});

describe('timelinePlanExecution', () => {
  it('builds the card from a durable plan with steps, else nothing', () => {
    const tasks = [{ id: '1', text: 'a', status: 'pending' }];
    expect(timelinePlanExecution('t1', { id: 'plan-1', markdown: '# Ship it', revision: 2, tasks })).toEqual({
      title: 'Ship it',
      tasks,
      stateKey: planExecutionStateKey('t1', 'plan-1', 2)
    });
    expect(timelinePlanExecution('t1', { markdown: null, revision: 0, tasks })?.stateKey)
      .toBe(planExecutionStateKey('t1', null, 0));
    expect(timelinePlanExecution('t1', { id: 'plan-1', markdown: null, revision: 0, tasks: [] })).toBeNull();
    expect(timelinePlanExecution('t1', null)).toBeNull();
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

const finishedTasks = [
  { id: '1', text: 'Server: merge collab state', status: 'completed' },
  { id: '2', text: 'Client: send Yjs state', status: 'completed' }
];

function header() {
  return within(screen.getByTestId('thread-plan-execution')).getByRole('button');
}

describe('PlanExecutionCard open state', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps a keyed choice across remounts, and a new revision starts fresh', () => {
    const key = planExecutionStateKey('t-remount', 'plan', 1);
    const first = render(<PlanExecutionCard title="Plan" tasks={planTasks} stateKey={key} />);
    expect(header().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header());
    first.unmount();

    render(<PlanExecutionCard title="Plan" tasks={planTasks} stateKey={key} />);
    expect(header().getAttribute('aria-expanded')).toBe('false');
    cleanup();

    render(<PlanExecutionCard title="Plan" tasks={planTasks} stateKey={planExecutionStateKey('t-remount', 'plan', 2)} />);
    expect(header().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps a reader-opened card open', () => {
    const key = planExecutionStateKey('t-reopen', 'plan', 1);
    const first = render(<PlanExecutionCard title="Plan" tasks={planTasks} stateKey={key} />);
    fireEvent.click(header());
    fireEvent.click(header());
    first.unmount();
    render(<PlanExecutionCard title="Plan" tasks={planTasks} stateKey={key} />);
    expect(header().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps every mounted card for the same plan in step', () => {
    const key = planExecutionStateKey('t-split', 'plan', 1);
    render(
      <>
        <PlanExecutionCard title="Plan" tasks={planTasks} stateKey={key} />
        <PlanExecutionCard title="Plan" tasks={planTasks} stateKey={key} />
      </>
    );
    const [left, right] = screen.getAllByRole('button');
    fireEvent.click(left!);
    expect(left!.getAttribute('aria-expanded')).toBe('false');
    expect(right!.getAttribute('aria-expanded')).toBe('false');
  });
});

function userRow(id: string, text: string): ThreadTimelineViewRow {
  return {
    id, threadId: 't', turnId: `turn-${id}`, sourceSeqStart: 1, sourceSeqEnd: 1, startedAt: 1, createdAt: 1,
    kind: 'conversation', role: 'user', text, attachments: null, initiator: 'user', senderThreadId: null,
    systemMessageKind: 'unlabeled', systemMessageSubject: null,
    turnRequest: { kind: 'message', status: 'accepted', isGrouped: false }, mentions: []
  } as ThreadTimelineViewRow;
}

const expansion = { liveFrontierRowIds: new Set<string>(), terminalFrontierRowIds: new Set<string>() };

describe('TimelineRows plan card', () => {
  afterEach(() => {
    cleanup();
  });

  it('stays closed when a new message moves the card under it', () => {
    const plan = { title: 'Plan', tasks: planTasks, stateKey: planExecutionStateKey('t-follow', 'plan', 1) };
    const first = [userRow('u1', 'First ask')];
    const slot = render(<TimelineRows rows={first} expansion={expansion} planExecution={plan} threadIdle />);
    fireEvent.click(header());
    expect(header().getAttribute('aria-expanded')).toBe('false');

    slot.rerender(
      <TimelineRows rows={[...first, userRow('u2', 'Unrelated follow-up')]} expansion={expansion} planExecution={plan} />
    );
    const cards = screen.getAllByTestId('thread-plan-execution');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.closest('.thread-timeline-item')?.textContent).toContain('Unrelated follow-up');
    expect(header().getAttribute('aria-expanded')).toBe('false');
  });

  it('drops a plan once it finishes, and keeps it gone while the agent works on later messages', () => {
    const stateKey = planExecutionStateKey('t-finished', 'plan', 1);
    const rows = [userRow('u1', 'Ask')];
    const slot = render(
      <TimelineRows rows={rows} expansion={expansion} planExecution={{ title: 'Plan', tasks: planTasks, stateKey }} threadIdle={false} />
    );
    expect(screen.getByTestId('thread-plan-execution')).toBeTruthy();

    const finished = { title: 'Plan', tasks: finishedTasks, stateKey };
    slot.rerender(<TimelineRows rows={rows} expansion={expansion} planExecution={finished} threadIdle={false} />);
    expect(screen.queryByTestId('thread-plan-execution')).toBeNull();

    slot.rerender(
      <TimelineRows rows={[...rows, userRow('u2', 'Unrelated follow-up')]} expansion={expansion} planExecution={finished} threadIdle={false} />
    );
    expect(screen.queryByTestId('thread-plan-execution')).toBeNull();
  });
});
