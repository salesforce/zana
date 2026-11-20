/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ personas: [] as Array<{ id: string; name: string }>, projects: [], pushToast: () => undefined }));
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save: (...a: unknown[]) => save(...a), delete: vi.fn() } } }));
vi.mock('../ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../../store.js', () => ({
  usePersonas: (sel: (s: unknown) => unknown) => sel(state),
  useData: (sel: (s: unknown) => unknown) => sel(state),
  useUi: (sel: (s: unknown) => unknown) => sel(state)
}));

import { SquadEditor } from '../SquadEditor.js';

const mk = (ids: string[], orchestratorPersonaId?: string): Team => ({
  id: 'user:s', name: 'S', source: 'user', ...(orchestratorPersonaId ? { orchestratorPersonaId } : {}),
  slots: ids.map((personaId) => ({ personaId, quantity: 1 }))
});
afterEach(() => { cleanup(); save.mockReset(); state.personas = []; });

describe('SquadEditor unresolved persona warning', () => {
  it('warns for unknown slot and orchestrator ids, deduplicated, and still allows save', async () => {
    state.personas = [{ id: 'a', name: 'Alpha' }];
    render(<SquadEditor team={mk(['a', 'ghost', 'ghost'], 'lost')} mode="edit" onClose={vi.fn()} />);
    const warn = screen.getByTestId('team-unresolved-persona-warning');
    expect(warn.textContent).toContain('Unknown persona: lost, ghost.');
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(false);
    save.mockResolvedValue({ ok: true, value: { name: 'S' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
  });

  it('shows nothing when every persona resolves', () => {
    state.personas = [{ id: 'a', name: 'Alpha' }];
    render(<SquadEditor team={mk(['a'])} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId('team-unresolved-persona-warning')).toBeNull();
  });

  it('stays quiet while the persona list is still empty', () => {
    render(<SquadEditor team={mk(['ghost'])} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId('team-unresolved-persona-warning')).toBeNull();
  });
});
