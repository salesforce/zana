/**
 * Fresh session per unit (#579): a Squad whose worker seats ask for a fresh session per unit runs the fake coordinator's
 * plan ("home" and "about" in parallel, then "navigation-label" once both are done). The third unit goes to a seat that
 * already finished one, so it must start in a new worker session. The fake plan always launches two worker slots. Follows job-team-peer-handoff.spec.ts
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
      workerQuantity: 2,
      teamExtra: { slots: [{ personaId: 'e2e-worker', quantity: 2, freshContextPerUnit: true }] }
    });
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent durable job');

    const units = () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const assignments = (snap?.execution.work?.assignments ?? []) as Array<{ workUnitId: string; state: string }>;
      const stateOf = (id: string) => assignments.find((a) => a.workUnitId === id)?.state ?? 'missing';
      const sessions = (await window.cc.terminals.list(projectId)) as Array<{ id: string; cohort?: { role?: string } }>;
      return {
        execState: snap?.execution.state ?? 'missing',
        home: stateOf('home'),
        about: stateOf('about'),
        label: stateOf('navigation-label'),
        workers: sessions.filter((s) => s.cohort?.role === 'worker').map((s) => s.id)
      };
    }, { projectId, executionId });

    await expect.poll(async () => {
      const view = await units();
      for (const id of view.workers) seen.add(id);
      return view.home === 'COMPLETED' && view.about === 'COMPLETED' && view.label === 'COMPLETED';
    }, { timeout: 120_000, intervals: [250] }).toBe(true);

    // Two seats ran home and about; the third unit went to a seat that had already finished one, so it needed a
    // new session: at least three distinct worker sessions over the run.
    expect(seen.size).toBeGreaterThanOrEqual(3);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
