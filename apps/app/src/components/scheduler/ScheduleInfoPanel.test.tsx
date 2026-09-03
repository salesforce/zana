/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask, TerminalSession } from '@zana-ai/zcc-domain/product';

const setEnabled = vi.fn();
const runNow = vi.fn();
const close = vi.fn();
const openScheduledLive = vi.fn();
const openScheduledLiveInSplit = vi.fn();
const pushToast = vi.fn();

const terminals: Record<string, TerminalSession[]> = {};

vi.mock('../../lib/product-client.js', () => ({
  product: {
    scheduler: {
      setEnabled: (...args: unknown[]) => setEnabled(...args),
      runNow: (...args: unknown[]) => runNow(...args)
    },
    terminals: { close: (...args: unknown[]) => close(...args) }
  }
}));

vi.mock('../../store.js', () => ({
  useData: (selector: (s: { terminals: Record<string, TerminalSession[]> }) => unknown) =>
    selector({ terminals }),
  useUi: Object.assign(
    (selector: (s: { pushToast: typeof pushToast }) => unknown) => selector({ pushToast }),
    { getState: () => ({ pushToast }) }
  )
}));

vi.mock('./openScheduledLive.js', () => ({
  openScheduledLive: (...args: unknown[]) => openScheduledLive(...args),
  openScheduledLiveInSplit: (...args: unknown[]) => openScheduledLiveInSplit(...args)
}));

import { ScheduleInfoPanel } from './ScheduleInfoPanel.js';

const baseTask = {
  id: 'sched-1',
  name: 'Morning digest',
  enabled: true,
  projectId: 'p1',
  profile: 'claude',
  schedule: { every: '1h' },
  overlap: 'skip',
  history: { retain: 10 },
  status: { runCount: 0, runs: [], lastRunAt: null, nextRunAt: null },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
} as ScheduledTask;

describe('ScheduleInfoPanel', () => {
  afterEach(() => {
    cleanup();
    setEnabled.mockReset();
    runNow.mockReset();
    close.mockReset();
    openScheduledLive.mockReset();
    openScheduledLiveInSplit.mockReset();
    pushToast.mockReset();
    for (const key of Object.keys(terminals)) delete terminals[key];
  });

  it('asks the user to save before showing run history', () => {
    render(
      <ScheduleInfoPanel
        task={null}
        navigate={() => undefined}
        currentPathname="/schedules/new"
      />
    );
    expect(screen.getByTestId('schedule-info-panel').textContent).toContain(
      'Save this schedule to start recording runs.'
    );
  });

  it('shows status, run history, and mutating footer actions', async () => {
    const onDuplicate = vi.fn();
    const onAskDelete = vi.fn();
    runNow.mockResolvedValue({ ok: true });
    setEnabled.mockResolvedValue({ ok: true });
    const task = {
      ...baseTask,
      status: {
        runCount: 1,
        lastRunAt: '2026-01-01T00:00:00Z',
        lastRunResult: 'ok',
        nextRunAt: new Date(Date.now() + 60_000).toISOString(),
        runs: [
          {
            at: '2026-01-01T00:00:00Z',
            result: 'ok',
            durationMs: 1200,
            report: '# Done'
          }
        ]
      }
    } as ScheduledTask;
    render(
      <ScheduleInfoPanel
        task={task}
        onDuplicate={onDuplicate}
        onAskDelete={onAskDelete}
        navigate={() => undefined}
        currentPathname="/schedules/sched-1"
      />
    );
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByTestId('schedule-run-report').textContent).toContain('Done');
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await vi.waitFor(() => expect(runNow).toHaveBeenCalledWith('sched-1'));
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    await vi.waitFor(() => expect(setEnabled).toHaveBeenCalledWith('sched-1', false));
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }));
    expect(onDuplicate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onAskDelete).toHaveBeenCalled();
  });

  it('opens a live session in split from the info panel', () => {
    terminals.p1 = [{ id: 'sess-1', status: 'running' } as TerminalSession];
    const navigate = vi.fn();
    const task = {
      ...baseTask,
      status: {
        runCount: 1,
        runs: [{ at: '2026-01-01T00:00:00Z', result: 'ok', sessionId: 'sess-1' }]
      }
    } as ScheduledTask;
    render(
      <ScheduleInfoPanel
        task={task}
        navigate={navigate}
        currentPathname="/schedules/sched-1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open live in split' }));
    expect(openScheduledLiveInSplit).toHaveBeenCalledWith(
      'p1',
      'sess-1',
      navigate,
      '/schedules/sched-1'
    );
    fireEvent.click(screen.getByLabelText('Peek running terminal'));
    expect(openScheduledLive).toHaveBeenCalledWith('p1', 'sess-1');
  });

  it('hides mutating actions for external claude-loop schedules', () => {
    const task = {
      ...baseTask,
      external: { kind: 'claude-loop' }
    } as ScheduledTask;
    render(
      <ScheduleInfoPanel
        task={task}
        onDuplicate={() => undefined}
        onAskDelete={() => undefined}
        navigate={() => undefined}
        currentPathname="/schedules/sched-1"
      />
    );
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
  });

  it('stops a live session and surfaces failures', async () => {
    terminals.p1 = [{ id: 'sess-1', status: 'running' } as TerminalSession];
    close.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const task = {
      ...baseTask,
      status: {
        runCount: 1,
        runs: [{ at: '2026-01-01T00:00:00Z', result: 'ok', sessionId: 'sess-1' }]
      }
    } as ScheduledTask;
    const { rerender } = render(
      <ScheduleInfoPanel
        task={task}
        navigate={() => undefined}
        currentPathname="/schedules/sched-1"
      />
    );
    fireEvent.click(screen.getByLabelText('Stop running terminal'));
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith('sess-1'));
    expect(pushToast).toHaveBeenCalledWith('Stopped "Morning digest"', 'info');

    rerender(
      <ScheduleInfoPanel
        task={task}
        navigate={() => undefined}
        currentPathname="/schedules/sched-1"
      />
    );
    fireEvent.click(screen.getByLabelText('Stop running terminal'));
    await vi.waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith('Failed to stop "Morning digest"', 'error')
    );
  });

  it('toasts when run-now or pause fail', async () => {
    runNow.mockResolvedValue({ ok: false, message: 'busy' });
    setEnabled.mockResolvedValue({ ok: false, message: 'denied' });
    render(
      <ScheduleInfoPanel
        task={{ ...baseTask, enabled: false } as ScheduledTask}
        navigate={() => undefined}
        currentPathname="/schedules/sched-1"
      />
    );
    expect(screen.getByText('Paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Run failed: busy', 'error'));
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('denied', 'error'));
  });
});
