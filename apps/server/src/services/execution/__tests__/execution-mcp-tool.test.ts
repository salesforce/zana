import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { registerExecutionTools } from '../execution-mcp-tool.js';
import { createExecutionHandoffStore } from '../handoff-store.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const definitions = new Map<string, unknown>();
  return {
    definitions,
    server: { registerTool: (name: string, definition: unknown, handler: ToolHandler) => { tools.set(name, handler); definitions.set(name, definition); } },
    tools
  };
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

function service() {
  const executionRecord = {
    id: 'execution-1',
    jobTitle: 'Ship',
    state: 'RUNNING',
    deliveries: [{
      id: 'delivery-1',
      state: 'LEASED',
      payload: { text: 'secret response' },
      recipientPrincipalId: 'worker-principal',
      recipientAuthorizationId: 'worker-authorization',
      leaseId: 'secret-lease',
      lastError: 'private delivery error'
    }]
  };
  return {
    start: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING', resumeToken: 'resume-token', resumeTokenExpiresAt: 1735689600000 } })),
    resumeBinding: vi.fn(async () => ({ ok: true as const, value: { callerPrincipalId: 'session-1', effectiveOwnerPrincipalIds: ['session-2'] } })),
    status: vi.fn(async () => executionRecord),
    list: vi.fn(async () => [executionRecord]),
    snapshot: vi.fn(async () => ({ execution: executionRecord, executions: [executionRecord], events: [], nextAfter: 0, truncated: false, artifacts: [{ id: 'artifact-1', name: 'result.md', mediaType: 'text/markdown', content: 'secret' }], artifactsTruncated: false })),
    events: vi.fn(async () => [{ sequence: 1, summary: 'Execution reserved' }]),
    reportEvent: vi.fn(async () => ({ ok: true as const, value: { outcome: 'accepted', event: { sequence: 2 } } })),
    stop: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'STOPPED' } })),
    respond: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } })),
    resume: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } }))
    ,controlWithHandoff: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } }))
    ,retry: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', attempt: 2, state: 'RUNNING' } }))
    ,putArtifact: vi.fn(async () => ({ ok: true as const, value: { id: 'artifact-1' } })),
    listArtifacts: vi.fn(async () => [{ id: 'artifact-1', content: 'secret' }]),
    mintResumeGrant: vi.fn(async () => ({ ok: true as const, value: { token: 'replacement-token', expiresAt: 100 } }))
    ,registerPlan: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1' } }))
    ,claimWork: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1' } }))
    ,assignWork: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1' } }))
    ,completeWork: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1' } }))
    ,failWork: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1' } }))
    ,blockWork: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1' } }))
    ,releaseWork: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1' } }))
    ,reportBoundEvent: vi.fn(async () => ({ ok: true as const, value: { outcome: 'accepted' } }))
    ,putBoundArtifact: vi.fn(async () => ({ ok: true as const, value: { id: 'artifact-1' } }))
    ,listBoundArtifacts: vi.fn(async () => ({ ok: true as const, value: [{ id: 'artifact-1' }] }))
    ,listSources: vi.fn(async () => ({ ok: true as const, value: { sources: [{ id: 'source-1' }] } }))
    ,readSource: vi.fn(async () => ({ ok: true as const, value: { content: 'chunk' } }))
    ,completeByCoordinatorBinding: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'COMPLETED' } }))
    ,completeByCoordinator: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'COMPLETED' } }))
    ,retryWork: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1' } }))
    ,revokeResumeGrant: vi.fn(async () => ({ ok: true as const, value: { revoked: 1 } }))
    ,pullDelivery: vi.fn(async () => ({ ok: true as const, value: null }))
    ,ackDelivery: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } }))
    ,snapshotBound: vi.fn(async () => ({ execution: executionRecord, executions: [executionRecord], events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false }))
  };
}

const contractFixturePath = fileURLToPath(new URL('../../../../test/fixtures/execution-contract-v1.json', import.meta.url));

describe('execution MCP tools', () => {
  it('registers only route-scoped execution controls', () => {
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: service() as never, validateRouteIdentity: () => true });
    expect([...tools.keys()]).toEqual(expect.arrayContaining(['execution.whoami', 'execution.plan.register', 'execution.work.claim', 'execution.work.assign', 'execution.work.complete', 'execution.work.fail', 'execution.work.block', 'execution.work.release', 'execution.source.list', 'execution.source.read', 'execution.event', 'execution.artifact.put', 'execution.artifact.list', 'execution.complete']));
  });

  it('reports host-bound live route identity without accepting caller identity', async () => {
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, {
      sessionId: 'session-1', projectId: 'project-1', projectName: 'Project One',
      service: service() as never, validateRouteIdentity: () => true
    });

    await expect(tools.get('execution.whoami')!({ projectId: 'forged-project' }))
      .resolves.not.toMatchObject({ isError: true });
    expect(JSON.parse(text(await tools.get('execution.whoami')!({})))).toEqual({
      projectId: 'project-1', projectName: 'Project One', sessionLive: true
    });
  });

  it('describes missing route authorization without implying another project', async () => {
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, {
      sessionId: 'stale-session', projectId: 'project-1', service: service() as never,
      validateRouteIdentity: () => false
    });

    const result = await tools.get('execution.start')!({
      version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'work' }]
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('execution.start unavailable: session MCP is not authorized for this live session.');
  });

  it('does not expose raw recovery credentials from routine execution.start', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const result = await tools.get('execution.start')!({ version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'work' }] });
    expect(JSON.parse(text(result))).toEqual({ id: 'execution-1', state: 'RUNNING' });
  });

  it('accepts and forwards generic preplanned work units', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const workUnits = [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }];
    await expect(tools.get('execution.start')!({
      version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'work' }], workUnits
    })).resolves.not.toMatchObject({ isError: true });
    expect(execution.start).toHaveBeenCalledWith('session-1', 'project-1', expect.objectContaining({ workUnits }));
  });

  it('rejects aggregate preplanned work larger than the bounded start budget', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const textValue = 'x'.repeat(2048);
    const workUnits = Array.from({ length: 100 }, (_, index) => ({
      id: `unit-${index}`, title: textValue, task: textValue, dependencies: [],
      files: Array.from({ length: 100 }, (__, fileIndex) => `path-${index}-${fileIndex}-${textValue}`),
      verification: [textValue]
    }));
    const result = await tools.get('execution.start')!({
      version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'work' }], workUnits
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('workUnits must not exceed');
    expect(execution.start).not.toHaveBeenCalled();
  });

  it('loads and removes a bounded request file under the user home directory', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const directory = join(homedir(), '.zcc', 'execution-requests');
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${randomUUID()}.json`);
    await writeFile(file, JSON.stringify({
      version: 1,
      teamId: 'team-1',
      launchRequestId: 'request-1',
      slots: [{ initialTask: 'work' }],
      workUnits: [{ id: 'preplanned', title: 'Preplanned', task: 'Use request file plan', dependencies: [], readOnly: true }]
    }));
    await expect(tools.get('execution.start')!({ requestPath: file })).resolves.not.toMatchObject({ isError: true });
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(execution.start).toHaveBeenCalledWith('session-1', 'project-1', expect.objectContaining({
      teamId: 'team-1',
      workUnits: [{ id: 'preplanned', title: 'Preplanned', task: 'Use request file plan', dependencies: [], readOnly: true }]
    }));
  });

  it('rejects request files outside user home without reading them', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const file = join(await mkdtemp(join(tmpdir(), 'zcc-execution-start-')), 'request.json');
    await writeFile(file, '{}');
    await expect(tools.get('execution.start')!({ requestPath: file })).resolves.toMatchObject({ isError: true });
    expect(execution.start).not.toHaveBeenCalled();
    await rm(file, { force: true });
  });

  it('uses generic execution start wording and forwards generic launch metadata', async () => {
    const execution = service();
    const { server, tools, definitions } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    await tools.get('execution.start')!({
      version: 1, launchKind: 'team', launchDisplay: { label: 'Release execution' }, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'work' }]
    });
    expect(definitions.get('execution.start')).toMatchObject({ description: expect.not.stringMatching(/Squad|Team/) });
    expect(execution.start).toHaveBeenCalledWith('session-1', 'project-1', expect.objectContaining({ launchKind: 'team', launchDisplay: { label: 'Release execution' } }));
  });

  it('redacts either recovery credential independently and forwards optional start policy', async () => {
    const variants = [
      { id: 'execution-1', state: 'RUNNING', resumeToken: 'secret' },
      { id: 'execution-2', state: 'RUNNING', resumeTokenExpiresAt: 123 }
    ];
    for (const value of variants) {
      const execution = service();
      execution.start.mockResolvedValue({ ok: true, value } as never);
      const { server, tools } = fakeServer();
      registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
      const result = await tools.get('execution.start')!({
        version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'work' }],
        workflow: { kind: 'dag' }, deadlineMs: 1_000, maxConcurrent: 2, maxLaunches: 3
      });
      expect(text(result)).not.toContain('secret');
      expect(text(result)).not.toContain('resumeToken');
      expect(execution.start).toHaveBeenCalledWith('session-1', 'project-1', expect.objectContaining({
        workflow: { kind: 'dag' }, policy: { deadlineMs: 1_000, maxConcurrent: 2, maxLaunches: 3 }
      }));
    }
  });

  it('derives execution project slot and role from host cohort and ignores forged authority fields', async () => {
    const execution = service();
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'worker-session', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });
    await tools.get('execution.work.claim')!({ executionId: 'execution-1', workUnitId: 'unit-1', slotId: 'forged-slot', role: 'orchestrator' });
    await tools.get('execution.event')!({ executionId: 'execution-1', eventId: 'event-1', slotId: 'forged-slot', producerRole: 'orchestrator', type: 'progress', severity: 'info', summary: 'working' });
    expect(execution.claimWork).toHaveBeenCalledWith(binding, 'unit-1', undefined);
    expect(execution.reportBoundEvent).toHaveBeenCalledWith(binding, expect.not.objectContaining({ slotId: expect.anything(), producerRole: expect.anything() }));
  });

  it('delegates dedicated coordinator assignment through host binding and requires assignedSlotId', async () => {
    const execution = service();
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const { server, tools, definitions } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'coordinator', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });
    const inputSchema = (definitions.get('execution.work.assign') as { inputSchema: { assignedSlotId: { safeParse(value: unknown): { success: boolean } } } }).inputSchema;
    expect(inputSchema.assignedSlotId.safeParse(undefined).success).toBe(false);
    await tools.get('execution.work.assign')!({ executionId: 'execution-1', workUnitId: 'unit-1', assignedSlotId: 'worker-1' });
    expect(execution.assignWork).toHaveBeenCalledWith(binding, 'unit-1', 'worker-1');
  });

  it('describes claim as worker-only despite shared Job Team preapproval', () => {
    const { server, definitions } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'worker', projectId: 'project-1', service: service() as never, validateRouteIdentity: () => true });
    expect(definitions.get('execution.work.claim')).toMatchObject({
      description: expect.stringMatching(/^Worker\b/)
    });
    expect(definitions.get('execution.work.claim')).toMatchObject({
      description: expect.not.stringMatching(/coordinator|assign/i)
    });
  });

  it('reads only matching bound execution snapshot for coordinator session', async () => {
    const execution = service();
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'coordinator', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: (_session, _project) => binding });
    const result = await tools.get('execution.snapshot')!({ executionId: 'execution-1', after: 3 });
    expect(result.isError).toBeFalsy();
    expect(execution.snapshotBound).toHaveBeenCalledWith(binding, 3);
    expect(execution.snapshot).not.toHaveBeenCalled();

    execution.snapshot.mockResolvedValueOnce(undefined as never);
    const denied = await tools.get('execution.snapshot')!({ executionId: 'execution-2' });
    expect(denied.isError).toBe(true);
    expect(execution.snapshotBound).toHaveBeenCalledTimes(1);
    expect(execution.snapshot).not.toHaveBeenCalled();
  });

  it('projects bound snapshot to coordinator-safe execution fields', async () => {
    const execution = service();
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const internalRecord = {
      id: 'execution-1', state: 'RUNNING', stateVersion: 4, jobTitle: 'Ship', workUnits: [{ id: 'unit-1', state: 'READY' }],
      callerPrincipalId: 'owner', effectiveOwnerPrincipalIds: ['recovery'], authorizationContext: { authorizationId: 'auth-secret' },
      authorizationContextDigest: 'auth-digest', requestDigest: 'request-digest', launchRequestId: 'launch-request',
      teamLaunchRequestId: 'team-launch-request', request: { version: 1 }, launchIntent: { secret: true },
      resolvedModels: [{ secret: true }], deliveries: [{ payload: { text: 'secret' } }]
    };
    execution.snapshotBound.mockResolvedValueOnce({
      execution: internalRecord, executions: [internalRecord], events: [{ sequence: 1, summary: 'ready' }],
      nextAfter: 1, truncated: false, artifacts: [{ id: 'artifact-1', name: 'result.md', content: 'secret' }], artifactsTruncated: false
    } as never);
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'coordinator', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });

    const payload = JSON.parse(text(await tools.get('execution.snapshot')!({ executionId: 'execution-1' })));
    expect(payload.execution).toMatchObject({ id: 'execution-1', state: 'RUNNING', workUnits: [{ id: 'unit-1', state: 'READY' }] });
    expect(payload.events).toEqual([{ sequence: 1, summary: 'ready' }]);
    expect(payload.artifacts).toEqual([{ id: 'artifact-1', name: 'result.md' }]);
    for (const record of [payload.execution, ...payload.executions]) {
      for (const field of [
        'callerPrincipalId', 'effectiveOwnerPrincipalIds', 'authorizationContext', 'authorizationContextDigest',
        'requestDigest', 'launchRequestId', 'teamLaunchRequestId', 'request', 'launchIntent', 'resolvedModels', 'deliveries'
      ]) expect(record).not.toHaveProperty(field);
    }
  });

  it('route-binds delivery pull and ack to exact cohort execution project and slot', async () => {
    const execution = service();
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'worker-session', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });
    const pulled = await tools.get('execution.delivery.pull')!({ executionId: 'forged', slotId: 'forged' });
    const acked = await tools.get('execution.delivery.ack')!({ executionId: 'forged', slotId: 'forged', deliveryId: 'delivery-1', leaseId: 'lease-1', delivered: true });
    expect(pulled.isError).toBeFalsy();
    expect(JSON.parse(text(pulled))).toBeNull();
    expect(acked.isError).toBeFalsy();
    expect(execution.pullDelivery).toHaveBeenCalledWith(binding);
    expect(execution.ackDelivery).toHaveBeenCalledWith(binding, 'delivery-1', 'lease-1', { delivered: true, error: undefined });
  });

  it('denies delivery pull across unbound execution routes', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'worker-session', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: () => undefined });
    await expect(tools.get('execution.delivery.pull')!({})).resolves.toMatchObject({ isError: true });
    expect(execution.pullDelivery).not.toHaveBeenCalled();
  });

  it('denies delivery routes without live route identity or matching execution binding', async () => {
    const execution = service();
    const missingSession = fakeServer();
    registerExecutionTools(missingSession.server as never, { projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    await expect(missingSession.tools.get('execution.delivery.ack')!({ deliveryId: 'delivery-1', leaseId: 'lease-1', delivered: false, error: 'offline' }))
      .resolves.toMatchObject({ isError: true });

    const mismatched = fakeServer();
    registerExecutionTools(mismatched.server as never, {
      sessionId: 'worker', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
      resolveCohortBinding: () => ({ executionId: 'execution-2', projectId: 'project-1', slotId: 'slot-1', role: 'worker' })
    });
    const denied = await mismatched.tools.get('execution.work.claim')!({ executionId: 'execution-1', workUnitId: 'unit-1' });
    expect(denied).toMatchObject({ isError: true });
    expect(text(denied)).toContain('not bound');
    expect(execution.ackDelivery).not.toHaveBeenCalled();
    expect(execution.claimWork).not.toHaveBeenCalled();
  });

  it('returns empty delivery pulls and explicit ack failures without losing error detail', async () => {
    const execution = service();
    execution.ackDelivery.mockResolvedValue({ ok: false, code: 'LEASE_LOST', message: 'delivery lease expired' } as never);
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'worker', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });
    const pulled = await tools.get('execution.delivery.pull')!({});
    const acked = await tools.get('execution.delivery.ack')!({ deliveryId: 'delivery-1', leaseId: 'lease-1', delivered: false, error: 'worker offline' });
    expect(JSON.parse(text(pulled))).toBeNull();
    expect(acked).toMatchObject({ isError: true });
    expect(text(acked)).toContain('delivery lease expired');
    expect(execution.ackDelivery).toHaveBeenCalledWith(binding, 'delivery-1', 'lease-1', { delivered: false, error: 'worker offline' });
  });

  it('denies recovery coordinator tools until effective-owner monitor binding is durable', async () => {
    const execution = service();
    const recovery = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:recovery', role: 'orchestrator' as const };
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, {
      sessionId: 'recovery-session', projectId: 'project-1', service: execution as never,
      validateRouteIdentity: () => true,
      resolveCohortBinding: () => recovery,
      validateRecoveryBinding: vi.fn(async () => false)
    });

    const result = await tools.get('execution.plan.register')!({ executionId: 'execution-1', workUnits: [{ id: 'a', title: 'A', task: 'A', dependencies: [] }] });
    expect(result.isError).toBe(true);
    expect(execution.registerPlan).not.toHaveBeenCalled();
  });

  it('exposes coordinator source and plan tools only through bound execution authority', async () => {
    const execution = service();
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead', role: 'orchestrator' as const };
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'coordinator', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });
    await tools.get('execution.plan.register')!({ executionId: 'execution-1', workUnits: [{ id: 'a', title: 'A', task: 'A', dependencies: [] }] });
    await tools.get('execution.source.list')!({ executionId: 'execution-1', offset: 0, limit: 10 });
    await tools.get('execution.source.read')!({ executionId: 'execution-1', sourceId: 'source-1', offset: 0, maxBytes: 1024 });
    expect(execution.registerPlan).toHaveBeenCalledWith(binding, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    expect(execution.listSources).toHaveBeenCalledWith(binding, { offset: 0, limit: 10 });
    expect(execution.readSource).toHaveBeenCalledWith(binding, 'source-1', { offset: 0, maxBytes: 1024 });
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

  it('returns successful status and revocation results and applies event cursor defaults', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const status = await tools.get('execution.status')!({ executionId: 'execution-1' });
    const revoked = await tools.get('execution.revoke_resume_grant')!({ executionId: 'execution-1', effectiveOwnerPrincipalId: 'replacement' });
    await tools.get('execution.events')!({ executionId: 'execution-1' });
    expect(JSON.parse(text(status))).toMatchObject({ id: 'execution-1', state: 'RUNNING' });
    expect(JSON.parse(text(revoked))).toEqual({ revoked: 1 });
    expect(execution.revokeResumeGrant).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', 'replacement');
    expect(execution.events).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', 0, 100);
  });

  it('projects status list and snapshot execution records without delivery-private state', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });

    const status = JSON.parse(text(await tools.get('execution.status')!({ executionId: 'execution-1' })));
    const list = JSON.parse(text(await tools.get('execution.list')!({})));
    const snapshot = JSON.parse(text(await tools.get('execution.snapshot')!({ executionId: 'execution-1' })));

    for (const record of [status, list[0], snapshot.execution, snapshot.executions[0]]) {
      expect(record).toMatchObject({ id: 'execution-1', jobTitle: 'Ship', state: 'RUNNING' });
      expect(record).not.toHaveProperty('deliveries');
    }
    for (const response of [status, list, snapshot]) {
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain('secret response');
      expect(serialized).not.toContain('worker-principal');
      expect(serialized).not.toContain('worker-authorization');
      expect(serialized).not.toContain('secret-lease');
      expect(serialized).not.toContain('private delivery error');
    }
  });

  it('matches exported execution v1 public start and resume-binding contract', async () => {
    const fixture = JSON.parse(await readFile(contractFixturePath, 'utf8')) as {
      version: number;
      tools: {
        'execution.start': { success: { result: object }; failure: { isError: boolean; text: string } };
        'execution.resume_binding': { input: { executionId: string; token: string }; success: { result: object }; failure: { isError: boolean; text: string } };
      };
    };
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });

    const started = await tools.get('execution.start')!({
      version: fixture.version, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'Run tests' }]
    });
    const resumed = await tools.get('execution.resume_binding')!(fixture.tools['execution.resume_binding'].input);
    expect(JSON.parse(text(started))).toMatchObject(fixture.tools['execution.start'].success.result);
    expect(JSON.parse(text(resumed))).toEqual(fixture.tools['execution.resume_binding'].success.result);

    const failedExecution = {
      ...execution,
      start: vi.fn(async () => ({ ok: false as const, code: 'DENIED', message: 'team launch denied' })),
      resumeBinding: vi.fn(async () => ({ ok: false as const, code: 'NOT_FOUND', message: 'execution resume grant is not current' }))
    };
    const failed = fakeServer();
    registerExecutionTools(failed.server as never, { sessionId: 'session-1', projectId: 'project-1', service: failedExecution as never, validateRouteIdentity: () => true });
    const failedStart = await failed.tools.get('execution.start')!({
      version: fixture.version, teamId: 'team-1', launchRequestId: 'request-2', slots: [{ initialTask: 'Run tests' }]
    });
    const failedResume = await failed.tools.get('execution.resume_binding')!(fixture.tools['execution.resume_binding'].input);
    expect({ isError: failedStart.isError, text: text(failedStart) }).toEqual(fixture.tools['execution.start'].failure);
    expect({ isError: failedResume.isError, text: text(failedResume) }).toEqual(fixture.tools['execution.resume_binding'].failure);
  });

  it('publishes a strict public execution.start schema', () => {
    const { server, definitions } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: service() as never, validateRouteIdentity: () => true });
    const inputSchema = (definitions.get('execution.start') as { inputSchema: { safeParse(value: unknown): { success: boolean } } }).inputSchema;
    const valid = {
      version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'Run tests' }],
      workflow: {
        schemaVersion: 1, profileId: 'implementation', profileVersion: '1',
        controller: { personaId: 'controller', slotId: 'orchestrator:controller' },
        workers: [{ role: 'worker', personaId: 'worker', slotId: '0:worker:0' }],
        supportedRequestVersions: [1]
      }
    };
    expect(inputSchema.safeParse(valid).success).toBe(true);
    expect(inputSchema.safeParse({ requestPath: '/Users/me/.zcc/execution-requests/request.json' }).success).toBe(true);
    for (const invalid of [
      { ...valid, modelTier: 'HIGH' },
      { ...valid, slots: [{ initialTask: 'Run tests', modelTier: 'HIGH' }] },
      { ...valid, workflow: { ...valid.workflow, modelTier: 'HIGH' } },
      { ...valid, workflow: { ...valid.workflow, controller: { ...valid.workflow.controller, modelTier: 'HIGH' } } },
      { ...valid, workflow: { ...valid.workflow, workers: [{ ...valid.workflow.workers[0], modelTier: 'HIGH' }] } },
      { ...valid, requestPath: '/Users/me/.zcc/execution-requests/request.json' }
    ]) expect(inputSchema.safeParse(invalid).success).toBe(false);
  });

  it('forwards bounded lifecycle event metadata without consumer semantics', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    await tools.get('execution.event')!({
      executionId: 'execution-1', eventId: 'event-1', producerRole: 'worker', type: 'progress', severity: 'info', summary: 'Half done',
      attention: false, progress: { completed: 1, total: 2 }, references: [{ label: 'result', uri: 'artifact://result.json' }]
    });
    expect(execution.reportEvent).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', expect.objectContaining({
      producerRole: 'worker', attention: false, progress: { completed: 1, total: 2 }, references: [{ label: 'result', uri: 'artifact://result.json' }]
    }));
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
    expect(text(result)).toContain('session MCP is not authorized for this live session');
    expect(execution.list).not.toHaveBeenCalled();
  });

  it('rejects stale route identity across every registered route-scoped operation', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'stale-session', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => false });
    const args: Record<string, Record<string, unknown>> = {
      'execution.plan.register': { executionId: 'execution-1', workUnits: [{ id: 'unit-1', title: 'Unit', task: 'Do it', dependencies: [] }] },
      'execution.work.claim': { executionId: 'execution-1', workUnitId: 'unit-1' },
      'execution.work.assign': { executionId: 'execution-1', workUnitId: 'unit-1', assignedSlotId: 'slot-1' },
      'execution.work.complete': { executionId: 'execution-1', workUnitId: 'unit-1', result: 'done' },
      'execution.work.fail': { executionId: 'execution-1', workUnitId: 'unit-1', failure: 'failed' },
      'execution.work.block': { executionId: 'execution-1', workUnitId: 'unit-1', blockerId: 'blocker-1', question: 'Need input?' },
      'execution.work.release': { executionId: 'execution-1', workUnitId: 'unit-1' },
      'execution.work.retry': { executionId: 'execution-1', workUnitId: 'unit-1' },
      'execution.delivery.pull': {},
      'execution.delivery.ack': { deliveryId: 'delivery-1', leaseId: 'lease-1', delivered: true },
      'execution.source.list': { executionId: 'execution-1' },
      'execution.source.read': { executionId: 'execution-1', sourceId: 'source-1' },
      'execution.start': { version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'Work' }] },
      'execution.status': { executionId: 'execution-1' },
      'execution.resume_binding': { executionId: 'execution-1', token: 'token' },
      'execution.mint_resume_grant': { executionId: 'execution-1' },
      'execution.revoke_resume_grant': { executionId: 'execution-1' },
      'execution.list': {},
      'execution.events': { executionId: 'execution-1' },
      'execution.snapshot': { executionId: 'execution-1' },
      'execution.event': { executionId: 'execution-1', eventId: 'event-1', type: 'progress', severity: 'info', summary: 'Working' },
      'execution.stop': { executionId: 'execution-1', expectedStateVersion: 1 },
      'execution.complete': { executionId: 'execution-1', summary: 'Done' },
      'execution.retry': { executionId: 'execution-1', expectedStateVersion: 1 },
      'execution.respond': { executionId: 'execution-1', expectedStateVersion: 1, slotId: 'slot-1', message: 'Answer' },
      'execution.resume': { executionId: 'execution-1', expectedStateVersion: 1, slotId: 'slot-1', message: 'Continue' },
      'execution.artifact.put': { executionId: 'execution-1', name: 'result.md', mediaType: 'text/markdown', content: 'done' },
      'execution.artifact.list': { executionId: 'execution-1' }
    };
    for (const [name, handler] of tools) {
      const result = await handler(args[name] ?? {});
      expect(result, name).toMatchObject({ isError: true });
      expect(text(result), name).toContain('session MCP is not authorized for this live session');
    }
    for (const dependency of Object.values(execution)) expect(dependency).not.toHaveBeenCalled();
  });

  it('returns bound-service failures without falling back to caller-supplied authority', async () => {
    const execution = service();
    const deniedResult = { ok: false as const, code: 'DENIED', message: 'role is not authorized' };
    for (const name of ['registerPlan', 'claimWork', 'assignWork', 'completeWork', 'failWork', 'blockWork', 'releaseWork', 'retryWork', 'listSources', 'readSource', 'reportBoundEvent', 'putBoundArtifact', 'listBoundArtifacts', 'completeByCoordinatorBinding'] as const) {
      execution[name].mockResolvedValue(deniedResult as never);
    }
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'worker', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });
    const cases = [
      ['execution.plan.register', { executionId: 'execution-1', workUnits: [{ id: 'unit-1', title: 'Unit', task: 'Do it', dependencies: [] }] }],
      ['execution.work.claim', { executionId: 'execution-1', workUnitId: 'unit-1' }],
      ['execution.work.assign', { executionId: 'execution-1', workUnitId: 'unit-1', assignedSlotId: 'slot-1' }],
      ['execution.work.complete', { executionId: 'execution-1', workUnitId: 'unit-1', result: 'done' }],
      ['execution.work.fail', { executionId: 'execution-1', workUnitId: 'unit-1', failure: 'failed' }],
      ['execution.work.block', { executionId: 'execution-1', workUnitId: 'unit-1', blockerId: 'blocker-1', question: 'Need input?' }],
      ['execution.work.release', { executionId: 'execution-1', workUnitId: 'unit-1' }],
      ['execution.work.retry', { executionId: 'execution-1', workUnitId: 'unit-1' }],
      ['execution.source.list', { executionId: 'execution-1' }],
      ['execution.source.read', { executionId: 'execution-1', sourceId: 'source-1' }],
      ['execution.event', { executionId: 'execution-1', eventId: 'event-1', type: 'progress', severity: 'info', summary: 'Working' }],
      ['execution.artifact.put', { executionId: 'execution-1', name: 'result.md', mediaType: 'text/markdown', content: 'done' }],
      ['execution.artifact.list', { executionId: 'execution-1' }],
      ['execution.complete', { executionId: 'execution-1', summary: 'Done' }]
    ] as const;
    for (const [name, input] of cases) {
      const result = await tools.get(name)!(input);
      expect(result, name).toMatchObject({ isError: true });
      expect(text(result), name).toContain('role is not authorized');
    }
  });

  it('maps unbound service failures and missing reads to explicit tool errors', async () => {
    const execution = service();
    const failed = { ok: false as const, code: 'DENIED', message: 'not permitted' };
    execution.status.mockResolvedValue(undefined as never);
    execution.snapshot.mockRejectedValue('snapshot unavailable');
    execution.reportEvent.mockResolvedValue(failed as never);
    execution.stop.mockResolvedValue(failed as never);
    execution.completeByCoordinator.mockResolvedValue(failed as never);
    execution.retry.mockResolvedValue(failed as never);
    execution.respond.mockResolvedValue(failed as never);
    execution.resume.mockResolvedValue(failed as never);
    execution.putArtifact.mockResolvedValue(failed as never);
    execution.listArtifacts.mockResolvedValue(undefined as never);
    execution.mintResumeGrant.mockResolvedValue(failed as never);
    execution.revokeResumeGrant.mockResolvedValue(failed as never);
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'owner', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const cases = [
      ['execution.status', { executionId: 'execution-1' }, 'execution not found'],
      ['execution.snapshot', { executionId: 'execution-1' }, 'snapshot unavailable'],
      ['execution.event', { executionId: 'execution-1', eventId: 'event-1', type: 'progress', severity: 'info', summary: 'Working' }, 'not permitted'],
      ['execution.stop', { executionId: 'execution-1', expectedStateVersion: 1 }, 'not permitted'],
      ['execution.complete', { executionId: 'execution-1', summary: 'Done' }, 'not permitted'],
      ['execution.retry', { executionId: 'execution-1', expectedStateVersion: 1 }, 'not permitted'],
      ['execution.respond', { executionId: 'execution-1', expectedStateVersion: 1, slotId: 'slot-1', message: 'Answer' }, 'not permitted'],
      ['execution.resume', { executionId: 'execution-1', expectedStateVersion: 1, slotId: 'slot-1', message: 'Continue' }, 'not permitted'],
      ['execution.artifact.put', { executionId: 'execution-1', name: 'result.md', mediaType: 'text/markdown', content: 'done' }, 'not permitted'],
      ['execution.artifact.list', { executionId: 'execution-1' }, 'execution not found'],
      ['execution.mint_resume_grant', { executionId: 'execution-1' }, 'not permitted'],
      ['execution.revoke_resume_grant', { executionId: 'execution-1' }, 'not permitted']
    ] as const;
    for (const [name, input, message] of cases) {
      const result = await tools.get(name)!(input);
      expect(result, name).toMatchObject({ isError: true });
      expect(text(result), name).toContain(message);
    }
  });

  it('returns bounded snapshot metadata without artifact content', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const result = await tools.get('execution.snapshot')!({ executionId: 'execution-1', after: 4 });
    expect(execution.snapshot).toHaveBeenCalledWith('session-1', 'project-1', 'execution-1', 4);
    expect(JSON.parse(text(result))).toMatchObject({ nextAfter: 0, artifacts: [{ id: 'artifact-1', name: 'result.md' }] });
    expect(text(result)).not.toContain('secret');
  });

  it('returns artifact metadata only from list tool', async () => {
    const execution = service();
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const result = await tools.get('execution.artifact.list')!({ executionId: 'execution-1' });
    expect(JSON.parse(text(result))).toEqual([{ id: 'artifact-1' }]);
    expect(text(result)).not.toContain('secret');
  });

  it('preserves non-object artifact list entries while redacting object content', async () => {
    const execution = service();
    execution.listArtifacts.mockResolvedValue([null, 'external', { id: 'artifact-1', content: 'secret' }] as never);
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'session-1', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true });
    const result = await tools.get('execution.artifact.list')!({ executionId: 'execution-1' });
    expect(JSON.parse(text(result))).toEqual([null, 'external', { id: 'artifact-1' }]);
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
    execution.status.mockResolvedValue({ id: 'execution-1', state: 'COMPLETED' } as never);
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
      const monitored = await target.tools.get('execution_handoff_status')!({ token: monitor, executionId: 'execution-1' });
      expect(monitored.isError).toBeFalsy();
      expect(JSON.parse(text(monitored))).not.toHaveProperty('deliveries');
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

  it('reads monitor events with defaults and rejects an invalid monitor token', async () => {
    const execution = service();
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-mcp-'));
    try {
      const handoffs = createExecutionHandoffStore({ filePath: join(dir, 'handoffs.json'), token: randomUUID });
      const source = fakeServer();
      registerExecutionTools(source.server as never, {
        sessionId: 'source', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs, validateHandoffTarget: () => true, approveHandoff: async () => true
      });
      const requested = await source.tools.get('request_execution_monitor_handoff')!({ targetSessionId: 'target', executionId: 'execution-1' });
      const monitor = JSON.parse(text(requested)).token as string;
      const target = fakeServer();
      registerExecutionTools(target.server as never, {
        sessionId: 'target', projectId: 'project-1', service: execution as never, validateRouteIdentity: () => true,
        handoffs, validateHandoffTarget: () => true, approveHandoff: async () => true
      });
      const events = await target.tools.get('execution_handoff_events')!({ token: monitor, executionId: 'execution-1' });
      const denied = await target.tools.get('execution_handoff_events')!({ token: 'invalid', executionId: 'execution-1' });
      expect(events.isError).toBeFalsy();
      expect(execution.events).toHaveBeenLastCalledWith('source', 'project-1', 'execution-1', 0, 100);
      expect(denied).toMatchObject({ isError: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
