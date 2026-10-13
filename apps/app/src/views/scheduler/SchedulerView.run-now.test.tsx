/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

const runNow = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());
const tasks = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../../lib/product-client.js', () => ({
  product: { scheduler: { runNow: (...a: unknown[]) => runNow(...a), setEnabled: vi.fn(), delete: vi.fn() }, terminals: { close: vi.fn() } }
}));
vi.mock('@/store', () => {
  const ui = { setNav: vi.fn(), revealScheduleId: null, pushToast, clearRevealSchedule: vi.fn(), enterProjectFocus: vi.fn(), setProjectView: vi.fn() };
  return {
    useScheduler: (sel: (s: unknown) => unknown) => sel({ tasks: tasks.current, loading: false }),
    useData: (sel: (s: unknown) => unknown) => sel({ projects: [{ id: 'p1', name: 'Demo' }] }),
    useScheduleGroups: (sel: (s: unknown) => unknown) => sel({ groups: [] }),
    useUi: Object.assign((sel: (s: unknown) => unknown) => sel(ui), { getState: () => ui })
  };
});
vi.mock('@/hooks/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('@/hooks/useIsCompactViewport', () => ({ isCompactViewport: () => false }));
vi.mock('@/components/MobilePageHeader', () => ({ MobilePageHeader: () => null }));
vi.mock('@/components/AuroraGrid', () => ({ AuroraGrid: () => null }));
vi.mock('@/components/scheduler/openScheduledLive', () => ({ openScheduledLive: vi.fn() }));
vi.mock('@/components/ScheduleGroupsModal', () => ({ ScheduleGroupsModal: () => null }));
vi.mock('@/components/scheduler/TemplatePickerModal', () => ({ TemplatePickerModal: () => null }));
vi.mock('@/components/scheduler/DeleteConfirmModal', () => ({ DeleteConfirmModal: () => null }));
vi.mock('@/components/scheduler/EmptyStateWithFeatured', () => ({ EmptyStateWithFeatured: () => null }));
vi.mock('@/components/scheduler/SchedulerOverview', () => ({
  SchedulerOverview: ({ tasks: list, onRunNow }: { tasks: ScheduledTask[]; onRunNow: (t: ScheduledTask) => void }) => (
    <button type="button" onClick={() => onRunNow(list[0]!)}>overview-run</button>
  )
}));

import { SchedulerView } from './SchedulerView.js';

const task = (runs: Array<Record<string, unknown>> = []) => ({
  id: 's1', name: 'Nightly', enabled: true, projectId: 'p1', profile: 'claude', schedule: { every: '1h' },
  overlap: 'skip', history: { retain: 10 }, status: { runCount: 0, runs },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
}) as unknown as ScheduledTask;

const mount = () => {
  tasks.current = [task()];
  render(<MemoryRouter><SchedulerView /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'overview-run' }));
};

afterEach(() => { cleanup(); runNow.mockReset(); pushToast.mockReset(); });

describe('SchedulerView run now outcome', () => {
  it('toasts a transport failure', async () => {
    runNow.mockResolvedValue({ ok: false, message: 'denied' });
    mount();
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Run failed: denied', 'error'));
  });

  it('toasts the recorded cause of a refused launch instead of fired', async () => {
    runNow.mockResolvedValue({ ok: true, value: task([{ at: 'x', result: 'error', message: 'no capacity' }]) });
    mount();
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Run failed: no capacity', 'error'));
    expect(pushToast).not.toHaveBeenCalledWith('Fired "Nightly"', 'info');
  });

  it('toasts fired on success', async () => {
    runNow.mockResolvedValue({ ok: true, value: task([{ at: 'x', result: 'success' }]) });
    mount();
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Fired "Nightly"', 'info'));
  });
});
