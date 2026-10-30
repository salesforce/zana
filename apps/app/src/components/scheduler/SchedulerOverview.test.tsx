/** @vitest-environment happy-dom */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';
import { filterSchedules, scheduleIssue } from './schedule-filter.js';

const state = vi.hoisted(() => ({ terminals: {} as Record<string, Array<{ id: string; status: string }>> }));
const config = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { config } }));
vi.mock('../../store.js', () => ({ useData: (select: (value: typeof state) => unknown) => select(state) }));
import { SchedulerOverview } from './SchedulerOverview.js';

const projects = [{ id: 'p1', name: 'Garden', path: '/garden' }, { id: 'p2', name: 'Shop', path: '/shop' }] as Project[];
const projectMap = new Map(projects.map(p => [p.id, p]));
const task = (id: string, changes: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id, name: id, projectId: 'p1', enabled: true, profile: 'shell', schedule: { every: '1h' },
  overlap: 'skip', history: { retain: 10 }, createdAt: '', updatedAt: '',
  status: { runCount: 0, runs: [], nextRunAt: new Date(Date.now() + 3_600_000).toISOString() }, ...changes
});
const withRun = (id: string, result: ScheduleRun['result'], extras: Partial<ScheduleRun> = {}) => task(id, {
  status: { runCount: 1, runs: [{ at: new Date().toISOString(), result, ...extras }] }
});
function mount(tasks: ScheduledTask[], extra = {}) {
  const props = { tasks, projects, tick: 0, onJump: vi.fn(), onOpenTerminal: vi.fn(), onEdit: vi.fn(), onShowReport: vi.fn(), onToggle: vi.fn(), onRunNow: vi.fn(), onStopLive: vi.fn(), onOpenProject: vi.fn(), onBrowse: vi.fn(), ...extra };
  const view = render(<SchedulerOverview {...props} />);
  return { ...view, props, inventory: () => screen.getByRole('region', { name: 'All schedules' }) };
}
afterEach(cleanup);
beforeEach(() => { state.terminals = {}; config.get.mockReset().mockResolvedValue({ schedulerRecoveryIntro: 'dismissed' }); config.set.mockReset().mockResolvedValue(undefined); });

describe('schedule filtering and health', () => {
  it('keeps missing projects visible, including paused schedules', () => {
    expect(scheduleIssue(task('missing', { projectId: 'gone', enabled: false }), projectMap)).toBe('Project missing');
    expect(scheduleIssue(task('healthy'), projectMap)).toBeNull();
    expect(scheduleIssue(withRun('incomplete', 'incomplete'), projectMap)).toBe('Open problem');
  });
  it('ignores skipped overlaps, clears resolved failures, and supports legacy summary status', () => {
    const failed = withRun('failed', 'error');
    failed.status!.runs.unshift({ at: new Date().toISOString(), result: 'skipped' });
    expect(scheduleIssue(failed, projectMap)).toBe('Open problem');
    failed.status!.runs[1] = { ...failed.status!.runs[1]!, resolvedBy: 'later-success' };
    expect(scheduleIssue(failed, projectMap)).toBeNull();
    // A legacy summary-only status carries no run to act on, so it is not an open problem.
    expect(scheduleIssue(task('legacy', { status: { runs: [], runCount: 1, lastRunResult: 'error' } }), projectMap)).toBeNull();
  });
  it('combines case-insensitive search with enabled, paused and attention filters', () => {
    const tasks = [task('digest', { description: 'Weekly summary' }), task('paused', { enabled: false, projectId: 'p2' }), withRun('failed', 'error')];
    expect(filterSchedules(tasks, projectMap, ' GARDEN ', 'enabled').map(t => t.id)).toEqual(['digest', 'failed']);
    expect(filterSchedules(tasks, projectMap, 'shop', 'paused').map(t => t.id)).toEqual(['paused']);
    expect(filterSchedules(tasks, projectMap, '', 'attention').map(t => t.id)).toEqual(['failed']);
    expect(filterSchedules(tasks, projectMap, 'weekly', 'all').map(t => t.id)).toEqual(['digest']);
    expect(filterSchedules(tasks, projectMap, 'shell', 'all')).toHaveLength(3);
  });
});

describe('SchedulerOverview', () => {
  it('says off, Disable and Enable for turning schedules on and off', () => {
    const { props, inventory } = mount([task('Alpha'), task('Beta', { enabled: false })]);
    expect(screen.getByText('1 enabled · 1 off')).toBeTruthy();
    expect(within(inventory()).getByText('off')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Off' }).getAttribute('value')).toBe('paused');
    fireEvent.click(screen.getAllByLabelText('Disable Alpha')[0]!);
    expect(props.onToggle).toHaveBeenCalledOnce();
    expect(screen.getAllByLabelText('Enable Beta').length).toBeGreaterThan(0);
  });
  it('reviews attention schedules without changing their enabled state', () => {
    const { props, inventory } = mount([task('Missing', { projectId: 'gone' }), withRun('Failed', 'error'), task('Healthy')]);
    expect(screen.getByText('2 schedules need attention')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review schedules' }));
    expect(within(inventory()).getByText('Failed')).toBeTruthy();
    expect(within(inventory()).queryByText('Healthy')).toBeNull();
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(inventory());
  });
  it('paginates the inventory, resets on filters, and offers recovery from no matches', () => {
    const { inventory } = mount(Array.from({ length: 18 }, (_, i) => task(`Job ${String(i).padStart(2, '0')}`)));
    expect(within(inventory()).getAllByRole('checkbox')).toHaveLength(8);
    expect(screen.getByText('1–8 of 18 schedules')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    expect(screen.getByText('9–16 of 18 schedules')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Job 17' } });
    expect(within(inventory()).getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'paused' } });
    expect(screen.getByText('No schedules match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('1–8 of 18 schedules')).toBeTruthy();
  });
  it('clamps a page after schedules disappear', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task(`Job ${i}`));
    const { props, rerender } = mount(tasks);
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    rerender(<SchedulerOverview {...props} tasks={tasks.slice(0, 2)} />);
    expect(screen.getByText('1–2 of 2 schedules')).toBeTruthy();
  });
  it('limits upcoming and activity to five and exposes full run messages', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task(`Job ${i}`, { status: {
      runCount: 1, nextRunAt: new Date(Date.now() + i * 60000).toISOString(),
      runs: [{ at: new Date(Date.now() - i * 60000).toISOString(), result: 'error', message: `Full failure explanation ${i}`, durationMs: 1500 }]
    } }));
    const { container, props } = mount(tasks);
    expect(container.querySelectorAll('.overview-columns section:first-child li')).toHaveLength(5);
    expect(container.querySelectorAll('.overview-activity-item')).toHaveLength(5);
    const details = screen.getByText('Full failure explanation 0').closest('details')!;
    fireEvent.click(within(details).getByText('Run details'));
    expect(details.open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'View schedules' }));
    expect(props.onBrowse).toHaveBeenCalledOnce();
    fireEvent.click(container.querySelector('.overview-activity-item .overview-item-main')!);
    expect(props.onJump).toHaveBeenCalledWith(tasks[0]);
  });
  it('preserves per-schedule run, toggle, edit and report actions using task identity', () => {
    const a = withRun('a', 'success', { report: 'Report A', at: '2026-01-02T00:00:00.000Z' }); a.name = 'Duplicate';
    const b = withRun('b', 'success', { report: 'Report B', at: '2026-01-01T00:00:00.000Z' }); b.name = 'Duplicate'; b.enabled = false;
    const { props, inventory } = mount([a, b]);
    const rows = within(inventory()).getAllByRole('listitem');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'View last report for Duplicate' }));
    expect(props.onShowReport).toHaveBeenCalledWith(b.status!.runs[0], b);
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Run Duplicate' }));
    expect(props.onRunNow).toHaveBeenCalledWith(a);
    fireEvent.click(within(rows[1]).getByRole('checkbox'));
    expect(props.onToggle).toHaveBeenCalledWith(b);
    fireEvent.click(within(rows[0]).getByTitle('Edit schedule'));
    expect(props.onEdit).toHaveBeenCalledWith(a);
    fireEvent.click(screen.getAllByTitle('View run report')[0]);
    expect(props.onShowReport).toHaveBeenCalledWith(a.status!.runs[0], a);
  });
  it('shows working and finished live sessions, including an older run behind a skip', () => {
    state.terminals = { p1: [{ id: 'live', status: 'running' }, { id: 'done', status: 'starting' }, { id: 'dead', status: 'exited' }] };
    const running = withRun('Running', 'success', { sessionId: 'live' });
    running.status!.runs.unshift({ at: new Date().toISOString(), result: 'skipped' });
    const done = withRun('Finished', 'success', { sessionId: 'done', finishedAt: new Date().toISOString() });
    const { props, inventory } = mount([running, done]);
    fireEvent.click(screen.getByRole('button', { name: 'Open running terminal' }));
    expect(props.onOpenTerminal).toHaveBeenCalledWith(running, 'live');
    fireEvent.click(screen.getByRole('button', { name: 'Open session', exact: true }));
    expect(props.onOpenTerminal).toHaveBeenCalledWith(done, 'done');
    fireEvent.click(within(inventory()).getByRole('button', { name: 'Open live run for Running' }));
    fireEvent.click(within(inventory()).getByRole('button', { name: 'Stop live run for Running' }));
    expect(props.onStopLive).toHaveBeenCalledWith(running, 'live');
  });
  it('keeps external schedules read-only and renders empty, invalid-date and project states', () => {
    const external = task('External', { external: { kind: 'claude-loop' } as ScheduledTask['external'], enabled: false, status: { runCount: 1, lastRunAt: 'invalid', nextRunAt: 'invalid', runs: [{ at: 'invalid', result: 'skipped' }] } });
    const { props, inventory, rerender } = mount([external]);
    expect(within(inventory()).queryByRole('checkbox')).toBeNull();
    expect(within(inventory()).queryByTitle('Run now')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Garden' }));
    expect(props.onOpenProject).toHaveBeenCalledWith('p1');
    rerender(<SchedulerOverview {...props} tasks={[]} hideByProject />);
    expect(screen.getByText('No schedules yet.')).toBeTruthy();
    expect(screen.queryByText('By project')).toBeNull();
    expect(screen.getByText('No runs recorded yet.')).toBeTruthy();
  });

  it('opens Problems from the banner and counts open problems in the KPI', () => {
    const missed = task('Missed', { status: { runCount: 0, runs: [{ id: 'm', at: new Date().toISOString(), result: 'skipped', reasonCode: 'missed-asleep' }] } });
    const { props } = mount([withRun('Failed', 'error', { id: 'f' }), missed, task('Missing', { projectId: 'gone' })], { onReviewProblems: vi.fn() });
    expect(screen.getByText('3 schedules need attention')).toBeTruthy();
    expect(screen.getByText(/2 with open problems\./)).toBeTruthy();
    expect(screen.getByText(/1 with a missing project\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review problems' }));
    expect(props.onReviewProblems).toHaveBeenCalledOnce();
    expect(screen.getByText('Open problems')).toBeTruthy();
    expect(screen.getByText('1 failed · 1 missed · 0 skipped')).toBeTruthy();
  });
  it('does not flag a schedule whose older failure a later finished success closed (upgrade case)', () => {
    const healed = task('Healed', { status: { runCount: 2, runs: [
      { id: 'ok', at: new Date().toISOString(), result: 'success', durationMs: 10 },
      { id: 'f', at: new Date(Date.now() - 3_600_000).toISOString(), result: 'error', message: 'exit 1' }
    ] } });
    mount([healed]);
    expect(screen.queryByText(/need(s)? attention/)).toBeNull();
    expect(screen.getByText('0 failed · 0 missed · 0 skipped')).toBeTruthy();
  });
  it('keeps Review schedules when only a project is missing', () => {
    mount([task('Missing', { projectId: 'gone' })], { onReviewProblems: vi.fn() });
    expect(screen.getByRole('button', { name: 'Review schedules' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review problems' })).toBeNull();
  });
  it('offers the recovery card and routes Review to the dialog callback', async () => {
    config.get.mockResolvedValue({});
    const { props } = mount([task('Classic')], { onTurnOnRecovery: vi.fn() });
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(props.onTurnOnRecovery).toHaveBeenCalledOnce();
  });
});

describe('SchedulerOverview Resume this run', () => {
  const conversation = { profile: 'claude', id: 'conv-1', cwd: '/p', startedAt: '2026-01-01T00:00:00Z' };
  const resumable = (id: string, extras: Partial<ScheduledTask> = {}) =>
    ({ ...withRun(id, 'success', { id: `${id}-run`, sessionId: `${id}-pty`, conversation } as Partial<ScheduleRun>), ...extras });

  it('offers the icon on closed resumable runs only and passes the task and run id', () => {
    const idless = { ...withRun('Idless', 'success', { id: undefined, sessionId: 'idless-pty', conversation } as Partial<ScheduleRun>) };
    const { props } = mount([resumable('Alpha'), withRun('Plain', 'success'), resumable('Squad', { kind: 'team' }), idless], { onResumeRun: vi.fn() });
    const buttons = screen.getAllByRole('button', { name: 'Resume this run' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(props.onResumeRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'Alpha' }), 'Alpha-run');
  });

  it('hides the icon while the run\'s session is still open, or when no handler is wired', () => {
    state.terminals = { p1: [{ id: 'Alpha-pty', status: 'running' }] };
    mount([resumable('Alpha')], { onResumeRun: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Resume this run' })).toBeNull();
    cleanup();
    state.terminals = {};
    mount([resumable('Alpha')]);
    expect(screen.queryByRole('button', { name: 'Resume this run' })).toBeNull();
  });
});
