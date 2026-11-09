/**
 * Fresh session per unit (#579): a Squad whose only worker seat asks for a fresh session per unit runs two units
 * ("home" and "about") through two different worker sessions, and both complete. Follows job-team-peer-handoff.spec.ts
 * (same launcher flow, same fake binary) with the `unattended` scenario so no human question is raised.
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, launchJobTeamCliOwner, findJobExecutionId, jobTeamFailure, teardownJobTeam } from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  launchEnv: { ANTHROPIC_API_KEY: 'fresh-context-seat-e2e-key' }
});
test.setTimeout(180_000);

test('a fresh-context seat runs each unit in its own session and both units complete', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-fresh-seat-', scenario: 'unattended' });
  const { window } = ctx;
  const seen = new Set<string>();
  try {
    const projectId = await launchJobTeamCliOwner(ctx, {
      workerQuantity: 1,
      teamExtra: { slots: [{ personaId: 'e2e-worker', quantity: 1, freshContextPerUnit: true }] }
    });
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent durable job');

    const units = () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const assignments = (snap?.execution.work?.assignments ?? []) as Array<{ workUnitId: string; state: string }>;
      const sessions = (await window.cc.terminals.list(projectId)) as Array<{ id: string; cohort?: { role?: string } }>;
      return {
        execState: snap?.execution.state ?? 'missing',
        home: assignments.find((a) => a.workUnitId === 'home')?.state ?? 'missing',
        about: assignments.find((a) => a.workUnitId === 'about')?.state ?? 'missing',
        workers: sessions.filter((s) => s.cohort?.role === 'worker').map((s) => s.id)
      };
    }, { projectId, executionId });

    await expect.poll(async () => {
      const view = await units();
      for (const id of view.workers) seen.add(id);
      return view.home === 'COMPLETED' && view.about === 'COMPLETED';
    }, { timeout: 120_000, intervals: [250] }).toBe(true);

    // One slot, two units: the second unit must have run in a different worker session than the first.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
