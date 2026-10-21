// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/product-client.js', () => ({ product: { teams: {} } }));
vi.mock('@/store', () => ({
  useTeams: (selector: (s: { teams: unknown[]; loading: boolean }) => unknown) =>
    selector({
      teams: [
        { id: 'builtin:core', name: 'Core squad', description: 'Core', source: 'builtin', slots: [] },
        { id: 'user:mine', name: 'My squad', description: 'Mine', source: 'user', slots: [{ personaId: 'p1' }], transport: 'MODERN' }
      ],
      loading: false
    }),
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] }),
  useUi: (selector: (s: { pushToast: () => void }) => unknown) => selector({ pushToast: () => undefined }),
  usePersonas: (selector: (s: { personas: unknown[] }) => unknown) =>
    selector({ personas: [{ id: 'p1', name: 'Planner', source: 'user' }] })
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/components/SquadEditor', () => ({ SquadEditor: () => null }));

import { SquadsView } from './SquadsView';

afterEach(cleanup);

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
