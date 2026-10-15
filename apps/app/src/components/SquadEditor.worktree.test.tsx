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

async function cycleAndSave(team: Team, clicks: number) {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
  const picker = screen.getByLabelText('Squad worktree isolation');
  for (let i = 0; i < clicks; i++) fireEvent.click(picker);
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as { worktreeIsolation?: boolean };
}

describe('SquadEditor worktree isolation tri-state', () => {
  it('defaults to inherit and saves undefined', async () => {
    expect((await cycleAndSave(base, 0)).worktreeIsolation).toBeUndefined();
  });
  it('maps On to true', async () => {
    expect((await cycleAndSave(base, 1)).worktreeIsolation).toBe(true);
  });
  it('maps Off to false', async () => {
    expect((await cycleAndSave(base, 2)).worktreeIsolation).toBe(false);
  });
  it('maps back to inherit and preserves a stored false on load', async () => {
    expect((await cycleAndSave({ ...base, worktreeIsolation: false }, 1)).worktreeIsolation).toBeUndefined();
  });
  it('shows a stored false as off', () => {
    render(<SquadEditor team={{ ...base, worktreeIsolation: false }} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByLabelText('Squad worktree isolation').getAttribute('data-value')).toBe('off');
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
