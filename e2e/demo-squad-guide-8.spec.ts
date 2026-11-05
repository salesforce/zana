/**
 * Demo recording (not a regression test): Squad guide 8, "Run a Goal as a Squad".
 * See docs/media/squad-guide-README.md for the record command.
 *
 * No model is called: the Squad's agents are the deterministic fake coordinator (e2e/sdk/harness.ts).
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, launchJobTeamCliOwner, teardownJobTeam } from './sdk/job-team-scenario.js';
import { createDemoVideo } from './sdk/demo-video.js';
import { parseRecordSize } from './sdk/demo-video-core.js';
import type { Locator, Page } from '@playwright/test';

const TITLE = 'Atlas site build';
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
  initialConfig: { theme: 'light', sponsorPromptDismissed: true, teamJobLaunchEnabled: true, goalsEnabled: true, autoRenameTabs: false },
  launchEnv: { ZCC_FAKE_EVALUATOR_VERDICT: 'pass', ...(process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}) }
});
test.setTimeout(360_000);
// Demo recording, not a regression test: run it only when recording (see docs/media/squad-guide-README.md).
test.skip(!process.env.ZCC_E2E_RECORD_VIDEO, 'Demo recording only');

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

test('demo: run a Goal as a Squad', async ({ app }) => {
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

    // Seed (trimmed away): an earlier Goal that has already finished, so its Inbox outcome is ready to show.
    const seeded = await page.evaluate(async (input) => window.cc.goals.create({
      projectId: input.projectId, scope: { projectId: input.projectId }, title: input.title, statement: input.statement,
      successCriteria: [], assignment: { kind: 'team', teamId: 'e2e-job-team' }, planSource: 'provided', maxIterations: 3, noProgressLimit: 2
    }), { projectId: ctx.projectId, title: TITLE, statement: PLAN_MD });
    expect(seeded, JSON.stringify(seeded)).toMatchObject({ ok: true });
    const seededId = (seeded as { value: { id: string } }).value.id;
    await page.evaluate((id) => window.cc.goals.setStatus(id, 'active'), seededId);
    await expect.poll(() => page.evaluate(async (id) => (await window.cc.goals.list()).find((g) => g.id === id)?.status, seededId), { timeout: 240_000, intervals: [2_000] }).toMatch(/achieved|exhausted|escalated/);

    // Goals are off by default: switch them off here so the video can show turning them on.
    await page.evaluate(() => window.cc.config.set({ goalsEnabled: false }));
    await page.addStyleTag({ content: '.settings-panel { zoom: 1.3; }' });

    const demo = await createDemoVideo(page);
    await demo.flash();

    // --- 01 A Goal keeps going ---
    await demo.section({ number: 1, title: 'Use a Squad to accomplish a Goal', subtitle: 'Goals → New goal', hint: 'Keeps going until the aim is met' });
    await demo.say('goal');
    await tap(page, page.getByRole('link', { name: 'Settings', exact: true }));
    await tap(page, page.getByTestId('settings-nav-experimental'));
    const goalsSetting = page.getByRole('switch', { name: 'Goals', exact: true });
    await goalsSetting.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await page.waitForTimeout(900);
    await tap(page, goalsSetting);
    await expect(goalsSetting).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(1200);
    await go('/goals');
    await tap(page, page.getByRole('button', { name: 'New goal' }).first());
    const form = page.getByRole('dialog', { name: 'New goal' });
    await expect(form).toBeVisible();
    await form.locator('#goal-title').fill('Atlas site refresh');

    // --- 02 Run as Squad ---
    await demo.section({ number: 2, title: 'Run as Squad', subtitle: 'Plan or prompt, Squad, Project, planning', hint: 'Same choices as a schedule' });
    await demo.say('runas');
    await pick(page, form.getByRole('button', { name: 'Run as', exact: true }), 'Run as', 'Squad');
    const statement = form.locator('#goal-statement');
    await tap(page, statement);
    await statement.fill(PLAN_MD);
    await statement.evaluate((el) => { el.scrollTop = 0; });
    await pick(page, form.getByRole('button', { name: 'Squad', exact: true }), 'Squad', 'Atlas Squad');
    await pick(page, form.getByRole('button', { name: 'Project', exact: true }), 'Project', ctx.projectName);
    await pick(page, form.getByRole('button', { name: 'Squad planning', exact: true }), 'Squad planning', 'Plan provided in goal');

    // --- 03 Limits ---
    await demo.section({ number: 3, title: 'Set the limits', subtitle: 'Max iterations, No-progress limit', hint: 'Safety ceilings' });
    await form.locator('#goal-max').scrollIntoViewIfNeeded();
    await form.locator('#goal-max').fill('3');
    await form.locator('#goal-stall').fill('2');
    await demo.say('limits');
    await tap(page, form.locator('button', { hasText: 'Create goal' }));
    await expect(form).toBeHidden({ timeout: 15_000 });

    // --- 04 Each iteration ---
    await demo.section({ number: 4, title: 'Each iteration is a Squad job', subtitle: 'Judged after every round', hint: 'Go again, or stop' });
    await expect(page.getByText(/Atlas site refresh/).first()).toBeVisible({ timeout: 20_000 });
    await demo.say('iteration');
    await demo.settle();

    // --- 05 The outcome ---
    await demo.section({ number: 5, title: 'The outcome', subtitle: 'Inbox → Goal: Atlas site build', hint: 'One row per Goal' });
    await tap(page, page.getByTestId('nav-inbox'));
    const row = page.locator('.inbox-row').filter({ hasText: `Goal: ${TITLE}` }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await tap(page, row);
    await demo.say('outcome');
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
