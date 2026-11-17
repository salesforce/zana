/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

// REQ-18: the editor warns about a slot or orchestrator whose persona does not exist (text matches the CLI launch message).
vi.mock('../lib/product-client.js', () => ({ product: { teams: { save: vi.fn(), delete: vi.fn() } } }));
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

const team = (over: Partial<Team> = {}): Team => ({
  id: 'user:r', name: 'R', orchestratorPersonaId: 'p-orch', source: 'user',
  slots: [{ personaId: 'p-worker', quantity: 1 }],
  ...over
});

afterEach(() => cleanup());

describe('Squad editor unresolved persona warning (REQ-18)', () => {
  it('warns about a worker slot whose persona does not exist', () => {
    render(<SquadEditor team={team({ slots: [{ personaId: 'p-worker', quantity: 1 }, { personaId: 'ghost-worker', quantity: 1 }] })} mode="edit" onClose={vi.fn()} />);
    expect(screen.getAllByText(/unknown persona: ghost-worker/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/unknown persona: p-worker/i)).toBeNull();
  });

  it('warns about an orchestrator whose persona does not exist', () => {
    render(<SquadEditor team={team({ orchestratorPersonaId: 'ghost-lead' })} mode="edit" onClose={vi.fn()} />);
    expect(screen.getAllByText(/unknown persona: ghost-lead/i).length).toBeGreaterThan(0);
  });

  it('shows no persona warning when every persona resolves (existing-user path)', () => {
    render(<SquadEditor team={team()} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByText(/unknown persona/i)).toBeNull();
  });

  it('never gates Save on the warning', () => {
    render(<SquadEditor team={team({ slots: [{ personaId: 'ghost-worker', quantity: 1 }] })} mode="edit" onClose={vi.fn()} />);
    const save = screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });
});
