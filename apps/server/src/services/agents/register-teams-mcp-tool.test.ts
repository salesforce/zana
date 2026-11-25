import { describe, it, expect } from 'vitest';
import { registerListTeamsTool, LIST_TEAMS_DESCRIPTION } from './register-teams-mcp-tool.js';
import { toTeamSummary, type Team, type TeamSummary } from '@zana-ai/zcc-domain/product';

type ToolHandler = () => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;

function register(listTeams: () => TeamSummary[]) {
  let def: { description: string } | undefined;
  let handler: ToolHandler | undefined;
  const server = {
    registerTool: (_name: string, d: { description: string }, h: ToolHandler) => { def = d; handler = h; }
  };
  registerListTeamsTool(server as never, { listTeams });
  return { def: def!, call: async () => JSON.parse((await handler!()).content[0]!.text!) as Array<Record<string, unknown>> };
}

const base = { id: 't1', name: 'T', slotCount: 2, source: 'user' } as unknown as TeamSummary;

describe('list_teams', () => {
  it('describes the planning fields', () => {
    expect(register(() => []).def.description).toBe(LIST_TEAMS_DESCRIPTION);
    expect(LIST_TEAMS_DESCRIPTION).toContain('canInferPlan false');
  });

  it('passes defaultPlanning and canInferPlan through unchanged', async () => {
    const out = await register(() => [{ ...base, defaultPlanning: 'provided', canInferPlan: false }]).call();
    expect(out[0]).toMatchObject({ defaultPlanning: 'provided', canInferPlan: false });
  });

  it('does not add the keys when absent', async () => {
    const out = await register(() => [base]).call();
    expect(Object.keys(out[0]!)).not.toContain('defaultPlanning');
    expect(Object.keys(out[0]!)).not.toContain('canInferPlan');
  });

  it('returns an empty list and reports failures', async () => {
    expect(await register(() => []).call()).toEqual([]);
    let handler: ToolHandler | undefined;
    registerListTeamsTool({ registerTool: (_n: string, _d: unknown, h: ToolHandler) => { handler = h; } } as never,
      { listTeams: () => { throw new Error('boom'); } });
    const res = await handler!();
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('boom');
  });

  it('returns slots with their effective roles (slot roles win, persona roles are the fallback)', async () => {
    const team = { id: 't1', name: 'T', slots: [
      { personaId: 'p1', quantity: 1, roles: ['reviewer'] },
      { personaId: 'p2', quantity: 1 },
      { personaId: 'p3', quantity: 1 }
    ] } as unknown as Team;
    const personas: Record<string, { roles?: string[] }> = { p1: { roles: ['engineer'] }, p2: { roles: ['engineer'] }, p3: {} };
    const out = await register(() => [toTeamSummary(team, (id) => personas[id] as never)]).call();
    const slots = out[0]!.slots as Array<{ personaId: string; roles?: string[] }>;
    expect(slots.find((s) => s.personaId === 'p1')!.roles).toEqual(['reviewer']);
    expect(slots.find((s) => s.personaId === 'p2')!.roles).toEqual(['engineer']);
    expect(slots.find((s) => s.personaId === 'p3')).not.toHaveProperty('roles');
  });
});
