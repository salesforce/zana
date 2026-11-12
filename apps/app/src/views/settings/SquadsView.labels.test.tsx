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

import { SquadsView } from './SquadsView';

afterEach(cleanup);

function expand(name: string, id: string) {
  const { container } = render(<SquadsView />);
  fireEvent.click(screen.getByRole('button', { name: `Expand ${name} to see agents` }));
  return Array.from(
    container.querySelectorAll(`li[data-settings-target="squads.squad.${id}"] .teams-agent-item`)
  ).map((el) => ({
    name: el.querySelector('.teams-agent-name')?.textContent,
    chip: el.querySelector('[data-testid="teams-agent-persona-chip"]')?.textContent ?? null
  }));
}

describe('SquadsView member label + persona', () => {
  it('leads with the label and shows the persona as a chip (orchestrator label from its slot)', () => {
    const rows = expand('Labeled squad', 'user:labeled');
    expect(rows[0]).toEqual({ name: 'Coordinator', chip: 'Planner' });
    expect(rows[1]).toEqual({ name: 'Engineer', chip: 'Builder' });
  });

  it('omits the chip when the label equals the persona name, is blank, or is absent', () => {
    const rows = expand('Labeled squad', 'user:labeled');
    expect(rows[2]).toEqual({ name: 'Builder', chip: null });
    expect(rows[3]).toEqual({ name: 'Builder', chip: null });
    expect(rows[4]).toEqual({ name: 'Builder', chip: null });
  });

  it('uses the persona id as the chip for an unknown persona', () => {
    const rows = expand('Labeled squad', 'user:labeled');
    expect(rows[5]).toEqual({ name: 'Reviewer', chip: 'ghost' });
  });

  it('shows the persona name alone for an orchestrator without a label', () => {
    const rows = expand('Plain orch squad', 'user:plain-orch');
    expect(rows).toEqual([{ name: 'Planner', chip: null }]);
  });
});
