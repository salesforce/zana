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
  const state = { personas: [{ id: 'p-orch', name: 'Orch' }, { id: 'p-worker', name: 'Worker' }, { id: 'p-roled', name: 'Roled', roles: ['reviewer'] }], projects: [], pushToast: vi.fn() };
  return {
    usePersonas: (sel: (s: unknown) => unknown) => sel(state),
    useData: (sel: (s: unknown) => unknown) => sel(state),
    useUi: (sel: (s: unknown) => unknown) => sel(state)
  };
});

import { SquadEditor, slotNeedsRolesHint, SLOT_ROLES_HINT } from './SquadEditor';

const team: Team = {
  id: 'user:r', name: 'R', orchestratorPersonaId: 'p-orch', source: 'user',
  slots: [
    { personaId: 'p-orch', quantity: 1, label: 'Lead' },
    { personaId: 'p-worker', quantity: 1 },
    { personaId: 'p-roled', quantity: 1 },
    { personaId: 'p-worker', quantity: 1, roles: ['builder'] }
  ]
};

afterEach(() => { cleanup(); save.mockReset(); });

describe('slotNeedsRolesHint', () => {
  it('needs hint only with no roles and no label', () => {
    expect(slotNeedsRolesHint({}, undefined)).toBe(true);
    expect(slotNeedsRolesHint({ roles: [] }, { roles: [] })).toBe(true);
    expect(slotNeedsRolesHint({ label: '  ' }, undefined)).toBe(true);
    expect(slotNeedsRolesHint({ label: 'Eng' }, undefined)).toBe(false);
    expect(slotNeedsRolesHint({}, { roles: ['a'] })).toBe(false);
    expect(slotNeedsRolesHint({ roles: ['a'] }, { roles: [] })).toBe(false);
  });
});

describe('Squad editor roles hint', () => {
  it('shows the hint only on the unlabeled, roleless slot, and never says Workspace', () => {
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    const hints = screen.getAllByText(SLOT_ROLES_HINT);
    expect(hints).toHaveLength(1);
    expect(SLOT_ROLES_HINT).toMatch(/Squad definition/);
    expect(SLOT_ROLES_HINT).toMatch(/register_teams/);
    expect(SLOT_ROLES_HINT).not.toMatch(/workspace/i);
  });

  it('keeps slot roles through a save', async () => {
    save.mockResolvedValue({ ok: true, value: { name: 'R' } });
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.calls[0]![0] as Team;
    expect(saved.slots[3]!.roles).toEqual(['builder']);
    expect(saved.slots[1]!.roles).toBeUndefined();
  });
});
