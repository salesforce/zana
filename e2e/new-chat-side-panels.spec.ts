import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true,
  initialConfig: { theme: 'light', tmuxScope: 'off', sponsorPromptDismissed: true, classicSessionViewEnabled: true,
    composerShowModern: true, composerShowCliAgent: true, claudeBinary: agent.path, defaultHarness: 'claude', dockableThreadToolsEnabled: false } });
test.afterAll(() => agent.cleanup());
test.setTimeout(180_000);

test('New chat carries live side panels into Modern and CLI agents', async ({ app }, testInfo) => {
  const { window: page, home, electron } = app;
  await dismissConsentOverlays(page);
  const native = await electron.browserWindow(page);
  await native.evaluate(win => win.setContentSize(1440, 900));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const root = join(home, 'Event Studio'); mkdirSync(root);
  writeFileSync(join(root, 'README.md'), '# Event Studio\n\nA day for curious minds.\n\nKeep the programme and preview beside your conversation.\n');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Panel test', '-c', 'user.email=panels@example.test', 'commit', '--quiet', '-m', 'Initial'], { cwd: root });
  const projectId = await page.evaluate(async root => {
    const result = await window.cc.projects.add(root); if (!result.ok) throw Error(result.message); return result.value.id;
  }, root);
  const route = async (path: string) => page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><title>Event preview</title><body style="margin:0;padding:38px;background:#eff6ff;color:#17304e;font:16px system-ui"><small>FIELDNOTES / 2026</small><h1 style="font-size:42px">A day for<br>curious minds.</h1><p>Talks, workshops and ideas worth sharing.</p><label>Your notes<br><input id="notes" placeholder="What would you improve?" style="margin-top:12px;width:100%;padding:14px;border-radius:8px;border:1px solid #bfd1e8"></label><script>window.panelMarker=Math.random()</script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No preview port');
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = () => native.evaluate(async (win, url) => {
    const view = win.contentView.children.find(child => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView | undefined;
    return view ? { visible: view.getVisible(), id: view.webContents.id, marker: await view.webContents.executeJavaScript('window.panelMarker'), notes: await view.webContents.executeJavaScript('document.getElementById("notes").value') } : null;
  }, url);
  const recording = process.env.ZCC_NEW_CHAT_RECORDING ? resolve(process.env.ZCC_NEW_CHAT_RECORDING) : null;
  const frames: Array<{ index: number; time: number; children: Array<{ file: string; x: number; y: number; width: number; height: number }> }> = [];
  const captions: Array<{ time: number; text: string }> = [];
  let start = 0; let timer: ReturnType<typeof setInterval> | undefined; let pending: Promise<void> | null = null;
  const capture = async () => {
    if (!recording) return;
    const frame = await native.evaluate(async win => {
      const image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      const children = [];
      for (const child of win.contentView.children) {
        if ('webContents' in child && child.getVisible()) {
          const view = child as Electron.WebContentsView;
          if (view.webContents.id === win.webContents.id || view.webContents.isDestroyed()) continue;
          const bounds = view.getBounds(); if (bounds.width < 1 || bounds.height < 1) continue;
          const image = await view.webContents.capturePage();
          children.push({ ...bounds, image: image.toPNG().toString('base64') });
        }
      }
      return { image: image.toPNG().toString('base64'), children };
    });
    const index = frames.length; const name = String(index).padStart(6, '0');
    writeFileSync(join(recording, `${name}.png`), Buffer.from(frame.image, 'base64'));
    const children = frame.children.map((child, i) => { const file = `${name}-${i}.png`; writeFileSync(join(recording, file), Buffer.from(child.image, 'base64')); return { file, x: child.x, y: child.y, width: child.width, height: child.height }; });
    frames.push({ index, time: (Date.now() - start) / 1000, children });
  };
  const caption = async (text: string) => { captions.push({ time: (Date.now() - start) / 1000, text }); if (recording) await page.waitForTimeout(1500); };
  try {
    await route(`/projects/${projectId}/threads/new`);
    const draft = page.getByTestId('new-thread-view'); const panel = page.getByTestId('thread-secondary-panel');
    await expect(draft).toBeVisible();
    await draft.getByRole('button', { name: 'Modern', exact: true }).click();
    if (recording) { mkdirSync(recording, { recursive: true }); start = Date.now(); await capture(); timer = setInterval(() => { if (!pending) pending = capture().finally(() => { pending = null; }); }, 120); }
    await caption('Prepare your workspace before starting a chat.');
    await page.getByTestId('thread-secondary-show').click();
    await page.getByTestId('thread-new-tab-browser').click();
    await panel.getByTestId('thread-browser-address').fill(url); await panel.getByTestId('thread-browser-address').press('Enter');
    await expect.poll(async () => (await browser())?.visible).toBe(true);
    const initial = (await browser())!;
    await native.evaluate(async (win, url) => {
      const view = win.contentView.children.find(child => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView;
      await view.webContents.executeJavaScript('document.getElementById("notes").value="Keep this page exactly as it is"');
    }, url);
    await caption('Open the browser, then add project files alongside it.');
    await panel.getByTestId('thread-secondary-new-tab').click();
    await page.getByRole('searchbox', { name: 'Search tools and files' }).fill('README');
    await panel.getByRole('button', { name: 'README.md', exact: true }).click();
    await expect(panel.getByTestId('thread-file-preview')).toContainText('Event Studio');
    await panel.getByRole('button', { name: 'Event preview', exact: true }).click();
    const resizer = panel.getByRole('separator', { name: 'Resize right panel' });
    const bounds = (await resizer.boundingBox())!;
    await page.mouse.move(bounds.x + 3, bounds.y + 100); await page.mouse.down(); await page.mouse.move(bounds.x - 70, bounds.y + 100, { steps: 8 }); await page.mouse.up();
    const width = (await panel.boundingBox())!.width;
    await draft.getByTestId('thread-command-input').fill('Help me improve this event website.');
    await caption('Launch Modern: the same tabs, active page and width follow.');
    await draft.getByTestId('thread-command-send').click();
    await expect(page.getByTestId('thread-detail')).toBeVisible();
    await expect.poll(async () => (await browser())?.visible).toBe(true);
    expect(await browser()).toMatchObject({ id: initial.id, marker: initial.marker, notes: 'Keep this page exactly as it is' });
    expect(Math.abs((await panel.boundingBox())!.width - width)).toBeLessThan(2);
    await expect(panel.getByRole('button', { name: 'Event preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await caption('The live page keeps its notes. Nothing reloads.');
    await captureElectronScreenshot(electron, page, testInfo.outputPath('modern-panel-handoff.png'));
    await panel.getByRole('button', { name: 'README.md', exact: true }).click();
    await expect(panel.getByTestId('thread-file-preview')).toContainText('Event Studio');
    await route(`/projects/${projectId}/threads/new`);
    await expect(page.getByTestId('thread-secondary-show')).toBeVisible();
    await expect(panel).toHaveCount(0);
    await draft.getByRole('button', { name: 'CLI Agent', exact: true }).click();
    await draft.getByTestId('model-reasoning-picker-trigger').click();
    await page.getByTestId('model-reasoning-provider-claude-code').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('thread-secondary-show').click(); await page.getByTestId('thread-new-tab-terminal').click();
    const shell = panel.getByTestId('thread-terminal-tab'); await expect(shell.locator('.xterm')).toBeVisible();
    const shellId = (await shell.getAttribute('data-terminal-session'))!;
    await shell.locator('.xterm-helper-textarea').fill('echo PANEL_HANDOFF_READY'); await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(id => window.cc.terminals.backlog(id), shellId)).toContain('PANEL_HANDOFF_READY\r\n');
    await shell.locator('.xterm').evaluate(element => { (window as unknown as { savedShell: Element }).savedShell = element; });
    await draft.getByTestId('legacy-agent-command-input').fill('Review this project with the terminal beside you.');
    await caption('CLI Agents inherit the workspace too, including a live terminal.');
    await draft.getByTestId('legacy-agent-command-send').click();
    await expect(page.getByTestId('agent-session-view')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId('thread-terminal-tab').locator('.xterm')).toBeVisible();
    expect(await panel.getByTestId('thread-terminal-tab').getAttribute('data-terminal-session')).toBe(shellId);
    expect(await panel.locator('.xterm').evaluate(element => element === (window as unknown as { savedShell: Element }).savedShell)).toBe(true);
    await caption('Same terminal session, same scrollback. Ready to work.');
    await captureElectronScreenshot(electron, page, testInfo.outputPath('cli-panel-handoff.png'));
    expect(errors).toEqual([]);
  } finally {
    if (timer) clearInterval(timer); await pending;
    if (recording) writeFileSync(join(recording, 'timeline.json'), JSON.stringify({ frames, captions }, null, 2));
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('CLI inspector inherits panels without leaving a second tool host in New chat', async ({ app }) => {
  const { window: page, home } = app;
  await dismissConsentOverlays(page);
  await page.evaluate(() => window.cc.config.set({ classicSessionViewEnabled: false }));
  const root = join(home, 'Inspector project'); mkdirSync(root);
  const id = await page.evaluate(async root => { const project = await window.cc.projects.add(root); if (!project.ok) throw Error(project.message); return project.value.id; }, root);
  await page.evaluate(id => { history.pushState({}, '', `/projects/${id}/threads/new`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  const draft = page.getByTestId('new-thread-view');
  await draft.getByRole('button', { name: 'CLI Agent', exact: true }).click();
  await page.getByTestId('thread-secondary-show').click();
  await page.getByTestId('thread-new-tab-terminal').click();
  const shell = page.getByTestId('thread-terminal-tab'); await expect(shell.locator('.xterm')).toBeVisible();
  const session = await shell.getAttribute('data-terminal-session');
  await draft.getByTestId('legacy-agent-command-input').fill('Keep this terminal beside the agent.');
  await draft.getByTestId('legacy-agent-command-send').click();
  const modal = page.getByTestId('agent-terminal-modal'); await expect(modal).toBeVisible({ timeout: 30_000 });
  await expect(modal.getByTestId('thread-terminal-tab').locator('.xterm')).toBeVisible();
  expect(await modal.getByTestId('thread-terminal-tab').getAttribute('data-terminal-session')).toBe(session);
  await expect(page.getByTestId('new-chat-panel-layout').getByTestId('thread-secondary-panel')).toHaveCount(0);
});

test.describe('required live verification', () => {
  // Live catalog checks need the bundled providers and memory plugin.
  test.use({ isolateBundledCatalog: false });
  test.skip(!process.env.ZCC_NEW_CHAT_LIVE_CHECKS, 'Opt-in checks against the isolated Electron run');
  test('required live checks run against the isolated app', async ({ app }, testInfo) => {
    test.setTimeout(480_000);
    const serverUrl = await app.window.evaluate(async () => new URL((await fetch('/api/v1/health')).url).origin);
    expect(serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const env = { ...process.env, ZCC_SERVER_URL: serverUrl, ZCC_DATA_DIR: join(app.home, '.zcc') };
    delete env.ZCC_SESSION_ID;
    const { spawn } = await import('node:child_process');
    const { openSync, closeSync } = await import('node:fs');
    for (const name of ['live:mode-reasoning', 'live:memory', 'live:browser'].filter(name => process.env.ZCC_NEW_CHAT_LIVE_CHECKS?.split(',').includes(name))) {
      const fd = openSync(testInfo.outputPath(`${name.replaceAll(':', '-')}.log`), 'w');
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          const child = spawn('pnpm', [name], { env, stdio: ['ignore', fd, fd], timeout: 150_000 });
          child.on('error', reject); child.on('exit', resolve);
        });
        expect.soft(code, name).toBe(0);
      } finally { closeSync(fd); }
    }
  });
});
