/**
 * Explicit manual-only fixture. It creates a normal Job Team blocker through the
 * real app, snapshots it into a timed-out state in the isolated E2E store, then
 * relaunches a VISIBLE Zana window on Agents > Squad details and waits forever.
 *
 * Run only with MANUAL_TIMEOUT_RECOVERY=1. Ctrl-C ends the session; the sandbox
 * lives under the printed HOME and never touches the user's Zana state.
 */
import { expect, launchApp, test } from './fixtures/app.js';
import { createJobTeamContext, findJobExecutionId } from './sdk/job-team-scenario.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true }
});
test.setTimeout(0);

test('MANUAL: seed timed-out Squad recovery UI', async ({ app }) => {
  test.skip(process.env.MANUAL_TIMEOUT_RECOVERY !== '1', 'manual fixture only');
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zana-manual-timeout-', scenario: 'success' });
  const { window } = ctx;
  await window.evaluate((bin) => window.cc.config.set({
    teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, defaultHarness: 'claude'
  }), ctx.agent.path);
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Manual fixture coordinator',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-worker', name: 'E2E Worker', description: 'Manual fixture worker',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.teams.save({
    id: 'e2e-job-team', name: 'E2E Job Team', description: 'Manual timeout recovery fixture',
    slots: [{ personaId: 'e2e-worker', quantity: 1 }], orchestratorPersonaId: 'e2e-orchestrator'
  }));
  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
    return result.value.id;
  }, ctx.projectDir);
  ctx.projectId = projectId;
  const started = await window.evaluate(async (projectId) => window.cc.teams.startJob({
    teamId: 'e2e-job-team', projectId,
    goal: 'Run navigation-label workflow and wait for human answer.',
    title: 'Manual timeout recovery Squad', summary: 'Seeded timed-out recovery fixture.'
  }), projectId);
  if (!started.ok) throw new Error(started.message ?? 'Team launch failed');
  const executionId = await findJobExecutionId(window, projectId, 'Manual timeout recovery Squad');

  await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) =>
    (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.currentBlocker?.id ?? '',
  { projectId, executionId }), { timeout: 60_000, intervals: [500] }).not.toBe('');

  await app.electron.close();
  const filePath = join(app.home, 'electron-user-data', 'squad-executions.json');
  const file = JSON.parse(readFileSync(filePath, 'utf8')) as { records: Array<Record<string, unknown>> };
  const record = file.records.find((candidate) => candidate.id === executionId);
  if (!record) throw new Error(`manual fixture could not find execution ${executionId}`);
  // Recovery deliberately rejects mutating units. This fixture is a UI probe for
  // the eligible path, so its isolated plan models inspection-only work.
  if (Array.isArray(record.workUnits)) {
    record.workUnits = record.workUnits.map((unit) => ({ ...(unit as object), readOnly: true }));
  }
  record.state = 'STOPPED';
  record.timeoutReason = 'unresolved-blocker';
  record.stateVersion = Number(record.stateVersion ?? 0) + 1;
  record.updatedAt = Date.now();
  writeFileSync(filePath, JSON.stringify(file));

  const visible = await launchApp(app.home, { e2e: true, env: { ZCC_E2E_VISIBLE: '1' } });
  const projectRow = visible.window.locator('.project-item').filter({ hasText: ctx.projectName }).first();
  await expect(projectRow).toBeVisible({ timeout: 15_000 });
  await projectRow.click();
  await visible.window.getByTestId('project-nav-agents').click();
  await visible.window.locator('.agent-card').filter({ hasText: 'Manual timeout recovery Squad' }).first().click();
  await expect(visible.window.getByLabel('Squad details')).toBeVisible({ timeout: 15_000 });

  console.log(`\nManual fixture ready. Isolated HOME: ${app.home}`);
  console.log('Visible Zana opened at Agents > Manual timeout recovery Squad. Test recovery now. Ctrl-C ends fixture.\n');
  await new Promise<void>(() => {});
});
