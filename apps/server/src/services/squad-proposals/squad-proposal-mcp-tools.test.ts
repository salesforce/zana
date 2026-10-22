import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SQUAD_LAUNCH_DESCRIPTION,
  SQUAD_LAUNCH_JSON_SCHEMA,
  SQUAD_PLAN_CHECK_JSON_SCHEMA,
  SQUAD_PROPOSE_JSON_SCHEMA,
  registerSquadProposalTools,
  squadLaunchInputSchema,
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

const nowValue = {
  executionId: 'e1', state: 'RUNNING',
  team: okValue.team, planning: 'infer' as const, plan: null, sources: []
};

function setup(over: Partial<RegisterSquadProposalToolsOpts> = {}) {
  const { server, tools } = fakeServer();
  const propose = vi.fn(async () => ({ ok: true as const, value: okValue }));
  const checkPlan = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, steps: [] } }));
  const launchSquadNow = vi.fn(async () => ({ ok: true as const, value: nowValue }));
  registerSquadProposalTools(server, {
    sessionId: 's1', projectId: 'p', propose, checkPlan, launchSquadNow, validateRouteIdentity: () => true, ...over
  });
  return { tools, propose, checkPlan, launchSquadNow };
}

const NOT_LIVE = 'originating session is not live in this project.';

describe('registerSquadProposalTools', () => {
  it('registers nothing without a session or propose dep', () => {
    expect(setup({ sessionId: undefined }).tools.size).toBe(0);
    expect(setup({ propose: undefined }).tools.size).toBe(0);
  });

  it('registers squad_plan_check only with checkPlan', () => {
    expect([...setup({ checkPlan: undefined }).tools.keys()]).toEqual(['squad_propose', 'squad_launch']);
    expect([...setup().tools.keys()]).toEqual(['squad_propose', 'squad_launch', 'squad_plan_check']);
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

  it('squad_propose formats dep errors, and logs a throw without passing its text on', async () => {
    const failed = setup({ propose: async () => ({ ok: false, code: 'TEAM_NOT_FOUND', message: 'no such team' }) });
    expect((await failed.tools.get('squad_propose')!({ teamId: 't', goal: 'g' })).content[0].text)
      .toBe('squad_propose failed: TEAM_NOT_FOUND: no such team');
    const logError = vi.fn();
    const thrown = setup({ propose: async () => { throw new Error('SQLITE_IOERR at /Users/me/.zcc/zcc.db'); }, logError });
    const res = await thrown.tools.get('squad_propose')!({ teamId: 't', goal: 'g' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('squad_propose failed: INVALID: unexpected error. Try again; if it keeps failing, tell the user.');
    expect(logError).toHaveBeenCalledWith('squad_propose failed unexpectedly (project p, session s1)', expect.objectContaining({ message: expect.stringContaining('SQLITE_IOERR') }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const nonError = setup({ propose: async () => { throw 'str'; } });
      expect((await nonError.tools.get('squad_propose')!({ teamId: 't', goal: 'g' })).content[0].text).not.toContain('str');
      expect(consoleError).toHaveBeenCalledWith('squad_propose failed unexpectedly (project p, session s1)', 'str');
      // A throwing logger never turns into a thrown tool call.
      const loud = setup({ propose: async () => { throw new Error('x'); }, logError: () => { throw new Error('log'); } });
      expect((await loud.tools.get('squad_propose')!({ teamId: 't', goal: 'g' })).isError).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('gives the Modern bridge the same bounds and help as the zod schemas', () => {
    const zodPropose = z.toJSONSchema(z.object(squadProposeInputSchema)) as { properties: Record<string, Record<string, unknown>>; required: string[] };
    for (const [key, prop] of Object.entries(SQUAD_PROPOSE_JSON_SCHEMA.properties)) {
      expect(prop, key).toMatchObject(zodPropose.properties[key]!);
    }
    expect(SQUAD_PROPOSE_JSON_SCHEMA.required).toEqual(zodPropose.required);
    const zodCheck = z.toJSONSchema(z.object(squadPlanCheckInputSchema)) as { properties: Record<string, Record<string, unknown>> };
    for (const [key, prop] of Object.entries(SQUAD_PLAN_CHECK_JSON_SCHEMA.properties)) expect(prop, key).toMatchObject(zodCheck.properties[key]!);
  });

  it('squad_launch schema and JSON schema are the propose ones plus a required mode', () => {
    const zodLaunch = z.toJSONSchema(z.object(squadLaunchInputSchema)) as { properties: Record<string, Record<string, unknown>>; required: string[] };
    for (const [key, prop] of Object.entries(SQUAD_LAUNCH_JSON_SCHEMA.properties)) {
      expect(prop, key).toMatchObject(zodLaunch.properties[key]!);
    }
    expect(SQUAD_LAUNCH_JSON_SCHEMA.required).toEqual(['teamId', 'goal', 'mode']);
    expect(zodLaunch.required).toEqual(expect.arrayContaining(['mode']));
    expect(Object.keys(SQUAD_LAUNCH_JSON_SCHEMA.properties)).toEqual([...Object.keys(SQUAD_PROPOSE_JSON_SCHEMA.properties), 'mode']);
    expect(SQUAD_LAUNCH_DESCRIPTION).toContain("mode 'now'");
    expect(SQUAD_LAUNCH_DESCRIPTION).toContain("mode 'review'");
  });

  it('squad_launch review returns the same result as squad_propose and never starts', async () => {
    const { tools, propose, launchSquadNow } = setup();
    const viaPropose = await tools.get('squad_propose')!({ teamId: 't', goal: 'g' });
    const viaLaunch = await tools.get('squad_launch')!({ mode: 'review', teamId: 't', goal: 'g' });
    expect(viaLaunch).toEqual(viaPropose);
    expect(propose).toHaveBeenLastCalledWith({ projectId: 'p', sessionId: 's1' }, { teamId: 't', goal: 'g' });
    expect(launchSquadNow).not.toHaveBeenCalled();
  });

  it('squad_launch review formats dep errors', async () => {
    const { tools } = setup({ propose: async () => ({ ok: false, code: 'TEAM_NOT_FOUND', message: 'no such team' }) });
    const res = await tools.get('squad_launch')!({ mode: 'review', teamId: 't', goal: 'g' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('squad_launch failed: TEAM_NOT_FOUND: no such team');
  });

  it('squad_launch now returns the launch JSON and passes the route without mode', async () => {
    const { tools, propose, launchSquadNow } = setup();
    const res = await tools.get('squad_launch')!({ mode: 'now', teamId: 't', goal: 'g', sources: ['a.md'] });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual(nowValue);
    expect(launchSquadNow).toHaveBeenCalledWith({ projectId: 'p', sessionId: 's1' }, { teamId: 't', goal: 'g', sources: ['a.md'] });
    expect(propose).not.toHaveBeenCalled();
  });

  it.each([
    ['LAUNCH_REVIEW_REQUIRED', 'requires review'],
    ['LAUNCH_APPROVAL_UNAVAILABLE', 'could not be read'],
    ['LAUNCH_IN_PROGRESS', 'already starting'],
    ['TOO_MANY_LAUNCHES', 'running Squads']
  ])('squad_launch now maps %s to error text', async (code, message) => {
    const { tools } = setup({ launchSquadNow: async () => ({ ok: false, code, message }) });
    const res = await tools.get('squad_launch')!({ mode: 'now', teamId: 't', goal: 'g' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe(`squad_launch failed: ${code}: ${message}`);
  });

  const launchNowText = async (over: Partial<RegisterSquadProposalToolsOpts>) => {
    const { tools, launchSquadNow } = setup(over);
    const res = await tools.get('squad_launch')!({ mode: 'now', teamId: 't', goal: 'g' });
    return { res, launchSquadNow };
  };

  it('squad_launch now is denied when the owner gate returns false', async () => {
    const { res, launchSquadNow } = await launchNowText({ validateOwnerRouteIdentity: () => false });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^squad_launch failed: DENIED:/);
    expect(launchSquadNow).not.toHaveBeenCalled();
  });

  it('squad_launch now is denied when the owner gate throws', async () => {
    const { res, launchSquadNow } = await launchNowText({ validateOwnerRouteIdentity: () => { throw new Error('x'); } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^squad_launch failed: DENIED:/);
    expect(launchSquadNow).not.toHaveBeenCalled();
  });

  it('squad_launch now is NOT_LIVE with no gates at all', async () => {
    const { res, launchSquadNow } = await launchNowText({ validateOwnerRouteIdentity: undefined, validateRouteIdentity: undefined });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe(`squad_launch failed: NOT_LIVE: ${NOT_LIVE}`);
    expect(launchSquadNow).not.toHaveBeenCalled();
  });

  it('squad_launch now is denied when, with no owner gate, the fallback passes liveness then fails the owner check', async () => {
    const validateRouteIdentity = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { res, launchSquadNow } = await launchNowText({ validateOwnerRouteIdentity: undefined, validateRouteIdentity });
    expect(validateRouteIdentity).toHaveBeenCalledTimes(2);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^squad_launch failed: DENIED:/);
    expect(launchSquadNow).not.toHaveBeenCalled();
  });

  it('squad_launch now with an owner gate uses it, and review does not need it', async () => {
    const owner = vi.fn(() => true);
    const { tools, launchSquadNow } = setup({ validateOwnerRouteIdentity: owner });
    await tools.get('squad_launch')!({ mode: 'review', teamId: 't', goal: 'g' });
    expect(owner).not.toHaveBeenCalled();
    await tools.get('squad_launch')!({ mode: 'now', teamId: 't', goal: 'g' });
    expect(owner).toHaveBeenCalledWith('s1', 'p');
    expect(launchSquadNow).toHaveBeenCalledTimes(1);
  });

  it('squad_launch now with a failing-but-live owner gate says DENIED', async () => {
    const { tools } = setup({ validateOwnerRouteIdentity: () => false });
    const res = await tools.get('squad_launch')!({ mode: 'now', teamId: 't', goal: 'g' });
    expect(res.content[0].text).toMatch(/^squad_launch failed: DENIED:/);
  });

  it('squad_launch now without the launchSquadNow dep returns a clear error', async () => {
    const { tools } = setup({ launchSquadNow: undefined });
    const res = await tools.get('squad_launch')!({ mode: 'now', teamId: 't', goal: 'g' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^squad_launch failed: UNAVAILABLE:.*mode 'review'/);
  });

  it('squad_launch fails closed with NOT_LIVE and hides a throw', async () => {
    const dead = setup({ validateRouteIdentity: () => false });
    for (const mode of ['review', 'now']) {
      const res = await dead.tools.get('squad_launch')!({ mode, teamId: 't', goal: 'g' });
      expect(res.content[0].text).toBe(`squad_launch failed: NOT_LIVE: ${NOT_LIVE}`);
    }
    expect(dead.propose).not.toHaveBeenCalled();
    expect(dead.launchSquadNow).not.toHaveBeenCalled();
    const logError = vi.fn();
    const thrown = setup({ launchSquadNow: async () => { throw new Error('SQLITE_IOERR'); }, logError });
    const res = await thrown.tools.get('squad_launch')!({ mode: 'now', teamId: 't', goal: 'g' });
    expect(res.content[0].text).toBe('squad_launch failed: INVALID: unexpected error. Try again; if it keeps failing, tell the user.');
    expect(logError).toHaveBeenCalledWith('squad_launch failed unexpectedly (project p, session s1)', expect.any(Error));
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
    const failed = setup({ checkPlan: async () => ({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: 'nope' }) });
    expect((await failed.tools.get('squad_plan_check')!({ path: '/etc/x' })).content[0].text)
      .toBe('squad_plan_check failed: SOURCE_NOT_ALLOWED: nope');
    const logError = vi.fn();
    const thrown = setup({ checkPlan: async () => { throw new Error('EIO /Users/me/x'); }, logError });
    expect((await thrown.tools.get('squad_plan_check')!({ path: 'x' })).content[0].text)
      .toBe('squad_plan_check failed: INVALID: unexpected error. Try again; if it keeps failing, tell the user.');
    expect(logError).toHaveBeenCalledWith('squad_plan_check failed unexpectedly (project p, session s1)', expect.any(Error));
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

describe('squad_launch input schema', () => {
  const launch = z.object(squadLaunchInputSchema);
  it('requires a known mode', () => {
    expect(launch.safeParse({ teamId: 't', goal: 'g' }).success).toBe(false);
    expect(launch.safeParse({ teamId: 't', goal: 'g', mode: 'later' }).success).toBe(false);
    expect(launch.safeParse({ teamId: 't', goal: 'g', mode: 'review' }).success).toBe(true);
    expect(launch.safeParse({ teamId: 't', goal: 'g', mode: 'now', sources: ['a.md'] }).success).toBe(true);
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
