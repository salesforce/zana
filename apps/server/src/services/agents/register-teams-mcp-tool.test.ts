import { describe, it, expect } from 'vitest';
import { registerListTeamsTool, LIST_TEAMS_DESCRIPTION } from './register-teams-mcp-tool.js';
import type { TeamSummary } from '@zana-ai/zcc-domain/product';

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
});
