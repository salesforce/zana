import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary } from './sdk/harness';
import { nativeDialogCalls, stubNativeDialogs } from './sdk/native-dialog';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { teamLaunchEnabled: true } });

async function clientFor(window: import('@playwright/test').Page, sessionId: string): Promise<Client> {
  const url = await window.evaluate((id) => window.__zccTest?.mcpRoute(id), sessionId);
  if (!url) throw new Error(`missing MCP route for ${sessionId}`);
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
      await window.cc.teams.save({ id: 'e2e-exec-team', name: 'E2E Execution Team', slots: [{ personaId: 'e2e-exec-persona' }] });
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
      version: 1, teamId: 'e2e-exec-team', launchRequestId: 'e2e-execution-1', jobTitle: 'E2E durable job', slots: [{ initialTask: 'Hold for monitor' }]
    } });
    expect((started as { isError?: boolean }).isError).toBeFalsy();
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

test('synthetic two-worker contract communicates, records output, and completes durably', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-execution-contract-'));
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
      await window.cc.personas.save({ id: 'e2e-contract-persona', name: 'E2E Contract Worker', baseProfile: 'claude', permissionMode: 'acceptEdits' });
      await window.cc.teams.save({ id: 'e2e-contract-team', name: 'E2E Contract Team', slots: [{ personaId: 'e2e-contract-persona', quantity: 2 }] });
    });
    await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), fake.path);
    ownerId = await window.evaluate(async (project) => {
      const result = await window.cc.terminals.create({ projectId: project, profile: 'claude', cols: 80, rows: 24, title: 'Contract owner' }) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectId);
    const owner = await clientFor(window, ownerId);
    clients.push(owner);
    const started = await owner.callTool({ name: 'execution.start', arguments: {
      version: 1, teamId: 'e2e-contract-team', launchRequestId: 'e2e-contract-run', jobTitle: 'Synthetic contract',
      slots: [{ initialTask: 'worker one: produce analysis' }, { initialTask: 'worker two: validate analysis' }]
    } });
    expect((started as { isError?: boolean }).isError).toBeFalsy();
    const execution = JSON.parse(toolText(started)) as { id: string; teamLaunchRequestId: string; state: string };
    expect(execution.state).toBe('RUNNING');
    const lifecycle = await waitForTool(
      () => owner.callTool({ name: 'get_team_launch', arguments: { launchRequestId: execution.teamLaunchRequestId } }),
      (result) => !(result as { isError?: boolean }).isError && (JSON.parse(toolText(result)) as { workers?: unknown[] }).workers?.length === 2
    );
    const workers = (JSON.parse(toolText(lifecycle)) as { workers: Array<{ sessionId: string; slotId: string }> }).workers;
    expect(workers.map((worker) => worker.slotId)).toHaveLength(2);
    const workerClients = await Promise.all(workers.map((worker) => clientFor(window, worker.sessionId)));
    clients.push(...workerClients);
    const sent = await waitForTool(
      () => workerClients[0].callTool({ name: 'agent_send', arguments: { to: workers[1].sessionId, message: 'analysis ready for validation' } }),
      (result) => !(result as { isError?: boolean }).isError
    );
    expect(toolText(sent)).toMatch(/Queued|Delivered/);
    const inbox = await workerClients[1].callTool({ name: 'agent_inbox', arguments: {} });
    expect(toolText(inbox)).toContain('analysis ready for validation');
    const artifact = await owner.callTool({ name: 'execution.artifact.put', arguments: {
      executionId: execution.id, name: 'result.json', mediaType: 'application/json', content: '{"result":"complete"}'
    } });
    expect((artifact as { isError?: boolean }).isError).toBeFalsy();
    const launchRequestId = (JSON.parse(toolText(await owner.callTool({ name: 'get_team_launch', arguments: { launchRequestId: execution.teamLaunchRequestId } }))) as { launchRequestId: string }).launchRequestId;
    for (const [index, worker] of workers.entries()) {
      const reported = await workerClients[index].callTool({ name: 'report_team_task', arguments: {
        launchRequestId, slotId: worker.slotId, outcome: 'complete'
      } });
      if ((reported as { isError?: boolean }).isError) throw new Error(`${toolText(reported)} worker=${JSON.stringify(worker)} lifecycle=${toolText(lifecycle)}`);
    }
    const completed = await waitForTool(
      () => owner.callTool({ name: 'execution.status', arguments: { executionId: execution.id } }),
      (result) => !(result as { isError?: boolean }).isError && (JSON.parse(toolText(result)) as { state?: string }).state === 'COMPLETED'
    );
    expect(JSON.parse(toolText(completed))).toMatchObject({ id: execution.id, state: 'COMPLETED', jobTitle: 'Synthetic contract' });
    const artifacts = await owner.callTool({ name: 'execution.artifact.list', arguments: { executionId: execution.id } });
    expect(toolText(artifacts)).toContain('result.json');
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
      await window.cc.teams.save({ id: 'e2e-failure-team', name: 'E2E Failure Team', slots: [{ personaId: 'e2e-failure-persona' }] });
    });
    await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), fake.path);
    ownerId = await window.evaluate(async (project) => {
      const result = await window.cc.terminals.create({ projectId: project, profile: 'claude', cols: 80, rows: 24, title: 'Failure owner' }) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectId);
    const owner = await clientFor(window, ownerId);
    clients.push(owner);
    const started = await owner.callTool({ name: 'execution.start', arguments: {
      version: 1, teamId: 'e2e-failure-team', launchRequestId: 'e2e-failure-run', slots: [{ initialTask: 'fail deliberately' }]
    } });
    const execution = JSON.parse(toolText(started)) as { id: string; teamLaunchRequestId: string };
    const lifecycle = await waitForTool(
      () => owner.callTool({ name: 'get_team_launch', arguments: { launchRequestId: execution.teamLaunchRequestId } }),
      (result) => !(result as { isError?: boolean }).isError && (JSON.parse(toolText(result)) as { workers?: unknown[] }).workers?.length === 1
    );
    const worker = (JSON.parse(toolText(lifecycle)) as { workers: Array<{ sessionId: string; slotId: string }> }).workers[0];
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
