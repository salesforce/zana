/**
 * Demo recording (not a regression test): Squad guide 1, "What is a Squad?".
 * See docs/media/squad-guide-README.md for the record command.
 *
 * No model is called: the Squad's agents are the deterministic fake coordinator
 * (e2e/sdk/harness.ts). A project Squad is launched and answered before the black flash, so the
 * trimmed recording opens on a finished run's Squad details.
 */
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext, findJobExecutionId, launchJobTeamCliOwner, readCoordinatorLog, teardownJobTeam
} from './sdk/job-team-scenario.js';
import { createDemoVideo } from './sdk/demo-video.js';
import { parseRecordSize } from './sdk/demo-video-core.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

const TITLE = 'Atlas site build';
const DESIGN = '.zcc/library/designs/atlas-design.md';
const PLAN = '.zcc/library/runbooks/atlas-plan.md';
const GOAL = 'Build the Atlas site exactly as the attached plan describes.';
// Step ids match the fake cohort's scripted plan, so the run goes home/about -> label question -> assemble.
const PLAN_MD = [
  '# Atlas Plan', '',
  '### home: Write Home <!-- executable-step -->', '- **Work:** Create home.txt containing HOME: ready', '- **Depends on:** None', '- **Write scope:** `home.txt`', '- **Verification:** home.txt present', '',
  '### about: Write About <!-- executable-step -->', '- **Work:** Create about.txt containing ABOUT: ready', '- **Depends on:** None', '- **Write scope:** `about.txt`', '- **Verification:** about.txt present', '',
  '### navigation-label: Ask Navigation Label <!-- executable-step -->', '- **Work:** Raise a durable human question with two label choices', '- **Depends on:** home, about', '- **Mode:** read-only', '- **Verification:** durable question answered', '',
  '### assemble: Assemble Result <!-- executable-step -->', '- **Work:** Write result.txt from both worker outputs and the chosen label', '- **Depends on:** navigation-label', '- **Write scope:** `result.txt`', '- **Verification:** cat result.txt', ''
].join('\n');

test.use({
  e2e: true,
  initialConfig: { theme: 'light', sponsorPromptDismissed: true, teamJobLaunchEnabled: true, autoRenameTabs: false },
  launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}
});
test.setTimeout(300_000);

async function tap(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box && process.env.ZCC_E2E_RECORD_VIDEO) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await page.waitForTimeout(120);
  await target.click();
}

test('demo: what is a Squad', async ({ app }) => {
  const page = app.window;
  const ctx = createJobTeamContext(app, { tmpPrefix: 'atlas-site-', scenario: undefined });
  const projectDir = ctx.projectDir;

  try {
    await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));
    // The status bar shows the throwaway E2E home path.
    await page.addStyleTag({ content: '.statusbar { display: none !important; }' });
    await page.evaluate(() => {
      const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
      dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:2147483647;pointer-events:none;';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    });
    const beat = (ms: number) => page.waitForTimeout(ms);

    // --- Seed (before the flash, so it is trimmed away): a design session proposes, the user launches
    // from the Inbox card, answers the Squad's question, and the run posts "Squad completed". ---
    mkdirSync(join(projectDir, '.zcc/library/designs'), { recursive: true });
    mkdirSync(join(projectDir, '.zcc/library/runbooks'), { recursive: true });
    writeFileSync(join(projectDir, DESIGN), '# Atlas design\n\nA two-page site with a navigation label chosen by the owner.\n');
    writeFileSync(join(projectDir, PLAN), PLAN_MD);
    writeFileSync(join(projectDir, '.e2e-proposal.json'), JSON.stringify({
      planPath: PLAN,
      proposals: [{ label: 'main', input: { teamId: 'e2e-job-team', goal: GOAL, sources: [DESIGN, PLAN], title: TITLE, summary: 'Two pages, a navigation label, one assembled result.' } }]
    }));
    const projectId = await launchJobTeamCliOwner(ctx, {
      workerQuantity: 2, prompt: 'E2E propose Squad',
      orchestratorExtra: { deniedTools: ['Write', 'Edit'] }, teamExtra: { defaultPlanning: 'provided' }
    });
    // Friendly names for the on-screen Squad (ids stay, so the proposal still resolves).
    await page.evaluate(() => window.cc.personas.save({ id: 'e2e-orchestrator', name: 'Atlas Orchestrator', description: 'Plans and keeps the run moving', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '', deniedTools: ['Write', 'Edit'] }));
    await page.evaluate(() => window.cc.personas.save({ id: 'e2e-worker', name: 'Atlas Worker', description: 'Takes one step of the plan', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '' }));
    await page.evaluate(() => window.cc.teams.save({ id: 'e2e-job-team', name: 'Atlas Squad', description: 'Plans, splits and delivers a small web task', slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator', defaultPlanning: 'provided' }));
    await expect.poll(() => readCoordinatorLog(ctx), { timeout: 30_000, intervals: [500] }).toContain(' propose[main] {');
    const closeOwner = async () => {
      const owner = page.getByRole('dialog', { name: /^Agent / }).first();
      if (await owner.count()) { await owner.getByRole('button', { name: 'Close' }).click(); await expect(owner).toBeHidden(); }
    };
    await closeOwner();
    await page.getByTestId('nav-inbox').or(page.getByTestId('project-nav-inbox')).click();
    const proposal = page.locator('.inbox-row').filter({ hasText: `Squad launch ready: ${TITLE}` }).first();
    await expect(proposal).toBeVisible({ timeout: 30_000 });
    await proposal.click();
    await page.getByRole('button', { name: 'Review Squad launch' }).click();
    const modal = page.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();
    await expect(modal).toBeHidden();
    const executionId = await findJobExecutionId(page, projectId, TITLE);
    // The run stops at its durable question and waits for a person: a deterministic place to film Flow
    // view (live hand-off edges) and the Inbox question. The answer is given on camera.
    await expect.poll(() => page.evaluate(async ({ projectId, executionId }) => {
      const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return snapshot?.execution.currentBlocker?.question ?? '';
    }, { projectId, executionId }), { timeout: 60_000, intervals: [500] }).toContain('label');
    await closeOwner();
    const openCompleted = async () => {
      await tap(page, page.getByTestId('nav-inbox'));
      const completed = page.locator('.inbox-row').filter({ hasText: `Squad completed: ${TITLE}` }).first();
      await expect(completed).toBeVisible({ timeout: 90_000 });
      await tap(page, completed);
      await expect(page.locator('.inbox-detail')).toContainText('Squad completed');
    };
    // Warm Flow view and the Inbox question once (first paint is slow), then rest on Settings -> Squads.
    await tap(page, page.getByTestId('nav-agents'));
    await tap(page, page.getByRole('button', { name: 'Flow view' }));
    await expect(page.locator('svg.squad-flow-edges path.squad-flow-edge').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByTestId('settings-nav-squads').click();
    await expect(page.getByRole('button', { name: 'Open Research Squad' })).toBeVisible();

    const demo = await createDemoVideo(page);
    await demo.flash();

    // --- 01 Personas and Squads: concept first, on the catalogue. Each screen change waits for its line. ---
    await demo.section({ number: 1, title: 'Personas and Squads', subtitle: 'Settings → Agents & Automation → Squads', hint: 'Persona → slot → worker' });
    await demo.say('intro');
    await demo.settle();
    await demo.say('persona');
    await demo.settle();
    await tap(page, page.getByRole('button', { name: 'Expand Research Squad to see agents' }));
    await expect(page.getByRole('region', { name: 'Agents in Research Squad' })).toBeVisible();
    await demo.say('squad');
    await demo.settle();
    await demo.say('orchestrator');
    await demo.settle();
    await tap(page, page.getByRole('tab', { name: /^Builtin/ }));
    await expect(page.getByRole('button', { name: 'Open Design Squad' })).toBeVisible();
    await demo.say('builtin');
    await demo.settle();
    await demo.say('when');
    await demo.settle();

    // --- 02 A Squad at work: Flow view of the live run (stopped at its question). ---
    await demo.section({ number: 2, title: 'A Squad at work', subtitle: 'Agents → Flow view', hint: 'Who works, how work hands off' });
    await tap(page, page.getByRole('link', { name: 'Back to app' }));
    await tap(page, page.getByTestId('nav-agents'));
    await tap(page, page.getByRole('button', { name: 'Flow view' }));
    await expect(page.locator('svg.squad-flow-edges path.squad-flow-edge').first()).toBeVisible({ timeout: 30_000 });
    await demo.say('flow');
    await demo.settle();

    // --- 03 Where you act: the question, the answer, the posted result, then Squad details. ---
    await demo.section({ number: 3, title: 'Where you act', subtitle: 'Ask and read in the Inbox, dig in with Squad details', hint: 'You review the result' });
    await tap(page, page.getByTestId('nav-inbox'));
    const pinned = page.locator('.inbox-questions-pinned');
    await expect(pinned.getByText('Needs your answer', { exact: true })).toBeVisible({ timeout: 15_000 });
    await tap(page, pinned.getByText(TITLE, { exact: true }));
    const question = page.locator('.inbox-question');
    await expect(question).toContainText('Which label should result.txt use?');
    await demo.say('ask');
    await beat(2500);
    await tap(page, question.getByRole('radio', { name: /About Atlas/i }));
    await beat(600);
    await tap(page, question.getByRole('button', { name: /^(Continue|Reopen & answer)$/ }));
    await demo.settle();
    await openCompleted();
    await demo.say('done');
    await demo.settle();
    await tap(page, page.getByRole('button', { name: 'Open Squad details' }));
    await expect(page.getByLabel('Squad details').getByText('4/4 complete', { exact: false })).toBeVisible({ timeout: 30_000 });
    await demo.say('details');
    await demo.settle();
    await demo.say('close');
    await demo.finish();
  } finally {
    await page.evaluate(async () => {
      for (const project of await window.cc.projects.list()) {
        for (const session of await window.cc.terminals.list(project.id)) await window.cc.terminals.close(session.id).catch(() => {});
      }
    }).catch(() => {});
    await teardownJobTeam(ctx);
  }
});
