/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());

vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save: (...a: unknown[]) => save(...a), delete: vi.fn() } } }));
vi.mock('../ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../../store.js', () => {
  const state = { personas: [{ id: 'p-orch', name: 'Orch' }, { id: 'p-worker', name: 'Worker' }], projects: [], pushToast: vi.fn() };
  return {
    usePersonas: (sel: (s: unknown) => unknown) => sel(state),
    useData: (sel: (s: unknown) => unknown) => sel(state),
    useUi: (sel: (s: unknown) => unknown) => sel(state)
  };
});

import { SquadEditor } from '../SquadEditor.js';

const base: Team = {
  id: 'user:s', name: 'S', orchestratorPersonaId: 'p-orch', source: 'user',
  slots: [{ personaId: 'p-orch', quantity: 1 }, { personaId: 'p-worker', quantity: 1 }]
};
const CHECKBOX = /Start only when its first unit is ready/i;

afterEach(() => { cleanup(); save.mockReset(); });

async function saveTeam() {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as Team;
}

describe('REQ-1 the Team editor offers the on-demand checkbox', () => {
  it('shows the checkbox with the plain help text for a CLI squad', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(screen.getAllByLabelText(CHECKBOX).length).toBeGreaterThan(0);
    expect(screen.getByText(/The seat stays closed until the engine has work for it/)).toBeTruthy();
  });

  it('saves startOnDemand: true on the ticked row only', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const boxes = screen.getAllByLabelText(CHECKBOX);
    fireEvent.click(boxes[boxes.length - 1]!);
    const saved = await saveTeam();
    const worker = saved.slots.find((s) => s.personaId === 'p-worker')!;
    expect(worker.startOnDemand).toBe(true);
    expect(saved.slots.find((s) => s.personaId === 'p-orch')!.startOnDemand).toBeUndefined();
  });

  it('shows a stored true as ticked and keeps it through a save', async () => {
    const team = { ...base, slots: [base.slots[0]!, { personaId: 'p-worker', quantity: 1, startOnDemand: true }] };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    const boxes = screen.getAllByLabelText(CHECKBOX) as HTMLInputElement[];
    expect(boxes[boxes.length - 1]!.checked).toBe(true);
    expect((await saveTeam()).slots[1]!.startOnDemand).toBe(true);
  });

  it('existing-user path: an old team saves with no startOnDemand key', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const saved = await saveTeam();
    for (const slot of saved.slots) expect(slot).not.toHaveProperty('startOnDemand');
  });
});

describe('REQ-8 the toggle is hidden where it cannot work', () => {
  it('hides the checkbox for a Modern squad', () => {
    render(<SquadEditor team={{ ...base, transport: 'MODERN' }} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryAllByLabelText(CHECKBOX)).toHaveLength(0);
  });
});

describe('REQ-2 the Squad view marks an on-demand seat', () => {
  it('labels the seat "Starts when needed" in the read-only squad detail', () => {
    const team = { ...base, slots: [base.slots[0]!, { personaId: 'p-worker', quantity: 1, startOnDemand: true }] };
    render(<SquadEditor team={team} mode="view" onClose={vi.fn()} />);
    expect(screen.getByText('Starts when needed')).toBeTruthy();
  });

  it('shows no label when no seat is on demand', () => {
    render(<SquadEditor team={base} mode="view" onClose={vi.fn()} />);
    expect(screen.queryByText('Starts when needed')).toBeNull();
  });
});
