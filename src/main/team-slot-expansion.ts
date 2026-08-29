import type { Team } from '../shared/types.js';

export const MAX_TEAM_TABS = 32;
export const TEAM_SLOT_MAX = 16;

export interface ExpandedTeamSlot {
  slotId: string;
  personaId: string;
  role: 'worker' | 'orchestrator';
}

/** Host-owned expansion shared by Team authorization and workflow preflight. */
export function expandTeamSlots(team: Team): ExpandedTeamSlot[] {
  const slots: ExpandedTeamSlot[] = [];
  const orchestratorId = team.orchestratorPersonaId;
  const workerLimit = orchestratorId ? MAX_TEAM_TABS - 1 : MAX_TEAM_TABS;
  outer: for (const [rowIndex, slot] of team.slots.entries()) {
    if (orchestratorId && slot.personaId === orchestratorId) continue;
    const quantity = Math.max(1, Math.min(TEAM_SLOT_MAX, slot.quantity ?? 1));
    for (let index = 0; index < quantity; index += 1) {
      if (slots.length >= workerLimit) break outer;
      slots.push({ slotId: `${rowIndex}:${slot.personaId}:${index}`, personaId: slot.personaId, role: 'worker' });
    }
  }
  if (orchestratorId && slots.length < MAX_TEAM_TABS) {
    slots.push({ slotId: `orchestrator:${orchestratorId}`, personaId: orchestratorId, role: 'orchestrator' });
  }
  return slots;
}
