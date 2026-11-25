// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionRunActivity } from './ExecutionRunActivity.js';

afterEach(cleanup);

type Event = ExecutionBoardSnapshot['events'][number];
function event(sequence: number, summary: string, fields: Partial<Event> = {}): Event {
  return { id: String(sequence), sequence, summary, createdAt: sequence, severity: 'info', ...fields };
}

const work: NonNullable<ExecutionBoardSnapshot['execution']['work']> = {
  total: 1, completed: 1, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 1, FAILED: 0, SKIPPED: 0 },
  rosterSlotIds: [], assignments: [{ workUnitId: 'home', title: 'Review home page', dependencies: [], state: 'COMPLETED' }]
};

function openLog(summary: string) {
  const disclosure = screen.getByText(summary).closest('details')!;
  disclosure.open = true;
  fireEvent(disclosure, new window.Event('toggle'));
}

it('shows human-readable milestones and keeps host events and references in the full log', () => {
  render(<ExecutionRunActivity truncated={false} work={work} events={[
    event(1, 'Execution reserved'),
    event(2, 'Work unit completed: home'),
    event(3, 'Native recovery snapshot captured'),
    event(4, 'Coordinator wake queued', { severity: 'warning', detail: 'Diagnostic detail', references: [{ label: 'Evidence', uri: 'note.md' }] }),
    event(5, 'Execution blocker response accepted: blocker-1'),
    event(6, 'Execution blocker response delivered: blocker-1')
  ]} />);
  expect(screen.getByText('Review home page completed')).toBeTruthy();
  expect(screen.getByText('Answer queued for delivery')).toBeTruthy();
  expect(screen.getByText('Worker acknowledged the answer')).toBeTruthy();
  expect(screen.queryByText('Native recovery snapshot captured')).toBeNull();

  openLog('All events (6)');
  const log = screen.getByRole('list', { name: 'Event log' });
  expect(within(log).getAllByRole('listitem')).toHaveLength(6);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Warnings only' }));
  expect(within(log).getAllByRole('listitem')).toHaveLength(1);
  expect(within(log).getByText('Coordinator wake queued', { exact: false })).toBeTruthy();
  expect(within(log).getByText('Diagnostic detail')).toBeTruthy();
  expect(within(log).getByText('Evidence: note.md')).toBeTruthy();
});

it('shows a bounded event tail and an explicit empty warning filter', () => {
  render(<ExecutionRunActivity truncated events={[event(1, 'Preparing')]}/>);
  expect(screen.getByText('No work milestones yet.')).toBeTruthy();
  openLog('Recent events (1)');
  expect(screen.getByText('Showing the latest 1 events for this run.')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Warnings only' }));
  expect(screen.getByRole('status').textContent).toBe('No warnings in this event log.');
});

it('keeps the latest three work milestones and ignores routine host messages', () => {
  render(<ExecutionRunActivity truncated={false} events={[
    event(1, 'Prior progress', { eventType: 'progress', progress: { completed: 1, total: 2 } }),
    event(2, 'Work unit blocked: legacy-step'),
    event(3, 'Worker failure', { eventType: 'failure', severity: 'error' }),
    event(4, 'Run finalized', { eventType: 'outcome' }),
    event(5, 'Native recovery snapshot captured')
  ]} />);
  expect(screen.getByText('legacy-step blocked')).toBeTruthy();
  expect(screen.getByText('Worker failure')).toBeTruthy();
  expect(screen.getByText('Run finalized')).toBeTruthy();
  expect(screen.queryByText('Prior progress')).toBeNull();
});

it('recognizes typed progress and blocker events when work titles are unavailable', () => {
  render(<ExecutionRunActivity truncated={false} events={[
    event(1, 'Step advancing', { progress: { completed: 2, total: 3 } }),
    event(2, 'Worker asked a question', { eventType: 'blocker' })
  ]} />);
  expect(screen.getByText('Step advancing')).toBeTruthy();
  expect(screen.getByText('Worker asked a question')).toBeTruthy();
});
