/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock('../lib/product-client.js', () => ({ product: { teams: { save: (...a: unknown[]) => save(...a), delete: vi.fn() } } }));
vi.mock('./ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../store.js', () => {
  const state = { personas: [{ id: 'p-orch', name: 'Orch' }, { id: 'p-worker', name: 'Worker' }], projects: [], pushToast };
  return {
    usePersonas: (sel: (s: unknown) => unknown) => sel(state),
    useData: (sel: (s: unknown) => unknown) => sel(state),
    useUi: (sel: (s: unknown) => unknown) => sel(state)
  };
});
vi.mock('./ui/PopoverPicklist.js', () => ({
  PopoverPicklist: ({ id, value, onChange, ariaLabel }: { id: string; value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <button type="button" id={id} aria-label={ariaLabel} data-value={value}
      onClick={() => onChange(
        id === 'team-worktree-isolation' || id === 'team-routing-enforced'
          ? (value === 'inherit' ? 'on' : value === 'on' ? 'off' : 'inherit')
          : id === 'team-worktree-on-complete'
            ? (value === 'inherit' ? 'merge' : value === 'merge' ? 'delete' : 'inherit')
            : value
      )}>
      {value}
    </button>
  )
}));

import { SquadEditor } from './SquadEditor.js';

const base: Team = {
  id: 'user:s', name: 'S', orchestratorPersonaId: 'p-orch', source: 'user',
  slots: [{ personaId: 'p-orch', quantity: 1 }, { personaId: 'p-worker', quantity: 1 }]
};

afterEach(() => { cleanup(); save.mockReset(); pushToast.mockReset(); });

const ISO = { inherit: /^Project default/, on: /^Always use a worktree/, off: /^Never, work in the checkout/ } as const;
const DONE = { inherit: /^Keep the worktree/, merge: /^Merge into the base branch/, delete: /^Delete the worktree and its branch/ } as const;

async function pickIsolationAndSave(team: Team, pick?: keyof typeof ISO) {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
  if (pick) fireEvent.click(screen.getByRole('radio', { name: ISO[pick] }));
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as { worktreeIsolation?: boolean };
}

describe('SquadEditor worktree isolation radios', () => {
  it('defaults to Project default and saves undefined', async () => {
    expect((await pickIsolationAndSave(base)).worktreeIsolation).toBeUndefined();
    expect((screen.getByRole('radio', { name: ISO.inherit }) as HTMLInputElement).checked).toBe(true);
  });
  it('maps Always to true', async () => {
    expect((await pickIsolationAndSave(base, 'on')).worktreeIsolation).toBe(true);
  });
  it('maps Never to false', async () => {
    expect((await pickIsolationAndSave(base, 'off')).worktreeIsolation).toBe(false);
  });
  it('maps back to Project default and preserves a stored false on load', async () => {
    expect((await pickIsolationAndSave({ ...base, worktreeIsolation: false }, 'inherit')).worktreeIsolation).toBeUndefined();
  });
  it('shows a stored false as Never and explains that a launch can still turn it on', () => {
    render(<SquadEditor team={{ ...base, worktreeIsolation: false }} mode="edit" onClose={vi.fn()} />);
    expect((screen.getByRole('radio', { name: ISO.off }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('team-worktree-never-note').textContent).toMatch(/can still turn it on/);
  });
  it('keeps When a run finishes visible when isolation is Never', () => {
    render(<SquadEditor team={{ ...base, worktreeIsolation: false }} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Squad worktree on completion' })).toBeTruthy();
  });
  it('shows no Never note for Project default or Always', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId('team-worktree-never-note')).toBeNull();
  });
  it('explains how isolation is decided in a collapsed disclosure', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByText('How Isolation is decided')).toBeTruthy();
  });
});

describe('SquadEditor worktree on completion radios', () => {
  it.each([['merge', 'merge'], ['delete', 'delete'], ['inherit', undefined]] as const)('picking %s saves %s', async (pick, expected) => {
    save.mockResolvedValue({ ok: true, value: { name: 'S' } });
    render(<SquadEditor team={pick === 'inherit' ? { ...base, worktreeOnComplete: 'merge' } : base} mode="edit" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: DONE[pick] }));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect((save.mock.calls[0]![0] as { worktreeOnComplete?: string }).worktreeOnComplete).toBe(expected);
  });
  it('defaults to keep and saves undefined', async () => {
    save.mockResolvedValue({ ok: true, value: { name: 'S' } });
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect((screen.getByRole('radio', { name: DONE.inherit }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect((save.mock.calls[0]![0] as { worktreeOnComplete?: string }).worktreeOnComplete).toBeUndefined();
  });
  it.each(['merge', 'delete'] as const)('round-trips a stored %s', async (mode) => {
    save.mockResolvedValue({ ok: true, value: { name: 'S' } });
    render(<SquadEditor team={{ ...base, worktreeOnComplete: mode }} mode="edit" onClose={vi.fn()} />);
    expect((screen.getByRole('radio', { name: DONE[mode] }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect((save.mock.calls[0]![0] as { worktreeOnComplete?: string }).worktreeOnComplete).toBe(mode);
  });
  it('shows the red delete warning only when Delete is selected', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId('team-worktree-delete-warning')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: DONE.delete }));
    expect(screen.getByTestId('team-worktree-delete-warning').getAttribute('role')).toBe('alert');
  });
  it('shows a stored leave as the keep default and explains the safeguards', () => {
    render(<SquadEditor team={{ ...base, worktreeOnComplete: 'leave' }} mode="edit" onClose={vi.fn()} />);
    expect((screen.getByRole('radio', { name: DONE.inherit }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/failed or stopped runs always keep the worktree/i)).toBeTruthy();
  });
});

async function cycleRoutingAndSave(team: Team, clicks: number) {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
  const picker = screen.getByLabelText('Squad routing');
  for (let i = 0; i < clicks; i++) fireEvent.click(picker);
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as { routingEnforced?: boolean };
}

describe('SquadEditor routing tri-state', () => {
  it('defaults to inherit and saves undefined', async () => {
    expect((await cycleRoutingAndSave(base, 0)).routingEnforced).toBeUndefined();
  });
  it('maps On to true', async () => {
    expect((await cycleRoutingAndSave(base, 1)).routingEnforced).toBe(true);
  });
  it('maps Off to false', async () => {
    expect((await cycleRoutingAndSave(base, 2)).routingEnforced).toBe(false);
  });
  it('maps back to inherit and preserves a stored false on load', async () => {
    expect((await cycleRoutingAndSave({ ...base, routingEnforced: false }, 1)).routingEnforced).toBeUndefined();
  });
  it('shows a stored false as off', () => {
    render(<SquadEditor team={{ ...base, routingEnforced: false }} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByLabelText('Squad routing').getAttribute('data-value')).toBe('off');
  });
});
