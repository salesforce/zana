import { describe, expect, it } from 'vitest';
import { expandTeamSlots } from '../team-slot-expansion.js';

describe('expandTeamSlots', () => {
  it('uses stable host slot ids and reserves orchestrator capacity', () => {
    const slots = expandTeamSlots({
      id: 'team-1', name: 'Team', orchestratorPersonaId: 'controller',
      slots: [{ personaId: 'worker', quantity: 2 }, { personaId: 'controller', quantity: 4 }]
    });
    expect(slots).toEqual([
      { slotId: '0:worker:0', personaId: 'worker', role: 'worker' },
      { slotId: '0:worker:1', personaId: 'worker', role: 'worker' },
      { slotId: 'orchestrator:controller', personaId: 'controller', role: 'orchestrator' }
    ]);
  });

  it('dedupes a redundant orchestrator worker row into a single orchestrator tab', () => {
    // The Squad editor persists the standalone orchestrator as a quantity-1 slot
    // row on save; expansion must fold it back out (skip the matching worker rows,
    // append exactly one orchestrator tab) so the saved squad gains no extra tab.
    const slots = expandTeamSlots({
      id: 'team-2', name: 'Team', orchestratorPersonaId: 'controller',
      slots: [{ personaId: 'controller', quantity: 1 }, { personaId: 'worker', quantity: 1 }]
    });
    expect(slots).toEqual([
      { slotId: '1:worker:0', personaId: 'worker', role: 'worker' },
      { slotId: 'orchestrator:controller', personaId: 'controller', role: 'orchestrator' }
    ]);
  });
});
