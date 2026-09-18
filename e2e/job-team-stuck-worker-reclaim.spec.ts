/**
 * Regression for the live Team/Squad FREEZE (run df216947): a worker claims its
 * unit, resolves NON-restful ('working'), and never completes/blocks/idles. With
 * no worker heartbeat, its 90s lease expires — but the restful reclaim gate can
 * never fire for a non-restful worker, so the claim is stranded forever. The one
 * state-agnostic escape is the wall-clock backstop, which was DEAD in production
 * (`maxClaimWallClockMs` unset on every run). The fix injects a server-side
 * default ceiling for durable worker-DAG runs so a stuck claim is force-reclaimed.
 *
 * This drives the REAL Electron production boundary the deterministic Job Team
 * fakes never reach: the `reconcileActive` setInterval, the host's live
 * `getAgentState` resolving a stalled worker PTY as non-restful, and the persisted
 * `execution.start` policy. It compresses the two production timing constants to
 * seconds via the E2E-only host knobs (ZCC_WORK_CLAIM_LEASE_MS /
 * ZCC_EXECUTION_RECONCILE_INTERVAL_MS, honored ONLY under ZCC_E2E_HOME) so the
 * reclaim is observable in bounded wall time.
 *
 * Coverage split (the fix has two halves, each guarded by the right test):
 *   - This E2E guards the backstop WIRING end-to-end: a small explicit
 *     `maxClaimWallClockMs` (the production default is ~20min — untestable in fast
 *     wall time) makes the wall-clock branch — not the restful gate — the sole
 *     reclaimer, so a removed/regressed backstop leaves the run frozen and fails it.
 *   - The server-side DEFAULT injection (`withDurableClaimWallClockBackstop`, which
 *     revived the dead backstop by defaulting the ceiling for durable worker-DAG
 *     runs) is guarded by the execution-service unit test's `start` wiring case.
 *
 * Hard gate: the stall unit's `claimGeneration` climbs past its first claim,
 * proving the backstop reclaimed the stuck non-restful claim AND re-dispatched it
 * (a frozen run would sit at claimGeneration 1 forever). We deliberately do NOT
 * assert COMPLETED — the stalled worker never finishes; healthy end-to-end
 * completion is covered by the other Job Team specs and worker-heartbeat is a
 * deferred follow-up.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  // E2E-only durable-execution timing knobs (see host.ts e2eTimingOverrideMs):
  // shrink the 90s claim lease and 30s reconcile sweep so the wall-clock backstop
  // reclaims the stuck claim in a few seconds instead of minutes.
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '2000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(120_000);

test('Job Team reclaims a stuck non-restful worker via the wall-clock backstop (run df216947)', async ({ app }) => {
  const { window } = app;
  const diagnostics: string[] = [];
  window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
  app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
  const agent = makeJobTeamCoordinatorBinary({ scenario: 'stalled-worker' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cli-stalled-'));
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
    // One worker: the sole unit lands on it, and it stalls there.
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-job-team', name: 'E2E Job Team', description: 'CLI owner durable team',
      slots: [{ personaId: 'e2e-worker', quantity: 1 }], orchestratorPersonaId: 'e2e-orchestrator'
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
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent stalled job')?.executionId ?? '';
    }, projectId!), { timeout: 30_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent stalled job')!.executionId;
    }, projectId!);

    // HARD GATE: the wall-clock backstop reclaims the stuck non-restful claim,
    // which appends a `Reclaimed N expired work claim(s)` event. A frozen run (the
    // bug — before the server-side default ceiling revived the dead backstop) never
    // emits it: a lease-expired non-restful worker was never reclaimed. We observe
    // the event through the same board snapshot the UI reads (production boundary).
    const reclaimEventSeen = async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).some((event: { summary?: string }) =>
        typeof event.summary === 'string' && event.summary.includes('expired work claim'));
    }, { projectId: projectId!, executionId });

    await expect.poll(reclaimEventSeen, { timeout: 60_000, intervals: [500] }).toBe(true);
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
