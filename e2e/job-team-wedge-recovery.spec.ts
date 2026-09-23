/**
 * Regression for the recurring remote-worker DISPATCH wedge (live run
 * 1aa3cf47): a durable run's first worker-assignment batch fails to deliver, so
 * the unit is released back to READY with nothing in flight (0 CLAIMED). Because
 * `cascadeDispatch` only fires on work edges and `PlanReadinessWatchdog`
 * self-removes once a plan exists, there is NO edge left to re-attempt the
 * dispatch — the coordinator sits PARKED and the run is wedged forever.
 *
 * In production the trigger was a stale/`unknown` slot-health reading gating an
 * already-spawned worker; the fix has two halves:
 *   - routing-policy makes slot health ADVISORY (only a fresh, positive
 *     `unavailable` blocks) so a stale TTL can no longer wedge a dispatch —
 *     guarded by the routing-policy unit test.
 *   - `SquadExecutionService.redispatchStalled()` — a periodic recovery sweep
 *     (run alongside `reconcileActive` on the reconcile interval) re-cascades any
 *     durable run left with READY units and nothing CLAIMED. THIS spec guards
 *     that sweep end-to-end at the real Electron production boundary.
 *
 * The deterministic Job Team fakes never reproduce the wedge (fast DAG, single
 * dispatch, local workers, delivery never fails), which is exactly why the class
 * of bug shipped. We inject a TRANSIENT first-dispatch failure via the E2E-only
 * host seam `ZCC_E2E_STALL_FIRST_DISPATCH` (honored ONLY under ZCC_E2E_HOME;
 * undefined and byte-unchanged in production) and compress the reconcile sweep to
 * sub-second so the recovery is observable in bounded wall time.
 *
 * Hard gate: the run reaches COMPLETED (its worker writes `result.txt`) DESPITE
 * the forced first-dispatch failure. Without `redispatchStalled`, the released
 * unit never re-dispatches, the coordinator never gets its result, and the spec
 * times out — so a removed/regressed recovery sweep fails this test.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { answerJobBlockerThroughUi } from './sdk/job-team-scenario.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  // Force the first worker-assignment batch to release undelivered (the wedge),
  // and set the reconcile/redispatch sweep to a few seconds — long enough that
  // the transient 0-CLAIMED wedge is reliably observable by the waypoint poll,
  // short enough that recovery + completion land well inside the test timeout.
  launchEnv: { ZCC_E2E_STALL_FIRST_DISPATCH: '1', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '3000' }
});
test.setTimeout(120_000);

test('Job Team recovers a wedged run (0 CLAIMED after a failed first dispatch) via redispatchStalled', async ({ app }) => {
  const { window } = app;
  const diagnostics: string[] = [];
  window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
  app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
  const agent = makeJobTeamCoordinatorBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cli-wedge-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Durable test coordinator',
      baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-worker', name: 'E2E Worker', description: 'Durable test worker',
      baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-job-team', name: 'E2E Job Team', description: 'CLI owner durable team',
      slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator'
    }));

    // Refresh cached harness verification after replacing the Claude binary.
    await window.getByRole('link', { name: 'Settings' }).click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    const claudeSettings = window.locator('#settings-anchor-harness-claude');
    await expect(claudeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);
    await window.locator('.settings-app-back').click();

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
      return result.value.id;
    }, projectDir);

    const projectRow = window.locator('.project-item').filter({ hasText: projectName }).first();
    await expect(projectRow).toBeVisible({ timeout: 15_000 });
    await projectRow.hover();
    await window.getByRole('button', { name: `New agent in ${projectName}` }).click();
    const modal = window.getByTestId('launch-modal');
    await modal.getByRole('button', { name: 'CLI Agent' }).click();
    const instruction = modal.getByTestId('legacy-agent-command-input');
    await instruction.click();
    await instruction.fill('E2E start Job Team');
    await expect(instruction).toContainText('E2E start Job Team');
    await expect(modal.getByRole('button', { name: 'Project', exact: true })).toContainText(projectName);
    const send = modal.getByTestId('legacy-agent-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();
    const launched = await expect.poll(async () => window.evaluate(async (projectId) =>
      (await window.cc.terminals.list(projectId)).some((session) => session.title.includes('E2E start Job Team'))
    , projectId!), { timeout: 15_000, intervals: [500] }).toBe(true).then(() => true, () => false);
    if (!launched) throw new Error(`CLI Agent did not launch\n${diagnostics.join('\n')}`);
    await expect(modal).toBeHidden();

    // The durable execution appears once the owner calls execution.start.
    await expect.poll(async () => window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent durable job')?.executionId ?? '';
    }, projectId!), { timeout: 30_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent durable job')!.executionId;
    }, projectId!);

    // Waypoint: the forced first dispatch releases the unit back to READY with
    // nothing CLAIMED — the exact wedge shape redispatchStalled must escape.
    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const counts = snap?.execution?.work?.counts;
      return !!counts && counts.READY > 0 && counts.CLAIMED === 0;
    }, { projectId: projectId!, executionId }), { timeout: 30_000, intervals: [250] }).toBe(true);

    try {
      await answerJobBlockerThroughUi({ window, projectId: projectId!, executionId, jobTitle: 'CLI Agent durable job' });
    } catch (error) {
      const snapshot = await window.evaluate(async ({ projectId, executionId }) =>
        window.cc.executionBoard.snapshot(projectId, executionId, 0), { projectId: projectId!, executionId });
      const log = existsSync(join(projectDir, '.fake-coordinator.log'))
        ? readFileSync(join(projectDir, '.fake-coordinator.log'), 'utf8')
        : 'no fake coordinator log';
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(snapshot)}\n${log}`);
    }
    // HARD GATE: the run completes despite the wedge — the recovery sweep
    // re-dispatched the released unit, the worker ran it, and wrote its result.
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 30_000 }).toBe(true);
    expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
  } catch (error) {
    const log = existsSync(join(projectDir, '.fake-coordinator.log'))
      ? readFileSync(join(projectDir, '.fake-coordinator.log'), 'utf8')
      : 'no fake coordinator log';
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${log}\n${diagnostics.join('\n')}`);
  } finally {
    if (projectId) {
      await window.evaluate(async (projectId) => {
        for (const session of await window.cc.terminals.list(projectId)) {
          try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
        }
        try { await window.cc.projects.remove(projectId); } catch { /* best-effort */ }
      }, projectId).catch(() => undefined);
    }
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
});
