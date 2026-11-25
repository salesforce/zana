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
  id: 'user:s', name: 'S', orchestratorPersonaId: 'p-orch', source: 'user', transport: 'CLI',
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
  it('shows a start-on-demand toggle per seat with a legend naming it', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: CHECKBOX })).toHaveLength(2);
    expect(screen.getByTestId('team-slot-legend').textContent).toMatch(/a late review or QA seat uses no session while it waits/);
  });

  it('saves startOnDemand: true on the pressed row only', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: CHECKBOX })[1]!);
    const saved = await saveTeam();
    expect(saved.slots.find((s) => s.personaId === 'p-worker')!.startOnDemand).toBe(true);
    expect(saved.slots.find((s) => s.personaId === 'p-orch')!.startOnDemand).toBeUndefined();
  });

  it('keeps the orchestrator toggle disabled and never saves the flag for it', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const orch = screen.getAllByRole('button', { name: CHECKBOX })[0]!;
    expect(orch.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(orch);
    expect(orch.getAttribute('aria-pressed')).toBe('false');
    expect((await saveTeam()).slots[0]).not.toHaveProperty('startOnDemand');
  });

  it('shows a stored true as pressed and keeps it through a save', async () => {
    const team = { ...base, slots: [base.slots[0]!, { personaId: 'p-worker', quantity: 1, startOnDemand: true }] };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: CHECKBOX })[1]!.getAttribute('aria-pressed')).toBe('true');
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
    expect(screen.queryAllByRole('button', { name: CHECKBOX })).toHaveLength(0);
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
