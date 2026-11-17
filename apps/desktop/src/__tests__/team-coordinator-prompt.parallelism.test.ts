import { describe, expect, it } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';
import { jobCoordinatorPrompt } from '../team-coordinator-prompt.js';

// REQ-22: the Coordination contract tells coordinators to scope units to disjoint, narrow files.
const team: Team = {
  id: 'builtin:squad', name: 'Doc Squad', description: 'x', orchestratorPersonaId: 'lead',
  slots: [{ personaId: 'lead', quantity: 1 }, { personaId: 'worker', quantity: 2 }], source: 'builtin'
};
const roster = [{ sessionId: 's-1', slotId: 'slot-1', label: 'Worker A' }];

describe('jobCoordinatorPrompt — disjoint file scopes (REQ-22)', () => {
  it.each([true, false])('tells coordinators overlapping or empty files scopes serialize work (planReady=%s)', (planReady) => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: { objective: 'Ship' }, roster, planReady });
    expect(prompt).toContain('Give independent units disjoint, narrow files scopes');
    expect(prompt).toMatch(/overlapping scopes run one at a time/i);
  });

  it('puts the guidance inside the Coordination contract block', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: { objective: 'Ship' }, roster, planReady: true });
    const contract = prompt.indexOf('Coordination contract:');
    const guidance = prompt.indexOf('disjoint, narrow files scopes');
    expect(contract).toBeGreaterThanOrEqual(0);
    expect(guidance).toBeGreaterThan(contract);
  });

  it('keeps the existing human-blocker rule in the prompt (existing-user path)', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: { objective: 'Ship' }, roster, planReady: true });
    expect(prompt).toMatch(/human blocker[^.]*Inbox card/i);
  });
});
