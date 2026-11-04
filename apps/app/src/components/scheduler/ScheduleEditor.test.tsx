/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const update = vi.fn();
const upsertSchedulerTask = vi.hoisted(() => vi.fn());
const teamsList = vi.hoisted(() => vi.fn());

vi.mock('../../lib/product-client.js', () => ({
  product: {
    scheduler: {
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args)
    },
    teams: {
      list: (...args: unknown[]) => teamsList(...args)
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
            : id === 'sched-use-user-config'
              ? value === 'inherit' ? 'user' : value === 'user' ? 'isolated' : 'inherit'
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
  beforeEach(() => {
    teamsList.mockReset();
    teamsList.mockResolvedValue([{ id: 'team-1', name: 'Release squad', slots: [] }]);
  });

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

  it('shows a load-error hint when the squad list fails', async () => {
    teamsList.mockRejectedValue(new Error('offline'));
    render(<ScheduleEditor task={null} />);
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load squads'));
  });

  it('shows an empty hint when no squads exist, none when squads load', async () => {
    teamsList.mockResolvedValue([]);
    const first = render(<ScheduleEditor task={null} />);
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByText(/No squads available/)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    first.unmount();
    teamsList.mockResolvedValue([{ id: 'team-1', name: 'Release squad', slots: [] }]);
    render(<ScheduleEditor task={null} />);
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Squad')).toBeTruthy());
    await vi.waitFor(() => expect(screen.queryByText(/No squads available/)).toBeNull());
  });

  it('restores launch profile after changing a Squad schedule back to Agent', async () => {
    render(<ScheduleEditor task={null} />);
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Squad')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Launch profile')).toBeTruthy());
    expect(screen.queryByLabelText('Squad')).toBeNull();
  });

  describe('Claude config control', () => {
    const baseTask = {
      id: 'sched-1', name: 'N', enabled: true, projectId: 'p1', profile: 'claude',
      schedule: { every: '1h' }, overlap: 'skip', history: { retain: 10 },
      status: { runCount: 0, runs: [] }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
    };
    const picker = () => screen.getByRole('button', { name: 'Claude config for this schedule' });

    it('defaults to global setting and omits useUserConfig on create', async () => {
      create.mockResolvedValue({ ok: true, value: { id: 'c1' } });
      render(<ScheduleEditor task={null} />);
      expect(picker().textContent).toBe('inherit');
      fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
      await vi.waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls.at(-1)![0]).not.toHaveProperty('useUserConfig');
    });

    it('sends true on create when set to my Claude config', async () => {
      create.mockResolvedValue({ ok: true, value: { id: 'c1' } });
      render(<ScheduleEditor task={null} />);
      fireEvent.click(picker());
      fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
      await vi.waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls.at(-1)![0].useUserConfig).toBe(true);
    });

    it('sends false on create when isolated', async () => {
      create.mockResolvedValue({ ok: true, value: { id: 'c1' } });
      render(<ScheduleEditor task={null} />);
      fireEvent.click(picker());
      fireEvent.click(picker());
      fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
      await vi.waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls.at(-1)![0].useUserConfig).toBe(false);
    });

    it('prefills from the task and saves null when reset to global', async () => {
      update.mockResolvedValue({ ok: true, value: { id: 'sched-1' } });
      render(<ScheduleEditor task={{ ...baseTask, useUserConfig: false } as never} />);
      expect(picker().textContent).toBe('isolated');
      fireEvent.click(picker());
      expect(picker().textContent).toBe('inherit');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls.at(-1)![1].useUserConfig).toBeNull();
    });

    it('saves true on edit for a task already on my Claude config', async () => {
      update.mockResolvedValue({ ok: true, value: { id: 'sched-1' } });
      render(<ScheduleEditor task={{ ...baseTask, useUserConfig: true } as never} />);
      expect(picker().textContent).toBe('user');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls.at(-1)![1].useUserConfig).toBe(true);
    });
  });

  describe('Required MCP servers control', () => {
    const baseTask = {
      id: 'sched-1', name: 'N', enabled: true, projectId: 'p1', profile: 'claude',
      schedule: { every: '1h' }, overlap: 'skip', history: { retain: 10 },
      status: { runCount: 0, runs: [] }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
    };
    const field = () => document.querySelector('#sched-required-mcps') as HTMLTextAreaElement | null;

    it('shows the hint and omits requiredMcps on create when empty', async () => {
      create.mockResolvedValue({ ok: true, value: { id: 'c1' } });
      render(<ScheduleEditor task={null} />);
      expect(screen.getByText('Required MCP servers', { exact: false })).toBeTruthy();
      expect(screen.getByText("The run fails clearly if one of these isn't available in the isolated config.")).toBeTruthy();
      fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
      await vi.waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls.at(-1)![0]).not.toHaveProperty('requiredMcps');
    });

    it('parses comma and line separated names, de-duplicated, on create', async () => {
      create.mockResolvedValue({ ok: true, value: { id: 'c1' } });
      render(<ScheduleEditor task={null} />);
      fireEvent.change(field()!, { target: { value: 'slack, github\n slack ,, ' } });
      fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, { target: { value: 'X' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
      await vi.waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls.at(-1)![0].requiredMcps).toEqual(['slack', 'github']);
    });

    it('prefills from the task and saves null when cleared', async () => {
      update.mockResolvedValue({ ok: true, value: { id: 'sched-1' } });
      render(<ScheduleEditor task={{ ...baseTask, requiredMcps: ['slack'] } as never} />);
      expect(field()!.value).toBe('slack');
      fireEvent.change(field()!, { target: { value: '  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls.at(-1)![1].requiredMcps).toBeNull();
    });

    it('saves the list on edit', async () => {
      update.mockResolvedValue({ ok: true, value: { id: 'sched-1' } });
      render(<ScheduleEditor task={{ ...baseTask, requiredMcps: ['slack'] } as never} />);
      fireEvent.change(field()!, { target: { value: 'slack, jira' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls.at(-1)![1].requiredMcps).toEqual(['slack', 'jira']);
    });

    it('is hidden when the schedule opts out of isolation or uses the shell profile', () => {
      const first = render(<ScheduleEditor task={{ ...baseTask, useUserConfig: true } as never} />);
      expect(field()).toBeNull();
      first.unmount();
      render(<ScheduleEditor task={{ ...baseTask, profile: 'shell' } as never} />);
      expect(field()).toBeNull();
    });
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

  describe('missed-run and retry policies', () => {
    const base = {
      id: 'sched-1', name: 'Morning digest', enabled: true, projectId: 'p1', profile: 'claude',
      schedule: { every: '1h' }, overlap: 'skip', history: { retain: 10 }, status: { runCount: 0, runs: [] },
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
    };
    // Both policies are radio cards (the Inbox notifications pattern).
    const checkedValue = (name: string) => (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null)?.value;
    const missed = () => ({ value: checkedValue('sched-missed') });
    const retry = () => ({ value: checkedValue('sched-retry') });
    const pick = (name: string, value: string) => fireEvent.click(document.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement);
    const offers = (value: string) => !!document.querySelector(`input[name="sched-missed"][value="${value}"]`);
    const input = (id: string, value: string) => fireEvent.change(document.querySelector(id) as HTMLInputElement, { target: { value } });
    const saved = async (task: unknown) => {
      update.mockResolvedValue({ ok: true, value: { id: 'sched-1' } });
      const onSaved = vi.fn();
      render(<ScheduleEditor task={task as never} onSaved={onSaved} />);
      return onSaved;
    };

    it('defaults a new schedule to Run once with retry off, and creates it so', async () => {
      create.mockResolvedValue({ ok: true, value: { id: 'n' } });
      render(<ScheduleEditor task={null} />);
      expect(missed().value).toBe('once');
      expect(retry().value).toBe('off');
      expect(screen.getByText('When a scheduled time passes while the computer sleeps or Zana is closed.')).toBeTruthy();
      // A new schedule has no "original rules" to keep: only the three behaviours.
      expect(offers('original')).toBe(false);
      expect(screen.getByText('Run once')).toBeTruthy();
      expect(screen.getByText("Don't retry")).toBeTruthy();
      fireEvent.change(document.querySelector('#sched-name') as HTMLInputElement, { target: { value: 'N' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
      await vi.waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls[0]![0]).toMatchObject({ catchUp: { mode: 'once' }, retry: null });
    });

    it('a copy of a schedule on its original rules is a NEW schedule and starts at Run once; a copy of a Recovery one keeps its policy', () => {
      render(<ScheduleEditor task={null} seed={{ kind: 'duplicate', source: base as never }} />);
      expect(missed().value).toBe('once');
      cleanup();
      render(<ScheduleEditor task={null} seed={{ kind: 'duplicate', source: { ...base, catchUp: { mode: 'skip' } } as never }} />);
      expect(missed().value).toBe('skip');
    });

    it('shows an existing schedule without catchUp on its original rules, worded by what it does, saving null', async () => {
      const onSaved = await saved(base);
      expect(missed().value).toBe('original');
      // Interval wording: the original rules wait when several times were missed.
      expect(screen.getByText('Run once, unless several were missed')).toBeTruthy();
      expect(screen.queryByText(/Classic|as before/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(update.mock.calls[0]![1]).toMatchObject({ catchUp: null, retry: null });
    });

    it.each([['once', { mode: 'once' }], ['skip', { mode: 'skip' }]])('round-trips %s', async (choice, expected) => {
      const onSaved = await saved(base);
      pick('sched-missed', choice);
      expect(document.querySelector('#sched-missed-max')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(update.mock.calls[0]![1].catchUp).toEqual(expected);
    });

    it('round-trips Run each missed time with a clamped N', async () => {
      const onSaved = await saved({ ...base, catchUp: { mode: 'all', max: 4 } });
      expect(missed().value).toBe('all');
      expect((document.querySelector('#sched-missed-max') as HTMLInputElement).value).toBe('4');
      const max = document.querySelector('#sched-missed-max') as HTMLInputElement;
      expect(max.getAttribute('aria-label')).toBe('Missed runs to catch up');
      expect(max.className).toBe('settings-input');
      // Typing keeps the raw text (no snapping to the minimum mid-edit); blur clamps.
      input('#sched-missed-max', '');
      expect(max.value).toBe('');
      input('#sched-missed-max', '99');
      expect(max.value).toBe('99');
      fireEvent.blur(max);
      expect(max.value).toBe('10');
      input('#sched-missed-max', '0');
      fireEvent.blur(max);
      expect(max.value).toBe('1');
      input('#sched-missed-max', '7');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(update.mock.calls[0]![1].catchUp).toEqual({ mode: 'all', max: 7 });
    });

    it('words the original rules for a cron schedule, and can switch back to them', async () => {
      const onSaved = await saved({ ...base, schedule: { cron: '0 9 * * *' }, catchUp: { mode: 'skip' } });
      expect(missed().value).toBe('skip');
      expect(screen.getByText('Run once, skip when busy')).toBeTruthy();
      pick('sched-missed', 'original');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(update.mock.calls[0]![1].catchUp).toBeNull();
    });

    it('turns retry on with clamped attempts and delay, and off again', async () => {
      const onSaved = await saved(base);
      pick('sched-retry', 'on');
      const attempts = document.querySelector('#sched-retry-attempts') as HTMLInputElement;
      const delay = document.querySelector('#sched-retry-delay') as HTMLInputElement;
      // Defaults match the recovery dialog: one retry, ten minutes later.
      expect(attempts.value).toBe('1');
      expect(delay.value).toBe('10');
      expect(attempts.getAttribute('aria-label')).toBe('Retry attempts');
      expect(delay.getAttribute('aria-label')).toBe('Minutes to wait between retries');
      input('#sched-retry-attempts', '9');
      input('#sched-retry-delay', '5000');
      fireEvent.blur(attempts);
      fireEvent.blur(delay);
      expect(attempts.value).toBe('5');
      expect(delay.value).toBe('1440');
      input('#sched-retry-attempts', '2');
      input('#sched-retry-delay', '15');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(update.mock.calls[0]![1].retry).toEqual({ attempts: 2, delayMinutes: 15 });
      cleanup();
      update.mockClear();
      // An empty or out-of-range entry is clamped when the field loses focus
      // (clicking Save blurs it first), so what gets saved is always in range.
      const typed = await saved(base);
      pick('sched-retry', 'on');
      input('#sched-retry-attempts', '');
      input('#sched-retry-delay', '0');
      fireEvent.blur(document.querySelector('#sched-retry-attempts')!);
      fireEvent.blur(document.querySelector('#sched-retry-delay')!);
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(typed).toHaveBeenCalled());
      expect(update.mock.calls[0]![1].retry).toEqual({ attempts: 1, delayMinutes: 1 });
      cleanup();
      update.mockClear();
      const again = await saved({ ...base, retry: { attempts: 2, delayMinutes: 15 } });
      expect(retry().value).toBe('on');
      expect((document.querySelector('#sched-retry-attempts') as HTMLInputElement).value).toBe('2');
      pick('sched-retry', 'off');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await vi.waitFor(() => expect(again).toHaveBeenCalled());
      expect(update.mock.calls[0]![1].retry).toBeNull();
    });

    it('hides both fields for read-only and external rows', () => {
      const fieldsShown = () => !!document.querySelector('input[name="sched-missed"], input[name="sched-retry"]');
      render(<ScheduleEditor task={{ ...base, external: { kind: 'claude-loop' } } as never} readOnly />);
      expect(fieldsShown()).toBe(false);
      cleanup();
      render(<ScheduleEditor task={{ ...base, external: { kind: 'claude-loop' } } as never} />);
      expect(fieldsShown()).toBe(false);
    });
  });
});
