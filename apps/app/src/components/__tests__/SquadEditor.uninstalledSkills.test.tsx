/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());
const caps = vi.hoisted(() => vi.fn());
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: caps }));
vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save: (...a: unknown[]) => save(...a), delete: vi.fn() } } }));
vi.mock('../ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../../store.js', () => {
  const state = {
    personas: [
      { id: 'a', name: 'Alpha', skills: ['review', 'ghost'] },
      { id: 'b', name: 'Beta' }
    ],
    projects: [], pushToast: vi.fn()
  };
  return {
    usePersonas: (sel: (s: unknown) => unknown) => sel(state),
    useData: (sel: (s: unknown) => unknown) => sel(state),
    useUi: (sel: (s: unknown) => unknown) => sel(state)
  };
});

import { SquadEditor } from '../SquadEditor.js';

const mk = (ids: string[]): Team => ({ id: 'user:s', name: 'S', source: 'user', slots: ids.map((personaId) => ({ personaId, quantity: 1 })) });
afterEach(() => { cleanup(); save.mockReset(); caps.mockReset(); });

describe('SquadEditor uninstalled skill warning', () => {
  it('warns for a member persona allowlisting an uninstalled skill; save stays enabled', async () => {
    caps.mockResolvedValue({ skills: [{ name: 'review' }], commands: [], diagnostics: [] });
    render(<SquadEditor team={mk(['a', 'b'])} mode="edit" onClose={vi.fn()} />);
    const warn = await screen.findByTestId('team-uninstalled-skills-warning');
    expect(warn.textContent).toContain('Alpha (ghost)');
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(false);
    save.mockResolvedValue({ ok: true, value: { name: 'S' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
  });

  it('shows nothing when all are installed', async () => {
    caps.mockResolvedValue({ skills: [{ name: 'review' }, { name: 'ghost' }], commands: [], diagnostics: [] });
    render(<SquadEditor team={mk(['a'])} mode="edit" onClose={vi.fn()} />);
    await vi.waitFor(() => expect(caps).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('team-uninstalled-skills-warning')).toBeNull();
  });

  it('does not fetch when no member is restricted', async () => {
    render(<SquadEditor team={mk(['b'])} mode="edit" onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(caps).not.toHaveBeenCalled();
  });
});
