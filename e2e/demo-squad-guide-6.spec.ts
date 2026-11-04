/**
 * Demo recording (not a regression test): Squad guide 6, "Attach files and run in the right place".
 * See docs/media/squad-guide-README.md for the record command.
 *
 * No model is called: the Squad's agents are the deterministic fake coordinator (e2e/sdk/harness.ts).
 * The project is a real git repository so the Squad's worktree isolation really creates a worktree.
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, launchJobTeamCliOwner, teardownJobTeam } from './sdk/job-team-scenario.js';
import { stubRecordedOpenDialog } from './sdk/native-dialog.js';
import { createDemoVideo } from './sdk/demo-video.js';
import { parseRecordSize } from './sdk/demo-video-core.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

const GOAL = 'Build the Atlas site exactly as the attached plan describes. The notes are background only.';
const PLAN = '.zcc/library/runbooks/atlas-plan.md';
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

test('demo: attach files and run in the right place', async ({ app }) => {
  const page = app.window;
  const ctx = createJobTeamContext(app, { tmpPrefix: 'atlas-site-', scenario: 'unattended' });
  try {
    await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));

    // A real repository with a commit, so worktree isolation has something to branch from.
    const git = (...args: string[]) => execFileSync('git', args, { cwd: ctx.projectDir });
    mkdirSync(join(ctx.projectDir, '.zcc/library/runbooks'), { recursive: true });
    writeFileSync(join(ctx.projectDir, 'README.md'), 'Atlas site\n');
    writeFileSync(join(ctx.projectDir, '.gitignore'), '.fake-coordinator.log\n.zcc/\n');
    writeFileSync(join(ctx.projectDir, PLAN), PLAN_MD);
    git('init', '-b', 'main');
    git('add', 'README.md', '.gitignore');
    git('-c', 'user.name=Atlas', '-c', 'user.email=atlas@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Atlas site');
    writeFileSync(join(app.home, 'atlas-notes.md'), '# Notes\n\nKeep the contact page short.\n');

    await page.addStyleTag({ content: '.statusbar { display: none !important; } [data-testid="launch-modal"] { zoom: 1.3; }' });
    await page.evaluate(() => {
      const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
      dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:2147483647;pointer-events:none;';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    });
    await page.evaluate(() => {
      const hide = () => document.querySelectorAll('[data-testid="launch-modal"] *').forEach((el) => {
        if (el.children.length === 0 && /Real Claude is disabled|exited with code/.test(el.textContent ?? '')) {
          (el.closest('[role="alert"], [class*="error"], [class*="warning"], [class*="status"]') as HTMLElement | null ?? el as HTMLElement).style.display = 'none';
        }
      });
      new MutationObserver(hide).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    const beat = (ms: number) => page.waitForTimeout(ms);

    // Seed (trimmed away): register the project via the shared owner launch, close the owner, then
    // give the Squad a friendly name with Worktree isolation On and the default "Keep worktree".
    await launchJobTeamCliOwner(ctx, { workerQuantity: 2, prompt: 'E2E hello', orchestratorExtra: { deniedTools: ['Write', 'Edit'] } });
    const owner = page.getByRole('dialog', { name: /^Agent / }).first();
    if (await owner.count()) { await owner.getByRole('button', { name: 'Close' }).click(); await expect(owner).toBeHidden(); }
    await page.evaluate(() => window.cc.personas.save({ id: 'e2e-orchestrator', name: 'Atlas Orchestrator', description: 'Plans and keeps the run moving', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '', deniedTools: ['Write', 'Edit'] }));
    await page.evaluate(() => window.cc.personas.save({ id: 'e2e-worker', name: 'Atlas Worker', description: 'Takes one step of the plan', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '' }));
    await page.evaluate(() => window.cc.teams.save({ id: 'e2e-job-team', name: 'Atlas Squad', description: 'Plans, splits and delivers a small web task', slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator', worktreeIsolation: true }));
    await stubRecordedOpenDialog(app.electron, [[join(ctx.projectDir, PLAN)], [join(app.home, 'atlas-notes.md')]]);
    await page.getByTestId('nav-agents').click();
    await expect(page.getByTestId('agents-board-new-thread').first()).toBeVisible();

    const demo = await createDemoVideo(page);
    await demo.flash();

    // --- 01 Attach sources ---
    await demo.section({ number: 1, title: 'Attach sources', subtitle: 'Squad composer → Attach sources', hint: 'Files the Squad works from' });
    await tap(page, page.getByTestId('agents-board-new-thread').first());
    const modal = page.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    await tap(page, modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }));
    await pick(page, modal.getByLabel('Squad', { exact: true }), 'Squad', 'Atlas Squad');
    await pick(page, modal.getByLabel('Squad planning'), 'Squad planning', 'Plan provided in goal');
    await pick(page, modal.getByRole('button', { name: 'Machine and project', exact: true }), 'Machine and project', ctx.projectName);
    const goal = modal.getByTestId('team-command-input');
    await tap(page, goal);
    await goal.fill(GOAL);
    const projectPicker = modal.getByRole('button', { name: 'Machine and project', exact: true });
    await expect(projectPicker).toContainText(ctx.projectName);
    await demo.say('attach');
    await tap(page, modal.getByLabel('Attach sources'));
    await expect(projectPicker, 'project stays selected after attaching').toContainText(ctx.projectName);
    const chips = modal.getByLabel('Attached sources');
    await expect(chips.getByText('atlas-plan.md')).toBeVisible();
    await demo.settle();

    // --- 02 Outside the Project ---
    await demo.section({ number: 2, title: 'Where sources can come from', subtitle: 'Project, home folder or clone root', hint: 'Captured at Launch' });
    await tap(page, modal.getByLabel('Attach sources'));
    await expect(chips.getByText('atlas-notes.md')).toBeVisible();
    await demo.say('outside');
    await demo.settle();
    await demo.say('captured');
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await beat(600);
    await tap(page, send);
    await expect(modal).toBeHidden();
    await expect(page.getByText('Squad launched', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await demo.settle();

    // --- 03 Worktree isolation ---
    await demo.section({ number: 3, title: 'Worktree isolation', subtitle: 'Settings → Squads → Atlas Squad', hint: 'On, Off or Use default' });
    await tap(page, page.getByRole('link', { name: 'Settings', exact: true }));
    await tap(page, page.getByTestId('settings-nav-squads'));
    await tap(page, page.getByRole('tab', { name: /^User/ }));
    await tap(page, page.getByRole('button', { name: 'Open Atlas Squad' }));
    const isolation = page.getByTestId('team-worktree-isolation');
    await isolation.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await beat(700);
    await demo.say('isolation');
    await tap(page, isolation);
    await beat(900);
    await tap(page, isolation); // toggles the list closed; Escape would close the whole editor
    await demo.settle();

    // --- 04 When a run finishes ---
    await demo.section({ number: 4, title: 'When a run finishes', subtitle: 'Keep, merge, or delete the worktree', hint: 'Failed or stopped runs are kept' });
    const finish = page.getByTestId('team-worktree-on-complete');
    await finish.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await beat(700);
    await tap(page, finish);
    await demo.say('finish');
    await demo.settle();
    await tap(page, finish);
    await page.keyboard.press('Escape');

    // --- 05 Kept worktree ---
    await demo.section({ number: 5, title: 'A kept worktree', subtitle: 'Agents → Squad details', hint: 'Path and branch' });
    await tap(page, page.locator('.settings-app-back'));
    await tap(page, page.getByTestId('nav-agents'));
    await tap(page, page.locator('.agent-card').filter({ hasText: /Build the Atlas site/ }).first());
    const details = page.getByLabel('Squad details');
    await expect(details.getByText('Loading Squad details…')).toHaveCount(0, { timeout: 15_000 });
    const kept = page.getByLabel('Retained Squad worktree');
    await expect(kept).toBeVisible({ timeout: 120_000 });
    await kept.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await demo.say('kept');
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
