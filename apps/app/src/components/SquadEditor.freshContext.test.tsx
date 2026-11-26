/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());

vi.mock('../lib/product-client.js', () => ({ product: { teams: { save: (...a: unknown[]) => save(...a), delete: vi.fn() } } }));
vi.mock('./ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../store.js', () => {
  const state = { personas: [{ id: 'p-orch', name: 'Orch' }, { id: 'p-worker', name: 'Worker' }], projects: [], pushToast: vi.fn() };
  return {
    usePersonas: (sel: (s: unknown) => unknown) => sel(state),
    useData: (sel: (s: unknown) => unknown) => sel(state),
    useUi: (sel: (s: unknown) => unknown) => sel(state)
  };
});

import { SquadEditor } from './SquadEditor';

/** #579: the Team editor's "fresh session per unit" checkbox. */
const base: Team = {
  id: 'user:s', name: 'S', orchestratorPersonaId: 'p-orch', source: 'user', transport: 'CLI',
  slots: [{ personaId: 'p-orch', quantity: 1 }, { personaId: 'p-worker', quantity: 1 }]
};
const CHECKBOX = /^Start each unit in a fresh session$/i;

afterEach(() => { cleanup(); save.mockReset(); });

async function saveTeam() {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as Team;
}

describe('REQ-1 the Team editor offers the fresh-session checkbox', () => {
  it('shows a fresh-session toggle per seat with a legend naming it', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: CHECKBOX })).toHaveLength(2);
    expect(screen.getByTestId('team-slot-legend').textContent).toMatch(/Start each unit in a fresh session/);
  });

  it('saves freshContextPerUnit: true on the pressed row only', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const toggles = screen.getAllByRole('button', { name: CHECKBOX });
    fireEvent.click(toggles[1]!);
    expect(toggles[1]!.getAttribute('aria-pressed')).toBe('true');
    const saved = await saveTeam();
    expect(saved.slots.find((s) => s.personaId === 'p-worker')!.freshContextPerUnit).toBe(true);
    expect(saved.slots.find((s) => s.personaId === 'p-orch')!.freshContextPerUnit).toBeUndefined();
  });

  it('shows the orchestrator row toggles disabled with a reason, and ignores clicks', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const orch = screen.getAllByRole('button', { name: CHECKBOX })[0]!;
    expect(orch.getAttribute('aria-disabled')).toBe('true');
    expect(orch.getAttribute('aria-pressed')).toBe('false');
    expect(orch.getAttribute('data-tooltip')).toMatch(/Not available: the orchestrator/);
    fireEvent.click(orch);
    expect(orch.getAttribute('aria-pressed')).toBe('false');
    const saved = await saveTeam();
    expect(saved.slots[0]).not.toHaveProperty('freshContextPerUnit');
  });

  it('shows a stored true as pressed and keeps it through a save, beside start on demand', async () => {
    const team = { ...base, slots: [base.slots[0]!, { personaId: 'p-worker', quantity: 1, startOnDemand: true, freshContextPerUnit: true }] };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    const toggles = screen.getAllByRole('button', { name: CHECKBOX });
    expect(toggles[1]!.getAttribute('aria-pressed')).toBe('true');
    const saved = await saveTeam();
    expect(saved.slots[1]).toMatchObject({ startOnDemand: true, freshContextPerUnit: true });
  });

  it('an explicit Modern pin drops seat flags on save; a CLI pin keeps them', async () => {
    const seat = { personaId: 'p-worker', quantity: 1, startOnDemand: true, freshContextPerUnit: true };
    render(<SquadEditor team={{ ...base, transport: 'MODERN', slots: [base.slots[0]!, seat] }} mode="edit" onClose={vi.fn()} />);
    const saved = await saveTeam();
    expect(saved.slots[1]).not.toHaveProperty('startOnDemand');
    expect(saved.slots[1]).not.toHaveProperty('freshContextPerUnit');
  });

  it('existing-user path: an old team saves with no freshContextPerUnit key', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const saved = await saveTeam();
    for (const slot of saved.slots) expect(slot).not.toHaveProperty('freshContextPerUnit');
  });
});

describe('REQ-9 the checkbox is hidden where it cannot work', () => {
  it('hides it for a Modern squad', () => {
    render(<SquadEditor team={{ ...base, transport: 'MODERN' }} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryAllByRole('button', { name: CHECKBOX })).toHaveLength(0);
  });

  it('does not save the flag when the squad is switched to Modern', async () => {
    const team = { ...base, slots: [base.slots[0]!, { personaId: 'p-worker', quantity: 1, freshContextPerUnit: true }] };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Squad launch mode'), { target: { value: 'MODERN' } });
    expect((await saveTeam()).slots[1]).not.toHaveProperty('freshContextPerUnit');
  });
});

describe('REQ-1 the Squad view marks a fresh-session seat', () => {
  it('labels the seat "Fresh session per unit" in the read-only squad detail', () => {
    const team = { ...base, slots: [base.slots[0]!, { personaId: 'p-worker', quantity: 1, freshContextPerUnit: true }] };
    render(<SquadEditor team={team} mode="view" onClose={vi.fn()} />);
    expect(screen.getByText('Fresh session per unit')).toBeTruthy();
  });

  it('shows no label when no seat asks for it', () => {
    render(<SquadEditor team={base} mode="view" onClose={vi.fn()} />);
    expect(screen.queryByText('Fresh session per unit')).toBeNull();
  });
});
