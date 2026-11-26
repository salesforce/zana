/**
 * A Squad proposal whose plan has a blocking finding, at the real Electron boundary.
 *
 * The plan asks for a Required role the Squad does not have. The proposal still lands as an Inbox card (one summary
 * line); Review opens the composer with the "Review plan" disclosure open on a "Must fix" written in plain language,
 * and Launch stays disabled while it remains. No internal term (blocking, repair, canonical text, digest,
 * parserVersion, required-role, NO_QUALIFIED_ROUTE) may appear in what a person reads. The disabled button is a
 * renderer convenience; main re-runs the hard check at launch (unit and preflight tests cover that side).
 *
 * Zero model spend: the proposer is the deterministic fake coordinator (e2e/sdk/harness.ts).
 */
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext,
  jobTeamFailure,
  launchJobTeamCliOwner,
  openSquadReview,
  readCoordinatorLog,
  teardownJobTeam
} from './sdk/job-team-scenario.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLAN = '.zcc/library/runbooks/e2e-must-fix-plan.md';
const TITLE = 'Atlas must-fix build';
const INFER_TITLE = 'Atlas inferred build';
const INTERNAL_TERMS = /blocking|repair|canonical text|digest|parserVersion|required-role|NO_QUALIFIED_ROUTE/i;

const PLAN_MD = [
  '# Atlas Plan',
  '',
  '### home: Write Home <!-- executable-step -->',
  '- **Work:** Create home.txt containing HOME: ready',
  '- **Depends on:** None',
  '- **Required role:** auditor',
  '- **Write scope:** `home.txt`',
  '- **Verification:** home.txt present',
  ''
].join('\n');

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, sponsorPromptDismissed: true, autoRenameTabs: false },
  launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}
});
test.setTimeout(240_000);

test('a plan with a Must fix is explained in plain language and cannot be launched from the composer', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-squad-must-fix-', scenario: undefined });
  const { window } = ctx;
  try {
    mkdirSync(join(ctx.projectDir, '.zcc/library/runbooks'), { recursive: true });
    writeFileSync(join(ctx.projectDir, PLAN), PLAN_MD);
    writeFileSync(join(ctx.projectDir, '.e2e-proposal.json'), JSON.stringify({
      planPath: PLAN,
      proposals: [
        { label: 'main', input: { teamId: 'e2e-job-team', goal: 'Build the Atlas home page exactly as the attached plan describes.', sources: [PLAN], title: TITLE, acceptFindings: true } },
        // No plan file to render: the Squad writes its own plan at launch, so there is nothing canonical to show yet.
        { label: 'infer', input: { teamId: 'e2e-job-team', goal: 'Build the Atlas home page.', planning: 'infer', title: INFER_TITLE } }
      ]
    }));
    const projectId = await launchJobTeamCliOwner(ctx, {
      workerQuantity: 2,
      prompt: 'E2E propose Squad',
      teamExtra: { defaultPlanning: 'provided' }
    });
    await expect.poll(() => readCoordinatorLog(ctx), { timeout: 30_000, intervals: [500] }).toContain('propose[main]');
    await expect.poll(() => readCoordinatorLog(ctx), { timeout: 30_000, intervals: [500] }).toContain('propose[infer]');

    // Inbox card: one short summary line, no internal terms.
    const detail = await openSquadReview(ctx, TITLE);
    await expect(detail.getByTestId('inbox-plan-check')).toHaveText('Plan check: 1 Must fix before this can launch. Review shows the details.');
    await expect(detail.getByTestId('inbox-plan-check').locator('[data-severity="blocking"]')).toHaveCSS('color', /rgb/);
    expect(await detail.innerText()).not.toMatch(INTERNAL_TERMS);

    // Composer: the disclosure opens on the Must fix, in the Squad's own terms; Launch is held.
    await window.getByRole('button', { name: 'Review Squad launch' }).click();
    const modal = window.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    const review = modal.getByTestId('team-composer-plan-review');
    await expect(review).toContainText("Can't launch yet: 1 Must fix");
    await expect(review).toHaveJSProperty('open', true);
    const mustFix = review.getByTestId('plan-findings-blocking');
    await expect(mustFix.getByRole('heading', { name: 'Must fix' })).toBeVisible();
    await expect(mustFix).toContainText('Step home: Write Home asks for a role this Squad does not have.');
    await expect(mustFix).not.toContainText('Ask the agent to revise the plan');
    const actions = review.getByTestId('plan-fix-actions');
    await expect(actions.getByRole('button', { name: 'Copy fix request' })).toBeVisible();
    await expect(actions.getByRole('button', { name: /^Send to / })).toBeVisible();
    // The plan the Squad will run: the parsed step re-rendered in Squad grammar (step id, title, labels).
    const canonical = review.getByTestId('plan-canonical');
    await expect(canonical.getByText('The plan the Squad will run')).toBeVisible();
    await expect(canonical).toHaveJSProperty('open', false);
    await canonical.getByText('The plan the Squad will run').click();
    const canonicalText = review.getByTestId('plan-canonical-text');
    await expect(canonicalText).toContainText('## Execution Plan');
    await expect(canonicalText).toContainText('### home: Write Home <!-- executable-step -->');
    await expect(canonicalText).toContainText('- **Required role:** auditor');
    await expect(canonicalText).toContainText('- **Write scope:** home.txt');
    await expect(canonicalText).toContainText('- **Work:** Create home.txt containing HOME: ready');
    // Re-check goes through main (re-reads the plan file); the file is unchanged, so the Must fix stays.
    await actions.getByRole('button', { name: 'Re-check plan' }).click();
    await expect(review.getByTestId('plan-action-status')).toContainText('Re-checked: 1 Must fix remains.');
    expect(await review.innerText()).not.toMatch(INTERNAL_TERMS);
    // Re-check replaced the plan fields from the re-read file: the disclosure is still there with the same text.
    await expect(review.getByTestId('plan-canonical')).toBeVisible();
    const reopened = review.getByTestId('plan-canonical');
    if (!(await reopened.evaluate((el) => (el as HTMLDetailsElement).open))) await reopened.getByText('The plan the Squad will run').click();
    await expect(reopened).toHaveJSProperty('open', true);
    await expect(review.getByTestId('plan-canonical-text')).toContainText('### home: Write Home <!-- executable-step -->');

    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('aria-label', 'Fix the plan first');
    // Nothing started: no execution exists for the project.
    const started = await window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions.length, projectId);
    expect(started).toBe(0);

    // A proposal with no plan file has nothing canonical to show: no disclosure at all.
    await window.locator('.palette-backdrop').click({ position: { x: 4, y: 4 } });
    await expect(modal).toBeHidden();
    const inferDetail = await openSquadReview(ctx, INFER_TITLE);
    await expect(inferDetail).toContainText(INFER_TITLE);
    await window.getByRole('button', { name: 'Review Squad launch' }).click();
    const inferModal = window.getByTestId('launch-modal');
    await expect(inferModal).toBeVisible();
    await expect(inferModal.getByTestId('plan-canonical')).toHaveCount(0);
    await expect(inferModal.getByTestId('plan-canonical-text')).toHaveCount(0);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
