import { describe, it, expect, vi } from 'vitest';
import {
  registerGoalTools,
  type RegisterGoalToolsOpts,
  type GoalAgentApi
} from '../goal-mcp-tools.js';
import type { Goal, GoalCreateInput } from '../../shared/types.js';

/**
 * Minimal fake McpServer that captures registered tool handlers so we invoke
 * each directly without an HTTP transport. Mirrors library-mcp-tools.test.ts.
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }
  };
  return { server, tools };
}

function text(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.find((c) => c.type === 'text')?.text ?? '';
}

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    projectId: 'proj-1',
    title: 'Get suite green',
    statement: 'Make npm test pass',
    successCriteria: ['`npm test` exits 0'],
    driver: 'native',
    assignment: { kind: 'profile', profile: 'claude-yolo' },
    cadence: { mode: 'continuous' },
    maxIterations: 10,
    iteration: 2,
    noProgressLimit: 2,
    status: 'active',
    history: {
      retain: 20,
      iterations: [
        { id: 'it-2', at: '2026-06-28T00:00:00.000Z', verdict: 'partial', rationale: 'tests still red' }
      ]
    },
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    ...over
  } as Goal;
}

function makeApi(over: Partial<GoalAgentApi> = {}): GoalAgentApi {
  return {
    agentList: vi.fn(() => [makeGoal()]),
    agentCreate: vi.fn((projectId: string, _input: GoalCreateInput) =>
      makeGoal({ projectId, status: 'draft', iteration: 0 })
    ),
    ...over
  };
}

function makeOpts(over: Partial<RegisterGoalToolsOpts> = {}): RegisterGoalToolsOpts {
  return {
    projectId: 'proj-1',
    sessionId: 'sess-1',
    goalAgentApi: makeApi(),
    ...over
  };
}

describe('registerGoalTools', () => {
  it('registers exactly the two goal_* tools', () => {
    const { server, tools } = fakeServer();
    registerGoalTools(server as never, makeOpts());
    expect([...tools.keys()].sort()).toEqual(['goal_create', 'goal_list']);
  });

  it('goal_create uses the route projectId + forces scope, ignoring agent-supplied project', async () => {
    const agentCreate = vi.fn((projectId: string, input: GoalCreateInput) =>
      makeGoal({ projectId, title: input.title, status: 'active' })
    );
    const { server, tools } = fakeServer();
    registerGoalTools(server as never, makeOpts({ goalAgentApi: makeApi({ agentCreate }) }));

    const res = await tools.get('goal_create')!({
      title: 'Ship it',
      statement: 'Cut a release',
      successCriteria: ['git tag exists'],
      maxIterations: 5,
      profile: 'claude',
      activate: true,
      // An attacker-supplied projectId/scope must be ignored — the tool closes
      // over the route's projectId and re-derives scope from it.
      projectId: 'other-proj',
      scope: 'global'
    });

    expect(agentCreate).toHaveBeenCalledTimes(1);
    const [projectId, input] = agentCreate.mock.calls[0];
    expect(projectId).toBe('proj-1');
    expect(input.projectId).toBe('proj-1');
    expect(input.scope).toEqual({ projectId: 'proj-1' });
    expect(input.assignment).toEqual({ kind: 'profile', profile: 'claude' });
    expect(input.maxIterations).toBe(5);
    expect(input.activate).toBe(true);
    expect(text(res)).toContain('Created goal "Ship it"');
    expect(res.isError).toBeFalsy();
  });

  it('goal_create defaults successCriteria to [] and omits assignment when no profile given', async () => {
    const agentCreate = vi.fn((projectId: string, _input: GoalCreateInput) => makeGoal({ projectId }));
    const { server, tools } = fakeServer();
    registerGoalTools(server as never, makeOpts({ goalAgentApi: makeApi({ agentCreate }) }));

    await tools.get('goal_create')!({ title: 'T', statement: 'S' });
    const [, input] = agentCreate.mock.calls[0];
    expect(input.successCriteria).toEqual([]);
    expect(input.assignment).toBeUndefined();
  });

  it('goal_list summarizes goals and omits the verbose iteration history', async () => {
    const { server, tools } = fakeServer();
    registerGoalTools(server as never, makeOpts());
    const res = await tools.get('goal_list')!({});
    const parsed = JSON.parse(text(res));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('goal-1');
    expect(parsed[0].lastVerdict).toBe('partial');
    expect(parsed[0]).not.toHaveProperty('history');
  });

  it('a throwing manager surfaces as an isError result, not an exception', async () => {
    const agentCreate = vi.fn(() => {
      throw new Error('title is required');
    });
    const { server, tools } = fakeServer();
    registerGoalTools(server as never, makeOpts({ goalAgentApi: makeApi({ agentCreate }) }));
    const res = await tools.get('goal_create')!({ title: '', statement: 'x' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('goal_create failed: title is required');
  });
});
