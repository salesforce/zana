import { LAB_SCENARIOS, type LabScenario } from './agentforce-lab-contract.js';
import type { PreviewContextVariable } from './preview-context.js';

export const SCENARIOS_CHANGED = 'salesforce.scenarios.changed';
export const SCENARIO_LIBRARY_RPC = { list: 'studio.scenarios.list', save: 'studio.scenarios.save', remove: 'studio.scenarios.remove' } as const;
export const SCENARIO_LIBRARY_LIMITS = { perAgent: 30, perProject: 150, agents: 50, bytes: 4_000_000 } as const;
export interface SavedScenario extends LabScenario {
  id: string; name: string; revision: number; updatedAt: number;
  contextVariables: PreviewContextVariable[];
}
export type ScenarioDefinition = LabScenario & { name: string; contextVariables?: PreviewContextVariable[] };
export function starterScenarios(): SavedScenario[] {
  return LAB_SCENARIOS.map((row, index) => ({ ...structuredClone(row.scenario), id: `starter-${index + 1}`, name: row.name, revision: 1, updatedAt: 0, contextVariables: [] }));
}
/** A runner owns this detached copy, including the revision that supplied its setup. */
export function scenarioSnapshot(row: SavedScenario): ScenarioDefinition {
  return structuredClone({ name: row.name, persona: row.persona, goal: row.goal, opening: row.opening, criteria: row.criteria, maxTurns: row.maxTurns,
    origin: { id: row.id, name: row.name, revision: row.revision }, contextVariables: row.contextVariables });
}
