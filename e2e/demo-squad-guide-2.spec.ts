/**
 * Demo recording (not a regression test): Squad guide 2, "Your first Squad run".
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

test('demo: your first Squad run', async ({ app }) => {
  const page = app.window;
  const ctx = createJobTeamContext(app, { tmpPrefix: 'atlas-site-', scenario: 'unattended' });
  try {
    await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));
    await page.addStyleTag({ content: '.statusbar { display: none !important; } [data-testid="launch-modal"] { zoom: 1.3; }' });
    await page.evaluate(() => {
      const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
      dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:2147483647;pointer-events:none;';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    });
    // The fake harness prints a "Real Claude is disabled" notice in the CLI Agent form; hide it for the recording.
    await page.evaluate(() => {
      const hide = () => document.querySelectorAll('[data-testid="launch-modal"] *').forEach((el) => {
        if (el.children.length === 0 && /Real Claude is disabled|exited with code/.test(el.textContent ?? '')) {
          (el.closest('[role="alert"], [class*="error"], [class*="warning"], [class*="status"]') as HTMLElement | null ?? el as HTMLElement).style.display = 'none';
        }
      });
      new MutationObserver(hide).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    const beat = (ms: number) => page.waitForTimeout(ms);

    // Seed (trimmed away): register the project through the shared owner launch, then close the owner.
    await launchJobTeamCliOwner(ctx, { workerQuantity: 2, prompt: 'E2E hello', orchestratorExtra: { deniedTools: ['Write', 'Edit'] } });
    const owner = page.getByRole('dialog', { name: /^Agent / }).first();
    if (await owner.count()) { await owner.getByRole('button', { name: 'Close' }).click(); await expect(owner).toBeHidden(); }
    await page.getByTestId('nav-agents').click();
    await expect(page.getByTestId('agents-board-new-thread').first()).toBeVisible();

    const demo = await createDemoVideo(page);
    await demo.flash();

    // --- 01 Open the Squad composer ---
    await demo.section({ number: 1, title: 'Open the Squad composer', subtitle: 'New agent → Launch mode → Squad', hint: 'Needs a Project and a signed-in tool' });
    await demo.say('setup');
    await demo.settle();
    await tap(page, page.getByTestId('agents-board-new-thread').first());
    const modal = page.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    await demo.say('launcher');
    await beat(900);
    await tap(page, modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }));
    await demo.settle();

    // --- 02 Pick the Squad and provide the plan ---
    await demo.section({ number: 2, title: 'Pick the Squad and describe the goal', subtitle: 'Research Squad, Infer plan from goal', hint: 'Describe the goal' });
    await demo.say('picker');
    await pick(page, modal.getByLabel('Squad', { exact: true }), 'Squad', 'Research Squad');
    await demo.settle();
    await demo.say('planning');
    await pick(page, modal.getByLabel('Squad planning'), 'Squad planning', 'Infer plan from goal');
    await expect(modal.getByLabel('Squad planning')).toContainText('Infer plan from goal');
    await demo.settle();
    await demo.say('paste');
    const goal = modal.getByTestId('team-command-input');
    await tap(page, goal);
    await goal.fill(GOAL);
    await goal.evaluate((el) => { el.scrollTop = 0; });
    await demo.settle();

    // --- 03 Launch ---
    await demo.section({ number: 3, title: 'Check and launch', subtitle: 'Launch squad, or ⌘/Ctrl+Enter', hint: 'Goal limit 2,048 characters' });
    await demo.say('limit');
    await tap(page, modal.getByLabel('Attach sources'));
    await page.keyboard.press('Escape').catch(() => {});
    await demo.settle();
    await pick(page, modal.getByRole('button', { name: 'Machine and project', exact: true }), 'Machine and project', ctx.projectName);
    await demo.say('launch');
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await beat(1800);
    await tap(page, send);
    await expect(modal).toBeHidden();
    await expect(page.getByText('Squad launched', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await demo.settle();
    await demo.say('check');
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
