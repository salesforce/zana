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
  id: 'user:s', name: 'S', orchestratorPersonaId: 'p-orch', source: 'user',
  slots: [{ personaId: 'p-orch', quantity: 1 }, { personaId: 'p-worker', quantity: 1 }]
};
const CHECKBOX = /Start each unit in a fresh session/i;

afterEach(() => { cleanup(); save.mockReset(); });

async function saveTeam() {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as Team;
}

describe('REQ-1 the Team editor offers the fresh-session checkbox', () => {
  it('shows the checkbox with the plain help text for a CLI squad', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(screen.getAllByLabelText(CHECKBOX).length).toBeGreaterThan(0);
    expect(screen.getByText(/The seat closes its session after each unit and starts a new one for the next/)).toBeTruthy();
    expect(screen.getByText(/Each new session waits its turn to start, like any seat\. Plan-driven Squads only\./)).toBeTruthy();
  });

  it('saves freshContextPerUnit: true on the ticked row only', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const boxes = screen.getAllByLabelText(CHECKBOX);
    fireEvent.click(boxes[boxes.length - 1]!);
    const saved = await saveTeam();
    expect(saved.slots.find((s) => s.personaId === 'p-worker')!.freshContextPerUnit).toBe(true);
    expect(saved.slots.find((s) => s.personaId === 'p-orch')!.freshContextPerUnit).toBeUndefined();
  });

  it('shows a stored true as ticked and keeps it through a save, beside start on demand', async () => {
    const team = { ...base, slots: [base.slots[0]!, { personaId: 'p-worker', quantity: 1, startOnDemand: true, freshContextPerUnit: true }] };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    const boxes = screen.getAllByLabelText(CHECKBOX) as HTMLInputElement[];
    expect(boxes[boxes.length - 1]!.checked).toBe(true);
    const saved = await saveTeam();
    expect(saved.slots[1]).toMatchObject({ startOnDemand: true, freshContextPerUnit: true });
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
    expect(screen.queryAllByLabelText(CHECKBOX)).toHaveLength(0);
  });

  it('does not save the flag when the squad is switched to Modern', async () => {
    const team = { ...base, slots: [base.slots[0]!, { personaId: 'p-worker', quantity: 1, freshContextPerUnit: true }] };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Squad transport'), { target: { value: 'MODERN' } });
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
