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

  it('rounds non-whole-minute stored limits so the Squad stays saveable, and clamps to bounds', async () => {
    render(<SquadEditor team={{ ...base, limits: { claimWallClockMs: 90_000, claimStallMs: 100_000 } }} mode="edit" onClose={vi.fn()} />);
    expect(field(/wall-clock/).value).toBe('2');
    expect(field(/stall/).value).toBe('2');
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((await saveTeam()).limits).toEqual({ claimWallClockMs: 120_000, claimStallMs: 120_000 });
  });

  it('clamps an out-of-range stored limit into the bounds', () => {
    render(<SquadEditor team={{ ...base, limits: { claimWallClockMs: 1_000, claimStallMs: 999_999_999_999 } }} mode="edit" onClose={vi.fn()} />);
    expect(field(/wall-clock/).value).toBe('1');
    expect(field(/stall/).value).toBe('1440');
  });

  it('sources placeholders and max from shared constants', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(field(/Max sessions/).placeholder).toBe('32');
    expect(field(/wall-clock/).placeholder).toBe('20');
    expect(field(/stall/).placeholder).toBe('10');
    expect(field(/wall-clock/).max).toBe('1440');
    expect(field(/stall/).max).toBe('1440');
  });

  it('saves a typed value converted to milliseconds', async () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    fireEvent.change(field(/Max sessions/), { target: { value: '6' } });
    fireEvent.change(field(/wall-clock/), { target: { value: '45' } });
    expect((await saveTeam()).limits).toEqual({ maxConcurrent: 6, claimWallClockMs: 2_700_000 });
  });

  it('shows, validates and saves the output-only ceiling in minutes', async () => {
    render(<SquadEditor team={{ ...base, limits: { claimOutputCeilingMs: 2_700_000 } }} mode="edit" onClose={vi.fn()} />);
    expect(field(/Output-only ceiling/).value).toBe('45');
    expect(field(/Output-only ceiling/).placeholder).toBe('30');
    fireEvent.change(field(/Output-only ceiling/), { target: { value: '0' } });
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('team-run-limits-error').textContent).toMatch(/Output-only ceiling must be/);
    fireEvent.change(field(/Output-only ceiling/), { target: { value: '15' } });
    expect((await saveTeam()).limits).toEqual({ claimOutputCeilingMs: 900_000 });
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
