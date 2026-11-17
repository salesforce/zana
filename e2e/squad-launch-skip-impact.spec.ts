/**
 * Plan lint Checks and skip impact on the Squad launch card, at the real Electron boundary.
 *
 * A design session proposes a Squad launch from a plan that is serial (width 1 against two workers), has one
 * step that changes both a server contract and a screen, and has steps with dependents. The Review plan
 * disclosure in the composer must show the lint Checks and, per step, which steps will not run if it fails,
 * in the same card that shows Must fix and Fixed for you. Nothing is launched.
 *
 * Zero model spend: the proposer is the deterministic fake coordinator (e2e/sdk/harness.ts).
 */
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import {
  createJobTeamContext,
  jobTeamFailure,
  launchJobTeamCliOwner,
  readCoordinatorLog,
  teardownJobTeam
} from './sdk/job-team-scenario.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const TITLE = 'Sync conflict screen';
const PLAN = '.zcc/library/runbooks/e2e-skip-impact-plan.md';
const GOAL = 'Build the sync conflict screen exactly as the attached plan describes.';

// Serial: prepare -> sync-screen -> review -> assemble. sync-screen writes a server file and a screen file.
const PLAN_MD = [
  '# Sync conflict plan',
  '',
  '### prepare: Prepare the data <!-- executable-step -->',
  '- **Work:** Create prepare.txt containing PREPARE: ready',
  '- **Depends on:** None',
  '- **Write scope:** `prepare.txt`',
  '- **Verification:** prepare.txt present',
  '',
  '### sync-screen: Sync store and conflict screen <!-- executable-step -->',
  '- **Work:** Add the sync store and the conflict review screen that reads it',
  '- **Depends on:** prepare',
  '- **Write scope:** `apps/server/src/services/sync/store.ts`, `apps/app/src/views/ConflictReview.tsx`',
  '- **Verification:** both files present',
  '',
  '### review: Review the change <!-- executable-step -->',
  '- **Work:** Read both files and report problems',
  '- **Depends on:** sync-screen',
  '- **Mode:** read-only',
  '- **Verification:** report written',
  '',
  '### assemble: Assemble Result <!-- executable-step -->',
  '- **Work:** Write result.txt from the review',
  '- **Depends on:** review',
  '- **Write scope:** `result.txt`',
  '- **Verification:** cat result.txt',
  ''
].join('\n');

async function openReviewPlan(window: Page) {
  await window.getByRole('button', { name: 'Review Squad launch' }).click();
  const modal = window.getByTestId('launch-modal');
  await expect(modal).toBeVisible();
  const review = modal.getByTestId('team-composer-plan-review');
  await expect(review).toBeVisible();
  if (!(await review.evaluate((el) => (el as HTMLDetailsElement).open))) await review.locator('summary').click();
  return { modal, review };
}

test.describe('launch card skip impact and plan Checks', () => {
  test.use({
    e2e: true,
    initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, sponsorPromptDismissed: true, autoRenameTabs: false },
    launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}
  });
  test.setTimeout(300_000);

  test('shows the skip-impact line and the lint Checks before anything is launched', async ({ app }, testInfo) => {
    const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-squad-skip-impact-', scenario: undefined });
    try {
      mkdirSync(join(ctx.projectDir, '.zcc/library/runbooks'), { recursive: true });
      writeFileSync(join(ctx.projectDir, PLAN), PLAN_MD);
      writeFileSync(join(ctx.projectDir, '.e2e-proposal.json'), JSON.stringify({
        planPath: PLAN,
        proposals: [{ label: 'main', input: { teamId: 'e2e-job-team', goal: GOAL, sources: [PLAN], title: TITLE, summary: 'One serial plan with a mixed step.' } }]
      }));
      await launchJobTeamCliOwner(ctx, {
        workerQuantity: 2,
        prompt: 'E2E propose Squad',
        orchestratorExtra: { deniedTools: ['Write', 'Edit'] },
        teamExtra: { defaultPlanning: 'provided' }
      });
      await expect.poll(() => readCoordinatorLog(ctx), { timeout: 30_000, intervals: [500] }).toContain(' propose[main] {');

      // The agent text carries the Checks too (squad_plan_check result logged by the fake proposer).
      const log = readCoordinatorLog(ctx);
      expect(log).toContain('can run at the same time');
      expect(log).toContain('changes both a server contract and the screen that uses it');

      await ctx.window.getByTestId('nav-inbox').or(ctx.window.getByTestId('project-nav-inbox')).click();
      const row = ctx.window.locator('.inbox-row').filter({ hasText: `Squad launch ready: ${TITLE}` }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();

      const { modal, review } = await openReviewPlan(ctx.window);
      // Checks sit in the same card as Must fix / Fixed for you, and launch stays allowed.
      const checks = review.getByTestId('plan-findings-warning');
      await expect(checks).toContainText('Check');
      await expect(checks).toContainText('Only 1 step can run at the same time, but this Squad has 2 workers. The others will wait.');
      await expect(checks).toContainText('Step sync-screen');
      await expect(checks).toContainText('Split it so the contract lands first');
      await expect(checks).toContainText('Launch is still allowed');
      await expect(review.getByTestId('plan-findings-blocking')).toHaveCount(0);

      // Skip impact: one line per step with dependents, in plan order.
      const rowFor = (id: string) => review.getByTestId('plan-bindings').getByRole('row').filter({ has: ctx.window.getByRole('rowheader', { name: id, exact: true }) });
      await expect(rowFor('prepare')).toContainText('If this step fails, these steps will not run: sync-screen, review, assemble');
      await expect(rowFor('sync-screen')).toContainText('If this step fails, these steps will not run: review, assemble');
      await expect(rowFor('review')).toContainText('If this step fails, these steps will not run: assemble');
      await expect(rowFor('assemble')).not.toContainText('If this step fails');
      await expect(review).not.toContainText(/requirement|severity|stepId/i);

      // Launch is still enabled: Checks never block.
      await expect(modal.getByTestId('team-command-send')).toBeEnabled({ timeout: 15_000 });
      await captureElectronScreenshot(app.electron, ctx.window, testInfo.outputPath('01-launch-card-skip-impact.png'));
    } catch (error) {
      throw jobTeamFailure(ctx, error);
    } finally {
      await teardownJobTeam(ctx);
    }
  });
});
