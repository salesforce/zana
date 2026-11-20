/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());
vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save: (...a: unknown[]) => save(...a), delete: vi.fn() } } }));
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: async () => ({ skills: [], commands: [], diagnostics: [] }) }));
vi.mock('../ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../../store.js', () => {
  const state = { personas: [{ id: 'p-orch', name: 'Orch' }, { id: 'p-plain', name: 'Plain' }], projects: [], pushToast: vi.fn() };
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
const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;

afterEach(() => { cleanup(); save.mockReset(); });

async function saveTeam() {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as Team;
}

describe('Squad editor run limits', () => {
  it('shows blank fields and saves no limits key for a Squad without them', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(field(/Max sessions/).value).toBe('');
    expect(await saveTeam()).not.toHaveProperty('limits');
  });

  it('shows stored limits (claim limits in minutes) and round-trips them', async () => {
    render(<SquadEditor team={{ ...base, limits: { maxConcurrent: 4, claimWallClockMs: 1_800_000, claimStallMs: 300_000 } }} mode="edit" onClose={vi.fn()} />);
    expect(field(/Max sessions/).value).toBe('4');
    expect(field(/wall-clock/).value).toBe('30');
    expect(field(/stall/).value).toBe('5');
    expect((await saveTeam()).limits).toEqual({ maxConcurrent: 4, claimWallClockMs: 1_800_000, claimStallMs: 300_000 });
  });

  it('saves a typed value converted to milliseconds', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    fireEvent.change(field(/Max sessions/), { target: { value: '6' } });
    fireEvent.change(field(/wall-clock/), { target: { value: '45' } });
    expect((await saveTeam()).limits).toEqual({ maxConcurrent: 6, claimWallClockMs: 2_700_000 });
  });

  it('blocks save and explains an out-of-range or fractional value', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const saveButton = screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement;
    for (const [label, value, message] of [
      [/Max sessions/, '33', /Max sessions must be/],
      [/Max sessions/, '0', /Max sessions must be/],
      [/wall-clock/, '0', /wall-clock must be/],
      [/stall/, '1.5', /stall must be/]
    ] as const) {
      fireEvent.change(field(label), { target: { value } });
      expect(saveButton.disabled).toBe(true);
      expect(screen.getByTestId('team-run-limits-error').textContent).toMatch(message);
      fireEvent.change(field(label), { target: { value: '' } });
      expect(saveButton.disabled).toBe(false);
    }
  });
});
