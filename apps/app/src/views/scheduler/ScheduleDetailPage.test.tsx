/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

const tasks: ScheduledTask[] = [];
let loading = false;

const h = vi.hoisted(() => ({
  pane: null as null | {
    isSplitPane: boolean;
    isFocused: boolean;
    isMaximized: boolean;
    onToggleMaximize?: () => void;
    onRequestClose?: () => void;
  },
  navigate: vi.fn(),
  locationState: null as unknown,
  deleteResult: { ok: true, message: undefined as string | undefined },
  pushToast: vi.fn()
}));

vi.mock('../../store.js', () => ({
  useScheduler: (selector: (s: { tasks: ScheduledTask[]; loading: boolean }) => unknown) =>
    selector({ tasks, loading }),
  useUi: { getState: () => ({ pushToast: h.pushToast }) }
}));

vi.mock('../../lib/product-client.js', () => ({
  product: {
    scheduler: {
      delete: () => Promise.resolve(h.deleteResult)
    }
  }
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/schedules/sched-1', state: h.locationState }),
  useNavigate: () => h.navigate
}));

vi.mock('../thread-detail/PaneContext.js', () => ({
  useOptionalPaneContext: () => h.pane
}));

vi.mock('../../components/scheduler/ScheduleEditor.js', () => ({
  ScheduleEditor: ({ onSaved }: { onSaved?: (id: string) => void }) => (
    <div data-testid="schedule-editor">
      <button type="button" onClick={() => onSaved?.('created-1')}>
        Saved
      </button>
    </div>
  )
}));

vi.mock('../../components/scheduler/ScheduleInfoPanel.js', () => ({
  ScheduleInfoPanel: ({
    onDuplicate,
    onAskDelete
  }: {
    onDuplicate?: () => void;
    onAskDelete?: () => void;
  }) => (
    <div data-testid="schedule-info-panel">
      {onDuplicate ? (
        <button type="button" onClick={onDuplicate}>
          Duplicate
        </button>
      ) : null}
      {onAskDelete ? (
        <button type="button" onClick={onAskDelete}>
          Delete
        </button>
      ) : null}
    </div>
  )
}));

vi.mock('../../components/scheduler/DeleteConfirmModal.js', () => ({
  DeleteConfirmModal: ({
    onConfirm,
    onCancel
  }: {
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="delete-confirm">
      <button type="button" onClick={() => void onConfirm()}>
        Confirm delete
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}));

import { ScheduleDetailPage } from './ScheduleDetailPage.js';

const sample = {
  id: 'sched-1',
  name: 'Morning digest',
  enabled: true,
  projectId: 'p1',
  profile: 'claude',
  schedule: { every: '1h' },
  overlap: 'skip',
  history: { retain: 10 },
  status: { runCount: 0, runs: [] },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
} as ScheduledTask;

describe('ScheduleDetailPage', () => {
  afterEach(() => {
    cleanup();
    tasks.length = 0;
    loading = false;
    h.pane = null;
    h.locationState = null;
    h.deleteResult = { ok: true, message: undefined };
    h.navigate.mockReset();
    h.pushToast.mockReset();
  });

  it('shows an empty state when the schedule is gone', () => {
    render(<ScheduleDetailPage projectId={null} scheduleId="missing" />);
    expect(screen.getByTestId('schedule-missing')).toBeTruthy();
    expect(screen.getByText('This schedule is no longer available.')).toBeTruthy();
    expect(screen.queryByTestId('schedule-detail')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Schedule unavailable' })).toBeTruthy();
  });

  it('opens the editor in a page over the catalogue', () => {
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(document.querySelector('.schedule-detail-pane')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Morning digest' })).toBeTruthy();
    expect(screen.getByTestId('schedule-detail')).toBeTruthy();
    expect(screen.getByTestId('schedule-editor')).toBeTruthy();
    expect(screen.getByTestId('schedule-info-panel')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the page back to the catalogue', () => {
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to schedules' }));
    expect(h.navigate).toHaveBeenCalledWith('/scheduler');
  });

  it('renders the create page when no schedule id is routed', () => {
    render(<ScheduleDetailPage projectId={null} scheduleId={null} />);
    expect(screen.getByRole('heading', { name: 'New schedule' })).toBeTruthy();
    expect(screen.getByTestId('schedule-detail')).toBeTruthy();
  });

  it('titles a template-seeded create page', () => {
    h.locationState = { seed: { kind: 'template', template: { name: 'Standup' } } };
    render(<ScheduleDetailPage projectId={null} scheduleId={null} />);
    expect(screen.getByRole('heading', { name: 'New schedule · Standup' })).toBeTruthy();
  });

  it('duplicates into the new-schedule route', () => {
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(h.navigate).toHaveBeenCalledWith('/schedules/new', {
      state: { seed: { kind: 'duplicate', source: sample } }
    });
  });

  it('deletes the schedule and returns to the catalogue', async () => {
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByTestId('delete-confirm')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/scheduler'));
  });

  it('toasts when delete fails', async () => {
    h.deleteResult = { ok: false, message: 'in use' };
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await vi.waitFor(() =>
      expect(h.pushToast).toHaveBeenCalledWith('Delete failed: in use', 'error')
    );
  });

  it('replaces the URL after the first save on the create page', () => {
    render(<ScheduleDetailPage projectId={null} scheduleId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
    expect(h.navigate).toHaveBeenCalledWith('/schedules/created-1', { replace: true });
  });

  it('renders the editor for a just-created id already in the live list', () => {
    tasks.push({ ...sample, id: 'created-1', name: 'Nightly' });
    render(<ScheduleDetailPage projectId={null} scheduleId="created-1" />);
    expect(screen.getByTestId('schedule-detail')).toBeTruthy();
    expect(screen.queryByTestId('schedule-missing')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nightly' })).toBeTruthy();
  });

  it('fills a split pane with the same page chrome', () => {
    tasks.push(sample);
    const onToggleMaximize = vi.fn();
    const onRequestClose = vi.fn();
    h.pane = {
      isSplitPane: true,
      isFocused: true,
      isMaximized: false,
      onToggleMaximize,
      onRequestClose
    };
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.schedule-detail-pane')).toBeTruthy();
    expect(screen.getByTestId('schedule-detail')).toBeTruthy();
    fireEvent.click(screen.getByTestId('split-pane-maximize'));
    expect(onToggleMaximize).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('split-pane-close'));
    expect(onRequestClose).toHaveBeenCalled();
  });
});
