/**
 * Explicit manual-only fixture. It creates a normal Job Team blocker through the
 * real app, snapshots it into a timed-out state in the isolated E2E store, then
 * relaunches a VISIBLE Zana window on Agents > Squad details and waits forever.
 *
 * Run only with MANUAL_TIMEOUT_RECOVERY=1. Ctrl-C ends the session; the sandbox
 * lives under the printed HOME and never touches the user's Zana state.
 */
import { expect, launchApp, test } from './fixtures/app.js';
import { createJobTeamContext, findJobExecutionId, launchJobTeamCliOwner } from './sdk/job-team-scenario.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  // The seed edits the JSON ledger directly; SQLite is the default creation backend.
  launchEnv: { ZCC_EXECUTION_STORE: 'json' }
});
test.setTimeout(180_000);

const JOB_TITLE = 'CLI Agent durable job';

type SeedMode = 'read-only' | 'mutating';

/** Seeds a timed-out (unresolved-blocker) Squad through the real app, then closes it. */
async function seedTimedOutSquad(app: Parameters<typeof createJobTeamContext>[0], mode: SeedMode) {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zana-manual-timeout-', scenario: 'success' });
  const { window } = ctx;
  // The blocker is raised by the fake coordinator process, which only exists when a
  // CLI Agent owner is launched (teams.startJob alone spawns no coordinator).
  const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });
  const executionId = await findJobExecutionId(window, projectId, JOB_TITLE);

  await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) =>
    (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.currentBlocker?.id ?? '',
  { projectId, executionId }), { timeout: 60_000, intervals: [500] }).not.toBe('');

  await app.electron.close();
  const filePath = join(app.home, 'electron-user-data', 'squad-executions.json');
  const file = JSON.parse(readFileSync(filePath, 'utf8')) as { records: Array<Record<string, unknown>> };
  const record = file.records.find((candidate) => candidate.id === executionId);
  if (!record) throw new Error(`manual fixture could not find execution ${executionId}`);
  // Recovery deliberately rejects mutating units. 'read-only' models the eligible
  // path; 'mutating' models the gated path (at least one unit, none read-only).
  if (mode === 'mutating' && !Array.isArray(record.workUnits)) throw new Error('mutating fixture needs seeded work units');
  if (Array.isArray(record.workUnits)) {
    record.workUnits = record.workUnits.map((unit) => ({ ...(unit as object), readOnly: mode === 'read-only' }));
  }
  record.state = 'STOPPED';
  record.timeoutReason = 'unresolved-blocker';
  record.stateVersion = Number(record.stateVersion ?? 0) + 1;
  record.updatedAt = Date.now();
  writeFileSync(filePath, JSON.stringify(file));
  return ctx;
}

async function openSquadDetails(home: string, ctx: { projectName: string }, env?: Record<string, string>) {
  const visible = await launchApp(home, { e2e: true, env: { ZCC_EXECUTION_STORE: 'json', ...env } });
  const projectRow = visible.window.locator('.project-item').filter({ hasText: ctx.projectName }).first();
  await expect(projectRow).toBeVisible({ timeout: 15_000 });
  await projectRow.click();
  await visible.window.getByTestId('nav-agents').or(visible.window.getByTestId('project-nav-agents')).click();
  await visible.window.locator('.agent-card').filter({ hasText: JOB_TITLE }).first().click();
  await expect(visible.window.getByLabel('Squad details')).toBeVisible({ timeout: 15_000 });
  return visible;
}

test('timed-out Squad with mutating work shows Recover disabled with a visible reason', async ({ app }) => {
  const ctx = await seedTimedOutSquad(app, 'mutating');
  const { window } = await openSquadDetails(app.home, ctx);
  const recover = window.getByRole('button', { name: 'Recover timed-out run' });
  await expect(recover).toBeDisabled();
  await expect(window.getByText(/Cannot recover: recovery requires durable provenance for .* mutating work/)).toBeVisible();
});

test('timed-out Squad with read-only work keeps Recover enabled', async ({ app }) => {
  const ctx = await seedTimedOutSquad(app, 'read-only');
  const { window } = await openSquadDetails(app.home, ctx);
  await expect(window.getByRole('button', { name: 'Recover timed-out run' })).toBeEnabled();
  await expect(window.getByText(/Cannot recover/)).toHaveCount(0);
});

test('MANUAL: seed timed-out Squad recovery UI', async ({ app }) => {
  test.skip(process.env.MANUAL_TIMEOUT_RECOVERY !== '1', 'manual fixture only');
  test.setTimeout(0);
  const ctx = await seedTimedOutSquad(app, 'read-only');
  await openSquadDetails(app.home, ctx, { ZCC_E2E_VISIBLE: '1' });

  console.log(`\nManual fixture ready. Isolated HOME: ${app.home}`);
  console.log('Visible Zana opened at Agents > CLI Agent durable job. Test recovery now. Ctrl-C ends fixture.\n');
  await new Promise<void>(() => {});
});
