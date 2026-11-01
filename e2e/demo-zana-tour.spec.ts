/**
 * Demo recording (not a regression test): a two-minute tour of Zana. Projects, any agent from one
 * composer and its preview, a Squad the agent launches from the thread, then plugins: Agent City from
 * the marketplace, the GUS plugin from a folder, a ticket handed to an agent, an agent adding a
 * Dashboard tab to GUS, sharing it, and the phone.
 *
 *   ZCC_E2E_RECORD_VIDEO=$PWD/e2e/.artifacts/demo-zana-tour pnpm test:e2e -- e2e/demo-zana-tour.spec.ts
 *
 * ZCC_DEMO_NARRATION (docs/media/zana-tour/audio-neural/durations.json) paces the voice-over;
 * ZCC_DEMO_TIMELINE receives line offsets from the black flash for render.py --mix, and zooms.json
 * beside it the regions to zoom on. ZCC_DEMO_THEME=light records the light theme.
 *
 * No model is called. Thread agents are the fake ACP agent on `opencode` playing FAKE_ACP_SCRIPT,
 * which the spec rewrites before each prompt; the Squad is the deterministic fake coordinator.
 * GUS is a copy of the GUS checkout's renderer (GUS_PLUGIN_ROOT, read only) on a sample-data server.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { stubOpenDialog } from './sdk/native-dialog.js';
import { dashboardChange, prepareGusFixture, rebuildGusFixture } from './fixtures/demo-zana-tour/gus-fixture.js';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from '@playwright/test';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureBin = join(here, 'fixtures', 'bin');
const tourFixtures = join(here, 'fixtures', 'demo-zana-tour');
const gusSource = resolve(process.env.GUS_PLUGIN_ROOT || join(here, '..', '..', 'zcc-plugin-gus'));
const GUS_ID = 'gus-demo';

const BUILD_REQUEST = 'Build a pricing page for atlas-site: three plans, with Pro highlighted.';
const DASHBOARD_REQUEST = 'Add a Dashboard tab to our GUS plugin: tickets by status, the sprint countdown, and what is blocked.';
const SQUAD_REQUEST = 'This is bigger than one page. Get the Web Squad to build the whole Atlas site.';
const SHARE_REQUEST = 'Looks great. Share it with the Atlas team.';
const GOAL = 'Build the Atlas site: a Home page and an About page, with a shared navigation label.';
const WEB_SQUAD = {
  id: 'web-squad', name: 'Web Squad', icon: 'MonitorSmartphone', description: 'Ships small web features end to end',
  orchestratorPersonaId: 'builtin:orchestrator',
  slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }, { personaId: 'builtin:squad-worker-medium', quantity: 2 }, { personaId: 'builtin:reviewer', quantity: 1 }]
};
const MOCKUP = readFileSync(join(tourFixtures, 'pricing.html'), 'utf8');

// The "everywhere" beat: a phone frame (fed by the live mobile web app) and the coming Slack app.
const DEVICES = {
  css: `
#e2e-devices { position: fixed; inset: 0; z-index: 99990; display: flex; align-items: center; justify-content: center; gap: 56px;
  background: radial-gradient(circle at 30% 40%, rgba(124, 92, 255, .22), transparent 55%), rgba(8, 10, 20, .86);
  opacity: 0; pointer-events: none; transition: opacity .45s ease; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
#e2e-devices.on { opacity: 1; }
#e2e-devices.light { background: radial-gradient(circle at 30% 40%, rgba(124, 92, 255, .16), transparent 55%), rgba(236, 239, 246, .92); }
#e2e-devices.light .label { color: #3b4256; }
#e2e-devices.light .phone { box-shadow: 0 0 0 2px #c9cedb, 0 30px 80px rgba(30, 41, 80, .28); }
#e2e-devices .phone { width: 312px; height: 660px; border-radius: 52px; padding: 12px; background: #0b0d14;
  box-shadow: 0 0 0 2px #2a2f3d, 0 30px 80px rgba(0, 0, 0, .55); position: relative; transform: translateY(24px) scale(.96);
  transition: transform .6s cubic-bezier(.2, .8, .2, 1); }
#e2e-devices.on .phone { transform: none; }
#e2e-devices .phone::before { content: ''; position: absolute; top: 22px; left: 50%; width: 92px; height: 26px; margin-left: -46px; border-radius: 14px; background: #000; z-index: 2; }
#e2e-devices .phone img { width: 100%; height: 100%; border-radius: 40px; object-fit: cover; object-position: top; background: #11131c; display: block; }
#e2e-devices .label { position: absolute; bottom: -38px; left: 0; right: 0; text-align: center; color: #c9cbe0; font-size: 14px; font-weight: 600; }
#e2e-devices .slack { width: 470px; border-radius: 14px; overflow: hidden; background: #1a1d21; color: #d1d2d3; box-shadow: 0 30px 80px rgba(0, 0, 0, .5);
  opacity: 0; transform: translateX(40px); transition: opacity .5s ease, transform .6s cubic-bezier(.2, .8, .2, 1); position: relative; }
#e2e-devices.slack .slack { opacity: 1; transform: none; }
#e2e-devices .slack header { background: #3f0e40; color: #fff; padding: 12px 16px; font-size: 14px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
#e2e-devices .slack header em { font-style: normal; font-size: 11px; font-weight: 700; color: #3f0e40; background: #ecb22e; border-radius: 999px; padding: 3px 9px; }
#e2e-devices .msg { display: flex; gap: 10px; padding: 12px 16px; font-size: 13.5px; line-height: 1.45; }
#e2e-devices .msg i { flex: none; width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; font-style: normal; font-weight: 700; color: #fff; }
#e2e-devices .msg b { color: #fff; } #e2e-devices .msg small { color: #9a9b9e; margin-left: 6px; font-size: 11px; }
#e2e-devices .msg .app { font-size: 10px; color: #b9babd; background: #2c2d30; border-radius: 3px; padding: 1px 4px; margin-left: 6px; }
#e2e-devices .mention { color: #1d9bd1; background: rgba(29, 155, 209, .14); border-radius: 3px; padding: 0 2px; }
#e2e-devices .reply-msg { opacity: 0; transform: translateY(8px); transition: opacity .4s ease, transform .4s ease; }
#e2e-devices.reply .reply-msg { opacity: 1; transform: none; }
#e2e-devices .kpis { display: flex; gap: 8px; margin-top: 8px; }
#e2e-devices .kpis span { border: 1px solid #35373b; border-radius: 8px; padding: 6px 10px; font-size: 12px; color: #d1d2d3; }
#e2e-devices .kpis strong { display: block; font-size: 17px; color: #fff; }
#e2e-devices .btn { display: inline-block; margin-top: 10px; border: 1px solid #5a5c60; border-radius: 6px; padding: 5px 12px; font-size: 12.5px; font-weight: 700; color: #fff; }
#e2e-devices .composer { margin: 6px 16px 16px; border: 1px solid #45474b; border-radius: 8px; padding: 10px 12px; color: #8a8b8e; font-size: 13px; }
`,
  html: `<div id="e2e-devices">
  <div class="phone"><img id="e2e-phone-screen" alt=""><div class="label">Zana on your phone</div></div>
  <div class="slack">
    <header><span># atlas-web</span><em>Coming soon</em></header>
    <div class="msg"><i style="background:#2bac76">AM</i><div><b>Alex Morgan</b><small>10:42 AM</small><br><span class="mention">@Zana</span> how is the Atlas 42 sprint looking?</div></div>
    <div class="msg reply-msg"><i style="background:#4a3aa8">✦</i><div><b>Zana</b><span class="app">APP</span><small>10:42 AM</small><br>7 open tickets, 29 points left, 9 days to go. 2 are blocked: <b>W-18402388</b> and <b>W-18402476</b>.
      <div class="kpis"><span><strong>7</strong>open</span><span><strong>29</strong>points</span><span><strong>2</strong>blocked</span></div>
      <span class="btn">Work with agent</span></div></div>
    <div class="composer">Message #atlas-web</div>
    <div class="label">Zana in Slack</div>
  </div>
</div>`
};

// The agents' scripted replies; each prompt gets its own, written just before it is sent.
const scriptDir = mkdtempSync(join(tmpdir(), 'zcc-demo-tour-script-'));
const script = join(scriptDir, 'script.json');
const reply = (match: string, steps: unknown[]) => writeFileSync(script, JSON.stringify({ match, steps }));

test.use({
  e2e: true,
  initialConfig: { sponsorPromptDismissed: true, teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false, harnessOpenCodeEnabled: true },
  launchEnv: {
    PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`, FAKE_ACP_MODE_CONFIG: '1', FAKE_ACP_SCRIPT: script, FAKE_ACP_HTTP_MCP: '1',
    ...(process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {})
  }
});
test.setTimeout(360_000);

const NARRATION: Array<{ id: string; ms: number }> = process.env.ZCC_DEMO_NARRATION
  ? JSON.parse(readFileSync(process.env.ZCC_DEMO_NARRATION, 'utf8'))
  : [];

async function tap(page: Page, target: Locator, beforeClick?: () => Promise<void>): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box && process.env.ZCC_E2E_RECORD_VIDEO) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await page.waitForTimeout(120);
  await beforeClick?.();
  await target.click();
}

async function pick(page: Page, picker: Locator, listbox: string, option: string): Promise<void> {
  await tap(page, picker);
  await page.waitForTimeout(250);
  await tap(page, page.getByRole('listbox', { name: listbox }).getByRole('option', { name: new RegExp(`${listbox === 'Machine and project' ? '› ' : '^'}${option.replace(/[()]/g, '\\$&')}(?:\\s|$)`) }).first());
}

test('demo: a tour of Zana', async ({ app }) => {
  test.skip(!existsSync(join(gusSource, 'app.tsx')), 'Set GUS_PLUGIN_ROOT to the GUS plugin checkout');
  const page = app.window;
  // The Squad decides its own navigation label, so the board never waits on a question.
  const agent = makeJobTeamCoordinatorBinary({ scenario: 'unattended' });
  const parent = mkdtempSync(join(tmpdir(), 'zcc-demo-tour-'));
  const projectDir = join(parent, 'atlas-site');
  const gusDir = join(parent, 'zcc-plugin-gus');
  mkdirSync(join(projectDir, '.zcc', 'teams'), { recursive: true });
  writeFileSync(join(projectDir, '.zcc', 'teams', 'web-squad.json'), `${JSON.stringify(WEB_SQUAD, null, 2)}\n`);
  writeFileSync(join(projectDir, 'index.html'), '<!doctype html><title>Atlas</title><h1>Atlas</h1>\n');
  mkdirSync(gusDir);
  await prepareGusFixture(gusSource, gusDir);
  // The agent's Dashboard change, built ahead in a copy so the plugin reloads at once on camera.
  const files = dashboardChange(gusDir);
  const gusStage = join(parent, 'gus-stage');
  cpSync(gusDir, gusStage, { recursive: true, verbatimSymlinks: true });
  for (const file of files) writeFileSync(join(gusStage, file.path.slice(gusDir.length)), file.content);
  await rebuildGusFixture(gusStage);
  let phoneBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let gateway: Awaited<ReturnType<typeof startMobileGateway>> | undefined;

  try {
    await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    const light = process.env.ZCC_DEMO_THEME === 'light';
    await page.evaluate(({ bin, theme }) => window.cc.config.set({
      teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, codexBinary: bin,
      trustZccToolsEnabled: false, tmuxScope: 'off', defaultHarness: 'claude', opencodeBinary: undefined, theme
    }), { bin: agent.path, theme: light ? 'light' as const : 'dark' as const });
    await page.addStyleTag({ content: '.statusbar { display: none !important; }' });
    // The project folder picker, then the plugin folder picker.
    await stubOpenDialog(app.electron, [[projectDir], [gusDir]]);

    const beat = (ms: number) => page.waitForTimeout(ms);
    const timeline: Array<{ id: string; at: number }> = [];
    let flashAt = 0;
    const settle = async () => {
      const last = timeline.at(-1);
      const spoken = last ? NARRATION[timeline.length - 1]?.ms ?? 0 : 0;
      const remaining = last ? flashAt + last.at + spoken + 180 - Date.now() : 0;
      if (remaining > 0) await page.waitForTimeout(remaining);
    };
    // render.py zooms on these regions: ms from the flash, for ms, onto the element's box.
    const zooms: Array<{ at: number; ms: number; box: { x: number; y: number; width: number; height: number } }> = [];
    const focus = async (target: Locator, ms: number) => {
      const box = await target.boundingBox();
      if (box) zooms.push({ at: Date.now() - flashAt, ms, box });
    };
    const say = async (id: string) => {
      await settle();
      const expected = NARRATION[timeline.length]?.id;
      if (NARRATION.length && expected !== id) throw new Error(`line ${timeline.length} is "${id}", narration expects "${expected}"`);
      timeline.push({ id, at: Date.now() - flashAt });
    };
    await page.evaluate((tone) => {
      const veil = Object.assign(document.createElement('div'), { id: 'e2e-veil' });
      veil.style.cssText = `position:fixed;inset:0;background:${tone};opacity:0;z-index:100000;pointer-events:none;transition:opacity .16s ease`;
      document.body.appendChild(veil);
    }, light ? '#f4f5f8' : '#15171c');
    const veil = (opacity: number) => page.evaluate((value) => { document.getElementById('e2e-veil')!.style.opacity = String(value); }, opacity);
    const go = async (target: Locator) => {
      await tap(page, target, async () => { await veil(0.55); await beat(160); });
      await beat(140);
      await veil(0);
    };
    const visit = async (path: string) => {
      await veil(0.55);
      await beat(160);
      await page.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, path);
      await beat(140);
      await veil(0);
    };
    await page.evaluate(() => {
      const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
      dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:100001;pointer-events:none;transition:transform .12s';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
      addEventListener('mousedown', () => { dot.style.transform = 'scale(.6)'; }, true);
      addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
    });
    // The phone: the real mobile web app through the mobile gateway, mirrored into a device frame
    // on the recorded window, beside a mock of the coming Slack app. Opened off camera.
    const openPhone = async (): Promise<Page> => {
      const reservation = createServer();
      await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((done) => reservation.close(() => done()));
      const serverUrl = `http://127.0.0.1:${port}`;
      gateway = await startMobileGateway({ upstream: new URL(page.url()).origin, publicUrl: serverUrl, port });
      phoneBrowser = await chromium.launch();
      const context = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: light ? 'light' : 'dark' });
      const paired = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Alex’s iPhone' } });
      const { credential } = await paired.json();
      expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential}` } })).ok()).toBe(true);
      const phone = await context.newPage();
      phone.setDefaultTimeout(20_000);
      await phone.goto(serverUrl);
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).tap();
      const drawer = phone.getByRole('dialog', { name: 'Navigation', exact: true });
      const gusItem = drawer.getByText('GUS', { exact: true });
      if (!(await gusItem.isVisible())) await drawer.getByRole('button', { name: 'More', exact: true }).tap();
      await gusItem.tap();
      await expect(phone.locator('.gus-panel')).toBeVisible();
      await phone.addStyleTag({ content: '.statusbar { display: none !important; }' });
      await page.evaluate(({ css, html, light }) => {
        document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('e2e-devices')!.classList.toggle('light', light);
      }, { ...DEVICES, light });
      const cdp = await context.newCDPSession(phone);
      cdp.on('Page.screencastFrame', (frame) => {
        void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
        void page.evaluate((data) => { (document.getElementById('e2e-phone-screen') as HTMLImageElement).src = `data:image/jpeg;base64,${data}`; }, frame.data).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 780, maxHeight: 1688 });
      return phone;
    };
    const addProject = page.getByRole('button', { name: 'Add machine or project' });
    await expect(addProject).toBeVisible({ timeout: 15_000 });
    // Off camera, pick OpenCode once, so the picker opens on it and does not reflow on camera.
    const home = new URL(page.url()).pathname;
    await page.getByTestId('nav-agents').click();
    await page.getByTestId('agents-board-new-thread').first().click();
    const setup = page.getByTestId('launch-modal');
    await setup.locator('.launch-segmented').getByRole('button', { name: /^Modern/ }).click();
    await setup.getByTestId('model-reasoning-picker-trigger').click();
    await page.getByTestId('model-reasoning-provider-acp-opencode').click();
    await expect(page.getByTestId('model-reasoning-provider-acp-opencode')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await page.mouse.click(1420, 880);
    await expect(setup).toBeHidden();
    await page.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, home);
    await expect(addProject).toBeVisible();
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
    await beat(500);

    // 1. Projects.
    await say('projects');
    await tap(page, addProject);
    await tap(page, page.getByRole('group', { name: 'Add a machine or project' }).getByRole('button', { name: 'Add local folder' }));
    const addDialog = page.getByRole('dialog').filter({ hasText: 'Add local project' });
    await expect(addDialog).toBeVisible();
    await tap(page, addDialog.getByRole('button', { name: 'Browse for folder' }));
    await expect(addDialog.locator('input').first()).toHaveValue(projectDir);
    await beat(500);
    await tap(page, addDialog.getByRole('button', { name: 'Add project', exact: true }));
    await expect(addDialog).toBeHidden();
    // The GUS plugin's folder is a project too, for the agent that changes it later.
    await page.evaluate(async (path) => {
      const added = await window.cc.projects.add(path);
      if (!added.ok) throw Error(added.message);
    }, gusDir);
    const atlasId = await page.evaluate(async () => (await window.cc.projects.list()).find((p) => p.name === 'atlas-site')!.id);

    // 2. Any agent, one composer.
    await say('agents');
    const threadPath = async () => {
      await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(/\/threads\/[^/]+$/);
      return new URL(page.url()).pathname;
    };
    // The harness and project are chosen on camera once; later launches reuse them.
    const firstLaunch = async (request: string, project: string) => {
      await go(page.getByTestId('nav-agents'));
      await tap(page, page.getByTestId('agents-board-new-thread').first());
      const launcher = page.getByTestId('launch-modal');
      await expect(launcher).toBeVisible();
      await tap(page, launcher.locator('.launch-segmented').getByRole('button', { name: /^Modern/ }));
      await focus(launcher, 5200);
      // Show the harnesses, already on OpenCode.
      const harness = launcher.getByTestId('model-reasoning-picker-trigger');
      await tap(page, harness);
      const opencode = page.getByTestId('model-reasoning-provider-acp-opencode');
      await expect(opencode).toHaveAttribute('aria-selected', 'true');
      const tabs = await page.locator('.model-reasoning-picker-tabs').boundingBox();
      if (tabs && process.env.ZCC_E2E_RECORD_VIDEO) {
        await page.mouse.move(tabs.x + 8, tabs.y + tabs.height / 2, { steps: 12 });
        await page.mouse.move(tabs.x + tabs.width - 8, tabs.y + tabs.height / 2, { steps: 40 });
      }
      await tap(page, opencode);
      await beat(500);
      await tap(page, harness);
      await pick(page, launcher.getByRole('button', { name: 'Machine and project', exact: true }), 'Machine and project', project);
      const input = launcher.locator('textarea, [contenteditable="true"]').first();
      await input.click();
      await input.pressSequentially(request, { delay: 14 });
      await tap(page, launcher.getByRole('button', { name: 'Send', exact: true }));
      await expect(launcher).toBeHidden();
      return threadPath();
    };
    // Only pick the project when the composer has not already chosen it.
    const ensureProject = async (scope: Locator, project: string) => {
      const trigger = scope.getByRole('button', { name: 'Machine and project', exact: true });
      if (!(await trigger.textContent())?.includes(project)) await pick(page, trigger, 'Machine and project', project);
    };
    reply('pricing page for atlas-site', [
      { pause: 700 },
      { say: 'On it: three plan cards, with **Pro** highlighted as most popular. ', wordMs: 45 },
      { write: { path: 'pricing.html', content: MOCKUP, title: 'Write pricing.html' } },
      { pause: 300 },
      { say: 'Done. `pricing.html` is in your project.', wordMs: 45 }
    ]);
    const buildThread = await firstLaunch(BUILD_REQUEST, 'atlas-site');
    await expect.poll(() => existsSync(join(projectDir, 'pricing.html')), { timeout: 30_000 }).toBe(true);
    await expect(page.getByText(/is in your project\.$/)).toBeVisible({ timeout: 15_000 });

    // 3. The result, beside the conversation.
    await say('preview');
    const threadId = buildThread.split('/').pop()!;
    await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/threads/${id}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: { source: 'workspace', path: 'pricing.html' } }) });
      if (!res.ok) throw new Error(`open failed: ${res.status}`);
    }, threadId);
    const panel = page.getByTestId('thread-secondary-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await beat(700);
    await focus(panel, 3200);
    await beat(2600);

    // 4. A Squad, launched by the agent from the same thread.
    await say('squads');
    // Matches only this request: the Squad's reports to the thread must not launch another.
    reply('whole Atlas site', [
      { pause: 600 },
      { say: 'That is a job for a Squad. Launching the **Web Squad** on it now. ', wordMs: 42 },
      { tool: { name: 'squad_launch', arguments: { teamId: 'web-squad', goal: GOAL, title: 'Atlas site', mode: 'now' } } },
      { pause: 300 },
      { say: 'The Squad is running: the orchestrator is planning, and I will report back when it is done.', wordMs: 42 }
    ]);
    const threadInput = page.getByTestId('thread-command-input');
    await threadInput.click();
    await threadInput.pressSequentially(SQUAD_REQUEST, { delay: 14 });
    await tap(page, page.getByTestId('thread-command-send'));
    await expect(page.getByText(/report back when it is done\.$/)).toBeVisible({ timeout: 30_000 });
    await focus(page.getByText(/report back when it is done\.$/), 2600);
    await beat(1800);
    await expect.poll(() => page.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions.length, atlasId), { timeout: 30_000 }).toBeGreaterThan(0);

    // 5. Flow view, until the Squad is done.
    await say('flow');
    await go(page.getByTestId('nav-agents'));
    await expect(page.locator('.agent-card').filter({ hasText: /Atlas/ }).first()).toBeVisible({ timeout: 30_000 });
    await go(page.getByRole('button', { name: 'Flow view' }));
    const edges = page.locator('svg.squad-flow-edges');
    await expect(edges.locator('path.squad-flow-edge').first()).toBeVisible({ timeout: 30_000 });
    await focus(edges, 3600);
    await expect.poll(() => page.evaluate(async (id) => {
      const list = await window.cc.executionBoard.listProject(id);
      return list.executions.some((execution) => execution.state === 'COMPLETED');
    }, atlasId), { timeout: 60_000 }).toBe(true);
    await beat(900);

    // 6. Modular: a plugin from the marketplace...
    await say('plugins');
    await go(page.locator('.nav-item').filter({ hasText: 'Plugins' }).first());
    await go(page.getByTestId('extensions-nav-marketplace'));
    const search = page.getByRole('textbox', { name: 'Search plugins' });
    await search.click();
    await search.pressSequentially('Agent City', { delay: 30 });
    const cityRow = page.getByTestId('plugin-card-agent-city');
    await expect(cityRow.locator('.ext-market-item-action button')).toBeEnabled({ timeout: 20_000 });
    await focus(cityRow, 2600);
    await beat(500);
    await tap(page, cityRow.locator('.ext-market-item-action button'));
    await tap(page, page.getByRole('button', { name: 'Install with full trust' }));
    await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find((p) => p.id === 'agent-city')?.status), { timeout: 60_000 }).toBe('running');

    // 7. ...and one straight from a folder.
    await say('folder');
    await go(page.getByTestId('extensions-nav-installed'));
    const collection = page.locator('.ext-installed-collection');
    await tap(page, collection.getByRole('button', { name: 'Add plugin' }));
    await beat(400);
    await tap(page, page.getByRole('menuitem', { name: 'Install from folder' }));
    await expect.poll(() => page.evaluate(async (id) => (await window.cc.pluginApps.list()).find((p) => p.id === id)?.status, GUS_ID), { timeout: 60_000 }).toBe('running');
    const gusRow = page.getByTestId(`plugin-row-${GUS_ID}`);
    await expect(gusRow).toBeVisible({ timeout: 15_000 });
    await gusRow.scrollIntoViewIfNeeded();
    await focus(gusRow, 2200);
    await beat(1200);

    await go(page.getByRole('link', { name: 'Back to app' }));

    // 9. My tickets.
    await say('tickets');
    const gusNav = page.getByRole('button', { name: 'GUS', exact: true });
    await go(gusNav);
    await expect(page.locator('.gus-board')).toBeVisible({ timeout: 20_000 });
    await beat(1500);

    // 10. Work with agent.
    await say('work');
    reply('Work GUS', [
      { pause: 700 },
      { say: 'On it. The sticky Checkout button needs to stop above the footer on narrow screens. ', wordMs: 45 },
      { write: { path: 'checkout.css', content: '@media (max-width: 380px) {\n  .checkout-bar { position: sticky; bottom: 0; margin-bottom: 72px; }\n}\n', title: 'Write checkout.css' } },
      { pause: 300 },
      { say: 'Fixed in `checkout.css`. Ready for review.', wordMs: 45 }
    ]);
    await tap(page, page.locator('.gus-card').filter({ hasText: 'Checkout button' }).first());
    const work = page.getByRole('button', { name: 'Work with agent' });
    await expect(work).toBeVisible({ timeout: 15_000 });
    await beat(900);
    await tap(page, work);
    const compose = page.getByTestId('new-thread-view');
    await expect(compose).toBeVisible({ timeout: 15_000 });
    await expect(compose.getByTestId('thread-command-input')).toContainText('Work GUS', { timeout: 15_000 });
    await ensureProject(compose, 'atlas-site');
    await beat(400);
    await tap(page, compose.getByTestId('thread-command-send'));
    await expect(page.getByText(/Ready for review\.$/)).toBeVisible({ timeout: 30_000 });

    // 11. Ask an agent to change the plugin, from the plugin's own project.
    await say('change');
    reply('Dashboard tab', [
      { pause: 700 },
      { say: 'I\'ll add a `GusDashboard` component and a Dashboard tab next to My work and Backlog. ', wordMs: 42 },
      { write: { path: 'src/app/GusDashboard.tsx', content: files[0]!.content, title: 'Write src/app/GusDashboard.tsx' } },
      { pause: 300 },
      { write: { path: 'src/app/GusPanel.tsx', content: files[1]!.content, title: 'Edit src/app/GusPanel.tsx' } },
      { pause: 300 },
      { say: 'Done: tickets by status, the sprint countdown, and what is blocked.', wordMs: 42 }
    ]);
    const projectSpawn = page.getByRole('button', { name: 'New agent in zcc-plugin-gus', exact: true });
    if (await projectSpawn.isVisible()) {
      await tap(page, projectSpawn);
    } else {
      await go(page.getByTestId('nav-agents'));
      await tap(page, page.getByTestId('agents-board-new-thread').first());
    }
    const launcher = page.getByTestId('launch-modal');
    await expect(launcher).toBeVisible();
    await expect(launcher.getByTestId('model-reasoning-picker-trigger')).toBeVisible();
    await ensureProject(launcher, 'zcc-plugin-gus');
    const request = launcher.locator('textarea, [contenteditable="true"]').first();
    await request.click();
    await request.pressSequentially(DASHBOARD_REQUEST, { delay: 14 });
    await tap(page, launcher.getByRole('button', { name: 'Send', exact: true }));
    await expect(launcher).toBeHidden();
    const dashboardThread = await threadPath();

    // 12. Live: the change was built ahead (gusStage), so the reload is immediate.
    await expect.poll(() => readFileSync(files[1]!.path, 'utf8').includes('GusDashboard'), { timeout: 30_000 }).toBe(true);
    await expect(page.getByText(/^Done: tickets by status/)).toBeVisible({ timeout: 15_000 });
    for (const built of ['app.js', 'app.meta.json', 'server.mjs', 'server.meta.json']) {
      if (existsSync(join(gusStage, built))) copyFileSync(join(gusStage, built), join(gusDir, built));
    }
    await page.evaluate((id) => window.cc.pluginApps.reload(id), GUS_ID);
    await say('dashboard');
    await expect.poll(() => page.evaluate(async (id) => (await window.cc.pluginApps.list()).find((p) => p.id === id)?.status, GUS_ID), { timeout: 60_000 }).toBe('running');
    await go(gusNav);
    const dashboardTab = page.locator('.gus-mode-tab').filter({ hasText: 'Dashboard' });
    await expect(dashboardTab).toBeVisible({ timeout: 20_000 });
    await tap(page, dashboardTab);
    await expect(page.locator('.gus-dash')).toBeVisible();
    await beat(1500);

    // 13. Share it: just ask the agent.
    await say('share');
    const phoneReady = openPhone();
    reply('Share it with the Atlas team', [
      { pause: 700 },
      { say: 'Pushed `zcc-plugin-gus` to **github.com/atlas-team/zcc-plugin-gus** and posted the link in #atlas-web. ', wordMs: 42 },
      { pause: 300 },
      { say: 'Your colleagues can install it from Plugins, and get updates when you push.', wordMs: 42 }
    ]);
    await visit(dashboardThread);
    const shareInput = page.getByTestId('thread-command-input');
    await expect(shareInput).toBeVisible({ timeout: 15_000 });
    await shareInput.click();
    await shareInput.pressSequentially(SHARE_REQUEST, { delay: 16 });
    await tap(page, page.getByTestId('thread-command-send'));
    await expect(page.getByText(/updates when you push\.$/)).toBeVisible({ timeout: 30_000 });
    await beat(800);

    // 14. On your phone (the real mobile web app, mirrored live), and soon in Slack.
    const phone = await phoneReady;
    await say('everywhere');
    await page.evaluate(() => document.getElementById('e2e-devices')!.classList.add('on'));
    await beat(1600);
    const dashOnPhone = phone.locator('.gus-mode-tab').filter({ hasText: 'Dashboard' });
    if (await dashOnPhone.isVisible()) await dashOnPhone.tap();
    await beat(1800);
    await page.evaluate(() => document.getElementById('e2e-devices')!.classList.add('slack'));
    await beat(1200);
    await page.evaluate(() => document.getElementById('e2e-devices')!.classList.add('reply'));
    await beat(1800);
    // Behind the overlay, back to the dashboard for the close.
    await gusNav.click();
    await dashboardTab.click();
    await expect(page.locator('.gus-dash')).toBeVisible();

    // 15. Close on the dashboard.
    await say('outro');
    await beat(900);
    await page.evaluate(() => document.getElementById('e2e-devices')!.classList.remove('on'));
    await settle();
    await beat(800);
    if (process.env.ZCC_DEMO_TIMELINE) {
      writeFileSync(process.env.ZCC_DEMO_TIMELINE, JSON.stringify(timeline, null, 2));
      writeFileSync(join(dirname(process.env.ZCC_DEMO_TIMELINE), 'zooms.json'), JSON.stringify(zooms, null, 2));
    }
  } finally {
    await phoneBrowser?.close().catch(() => {});
    await gateway?.close().catch(() => {});
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
