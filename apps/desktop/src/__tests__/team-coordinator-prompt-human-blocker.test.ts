import { describe, expect, it } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';
import { jobCoordinatorPrompt } from '../team-coordinator-prompt.js';

const team: Team = {
  id: 'builtin:squad', name: 'Doc Squad', description: 'x', orchestratorPersonaId: 'lead',
  slots: [{ personaId: 'lead', quantity: 1 }, { personaId: 'worker', quantity: 2 }], source: 'builtin'
};
const roster = [{ sessionId: 's-1', slotId: 'slot-1', label: 'Worker A' }];

describe('jobCoordinatorPrompt — human blockers go to the owner Inbox card (#692, REQ-5)', () => {
  it.each([true, false])('tells the PM not to answer a human blocker and to point the owner at the Inbox card (planReady=%s)', (planReady) => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: { objective: 'Ship' }, roster, planReady });
    expect(prompt).toMatch(/human blocker[^.]*Inbox card/i);
    expect(prompt).toMatch(/never[^.]*execution\.work\.answer[^.]*human blocker|human blocker[^.]*never[^.]*execution\.work\.answer/i);
    expect(prompt).toContain('named in the denial');
  });
});
