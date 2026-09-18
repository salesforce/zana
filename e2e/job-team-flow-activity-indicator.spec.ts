/**
 * Production-boundary regression for the Flow-view activity indicator: a live
 * worker that holds a CLAIMED unit with a fresh claim lease must RENDER as
 * "streaming" in the Agents → Flow graph — the node pulses (universal working
 * treatment), draws a self-loop arc, and shows a "live" badge — even when it
 * hands off to nobody (a single-worker DAG draws zero handoff edges, the
 * original "no arrows, looks dead" gap this indicator closes).
 *
 * This exercises the full main→renderer seam that unit tests can't: the durable
 * work unit's claim timestamps (`claimedAt`/`heartbeatAt`/`leaseExpiresAt`) →
 * `projectExecutionProjection` assignment fields → `executionBoard.listProject`
 * IPC → `buildSquadFlow` resolving the node's CLAIMED slot into `node.claim` →
 * `nodeActivity` → the `squad-flow-node--streaming` / `.squad-flow-live` /
 * `path.squad-flow-self-loop` DOM in the built Electron renderer.
 *
 * Reuses the `streaming-worker` fake (worker claims its unit, goes ✻ working,
 * and emits output forever). A COMFORTABLE lease (30s) is used deliberately —
 * unlike the sister no-reclaim spec (2s, to force quick reclaim detection),
 * here we want `leaseExpiresAt > now` to hold stably across the render
 * assertions so the "streaming" truth doesn't flicker. Lease renewal itself is
 * covered by `job-team-streaming-worker-no-reclaim.spec.ts`; this spec proves
 * the RENDER.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '30000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(120_000);

test('Flow view renders the streaming activity indicator for a live claimed worker', async ({ app }) => {
  const { window } = app;
  const diagnostics: string[] = [];
  window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
  app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
  const agent = makeJobTeamCoordinatorBinary({ scenario: 'streaming-worker' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cli-flow-activity-'));
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

    // Wait for the durable execution to surface and its worker to actually claim
    // the unit, go working, and begin streaming — the state that must render as
    // "streaming". Guards against a false green where the treatment is asserted
    // before any claim exists.
    await expect.poll(async () => window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent streaming job')?.executionId ?? '';
    }, projectId!), { timeout: 30_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent streaming job')!.executionId;
    }, projectId!);
    await expect.poll(() => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''),
      { timeout: 30_000, intervals: [500] }).toContain('streaming: went working');

    // The assignment carries a live lease the renderer can read (leaseExpiresAt in
    // the future). This is the exact signal the Flow view derives "streaming" from.
    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const claimed = (snap?.execution?.work?.assignments ?? []).find((a: { state?: string }) => a.state === 'CLAIMED') as
        | { leaseExpiresAt?: number }
        | undefined;
      return claimed?.leaseExpiresAt !== undefined && claimed.leaseExpiresAt > Date.now();
    }, { projectId: projectId!, executionId }), { timeout: 15_000, intervals: [500] }).toBe(true);

    // Open the Agents → Flow view and assert the streaming treatment renders on
    // the live worker node at the real Electron production boundary. The CLI
    // Agent launch left the UI on the new agent's report dialog (which owns the
    // full-screen modal-backdrop), and a "Support Zana" promo can also be up.
    // Close the report dialog FIRST — its backdrop otherwise intercepts every
    // click, including the sponsor Dismiss — then dismiss the sponsor, then nav.
    const agentDialog = window.getByRole('dialog', { name: /E2E start Job Team/ });
    if (await agentDialog.isVisible().catch(() => false)) {
      await agentDialog.getByRole('button', { name: 'Close' }).click();
      await expect(agentDialog).toBeHidden({ timeout: 10_000 });
    }
    const dismissSponsor = window.getByRole('button', { name: 'Dismiss' });
    if (await dismissSponsor.isVisible().catch(() => false)) await dismissSponsor.click();
    await expect(window.locator('.modal-backdrop')).toHaveCount(0, { timeout: 15_000 });
    await window.locator('[data-testid="nav-agents"]').click();
    await expect(window.locator('.agents-board')).toBeVisible({ timeout: 15_000 });
    await window.getByRole('button', { name: 'Flow view' }).click();

    // Working tier: the working node carries the --working class (static border
    // accent — NO pulse; pulse is the kanban board's card language, not the graph's).
    await expect(window.locator('.squad-flow-node--working').first())
      .toBeVisible({ timeout: 20_000 });
    // Streaming subset: fresh-lease node gets the stronger --streaming treatment,
    // a "live" badge, and a self-loop arc (so a lone worker with no handoff edge
    // still shows a directed "working on its own unit" arrow).
    await expect(window.locator('.squad-flow-node--streaming').first())
      .toBeVisible({ timeout: 20_000 });
    await expect(window.locator('.squad-flow-live').first())
      .toBeVisible({ timeout: 20_000 });
    await expect(window.locator('svg.squad-flow-edges path.squad-flow-self-loop').first())
      .toBeVisible({ timeout: 20_000 });
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
