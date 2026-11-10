/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());
const personas = vi.hoisted(() => ({
  list: [
    { id: 'p-orch', name: 'Orch', skills: ['orch-skill'] },
    { id: 'p-plain', name: 'Plain' },
    { id: 'p-skilled', name: 'Skilled', skills: ['foo'] }
  ] as Array<{ id: string; name: string; skills?: string[] }>
}));

vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save: (...a: unknown[]) => save(...a), delete: vi.fn() } } }));
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: async () => ({ skills: [], commands: [], diagnostics: [] }) }));
vi.mock('../ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../../store.js', () => {
  const state = { get personas() { return personas.list; }, projects: [], pushToast: vi.fn() };
  return {
    usePersonas: (sel: (s: unknown) => unknown) => sel(state),
    useData: (sel: (s: unknown) => unknown) => sel(state),
    useUi: (sel: (s: unknown) => unknown) => sel(state)
  };
});

import { SquadEditor } from '../SquadEditor.js';

const base: Team = {
  id: 'user:s', name: 'S', orchestratorPersonaId: 'p-orch', source: 'user',
  slots: [{ personaId: 'p-orch', quantity: 1 }, { personaId: 'p-plain', quantity: 1 }]
};
const LEAN = /Lean workers/i;
const NOTICE = 'team-lean-persona-skills-notice';

afterEach(() => { cleanup(); save.mockReset(); });

async function saveTeam() {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as Team;
}

describe('Team editor lean workers toggle', () => {
  it('is unchecked by default and an old team saves with no leanWorkers key', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect((screen.getByLabelText(LEAN) as HTMLInputElement).checked).toBe(false);
    expect(await saveTeam()).not.toHaveProperty('leanWorkers');
  });

  it('saves leanWorkers: true when ticked', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(LEAN));
    expect((await saveTeam()).leanWorkers).toBe(true);
  });

  it('shows a stored true as ticked, keeps it, and clears it when unticked', async () => {
    render(<SquadEditor team={{ ...base, leanWorkers: true }} mode="edit" onClose={vi.fn()} />);
    const box = screen.getByLabelText(LEAN) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(await saveTeam()).not.toHaveProperty('leanWorkers');
  });

  it('shows the precedence notice only when lean is on and a worker persona sets skills', () => {
    const team = { ...base, leanWorkers: true, slots: [...base.slots, { personaId: 'p-skilled', quantity: 1 }] };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByTestId(NOTICE).textContent).toMatch(/skills apply even when lean is on: Skilled/);
  });

  it('lists a persona once even when it fills several worker slots', () => {
    const team = {
      ...base,
      leanWorkers: true,
      slots: [...base.slots, { personaId: 'p-skilled', quantity: 1 }, { personaId: 'p-skilled', quantity: 2 }]
    };
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    const text = screen.getByTestId(NOTICE).textContent ?? '';
    expect(text).toMatch(/lean is on: Skilled\.$/);
    expect(text.match(/Skilled/g)).toHaveLength(1);
  });

  it('does not count the orchestrator persona skills, and hides the notice when lean is off', () => {
    const { unmount } = render(<SquadEditor team={{ ...base, leanWorkers: true }} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId(NOTICE)).toBeNull();
    unmount();
    const off = { ...base, slots: [...base.slots, { personaId: 'p-skilled', quantity: 1 }] };
    render(<SquadEditor team={off} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });
});
