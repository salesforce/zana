import { test, expect } from './fixtures/app';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { makeFakeAgentBinary } from './sdk/harness';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Page } from '@playwright/test';

test.use({ e2e: true, initialConfig: { teamLaunchEnabled: true } });

async function clientFor(window: Page, sessionId: string): Promise<Client> {
  let route: string | null = null;
  await expect.poll(async () => {
    route = await window.evaluate((id) => window.__zccTest?.mcpRoute(id) ?? null, sessionId);
    return route;
  }, { timeout: 15_000, message: `MCP route for ${sessionId}` }).not.toBeNull();
  if (!route) throw new Error(`missing MCP route for ${sessionId}`);
  const client = new Client({ name: 'job-team-ui-completion-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(route)));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const toolText = ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? '';
  if ((result as { isError?: boolean }).isError) throw new Error(toolText);
  return JSON.parse(toolText) as Record<string, any>;
}

test('Job Team E2E UI launch to durable completion and cleanup', async ({ app }) => {
  test.setTimeout(75_000);
  const { window, electron } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-ui-completion-proj-'));
  const projectName = basename(projectDir);
  const sourceText = '# Source-backed plan\n\nCreate result.txt and verify it is recorded.\n';
  const sourcePath = join(projectDir, 'source-backed-plan.md');
  writeFileSync(sourcePath, sourceText);
  const fake = makeFakeAgentBinary({ profile: 'claude', sequence: 'working-hold' });
  let projectId: string | null = null;
  let unrelatedSessionId: string | null = null;

  try {
    const fullStart = performance.now();

    // 1. Setup unrelated session to verify survival later
    await window.evaluate(async (bin) => {
      await window.cc.config.set({ claudeBinary: bin, teamLaunchEnabled: true });
    }, fake.path);

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string; };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // Start an unrelated terminal session
    const unrelatedRes = await window.evaluate(async (pid) => {
      return await window.cc.terminals.create({ projectId: pid, profile: 'claude', cols: 80, rows: 24 });
    }, projectId);
    expect(unrelatedRes.ok).toBe(true);
    unrelatedSessionId = (unrelatedRes as { value: { id: string } }).value.id;

    // 2. Setup Job Team metadata
    await window.evaluate(() => {
      window.cc.personas.save({
        id: 'e2e-worker', name: 'E2E Worker', baseProfile: 'claude', permissionMode: 'acceptEdits'
      });
      window.cc.teams.save({
        id: 'e2e-team', name: 'E2E Team', description: 'E2E Team',
        slots: [{ personaId: 'e2e-worker', quantity: 2 }],
        orchestratorPersonaId: 'builtin:orchestrator'
      });
    });

    const startSetupDuration = (performance.now() - fullStart) / 1000;
    expect(startSetupDuration, `Start setup budget exceeded (actual: ${startSetupDuration}s)`).toBeLessThan(10);

    // 3. Open UI modal and launch
    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-agents"]').click();

    const newBtn = window.locator('[data-testid="agents-new"]');
    const newEmptyBtn = window.locator('[data-testid="agents-new-empty"]');
    if (await newBtn.count()) {
      await newBtn.click();
    } else {
      await newEmptyBtn.click();
    }

    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: 'Job Team' }).click();
    const instruction = modal.locator('[data-testid="launch-instruction"]');
    await instruction.fill('run E2E ui completion job');
    await modal.getByLabel('Title Optional').fill('E2E Job UI Completion');
    
    // Pick target project
    await modal.getByRole('button', { name: 'Target project' }).click();
    await window.getByRole('listbox', { name: 'Target project' }).getByRole('option', { name: projectName, exact: true }).click();
    
    // Pick team
    await modal.locator('.launch-persona', { hasText: 'E2E Team' }).first().click();

    await electron.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    }, sourcePath);
    await modal.getByRole('button', { name: 'Attach files' }).click();
    await expect(modal.getByText('source-backed-plan.md', { exact: true })).toBeVisible();

    // Launch
    await modal.getByRole('button', { name: 'Launch job team' }).click();
    await expect(modal).toBeHidden();

    // Wait for the sessions to launch (3 sessions: coordinator + 2 workers)
    const cohortStart = performance.now();
    await expect.poll(async () => {
      const list = await window.evaluate((id) => window.cc.terminals.list(id), projectId!);
      return list.filter((s) => s.cohort?.teamId === 'e2e-team');
    }, { timeout: 15_000, message: 'Wait for cohort' }).toHaveLength(3);

    const cohortDuration = (performance.now() - cohortStart) / 1000;
    expect(cohortDuration, `Cohort launch budget exceeded (actual: ${cohortDuration}s)`).toBeLessThan(15);

    // 4. Connect MCP clients
    const mcpStart = performance.now();
    const list = await window.evaluate((id) => window.cc.terminals.list(id), projectId!);
    const sessions = list.filter((s) => s.cohort?.teamId === 'e2e-team');

    const coordinatorSession = sessions.find((s) => s.cohort?.role === 'orchestrator')!;
    const workerSessions = sessions.filter((s) => s.cohort?.role === 'worker');

    const coordinatorClient = await clientFor(window, coordinatorSession.id);
    const workerClients = await Promise.all(workerSessions.map((s) => clientFor(window, s.id)));

    const mcpDuration = (performance.now() - mcpStart) / 1000;
    expect(mcpDuration, `MCP readiness budget exceeded (actual: ${mcpDuration}s)`).toBeLessThan(15);

    // 5. Work units lifecycle
    const workStart = performance.now();
    const executionId = coordinatorSession.cohort!.executionId!;

    const initialSnapshot = await call(coordinatorClient, 'execution.snapshot', { executionId });
    expect(initialSnapshot.execution.workUnits ?? []).toEqual([]);
    const sourceList = await call(coordinatorClient, 'execution.source.list', { executionId });
    expect(sourceList.sources).toHaveLength(1);
    const sourceRead = await call(coordinatorClient, 'execution.source.read', {
      executionId, sourceId: sourceList.sources[0].id, offset: 0, maxBytes: 64 * 1024
    });
    expect(sourceRead.content).toBe(sourceText);

    // Register plan
    await call(coordinatorClient, 'execution.plan.register', {
      executionId,
      workUnits: [
        { id: 'wu1', title: 'First Task', task: 'Do E2E work', dependencies: [], files: ['result.txt'], verification: ['result recorded'] }
      ]
    });

    // Coordinator assigns exact worker slot; worker completes
    await call(coordinatorClient, 'execution.work.assign', {
      executionId, workUnitId: 'wu1', assignedSlotId: workerSessions[0].cohort!.slotId!
    });
    const assignedSnapshot = await call(coordinatorClient, 'execution.snapshot', { executionId });
    expect(assignedSnapshot.execution.workUnits).toEqual([
      expect.objectContaining({ id: 'wu1', state: 'CLAIMED', assignedSlotId: workerSessions[0].cohort!.slotId! })
    ]);
    await call(workerClients[0], 'execution.work.complete', { executionId, workUnitId: 'wu1', result: 'E2E complete' });

    // Coordinator completes the entire execution
    await call(coordinatorClient, 'execution.complete', {
      executionId,
      summary: 'E2E UI completion successfully verified!'
    });

    const workDuration = (performance.now() - workStart) / 1000;
    expect(workDuration, `Work execution budget exceeded (actual: ${workDuration}s)`).toBeLessThan(15);

    // 6. Cleanup verification (durable job completion to session exits)
    const cleanupStart = performance.now();
    await expect.poll(async () => {
      const list = await window.evaluate((id) => window.cc.terminals.list(id), projectId!);
      return list.filter((s) => s.cohort?.teamId === 'e2e-team');
    }, { timeout: 15_000, message: 'Wait for cohort exits' }).toHaveLength(0);

    const cleanupDuration = (performance.now() - cleanupStart) / 1000;
    expect(cleanupDuration, `Cleanup/exit budget exceeded (actual: ${cleanupDuration}s)`).toBeLessThan(15);

    // Assert unrelated session survived!
    const finalSessions = await window.evaluate((id) => window.cc.terminals.list(id), projectId!);
    expect(finalSessions.map((s) => s.id)).toContain(unrelatedSessionId);

    // Verify overall flow budget
    const fullDuration = (performance.now() - fullStart) / 1000;
    expect(fullDuration, `Full flow budget exceeded (actual: ${fullDuration}s)`).toBeLessThan(60);

  } catch (err) {
    // Structured diagnostics
    console.error('E2E TEST FAILURE DIAGNOSTICS:');
    try {
      const list = await window.evaluate(() => window.cc.terminals.list());
      console.error('Active Sessions:', JSON.stringify(list, null, 2));
    } catch {}
    throw err;
  } finally {
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          await window.cc.projects.remove(pid);
        } catch {}
      }, projectId);
    }
    if (unrelatedSessionId) {
      await window.evaluate(async (sid) => {
        try {
          await window.cc.terminals.close(sid);
        } catch {}
      }, unrelatedSessionId);
    }
    fake.cleanup();
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {}
  }
});
