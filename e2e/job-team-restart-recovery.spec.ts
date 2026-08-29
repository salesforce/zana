import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, createRelaunchLifecycle, type AppHandle } from './fixtures/app';
import { makeFakeAgentBinary } from './sdk/harness';
import { nativeDialogCalls, stubNativeDialogs, stubOpenDialog } from './sdk/native-dialog';

test.use({ e2e: true, initialConfig: { teamLaunchEnabled: true } });

test('relaunch lifecycle bounds graceful close and kills descendants discovered during cleanup', async () => {
  const root = spawn('/bin/sh', ['-c', 'sleep 0.2; sleep 300 & wait']);
  const electron = {
    process: () => root,
    close: () => new Promise<void>(() => {}),
  };
  const lifecycle = createRelaunchLifecycle(
    { electron, home: '/tmp/e2e-relaunch-lifecycle', window: {} } as AppHandle,
    { relaunchCloseTimeoutMs: 250 }
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const closed = await Promise.race([
      lifecycle.close().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    expect(closed).toBe(true);
    await expect.poll(() => {
      try {
        process.kill(root.pid!, 0);
        return true;
      } catch {
        return false;
      }
    }, { timeout: 2_000, message: 'owned process tree exits' }).toBe(false);
  } finally {
    root.kill('SIGKILL');
  }
});

function toolText(result: unknown): string {
  return ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? '';
}

async function clientFor(window: Page, sessionId: string): Promise<Client> {
  let route: string | null = null;
  await expect.poll(async () => {
    route = await window.evaluate((id) => window.__zccTest?.mcpRoute(id) ?? null, sessionId);
    return route;
  }, { timeout: 15_000, message: `MCP route for ${sessionId}` }).not.toBeNull();
  if (!route) throw new Error(`missing MCP route for ${sessionId}`);
  const client = new Client({ name: 'job-team-restart-recovery-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(route)));
  return client;
}

async function routeFor(window: Page, sessionId: string): Promise<string> {
  let route: string | null = null;
  await expect.poll(async () => {
    route = await window.evaluate((id) => window.__zccTest?.mcpRoute(id) ?? null, sessionId);
    return route;
  }, { timeout: 15_000, message: `MCP route for ${sessionId}` }).not.toBeNull();
  return route!;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  if ((result as { isError?: boolean }).isError) throw new Error(toolText(result));
  return JSON.parse(toolText(result)) as Record<string, any>;
}

test('visible automatic worker restoration survives same-HOME abrupt built-Electron restart', async ({ app }) => {
  test.setTimeout(120_000);
  const lifecycle = createRelaunchLifecycle(app, { e2e: true, initialConfig: { teamLaunchEnabled: true } });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-restart-recovery-project-'));
  const sourcePath = join(projectDir, 'restart-source.md');
  const sourceText = `# Restart recovery source\n\n${'Durable source survives original deletion.\n'.repeat(640)}`;
  writeFileSync(sourcePath, sourceText);
  const fake = makeFakeAgentBinary({ profile: 'claude', sequence: 'working-hold' });
  const clients: Client[] = [];
  let projectId = '';
  let executionId = '';
  let coordinatorId = '';
  let workerIds: string[] = [];
  let oldCoordinatorRoute = '';
  try {
    const { window, electron } = lifecycle.current;
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectDir);
    expect(projectId).toBeTruthy();
    await window.evaluate(async (bin) => {
      await window.cc.config.set({ claudeBinary: bin });
      await window.cc.personas.save({ id: 'e2e-restart-worker', name: 'Restart Worker', baseProfile: 'claude', permissionMode: 'acceptEdits' });
      await window.cc.teams.save({
        id: 'e2e-restart-team', name: 'Restart Recovery Team',
        slots: [{ personaId: 'e2e-restart-worker', quantity: 2 }],
        orchestratorPersonaId: 'builtin:orchestrator'
      });
    }, fake.path);
    await stubOpenDialog(electron, [[sourcePath]]);
    const capabilities = await window.evaluate((id) => window.cc.executionSources.pick(id), projectId);
    expect(capabilities).toMatchObject({ ok: true });
    const sourceCapabilityIds = (capabilities as { value: Array<{ id: string }> }).value.map(({ id }) => id);
    const launched = await window.evaluate(({ project, sourceIds }) => window.cc.teams.startJob({
      teamId: 'e2e-restart-team', projectId: project,
      goal: 'Prove restart recovery', title: 'Restart recovery job',
      summary: 'Keep completed, claimed, blocked, artifact, source, and cursor state.',
      sourceCapabilityIds: sourceIds
    }), { project: projectId, sourceIds: sourceCapabilityIds });
    expect(launched).toMatchObject({ ok: true, value: { state: 'RUNNING' } });
    executionId = (launched as { value: { executionId: string } }).value.executionId;

    const sessions = await expect.poll(() => window.evaluate((id) => window.cc.terminals.list(id), projectId), {
      timeout: 15_000, message: 'Job Team sessions'
    }).toHaveLength(3).then(() => window.evaluate((id) => window.cc.terminals.list(id), projectId));
    const executionSessions = sessions.filter((session) => session.cohort?.executionId === executionId);
    coordinatorId = executionSessions.find((session) => session.cohort?.role === 'orchestrator')?.id ?? '';
    workerIds = executionSessions.filter((session) => session.cohort?.role === 'worker').map((session) => session.id);
    expect(coordinatorId).toBeTruthy();
    expect(workerIds).toHaveLength(2);
    const initialWorkerPids = executionSessions
      .filter((session) => workerIds.includes(session.id))
      .map((session) => session.pid);
    expect(initialWorkerPids.every((pid) => typeof pid === 'number')).toBe(true);
    const workerRestoreCapabilityIds = executionSessions
      .filter((session) => workerIds.includes(session.id))
      .map((session) => session.restoreCapabilityId)
      .filter((id): id is string => !!id);
    expect(workerRestoreCapabilityIds).toHaveLength(2);
    const expectedWorkerSlots = executionSessions
      .filter((session) => workerIds.includes(session.id))
      .map((session) => session.cohort?.slotId)
      .filter((id): id is string => !!id)
      .sort();
    expect(expectedWorkerSlots).toHaveLength(2);
    for (const workerId of workerIds) await window.evaluate((id) => window.cc.terminals.setHeadless(id, true), workerId);
    oldCoordinatorRoute = await routeFor(window, coordinatorId);
    const coordinator = await clientFor(window, coordinatorId);
    const workers = await Promise.all(workerIds.map((id) => clientFor(window, id)));
    clients.push(coordinator, ...workers);

    await call(coordinator, 'execution.plan.register', { executionId, workUnits: [
      { id: 'done', title: 'Completed setup', task: 'Prepare baseline', dependencies: [] },
      { id: 'blocked', title: 'Blocked implementation', task: 'Need format choice', dependencies: [] },
      { id: 'verify', title: 'Dependent verification', task: 'Verify recovered output', dependencies: ['blocked'], readOnly: true, verification: ['recovery complete'] }
    ] });
    await call(workers[0], 'execution.work.claim', { executionId, workUnitId: 'done' });
    await call(workers[0], 'execution.work.complete', { executionId, workUnitId: 'done', result: 'baseline complete' });
    await call(workers[1], 'execution.work.claim', { executionId, workUnitId: 'blocked' });
    await call(workers[1], 'execution.artifact.put', { executionId, name: 'before-restart.json', mediaType: 'application/json', content: '{"phase":"before-restart"}' });
    await call(workers[1], 'execution.work.block', { executionId, workUnitId: 'blocked', blockerId: 'format-choice', question: 'Which durable format?', options: ['JSON', 'Markdown'] });
    await call(workers[1], 'execution.event', { executionId, eventId: 'before-kill-progress', type: 'progress', severity: 'info', summary: 'restart checkpoint', progress: { completed: 1, total: 3 } });

    const before = await window.evaluate(({ project, execution }) => window.cc.executionBoard.snapshot(project, execution), { project: projectId, execution: executionId });
    expect(before?.execution).toMatchObject({
      state: 'BLOCKED', currentBlocker: { id: 'format-choice' },
      work: { completed: 1, counts: { COMPLETED: 1, BLOCKED: 1, PENDING: 1 } }
    });
    expect(before?.artifacts).toContainEqual(expect.objectContaining({ name: 'before-restart.json' }));
    const pendingResponse = await window.evaluate(({ project, execution, version }) => window.cc.executionBoard.respond(
      project, execution, version, 'format-choice', 'restart-response', 'JSON'
    ), { project: projectId, execution: executionId, version: before!.execution.stateVersion! });
    expect(pendingResponse, JSON.stringify(pendingResponse)).toMatchObject({ ok: true, value: { currentBlocker: { delivery: { state: 'PENDING' } } } });
    const pendingDeliveryId = (pendingResponse as { value: { currentBlocker: { delivery: { id: string } } } }).value.currentBlocker.delivery.id;
    const stateVersionBefore = (pendingResponse as { value: { stateVersion: number } }).value.stateVersion;
    const cursorBefore = before!.nextAfter;
    await expect.poll(() => window.evaluate(({ project, capabilityIds }) => {
      const snapshot = JSON.parse(localStorage.getItem('zcc.openSessions') ?? '{}') as Record<string, Array<{ restoreCapabilityId?: string }>>;
      return (snapshot[project] ?? []).filter((session) => session.restoreCapabilityId && capabilityIds.includes(session.restoreCapabilityId)).length;
    }, { project: projectId, capabilityIds: workerRestoreCapabilityIds }), { timeout: 15_000, message: 'worker restore snapshot persisted before kill' }).toBe(2);
    rmSync(sourcePath, { force: true });
    expect(existsSync(sourcePath)).toBe(false);

    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => {})));
    await lifecycle.forceKill();
    const relaunched = await lifecycle.relaunch();
    expect(relaunched.home).toBe(app.home);
    const afterWindow = relaunched.window;
    // Renderer startup may already be restoring these public preload
    // capabilities. Calling restore here exercises same contract; DENIED means
    // startup atomically reserved capability first, never duplicate ownership.
    const workerRestoreResults = await afterWindow.evaluate(async (capabilityIds) => Promise.all(
      capabilityIds.map((capabilityId) => window.cc.terminals.restore({ capabilityId }))
    ), workerRestoreCapabilityIds);
    expect(workerRestoreResults).toHaveLength(2);
    expect(workerRestoreResults.every((result) => result.ok || result.code === 'DENIED')).toBe(true);
    const staleClient = new Client({ name: 'stale-restart-route-e2e', version: '1.0.0' });
    let staleRouteRejected = false;
    try {
      await staleClient.connect(new StreamableHTTPClientTransport(new URL(oldCoordinatorRoute)));
      const staleResult = await staleClient.callTool({ name: 'execution.list', arguments: {} });
      staleRouteRejected = (staleResult as { isError?: boolean }).isError === true;
    } catch {
      staleRouteRejected = true;
    }
    expect(staleRouteRejected).toBe(true);
    await staleClient.close().catch(() => {});
    const recoveredSnapshot = await expect.poll(
      () => afterWindow.evaluate(({ project, execution }) => window.cc.executionBoard.snapshot(project, execution), { project: projectId, execution: executionId }),
      { timeout: 15_000, message: 'durable execution after relaunch' }
    ).toMatchObject({ execution: { recoveryAttention: true, recovery: { status: 'available' } } }).then(() =>
      afterWindow.evaluate(({ project, execution }) => window.cc.executionBoard.snapshot(project, execution), { project: projectId, execution: executionId }));
    expect(recoveredSnapshot!.execution.stateVersion).toBeGreaterThanOrEqual(stateVersionBefore);
    expect(recoveredSnapshot!.nextAfter).toBeGreaterThanOrEqual(cursorBefore);
    expect(recoveredSnapshot!.execution.sources).toContainEqual(expect.objectContaining({ name: basename(sourcePath), byteSize: Buffer.byteLength(sourceText) }));
    expect(recoveredSnapshot!.execution.currentBlocker).toMatchObject({ id: 'format-choice', question: 'Which durable format?' });
    expect(recoveredSnapshot!.artifacts).toContainEqual(expect.objectContaining({ name: 'before-restart.json' }));

    const postRestartSessions = await afterWindow.evaluate((id) => window.cc.terminals.list(id), projectId);
    expect(postRestartSessions.map((session) => session.id)).not.toContain(coordinatorId);
    const restoredWorkers = await expect.poll(async () => {
      const sessions = await afterWindow.evaluate((id) => window.cc.terminals.list(id), projectId);
      return sessions.filter((session) => session.cohort?.role === 'worker' && expectedWorkerSlots.includes(session.cohort.slotId ?? ''));
    }, { timeout: 15_000, message: 'both Job Team worker slots restore' }).toHaveLength(2).then(() =>
      afterWindow.evaluate((id) => window.cc.terminals.list(id), projectId));
    const restoredExecutionWorkers = restoredWorkers.filter(
      (session) => session.cohort?.role === 'worker' && expectedWorkerSlots.includes(session.cohort.slotId ?? '')
    );
    expect(new Set(restoredExecutionWorkers.map(({ id }) => id)).size).toBe(2);
    expect(restoredExecutionWorkers.map(({ cohort }) => cohort!.slotId).sort()).toEqual(expectedWorkerSlots);
    expect(restoredExecutionWorkers.every(({ status }) => status === 'running')).toBe(true);
    expect(restoredExecutionWorkers.map(({ pid }) => pid)).not.toEqual(expect.arrayContaining(initialWorkerPids));

    const wrongProject = await afterWindow.evaluate(({ execution }) => window.cc.executionBoard.relaunchMonitor('wrong-project', execution), { execution: executionId });
    expect(wrongProject).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await stubNativeDialogs(relaunched.electron, [0]);
    const recovery = await afterWindow.evaluate(({ project, execution }) => window.cc.executionBoard.relaunchMonitor(project, execution), { project: projectId, execution: executionId });
    expect(recovery).toMatchObject({ ok: true, value: { sessionId: expect.any(String) } });
    const recoveryId = (recovery as { value: { sessionId: string } }).value.sessionId;
    const recoveryCoordinator = await clientFor(afterWindow, recoveryId);
    clients.push(recoveryCoordinator);
    await expect(call(recoveryCoordinator, 'execution.delivery.pull')).rejects.toThrow();
    const sourceList = await call(recoveryCoordinator, 'execution.source.list', { executionId });
    expect(sourceList.sources).toContainEqual(expect.objectContaining({ name: basename(sourcePath), byteSize: Buffer.byteLength(sourceText) }));
    const sourceId = sourceList.sources[0].id as string;
    const sourceRead = await call(recoveryCoordinator, 'execution.source.read', { executionId, sourceId, offset: 0, maxBytes: 64 * 1024 });
    expect(sourceRead.content).toBe(sourceText);
    const dialogs = await nativeDialogCalls(relaunched.electron);
    expect(dialogs).toContainEqual(expect.objectContaining({ title: 'Relaunch execution monitor', detail: expect.stringContaining('replacement credential') }));

    const blockedWorker = restoredWorkers.find((session) => session.cohort?.slotId === recoveredSnapshot!.execution.currentBlocker!.slotId);
    expect(blockedWorker).toBeTruthy();
    const worker = await clientFor(afterWindow, blockedWorker!.id);
    clients.push(worker);
    await expect(call(worker, 'execution.source.list', { executionId })).rejects.toThrow();
    const delivery = await call(worker, 'execution.delivery.pull');
    expect(delivery.id).toBe(pendingDeliveryId);
    expect(delivery.payload).toEqual({ text: 'JSON' });
    await call(worker, 'execution.delivery.ack', { deliveryId: delivery.id, leaseId: delivery.leaseId, delivered: true });
    await call(worker, 'execution.work.complete', { executionId, workUnitId: 'blocked', result: 'JSON selected' });
    await call(worker, 'execution.work.claim', { executionId, workUnitId: 'verify' });
    await call(worker, 'execution.work.complete', { executionId, workUnitId: 'verify', result: 'recovery verified' });
    await call(recoveryCoordinator, 'execution.complete', { executionId, summary: 'Restart recovery completed and verified.' });

    await afterWindow.locator('[data-testid="nav-agents"]').click();
    await expect(afterWindow.getByText('Restart recovery job', { exact: true })).toBeVisible();
    await afterWindow.getByText('Restart recovery job', { exact: true }).click();
    const details = afterWindow.getByRole('region', { name: 'Job details' });
    await expect(details).toContainText('Restart recovery completed and verified.');
    await expect(details).toContainText('3/3 complete');
    await details.getByRole('button', { name: 'Close details' }).click();
    await afterWindow.getByText('Restart recovery job', { exact: true }).click();
    await expect(afterWindow.getByRole('region', { name: 'Job details' })).toContainText('Restart recovery completed and verified.');
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => {})));
    await lifecycle.current.window.evaluate(async ({ project }) => {
      if (project) await window.cc.projects.remove(project).catch(() => {});
    }, { project: projectId }).catch(() => {});
    await lifecycle.close();
    fake.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});
