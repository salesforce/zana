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
vi.mock('./ui/PopoverPicklist.js', () => ({
  PopoverPicklist: ({ id, value, onChange, ariaLabel }: { id: string; value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <button type="button" id={id} aria-label={ariaLabel} data-value={value}
      onClick={() => onChange(id === 'team-launch-approval' ? (value === '' ? 'review' : value === 'review' ? 'bogus' : '') : value)}>
      {value}
    </button>
  )
}));

import { SquadEditor } from './SquadEditor.js';

const base: Team = {
  id: 'user:s', name: 'S', orchestratorPersonaId: 'p-orch', source: 'user',
  slots: [{ personaId: 'p-orch', quantity: 1 }, { personaId: 'p-worker', quantity: 1 }]
};

afterEach(() => { cleanup(); save.mockReset(); });

async function clickAndSave(team: Team, clicks: number) {
  save.mockResolvedValue({ ok: true, value: { name: 'S' } });
  render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
  for (let i = 0; i < clicks; i++) fireEvent.click(screen.getByLabelText('Squad launch approval'));
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  return save.mock.calls[0]![0] as { launchApproval?: string };
}

describe('SquadEditor launch approval', () => {
  it('saves no key when inheriting the Project setting', async () => {
    expect(Object.keys(await clickAndSave(base, 0))).not.toContain('launchApproval');
  });
  it('saves review when chosen', async () => {
    expect((await clickAndSave(base, 1)).launchApproval).toBe('review');
  });
  it('treats a non-policy value as inherit', async () => {
    expect(Object.keys(await clickAndSave(base, 2))).not.toContain('launchApproval');
  });
  it('drops a saved review when switched back to inherit', async () => {
    expect(Object.keys(await clickAndSave({ ...base, launchApproval: 'review' }, 1))).not.toContain('launchApproval');
  });
  it('keeps a stored direct setting when saved unchanged', async () => {
    expect((await clickAndSave({ ...base, launchApproval: 'direct' }, 0)).launchApproval).toBe('direct');
  });
});
