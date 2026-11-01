/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  projects: [{ id: 'p1', name: 'Garden' }, { id: 'p2', name: 'Shop' }],
  panelProps: null as null | Record<string, any>,
  overviewProps: null as null | Record<string, any>,
  openLive: vi.fn(),
  loading: false,
  resume: vi.fn(),
  setEnabled: vi.fn()
}));

vi.mock('../../lib/product-client.js', () => ({ product: { scheduler: { setEnabled: h.setEnabled }, terminals: {}, config: { get: vi.fn(), set: vi.fn() } } }));
vi.mock('@/store', () => {
  const ui = { setNav: vi.fn(), revealScheduleId: null, clearRevealSchedule: vi.fn() };
  const useUi: any = (select: (s: typeof ui) => unknown) => select(ui);
  useUi.getState = () => ui;
  return {
    useData: (select: (s: { projects: unknown[] }) => unknown) => select({ projects: h.projects }),
    useScheduler: (select: (s: { tasks: unknown[]; loading: boolean }) => unknown) => select({ tasks: h.tasks, loading: h.loading }),
    useScheduleGroups: (select: (s: { groups: unknown[] }) => unknown) => select({ groups: [] }),
    useUi
  };
});
vi.mock('@/hooks/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('@/hooks/useIsCompactViewport', () => ({ isCompactViewport: () => false }));
vi.mock('@/components/MobilePageHeader', () => ({ MobilePageHeader: () => null }));
vi.mock('@/components/AuroraGrid', () => ({ AuroraGrid: () => null }));
vi.mock('@/components/ScheduleGroupsModal', () => ({ ScheduleGroupsModal: () => null }));
vi.mock('@/components/scheduler/EmptyStateWithFeatured', () => ({ EmptyStateWithFeatured: () => <div>empty</div> }));
vi.mock('@/components/scheduler/ScheduleRow', () => ({ ScheduleRow: () => null }));
vi.mock('@/components/scheduler/DeleteConfirmModal', () => ({ DeleteConfirmModal: () => null }));
vi.mock('@/components/scheduler/TemplatePickerModal', () => ({ TemplatePickerModal: () => null }));
vi.mock('@/components/scheduler/ScheduleFilters', () => ({
  ScheduleFilters: ({ onSearch }: { onSearch: (v: string) => void }) => <button onClick={() => onSearch('zzz-no-match')}>search nothing</button>
}));
vi.mock('@/components/scheduler/openScheduledLive', () => ({ openScheduledLive: h.openLive }));
vi.mock('@/components/scheduler/resumeScheduledRun', () => ({ resumeScheduledRun: h.resume }));
vi.mock('@/components/scheduler/SchedulerOverview', () => ({
  SchedulerOverview: (props: Record<string, any>) => { h.overviewProps = props; return <div data-testid="overview">overview {props.tasks.length}</div>; }
}));
vi.mock('@/components/scheduler/ProblemsPanel', () => ({
  ProblemsPanel: (props: Record<string, any>) => { h.panelProps = props; return <div data-testid="problems">problems {props.tasks.length}</div>; }
}));
vi.mock('@/components/scheduler/RecoveryOptIn', () => ({
  RecoveryDialog: ({ tasks, onClose }: { tasks: unknown[]; onClose: () => void }) => (
    <div role="dialog" aria-label="recovery">{tasks.length}<button onClick={onClose}>close</button></div>
  )
}));

import { SchedulerView } from './SchedulerView';

const task = (id: string, projectId: string) => ({ id, name: id, projectId, enabled: true, status: { runs: [], runCount: 0 } }) as unknown as ScheduledTask;
const mount = (projectId?: string) => render(<MemoryRouter><SchedulerView projectId={projectId} /></MemoryRouter>);

beforeEach(() => { h.tasks = [task('a', 'p1'), task('b', 'p2')]; h.panelProps = null; h.overviewProps = null; h.resume.mockReset(); h.loading = false; h.projects = [{ id: 'p1', name: 'Garden' }, { id: 'p2', name: 'Shop' }]; h.openLive.mockReset(); h.setEnabled.mockReset().mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe('SchedulerView Problems segment', () => {
  it('turns every schedule off with Disable all, then back on with Re-enable all', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Schedules$/ }));
    const disableAll = screen.getByRole('button', { name: 'Disable all' });
    expect(disableAll.getAttribute('title')).toBe('Disable every enabled schedule for now');
    fireEvent.click(disableAll);
    await vi.waitFor(() => expect(h.setEnabled).toHaveBeenCalledTimes(2));
    expect(h.setEnabled).toHaveBeenCalledWith('a', false);
    expect(h.setEnabled).toHaveBeenCalledWith('b', false);
    const reEnable = screen.getByRole('button', { name: 'Re-enable all' });
    expect(reEnable.getAttribute('title')).toBe('Turn back on the schedules that were on before Disable all');
    fireEvent.click(reEnable);
    await vi.waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith('a', true));
    expect(h.setEnabled).toHaveBeenCalledWith('b', true);
    expect(screen.getByRole('button', { name: 'Disable all' })).toBeTruthy();
  });


  it('leaves loop schedules alone, disables the button when nothing can be turned off, and survives a failed call', async () => {
    h.tasks = [task('a', 'p1'), { ...task('loop', 'p1'), external: { kind: 'claude-loop' } } as unknown as ScheduledTask];
    h.setEnabled.mockRejectedValue(new Error('denied'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Schedules$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable all' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Re-enable all' })).toBeTruthy());
    expect(h.setEnabled).toHaveBeenCalledTimes(1);
    expect(h.setEnabled).toHaveBeenCalledWith('a', false);
    cleanup();
    h.tasks = [{ ...task('a', 'p1'), enabled: false } as unknown as ScheduledTask];
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Schedules$/ }));
    expect((screen.getByRole('button', { name: 'Disable all' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the empty state with no schedules and the no-match state when a search finds none', () => {
    h.tasks = [];
    mount();
    expect(screen.queryByRole('button', { name: 'Disable all' })).toBeNull();
    cleanup();
    h.tasks = [task('a', 'p1')];
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Schedules$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'search nothing' }));
    expect(screen.getByText('No schedules match')).toBeTruthy();
  });

  it('shows the no-projects, loading and empty-project states around the toolbar', () => {
    h.projects = [];
    mount();
    expect(screen.getByText('No projects yet')).toBeTruthy();
    cleanup();
    h.projects = [{ id: 'p1', name: 'Garden' }];
    h.loading = true;
    mount();
    expect(screen.queryByTestId('overview')).toBeNull();
    cleanup();
    h.loading = false;
    h.tasks = [];
    mount('p1');
    expect(screen.getByText('empty')).toBeTruthy();
  });

  it('wires Resume from the Overview and from Problems to the helper', () => {
    mount();
    h.overviewProps!.onResumeRun(h.tasks[0], undefined);
    expect(h.resume).toHaveBeenLastCalledWith(h.tasks[0], undefined, expect.any(Function));
    fireEvent.click(screen.getByRole('button', { name: /Problems/ }));
    h.panelProps!.onResumeRun(h.tasks[1], 'run-9');
    expect(h.resume).toHaveBeenLastCalledWith(h.tasks[1], 'run-9', expect.any(Function));
  });

  it('toggles Overview · Schedules · Problems with aria-pressed', () => {
    mount();
    const group = screen.getByRole('group', { name: 'Scheduler view' });
    const button = (name: string) => group.querySelector(`button:nth-of-type(${name})`) as HTMLButtonElement;
    expect(button('1').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Problems/ }));
    expect(screen.getByTestId('problems').textContent).toBe('problems 2');
    expect(button('3').getAttribute('aria-pressed')).toBe('true');
    expect(button('1').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Overview/ }));
    expect(screen.getByTestId('overview')).toBeTruthy();
  });

  it('scopes the workbench to the locked project', () => {
    mount('p1');
    fireEvent.click(screen.getByRole('button', { name: /Problems/ }));
    expect(screen.getByTestId('problems').textContent).toBe('problems 1');
    expect(h.panelProps!.tasks.map((t: ScheduledTask) => t.id)).toEqual(['a']);
  });

  it('wires the overview banner to Problems and opens sessions through the live route', () => {
    mount();
    h.overviewProps!.onReviewProblems();
    return vi.waitFor(() => expect(screen.getByTestId('problems')).toBeTruthy()).then(() => {
      h.panelProps!.onOpenSession('sess', 'p1');
      expect(h.openLive).toHaveBeenCalledWith('p1', 'sess', expect.any(Function));
    });
  });

  it('opens and closes the recovery dialog from the card and the Problems link', () => {
    mount();
    h.overviewProps!.onTurnOnRecovery();
    return vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'recovery' }).textContent).toContain('2')).then(() => {
      fireEvent.click(screen.getByRole('button', { name: 'close' }));
      expect(screen.queryByRole('dialog', { name: 'recovery' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Problems/ }));
      h.panelProps!.onTurnOnRecovery();
      return vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'recovery' })).toBeTruthy());
    });
  });

  it('hides the segmented control when there is nothing to show', () => {
    h.tasks = [];
    mount();
    expect(screen.queryByRole('group', { name: 'Scheduler view' })).toBeNull();
  });
});
