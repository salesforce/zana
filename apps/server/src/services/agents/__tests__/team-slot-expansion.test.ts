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
});
