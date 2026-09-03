/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const update = vi.fn();

vi.mock('../../lib/product-client.js', () => ({
  product: {
    scheduler: {
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args)
    }
  }
}));

vi.mock('../../store.js', () => ({
  useData: (selector: (s: { projects: Array<{ id: string; name: string }> }) => unknown) =>
    selector({ projects: [{ id: 'p1', name: 'Demo' }] }),
  useUi: (selector: (s: { schedulerTab: string; selectedProjectId: string | null; selectedGroupId: string | null }) => unknown) =>
    selector({ schedulerTab: 'global', selectedProjectId: null, selectedGroupId: null }),
  useScheduleGroups: (selector: (s: { groups: never[] }) => unknown) => selector({ groups: [] })
}));

vi.mock('../ImprovePromptButton.js', () => ({
  ImprovePromptButton: () => null
}));

vi.mock('../ui/PopoverPicklist.js', () => ({
  PopoverPicklist: ({
    id,
    value,
    onChange,
    ariaLabel
  }: {
    id: string;
    value: string;
    onChange: (next: string) => void;
    ariaLabel: string;
  }) => (
    <button type="button" id={id} aria-label={ariaLabel} onClick={() => onChange(value || 'p1')}>
      {value || ariaLabel}
    </button>
  )
}));

import { ScheduleEditor } from './ScheduleEditor.js';

describe('ScheduleEditor', () => {
  afterEach(() => {
    cleanup();
    create.mockReset();
    update.mockReset();
  });

  it('shows the cron cadence fields after switching from interval', () => {
    render(<ScheduleEditor task={null} />);
    expect(screen.getByLabelText('New schedule')).toBeTruthy();
    expect(document.querySelector('#sched-cron')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Cron' }));
    expect(document.querySelector('#sched-cron')).toBeTruthy();
    expect(screen.getByText(/Next:/)).toBeTruthy();
  });

  it('creates a schedule and reports the new id', async () => {
    create.mockResolvedValue({ ok: true, value: { id: 'created-1' } });
    const onSaved = vi.fn();
    render(<ScheduleEditor task={null} onSaved={onSaved} />);
    fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, {
      target: { value: 'Nightly' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith('created-1'));
    expect(create).toHaveBeenCalled();
  });

  it('saves edits and re-enables the submit button', async () => {
    update.mockResolvedValue({ ok: true, value: { id: 'sched-1' } });
    const onSaved = vi.fn();
    const task = {
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
    };
    render(<ScheduleEditor task={task as never} onSaved={onSaved} />);
    fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, {
      target: { value: 'Evening digest' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith('sched-1'));
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows a create error and stays on the form', async () => {
    create.mockResolvedValue({ ok: false, message: 'name taken' });
    render(<ScheduleEditor task={null} />);
    fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, {
      target: { value: 'Nightly' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    await vi.waitFor(() => expect(screen.getByText('name taken')).toBeTruthy());
  });

  it('hides save for a read-only claude-loop schedule', () => {
    const task = {
      id: 'loop-1',
      name: 'Loop job',
      enabled: true,
      projectId: 'p1',
      profile: 'claude',
      schedule: { every: '1h' },
      overlap: 'skip',
      history: { retain: 10 },
      status: { runCount: 0, runs: [] },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      external: { kind: 'claude-loop' }
    };
    render(<ScheduleEditor task={task as never} readOnly />);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.getByText(/Read-only/)).toBeTruthy();
  });

  it('prefills from a template seed', () => {
    render(
      <ScheduleEditor
        task={null}
        seed={{
          kind: 'template',
          template: {
            id: 'tpl-1',
            name: 'Standup',
            defaults: { profile: 'claude', every: '1h', name: 'Daily standup', prompt: 'Digest' }
          }
        }}
      />
    );
    expect(screen.getByLabelText('New schedule · Standup')).toBeTruthy();
    expect((document.querySelector('#sched-name') as HTMLInputElement).value).toBe('Daily standup');
  });

  it('prefills from a duplicate seed', () => {
    const source = {
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
    };
    render(
      <ScheduleEditor task={null} seed={{ kind: 'duplicate', source: source as never }} />
    );
    expect(screen.getByLabelText('Duplicate schedule')).toBeTruthy();
    expect((document.querySelector('#sched-name') as HTMLInputElement).value).toBe(
      'Morning digest (copy)'
    );
  });

  it('creates a cron schedule', async () => {
    create.mockResolvedValue({ ok: true, value: { id: 'cron-1' } });
    render(<ScheduleEditor task={null} />);
    fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, {
      target: { value: 'Weekdays' }
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Cron' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ name: 'Weekdays', cron: '0 9 * * 1-5' })
    );
  });

  it('disables save when the interval is invalid', () => {
    render(<ScheduleEditor task={null} />);
    fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, {
      target: { value: 'Broken' }
    });
    fireEvent.change(document.querySelector('#sched-every') as HTMLInputElement, {
      target: { value: 'nope' }
    });
    expect(screen.getByRole('button', { name: 'Create schedule' }).hasAttribute('disabled')).toBe(
      true
    );
  });

  it('shows an update error', async () => {
    update.mockResolvedValue({ ok: false, message: 'conflict' });
    const task = {
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
    };
    render(<ScheduleEditor task={task as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(screen.getByText('conflict')).toBeTruthy());
  });
});
