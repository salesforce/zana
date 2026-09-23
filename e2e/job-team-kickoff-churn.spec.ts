/**
 * Kickoff-churn SELF-HEAL end to end (the "teams must self-heal, never sit wedged"
 * mandate). A worker that repeatedly CLAIMS its unit but never starts a turn
 * (`turnCount` stays 0 — the live signature of a mis-wired / never-engaging remote
 * worker) must NOT be re-dispatched down the same broken path forever. The engine
 * escalates in two tiers, both guarded here at the REAL Electron production
 * boundary (the `reconcileActive` reclaim sweep + the loopback execution MCP the
 * fake cohort speaks — the same wiring a live remote squad uses):
 *
 *   WS1 (reassign): after `KICKOFF_FAILURE_BLOCK_THRESHOLD` turnCount-0 reclaims on
 *     one worker slot, the unit is re-homed onto a DIFFERENT untried worker slot
 *     (a slot-specific delivery failure may not recur on a fresh peer) — the
 *     "coordinator reassigns before it asks a person" half of the mandate.
 *   WS3 (human block): once EVERY worker slot is exhausted, the unit transitions
 *     to BLOCKED with a HUMAN-audience blocker AND an Inbox entry, so the run
 *     surfaces as needing attention instead of looping silently.
 *
 * Why an E2E and not only the unit tests: the churn signal is pure core execution
 * state (harness-agnostic), but the LIVE path — the reconcile setInterval reclaim
 * bumping `kickoffFailures`, `escalateKickoffFailures` reassigning then blocking,
 * and the inbox append reaching main's store — is only proven end to end here. The
 * single-worker reclaim spec (`job-team-stuck-worker-reclaim`) incidentally drives
 * WS3 but asserts neither the block nor the inbox; WS1 reassign is exercised
 * NOWHERE else live. This is deterministic + zero model spend (fake CLI over the
 * loopback MCP) — no real box, so it belongs in the always-on suite.
 *
 * Determinism: the fake worker holds `working` (non-restful) forever, so only the
 * wall-clock backstop (a small `maxClaimWallClockMs`) reclaims it; the reclaim
 * redispatch passes no `deprioritizeSlotId`, so `dispatchReady` always picks the
 * first free slot — the unit sticks to worker-1 for its 3 reclaims (→ WS1 onto the
 * untried worker-2), then returns to worker-1 (→ both slots tried → WS3). The
 * E2E-only host knobs (ZCC_WORK_CLAIM_LEASE_MS / ZCC_EXECUTION_RECONCILE_INTERVAL_MS,
 * honored ONLY under ZCC_E2E_HOME) compress the sweep into a few seconds.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  // Shrink the 90s claim lease + 30s reconcile sweep so the wall-clock backstop
  // reclaims the stuck (turnCount-0) claim in a few seconds — the churn escalates
  // through WS1 then WS3 well inside the test budget.
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '2000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(150_000);

test('Job Team self-heals kickoff churn: reassign to a fresh slot (WS1), then block a human + inbox (WS3)', async ({ app }) => {
  const { window } = app;
  const diagnostics: string[] = [];
  window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
  app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
  const agent = makeJobTeamCoordinatorBinary({ scenario: 'kickoff-churn' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cli-churn-'));
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
    // TWO worker slots: the sole unit churns on worker-1, then WS1 re-homes it onto
    // the untried worker-2 before WS3 blocks. A single-worker team can only reach WS3.
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
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent kickoff churn job')?.executionId ?? '';
    }, projectId!), { timeout: 30_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent kickoff churn job')!.executionId;
    }, projectId!);

    // We read the SAME board snapshot the UI reads (production boundary). Both
    // escalation tiers commit a distinct event summary through `mutateRecord`.
    const eventSeen = (needle: string) => async () => window.evaluate(async ({ projectId, executionId, needle }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).some((event: { summary?: string }) =>
        typeof event.summary === 'string' && event.summary.includes(needle));
    }, { projectId: projectId!, executionId, needle });

    // WS1: the unit exhausts worker-1's kickoff budget and is reassigned to the
    // untried worker-2 (self-heal before asking a person).
    await expect.poll(eventSeen('reassigned to fresh slot'), { timeout: 90_000, intervals: [500] }).toBe(true);

    // WS3: worker-2 also exhausts its budget → every slot tried → the run surfaces
    // a HUMAN_BLOCKER instead of looping forever.
    await expect.poll(eventSeen('blocked after repeated kickoff failure'), { timeout: 90_000, intervals: [500] }).toBe(true);

    // WS3 twin: the human block ALSO produces an actionable Inbox entry (a
    // kickoff-blocker row bound to this execution). A block that only woke the
    // parked coordinator with NO inbox message was the exact live gap.
    await expect.poll(async () => window.evaluate(async (executionId) => {
      const page = await window.cc.inbox.history({ limit: 200 });
      return (page?.entries ?? []).some((entry: { executionId?: string; blockerId?: string }) =>
        entry.executionId === executionId && typeof entry.blockerId === 'string' && entry.blockerId.startsWith('kickoff:'));
    }, executionId), { timeout: 30_000, intervals: [500] }).toBe(true);
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
