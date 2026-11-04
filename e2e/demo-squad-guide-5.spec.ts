/**
 * Demo recording (not a regression test): Squad guide 5, "Start a Squad from a conversation".
 * See docs/media/squad-guide-README.md for the record command.
 *
 * No model is called. The conversation is a Modern thread on the fake ACP agent (`opencode`), which
 * plays FAKE_ACP_SCRIPT and calls the real `squad_plan_check` / `squad_launch` tools over the
 * thread's MCP server. The Squad's agents are the deterministic fake coordinator (e2e/sdk/harness.ts).
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { createDemoVideo } from './sdk/demo-video.js';
import { parseRecordSize } from './sdk/demo-video-core.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

const fixtureBin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');
const TITLE = 'Atlas site build';
const NOW_TITLE = 'Atlas site build (run now)';
const DESIGN = '.zcc/library/designs/atlas-design.md';
const PLAN = '.zcc/library/runbooks/atlas-plan.md';
const GOAL = 'Build the Atlas site exactly as the attached plan describes.';
const ASK = 'Use the Atlas Squad to build the site from the plan in .zcc/library/runbooks/atlas-plan.md, and prepare the launch for me to review.';
const ASK_NOW = 'The plan is solid. Run the Atlas Squad on it now, and skip the Inbox.';
// Step ids match the fake cohort's scripted plan.
const PLAN_MD = [
  '# Atlas Plan', '',
  '### home: Write Home <!-- executable-step -->', '- **Work:** Create home.txt containing HOME: ready', '- **Depends on:** None', '- **Write scope:** `home.txt`', '- **Verification:** home.txt present', '',
  '### about: Write About <!-- executable-step -->', '- **Work:** Create about.txt containing ABOUT: ready', '- **Depends on:** None', '- **Write scope:** `about.txt`', '- **Verification:** about.txt present', '',
  '### navigation-label: Ask Navigation Label <!-- executable-step -->', '- **Work:** Raise a durable human question with two label choices', '- **Depends on:** home, about', '- **Mode:** read-only', '- **Verification:** durable question answered', '',
  '### assemble: Assemble Result <!-- executable-step -->', '- **Work:** Write result.txt from both worker outputs and the chosen label', '- **Depends on:** navigation-label', '- **Write scope:** `result.txt`', '- **Verification:** cat result.txt', ''
].join('\n');

// The agent's scripted reply; each prompt gets its own, written just before it is sent. A match is a phrase
// only that request contains, so the Squad's later reports to the thread never replay it.
const scriptDir = mkdtempSync(join(tmpdir(), 'zcc-demo-guide5-script-'));
const script = join(scriptDir, 'script.json');
const reply = (match: string, steps: unknown[]) => writeFileSync(script, JSON.stringify({ match, steps }));

test.use({
  e2e: true,
  initialConfig: { theme: 'light', sponsorPromptDismissed: true, teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false, harnessOpenCodeEnabled: true },
  launchEnv: {
    PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`, FAKE_ACP_MODE_CONFIG: '1', FAKE_ACP_MODEL_CONFIG: '1', FAKE_ACP_SCRIPT: script, FAKE_ACP_HTTP_MCP: '1',
    ...(process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {})
  }
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

test('demo: start a Squad from a conversation', async ({ app }) => {
  const page = app.window;
  const agent = makeJobTeamCoordinatorBinary();
  const parent = mkdtempSync(join(tmpdir(), 'zcc-demo-guide5-'));
  const projectDir = join(parent, 'atlas-site');
  mkdirSync(join(projectDir, '.zcc/library/designs'), { recursive: true });
  mkdirSync(join(projectDir, '.zcc/library/runbooks'), { recursive: true });
  writeFileSync(join(projectDir, DESIGN), '# Atlas design\n\nA two-page site with a navigation label chosen by the owner.\n');
  writeFileSync(join(projectDir, PLAN), PLAN_MD);
  try {
    await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));
    await page.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, codexBinary: bin,
      trustZccToolsEnabled: false, tmuxScope: 'off', defaultHarness: 'claude', opencodeBinary: undefined
    }), agent.path);
    // Friendly names for the on-screen Squad (ids stay).
    await page.evaluate(() => window.cc.personas.save({ id: 'e2e-orchestrator', name: 'Atlas Orchestrator', description: 'Plans and keeps the run moving', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '', deniedTools: ['Write', 'Edit'] }));
    await page.evaluate(() => window.cc.personas.save({ id: 'e2e-worker', name: 'Atlas Worker', description: 'Takes one step of the plan', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '' }));
    await page.evaluate(() => window.cc.teams.save({ id: 'e2e-job-team', name: 'Atlas Squad', description: 'Plans, splits and delivers a small web task', slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator', defaultPlanning: 'provided' }));
    await page.evaluate(async (path) => {
      const added = await window.cc.projects.add(path);
      if (!added.ok) throw Error(added.message);
      return added.value.id;
    }, projectDir);
    await page.addStyleTag({ content: '.statusbar { display: none !important; } [data-testid="launch-modal"] { zoom: 1.3; } [data-testid="launch-modal"] .conversation-history { display: none !important; }' });
    await page.evaluate(() => {
      const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
      dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:2147483647;pointer-events:none;';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    });

    // Seed (trimmed away): pick OpenCode once, so the launcher opens on it and does not reflow on camera.
    const home = new URL(page.url()).pathname;
    await page.getByTestId('nav-agents').click();
    await page.getByTestId('agents-board-new-thread').first().click();
    const setup = page.getByTestId('launch-modal');
    await setup.locator('.launch-segmented').getByRole('button', { name: /^Modern/ }).click();
    await setup.getByTestId('model-reasoning-picker-trigger').click();
    await page.getByTestId('model-reasoning-provider-acp-opencode').click();
    await expect(page.getByTestId('model-reasoning-provider-acp-opencode')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    // Escape closes the popover; clicking the backdrop closes the launcher.
    await page.mouse.click(1700, 900);
    await expect(setup).toBeHidden({ timeout: 10_000 });
    await page.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, home);
    await page.getByTestId('nav-agents').click();

    const demo = await createDemoVideo(page);
    await demo.flash();

    // --- 01 Ask an agent ---
    await demo.section({ number: 1, title: 'Ask an agent', subtitle: 'Any conversation, any agent', hint: 'Point it at your plan' });
    reply('prepare the launch for me to review', [
      { pause: 800 },
      { say: 'I will check the plan first. ', wordMs: 40 },
      { tool: { name: 'squad_plan_check', arguments: { path: PLAN } } },
      { say: 'It is valid, with 4 steps. Preparing the launch now. ', wordMs: 40 },
      { tool: { name: 'squad_launch', arguments: { teamId: 'e2e-job-team', goal: GOAL, planning: 'provided', sources: [DESIGN, PLAN], title: TITLE, mode: 'review', summary: 'Two pages, a navigation label, one assembled result.' } } },
      { pause: 300 },
      { say: 'The launch is ready in your Inbox. Nothing starts until you press Launch.', wordMs: 40 }
    ]);
    await demo.say('ask');
    await tap(page, page.getByTestId('agents-board-new-thread').first());
    const launcher = page.getByTestId('launch-modal');
    await expect(launcher).toBeVisible();
    await tap(page, launcher.locator('.launch-segmented').getByRole('button', { name: /^Modern/ }));
    await pick(page, launcher.getByRole('button', { name: 'Machine and project', exact: true }), 'Machine and project', 'atlas-site');
    const request = launcher.locator('textarea, [contenteditable="true"]').first();
    await request.click();
    await request.pressSequentially(ASK, { delay: 16 });
    await page.waitForTimeout(400);
    await tap(page, launcher.getByRole('button', { name: 'Send', exact: true }));
    await expect(launcher).toBeHidden();
    await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(/\/threads\/[^/]+$/);
    const threadPath = new URL(page.url()).pathname;
    await demo.say('prepares');
    await expect(page.getByText(/Nothing starts until you press Launch\.$/).first()).toBeVisible({ timeout: 60_000 });
    await demo.settle();

    // --- 02 The Inbox card ---
    await demo.section({ number: 2, title: 'The Inbox card', subtitle: 'Inbox → Squad launch ready', hint: 'Nothing starts yet' });
    await tap(page, page.getByTestId('nav-inbox'));
    const proposal = page.locator('.inbox-row').filter({ hasText: `Squad launch ready: ${TITLE}` }).first();
    await expect(proposal).toBeVisible({ timeout: 30_000 });
    await tap(page, proposal);
    await expect(page.locator('.inbox-detail').getByText('atlas-plan.md').first()).toBeVisible();
    await demo.say('card');
    await demo.settle();

    // --- 03 Review and launch ---
    await demo.section({ number: 3, title: 'Review and launch', subtitle: 'Review Squad launch → Launch', hint: 'Prefilled composer' });
    await tap(page, page.getByRole('button', { name: 'Review Squad launch' }));
    const modal = page.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.team-composer-origin-banner')).toContainText('Plan checked: 4 steps.');
    await demo.say('review');
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await demo.settle();
    // The Squad's first report reaches the thread; give it a scripted reply.
    reply('[Squad report]', [{ pause: 600 }, { say: 'The Squad has a question. It is waiting for your answer in the Inbox.', wordMs: 40 }]);
    await tap(page, send);
    await expect(modal).toBeHidden();

    // --- 04 Where it goes ---
    await demo.section({ number: 4, title: 'Where it goes', subtitle: 'Squad details, and the conversation', hint: 'Reports come back' });
    await tap(page, page.getByTestId('nav-agents'));
    await tap(page, page.locator('.agent-card').filter({ hasText: TITLE }).first());
    const details = page.getByLabel('Squad details');
    await expect(details.getByText('Loading Squad details…')).toHaveCount(0, { timeout: 15_000 });
    await expect(details.getByText('Started from', { exact: true })).toBeVisible();
    await demo.say('report');
    await page.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, threadPath);
    await expect(page.getByText(/waiting for your answer in the Inbox\.$/).first()).toBeVisible({ timeout: 90_000 });
    await demo.settle();

    // --- 05 Run now ---
    await demo.section({ number: 5, title: 'Run now', subtitle: 'Skip the Inbox card', hint: 'Starts straight away' });
    reply('Run the Atlas Squad on it now', [
      { pause: 700 },
      { say: 'Starting the Atlas Squad now. ', wordMs: 40 },
      { tool: { name: 'squad_launch', arguments: { teamId: 'e2e-job-team', goal: GOAL, planning: 'provided', sources: [DESIGN, PLAN], title: NOW_TITLE, mode: 'now' } } },
      { pause: 300 },
      { say: 'It is running. I will report back when it needs an answer or finishes.', wordMs: 40 }
    ]);
    await demo.say('now');
    const input = page.getByTestId('thread-command-input');
    await tap(page, input);
    await input.pressSequentially(ASK_NOW, { delay: 16 });
    await tap(page, page.getByTestId('thread-command-send'));
    await expect(page.getByText(/report back when it needs an answer or finishes\.$/).first()).toBeVisible({ timeout: 60_000 });
    // The new run's own report reaches the thread next; give it a scripted reply, not an echo.
    reply('[Squad report]', [{ pause: 400 }, { say: 'The new Squad needs an answer too. It is in your Inbox.', wordMs: 40 }]);
    await demo.settle();
    await tap(page, page.getByTestId('nav-agents'));
    await expect(page.locator('.agent-card').filter({ hasText: NOW_TITLE }).first()).toBeVisible({ timeout: 30_000 });
    await demo.say('close');
    await demo.finish();
  } finally {
    await page.evaluate(async () => {
      for (const project of await window.cc.projects.list()) {
        for (const session of await window.cc.terminals.list(project.id)) await window.cc.terminals.close(session.id).catch(() => {});
      }
    }).catch(() => {});
    agent.cleanup();
    rmSync(parent, { recursive: true, force: true });
    rmSync(scriptDir, { recursive: true, force: true });
  }
});
