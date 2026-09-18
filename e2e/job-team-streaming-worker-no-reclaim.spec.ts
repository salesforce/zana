/**
 * Regression for Part B (the output-activity lease heartbeat): a worker that is
 * NON-restful ('working') but ALIVE and streaming output must NOT be reclaimed. This
 * is the discriminator that makes the feature actually work in the app — the fix must
 * distinguish a healthy long-running worker (keeps emitting output) from a hung one
 * (goes silent), rather than bluntly reclaiming every non-restful worker (freeze, the
 * old bug) or every long turn (the naive backstop-only tradeoff).
 *
 * Sister spec `job-team-stuck-worker-reclaim.spec.ts` proves the SILENT worker IS
 * reclaimed. Together they prove the lease is a real liveness deadline at the Electron
 * production boundary: the host's `PtyManager` `'data'` hook → `renewWorkerLease` keeps
 * a streaming worker's claim fresh, so the `reconcileActive` sweep never reclaims it.
 *
 * Uses the same E2E-only timing knobs as the reclaim spec (2s lease, 750ms reconcile),
 * but sets NO `maxClaimWallClockMs` — the worker streams forever, so if the heartbeat
 * ever stops renewing, the lease would expire within ~2s and the sweep would reclaim it,
 * emitting a `Reclaimed N expired work claim(s)` event. The HARD GATE asserts that event
 * NEVER appears across a window far longer than the lease, AND the execution stays RUNNING
 * with its unit still CLAIMED. A false green (worker never actually started) is ruled out
 * by first waiting for the fake worker to log that it went working and began streaming.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '2000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(120_000);

test('Job Team does NOT reclaim a live, streaming non-restful worker (output-activity lease heartbeat)', async ({ app }) => {
  const { window } = app;
  const diagnostics: string[] = [];
  window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
  app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
  const agent = makeJobTeamCoordinatorBinary({ scenario: 'streaming-worker' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cli-streaming-'));
  const projectName = basename(projectDir);
  const logPath = join(projectDir, '.fake-coordinator.log');
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

    await expect.poll(async () => window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent streaming job')?.executionId ?? '';
    }, projectId!), { timeout: 30_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent streaming job')!.executionId;
    }, projectId!);

    // Guard against a false green: confirm the worker actually claimed the unit, went
    // working, and began streaming BEFORE we assert the absence of a reclaim. Without
    // this, "no reclaim event" would trivially hold even if nothing ever ran.
    await expect.poll(() => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''),
      { timeout: 30_000, intervals: [500] }).toContain('streaming: went working');

    const reclaimEventSeen = async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).some((event: { summary?: string }) =>
        typeof event.summary === 'string' && event.summary.includes('expired work claim'));
    }, { projectId: projectId!, executionId });

    // HARD GATE: dwell well past the lease (2s) and many reconcile sweeps (750ms), then
    // prove the streaming worker was NEVER reclaimed. If the output heartbeat regressed,
    // the lease would expire within ~2s and the sweep would emit an 'expired work claim'
    // event almost immediately. Sample twice across the window so a late reclaim also fails.
    await window.waitForTimeout(8_000);
    expect(await reclaimEventSeen(), 'streaming worker was reclaimed mid-window').toBe(false);
    await window.waitForTimeout(4_000);
    expect(await reclaimEventSeen(), 'streaming worker was reclaimed').toBe(false);

    // The execution is still active (not terminal) with its unit still CLAIMED — never
    // released back to READY, which is exactly what a reclaim would have done.
    const board = await window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return { state: snap?.execution?.state, assignments: snap?.execution?.work?.assignments ?? [] };
    }, { projectId: projectId!, executionId });
    expect(['COMPLETED', 'FAILED', 'CANCELED']).not.toContain(board.state);
    expect(board.assignments.some((assignment: { state?: string }) => assignment.state === 'CLAIMED')).toBe(true);
  } catch (error) {
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : 'no fake coordinator log';
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
