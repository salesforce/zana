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
      onClick={() => onChange(id === 'team-default-planning' ? (value === '' ? 'provided' : value) : value)}>
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
  const picker = screen.getByLabelText('Squad default planning');
  for (let i = 0; i < clicks; i++) fireEvent.click(picker);
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as { defaultPlanning?: string };
}

describe('SquadEditor default planning', () => {
  it('saves no key with the global default', async () => {
    expect(Object.keys(await cycleAndSave(base, 0))).not.toContain('defaultPlanning');
  });
  it('saves provided when chosen', async () => {
    expect((await cycleAndSave(base, 1)).defaultPlanning).toBe('provided');
  });
  it('shows a stored infer and keeps it when saved unchanged', async () => {
    const team = { ...base, defaultPlanning: 'infer' as const };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByLabelText('Squad default planning').getAttribute('data-value')).toBe('infer');
    cleanup();
    expect((await cycleAndSave(team, 0)).defaultPlanning).toBe('infer');
  });
});
