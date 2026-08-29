import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary, makeSilentOpenCodeBinary } from './sdk/harness';
import { nativeDialogCalls, stubNativeDialogs } from './sdk/native-dialog';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { teamLaunchEnabled: true } });

async function clientFor(window: import('@playwright/test').Page, sessionId: string): Promise<Client> {
  const url = await waitForTool(
    () => window.evaluate((id) => window.__zccTest?.mcpRoute(id), sessionId),
    (route): route is string => typeof route === 'string' && route.length > 0
  );
  const client = new Client({ name: 'execution-handoff-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

function toolText(result: unknown): string {
  return ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? '';
}

async function waitForTool<T>(call: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await call();
    if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for MCP result');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('approved monitor handoff is target-bound and exposes only the bound execution', async ({ app }) => {
  const { window, electron } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-execution-handoff-'));
  const fake = makeFakeAgentBinary({ profile: 'claude', sequence: 'working-hold' });
  const clients: Client[] = [];
  let projectId = '';
  let sourceId = '';
  let targetId = '';
  try {
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectDir);
    expect(projectId).toBeTruthy();
    await window.evaluate(async () => {
      await window.cc.personas.save({ id: 'e2e-exec-persona', name: 'E2E Execution', baseProfile: 'claude', permissionMode: 'acceptEdits' });
      await window.cc.personas.save({ id: 'e2e-exec-coordinator', name: 'E2E Execution Coordinator', baseProfile: 'claude', permissionMode: 'acceptEdits' });
      await window.cc.teams.save({ id: 'e2e-exec-team', name: 'E2E Execution Team', slots: [{ personaId: 'e2e-exec-persona' }], orchestratorPersonaId: 'e2e-exec-coordinator' });
    });
    await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), fake.path);
    [sourceId, targetId] = await window.evaluate(async (project) => {
      const create = async (title: string) => {
        const result = await window.cc.terminals.create({ projectId: project, profile: 'claude', cols: 80, rows: 24, title }) as { value?: { id: string }; id?: string };
        return result.value?.id ?? result.id ?? '';
      };
      return Promise.all([create('Execution owner'), create('Execution monitor')]);
    }, projectId);
    expect(sourceId).toBeTruthy();
    expect(targetId).toBeTruthy();
    await stubNativeDialogs(electron, [0]);
    const source = await clientFor(window, sourceId);
    const target = await clientFor(window, targetId);
    clients.push(source, target);
    const started = await source.callTool({ name: 'execution.start', arguments: {
      version: 1, teamId: 'e2e-exec-team', launchRequestId: 'e2e-execution-1', jobTitle: 'E2E durable job', slots: [{ initialTask: 'Hold for monitor' }, { initialTask: 'Coordinate monitor handoff' }]
    } });
    if ((started as { isError?: boolean }).isError) throw new Error(toolText(started));
    const executionId = (JSON.parse(toolText(started)) as { id: string }).id;
    const handoff = await source.callTool({ name: 'request_execution_monitor_handoff', arguments: { targetSessionId: targetId, executionId } });
    expect((handoff as { isError?: boolean }).isError).toBeFalsy();
    const monitorToken = (JSON.parse(toolText(handoff)) as { token: string }).token;
    const status = await target.callTool({ name: 'execution_handoff_status', arguments: { token: monitorToken, executionId } });
    expect((status as { isError?: boolean }).isError).toBeFalsy();
    expect(JSON.parse(toolText(status))).toMatchObject({ id: executionId, jobTitle: 'E2E durable job' });
    const forged = await source.callTool({ name: 'execution_handoff_status', arguments: { token: monitorToken, executionId } });
    expect((forged as { isError?: boolean }).isError).toBe(true);
    const calls = await nativeDialogCalls(electron);
    expect(calls).toContainEqual(expect.objectContaining({ title: 'Approve execution resume monitoring', detail: expect.stringContaining('10 minutes') }));
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    await window.evaluate(async ({ project, source, target }) => {
      for (const id of [source, target]) if (id) await window.cc.terminals.close(id).catch(() => {});
      if (project) await window.cc.projects.remove(project).catch(() => {});
    }, { project: projectId, source: sourceId, target: targetId }).catch(() => {});
    fake.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('deterministic Job Team executes dependent work, blocker response, verification, and durable completion', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-execution-contract-'));
  // OpenCode (non-OSC) workers whose kickoff arrives via `--prompt` argv (never
  // stdin) settle to the cross-harness `waiting` state — the precondition this
  // test asserts before it assigns disjoint units to already-resting workers.
  const fake = makeSilentOpenCodeBinary();
  const clients: Client[] = [];
  let projectId = '';
  let ownerId = '';
  try {
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectDir);
    await window.evaluate(async () => {
      await window.cc.personas.save({ id: 'e2e-contract-persona', name: 'E2E Contract Worker', baseProfile: 'opencode', permissionMode: 'acceptEdits' });
      await window.cc.personas.save({ id: 'e2e-contract-coordinator', name: 'E2E Contract Coordinator', baseProfile: 'opencode', permissionMode: 'acceptEdits' });
      await window.cc.teams.save({ id: 'e2e-contract-team', name: 'E2E Contract Team', slots: [{ personaId: 'e2e-contract-persona', quantity: 2 }], orchestratorPersonaId: 'e2e-contract-coordinator' });
    });
    await window.evaluate((bin) => window.cc.config.set({ harnessOpenCodeEnabled: true, opencodeBinary: bin }), fake.path);
    ownerId = await window.evaluate(async (project) => {
      const result = await window.cc.terminals.create({ projectId: project, profile: 'opencode', cols: 80, rows: 24, title: 'Contract owner' }) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectId);
    const owner = await clientFor(window, ownerId);
    clients.push(owner);
    const tools = await owner.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('execution.start');
    const startRequest = {
      version: 1, teamId: 'e2e-contract-team', launchRequestId: 'e2e-contract-run', jobTitle: 'Synthetic contract',
      slots: [{ initialTask: 'worker one: produce analysis' }, { initialTask: 'worker two: validate analysis' }, { initialTask: 'coordinate dependent plan' }],
      workUnits: [
        { id: 'analysis', title: 'Analysis', task: 'Produce analysis', dependencies: [], files: ['shared/result.json'], verification: ['result is valid JSON'] },
        { id: 'overlap', title: 'Overlap', task: 'Conflicting edit', dependencies: [], files: ['shared/result.json'], verification: ['conflict resolved'] },
        { id: 'partition', title: 'Partition', task: 'Independent disjoint edit', dependencies: [], files: ['shared/partition.json'], verification: ['partition written'] },
        { id: 'verify', title: 'Verification', task: 'Verify analysis', dependencies: ['analysis'], files: ['shared/result.json'], verification: ['result is complete'], readOnly: true }
      ]
    };
    const requestDir = join(app.home, '.zcc', 'execution-requests');
    const requestPath = join(requestDir, 'e2e-preplanned-request.json');
    mkdirSync(requestDir, { recursive: true });
    writeFileSync(requestPath, JSON.stringify(startRequest));
    const started = await owner.callTool({ name: 'execution.start', arguments: { requestPath } });
    if ((started as { isError?: boolean }).isError) throw new Error(toolText(started));
    expect(() => writeFileSync(requestPath, 'request must have been consumed', { flag: 'wx' })).not.toThrow();
    rmSync(requestPath, { force: true });
    const execution = JSON.parse(toolText(started)) as { id: string; teamLaunchRequestId: string; state: string };
    expect(execution.state).toBe('RUNNING');
    const lifecycle = await waitForTool(
      () => owner.callTool({ name: 'get_team_launch', arguments: { launchRequestId: execution.teamLaunchRequestId } }),
      (result) => !(result as { isError?: boolean }).isError
    );
    const launch = JSON.parse(toolText(lifecycle)) as { launchResult: { orchestratorSessionId: string }; workers: Array<{ sessionId: string; slotId: string }> };
    const orchestratorSessionId = launch.launchResult.orchestratorSessionId;
    const workers = launch.workers.filter((worker) => worker.sessionId !== orchestratorSessionId);
    expect(workers.map((worker) => worker.slotId), toolText(lifecycle)).toHaveLength(2);
    expect(orchestratorSessionId, toolText(lifecycle)).toBeTruthy();
    const workerClients = await Promise.all(workers.map((worker) => clientFor(window, worker.sessionId)));
    const coordinator = await clientFor(window, orchestratorSessionId);
    clients.push(...workerClients, coordinator);
    // Precondition: both workers have settled into the cross-harness at-rest
    // `waiting` state (non-OSC harness, no first output). Assert they actually
    // READ `waiting` before the coordinator assigns disjoint units to them.
    for (const worker of workers) {
      await expect.poll(async () => {
        const pairs = await window.evaluate(() => window.cc.terminals.agentStatusSnapshot()) as Array<[string, string]>;
        return pairs.find(([id]) => id === worker.sessionId)?.[1] ?? null;
      }, { timeout: 20_000, message: `worker ${worker.sessionId} waiting` }).toBe('waiting');
    }
    const preplanned = await coordinator.callTool({ name: 'execution.snapshot', arguments: { executionId: execution.id } });
    expect((preplanned as { isError?: boolean }).isError).toBeFalsy();
    expect(JSON.parse(toolText(preplanned))).toMatchObject({
      execution: {
        id: execution.id,
        workUnits: [
          { id: 'analysis', state: 'READY' },
          { id: 'overlap', state: 'READY' },
          { id: 'partition', state: 'READY' },
          { id: 'verify', state: 'PENDING' }
        ]
      }
    });
    expect(JSON.parse(toolText(preplanned)).execution.workUnits.map(({ id }: { id: string }) => id)).toEqual(
      startRequest.workUnits.map(({ id }) => id)
    );
    const legacyClaim = await coordinator.callTool({ name: 'execution.work.claim', arguments: { executionId: execution.id, workUnitId: 'analysis', assignedSlotId: workers[0].slotId } });
    expect((legacyClaim as { isError?: boolean }).isError).toBe(true);
    expect(toolText(legacyClaim)).toContain('coordinator must use execution.work.assign');
    // Two DISJOINT mutating units assign to the two already-`waiting` workers IN
    // PARALLEL — both flip to CLAIMED, no human nudge.
    const [assignedAnalysis, assignedPartition] = await Promise.all([
      coordinator.callTool({ name: 'execution.work.assign', arguments: { executionId: execution.id, workUnitId: 'analysis', assignedSlotId: workers[0].slotId } }),
      coordinator.callTool({ name: 'execution.work.assign', arguments: { executionId: execution.id, workUnitId: 'partition', assignedSlotId: workers[1].slotId } })
    ]);
    expect((assignedAnalysis as { isError?: boolean }).isError, toolText(assignedAnalysis)).toBeFalsy();
    expect((assignedPartition as { isError?: boolean }).isError, toolText(assignedPartition)).toBeFalsy();
    const parallelSnapshot = JSON.parse(toolText(await coordinator.callTool({ name: 'execution.snapshot', arguments: { executionId: execution.id } }))) as {
      execution: { workUnits: Array<{ id: string; state: string; assignedSlotId?: string }> };
    };
    const parallelById = new Map(parallelSnapshot.execution.workUnits.map((u) => [u.id, u]));
    expect(parallelById.get('analysis')).toMatchObject({ state: 'CLAIMED', assignedSlotId: workers[0].slotId });
    expect(parallelById.get('partition')).toMatchObject({ state: 'CLAIMED', assignedSlotId: workers[1].slotId });
    // Finish worker two's disjoint unit so the overlap-conflict claim below fails
    // on file scope, not because the worker already holds active work.
    const partitionDone = await workerClients[1].callTool({ name: 'execution.work.complete', arguments: { executionId: execution.id, workUnitId: 'partition', result: 'partition written' } });
    expect((partitionDone as { isError?: boolean }).isError).toBeFalsy();
    const dependencyWait = await workerClients[1].callTool({ name: 'execution.work.claim', arguments: { executionId: execution.id, workUnitId: 'verify' } });
    expect((dependencyWait as { isError?: boolean }).isError).toBe(true);
    expect(toolText(dependencyWait)).toContain('work unit is not ready');
    const overlap = await workerClients[1].callTool({ name: 'execution.work.claim', arguments: { executionId: execution.id, workUnitId: 'overlap' } });
    expect((overlap as { isError?: boolean }).isError).toBe(true);
    expect(toolText(overlap)).toContain('overlapping mutating file scope');
    const progress = await workerClients[0].callTool({ name: 'execution.event', arguments: {
      executionId: execution.id, eventId: 'analysis-progress', type: 'progress', severity: 'info', summary: 'analysis half complete', progress: { completed: 1, total: 2 }
    } });
    expect((progress as { isError?: boolean }).isError).toBeFalsy();
    const sent = await waitForTool(
      () => workerClients[0].callTool({ name: 'agent_send', arguments: { to: workers[1].sessionId, message: 'analysis ready for validation' } }),
      (result) => !(result as { isError?: boolean }).isError
    );
    // Delivery depends on the target's state AT SEND TIME (isRestfulAgentState):
    // a busy peer QUEUES (drained via agent_inbox), an at-rest peer is INJECTED at
    // its prompt (Delivered — never enters the pull-queue). Assert the branch that
    // actually happened so the check is deterministic across both harness states.
    const sentText = toolText(sent);
    expect(sentText).toMatch(/Queued|Delivered/);
    if (/Queued/.test(sentText)) {
      const inbox = await workerClients[1].callTool({ name: 'agent_inbox', arguments: {} });
      expect(toolText(inbox)).toContain('analysis ready for validation');
    }
    const artifact = await workerClients[0].callTool({ name: 'execution.artifact.put', arguments: {
      executionId: execution.id, name: 'result.json', mediaType: 'application/json', content: '{"result":"complete"}'
    } });
    expect((artifact as { isError?: boolean }).isError).toBeFalsy();
    const blocked = await workerClients[0].callTool({ name: 'execution.work.block', arguments: {
      executionId: execution.id, workUnitId: 'analysis', blockerId: 'choose-format', question: 'Choose format?', options: ['JSON', 'Markdown']
    } });
    expect((blocked as { isError?: boolean }).isError).toBeFalsy();
    const blockedRecord = JSON.parse(toolText(blocked)) as { stateVersion: number };
    const resumed = await window.evaluate(async ({ projectId, executionId, stateVersion }) =>
      window.cc.executionBoard.resume(projectId, executionId, stateVersion, 'choose-format', 'contract-response', 'JSON'),
      { projectId, executionId: execution.id, stateVersion: blockedRecord.stateVersion });
    expect(resumed, JSON.stringify(resumed)).toMatchObject({ ok: true, value: { currentBlocker: { delivery: { state: 'PENDING' } } } });
    const delivery = await workerClients[0].callTool({ name: 'execution.delivery.pull', arguments: {} });
    expect((delivery as { isError?: boolean }).isError).toBeFalsy();
    const deliveryRecord = JSON.parse(toolText(delivery)) as { id: string; leaseId: string; payload: { text: string } };
    expect(deliveryRecord.payload.text).toBe('JSON');
    const acknowledged = await workerClients[0].callTool({ name: 'execution.delivery.ack', arguments: {
      deliveryId: deliveryRecord.id, leaseId: deliveryRecord.leaseId, delivered: true
    } });
    expect((acknowledged as { isError?: boolean }).isError).toBeFalsy();
    const afterResume = await window.evaluate(({ projectId, executionId }) => window.cc.executionBoard.snapshot(projectId, executionId), { projectId, executionId: execution.id });
    expect(afterResume?.execution).toMatchObject({ state: 'RUNNING' });
    expect(afterResume?.execution.currentBlocker).toBeUndefined();
    const analysisDone = await workerClients[0].callTool({ name: 'execution.work.complete', arguments: { executionId: execution.id, workUnitId: 'analysis', result: 'analysis complete' } });
    expect((analysisDone as { isError?: boolean }).isError).toBeFalsy();
    const early = await coordinator.callTool({ name: 'execution.complete', arguments: { executionId: execution.id, summary: 'too early' } });
    expect((early as { isError?: boolean }).isError).toBe(true);
    expect(toolText(early)).toContain('required work units are incomplete');
    const verifyClaim = await workerClients[1].callTool({ name: 'execution.work.claim', arguments: { executionId: execution.id, workUnitId: 'verify' } });
    expect((verifyClaim as { isError?: boolean }).isError).toBeFalsy();
    const verified = await workerClients[1].callTool({ name: 'execution.work.complete', arguments: { executionId: execution.id, workUnitId: 'verify', result: 'verification passed' } });
    expect((verified as { isError?: boolean }).isError).toBeFalsy();
    const overlapClaim = await workerClients[0].callTool({ name: 'execution.work.claim', arguments: { executionId: execution.id, workUnitId: 'overlap' } });
    expect((overlapClaim as { isError?: boolean }).isError).toBeFalsy();
    const overlapDone = await workerClients[0].callTool({ name: 'execution.work.complete', arguments: { executionId: execution.id, workUnitId: 'overlap', result: 'conflict resolved' } });
    expect((overlapDone as { isError?: boolean }).isError).toBeFalsy();
    const finalized = await coordinator.callTool({ name: 'execution.complete', arguments: { executionId: execution.id, summary: 'Analysis complete; verification passed.' } });
    expect((finalized as { isError?: boolean }).isError).toBeFalsy();
    const completed = await waitForTool(
      () => owner.callTool({ name: 'execution.status', arguments: { executionId: execution.id } }),
      (result) => !(result as { isError?: boolean }).isError && (JSON.parse(toolText(result)) as { state?: string }).state === 'COMPLETED'
    );
    expect(JSON.parse(toolText(completed))).toMatchObject({ id: execution.id, state: 'COMPLETED', jobTitle: 'Synthetic contract', finalSummary: 'Analysis complete; verification passed.' });
    const artifacts = await owner.callTool({ name: 'execution.artifact.list', arguments: { executionId: execution.id } });
    expect(toolText(artifacts)).toContain('result.json');
    const board = await window.evaluate(({ projectId, executionId }) => Promise.all([
      window.cc.executionBoard.listProject(projectId),
      window.cc.executionBoard.snapshot(projectId, executionId)
    ]), { projectId, executionId: execution.id });
    expect(board[0].executions).toContainEqual(expect.objectContaining({ executionId: execution.id, state: 'COMPLETED', finalSummary: 'Analysis complete; verification passed.' }));
    expect(board[1]).toMatchObject({ execution: { executionId: execution.id, state: 'COMPLETED' }, artifacts: [{ name: 'result.json' }] });
    const reopened = await window.evaluate(({ projectId, executionId }) => window.cc.executionBoard.snapshot(projectId, executionId), { projectId, executionId: execution.id });
    expect(reopened).toEqual(board[1]);
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    await window.evaluate(async ({ project, owner }) => {
      if (owner) await window.cc.terminals.close(owner).catch(() => {});
      if (project) await window.cc.projects.remove(project).catch(() => {});
    }, { project: projectId, owner: ownerId }).catch(() => {});
    fake.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('worker failure transitions real execution to FAILED', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-execution-failure-'));
  const fake = makeFakeAgentBinary({ profile: 'claude', sequence: 'working-hold' });
  const clients: Client[] = [];
  let projectId = '';
  let ownerId = '';
  try {
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectDir);
    await window.evaluate(async () => {
      await window.cc.personas.save({ id: 'e2e-failure-persona', name: 'E2E Failure Worker', baseProfile: 'claude', permissionMode: 'acceptEdits' });
      await window.cc.personas.save({ id: 'e2e-failure-coordinator', name: 'E2E Failure Coordinator', baseProfile: 'claude', permissionMode: 'acceptEdits' });
      await window.cc.teams.save({ id: 'e2e-failure-team', name: 'E2E Failure Team', slots: [{ personaId: 'e2e-failure-persona' }], orchestratorPersonaId: 'e2e-failure-coordinator' });
    });
    await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), fake.path);
    ownerId = await window.evaluate(async (project) => {
      const result = await window.cc.terminals.create({ projectId: project, profile: 'claude', cols: 80, rows: 24, title: 'Failure owner' }) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectId);
    const owner = await clientFor(window, ownerId);
    clients.push(owner);
    const started = await owner.callTool({ name: 'execution.start', arguments: {
      version: 1, teamId: 'e2e-failure-team', launchRequestId: 'e2e-failure-run', slots: [{ initialTask: 'fail deliberately' }, { initialTask: 'coordinate failure' }]
    } });
    if ((started as { isError?: boolean }).isError) throw new Error(toolText(started));
    const execution = JSON.parse(toolText(started)) as { id: string; teamLaunchRequestId: string };
    const lifecycle = await waitForTool(
      () => owner.callTool({ name: 'get_team_launch', arguments: { launchRequestId: execution.teamLaunchRequestId } }),
      (result) => !(result as { isError?: boolean }).isError
    );
    const failureLaunch = JSON.parse(toolText(lifecycle)) as { launchResult: { orchestratorSessionId: string }; workers: Array<{ sessionId: string; slotId: string }> };
    const worker = failureLaunch.workers.find((candidate) => candidate.sessionId !== failureLaunch.launchResult.orchestratorSessionId);
    if (!worker) throw new Error(`missing failure worker: ${toolText(lifecycle)}`);
    const workerClient = await clientFor(window, worker.sessionId);
    clients.push(workerClient);
    const reported = await workerClient.callTool({ name: 'report_team_task', arguments: {
      launchRequestId: execution.teamLaunchRequestId, slotId: worker.slotId, outcome: 'failed'
    } });
    expect((reported as { isError?: boolean }).isError).toBeFalsy();
    const failed = await waitForTool(
      () => owner.callTool({ name: 'execution.status', arguments: { executionId: execution.id } }),
      (result) => !(result as { isError?: boolean }).isError && (JSON.parse(toolText(result)) as { state?: string }).state === 'FAILED'
    );
    expect(JSON.parse(toolText(failed))).toMatchObject({ id: execution.id, state: 'FAILED' });
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    await window.evaluate(async ({ project, owner }) => {
      if (owner) await window.cc.terminals.close(owner).catch(() => {});
      if (project) await window.cc.projects.remove(project).catch(() => {});
    }, { project: projectId, owner: ownerId }).catch(() => {});
    fake.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});
