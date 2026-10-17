import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerSquadProposalTools,
  squadPlanCheckInputSchema,
  squadProposeInputSchema,
  type RegisterSquadProposalToolsOpts
} from './squad-proposal-mcp-tools.js';

type Handler = (input: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function fakeServer() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: Handler) => { tools.set(name, handler); }
  } as unknown as McpServer;
  return { server, tools };
}

const okValue = {
  proposalId: 'p1', inboxEntryId: 'i1',
  team: { id: 't', name: 'T', workers: 2, orchestrator: 'o' },
  planning: 'infer' as const, plan: null, sources: [], expiresAt: 5
};

function setup(over: Partial<RegisterSquadProposalToolsOpts> = {}) {
  const { server, tools } = fakeServer();
  const propose = vi.fn(async () => ({ ok: true as const, value: okValue }));
  const checkPlan = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, steps: [] } }));
  registerSquadProposalTools(server, {
    sessionId: 's1', projectId: 'p', propose, checkPlan, validateRouteIdentity: () => true, ...over
  });
  return { tools, propose, checkPlan };
}

const NOT_LIVE = 'originating session is not live in this project.';

describe('registerSquadProposalTools', () => {
  it('registers nothing without a session or propose dep', () => {
    expect(setup({ sessionId: undefined }).tools.size).toBe(0);
    expect(setup({ propose: undefined }).tools.size).toBe(0);
  });

  it('registers squad_plan_check only with checkPlan', () => {
    expect([...setup({ checkPlan: undefined }).tools.keys()]).toEqual(['squad_propose']);
    expect([...setup().tools.keys()]).toEqual(['squad_propose', 'squad_plan_check']);
  });

  it.each([
    ['missing validator', undefined],
    ['false result', () => false],
    ['throw', () => { throw new Error('boom'); }],
    ['rejected promise', async () => { throw new Error('boom'); }]
  ])('fails closed with NOT_LIVE on %s', async (_n, validateRouteIdentity) => {
    const { tools, propose, checkPlan } = setup({ validateRouteIdentity });
    const a = await tools.get('squad_propose')!({ teamId: 't', goal: 'g' });
    expect(a.isError).toBe(true);
    expect(a.content[0].text).toBe(`squad_propose failed: NOT_LIVE: ${NOT_LIVE}`);
    const b = await tools.get('squad_plan_check')!({ text: 'x' });
    expect(b.isError).toBe(true);
    expect(b.content[0].text).toBe(`squad_plan_check failed: NOT_LIVE: ${NOT_LIVE}`);
    expect(propose).not.toHaveBeenCalled();
    expect(checkPlan).not.toHaveBeenCalled();
  });

  it('squad_propose returns the result JSON and passes the route', async () => {
    const { tools, propose } = setup();
    const res = await tools.get('squad_propose')!({ teamId: 't', goal: 'g' });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual(okValue);
    expect(propose).toHaveBeenCalledWith({ projectId: 'p', sessionId: 's1' }, { teamId: 't', goal: 'g' });
  });

  it('squad_propose formats dep errors and throws without a stack', async () => {
    const failed = setup({ propose: async () => ({ ok: false, code: 'TEAM_NOT_FOUND', message: 'no such team' }) });
    expect((await failed.tools.get('squad_propose')!({ teamId: 't', goal: 'g' })).content[0].text)
      .toBe('squad_propose failed: TEAM_NOT_FOUND: no such team');
    const thrown = setup({ propose: async () => { throw new Error('kaput'); } });
    const res = await thrown.tools.get('squad_propose')!({ teamId: 't', goal: 'g' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('squad_propose failed: INVALID: kaput');
    const nonError = setup({ propose: async () => { throw 'str'; } });
    expect((await nonError.tools.get('squad_propose')!({ teamId: 't', goal: 'g' })).content[0].text)
      .toBe('squad_propose failed: INVALID: str');
  });

  it('squad_plan_check renders a valid plan and an invalid plan as success', async () => {
    const steps = [{ id: 'a', title: 'A', dependencies: [], writeScope: [] }];
    const good = setup({ checkPlan: async () => ({ ok: true, value: { ok: true, steps } }) });
    const r1 = await good.tools.get('squad_plan_check')!({ path: 'plan.md' });
    expect(r1.isError).toBeUndefined();
    expect(JSON.parse(r1.content[0].text)).toEqual({ ok: true, steps });
    const bad = setup({ checkPlan: async () => ({ ok: true, value: { ok: false, reason: 'cycle' } }) });
    const r2 = await bad.tools.get('squad_plan_check')!({ text: 'x' });
    expect(r2.isError).toBeUndefined();
    expect(JSON.parse(r2.content[0].text)).toEqual({ ok: false, reason: 'cycle' });
  });

  it('squad_plan_check forwards path or text and formats dep errors', async () => {
    const { tools, checkPlan } = setup();
    await tools.get('squad_plan_check')!({ path: 'plan.md' });
    expect(checkPlan).toHaveBeenLastCalledWith({ projectId: 'p' }, { path: 'plan.md' });
    await tools.get('squad_plan_check')!({ text: 'hi' });
    expect(checkPlan).toHaveBeenLastCalledWith({ projectId: 'p' }, { text: 'hi' });
    const failed = setup({ checkPlan: async () => ({ ok: false, code: 'SOURCE_OUTSIDE_PROJECT', message: 'nope' }) });
    expect((await failed.tools.get('squad_plan_check')!({ path: '/etc/x' })).content[0].text)
      .toBe('squad_plan_check failed: SOURCE_OUTSIDE_PROJECT: nope');
    const thrown = setup({ checkPlan: async () => { throw new Error('io'); } });
    expect((await thrown.tools.get('squad_plan_check')!({ path: 'x' })).content[0].text)
      .toBe('squad_plan_check failed: INVALID: io');
  });

  it('squad_plan_check rejects both, neither, and oversize text with INVALID', async () => {
    const { tools, checkPlan } = setup();
    for (const input of [{ path: 'a', text: 'b' }, {}]) {
      const res = await tools.get('squad_plan_check')!(input);
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('squad_plan_check failed: INVALID');
    }
    const big = await tools.get('squad_plan_check')!({ text: 'é'.repeat(600_000) });
    expect(big.isError).toBe(true);
    expect(big.content[0].text).toContain('INVALID');
    expect(checkPlan).not.toHaveBeenCalled();
  });
});

describe('input schemas', () => {
  const propose = z.object(squadProposeInputSchema);
  it('accepts a minimal and a full input', () => {
    expect(propose.safeParse({ teamId: 't', goal: 'g' }).success).toBe(true);
    expect(propose.safeParse({
      teamId: 't', goal: 'g', planning: 'provided', sources: ['a.md'], title: 'T', summary: 'S'
    }).success).toBe(true);
  });
  it('rejects values beyond the transport bounds', () => {
    expect(propose.safeParse({ teamId: 't', goal: 'x'.repeat(8193) }).success).toBe(false);
    expect(propose.safeParse({ teamId: '', goal: 'g' }).success).toBe(false);
    expect(propose.safeParse({ teamId: 't', goal: 'g', sources: Array(65).fill('a') }).success).toBe(false);
    expect(propose.safeParse({ teamId: 't', goal: 'g', planning: 'other' }).success).toBe(false);
    expect(propose.safeParse({ teamId: 't', goal: 'g', title: 'x'.repeat(1025) }).success).toBe(false);
    expect(propose.safeParse({ teamId: 't', goal: 'g', summary: 'x'.repeat(8193) }).success).toBe(false);
  });
  it('lets just-over-limit values through so the service can return its coded error', () => {
    expect(propose.safeParse({ teamId: 't', goal: 'x'.repeat(2049) }).success).toBe(true);
    expect(propose.safeParse({ teamId: 't', goal: 'g', sources: Array(17).fill('a') }).success).toBe(true);
    expect(propose.safeParse({ teamId: 't', goal: 'g', title: 'x'.repeat(257), summary: 'x'.repeat(2049) }).success).toBe(true);
  });
  it('plan check path is bounded', () => {
    const check = z.object(squadPlanCheckInputSchema);
    expect(check.safeParse({ path: 'x'.repeat(4097) }).success).toBe(false);
    expect(check.safeParse({ path: 'a' }).success).toBe(true);
  });
});
