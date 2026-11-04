/**
 * Demo recording (not a regression test): Squad guide 3, "Watch a Squad run".
 * See docs/media/squad-guide-README.md for the record command.
 *
 * No model is called: the Squad's agents are the deterministic fake coordinator
 * (e2e/sdk/harness.ts). The recording shows the launch only; the run itself is video 3.
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, launchJobTeamCliOwner, teardownJobTeam } from './sdk/job-team-scenario.js';
import { createDemoVideo } from './sdk/demo-video.js';
import { parseRecordSize } from './sdk/demo-video-core.js';
import type { Locator, Page } from '@playwright/test';

const GOAL = 'Compare how the login flow and the billing flow work in this Project. Look at each one separately, then write one report with a summary, findings that cite files, and open questions. Do not edit any files.';

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

async function pick(page: Page, picker: Locator, listbox: string, option: string): Promise<void> {
  await tap(page, picker);
  await page.waitForTimeout(250);
  await tap(page, page.getByRole('listbox', { name: listbox }).getByRole('option', { name: new RegExp(`${listbox === 'Machine and project' ? '› ' : '^'}${option}(?:\\s|$)`) }).first());
}

test('demo: watch a Squad run', async ({ app }) => {
  const page = app.window;
  const ctx = createJobTeamContext(app, { tmpPrefix: 'atlas-site-', scenario: undefined });
  try {
    await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));
    await page.addStyleTag({ content: '.statusbar { display: none !important; } [data-testid="launch-modal"] { zoom: 1.3; }' });
    await page.evaluate(() => {
      const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
      dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:2147483647;pointer-events:none;';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    });
    const beat = (ms: number) => page.waitForTimeout(ms);

    // Seed (trimmed away): register the project, close the owner, launch the Research Squad from the composer,
    // and wait until the run stops at its scripted question so the recording opens on a live, waiting run.
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2, prompt: 'E2E hello', orchestratorExtra: { deniedTools: ['Write', 'Edit'] } });
    const closeOwner = async () => {
      const owner = page.getByRole('dialog', { name: /^Agent / }).first();
      if (await owner.count()) { await owner.getByRole('button', { name: 'Close' }).click(); await expect(owner).toBeHidden(); }
    };
    await closeOwner();
    // The shared owner launch leaves an "E2E hello" agent behind; remove it so the board shows only the Squad.
    await page.evaluate(async (projectId) => {
      for (const session of await window.cc.terminals.list(projectId)) await window.cc.terminals.close(session.id).catch(() => {});
    }, projectId);
    await page.getByTestId('nav-agents').click();
    await tap(page, page.getByTestId('agents-board-new-thread').first());
    const modal = page.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    await tap(page, modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }));
    await pick(page, modal.getByLabel('Squad', { exact: true }), 'Squad', 'Research Squad');
    await pick(page, modal.getByLabel('Squad planning'), 'Squad planning', 'Infer plan from goal');
    await modal.getByTestId('team-command-input').fill(GOAL);
    await pick(page, modal.getByRole('button', { name: 'Machine and project', exact: true }), 'Machine and project', ctx.projectName);
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();
    await expect(modal).toBeHidden();
    await expect.poll(() => page.evaluate(async (projectId) => {
      const board = await window.cc.executionBoard.listProject(projectId);
      return board.executions.find((e) => e.currentBlocker?.question)?.currentBlocker?.question ?? '';
    }, projectId), { timeout: 90_000, intervals: [500] }).toContain('label');
    await closeOwner();
    await tap(page, page.getByTestId('nav-agents'));
    const card = page.locator('.agent-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    // Dismiss the exited "E2E hello" agent through the List view's Dismiss action (still before the flash).
    await page.getByRole('button', { name: 'List view' }).click();
    const leftover = page.locator('.agent-card, [class*="agent-monitor"]').filter({ hasText: 'E2E hello' }).first();
    if (await leftover.count()) await leftover.click().catch(() => {});
    const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
    if (await dismiss.count()) await dismiss.first().click();
    await page.getByRole('button', { name: 'Board view' }).click();
    await expect(page.getByText('E2E hello')).toHaveCount(0, { timeout: 10_000 });

    const demo = await createDemoVideo(page);
    await demo.flash();

    // --- 01 Find your run ---
    await demo.section({ number: 1, title: 'Find your run', subtitle: 'Agents board → Squad details', hint: 'Board and Flow' });
    await demo.say('board');
    await beat(1500);
    await tap(page, page.getByRole('button', { name: 'Flow view' }));
    await expect(page.locator('svg.squad-flow-edges path.squad-flow-edge').first()).toBeVisible({ timeout: 30_000 });
    await demo.settle();
    await tap(page, page.getByRole('button', { name: 'Board view' }));
    await expect(card).toBeVisible();
    await demo.section({ number: 2, title: 'Squad details', subtitle: 'Open the card', hint: 'Progress for each step' });
    await tap(page, card);
    await expect(page.getByLabel('Squad details')).toBeVisible({ timeout: 15_000 });
    await demo.say('details');
    await demo.settle();

    // --- 03 When a worker asks ---
    await demo.section({ number: 3, title: 'When a worker asks', subtitle: 'Inbox → Needs your answer', hint: 'A question is not an error' });
    await page.keyboard.press('Escape').catch(() => {});
    await tap(page, page.getByTestId('nav-inbox'));
    const pinned = page.locator('.inbox-questions-pinned');
    await expect(pinned.getByText('Needs your answer', { exact: true })).toBeVisible({ timeout: 15_000 });
    await tap(page, pinned.locator('.inbox-row, [role="button"], button').first());
    const question = page.locator('.inbox-question');
    await expect(question).toContainText('Which label should result.txt use?');
    await demo.say('question');
    await beat(1500);
    await tap(page, question.getByRole('radio', { name: /About Atlas/i }));
    await demo.say('answer');
    await tap(page, question.getByRole('button', { name: /^(Continue|Reopen & answer)$/ }));
    await demo.settle();

    // --- 04 The result ---
    await demo.section({ number: 4, title: 'Read the result', subtitle: 'Squad completed → Squad details', hint: 'Full record in Squad details' });
    const completed = page.locator('.inbox-row').filter({ hasText: 'Squad completed' }).first();
    await expect(completed).toBeVisible({ timeout: 90_000 });
    await tap(page, completed);
    await expect(page.locator('.inbox-detail')).toContainText('Squad completed');
    await demo.say('done');
    await demo.settle();
    await tap(page, page.getByRole('button', { name: 'Open Squad details' }));
    await expect(page.getByLabel('Squad details').getByText('4/4 complete', { exact: false })).toBeVisible({ timeout: 30_000 });
    await demo.say('result');
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
