/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock('../lib/product-client.js', () => ({ product: { teams: { save, delete: remove } } }));
vi.mock('./ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../store.js', () => {
  const state = {
    personas: [{ id: 'orch', name: 'Orch' }, { id: 'worker', name: 'Worker' }],
    projects: [],
    pushToast
  };
  return {
    usePersonas: (select: (state: typeof state) => unknown) => select(state),
    useData: (select: (state: typeof state) => unknown) => select(state),
    useUi: (select: (state: typeof state) => unknown) => select(state)
  };
});
vi.mock('./ui/PopoverPicklist.js', () => ({
  PopoverPicklist: ({ id, value, onChange, ariaLabel }: { id?: string; value: string; onChange: (value: string) => void; ariaLabel: string }) => (
    <button type="button" id={id} aria-label={ariaLabel} data-value={value} onClick={() => onChange(value === 'inherit' ? 'on' : 'inherit')}>
      {value}
    </button>
  )
}));

import { SquadEditor } from './SquadEditor.js';

const team: Team = {
  id: 'user:dirty',
  name: 'Dirty Squad',
  source: 'user',
  orchestratorPersonaId: 'orch',
  slots: [{ personaId: 'orch' }, { personaId: 'worker', quantity: 2, startOnDemand: true }],
  worktreeIsolation: false,
  retainOrchestrator: true
};

const builtin: Team = { ...team, id: 'builtin:dirty', source: 'builtin' };
const builtinOverride: Team = { ...team, id: 'builtin:dirty', source: 'user' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  save.mockReset();
  remove.mockReset();
  pushToast.mockReset();
});

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
});

function makeDirty() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Changed Squad' } });
}

describe('SquadEditor unsaved drafts', () => {
  it('closes clean forms without prompting, including view then edit', () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    render(<SquadEditor team={team} mode="view" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['Cancel', (container: HTMLElement) => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['header close', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['Escape', (container: HTMLElement) => fireEvent.keyDown(container.querySelector('[role="dialog"]')!, { key: 'Escape' })],
    ['backdrop', (container: HTMLElement) => fireEvent.mouseDown(container.querySelector('.modal-backdrop')!)]
  ])('keeps dirty form open when %s discard is rejected', (_action, close) => {
    const onClose = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(<SquadEditor team={team} mode="edit" onClose={onClose} />);
    makeDirty();
    close(container);
    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved squad edits?');
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Changed Squad');
  });

  it('closes dirty form when discard is accepted', () => {
    const onClose = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SquadEditor team={team} mode="edit" onClose={onClose} />);
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps active input focused through full typing after draft becomes dirty', async () => {
    const { container } = render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('[role="dialog"]')));
    const name = screen.getByLabelText('Name');
    name.focus();
    fireEvent.change(name, { target: { value: 'D' } });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: 'Dirty Squad Updated' } });
    expect(document.activeElement).toBe(name);
    expect((name as HTMLInputElement).value).toBe('Dirty Squad Updated');
  });

  it.each([
    ['Delete', team],
    ['Reset', builtin],
    ['Reset', builtinOverride]
  ] as const)('%s acts without a discard prompt when form is clean', async (label, editableTeam) => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    remove.mockResolvedValue({ ok: true });
    render(<SquadEditor team={editableTeam} mode="edit" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(editableTeam.id));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('becomes clean again after fields and slot settings are restored', () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    render(<SquadEditor team={team} mode="edit" onClose={onClose} />);
    makeDirty();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: team.name } });
    const onDemand = screen.getAllByRole('checkbox', { name: /Start only when its first unit is ready/ })[0]!;
    fireEvent.click(onDemand);
    fireEvent.click(onDemand);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['Delete', team, 'Discard unsaved squad edits and delete this squad?'],
    ['Reset', builtin, 'Discard unsaved squad edits and reset this squad to its built-in default?'],
    ['Reset', builtinOverride, 'Discard unsaved squad edits and reset this squad to its built-in default?']
  ] as const)('%s rejects before API call and deletes after accept', async (label, editableTeam, prompt) => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    remove.mockResolvedValue({ ok: true });
    render(<SquadEditor team={editableTeam} mode="edit" onClose={onClose} />);
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    expect(confirm).toHaveBeenCalledWith(prompt);
    expect(remove).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(editableTeam.id));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('bypasses discard prompt after save succeeds but retains dirty guard after failure', async () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    save.mockResolvedValueOnce({ ok: false, message: 'Denied' });
    render(<SquadEditor team={team} mode="edit" onClose={onClose} />);
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Save failed: Denied', 'error'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    save.mockResolvedValueOnce({ ok: true, value: team });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('remounts initialized draft when entity changes', () => {
    const { rerender } = render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    makeDirty();
    rerender(<SquadEditor team={{ ...team, id: 'user:other', name: 'Other Squad' }} mode="edit" onClose={vi.fn()} />);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Other Squad');
  });
});
