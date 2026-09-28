import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext,
  launchJobTeamCliOwner,
  findJobExecutionId,
  jobTeamFailure,
  teardownJobTeam
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  // The claim lease and reconcile interval both stay far longer than this test,
  // and the plan sets NO wall-clock ceiling. So recovery CANNOT come from lease
  // expiry, the periodic sweep, or a wall-clock backstop — the ONLY way the held
  // claim releases is the worker's actual Stop exit. That is the manual test.
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000' }
});
test.setTimeout(180_000);

/**
 * The workflow-testing manual test, automated: launch a two-worker squad, Stop the
 * worker that holds the sole unit, and prove the SURVIVING peer picks the unit up
 * and drives it (and the whole execution) to COMPLETED. The existing
 * `job-team-stopped-worker-recovery.spec.ts` proves only that a Stop reclaims a
 * claim (one worker); this proves the reclaimed unit actually rotates to a live
 * peer and finishes — the invariant the reclaim/quarantine work exists to deliver.
 */
test('Job Team rotates a stopped worker\'s unit to a surviving peer and completes', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-handoff-', scenario: 'peer-handoff' });
  const { window } = ctx;

  const readUnit = (projectId: string, executionId: string) => window.evaluate(async ({ projectId, executionId }) => {
    const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
    const unit = snap?.execution.work?.assignments.find((a: { workUnitId: string }) => a.workUnitId === 'handoff-unit');
    return {
      execState: snap?.execution.state ?? 'missing',
      state: unit?.state ?? 'missing',
      slotId: unit?.slotId ?? '',
      claimGeneration: unit?.claimGeneration ?? 0,
      quarantinedSlots: (unit as { quarantinedSlots?: string[] } | undefined)?.quarantinedSlots ?? []
    };
  }, { projectId, executionId });

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent handoff job');

    // Wait for the first claim to land on a worker slot and be HELD (gen 1).
    await expect.poll(async () => {
      const u = await readUnit(projectId, executionId);
      return u.state === 'CLAIMED' && u.slotId !== '' && u.claimGeneration === 1;
    }, { timeout: 60_000, intervals: [250] }).toBe(true);
    const held = await readUnit(projectId, executionId);
    const stoppedSlotId = held.slotId;

    // Map the holding slot to its worker session — the tab the user would Stop.
    const workerId = await window.evaluate(async ({ projectId, executionId, slotId }) => {
      const sessions = await window.cc.terminals.list(projectId);
      return sessions.find((s) => s.cohort?.executionId === executionId && s.cohort.role === 'worker' && s.cohort.slotId === slotId)?.id ?? '';
    }, { projectId, executionId, slotId: stoppedSlotId });
    expect(workerId, 'no worker session for the holding slot').not.toBe('');

    // Same renderer IPC as the tab Stop/close control.
    await window.evaluate((sessionId) => window.cc.terminals.close(sessionId), workerId);

    // The unit must rotate to the OTHER slot (higher claimGeneration) and the
    // stopped slot must be quarantined — not re-dispatched onto the dead worker.
    await expect.poll(async () => {
      const u = await readUnit(projectId, executionId);
      if (u.execState === 'FAILED' || u.execState === 'STOPPED') throw new Error(`execution ${u.execState} before peer pickup`);
      return u.slotId !== '' && u.slotId !== stoppedSlotId && u.claimGeneration >= 2;
    }, { timeout: 60_000, intervals: [500] }).toBe(true);

    const rotated = await readUnit(projectId, executionId);
    expect(rotated.quarantinedSlots, 'stopped slot not quarantined').toContain(stoppedSlotId);

    // The surviving peer must actually COMPLETE the unit and the run auto-finalize.
    await expect.poll(async () => (await readUnit(projectId, executionId)).state, {
      timeout: 60_000, intervals: [500]
    }).toBe('COMPLETED');
    await expect.poll(async () => (await readUnit(projectId, executionId)).execState, {
      timeout: 60_000, intervals: [500]
    }).toBe('COMPLETED');

    // The peer's real work landed on disk in the shared project workspace.
    expect(existsSync(join(ctx.projectDir, 'handoff.txt')), 'peer never wrote handoff.txt').toBe(true);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
