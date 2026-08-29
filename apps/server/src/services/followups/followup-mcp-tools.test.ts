import { describe, it, expect, vi } from 'vitest';
import {
  registerFollowUpTools,
  type RegisterFollowUpToolsOpts,
  type FollowUpAgentApi
} from './followup-mcp-tools.js';
import type { FollowUp, FollowUpCreateInput, FollowUpStatus } from '@zana-ai/zcc-domain/product';

/** Minimal fake McpServer capturing handlers, mirroring goal-mcp-tools.test.ts. */
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

function makeFollowUp(over: Partial<FollowUp> = {}): FollowUp {
  return {
    id: 'fu-1',
    projectId: 'proj-1',
    title: 'Should I commit?',
    kind: 'question',
    status: 'open',
    origin: { source: 'agent', sessionId: 'sess-1' },
    sessionId: 'sess-1',
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    ...over
  };
}

function makeApi(over: Partial<FollowUpAgentApi> = {}): FollowUpAgentApi {
  return {
    agentList: vi.fn(() => [makeFollowUp()]),
    agentCreate: vi.fn((projectId: string, input: FollowUpCreateInput) =>
      makeFollowUp({ projectId, title: input.title, kind: input.kind ?? 'question' })
    ),
    agentSetStatus: vi.fn((projectId: string, id: string, status: FollowUpStatus, resolution?: string) =>
      makeFollowUp({ id, projectId, status, resolution })
    ),
    ...over
  };
}

function makeOpts(over: Partial<RegisterFollowUpToolsOpts> = {}): RegisterFollowUpToolsOpts {
  return {
    projectId: 'proj-1',
    sessionId: 'sess-1',
    followupAgentApi: makeApi(),
    ...over
  };
}

describe('registerFollowUpTools', () => {
  it('registers exactly the three followup_* tools', () => {
    const { server, tools } = fakeServer();
    registerFollowUpTools(server as never, makeOpts());
    expect([...tools.keys()].sort()).toEqual(['followup_create', 'followup_list', 'followup_resolve']);
  });

  it('followup_create uses the route projectId + forces scope/origin, ignoring agent input', async () => {
    const agentCreate = vi.fn((projectId: string, input: FollowUpCreateInput) =>
      makeFollowUp({ projectId, title: input.title })
    );
    const { server, tools } = fakeServer();
    registerFollowUpTools(server as never, makeOpts({ followupAgentApi: makeApi({ agentCreate }) }));

    const res = await tools.get('followup_create')!({
      title: 'Ship it?',
      detail: 'context',
      kind: 'decision',
      // attacker-supplied fields must be ignored
      projectId: 'other-proj',
      scope: 'global'
    });

    expect(agentCreate).toHaveBeenCalledTimes(1);
    const [projectId, input] = agentCreate.mock.calls[0];
    expect(projectId).toBe('proj-1');
    expect(input.projectId).toBe('proj-1');
    expect(input.scope).toEqual({ projectId: 'proj-1' });
    expect(input.origin).toEqual({ source: 'agent', sessionId: 'sess-1' });
    expect(input.kind).toBe('decision');
    expect(text(res)).toContain('Filed follow-up "Ship it?"');
    expect(res.isError).toBeFalsy();
  });

  it('followup_create forwards concrete answer options to the manager', async () => {
    const agentCreate = vi.fn((projectId: string, input: FollowUpCreateInput) =>
      makeFollowUp({ projectId, title: input.title })
    );
    const { server, tools } = fakeServer();
    registerFollowUpTools(server as never, makeOpts({ followupAgentApi: makeApi({ agentCreate }) }));
    await tools.get('followup_create')!({
      title: 'Which release channel?',
      options: ['stable', 'beta', 'canary'],
      kind: 'decision'
    });
    const [, input] = agentCreate.mock.calls[0];
    expect(input.options).toEqual(['stable', 'beta', 'canary']);
  });

  it('followup_create defaults kind to question', async () => {
    const agentCreate = vi.fn((projectId: string, input: FollowUpCreateInput) =>
      makeFollowUp({ projectId, kind: input.kind ?? 'question' })
    );
    const { server, tools } = fakeServer();
    registerFollowUpTools(server as never, makeOpts({ followupAgentApi: makeApi({ agentCreate }) }));
    await tools.get('followup_create')!({ title: 'T' });
    const [, input] = agentCreate.mock.calls[0];
    expect(input.kind).toBe('question');
  });

  it('followup_list summarizes follow-ups (id/title/kind/status), no internal fields', async () => {
    const { server, tools } = fakeServer();
    registerFollowUpTools(server as never, makeOpts());
    const res = await tools.get('followup_list')!({});
    const parsed = JSON.parse(text(res));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('fu-1');
    expect(parsed[0].status).toBe('open');
    expect(parsed[0]).not.toHaveProperty('origin');
    expect(parsed[0]).not.toHaveProperty('detail');
  });

  it('followup_resolve passes the route projectId + id/status/resolution through', async () => {
    const agentSetStatus = vi.fn((projectId: string, id: string, status: FollowUpStatus, resolution?: string) =>
      makeFollowUp({ id, projectId, status, resolution })
    );
    const { server, tools } = fakeServer();
    registerFollowUpTools(server as never, makeOpts({ followupAgentApi: makeApi({ agentSetStatus }) }));
    const res = await tools.get('followup_resolve')!({ id: 'fu-1', status: 'resolved', resolution: 'done' });
    expect(agentSetStatus).toHaveBeenCalledWith('proj-1', 'fu-1', 'resolved', 'done');
    expect(text(res)).toContain('is now resolved');
  });

  it('followup_resolve reports a not-found id (project-lock miss) as an error', async () => {
    const agentSetStatus = vi.fn(() => null);
    const { server, tools } = fakeServer();
    registerFollowUpTools(server as never, makeOpts({ followupAgentApi: makeApi({ agentSetStatus }) }));
    const res = await tools.get('followup_resolve')!({ id: 'gone', status: 'dismissed' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('no follow-up gone in this project');
  });

  it('a throwing manager surfaces as an isError result, not an exception', async () => {
    const agentCreate = vi.fn(() => {
      throw new Error('title is required');
    });
    const { server, tools } = fakeServer();
    registerFollowUpTools(server as never, makeOpts({ followupAgentApi: makeApi({ agentCreate }) }));
    const res = await tools.get('followup_create')!({ title: '' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('followup_create failed: title is required');
  });
});
