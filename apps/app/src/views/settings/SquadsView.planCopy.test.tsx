// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save: vi.fn() } } }));
vi.mock('@/store', () => ({
  useTeams: (selector: (s: { teams: unknown[]; loading: boolean }) => unknown) =>
    selector({
      teams: [
        {
          id: 'user:labeled',
          name: 'Labeled squad',
          description: 'Labels',
          source: 'user',
          orchestratorPersonaId: 'p1',
          slots: [
            { personaId: 'p1', label: 'Coordinator' },
            { personaId: 'p2', label: 'Engineer', quantity: 2 },
            { personaId: 'p2', label: 'Builder' },
            { personaId: 'p2', label: '   ' },
            { personaId: 'p2' },
            { personaId: 'ghost', label: 'Reviewer' }
          ]
        },
        {
          id: 'user:plain-orch',
          name: 'Plain orch squad',
          description: 'No orchestrator label',
          source: 'user',
          orchestratorPersonaId: 'p1',
          slots: []
        }
      ],
      loading: false
    }),
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] }),
  useUi: (selector: (s: { pushToast: () => void }) => unknown) => selector({ pushToast: vi.fn() }),
  usePersonas: (selector: (s: { personas: unknown[] }) => unknown) =>
    selector({
      personas: [
        { id: 'p1', name: 'Planner', source: 'user' },
        { id: 'p2', name: 'Builder', source: 'user' }
      ]
    })
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/components/SquadEditor', () => ({ SquadEditor: () => null }));

import { SquadsView, SQUAD_PLANS_DOCS_URL } from './SquadsView';

afterEach(() => cleanup());

describe('Squads plan copy line', () => {
  it('points to the brainstorm skill and links the Squad plans docs page', () => {
    render(<SquadsView />);
    expect(screen.getByText(/Writing a plan for this Squad\? Ask an agent to brainstorm it\./)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Squad plans' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://zana-ide.com/docs/squads-plans/');
    expect(SQUAD_PLANS_DOCS_URL).toBe(link.getAttribute('href'));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
