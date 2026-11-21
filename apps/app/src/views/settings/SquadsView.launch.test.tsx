// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  scope: null as string | null,
  projects: [] as Array<{ id: string; name: string }>,
  toast: vi.fn(),
  openSquadLauncher: vi.fn()
}));

vi.mock('../../lib/product-client.js', () => ({ product: { teams: {} } }));
vi.mock('@/store', () => ({
  useTeams: (selector: (s: { teams: unknown[]; loading: boolean }) => unknown) =>
    selector({ teams: [{ id: 'user:mine', name: 'My squad', source: 'user', slots: [{ personaId: 'p1' }] }], loading: false }),
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: h.projects }),
  useUi: (selector: (s: unknown) => unknown) => selector({ pushToast: h.toast, openSquadLauncher: h.openSquadLauncher }),
  usePersonas: (selector: (s: { personas: unknown[] }) => unknown) => selector({ personas: [{ id: 'p1', name: 'Planner', source: 'user' }] })
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => h.scope }));
vi.mock('@/components/SquadEditor', () => ({ SquadEditor: () => null }));

import { SquadsView } from './SquadsView';

afterEach(() => {
  cleanup();
  h.scope = null;
  h.projects = [];
  h.toast.mockReset();
  h.openSquadLauncher.mockReset();
});

describe('SquadsView Launch opens the New Agent dialog', () => {
  it('opens the launcher with the Squad and the only project', () => {
    h.projects = [{ id: 'p-one', name: 'One' }];
    render(<SquadsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Launch My squad' }));
    expect(h.openSquadLauncher).toHaveBeenCalledExactlyOnceWith('p-one', 'user:mine');
  });

  it('asks which project when there are several, then opens the launcher', () => {
    h.projects = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
    render(<SquadsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Launch My squad' }));
    expect(h.openSquadLauncher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /Beta/ }));
    expect(h.openSquadLauncher).toHaveBeenCalledExactlyOnceWith('b', 'user:mine');
  });

  it('locks to the scoped project in a per-project window', () => {
    h.projects = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
    h.scope = 'b';
    render(<SquadsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Launch My squad' }));
    expect(h.openSquadLauncher).toHaveBeenCalledExactlyOnceWith('b', 'user:mine');
  });

  it('toasts instead of opening when there is no project', () => {
    render(<SquadsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Launch My squad' }));
    expect(h.openSquadLauncher).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith('Add a project before launching a squad.', 'error');
  });
});
