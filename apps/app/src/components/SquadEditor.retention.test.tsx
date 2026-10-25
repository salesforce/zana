/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());
vi.mock('../lib/product-client.js', () => ({ product: { teams: { save, delete: vi.fn() } } }));
vi.mock('./ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../store.js', () => {
  const state = { personas: [], projects: [], pushToast };
  return {
    usePersonas: (select: (s: typeof state) => unknown) => select(state),
    useData: (select: (s: typeof state) => unknown) => select(state),
    useUi: (select: (s: typeof state) => unknown) => select(state)
  };
});

import { SquadEditor } from './SquadEditor.js';

const team: Team = { id: 'retention', name: 'Retention', source: 'user', slots: [{ personaId: 'worker' }] };
const label = 'Keep orchestrator running after completion';
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('SquadEditor orchestrator retention', () => {
  it('defaults a new Squad to retention off', () => {
    render(<SquadEditor team={null} mode="edit" onClose={vi.fn()} />);
    expect((screen.getByRole('checkbox', { name: label }) as HTMLInputElement).checked).toBe(false);
  });

  it.each([undefined, false, true])('loads %s and saves through the Team client', async (retainOrchestrator) => {
    const onClose = vi.fn();
    save.mockResolvedValue({ ok: true, value: team });
    render(<SquadEditor team={{ ...team, retainOrchestrator }} mode="edit" onClose={onClose} />);
    expect((screen.getByRole('checkbox', { name: label }) as HTMLInputElement).checked).toBe(retainOrchestrator === true);
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: team.id, retainOrchestrator: retainOrchestrator === true }));
  });

  it.each([false, true])('toggles stored %s without saving until Save', async (retainOrchestrator) => {
    save.mockResolvedValue({ ok: true, value: team });
    render(<SquadEditor team={{ ...team, retainOrchestrator }} mode="edit" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: label }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ retainOrchestrator: !retainOrchestrator })));
  });

  it('keeps the draft open when main rejects the save', async () => {
    const onClose = vi.fn();
    save.mockResolvedValue({ ok: false, message: 'Write denied' });
    render(<SquadEditor team={team} mode="edit" onClose={onClose} />);
    fireEvent.click(screen.getByRole('checkbox', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Save failed: Write denied', 'error'));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('checkbox', { name: label }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement).disabled).toBe(false);
  });
});
