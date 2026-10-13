/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const update = vi.fn();
const upsertSchedulerTask = vi.hoisted(() => vi.fn());

vi.mock('../../lib/product-client.js', () => ({
  product: {
    scheduler: {
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args)
    },
    teams: {
      list: vi.fn(async () => [{ id: 'team-1', name: 'Release squad', slots: [] }])
    }
  }
}));

vi.mock('../../store.js', () => ({
  useData: (selector: (s: { projects: Array<{ id: string; name: string }> }) => unknown) =>
    selector({ projects: [{ id: 'p1', name: 'Demo' }] }),
  useUi: (selector: (s: { schedulerTab: string; selectedProjectId: string | null; selectedGroupId: string | null }) => unknown) =>
    selector({ schedulerTab: 'global', selectedProjectId: null, selectedGroupId: null }),
  useScheduleGroups: (selector: (s: { groups: never[] }) => unknown) => selector({ groups: [] }),
  upsertSchedulerTask
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
    <button
      type="button"
      id={id}
      aria-label={ariaLabel}
      onClick={() => onChange(
        id === 'sched-run-as'
          ? value === 'agent' ? 'team' : 'agent'
          : id === 'sched-team'
            ? 'team-1'
            : id === 'sched-plan-source'
              ? 'provided'
              : value || 'p1'
      )}
    >
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
    upsertSchedulerTask.mockReset();
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
    const created = { id: 'created-1', name: 'Nightly' };
    create.mockResolvedValue({ ok: true, value: created });
    const onSaved = vi.fn();
    render(<ScheduleEditor task={null} onSaved={onSaved} />);
    fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, {
      target: { value: 'Nightly' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith('created-1'));
    expect(create).toHaveBeenCalled();
    expect(upsertSchedulerTask).toHaveBeenCalledWith(created);
    expect(upsertSchedulerTask.mock.invocationCallOrder[0]).toBeLessThan(
      onSaved.mock.invocationCallOrder[0]
    );
  });

  it('replaces launch profile with required squad controls and persists selected planning on create', async () => {
    create.mockResolvedValue({ ok: true, value: { id: 'team-schedule' } });
    render(<ScheduleEditor task={null} />);
    expect(screen.getByLabelText('Launch profile')).toBeTruthy();
    fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, {
      target: { value: 'Release check' }
    });
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Squad')).toBeTruthy());
    expect(screen.queryByLabelText('Launch profile')).toBeNull();
    expect(screen.getByLabelText('Squad planning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create schedule' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('Squad'));
    fireEvent.click(screen.getByLabelText('Squad planning'));
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'team',
      teamId: 'team-1',
      planSource: 'provided'
    }));
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('personaId');
  });

  it('restores launch profile after changing a Squad schedule back to Agent', async () => {
    render(<ScheduleEditor task={null} />);
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Squad')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Launch profile')).toBeTruthy());
    expect(screen.queryByLabelText('Squad')).toBeNull();
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

  it('persists changed squad plan source on edit', async () => {
    update.mockResolvedValue({ ok: true, value: { id: 'squad-1' } });
    const task = {
      id: 'squad-1',
      name: 'Release check',
      enabled: true,
      projectId: 'p1',
      profile: 'claude',
      kind: 'team',
      teamId: 'team-1',
      planSource: 'infer',
      schedule: { every: '1h' },
      overlap: 'skip',
      history: { retain: 10 },
      status: { runCount: 0, runs: [] },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    };
    render(<ScheduleEditor task={task as never} />);
    fireEvent.click(screen.getByLabelText('Squad planning'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith('squad-1', expect.objectContaining({
      kind: 'team',
      teamId: 'team-1',
      planSource: 'provided'
    }));
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

  it('preserves squad assignment and planning when duplicating a squad schedule', () => {
    const source = {
      id: 'sched-1',
      name: 'Morning digest',
      enabled: true,
      projectId: 'p1',
      profile: 'claude',
      kind: 'team',
      teamId: 'team-1',
      planSource: 'provided',
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
    expect(screen.queryByLabelText('Launch profile')).toBeNull();
    expect(screen.getByLabelText('Run as').textContent).toBe('team');
    expect(screen.getByLabelText('Squad').textContent).toBe('team-1');
    expect(screen.getByLabelText('Squad planning').textContent).toBe('provided');
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

  it('saves with ⌘+Enter', async () => {
    const created = { id: 'created-1', name: 'Nightly' };
    create.mockResolvedValue({ ok: true, value: created });
    const onSaved = vi.fn();
    render(<ScheduleEditor task={null} onSaved={onSaved} />);
    fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, {
      target: { value: 'Nightly' }
    });
    fireEvent.keyDown(screen.getByLabelText('New schedule'), {
      key: 'Enter',
      metaKey: true
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith('created-1'));
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
