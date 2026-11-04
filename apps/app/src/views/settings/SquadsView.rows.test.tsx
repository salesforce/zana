// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ projectId: null as string | null }));

const save = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save } } }));
vi.mock('@/store', () => ({
  useTeams: (selector: (s: { teams: unknown[]; loading: boolean }) => unknown) =>
    selector({
      teams: [
        { id: 'user:zebra', name: 'Zebra 10', description: 'Last', source: 'user', slots: [] },
        { id: 'builtin:core', name: 'Core squad', description: 'Core', source: 'builtin', slots: [] },
        { id: 'user:alpha-10', name: 'Alpha 10', description: 'Ten', source: 'user', slots: [] },
        { id: 'user:accent', name: 'Álpha 1', description: 'Accent', source: 'user', slots: [] },
        { id: 'user:alpha-2', name: 'alpha 2', description: 'Two', source: 'user', slots: [] },
        { id: 'user:mine', name: 'My squad', description: 'Mine', source: 'user', slots: [{ personaId: 'p1' }], transport: 'MODERN', isDefault: true },
        { id: 'user:tie-z', name: 'Same', description: 'Tie z', source: 'user', slots: [] },
        { id: 'user:tie-a', name: 'Same', description: 'Tie a', source: 'user', slots: [] },
        { id: 'project:a', name: 'Project A', description: 'In scope', source: { projectId: 'project-a', projectName: 'A' }, slots: [] },
        { id: 'project:b', name: 'Project B', description: 'Out of scope', source: { projectId: 'project-b', projectName: 'B' }, slots: [] }
      ],
      loading: false
    }),
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] }),
  useUi: (selector: (s: { pushToast: () => void }) => unknown) => selector({ pushToast: toast }),
  usePersonas: (selector: (s: { personas: unknown[] }) => unknown) =>
    selector({ personas: [{ id: 'p1', name: 'Planner', source: 'user' }] })
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => scope.projectId }));
vi.mock('@/components/SquadEditor', () => ({ SquadEditor: () => null }));

import { SquadsView } from './SquadsView';

afterEach(() => {
  save.mockReset();
  toast.mockReset();
  scope.projectId = null;
  cleanup();
});

describe('SquadsView settings-search targets', () => {
  it('tags each squad row with squads.squad.<id>', () => {
    const { container } = render(<SquadsView />);
    expect(container.querySelector('li[data-settings-target="squads.squad.builtin:core"]')).not.toBeNull();
    expect(container.querySelector('li[data-settings-target="squads.squad.user:mine"]')).not.toBeNull();
  });
});

describe('SquadsView transport labels', () => {
  it('shows the same kind pill members will carry: CLI Agent for CLI, Thread for Modern', () => {
    const { container } = render(<SquadsView />);
    const cli = container.querySelector('li[data-settings-target="squads.squad.builtin:core"]')!;
    const modern = container.querySelector('li[data-settings-target="squads.squad.user:mine"]')!;
    expect(cli.getAttribute('data-squad-transport')).toBe('CLI');
    expect(cli.querySelector('.fleet-kind-chip')?.getAttribute('data-kind')).toBe('agent');
    expect(cli.querySelector('.fleet-kind-chip')?.textContent).toBe('CLI Agent');
    expect(cli.classList.contains('is-modern')).toBe(false);
    expect(modern.getAttribute('data-squad-transport')).toBe('MODERN');
    expect(modern.querySelector('.fleet-kind-chip')?.getAttribute('data-kind')).toBe('thread');
    expect(modern.querySelector('.fleet-kind-chip')?.textContent).toBe('Modern');
    expect(modern.classList.contains('is-modern')).toBe(true);
  });

  it('marks a Modern squad agent with the dotted is-modern modifier when expanded', () => {
    const { container } = render(<SquadsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand My squad to see agents' }));
    const item = container.querySelector('li[data-settings-target="squads.squad.user:mine"] .teams-agent-item');
    expect(item).not.toBeNull();
    expect(item!.classList.contains('is-modern')).toBe(true);
  });
});

describe('SquadsView empty squad', () => {
  it('shows the empty-agents message when an expanded squad has no slots or orchestrator', () => {
    const { container } = render(<SquadsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Core squad to see agents' }));
    const empty = container.querySelector('li[data-settings-target="squads.squad.builtin:core"] .teams-agents-empty');
    expect(empty?.textContent).toContain('No agents configured for this squad');
  });
});

describe('SquadsView catalogue order', () => {
  it('sorts filtered rows while keeping source counts based on scoped raw squads', () => {
    const { container } = render(<SquadsView />);

    expect(Array.from(container.querySelectorAll('.skills-row-name')).map((node) => node.textContent)).toEqual([
      'Álpha 1', 'alpha 2', 'Alpha 10', 'Core squad', 'My squad', 'Project A', 'Project B', 'Same', 'Same', 'Zebra 10'
    ]);
    expect(Array.from(container.querySelectorAll('.skills-filter-count')).map((node) => node.textContent)).toEqual([
      '10', '1', '7', '2', '0'
    ]);

    fireEvent.click(screen.getByRole('tab', { name: /User 7/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search squads' }), { target: { value: 'same' } });
    expect(Array.from(container.querySelectorAll('.skills-row')).map((node) => node.getAttribute('data-settings-target'))).toEqual([
      'squads.squad.user:tie-a', 'squads.squad.user:tie-z'
    ]);
  });

  it('keeps only current project squads in a scoped window', () => {
    scope.projectId = 'project-a';
    const { container } = render(<SquadsView />);

    expect(container.querySelector('[data-settings-target="squads.squad.project:a"]')).not.toBeNull();
    expect(container.querySelector('[data-settings-target="squads.squad.project:b"]')).toBeNull();
    expect(screen.getByRole('tab', { name: /All 9/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Project 1/ })).toBeDefined();
  });
});

describe('SquadsView default squad', () => {
  const rowOf = (container: HTMLElement, id: string) => container.querySelector(`li[data-settings-target="squads.squad.${id}"]`)!;

  it('shows the default tag only on the flagged squad', () => {
    const { container } = render(<SquadsView />);
    expect(rowOf(container, 'user:mine').querySelector('.scheduler-pill--default')?.textContent?.trim()).toBe('Default');
    expect(rowOf(container, 'builtin:core').querySelector('.scheduler-pill--default')).toBeNull();
  });

  it('saves a full copy flagged as default from the row menu', () => {
    save.mockResolvedValue({ ok: true, value: {} });
    const { container } = render(<SquadsView />);
    fireEvent.contextMenu(rowOf(container, 'builtin:core').querySelector('.skills-row-open')!);
    fireEvent.click(screen.getByRole('menuitem', { name: /Set as default/ }));
    expect(save).toHaveBeenCalledOnce();
    const input = save.mock.calls[0][0];
    expect(input).toMatchObject({ id: 'builtin:core', name: 'Core squad', isDefault: true });
    expect(input).not.toHaveProperty('source');
  });

  it('clears the flag on the current default', () => {
    save.mockResolvedValue({ ok: true, value: {} });
    const { container } = render(<SquadsView />);
    fireEvent.contextMenu(rowOf(container, 'user:mine').querySelector('.skills-row-open')!);
    fireEvent.click(screen.getByRole('menuitem', { name: /Clear default/ }));
    expect(save.mock.calls[0][0].isDefault).toBeUndefined();
  });

  const openMenuAndSetDefault = async (container: HTMLElement, id: string) => {
    fireEvent.contextMenu(rowOf(container, id).querySelector('.skills-row-open')!);
    fireEvent.click(screen.getByRole('menuitem', { name: /Set as default/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
  };

  it('toasts an error when the save result is unsuccessful', async () => {
    save.mockResolvedValue({ ok: false, message: 'disk full' });
    const { container } = render(<SquadsView />);
    await openMenuAndSetDefault(container, 'user:alpha-10');
    expect(toast).toHaveBeenCalledWith('Could not update default squad: disk full', 'error');
  });

  it('toasts an error instead of an unhandled rejection when save rejects', async () => {
    save.mockRejectedValue(new Error('ipc down'));
    const { container } = render(<SquadsView />);
    await openMenuAndSetDefault(container, 'user:alpha-10');
    expect(toast).toHaveBeenCalledWith('Could not update default squad: ipc down', 'error');
  });

  it('says a user copy was saved when defaulting a non-user squad', async () => {
    save.mockResolvedValue({ ok: true, value: {} });
    const { container } = render(<SquadsView />);
    await openMenuAndSetDefault(container, 'builtin:core');
    expect(toast.mock.calls[0][0]).toContain('Saved as a user copy');
  });

  it('keeps menu ref order matching visual order: Default before Delete', () => {
    const { container } = render(<SquadsView />);
    fireEvent.contextMenu(rowOf(container, 'user:alpha-10').querySelector('.skills-row-open')!);
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent?.trim());
    expect(labels).toEqual(['Edit', 'Reveal folder', 'Duplicate', 'Set as default', 'Delete']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(document.activeElement?.textContent?.trim()).toBe('Delete');
  });
});
