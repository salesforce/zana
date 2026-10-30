/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  terminals: {} as Record<string, Array<{ id: string; status?: string }>>,
  pushToast: vi.fn(), retryRuns: vi.fn(), dismissRuns: vi.fn()
}));
vi.mock('../../lib/product-client.js', () => ({ product: { scheduler: { retryRuns: h.retryRuns, dismissRuns: h.dismissRuns } } }));
vi.mock('../../store.js', () => ({
  useData: (select: (s: { terminals: typeof h.terminals }) => unknown) => select({ terminals: h.terminals }),
  useUi: (select: (s: { pushToast: typeof h.pushToast }) => unknown) => select({ pushToast: h.pushToast })
}));
import { ProblemsPanel } from './ProblemsPanel.js';

const projects = new Map([['p1', { id: 'p1', name: 'Garden' } as Project], ['p2', { id: 'p2', name: 'Shop' } as Project]]);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 3600_000;
const make = (id: string, runs: Partial<ScheduleRun>[], over: Partial<ScheduledTask> = {}) => ({
  id, name: id, projectId: 'p1', enabled: true, profile: 'claude', schedule: { every: '1h' }, overlap: 'skip',
  history: { retain: 10 }, createdAt: '', updatedAt: '', catchUp: { mode: 'once' },
  status: { runCount: runs.length, runs }, ...over
}) as unknown as ScheduledTask;
const failed = (id: string, over: Partial<ScheduleRun> = {}): Partial<ScheduleRun> => ({ id, at: ago(HOUR), result: 'error', reasonCode: 'exit-nonzero', ...over });

function mount(tasks: ScheduledTask[], extra: Record<string, unknown> = {}) {
  const props = { tasks, projects, onOpenSchedule: vi.fn(), onOpenSession: vi.fn(), onTurnOnRecovery: vi.fn(), ...extra };
  render(<ProblemsPanel {...props} />);
  return props;
}
const sel = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;
const rowCount = () => document.querySelectorAll('tbody tr').length;

beforeEach(() => {
  h.terminals = {};
  h.pushToast.mockReset();
  h.retryRuns.mockReset().mockResolvedValue({ ok: true, value: [] });
  h.dismissRuns.mockReset().mockResolvedValue({ ok: true, value: 0 });
});
afterEach(cleanup);

describe('ProblemsPanel', () => {
  it('is a region and shows the healthy empty state only for the unfiltered Open view', () => {
    mount([make('ok', [{ id: 'a', at: ago(HOUR), result: 'success' }]), make('Old', [failed('o', { at: ago(3 * 24 * HOUR) })])]);
    const region = screen.getByRole('region', { name: 'Problems' });
    expect(region.className).toBe('problems-workbench');
    // Range narrows the view: an older open problem exists, so it isn't "healthy".
    fireEvent.change(sel('Range'), { target: { value: '24h' } });
    expect(screen.getByText('No runs match these filters.')).toBeTruthy();
    cleanup();
    mount([make('ok', [{ id: 'a', at: ago(HOUR), result: 'success' }])]);
    expect(screen.getByText('No open problems. Self-healing handled everything.')).toBeTruthy();
  });

  it('uses the styled overview controls for the filter bar', () => {
    mount([make('A', [failed('r1')])]);
    expect(document.querySelector('.schedule-filters.problems-filters')).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search schedules' }).closest('label')!.className).toBe('schedule-search');
    const missed = within(screen.getByRole('group', { name: 'Outcome' })).getByRole('button', { name: 'Missed' });
    expect(missed.className).toBe('inbox-filter-chip');
    fireEvent.click(missed);
    expect(missed.className).toBe('inbox-filter-chip on');
    expect(document.querySelector('td > .problems-actions')).toBeNull();
  });

  it('lists open problems with schedule, project, outcome and attempts', () => {
    const props = mount([make('Nightly', [failed('r1', { attempt: 2 })], { retry: { attempts: 2, delayMinutes: 5 } })]);
    const row = document.querySelector('tbody tr') as HTMLElement;
    expect(within(row).getByText('Garden')).toBeTruthy();
    expect(within(row).getByText('Error')).toBeTruthy();
    expect(within(row).getByText('2/3')).toBeTruthy();
    expect(row.querySelector('time')!.getAttribute('title')).toMatch(/^\d{4}-/);
    expect(row.querySelector('time')!.getAttribute('dateTime')).toMatch(/^\d{4}-/);
    fireEvent.click(within(row).getByRole('button', { name: 'Nightly' }));
    expect(props.onOpenSchedule).toHaveBeenCalledWith('Nightly');
  });

  it('shows every open problem by default, including ones days old (matches the banner count)', () => {
    mount([make('Old', [failed('r1', { at: ago(5 * 24 * HOUR) })]), make('New', [failed('r2')])]);
    expect(sel('Range').value).toBe('all');
    expect(rowCount()).toBe(2);
  });

  it('filters by state, outcome, range, project and search', () => {
    mount([
      make('Err', [failed('e')]),
      make('Missed', [{ id: 'm', at: ago(2 * HOUR), result: 'skipped', reasonCode: 'missed-asleep' }], { projectId: 'p2' }),
      make('Old', [failed('o', { at: ago(3 * 24 * HOUR) })]),
      make('Fine', [{ id: 'f', at: ago(HOUR), result: 'success' }]),
      make('Dismissed', [failed('d', { dismissedAt: ago(1000) })])
    ]);
    expect(rowCount()).toBe(3);
    fireEvent.change(sel('Range'), { target: { value: '7d' } });
    expect(rowCount()).toBe(3);
    fireEvent.change(sel('Range'), { target: { value: '24h' } });
    expect(rowCount()).toBe(2);
    fireEvent.change(sel('Show'), { target: { value: 'problems' } });
    expect(rowCount()).toBe(3);
    fireEvent.change(sel('Show'), { target: { value: 'all' } });
    expect(rowCount()).toBe(4);
    fireEvent.click(within(screen.getByRole('group', { name: 'Outcome' })).getByRole('button', { name: 'Missed' }));
    expect(rowCount()).toBe(1);
    fireEvent.click(within(screen.getByRole('group', { name: 'Outcome' })).getByRole('button', { name: 'Missed' }));
    fireEvent.change(sel('Project'), { target: { value: 'p2' } });
    expect(rowCount()).toBe(1);
    fireEvent.change(sel('Project'), { target: { value: '' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search schedules' }), { target: { value: 'ERR' } });
    expect(rowCount()).toBe(1);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search schedules' }), { target: { value: 'nothing' } });
    expect(screen.getByText('No runs match these filters.')).toBeTruthy();
  });

  it('paginates at 25', () => {
    mount([make('Many', Array.from({ length: 30 }, (_, i) => failed(`r${i}`, { at: ago(HOUR + i * 1000) })))]);
    expect(rowCount()).toBe(25);
    expect(screen.getByRole('status').textContent).toBe('1–25 of 30 runs');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(rowCount()).toBe(5);
    expect(screen.getByRole('status').textContent).toBe('26–30 of 30 runs');
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(rowCount()).toBe(25);
  });

  it('retries a row, labels missed rows Run now, and reports the summary', async () => {
    h.retryRuns.mockResolvedValue({ ok: true, value: [{ scheduleId: 'A', runId: 'r1', ok: true, status: 'started' }] });
    mount([make('A', [failed('r1')]), make('B', [{ id: 'm', at: ago(HOUR), result: 'skipped', reasonCode: 'missed-asleep' }])]);
    expect(screen.getByRole('button', { name: /^Run now B run from / })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Retry A run from / }));
    await vi.waitFor(() => expect(h.pushToast).toHaveBeenCalledWith('1 started', 'info'));
    expect(h.retryRuns).toHaveBeenCalledWith([{ scheduleId: 'A', runId: 'r1' }]);
  });

  it('shows the server reason when a single retry fails, and a thrown call too', async () => {
    h.retryRuns.mockResolvedValueOnce({ ok: true, value: [{ scheduleId: 'A', runId: 'r1', ok: false, error: 'enable the schedule to catch up missed runs' }] });
    mount([make('A', [failed('r1')])]);
    fireEvent.click(screen.getByRole('button', { name: /^Retry A run from / }));
    await vi.waitFor(() => expect(h.pushToast).toHaveBeenCalledWith('Run failed: enable the schedule to catch up missed runs', 'error'));
    await vi.waitFor(() => expect((screen.getByRole('button', { name: /^Retry A run from / }) as HTMLButtonElement).disabled).toBe(false));
    h.retryRuns.mockRejectedValueOnce(new Error('ipc down'));
    fireEvent.click(screen.getByRole('button', { name: /^Retry A run from / }));
    await vi.waitFor(() => expect(h.pushToast).toHaveBeenCalledWith('Run failed: ipc down', 'error'));
    await vi.waitFor(() => expect((screen.getByRole('button', { name: /^Dismiss A run from / }) as HTMLButtonElement).disabled).toBe(false));
    h.dismissRuns.mockRejectedValueOnce(new Error('gone'));
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss A run from / }));
    await vi.waitFor(() => expect(h.pushToast).toHaveBeenCalledWith('Dismiss failed: gone', 'error'));
  });

  it('hides Run now on a missed marker of a paused schedule', () => {
    const marker = { id: 'm', at: ago(HOUR), result: 'skipped', reasonCode: 'missed-app-closed', marker: true } as Partial<ScheduleRun>;
    mount([make('Paused', [marker], { enabled: false }), make('On', [{ ...marker, id: 'n' }])]);
    expect(screen.queryByRole('button', { name: /^Run now Paused run/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Run now On run/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Dismiss Paused run/ })).toBeTruthy();
  });

  it('shows the attempt alone once manual retries pass the policy', () => {
    mount([make('Over', [failed('r1', { attempt: 4 })], { retry: { attempts: 2, delayMinutes: 5 } })]);
    const row = document.querySelector('tbody tr') as HTMLElement;
    expect(within(row).getByText('4')).toBeTruthy();
    expect(within(row).queryByText('4/3')).toBeNull();
    expect(within(row).getByText('Attempt 4')).toBeTruthy();
  });

  it('searches schedules before the 500-row cap and marks a truncated list', () => {
    const many = Array.from({ length: 501 }, (_, i) => failed(`r${i}`, { at: ago(HOUR + i * 1000) }));
    mount([make('Busy', many), make('Rare', [failed('x', { at: ago(5 * 24 * HOUR) })])]);
    expect(screen.getByRole('status').textContent).toBe('1–25 of 500+ runs');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search schedules' }), { target: { value: 'rare' } });
    expect(rowCount()).toBe(1);
    expect(screen.getByRole('status').textContent).toBe('1–1 of 1 runs');
  });

  it('hides Retry for non-retryable, id-less and closed rows; Dismiss only when open', () => {
    mount([
      make('Overlap', [{ id: 'o', at: ago(HOUR), result: 'error', reasonCode: 'overlap' }]),
      make('NoId', [{ at: ago(HOUR), result: 'error', reasonCode: 'exit-nonzero' }]),
      make('Closed', [failed('c', { dismissedAt: ago(10) })])
    ]);
    fireEvent.change(sel('Show'), { target: { value: 'problems' } });
    expect(screen.queryByRole('button', { name: /Retry Overlap/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry NoId/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Dismiss NoId/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry Closed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Dismiss Closed/ })).toBeNull();
    expect((screen.getByRole('checkbox', { name: /^Select NoId run from / }) as HTMLInputElement).disabled).toBe(true);
  });

  it('opens a session only while it is still listed', () => {
    h.terminals = { p1: [{ id: 'live' }] };
    const props = mount([make('Live', [failed('a', { sessionId: 'live' })]), make('Gone', [failed('b', { sessionId: 'gone' })])]);
    expect(screen.queryByRole('button', { name: /^Open session for Gone run/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Open session for Live run from / }));
    expect(props.onOpenSession).toHaveBeenCalledWith('live', 'p1');
  });

  it('dismisses a row and summarises failures', async () => {
    h.dismissRuns.mockResolvedValueOnce({ ok: true, value: 1 }).mockResolvedValueOnce({ ok: false, message: 'x' });
    mount([make('A', [failed('r1')])]);
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss A run from / }));
    await vi.waitFor(() => expect(h.pushToast).toHaveBeenCalledWith('1 dismissed', 'info'));
    await vi.waitFor(() => expect((screen.getByRole('button', { name: /^Dismiss A run from / }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss A run from / }));
    await vi.waitFor(() => expect(h.pushToast).toHaveBeenCalledWith('Dismiss failed: x', 'error'));
  });

  it('bulk retry sends one ref per schedule (the newest), in batches of 50, like the server keeps one retry each', async () => {
    // 120 schedules, each with 2 open problems: one retry per schedule is what will run.
    const tasks = Array.from({ length: 120 }, (_, i) => make(`S${i}`, [
      failed(`new${i}`, { at: ago(HOUR + i * 1000) }),
      failed(`old${i}`, { at: ago(2 * HOUR + i * 1000) })
    ]));
    // Server-like: a second ref of the same schedule would replace the first.
    h.retryRuns.mockImplementation(async (refs: Array<{ scheduleId: string; runId: string }>) => {
      const seen = new Set<string>();
      return {
        ok: true,
        value: refs.map((r, i) => {
          const replaced = seen.has(r.scheduleId);
          seen.add(r.scheduleId);
          return replaced
            ? { ...r, ok: false, error: 'replaced by a newer retry' }
            : { ...r, ok: i % 10 !== 0, status: i % 2 ? 'queued' : 'started', ...(i % 10 === 0 ? { error: 'x' } : {}) };
        })
      };
    });
    mount(tasks);
    expect((screen.getByRole('button', { name: 'Retry selected' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry all retryable (120)' }));
    await vi.waitFor(() => expect(h.retryRuns).toHaveBeenCalledTimes(3));
    expect(h.retryRuns.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20]);
    const sent = h.retryRuns.mock.calls.flatMap((c) => c[0]);
    expect(new Set(sent.map((r: { scheduleId: string }) => r.scheduleId)).size).toBe(120);
    expect(sent.every((r: { runId: string }) => r.runId.startsWith('new'))).toBe(true);
    const [message, kind] = h.pushToast.mock.calls[0]!;
    // Only the server's own failures (every 10th), never "replaced" ones.
    expect(message).toMatch(/^\d+ started, \d+ queued, 12 failed$/);
    expect(kind).toBe('error');
  });

  it('retries and dismisses only the selected rows, counting failed batches', async () => {
    h.retryRuns.mockResolvedValue({ ok: false, message: 'nope' });
    mount([make('A', [failed('r1')]), make('B', [failed('r2')])]);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Select A run from / }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry selected' }));
    await vi.waitFor(() => expect(h.pushToast).toHaveBeenCalledWith('Run failed: nope', 'error'));
    expect(h.retryRuns).toHaveBeenCalledWith([{ scheduleId: 'A', runId: 'r1' }]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    h.dismissRuns.mockResolvedValue({ ok: true, value: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    await vi.waitFor(() => expect(h.pushToast).toHaveBeenCalledWith('2 dismissed', 'info'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
  });

  it('offers Turn on recovery only for schedules without recovery', () => {
    const props = mount([make('Classic', [], { catchUp: undefined }), make('Ext', [], { external: { kind: 'claude-loop' } as ScheduledTask['external'], catchUp: undefined })]);
    fireEvent.click(screen.getByRole('button', { name: '1 schedule without recovery · Turn on recovery' }));
    expect(props.onTurnOnRecovery).toHaveBeenCalledOnce();
    cleanup();
    mount([make('Recovery', [])]);
    expect(screen.queryByText(/Turn on recovery/)).toBeNull();
  });

  describe('Resume', () => {
    const conversation = { profile: 'claude', id: 'conv-1', cwd: '/p', startedAt: ago(HOUR) };
    const resumableFailure = (id: string, over: Partial<ScheduleRun> = {}) => failed(id, { sessionId: `${id}-pty`, conversation, ...over } as Partial<ScheduleRun>);

    it('shows Resume only on a closed resumable row, and passes the task and run id', () => {
      const onResumeRun = vi.fn();
      mount([make('A', [resumableFailure('r1')]), make('B', [failed('r2', { sessionId: 'x' })])], { onResumeRun });
      const buttons = screen.getAllByRole('button', { name: /^Resume / });
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.textContent?.trim()).toBe('Resume');
      expect(buttons[0]!.querySelector('svg')).not.toBeNull();
      fireEvent.click(buttons[0]!);
      expect(onResumeRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'A' }), 'r1');
    });

    it('keeps Open session for a live row instead of Resume', () => {
      h.terminals = { p1: [{ id: 'r1-pty', status: 'running' }] };
      mount([make('A', [resumableFailure('r1')])], { onResumeRun: vi.fn() });
      expect(screen.queryByRole('button', { name: /^Resume / })).toBeNull();
      expect(screen.getByRole('button', { name: /^Open session / })).toBeTruthy();
    });

    it('offers Resume when the run tab is still listed but has exited, like the Overview and schedule panel do', () => {
      h.terminals = { p1: [{ id: 'r1-pty', status: 'exited' }] };
      mount([make('A', [resumableFailure('r1')])], { onResumeRun: vi.fn() });
      expect(screen.getByRole('button', { name: /^Resume / })).toBeTruthy();
    });

    it('never shows for Squads, markers or without a handler', () => {
      mount([make('Squad', [resumableFailure('r1')], { kind: 'team' })], { onResumeRun: vi.fn() });
      expect(screen.queryByRole('button', { name: /^Resume / })).toBeNull();
      cleanup();
      mount([make('A', [resumableFailure('r1')])]);
      expect(screen.queryByRole('button', { name: /^Resume / })).toBeNull();
    });
  });
});
