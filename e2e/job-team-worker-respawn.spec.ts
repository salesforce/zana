/**
 * AC12 through the built app: the coordinator respawns a worker slot whose session ended.
 * Scenario `respawn-after-kill`: the first worker process holds its claim; the spec closes that
 * session and asks the coordinator (via .e2e-respawn.json, which the fake coordinator turns into an
 * `execution.worker.respawn` MCP call) to respawn the slot. The new session keeps the slot, role
 * and execution; the third respawn of one slot is refused (cap 2).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext, findJobExecutionId, jobTeamFailure, launchSquadFixture,
  squadNowReceipt, teardownJobTeam, type JobTeamContext
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000' }
});
test.setTimeout(240_000);

const PLAN = [
  '# Respawn plan',
  '### unit-a: Write a <!-- executable-step -->', '- Work: Create a.txt.', '- Write scope: `a.txt`', '- Verification: Read a.txt.', '',
  '### unit-b: Write b <!-- executable-step -->', '- Work: Create b.txt.', '- Write scope: `b.txt`', '- Verification: Read b.txt.', ''
].join('\n');

async function workers(ctx: JobTeamContext, projectId: string, executionId: string) {
  return ctx.window.evaluate(async ({ projectId, executionId }) =>
    (await window.cc.terminals.list(projectId))
      .filter((s) => s.cohort?.executionId === executionId && s.cohort.role === 'worker')
      .map((s) => ({ id: s.id, slotId: s.cohort?.slotId as string })), { projectId, executionId });
}

test('coordinator respawns an ended worker slot twice and refuses the third respawn', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'worker-respawn-', scenario: 'respawn-after-kill' });
  try {
    const projectId = await launchSquadFixture(ctx, [{ label: 'respawn', input: { mode: 'now', title: 'Respawn run' } }], { plan: PLAN, workerQuantity: 2 });
    const receipt = await squadNowReceipt(ctx, 'respawn');
    const executionId = await findJobExecutionId(ctx.window, projectId, 'Respawn run');
    const runDir = receipt.path!;

    // Two live workers; ending one slot leaves the run RUNNING (the other worker survives), which is
    // the state in which respawn is allowed.
    const victim = '0:e2e-worker:1';
    await expect.poll(async () => (await workers(ctx, projectId, executionId)).map((w) => w.slotId).sort(), { timeout: 90_000, intervals: [500] })
      .toEqual(['0:e2e-worker:0', victim]);

    const respawn = async (n: number) => {
      const [live] = (await workers(ctx, projectId, executionId)).filter((w) => w.slotId === victim);
      if (live) await ctx.window.evaluate((id) => window.cc.terminals.close(id), live.id);
      await expect.poll(async () => (await workers(ctx, projectId, executionId)).filter((w) => w.slotId === victim).length, { timeout: 30_000 }).toBe(0);
      const label = `respawn[${victim}]`;
      // Capture the response count BEFORE the request file exists, so a fast reply cannot be missed.
      const logPath = join(runDir, '.fake-coordinator.log');
      const seen = existsSync(logPath)
        ? (readFileSync(logPath, 'utf8').match(new RegExp(`respawn\\[${victim}\\] \\{`, 'g')) ?? []).length : 0;
      writeFileSync(join(runDir, '.e2e-respawn.json'), JSON.stringify({ slotId: victim }));
      await expect.poll(() => ((existsSync(logPath) ? readFileSync(logPath, 'utf8') : '').match(new RegExp(`respawn\\[${victim}\\] \\{`, 'g')) ?? []).length,
        { timeout: 30_000, message: `respawn call ${n}` }).toBe(seen + 1);
      const lines = readFileSync(join(runDir, '.fake-coordinator.log'), 'utf8').split('\n').filter((l) => l.includes(`${label} {`));
      return JSON.parse(lines.at(-1)!.slice(lines.at(-1)!.indexOf(`${label} `) + label.length + 1)) as { ok: boolean; error?: string };
    };

    const original = (await workers(ctx, projectId, executionId)).find((w) => w.slotId === victim)!;
    const first = await respawn(1);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    await expect.poll(async () => (await workers(ctx, projectId, executionId)).filter((w) => w.slotId === victim).length, { timeout: 30_000 }).toBe(1);
    expect((await workers(ctx, projectId, executionId)).find((w) => w.slotId === victim)!.id).not.toBe(original.id);

    const second = await respawn(2);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    await expect.poll(async () => (await workers(ctx, projectId, executionId)).filter((w) => w.slotId === victim).length, { timeout: 30_000 }).toBe(1);

    const third = await respawn(3);
    expect(third.ok, JSON.stringify(third)).toBe(false);
    expect(third.error ?? '').toMatch(/respawn|limit|cap|times/i);
    expect((await workers(ctx, projectId, executionId)).filter((w) => w.slotId === victim)).toHaveLength(0);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
