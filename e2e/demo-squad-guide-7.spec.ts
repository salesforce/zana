/**
 * Demo recording (not a regression test): Squad guide 7, "Schedule a Squad".
 * See docs/media/squad-guide-README.md for the record command.
 *
 * No model is called: the Squad's agents are the deterministic fake coordinator (e2e/sdk/harness.ts).
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, launchJobTeamCliOwner, teardownJobTeam } from './sdk/job-team-scenario.js';
import { createDemoVideo } from './sdk/demo-video.js';
import { parseRecordSize } from './sdk/demo-video-core.js';
import type { Locator, Page } from '@playwright/test';

// Step ids match the fake cohort's scripted plan.
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
test.setTimeout(360_000);

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

test('demo: schedule a Squad', async ({ app }) => {
  const page = app.window;
  const ctx = createJobTeamContext(app, { tmpPrefix: 'atlas-site-', scenario: 'unattended' });
  try {
    await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));
    await page.addStyleTag({ content: '.statusbar { display: none !important; }' });
    await page.evaluate(() => {
      const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
      dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:2147483647;pointer-events:none;';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    });
    const go = (to: string) => page.evaluate((path) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, to);

    // Seed (trimmed away): register the project via the shared owner launch, close the owner, name the Squad.
    await launchJobTeamCliOwner(ctx, { workerQuantity: 2, prompt: 'E2E hello', orchestratorExtra: { deniedTools: ['Write', 'Edit'] } });
    const owner = page.getByRole('dialog', { name: /^Agent / }).first();
    if (await owner.count()) { await owner.getByRole('button', { name: 'Close' }).click(); await expect(owner).toBeHidden(); }
    await page.evaluate(() => window.cc.personas.save({ id: 'e2e-orchestrator', name: 'Atlas Orchestrator', description: 'Plans and keeps the run moving', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '', deniedTools: ['Write', 'Edit'] }));
    await page.evaluate(() => window.cc.personas.save({ id: 'e2e-worker', name: 'Atlas Worker', description: 'Takes one step of the plan', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '' }));
    await page.evaluate(() => window.cc.teams.save({ id: 'e2e-job-team', name: 'Atlas Squad', description: 'Plans, splits and delivers a small web task', slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator' }));
    await page.getByTestId('nav-agents').click();

    const demo = await createDemoVideo(page);
    await demo.flash();

    // --- 01 Open a new schedule ---
    await demo.section({ number: 1, title: 'Run a Squad on a schedule', subtitle: 'Scheduler → New schedule', hint: 'No one at the keyboard' });
    await demo.say('clock');
    await tap(page, page.locator('.nav-item').filter({ hasText: 'Scheduler' }).first());
    await tap(page, page.locator('button', { hasText: 'New schedule' }).first());
    const editor = page.getByTestId('schedule-editor');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.locator('#sched-name').fill('Weekly Atlas site build');

    // --- 02 Run as Squad ---
    await demo.section({ number: 2, title: 'Run as Squad', subtitle: 'Squad, Project, Squad planning', hint: 'Choose what runs, and where' });
    await demo.say('runas');
    await pick(page, editor.getByRole('button', { name: 'Run as', exact: true }), 'Run as', 'Squad');
    await pick(page, editor.getByRole('button', { name: 'Squad', exact: true }), 'Squad', 'Atlas Squad');
    await pick(page, editor.getByRole('button', { name: 'Project', exact: true }), 'Project', ctx.projectName);
    await pick(page, editor.getByRole('button', { name: 'Squad planning', exact: true }), 'Squad planning', 'Plan provided in goal');

    // --- 03 The prompt ---
    await demo.section({ number: 3, title: 'The prompt is the goal and the plan', subtitle: 'Initial prompt', hint: 'Schedules skip Launch approval' });
    await demo.say('prompt');
    const prompt = editor.locator('#sched-prompt');
    await tap(page, prompt);
    await prompt.fill(PLAN_MD);
    await prompt.evaluate((el) => { el.scrollTop = 0; });
    await demo.settle();

    // --- 04 Cadence ---
    await demo.section({ number: 4, title: 'Cadence', subtitle: 'Interval or cron', hint: 'Every 24h, or a cron expression' });
    await demo.say('cadence');
    await tap(page, editor.locator('#sched-every'));
    await editor.locator('#sched-every').fill('24h');
    await tap(page, editor.locator('[role="tab"]', { hasText: 'Cron' }));
    await page.waitForTimeout(900);
    await tap(page, editor.locator('[role="tab"]', { hasText: 'Interval' }));

    // --- 05 Inbox notifications ---
    await demo.section({ number: 5, title: 'Inbox notifications', subtitle: 'Silent, Quiet or Notify', hint: 'How loud each run is' });
    await tap(page, editor.getByText('Notify', { exact: true }));
    await demo.say('inbox');
    await tap(page, editor.locator('button', { hasText: 'Create schedule' }));
    await expect(editor).toHaveAttribute('aria-label', 'Edit schedule', { timeout: 15_000 });

    // --- 06 Run now ---
    await demo.section({ number: 6, title: 'Run now', subtitle: 'Try it once', hint: 'It shows on the Agents board' });
    const panel = page.getByTestId('schedule-info-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const runNow = panel.getByRole('button', { name: 'Run now', exact: true });
    await expect(runNow).toBeEnabled({ timeout: 15_000 });
    await demo.say('runnow');
    await tap(page, runNow);
    await demo.settle();
    await tap(page, page.getByTestId('nav-agents'));
    await expect(page.locator('.agent-card').filter({ hasText: /Atlas|Weekly/ }).first()).toBeVisible({ timeout: 60_000 });
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
