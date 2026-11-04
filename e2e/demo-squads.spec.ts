/**
 * Demo recording (not a regression test): asking an agent to set up a Squad, building one by hand,
 * then running it.
 *
 *   ZCC_E2E_RECORD_VIDEO=$PWD/e2e/.artifacts/demo-squads pnpm test:e2e -- e2e/demo-squads.spec.ts
 *
 * With ZCC_DEMO_NARRATION (docs/media/squads/audio-neural/durations.json) each caption is held
 * until its spoken line ends, and ZCC_DEMO_TIMELINE receives caption offsets from the black flash
 * for docs/media/squads/render.py --mix.
 *
 * Built-in personas, the real Squads editor and composer. No model is called: the Squad's agents
 * are the deterministic fake coordinator (e2e/sdk/harness.ts), and the agent asked to set one up is
 * the fake ACP agent on `opencode`, playing FAKE_ACP_SCRIPT through a real client file write.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

const fixtureBin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');
const REQUEST = 'Set up a Docs Squad for atlas-site: an orchestrator, two engineers and a reviewer.';
const DOCS_SQUAD = {
  id: 'docs-squad', name: 'Docs Squad', icon: 'BookOpen', description: 'Keeps the docs in step with the code',
  orchestratorPersonaId: 'builtin:orchestrator',
  slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }, { personaId: 'builtin:software-engineer', quantity: 2 }, { personaId: 'builtin:reviewer', quantity: 1 }]
};
// The agent's scripted reply; the fake reads it when a prompt names the Docs Squad.
const scriptDir = mkdtempSync(join(tmpdir(), 'zcc-demo-squads-script-'));
const script = join(scriptDir, 'script.json');
writeFileSync(script, JSON.stringify({ match: 'Docs Squad', steps: [
  { pause: 900 },
  { say: 'Sure. I\'ll add a project Squad for atlas-site: an Orchestrator to plan, two Software Engineers, and a Code Reviewer. ', wordMs: 45 },
  { pause: 700 },
  { write: { path: '.zcc/teams/docs-squad.json', content: `${JSON.stringify(DOCS_SQUAD, null, 2)}\n`, title: 'Write .zcc/teams/docs-squad.json' } },
  { pause: 500 },
  { say: 'Done. **Docs Squad** is saved in `.zcc/teams/docs-squad.json`, so it is in Settings → Squads, ready to launch.', wordMs: 45 }
] }));

test.use({
  e2e: true,
  initialConfig: { sponsorPromptDismissed: true, teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false, harnessOpenCodeEnabled: true },
  launchEnv: {
    PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`, FAKE_ACP_MODE_CONFIG: '1', FAKE_ACP_SCRIPT: script,
    // Under xvfb the hidden E2E window is throttled to about one frame a second, and every
    // pointer step waits for a frame, so the tour can't finish in time. Show it on Linux.
    ...(process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {})
  }
});
test.setTimeout(240_000);

const NARRATION: Array<{ caption: string; ms: number }> = process.env.ZCC_DEMO_NARRATION
  ? JSON.parse(readFileSync(process.env.ZCC_DEMO_NARRATION, 'utf8'))
  : [];
const GOAL = 'Build the Atlas site: a Home page and an About page, with a shared navigation label.';

async function tap(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  // Hidden Linux windows can throttle each animated move to one frame per second.
  // The visible cursor animation is needed only for a demo recording.
  if (box && process.env.ZCC_E2E_RECORD_VIDEO) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await page.waitForTimeout(120);
  await target.click();
}

async function pick(page: Page, picker: Locator, listbox: string, option: string): Promise<void> {
  await tap(page, picker);
  await page.waitForTimeout(250);
  await tap(page, page.getByRole('listbox', { name: listbox }).getByRole('option', { name: new RegExp(`${listbox === 'Machine and project' ? '› ' : '^'}${option.replace(/[()]/g, '\\$&')}(?:\\s|$)`) }).first());
}

test('demo: define and launch a Squad', async ({ app }) => {
  const page = app.window;
  const agent = makeJobTeamCoordinatorBinary();
  const parent = mkdtempSync(join(tmpdir(), 'zcc-demo-squads-'));
  const projectDir = join(parent, 'atlas-site');
  // The project already has a .zcc folder; Squads in .zcc/teams are picked up as they appear.
  mkdirSync(join(projectDir, '.zcc', 'teams'), { recursive: true });

  try {
    await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await page.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, codexBinary: bin,
      trustZccToolsEnabled: false, tmuxScope: 'off', defaultHarness: 'claude', opencodeBinary: undefined
    }), agent.path);
    await page.evaluate(async (path) => {
      const added = await window.cc.projects.add(path);
      if (!added.ok) throw Error(added.message);
    }, projectDir);
    // The status bar shows the throwaway E2E home path.
    await page.addStyleTag({ content: '.statusbar { display: none !important; }' });

    const beat = (ms: number) => page.waitForTimeout(ms);
    const timeline: Array<{ text: string; at: number }> = [];
    let flashAt = 0;
    // Hold the previous caption until its narration has finished, with a short breath.
    const settle = async () => {
      const last = timeline.at(-1);
      const spoken = last ? NARRATION[timeline.length - 1]?.ms ?? 0 : 0;
      const remaining = last ? flashAt + last.at + spoken + 300 - Date.now() : 0;
      if (remaining > 0) await page.waitForTimeout(remaining);
    };
    const caption = async (text: string) => {
      await settle();
      const expected = NARRATION[timeline.length]?.caption;
      if (NARRATION.length && expected !== text) throw new Error(`caption ${timeline.length} is "${text}", narration expects "${expected}"`);
      timeline.push({ text, at: Date.now() - flashAt });
      await showCaption(text);
    };
    const showCaption = (text: string) => page.evaluate((value) => {
      let node = document.getElementById('e2e-caption');
      if (!node) {
        node = Object.assign(document.createElement('div'), { id: 'e2e-caption' });
        node.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:99999;padding:10px 18px;border-radius:10px;background:rgba(20,24,33,.92);color:#fff;font:600 17px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(120,160,255,.6);pointer-events:none;max-width:80vw;text-align:center';
        document.body.appendChild(node);
      }
      node.textContent = value;
    }, text);
    // A visible pointer, since the recording has no OS cursor.
    await page.evaluate(() => {
      const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
      dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:100001;pointer-events:none;transition:transform .12s';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
      addEventListener('mousedown', () => { dot.style.transform = 'scale(.6)'; }, true);
      addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
    });

    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByTestId('settings-nav-squads').click();
    await expect(page.getByRole('button', { name: 'Open Review Squad' })).toBeVisible();
    await beat(800);

    // A black flash marks where the trimmed demo starts.
    await page.evaluate(() => {
      const flash = Object.assign(document.createElement('div'), { id: 'e2e-flash' });
      flash.style.cssText = 'position:fixed;inset:0;background:#000;z-index:100002';
      document.body.appendChild(flash);
    });
    await beat(600);
    await page.evaluate(() => document.getElementById('e2e-flash')?.remove());
    flashAt = Date.now();

    await caption('Squads: a team of agents that plan, split and deliver work together');
    await beat(2000);

    await caption('Two ways to build one. The quickest: ask an agent');
    await tap(page, page.getByRole('link', { name: 'Back to app' }));
    await tap(page, page.getByTestId('nav-agents'));
    await tap(page, page.getByTestId('agents-board-new-thread').first());
    const launcher = page.getByTestId('launch-modal');
    await expect(launcher).toBeVisible();
    await tap(page, launcher.locator('.launch-segmented').getByRole('button', { name: /^Modern/ }));
    const harness = launcher.getByTestId('model-reasoning-picker-trigger');
    await tap(page, harness);
    await tap(page, page.getByTestId('model-reasoning-provider-acp-opencode'));
    await tap(page, harness);
    await pick(page, launcher.getByRole('button', { name: 'Machine and project', exact: true }), 'Machine and project', 'atlas-site');
    const request = launcher.locator('textarea, [contenteditable="true"]').first();
    await request.click();
    await request.pressSequentially(REQUEST, { delay: 28 });
    await beat(400);
    await tap(page, launcher.getByRole('button', { name: 'Send', exact: true }));
    await expect(launcher).toBeHidden();

    await caption('The agent writes the squad into your project');
    await expect.poll(() => existsSync(join(projectDir, '.zcc', 'teams', 'docs-squad.json')), { timeout: 30_000 }).toBe(true);
    // Unfold the finished turn: the agent's plan and the file it wrote.
    await expect(page.getByText(/ready to launch\.$/)).toBeVisible({ timeout: 15_000 });
    await beat(400);
    await tap(page, page.getByText(/^Worked for/).first());
    await tap(page, page.getByRole('button', { name: /^Edited \d+ files?$/ }).first());
    await beat(1600);

    await caption('It shows up in Settings → Squads, ready to launch');
    await tap(page, page.getByRole('link', { name: 'Settings', exact: true }));
    await tap(page, page.getByTestId('settings-nav-squads'));
    await expect(page.getByText('Project · atlas-site')).toBeVisible({ timeout: 15_000 });
    await tap(page, page.getByRole('button', { name: 'Expand Docs Squad to see agents' }));
    await beat(2200);

    await caption('Or build it yourself: New squad');
    await tap(page, page.getByRole('button', { name: 'New squad' }));
    const editor = page.getByRole('dialog', { name: 'New squad' });
    await expect(editor).toBeVisible();
    await editor.getByLabel('Name', { exact: true }).pressSequentially('Web Squad', { delay: 55 });
    await tap(page, editor.getByLabel('Icon MonitorSmartphone'));
    await editor.getByLabel('Description').click();
    await editor.getByLabel('Description').pressSequentially('Ships small web features end to end', { delay: 30 });
    await beat(500);

    await caption('Add one slot per role, each backed by a persona');
    const addSlot = editor.getByRole('button', { name: 'Add slot' });
    const slotPersona = editor.getByLabel('Slot persona');
    await tap(page, addSlot);
    await pick(page, slotPersona.nth(0), 'Slot persona', 'Orchestrator');
    await tap(page, addSlot);
    await pick(page, slotPersona.nth(1), 'Slot persona', 'Squad Worker (Medium)');
    await editor.getByLabel('Tab count').nth(1).fill('2');
    await tap(page, addSlot);
    await pick(page, slotPersona.nth(2), 'Slot persona', 'Code Reviewer');
    await beat(600);

    await caption('Crown the orchestrator: it starts first, plans and delegates');
    await tap(page, editor.getByLabel('Mark as orchestrator').nth(0));
    await beat(1400);

    await caption('Optional: opening prompt, default project, worktree and launch policy');
    await editor.getByLabel('Opening prompt').click();
    await editor.getByLabel('Opening prompt').pressSequentially('Plan the work, split it across workers, then have the reviewer check it.', { delay: 18 });
    await editor.locator('.modal-body').evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' }));
    await beat(1800);
    await tap(page, editor.getByRole('button', { name: 'Save', exact: true }));
    await expect(editor).toBeHidden();

    await caption('Saved: your squad is in the catalogue, ready to launch');
    await tap(page, page.getByRole('button', { name: 'Expand Web Squad to see agents' }));
    await beat(2000);

    await caption('Launch: New agent → Squad, then describe the goal');
    await tap(page, page.getByRole('link', { name: 'Back to app' }));
    await tap(page, page.getByTestId('nav-agents'));
    await tap(page, page.getByTestId('agents-board-new-thread').first());
    const modal = page.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    await tap(page, modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }));
    const goal = modal.getByTestId('team-command-input');
    await goal.click();
    await goal.pressSequentially(GOAL, { delay: 5 });
    await pick(page, modal.getByLabel('Squad', { exact: true }), 'Squad', 'Web Squad');
    await pick(page, modal.getByRole('button', { name: 'Machine and project', exact: true }), 'Machine and project', 'atlas-site');
    await expect(modal.getByLabel('Squad planning')).toContainText('Infer plan from goal');
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await tap(page, send);
    await expect(modal).toBeHidden();

    await caption('The orchestrator plans; workers pick up tasks in parallel');
    const card = page.locator('.agent-card').filter({ hasText: /Atlas/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await beat(600);
    await caption('Flow view shows who is working and how work hands off');
    await tap(page, page.getByRole('button', { name: 'Flow view' }));
    await expect(page.locator('svg.squad-flow-edges path.squad-flow-edge').first()).toBeVisible({ timeout: 30_000 });
    await beat(2600);
    await tap(page, page.getByRole('button', { name: 'Board view' }));

    await caption('When the squad needs a decision, it asks you in the Inbox');
    await expect.poll(() => page.evaluate(async () => {
      for (const project of await window.cc.projects.list()) {
        const board = await window.cc.executionBoard.listProject(project.id);
        const blocked = board.executions.find((execution) => execution.currentBlocker?.question);
        if (blocked) return blocked.currentBlocker!.question;
      }
      return '';
    }), { timeout: 60_000, intervals: [500] }).toContain('label');
    await tap(page, page.getByTestId('nav-inbox'));
    const pinned = page.locator('.inbox-questions-pinned');
    await expect(pinned.getByText('Needs your answer', { exact: true })).toBeVisible({ timeout: 15_000 });
    await tap(page, pinned.getByText(/Atlas/).first());
    const question = page.locator('.inbox-question');
    await expect(question).toContainText('Which label should result.txt use?');
    await beat(1200);
    await tap(page, question.getByRole('radio', { name: /About Atlas/i }));
    await tap(page, question.getByRole('button', { name: /^(Continue|Reopen & answer)$/ }));

    await caption('Answer once, and the squad finishes the job');
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 60_000 }).toBe(true);
    await tap(page, page.getByTestId('nav-agents'));
    await tap(page, page.locator('.agent-card').filter({ hasText: /Atlas/ }).first());
    await expect(page.getByLabel('Squad details').getByText('4/4 complete', { exact: false })).toBeVisible({ timeout: 30_000 });
    await caption('Squads: ask an agent or build it yourself, then launch it for any goal');
    await beat(1200);
    await settle();
    await beat(400);
    if (process.env.ZCC_DEMO_TIMELINE) writeFileSync(process.env.ZCC_DEMO_TIMELINE, JSON.stringify(timeline, null, 2));
  } finally {
    await page.evaluate(async () => {
      for (const project of await window.cc.projects.list()) {
        for (const session of await window.cc.terminals.list(project.id)) await window.cc.terminals.close(session.id).catch(() => {});
      }
    }).catch(() => {});
    rmSync(parent, { recursive: true, force: true });
    rmSync(scriptDir, { recursive: true, force: true });
    agent.cleanup();
  }
});
