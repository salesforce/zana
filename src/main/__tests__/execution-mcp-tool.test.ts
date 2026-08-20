import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerExecutionTools } from '../execution-mcp-tool.js';
import { createExecutionHandoffStore } from '../execution/handoff-store.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    server: { registerTool: (name: string, _definition: unknown, handler: ToolHandler) => tools.set(name, handler) },
    tools
  };
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

function service() {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } })),
    status: vi.fn(async () => ({ id: 'execution-1', state: 'RUNNING' })),
    list: vi.fn(async () => [{ id: 'execution-1', jobTitle: 'Ship', state: 'RUNNING' }]),
    events: vi.fn(async () => [{ sequence: 1, summary: 'Execution reserved' }]),
    reportEvent: vi.fn(async () => ({ ok: true as const, value: { outcome: 'accepted', event: { sequence: 2 } } })),
    stop: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'STOPPED' } })),
    respond: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } })),
    resume: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } }))
    ,controlWithHandoff: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } }))
    ,retry: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', attempt: 2, state: 'RUNNING' } }))
    ,putArtifact: vi.fn(async () => ({ ok: true as const, value: { id: 'artifact-1' } })),
    listArtifacts: vi.fn(async () => [{ id: 'artifact-1' }]),
    mintResumeGrant: vi.fn(async () => ({ ok: true as const, value: { token: 'replacement-token', expiresAt: 100 } }))
  };
}

describe('execution MCP tools', () => {
  it('registers only route-scoped execution controls', () => {
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: service() as never, validateRouteIdentity: () => true });
    expect([...tools.keys()]).toEqual(['execution.start', 'execution.status', 'execution.resume_binding', 'execution.mint_resume_grant', 'execution.revoke_resume_grant', 'execution.list', 'execution.events', 'execution.event', 'execution.stop', 'execution.retry', 'execution.respond', 'execution.resume', 'execution.artifact.put', 'execution.artifact.list']);
  });

  it('uses route identity and project, never caller-supplied authority', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const started = await tools.get('execution.start')!({
      version: 1, teamId: 'team-1', launchRequestId: 'request-1', jobTitle: 'Ship', slots: [{ initialTask: 'Run tests' }]
    });
    await tools.get('execution.list')!({});
    await tools.get('execution.events')!({ executionId: 'execution-1', after: 1 });
    expect(started.isError).toBeFalsy();
    expect(execution.start).toHaveBeenCalledWith('session-1', 'project-1', expect.objectContaining({ teamId: 'team-1' }));
    expect(execution.list).toHaveBeenCalledWith('session-1', 'project-1');
    expect(execution.events).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', 1, 100);
    await tools.get('execution.mint_resume_grant')!({ executionId: 'execution-1' });
    expect(execution.mintResumeGrant).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1');
    await tools.get('execution.event')!({ executionId: 'execution-1', eventId: 'event-1', type: 'blocker', severity: 'warning', summary: 'Need answer', blocker: { question: 'Ship?' } });
    expect(execution.reportEvent).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', expect.objectContaining({ id: 'event-1', type: 'blocker' }));
  });

  it('does not accept caller-provided resolved model snapshots', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const result = await tools.get('execution.start')!({
      version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'Run tests' }],
      resolvedModels: [{ slotId: 'slot-1', provider: 'forged', model: 'forged' }]
    });
    expect(result.isError).toBeFalsy();
    expect(execution.start).toHaveBeenCalledWith('session-1', 'project-1', expect.not.objectContaining({ resolvedModels: expect.anything() }));
  });

  it('routes stop, respond, and resume through authenticated route scope', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    await tools.get('execution.stop')!({ executionId: 'execution-1', expectedStateVersion: 4 });
    await tools.get('execution.retry')!({ executionId: 'execution-1', expectedStateVersion: 4 });
    await tools.get('execution.respond')!({ executionId: 'execution-1', expectedStateVersion: 5, slotId: 'slot-1', message: 'Answer' });
    await tools.get('execution.resume')!({ executionId: 'execution-1', expectedStateVersion: 6, slotId: 'slot-1', message: 'Continue' });
    expect(execution.stop).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', 4);
    expect(execution.retry).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', 4);
    expect(execution.respond).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', 5, 'slot-1', 'Answer');
    expect(execution.resume).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', 6, 'slot-1', 'Continue');
  });

  it('rejects stale route identity before every execution operation', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => false });
    const result = await tools.get('execution.list')!({});
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('originating session is not live');
    expect(execution.list).not.toHaveBeenCalled();
  });

  it('uses one approved handoff only from exact target route', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-mcp-'));
    try {
      const handoffs = createExecutionHandoffStore({ filePath: join(dir, 'handoffs.json'), token: () => 'opaque-token' });
      registerExecutionTools(server as never, {
        sessionId: 'source', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs, validateHandoffTarget: (_source, target) => target === 'target', approveHandoff: async () => true
      });
      const minted = await tools.get('request_execution_handoff')!({ targetSessionId: 'target', executionId: 'execution-1', operations: ['execution.control'] });
      const { token } = JSON.parse(text(minted)) as { token: string };
      const rejected = await tools.get('execute_execution_handoff')!({ token, executionId: 'execution-1', expectedStateVersion: 4, action: 'stop' });
      expect(rejected.isError).toBe(true);
      const target = fakeServer();
      registerExecutionTools(target.server as never, {
        sessionId: 'target', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs, validateHandoffTarget: () => true, approveHandoff: async () => true
      });
      const executed = await target.tools.get('execute_execution_handoff')!({ token, executionId: 'execution-1', expectedStateVersion: 4, action: 'stop' });
      expect(executed.isError).toBeFalsy();
      expect(execution.controlWithHandoff).toHaveBeenCalledWith(expect.objectContaining({ sourceOwnerSessionId: 'source', targetSessionId: 'target' }), 'stop', 4, undefined, undefined);
      expect((await target.tools.get('execute_execution_handoff')!({ token, executionId: 'execution-1', expectedStateVersion: 4, action: 'stop' })).isError).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rejects handoffs for terminal executions before asking for approval', async () => {
    const execution = service();
    execution.status.mockResolvedValue({ id: 'execution-1', state: 'COMPLETED' });
    const { server, tools } = fakeServer();
    const approveHandoff = vi.fn(async () => true);
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-mcp-'));
    try {
      registerExecutionTools(server as never, {
        sessionId: 'source', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs: createExecutionHandoffStore({ filePath: join(dir, 'handoffs.json') }),
        validateHandoffTarget: () => true, approveHandoff
      });
      const result = await tools.get('request_execution_handoff')!({ targetSessionId: 'target', executionId: 'execution-1', operations: ['execution.control'] });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('execution is terminal');
      expect(approveHandoff).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('grants monitor reads only after approved resume and only to target session', async () => {
    const execution = service();
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-mcp-'));
    try {
      const handoffs = createExecutionHandoffStore({ filePath: join(dir, 'handoffs.json'), token: randomUUID });
      const source = fakeServer();
      registerExecutionTools(source.server as never, {
        sessionId: 'source', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs, validateHandoffTarget: (_source, target) => target === 'target', approveHandoff: async () => true
      });
      const request = await source.tools.get('request_execution_resume_monitor_handoff')!({ targetSessionId: 'target', executionId: 'execution-1' });
      const { token } = JSON.parse(text(request)) as { token: string };
      const target = fakeServer();
      registerExecutionTools(target.server as never, {
        sessionId: 'target', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs, validateHandoffTarget: () => true, approveHandoff: async () => true
      });
      const resumed = await target.tools.get('execute_execution_resume_monitor_handoff')!({ token, executionId: 'execution-1', expectedStateVersion: 4, slotId: 'slot-1', message: 'Continue' });
      const monitor = JSON.parse(text(resumed)).monitor.token as string;
      expect((await target.tools.get('execution_handoff_status')!({ token: monitor, executionId: 'execution-1' })).isError).toBeFalsy();
      expect(execution.status).toHaveBeenLastCalledWith('source', 'project-1', 'execution-1');
      const other = fakeServer();
      registerExecutionTools(other.server as never, {
        sessionId: 'other', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs, validateHandoffTarget: () => true, approveHandoff: async () => true
      });
      await expect(other.tools.get('execution_handoff_status')!({ token: monitor, executionId: 'execution-1' })).resolves.toMatchObject({ isError: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('requires a new approved request to mint a replacement monitor window', async () => {
    const execution = service();
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-mcp-'));
    try {
      const approveHandoff = vi.fn(async () => true);
      const { server, tools } = fakeServer();
      registerExecutionTools(server as never, {
        sessionId: 'source', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs: createExecutionHandoffStore({ filePath: join(dir, 'handoffs.json'), token: randomUUID }),
        validateHandoffTarget: () => true, approveHandoff
      });
      const result = await tools.get('request_execution_monitor_handoff')!({ targetSessionId: 'target', executionId: 'execution-1' });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(text(result))).toMatchObject({ token: expect.any(String), expiresAt: expect.any(Number) });
      expect(approveHandoff).toHaveBeenCalledTimes(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
