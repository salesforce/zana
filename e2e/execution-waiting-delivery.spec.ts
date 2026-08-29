/**
 * Anti-regression net for the durable Job Team coordinator's AT-REST delivery
 * path (commit e83fa59e), proven at the built-Electron production boundary.
 *
 * The load-bearing behaviors:
 *   - A non-Claude (OpenCode) worker that emits no output settles into the
 *     cross-harness `waiting` state via main's output-activity silence heuristic;
 *     a Claude worker reaches the equivalent OSC `idle`. Both are "restful" and
 *     therefore injectable, so a coordinator handoff to such a worker reports
 *     Delivered — NOT Queued (`isRestfulAgentState`, src/shared/types.ts).
 *   - `execution.plan.register` on a job-team execution accepts a bounded DAG of
 *     two disjoint mutating units + a readOnly review unit + a dependent unit,
 *     and REJECTS a malformed plan (a mutating unit with no file scope).
 *   - Two disjoint mutating units assign to two already-restful workers in
 *     parallel — both flip to CLAIMED with no human nudge.
 *   - The full durable flow: workers complete their units → a dependent unit
 *     raises a durable human blocker → the host resumes it → the worker pulls the
 *     answer over execution.delivery.pull → execution.complete → the cohort
 *     auto-tears-down to zero while an unrelated session survives.
 *
 * Work units here are deliberately generic (unit-a → src/x.ts, unit-b →
 * src/y.ts, a readOnly review, a dependent unit) — no domain vocabulary.
 */
import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary, makeSilentOpenCodeBinary, type FakeAgentBinary } from './sdk/harness';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

test.use({ e2e: true, initialConfig: { teamLaunchEnabled: true } });

async function clientFor(window: Page, sessionId: string): Promise<Client> {
  let route: string | null = null;
  await expect.poll(async () => {
    route = await window.evaluate((id) => window.__zccTest?.mcpRoute(id) ?? null, sessionId);
    return route;
  }, { timeout: 15_000, message: `MCP route for ${sessionId}` }).not.toBeNull();
  if (!route) throw new Error(`missing MCP route for ${sessionId}`);
  const client = new Client({ name: 'execution-waiting-delivery-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(route)));
  return client;
}

function toolText(result: unknown): string {
  return ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? '';
}

function isToolError(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

/** Call a tool, throwing on error, returning the parsed JSON payload. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const result = await client.callTool({ name, arguments: args });
  if (isToolError(result)) throw new Error(`${name}: ${toolText(result)}`);
  return JSON.parse(toolText(result)) as Record<string, any>;
}

interface CohortSession {
  id: string;
  cohort?: { teamId?: string; role?: string; slotId?: string; executionId?: string };
}

/**
 * One at-rest Job Team: launched via execution.start (which forces job-team
 * coordination mode), discovered through the host-side cohort listing (never
 * agent free-text). Returns the coordinator + two workers plus their host-bound
 * slot ids so plan/assign can name exact slots.
 */
interface LaunchedTeam {
  executionId: string;
  coordinator: Client;
  workers: Array<{ sessionId: string; slotId: string; client: Client }>;
}

async function launchTeam(
  window: Page,
  projectId: string,
  ids: { teamId: string; workerPersonaId: string; coordinatorPersonaId: string; profile: string; launchRequestId: string },
  clients: Client[]
): Promise<LaunchedTeam> {
  await window.evaluate(async ({ teamId, workerPersonaId, coordinatorPersonaId, profile }) => {
    await window.cc.personas.save({ id: workerPersonaId, name: `${workerPersonaId} worker`, baseProfile: profile, permissionMode: 'acceptEdits' });
    await window.cc.personas.save({ id: coordinatorPersonaId, name: `${coordinatorPersonaId} coordinator`, baseProfile: profile, permissionMode: 'acceptEdits' });
    await window.cc.teams.save({ id: teamId, name: `${teamId} team`, slots: [{ personaId: workerPersonaId, quantity: 2 }], orchestratorPersonaId: coordinatorPersonaId });
  }, ids);

  const ownerId = await window.evaluate(async ({ projectId, profile }) => {
    const result = await window.cc.terminals.create({ projectId, profile, cols: 80, rows: 24, title: 'Waiting-delivery owner' }) as { value?: { id: string }; id?: string };
    return result.value?.id ?? result.id ?? '';
  }, { projectId, profile: ids.profile });
  expect(ownerId).toBeTruthy();

  const owner = await clientFor(window, ownerId);
  clients.push(owner);
  const started = await owner.callTool({ name: 'execution.start', arguments: {
    version: 1, teamId: ids.teamId, launchRequestId: ids.launchRequestId, jobTitle: 'At-rest delivery job',
    slots: [{ initialTask: 'worker one standby' }, { initialTask: 'worker two standby' }, { initialTask: 'coordinate at-rest delivery' }]
  } });
  if (isToolError(started)) throw new Error(toolText(started));
  const executionId = (JSON.parse(toolText(started)) as { id: string }).id;
  expect(executionId).toBeTruthy();

  // Discover the launched cohort host-side (role/slot/execution are host-stamped).
  let sessions: CohortSession[] = [];
  await expect.poll(async () => {
    const list = await window.evaluate((id) => window.cc.terminals.list(id), projectId) as CohortSession[];
    sessions = list.filter((s) => s.cohort?.teamId === ids.teamId);
    return sessions.length;
  }, { timeout: 20_000, message: 'cohort sessions' }).toBe(3);

  const coordinatorSession = sessions.find((s) => s.cohort?.role === 'orchestrator');
  const workerSessions = sessions.filter((s) => s.cohort?.role === 'worker');
  if (!coordinatorSession) throw new Error(`missing coordinator: ${JSON.stringify(sessions)}`);
  expect(workerSessions).toHaveLength(2);

  const coordinator = await clientFor(window, coordinatorSession.id);
  const workers = await Promise.all(workerSessions.map(async (s) => ({
    sessionId: s.id,
    slotId: s.cohort!.slotId!,
    client: await clientFor(window, s.id)
  })));
  clients.push(coordinator, ...workers.map((w) => w.client));
  return { executionId, coordinator, workers };
}

/** Poll the host agent-status stream until `sessionId` reads `expected`. */
async function waitForAgentState(window: Page, sessionId: string, expected: string): Promise<void> {
  await expect.poll(async () => {
    const pairs = await window.evaluate(() => window.cc.terminals.agentStatusSnapshot()) as Array<[string, string]>;
    return pairs.find(([id]) => id === sessionId)?.[1] ?? null;
  }, { timeout: 20_000, message: `agent state ${expected} for ${sessionId}` }).toBe(expected);
}

/** A valid job-team plan: two disjoint mutating units, a readOnly review, a dependent unit. */
const VALID_PLAN = [
  { id: 'unit-a', title: 'Unit A', task: 'Edit module x', dependencies: [], files: ['src/x.ts'], verification: ['x compiles'] },
  { id: 'unit-b', title: 'Unit B', task: 'Edit module y', dependencies: [], files: ['src/y.ts'], verification: ['y compiles'] },
  { id: 'review', title: 'Review', task: 'Review the edits', dependencies: [], verification: ['reviewed'], readOnly: true },
  { id: 'dependent', title: 'Dependent', task: 'Integrate x and y', dependencies: ['unit-a', 'unit-b'], files: ['src/z.ts'], verification: ['integrated'] }
];

// The at-rest predicate is harness-agnostic: an OpenCode worker settles to
// `waiting`, a Claude worker to OSC `idle`; both are restful → Delivered.
for (const variant of [
  { profile: 'opencode', restState: 'waiting', makeBinary: () => makeSilentOpenCodeBinary(),
    configure: (window: Page, bin: string) => window.evaluate((b) => window.cc.config.set({ harnessOpenCodeEnabled: true, opencodeBinary: b }), bin) },
  { profile: 'claude', restState: 'idle', makeBinary: () => makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' }),
    configure: (window: Page, bin: string) => window.evaluate((b) => window.cc.config.set({ claudeBinary: b }), bin) }
] as const) {
  test(`at-rest ${variant.profile} workers (${variant.restState}) take parallel disjoint assignment and Delivered handoff`, async ({ app }) => {
    test.setTimeout(75_000);
    const { window } = app;
    const projectDir = mkdtempSync(join(tmpdir(), `zcc-waiting-delivery-${variant.profile}-`));
    const fake: FakeAgentBinary = variant.makeBinary();
    const clients: Client[] = [];
    let projectId = '';
    try {
      projectId = await window.evaluate(async (path) => {
        const result = await window.cc.projects.add(path) as { value?: { id: string }; id?: string };
        return result.value?.id ?? result.id ?? '';
      }, projectDir);
      expect(projectId).toBeTruthy();
      await variant.configure(window, fake.path);

      const team = await launchTeam(window, projectId, {
        teamId: `e2e-wait-${variant.profile}`, workerPersonaId: `e2e-wait-worker-${variant.profile}`,
        coordinatorPersonaId: `e2e-wait-coord-${variant.profile}`, profile: variant.profile, launchRequestId: `e2e-wait-run-${variant.profile}`
      }, clients);

      // Assert BOTH workers actually READ the restful state before proceeding.
      await Promise.all(team.workers.map((w) => waitForAgentState(window, w.sessionId, variant.restState)));

      // Defect A: a malformed plan (mutating unit with no file scope) is rejected.
      const malformed = await team.coordinator.callTool({ name: 'execution.plan.register', arguments: {
        executionId: team.executionId,
        workUnits: [{ id: 'unit-bad', title: 'Bad', task: 'Mutate without scope', dependencies: [], verification: ['x'] }]
      } });
      expect(isToolError(malformed)).toBe(true);
      expect(toolText(malformed)).toContain('mutating work unit requires file scope');

      // The complete, valid DAG registers.
      const registered = await call(team.coordinator, 'execution.plan.register', { executionId: team.executionId, workUnits: VALID_PLAN });
      expect((registered.workUnits as Array<{ id: string; state: string }>).map((u) => ({ id: u.id, state: u.state }))).toEqual([
        { id: 'unit-a', state: 'READY' }, { id: 'unit-b', state: 'READY' },
        { id: 'review', state: 'READY' }, { id: 'dependent', state: 'PENDING' }
      ]);

      // Defect B: two disjoint mutating units assign to the two already-restful
      // workers IN PARALLEL — both flip to CLAIMED, no human nudge.
      const [assignA, assignB] = await Promise.all([
        team.coordinator.callTool({ name: 'execution.work.assign', arguments: { executionId: team.executionId, workUnitId: 'unit-a', assignedSlotId: team.workers[0].slotId } }),
        team.coordinator.callTool({ name: 'execution.work.assign', arguments: { executionId: team.executionId, workUnitId: 'unit-b', assignedSlotId: team.workers[1].slotId } })
      ]);
      expect(isToolError(assignA), toolText(assignA)).toBe(false);
      expect(isToolError(assignB), toolText(assignB)).toBe(false);
      const snapshot = await call(team.coordinator, 'execution.snapshot', { executionId: team.executionId });
      const byId = new Map((snapshot.execution.workUnits as Array<{ id: string; state: string; assignedSlotId?: string }>).map((u) => [u.id, u]));
      expect(byId.get('unit-a')).toMatchObject({ state: 'CLAIMED', assignedSlotId: team.workers[0].slotId });
      expect(byId.get('unit-b')).toMatchObject({ state: 'CLAIMED', assignedSlotId: team.workers[1].slotId });

      // Delivery to a restful worker reports Delivered (injected at its prompt),
      // never Queued. Workers were untouched by the durable assign, so still restful.
      await Promise.all(team.workers.map((w) => waitForAgentState(window, w.sessionId, variant.restState)));
      const delivered = await team.coordinator.callTool({ name: 'agent_send', arguments: { to: team.workers[0].sessionId, message: 'unit-a is yours; begin when ready' } });
      expect(isToolError(delivered), toolText(delivered)).toBe(false);
      expect(toolText(delivered)).toContain('Delivered');
    } finally {
      for (const client of clients) await client.close().catch(() => {});
      if (projectId) await window.evaluate((id) => window.cc.projects.remove(id).catch(() => {}), projectId).catch(() => {});
      fake.cleanup();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
}

test('at-rest workers complete a durable blocker-resume flow and the cohort auto-tears-down', async ({ app }) => {
  test.setTimeout(90_000);
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-waiting-delivery-flow-'));
  const fake = makeSilentOpenCodeBinary();
  const clients: Client[] = [];
  let projectId = '';
  let unrelatedId = '';
  try {
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectDir);
    expect(projectId).toBeTruthy();
    await window.evaluate((bin) => window.cc.config.set({ harnessOpenCodeEnabled: true, opencodeBinary: bin }), fake.path);

    // An unrelated session that must SURVIVE the cohort teardown.
    unrelatedId = await window.evaluate(async (pid) => {
      const result = await window.cc.terminals.create({ projectId: pid, profile: 'opencode', cols: 80, rows: 24, title: 'Unrelated' }) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectId);
    expect(unrelatedId).toBeTruthy();

    const team = await launchTeam(window, projectId, {
      teamId: 'e2e-wait-flow', workerPersonaId: 'e2e-wait-flow-worker',
      coordinatorPersonaId: 'e2e-wait-flow-coord', profile: 'opencode', launchRequestId: 'e2e-wait-flow-run'
    }, clients);

    await Promise.all(team.workers.map((w) => waitForAgentState(window, w.sessionId, 'waiting')));

    await call(team.coordinator, 'execution.plan.register', { executionId: team.executionId, workUnits: VALID_PLAN });

    // Disjoint mutating units to the two waiting workers, in parallel.
    await Promise.all([
      call(team.coordinator, 'execution.work.assign', { executionId: team.executionId, workUnitId: 'unit-a', assignedSlotId: team.workers[0].slotId }),
      call(team.coordinator, 'execution.work.assign', { executionId: team.executionId, workUnitId: 'unit-b', assignedSlotId: team.workers[1].slotId })
    ]);
    await call(team.workers[0].client, 'execution.work.complete', { executionId: team.executionId, workUnitId: 'unit-a', result: 'x done' });
    await call(team.workers[1].client, 'execution.work.complete', { executionId: team.executionId, workUnitId: 'unit-b', result: 'y done' });

    // The readOnly review unit.
    await call(team.coordinator, 'execution.work.assign', { executionId: team.executionId, workUnitId: 'review', assignedSlotId: team.workers[0].slotId });
    await call(team.workers[0].client, 'execution.work.complete', { executionId: team.executionId, workUnitId: 'review', result: 'reviewed' });

    // The dependent unit is now READY: assign it, then raise a DURABLE human blocker.
    await call(team.coordinator, 'execution.work.assign', { executionId: team.executionId, workUnitId: 'dependent', assignedSlotId: team.workers[1].slotId });
    const blocked = await call(team.workers[1].client, 'execution.work.block', {
      executionId: team.executionId, workUnitId: 'dependent', blockerId: 'choose-strategy', question: 'Integrate how?', options: ['merge', 'rebase']
    });
    const stateVersion = (blocked as { stateVersion: number }).stateVersion;

    // The host answers the blocker (UI/host resume path).
    const resumed = await window.evaluate(async ({ projectId, executionId, stateVersion }) =>
      window.cc.executionBoard.resume(projectId, executionId, stateVersion, 'choose-strategy', 'flow-response', 'merge'),
      { projectId, executionId: team.executionId, stateVersion });
    expect(resumed, JSON.stringify(resumed)).toMatchObject({ ok: true, value: { currentBlocker: { delivery: { state: 'PENDING' } } } });

    // The worker pulls the delivered answer over its bound route.
    const delivery = await call(team.workers[1].client, 'execution.delivery.pull', {});
    expect((delivery as { payload: { text: string } }).payload.text).toBe('merge');
    await call(team.workers[1].client, 'execution.delivery.ack', { deliveryId: (delivery as { id: string }).id, leaseId: (delivery as { leaseId: string }).leaseId, delivered: true });

    // Record a write-once artifact and finish the dependent unit.
    await call(team.workers[1].client, 'execution.artifact.put', { executionId: team.executionId, name: 'z.ts', mediaType: 'text/plain', content: 'integrated via merge' });
    await call(team.workers[1].client, 'execution.work.complete', { executionId: team.executionId, workUnitId: 'dependent', result: 'integrated via merge' });

    // Durable completion.
    await call(team.coordinator, 'execution.complete', { executionId: team.executionId, summary: 'All units complete; integrated via merge.' });
    // Assert the write-once artifact via the HOST board snapshot, not the coordinator's
    // MCP route: execution.complete begins cohort teardown, which deauthorizes the
    // coordinator's live-session MCP (racing an artifact.list call). The host-side
    // board snapshot is durable and survives teardown.
    const finalBoard = await window.evaluate(
      ({ projectId, executionId }) => window.cc.executionBoard.snapshot(projectId, executionId),
      { projectId, executionId: team.executionId }
    );
    expect(finalBoard, JSON.stringify(finalBoard)).toMatchObject({ execution: { state: 'COMPLETED' }, artifacts: [{ name: 'z.ts' }] });

    // The cohort auto-tears-down to zero...
    await expect.poll(async () => {
      const list = await window.evaluate((id) => window.cc.terminals.list(id), projectId) as CohortSession[];
      return list.filter((s) => s.cohort?.teamId === 'e2e-wait-flow').length;
    }, { timeout: 20_000, message: 'cohort drains to 0' }).toBe(0);

    // ...while the unrelated session survives.
    const survivors = await window.evaluate((id) => window.cc.terminals.list(id), projectId) as CohortSession[];
    expect(survivors.map((s) => s.id)).toContain(unrelatedId);
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    if (unrelatedId) await window.evaluate((id) => window.cc.terminals.close(id).catch(() => {}), unrelatedId).catch(() => {});
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id).catch(() => {}), projectId).catch(() => {});
    fake.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});
