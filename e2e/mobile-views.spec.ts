import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, type Page, type Route } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ initialConfig: { sponsorPromptDismissed: true, agentsBoardView: 'flow', classicSessionViewEnabled: false, threadTabsEnabled: false, inboxGrouping: 'time', voiceInputEnabled: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test.beforeEach(async ({ home }) => {
  const project = join(home, 'responsive-project');
  mkdirSync(join(project, 'docs'), { recursive: true });
  mkdirSync(join(home, '.zcc', 'inbox'), { recursive: true });
  mkdirSync(join(home, '.zcc', 'saved'), { recursive: true });
  writeFileSync(join(project, 'mobile-agent.cjs'), `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
process.stdout.write('\\x1b]2;✳ Mobile terminal\\x07MOBILE_TERMINAL_READY\\r\\n');
process.stdin.resume();
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const comments = 'A report with a long reference: ' + 'mobile-layout-'.repeat(16) +
    '\n\n' + Array.from({ length: 18 }, (_, i) => `Paragraph ${i + 1}: This report should remain readable on a phone, with all actions reachable.`).join('\n\n');
  writeFileSync(join(project, 'docs', 'report.md'), '# Responsive report\n\n' + comments);
  writeFileSync(join(project, 'docs', 'results.md'), '# Verification results\n\nThe second document is readable.');
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify({ version: 1, projects: [{
    id: 'responsive-project', name: 'Mobile interface verification', path: project,
    createdAt: Date.now(), lastActiveAt: Date.now(), tag: 'responsive'
  }] }));
  writeFileSync(join(home, '.zcc', 'inbox', 'entries.jsonl'), Array.from({ length: 12 }, (_, i) => JSON.stringify({
    id: `responsive-${i}`, projectId: 'responsive-project', ts: Date.now() - i * 1000,
    subject: i === 1 ? 'A longer report title that should stay readable while scanning a busy inbox on a small phone' : `Responsive report ${i + 1}`, comments, report: true,
    ...(i === 0 ? { docs: [{ path: 'docs/report.md' }, { path: 'docs/results.md' }] } : {})
  })).join('\n') + '\n');
  writeFileSync(join(home, '.zcc', 'saved', 'saved-responsive.json'), JSON.stringify({
    id: 'saved-responsive', projectId: 'responsive-project', savedAt: Date.now(),
    title: 'Saved responsive report', comments
  }));
});

async function capture(page: Page) {
  return page.locator('.shell-main').evaluate((root) => {
    const viewport = innerWidth;
    return [...root.querySelectorAll<HTMLElement>('*')].filter((el) => {
      if (el.closest('.aurora-grid, .zcc-kanban, .mobile-agent-lanes')) return false;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' &&
        (box.right > viewport + 2 || box.left < -2);
    }).slice(0, 30).map((el) => ({ tag: el.tagName, class: el.className,
      text: el.textContent?.slice(0, 60), width: Math.round(el.getBoundingClientRect().width),
      right: Math.round(el.getBoundingClientRect().right) }));
  });
}

test('Main views and populated Inbox fit phone and tablet screens', async ({ app }, testInfo) => {
  test.setTimeout(240_000);
  const seed = await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'responsive-project', providerId: 'fake', input: 'Responsive agent 1 delay:500' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread as { id: string; environmentId: string };
  });
  await expect.poll(() => app.window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status;
  }, seed.id)).toBe('idle');
  await app.window.evaluate(async (environmentId) => {
    for (let i = 1; i < 8; i++) {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'responsive-project', providerId: 'fake', environment: { kind: 'reuse', environmentId }, input: `Responsive agent ${i + 1} reviewing a longer task title on a small phone screen delay:500` })
      });
      if (!response.ok) throw new Error(await response.text());
    }
    for (const name of ['Responsive daily review', 'Responsive weekly summary']) {
      const result = await window.cc.scheduler.create({ name, projectId: 'responsive-project', profile: 'shell', every: '1d', enabled: false, inboxLevel: 'silent' });
      if (!result.ok) throw new Error(result.message);
    }
  }, seed.environmentId);
  await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/terminals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'responsive-project', profile: 'claude', title: 'Mobile terminal', command: './mobile-agent.cjs', cols: 80, rows: 24 })
    });
    if (!response.ok) throw new Error(await response.text());
  });
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Responsive views' } });
    const credential = await pair.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    await page.route('**/api/v1/system/voice-status', (route) => route.fulfill({ json: { enabled: true } }));
    // Keep the audited controls stable while native harness catalogs load. Some
    // host providers expose only one permission mode and remove that picker.
    await page.route('**/api/v1/system/execution-options*', (route) => route.fulfill({ json: {
      providers: [{ id: 'fake', displayName: 'Fake', available: true,
        composerActions: [], capabilities: { permissionModes: ['full', 'accept-edits'] } }],
      models: [{ id: 'fake-model', model: 'fake-model', displayName: 'Fake Model', isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }], defaultReasoningEffort: 'medium' }],
      selectedOnlyModels: [], permissionCeiling: 'full', modelLoadError: null
    } }));
    const audit: Record<string, unknown> = {};
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 900 });
      // Deterministic presentation states over the real HTTP roster. The fake
      // jobs finish quickly; retain their real ids/routes while exercising all badges.
      const rosterUrl = (url: URL) => url.pathname === '/api/v1/threads';
      const badgeRoster = async (route: Route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.threads = body.threads.map((thread: Record<string, unknown>, index: number) => ({
          ...thread,
          status: index === 0 ? 'active' : index === 2 ? 'error' : 'idle',
          hasPendingInteraction: index === 1
        }));
        await route.fulfill({ response, json: body });
      };
      await page.route(rosterUrl, badgeRoster);
      await page.goto(serverUrl + '/');
      const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await drawer.getByRole('button', { name: /^Notifications/ }).click();
      await expect(drawer).toBeHidden();
      const notifications = page.getByRole('complementary', { name: 'Notifications', exact: true });
      await expect(notifications).toBeVisible();
      await notifications.getByRole('button', { name: 'Close notifications', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      const history = drawer.getByRole('list', { name: 'Your agents' });
      await expect(history.getByRole('link')).toHaveCount(9);
      await expect(drawer.getByTestId('nav-inbox')).toHaveCount(0);
      await expect(drawer.getByPlaceholder('Filter projects')).toHaveCount(0);
      const newAgent = drawer.getByRole('link', { name: 'New agent', exact: true });
      const inboxShortcut = drawer.getByTestId('mobile-nav-inbox');
      const more = drawer.getByRole('button', { name: 'More', exact: true });
      const search = drawer.getByRole('searchbox', { name: 'Search agents' });
      for (const control of [newAgent, inboxShortcut, more, search, history.getByRole('link').first()]) {
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      const createBox = (await newAgent.boundingBox())!;
      const inboxBox = (await inboxShortcut.boundingBox())!;
      const moreBox = (await more.boundingBox())!;
      expect(inboxBox.y).toBeGreaterThanOrEqual(createBox.y + createBox.height);
      expect(inboxBox.y).toBe(moreBox.y);
      expect(inboxBox.x + inboxBox.width).toBeLessThan(moreBox.x);
      await expect(inboxShortcut.locator('.mobile-agent-inbox-count')).toHaveText(/^[1-9]\d*$/);
      const working = history.locator('.mobile-agent-status[data-status="Working"]');
      const attention = history.locator('.mobile-agent-status[data-status="Needs you"]');
      const failed = history.locator('.mobile-agent-status[data-status="Error"]');
      await expect(working).toHaveCSS('animation-name', 'agent-card-pulse');
      await expect.poll(() => working.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('agent-dot-pulse');
      for (const row of await history.getByRole('link').all()) {
        const project = row.locator('.mobile-agent-project');
        const badge = row.locator('.mobile-agent-status');
        await expect(project).toHaveAttribute('title', 'Mobile interface verification');
        const projectBox = (await project.boundingBox())!;
        const badgeBox = (await badge.boundingBox())!;
        expect(projectBox.width).toBeGreaterThan(60);
        expect(projectBox.x + projectBox.width).toBeLessThanOrEqual(badgeBox.x - 7);
        expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(width - 16);
      }
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), theme);
        const danger = theme === 'light' ? 'rgb(207, 34, 46)' : 'rgb(248, 81, 73)';
        await expect(attention).toHaveCSS('color', danger);
        await expect(failed).toHaveCSS('color', danger);
        await expect(attention).toHaveCSS('animation-name', 'none');
        await page.screenshot({ path: testInfo.outputPath(`${width}-agent-badges-${theme}.png`) });
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(working).toHaveCSS('animation-name', 'none');
      expect(await working.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.screenshot({ path: testInfo.outputPath(`${width}-simple-agent-menu.png`) });
      // Keyboard-sized viewport: only history scrolls, leaving creation and search available.
      await page.setViewportSize({ width, height: 568 });
      const actionBox = await newAgent.boundingBox();
      const searchBox = await search.boundingBox();
      const shortcutsBox = await drawer.locator('.mobile-agent-shortcuts').boundingBox();
      await drawer.locator('.mobile-agent-history').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      expect(await drawer.locator('.mobile-agent-history').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await newAgent.boundingBox()).toEqual(actionBox);
      expect(await search.boundingBox()).toEqual(searchBox);
      expect(await drawer.locator('.mobile-agent-shortcuts').boundingBox()).toEqual(shortcutsBox);
      await page.screenshot({ path: testInfo.outputPath(`${width}-simple-agent-menu-scrolled.png`) });
      await page.setViewportSize({ width, height: 900 });
      await search.fill('no-such-agent');
      await expect(drawer.getByRole('status')).toContainText('No agents match');
      await drawer.getByRole('button', { name: 'Clear search' }).click();
      await expect(search).toBeFocused();
      await search.fill('Mobile interface verification');
      await expect(history.getByRole('link')).toHaveCount(9);
      await search.fill('Mobile terminal');
      await expect(history.getByRole('link')).toHaveCount(1);
      await history.getByRole('link').click();
      await expect(drawer).toBeHidden();
      await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
      await expect(page.locator('.agent-terminal-modal, .modal-backdrop')).toHaveCount(0);
      // CLI Agents have no mobile surface; the session route shows the desktop-only notice.
      const cliNotice = page.getByTestId('cli-agent-mobile-unsupported');
      await expect(cliNotice).toBeVisible();
      await expect(cliNotice.getByRole('heading')).toHaveText('CLI Agents aren’t supported on mobile yet');
      await expect(page.getByTestId('agent-session-view')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`${width}-cli-agent-notice.png`) });
      await page.getByRole('link', { name: 'Back to agents', exact: true }).click();
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await search.fill('Responsive agent 1 delay');
      await expect(history.getByRole('link')).toHaveCount(1);
      await history.getByRole('link').click();
      await expect(page).toHaveURL(`${serverUrl}/threads/${seed.id}`);
      await expect(page.getByTestId('thread-detail')).toBeVisible();
      await expect(drawer).toBeHidden();
      await expect(page.locator('.agent-terminal-modal, .modal-backdrop')).toHaveCount(0);
      await page.getByRole('link', { name: 'Back to agents', exact: true }).click();
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await expect(drawer.getByTestId('mobile-nav-agents')).toHaveAttribute('aria-current', 'page');
      await drawer.getByRole('button', { name: 'More', exact: true }).click();
      await expect(drawer.getByTestId('nav-agents')).toBeVisible();
      await drawer.getByRole('button', { name: 'All agents', exact: true }).click();
      await expect(drawer.getByRole('button', { name: 'More', exact: true })).toBeFocused();
      await inboxShortcut.click();
      await expect(page).toHaveURL(serverUrl + '/inbox');
      await expect(drawer).toBeHidden();
      await expect(page.locator('.inbox-view')).toBeVisible();
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await expect(inboxShortcut).toHaveAttribute('aria-current', 'page');
      await newAgent.click();
      await expect(page).toHaveURL(serverUrl + '/threads/new');
      await expect(page.getByTestId('new-thread-view')).toBeVisible();
      await expect(drawer).toBeHidden();
      await page.unroute(rosterUrl, badgeRoster);
      for (const [name, path, selector] of [
        ['home', '/', '.home-panel'],
        ['inbox', '/inbox', '.inbox-view'],
        ['agents', '/agents', '.agents-board'],
        ['scheduler', '/scheduler', '.scheduler-panel'],
        ['new-schedule', '/schedules/new', '.schedule-detail-pane'],
        ['plugins', '/extensions/plugins', '.extensions-panel'],
        ['plugin-browse', '/extensions/plugins/browse', '.extensions-panel'],
        ['skills', '/extensions/skills', '.settings-panel'],
        ['mcp', '/extensions/mcp', '.settings-panel'],
        ['settings', '/settings/global', '.settings-panel'],
        ['machines', '/settings/machines', '.settings-panel'],
        ['agent-settings', '/settings/agents', '.settings-panel'],
        ['project', '/projects/responsive-project', '.agents-board'],
        ['goals', '/goals', '.settings-panel'],
        ['followups', '/followups', '.settings-panel'],
        ['new-thread', '/threads/new', '.new-thread-view']
      ]) {
        await page.goto(serverUrl + path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator(selector).first()).toBeVisible();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
        const mobileTitle = ({ agents: 'Agents', inbox: 'Inbox', scheduler: 'Schedules', plugins: 'Plugins' } as Record<string, string>)[name];
        if (mobileTitle) {
          await expect(page.locator('.mobile-thread-title-slot h1')).toHaveText(mobileTitle);
          expect((await page.locator('.titlebar').boundingBox())!.height).toBe(48);
          await expect(page.locator('.titlebar-bell')).toBeHidden();
        }
        if (name === 'scheduler' || name === 'plugins') {
          const title = name === 'scheduler' ? 'Schedules' : 'Plugins';
          await page.getByRole('button', { name: `${title} actions`, exact: true }).click();
          const sheet = page.getByRole('dialog', { name: `${title} actions`, exact: true });
          await expect(sheet).toBeVisible();
          await expect(sheet.getByRole('button', { name: name === 'scheduler' ? 'From template' : 'Check for updates', exact: true })).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${width}-${name}-actions.png`) });
          await sheet.getByRole('button', { name: 'Close actions', exact: true }).click();
        }
        if (name === 'inbox') {
          const firstRow = page.locator('.inbox-row.unread').first();
          await expect(firstRow).toBeVisible();
          const title = (await firstRow.locator('.inbox-row-title').boundingBox())!;
          const time = (await firstRow.locator('.inbox-row-ts').boundingBox())!;
          const project = (await firstRow.locator('.inbox-row-project').boundingBox())!;
          const preview = (await firstRow.locator('.inbox-row-line2').boundingBox())!;
          expect(preview.y).toBeGreaterThanOrEqual(title.y + title.height);
          expect(project.y).toBeGreaterThanOrEqual(preview.y + preview.height);
          expect(time.y).toBe(project.y);
          expect(title.width).toBeGreaterThanOrEqual((await firstRow.boundingBox())!.width - 28);
          await expect(firstRow).toHaveCSS('border-radius', '0px');
          await expect(firstRow).toHaveCSS('box-shadow', 'none');
          await expect(firstRow.locator('.inbox-row-dot.on')).toBeVisible();
          await expect(firstRow.locator('.inbox-row-report-badge')).toBeHidden();
          await expect(firstRow.locator('.inbox-project-dot')).toBeHidden();
          const longTitle = page.getByText('A longer report title that should stay readable while scanning a busy inbox on a small phone', { exact: true });
          expect((await longTitle.boundingBox())!.height).toBeLessThanOrEqual(42);
          for (const theme of ['light', 'dark']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
            await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-list-${theme}.png`) });
          }
          await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
          await page.getByRole('button', { name: 'Search inbox', exact: true }).click();
          const search = page.getByRole('textbox', { name: 'Search inbox', exact: true });
          const searchTop = (await search.boundingBox())!.y;
          await page.locator('.inbox-list-pane .list-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
          expect((await search.boundingBox())!.y).toBe(searchTop);
          await page.locator('.inbox-list-pane .list-body').evaluate(el => { el.scrollTop = 0; });
        }
        await page.screenshot({ path: testInfo.outputPath(`${width}-${name}.png`) });
        audit[`${width}-${name}`] = await capture(page);
        expect.soft(audit[`${width}-${name}`], `${width}px ${name} overflow`).toEqual([]);
        writeFileSync(testInfo.outputPath('responsive-audit.json'), JSON.stringify(audit, null, 2));
        if (name === 'new-thread') {
          const composer = page.getByLabel('Message', { exact: true });
          await composer.tap();
          const permission = page.getByRole('button', { name: 'Permission mode', exact: true });
          const project = page.getByRole('button', { name: 'Machine and project', exact: true });
          const runSettings = page.getByRole('button', { name: /^Run settings:/ });
          await expect(page.getByTestId('composer-create-plugin')).toBeHidden();
          await expect(page.locator('.new-thread-view > .aurora-grid')).toBeHidden();
          await expect(project).toBeVisible();
          await expect(permission).toBeVisible();
          await expect(runSettings).toBeHidden();
          await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeHidden();
          expect((await project.boundingBox())!.y).toBeLessThan((await composer.boundingBox())!.y);
          for (const control of [project, permission]) {
            const box = (await control.boundingBox())!;
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
          }
          await composer.fill('Keep my mobile draft');
          await permission.click();
          await page.getByRole('option', { name: /Accept Edits/ }).click();
          await expect(permission).toHaveText('Edits');
          await permission.click();
          await page.getByRole('option', { name: /Full Access/ }).click();
          await expect(permission).toHaveText('Full access');
          const primary = [page.getByRole('button', { name: 'Provider and model', exact: true }), permission,
            page.getByRole('button', { name: 'Composer options', exact: true }), page.getByTestId('thread-command-send')];
          const boxes = await Promise.all(primary.map((button) => button.boundingBox()));
          for (const box of boxes) {
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.width).toBeGreaterThanOrEqual(44);
          }
          expect(new Set(boxes.map((box) => box!.y)).size).toBe(1);
          for (let i = 1; i < boxes.length; i++) {
            if (boxes[i]!.y === boxes[i - 1]!.y) expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width);
          }
          // The launcher keeps permissions on its primary toolbar row, while
          // disclosed settings and auxiliary actions stay below it.
          for (const optionsWidth of width === 390 ? [390, 480, 481] : [width]) {
            await page.setViewportSize({ width: optionsWidth, height: 900 });
            const toggle = page.getByRole('button', { name: 'Composer options', exact: true });
            await toggle.click();
            await expect(runSettings).toBeVisible();
            expect((await runSettings.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            const optionsBox = (await page.locator('.thread-command-options').boundingBox())!;
            const actions = page.locator('.thread-command-secondary-actions');
            await expect(actions.getByRole('button', { name: 'Start voice input', exact: true })).toBeVisible();
            expect((await actions.boundingBox())!.y).toBeGreaterThanOrEqual(optionsBox.y + optionsBox.height);
            await page.screenshot({ path: testInfo.outputPath(`${optionsWidth}-new-agent-options.png`) });
            await page.keyboard.press('Escape');
          }
          await page.setViewportSize({ width, height: 900 });
          await composer.evaluate((node) => node.setAttribute('data-mount-probe', 'original-editor'));
          await page.getByTestId('thread-command-expand').click();
          const expandedComposer = page.getByRole('dialog', { name: 'Write a message', exact: true });
          await expect.poll(() => expandedComposer.boundingBox()).toEqual({ x: 0, y: 0, width, height: 900 });
          await expect(expandedComposer.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
          expect((await composer.boundingBox())!.height).toBeGreaterThan(600);
          await expect(composer).toHaveText('Keep my mobile draft');
          await expect(permission).toBeVisible();
          await permission.click();
          await page.keyboard.press('Escape');
          await expect(expandedComposer).toBeVisible();
          const expandedOptions = page.getByRole('button', { name: 'Composer options', exact: true });
          await expandedOptions.click();
          const expandedOptionsBox = (await expandedComposer.locator('.thread-command-options').boundingBox())!;
          const expandedActionsBox = (await expandedComposer.locator('.thread-command-secondary-actions').boundingBox())!;
          expect(expandedActionsBox.y).toBeGreaterThanOrEqual(expandedOptionsBox.y + expandedOptionsBox.height);
          await page.keyboard.press('Escape');
          await expect(expandedOptions).toHaveAttribute('aria-expanded', 'false');
          await expect(expandedComposer).toBeVisible();
          await expandedComposer.getByRole('button', { name: 'Provider and model', exact: true }).click();
          const expandedModelPicker = page.getByRole('dialog', { name: 'Provider and model', exact: true });
          await expect.poll(() => expandedModelPicker.boundingBox()).toEqual({ x: 0, y: 0, width, height: 900 });
          await expandedModelPicker.getByRole('button', { name: 'Close model picker' }).click();
          await expect(expandedComposer).toBeVisible();
          await composer.fill(Array.from({ length: 60 }, (_, i) => `Draft paragraph ${i + 1}`).join('\n'));
          await composer.press('ControlOrMeta+End');
          await expect.poll(() => composer.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
          expect((await expandedComposer.getByRole('button', { name: 'Done', exact: true }).boundingBox())!.y).toBeLessThan(30);
          await page.screenshot({ path: testInfo.outputPath(`${width}-expanded-composer.png`) });
          await composer.fill('Keep my mobile draft');
          await page.setViewportSize({ width, height: 400 });
          await expect.poll(() => expandedComposer.boundingBox()).toEqual({ x: 0, y: 0, width, height: 400 });
          expect((await composer.boundingBox())!.height).toBeGreaterThan(180);
          const expandedSendBox = (await page.getByTestId('thread-command-send').boundingBox())!;
          expect(expandedSendBox.y + expandedSendBox.height).toBeLessThanOrEqual(400);
          await page.screenshot({ path: testInfo.outputPath(`${width}-expanded-composer-short.png`) });
          await expandedComposer.getByRole('button', { name: 'Done', exact: true }).click();
          await expect(expandedComposer).toHaveCount(0);
          await expect(page.getByTestId('thread-command-expand')).toBeFocused();
          await expect(composer).toHaveAttribute('data-mount-probe', 'original-editor');
          await expect(composer).toHaveText('Keep my mobile draft');
          await page.setViewportSize({ width, height: 900 });
          await expect(page.getByRole('button', { name: 'Composer options', exact: true })).toHaveAttribute('aria-expanded', 'false');
          await expect(runSettings).toBeHidden();
          await page.getByRole('button', { name: 'Composer options', exact: true }).click();
          await runSettings.click();
          const settings = page.getByRole('dialog', { name: 'Run settings', exact: true });
          await expect.poll(() => settings.boundingBox()).toEqual({ x: 0, y: 0, width, height: 900 });
          await expect(settings.getByRole('button', { name: 'Close run settings' })).toBeFocused();
          await settings.getByRole('button', { name: 'Workspace', exact: true }).click();
          await page.keyboard.press('Escape');
          await expect(settings).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${width}-run-settings.png`) });
          await settings.getByRole('button', { name: 'Close run settings' }).click();
          await expect(runSettings).toBeFocused();
          await expect(page.getByRole('button', { name: 'Composer options', exact: true })).toHaveAttribute('aria-expanded', 'true');
          await expect(composer).toHaveText('Keep my mobile draft');
          await page.setViewportSize({ width, height: 400 });
          await composer.focus();
          await expect(page.getByRole('button', { name: 'Composer options', exact: true })).toHaveAttribute('aria-expanded', 'false');
          await expect(page.locator('.app-shell')).toHaveCSS('height', '400px');
          const permissionBox = (await permission.boundingBox())!;
          expect(permissionBox.y).toBeGreaterThanOrEqual(48);
          expect(permissionBox.y + permissionBox.height).toBeLessThanOrEqual(400);
          const sendBox = (await page.getByTestId('thread-command-send').boundingBox())!;
          expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(400);
          await page.screenshot({ path: testInfo.outputPath(`${width}-new-agent-short.png`) });
          expect.soft(await capture(page), `${width}px short new-agent overflow`).toEqual([]);
          await page.setViewportSize({ width: 1280, height: 900 });
          await expect(page.getByRole('button', { name: /^Run settings:/ })).toHaveCount(0);
          await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
          await expect(page.getByTestId('composer-create-plugin')).toBeVisible();
          await expect(composer).toHaveText('Keep my mobile draft');
          await page.setViewportSize({ width, height: 900 });
          await expect(composer).toHaveText('Keep my mobile draft');
          await composer.fill('');
          await project.focus();
          await page.screenshot({ path: testInfo.outputPath(`${width}-new-agent-simple.png`) });
          const trigger = page.getByRole('button', { name: 'Provider and model', exact: true });
          await trigger.click();
          const picker = page.getByRole('dialog', { name: 'Provider and model', exact: true });
          await expect(picker).toHaveAttribute('aria-modal', 'true');
          await expect.poll(() => picker.boundingBox()).toEqual({ x: 0, y: 0, width, height: 900 });
          const close = picker.getByRole('button', { name: 'Close model picker' });
          await expect(close).toBeFocused();
          for (const tab of await picker.getByRole('tab').all()) {
            expect(await tab.innerText()).not.toBe('');
            const box = (await tab.boundingBox())!;
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
          await page.screenshot({ path: testInfo.outputPath(`${width}-mobile-model-picker.png`) });
          await page.setViewportSize({ width, height: 400 });
          await expect.poll(() => picker.boundingBox()).toEqual({ x: 0, y: 0, width, height: 400 });
          expect((await picker.locator('.model-reasoning-picker-section').boundingBox())!.height).toBeGreaterThan(80);
          await expect(close).toBeVisible();
          for (const tab of await picker.getByRole('tab').all()) {
            const box = (await tab.boundingBox())!;
            const label = (await tab.locator('span').last().boundingBox())!;
            expect(label.y).toBeGreaterThanOrEqual(box.y);
            expect(label.y + label.height).toBeLessThanOrEqual(box.y + box.height);
          }
          await page.screenshot({ path: testInfo.outputPath(`${width}-mobile-model-picker-short.png`) });
          await close.click();
          await expect(picker).toBeHidden();
          await expect(trigger).toBeFocused();
          await page.setViewportSize({ width, height: 900 });
        }
        if (name === 'inbox') {
          await page.locator('.inbox-filter-input').fill('Responsive report 1');
          await page.locator('.inbox-row').filter({ has: page.getByText('Responsive report 1', { exact: true }) }).click();
          await expect(page.locator('.inbox-detail-title')).toHaveText('Responsive report 1');
          await expect(page.locator('.inbox-list-pane')).toBeHidden();
          await expect(page.locator('.inbox-detail-actions')).toHaveCount(0);
          expect((await page.locator('.inbox-detail-header').boundingBox())!.height).toBeLessThanOrEqual(56);
          const labelBox = await page.locator('.inbox-detail-label').boundingBox();
          expect(labelBox!.width).toBeGreaterThan(100);
          expect(labelBox!.height).toBeLessThan(44);
          await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-detail.png`) });
          audit[`${width}-inbox-detail`] = await capture(page);
          expect.soft(audit[`${width}-inbox-detail`]).toEqual([]);
          const actionsTrigger = page.getByRole('button', { name: 'Message actions', exact: true });
          await actionsTrigger.click();
          const actionsSheet = page.getByRole('dialog', { name: 'Message actions', exact: true });
          await expect(actionsSheet).toBeVisible();
          for (const button of await actionsSheet.getByRole('button').all()) {
            const box = (await button.boundingBox())!;
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
          }
          await actionsSheet.getByRole('button', { name: 'Keep this entry', exact: true }).click();
          await expect(actionsSheet).toBeHidden();
          await expect(actionsTrigger).toBeFocused();
          await actionsTrigger.click();
          await expect(actionsSheet.getByRole('button', { name: 'Remove keep flag' })).toHaveAttribute('aria-pressed', 'true');
          await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-actions.png`) });
          await actionsSheet.getByRole('button', { name: 'Remove keep flag', exact: true }).click();
          await expect(page.locator('.inbox-doc-preview')).toHaveCount(0);
          await page.getByRole('button', { name: 'results.md', exact: true }).click();
          await expect(page.locator('.inbox-doc-preview')).toContainText('The second document is readable.');
          await expect(page.getByRole('button', { name: /in (Finder|Explorer|file manager)|in Cursor|in VS Code/ })).toHaveCount(0);
          await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-documents.png`) });
          expect.soft(await capture(page), `${width}px inbox documents`).toEqual([]);
          await page.getByRole('button', { name: 'results.md', exact: true }).click();
          await page.getByRole('button', { name: 'Leave a reply', exact: true }).click();
          const reply = page.getByRole('textbox', { name: 'Reply to the originating agent' });
          await expect(reply).toBeFocused();
          await reply.fill('A draft to verify the mobile reply layout.');
          await expect(reply).toHaveCSS('font-size', '16px');
          await expect(page.getByRole('button', { name: 'Reopen & send', exact: true })).toBeEnabled();
          await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-reply.png`) });
          expect.soft(await capture(page), `${width}px inbox reply`).toEqual([]);
          await page.setViewportSize({ width, height: 400 });
          const sendReply = page.getByRole('button', { name: 'Reopen & send', exact: true });
          await sendReply.scrollIntoViewIfNeeded();
          expect((await sendReply.boundingBox())!.y + (await sendReply.boundingBox())!.height).toBeLessThanOrEqual(400);
          await expect(reply).toHaveValue('A draft to verify the mobile reply layout.');
          expect.soft(await capture(page), `${width}px inbox reply with keyboard-sized viewport`).toEqual([]);
          await page.setViewportSize({ width, height: 900 });
          await page.getByRole('button', { name: 'Inbox', exact: true }).click();
          await expect(page.locator('.inbox-filter-input')).toHaveValue('Responsive report 1');
          await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
          await page.getByRole('tab', { name: /^Saved/ }).click();
          await expect(page.locator('.saved-row')).toBeVisible();
          await page.locator('.saved-row').click();
          await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-saved.png`) });
          audit[`${width}-inbox-saved`] = await capture(page);
          await page.getByRole('button', { name: 'Saved reports', exact: true }).click();
          await expect(page.locator('.saved-row')).toBeVisible();
          await page.getByRole('tab', { name: /^Feed/ }).click();
          await page.getByRole('button', { name: 'Inbox actions', exact: true }).click();
          await page.getByRole('button', { name: 'Inbox overview', exact: true }).click();
          await expect(page.locator('.inbox-overview')).toBeVisible();
          await page.getByRole('button', { name: 'Inbox', exact: true }).click();
          await expect(page.locator('.inbox-list-pane')).toBeVisible();
          const lastReport = page.locator('.inbox-row').filter({ has: page.getByText('Responsive report 1', { exact: true }) });
          await lastReport.scrollIntoViewIfNeeded();
          const listScroll = await page.locator('.inbox-list-pane .list-body').evaluate(el => el.scrollTop);
          await lastReport.click();
          await expect.poll(() => page.locator('.inbox-view-detail').evaluate(el => el.scrollTop)).toBe(0);
          for (const action of await page.locator('.inbox-detail-header button').all()) {
            const box = await action.boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.width).toBeGreaterThanOrEqual(44);
          }
          await page.getByRole('button', { name: 'Inbox', exact: true }).click();
          expect(await page.locator('.inbox-list-pane .list-body').evaluate(el => el.scrollTop)).toBeCloseTo(listScroll, 0);
        }
        if (name === 'agents') {
          await page.getByRole('button', { name: 'Agents actions', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Canvas view', exact: true })).toBeVisible();
          if (width === 320) {
            await expect(page.getByRole('button', { name: 'Board view', exact: true })).toHaveAttribute('aria-pressed', 'true');
          }
          await page.getByRole('button', { name: 'Canvas view', exact: true }).click();
          const canvas = page.locator('.squad-flow-canvas').first();
          await expect(canvas).toBeVisible();
          const canvasBox = await canvas.boundingBox();
          expect(canvasBox!.width).toBeGreaterThanOrEqual(width - 48);
          expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(width);
          const canvasAgent = canvas.locator('.squad-flow-node').first();
          await expect(canvasAgent).toBeVisible();
          expect(await canvasAgent.evaluate(el => getComputedStyle(el).touchAction)).toBe('pan-x pan-y');
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-canvas.png`) });
          const nodeBox = await canvasAgent.boundingBox();
          expect(nodeBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
          expect(nodeBox!.x + nodeBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width);
          if (width === 320) {
            const beforePan = await canvas.evaluate(el => el.scrollLeft);
            const position = await canvasAgent.getAttribute('style');
            const touch = await context.newCDPSession(page);
            const x = nodeBox!.x + nodeBox!.width / 2;
            const y = nodeBox!.y + nodeBox!.height / 2;
            await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (const offset of [20, 40, 60, 80]) {
              await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - offset, y }] });
            }
            await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await expect.poll(() => canvas.evaluate(el => el.scrollLeft)).toBeGreaterThan(beforePan + 15);
            await expect(canvasAgent).toHaveAttribute('style', position!);
            await expect(page).not.toHaveURL(/\/sessions\//);
            await touch.detach();
            await canvas.evaluate((el, left) => { el.scrollLeft = left; }, beforePan);
          }
          await canvasAgent.tap();
          await expect(page).toHaveURL(/\/sessions\//);
          await expect(page.locator('.agent-terminal-modal')).toHaveCount(0);
          await page.goBack();
          await page.getByRole('button', { name: 'Agents actions', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Canvas view', exact: true })).toHaveAttribute('aria-pressed', 'true');
          await page.getByRole('button', { name: 'List view', exact: true }).click();
          await expect(page.locator('.agent-monitor-row').first()).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-list.png`) });
          audit[`${width}-agents-list`] = await capture(page);
          await expect(page.locator('.agent-monitor-main')).toHaveCount(0);
          await expect(page.getByTestId('agent-monitor-thread')).toHaveCount(0);
          await expect(page.getByTestId('agent-session-view')).toHaveCount(0);
          const list = page.locator('.agent-monitor-list');
          expect((await list.boundingBox())!.height).toBeGreaterThan(600);
          const lastThread = list.locator('[data-kind="thread"]').last();
          await lastThread.scrollIntoViewIfNeeded();
          const listScroll = await list.evaluate(el => el.scrollTop);
          await lastThread.click();
          await expect(list).toBeHidden();
          await expect(page.getByTestId('agent-monitor-thread')).toBeVisible();
          await expect(page.getByTestId('thread-timeline')).toContainText('Response to:');
          expect((await page.locator('.agent-monitor-main').boundingBox())!.width).toBeGreaterThanOrEqual(width - 32);
          await expect(page.locator('.titlebar').getByRole('button', { name: 'Back to agents', exact: true })).toBeVisible();
          await expect(page.locator('.agent-monitor-main .thread-detail-header')).toBeHidden();
          await expect(page.locator('.agents-board-toolbar')).toBeHidden();
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-list-thread.png`) });
          await page.getByRole('button', { name: 'Back to agents', exact: true }).click();
          await expect(list).toBeVisible();
          await expect(page.getByTestId('agent-monitor-thread')).toHaveCount(0);
          expect(await list.evaluate(el => el.scrollTop)).toBeCloseTo(listScroll, 0);
          const terminalRow = list.locator('.agent-monitor-row').filter({ hasText: 'Mobile terminal' });
          await expect(terminalRow).toHaveCount(1);
          await expect(terminalRow).toBeVisible();
          await terminalRow.click();
          await expect(list).toBeHidden();
          // The list opens CLI rows too, but on mobile they show the desktop-only notice.
          await expect(page.getByTestId('cli-agent-mobile-unsupported')).toBeVisible();
          await expect(page.getByTestId('agent-session-view')).toHaveCount(0);
          await expect(page.locator('.titlebar').getByRole('button', { name: 'Back to agents', exact: true })).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-list-cli-notice.png`) });
          await page.getByRole('button', { name: 'Back to agents', exact: true }).click();
          await expect(page.locator('.agent-monitor-main')).toHaveCount(0);
          await expect(list).toBeVisible();
          await page.getByRole('button', { name: 'Agents actions', exact: true }).click();
          await page.getByRole('button', { name: 'Board view', exact: true }).click();
          const board = page.getByTestId('mobile-agent-board');
          await expect(board).toBeVisible();
          await expect(page.locator('.zcc-kanban')).toHaveCount(0);
          await expect(board.getByRole('tabpanel')).toHaveCount(1);
          await expect(board.locator('.agent-card').first()).toBeVisible();
          const card = board.locator('.agent-card').first();
          expect((await card.boundingBox())!.width).toBeGreaterThanOrEqual(width - 32);
          await expect(card).toHaveAttribute('draggable', 'false');
          const populatedTab = await board.getByRole('tab', { selected: true }).getAttribute('id');
          for (const tab of await board.getByRole('tab').all()) {
            await tab.scrollIntoViewIfNeeded();
            expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await tab.click();
            await expect(tab).toHaveAttribute('aria-selected', 'true');
            await expect(board.getByRole('tabpanel')).toHaveCount(1);
          }
          await board.getByRole('tab', { name: /^Needs you/ }).click();
          await expect(board.getByText('No agents in this column')).toBeVisible();
          await page.locator(`[id="${populatedTab}"]`).click();
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-board.png`) });
          expect.soft(await capture(page), `${width}px agents board`).toEqual([]);
          const panel = board.getByRole('tabpanel');
          await panel.hover();
          await page.mouse.wheel(0, 600);
          await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
          expect((await board.getByRole('tab', { selected: true }).boundingBox())!.y).toBeLessThan(300);
          // Even when desktop prefers inspectors, mobile cards open the page.
          for (const kind of ['thread', 'terminal'] as const) {
            const agentCard = kind === 'thread'
              ? board.locator('.agent-card[data-kind="thread"]').first()
              : board.locator('.agent-card').filter({ hasText: 'Mobile terminal' });
            for (const tab of await board.getByRole('tab').all()) {
              await tab.click();
              await expect(tab).toHaveAttribute('aria-selected', 'true');
              if (await agentCard.count()) break;
            }
            await agentCard.click();
            await expect(page).toHaveURL(kind === 'thread' ? /\/threads\/[^/]+$/ : /\/sessions\/[^/]+$/);
            await expect(page.locator('.agent-terminal-modal, .modal-backdrop')).toHaveCount(0);
            // CLI Agents have no mobile surface, so the session page shows the desktop-only notice.
            const detail = page.getByTestId(kind === 'thread' ? 'thread-detail' : 'cli-agent-mobile-unsupported');
            await expect(detail).toBeVisible();
            if (kind === 'thread') expect((await detail.boundingBox())!.width).toBeGreaterThanOrEqual(width - 32);
            else await expect(page.getByTestId('agent-session-view')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toHaveCount(0);
            await page.screenshot({ path: testInfo.outputPath(`${width}-agents-board-${kind}-page.png`) });
            await page.goBack();
            await expect(page).toHaveURL(serverUrl + '/agents');
            await expect(board).toBeVisible();
          }
        }
        if (name === 'scheduler') {
          await page.getByRole('region', { name: 'All schedules' }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath(`${width}-scheduler-inventory.png`) });
          expect.soft(await capture(page), `${width}px scheduler inventory`).toEqual([]);
        }
      }
    }
    await page.goto(serverUrl + '/inbox');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'false');
    await expect(page.getByRole('navigation', { name: 'Agents navigation' })).toHaveCount(0);
    await expect(page.locator('.inbox-list-pane')).toBeVisible();
    await expect(page.locator('.inbox-view-detail')).toBeVisible();
    await page.locator('.inbox-row').filter({ has: page.getByText('Responsive report 1', { exact: true }) }).click();
    await expect(page.locator('.inbox-detail-actions')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Message actions', exact: true })).toHaveCount(0);
    await expect(page.locator('.inbox-docs-fileitem').first()).toBeVisible();
    await page.goto(serverUrl + '/agents');
    await page.getByRole('button', { name: 'Board view', exact: true }).click();
    await expect(page.locator('.zcc-kanban')).toBeVisible();
    await expect(page.getByTestId('mobile-agent-board')).toHaveCount(0);
    // Desktop keeps its inspector preference. Crossing the mobile breakpoint
    // promotes an already-open inspector and clears it before returning.
    for (const kind of ['thread', 'terminal'] as const) {
      const card = kind === 'thread'
        ? page.locator('.zcc-kanban .agent-card[data-kind="thread"]').first()
        : page.locator('.zcc-kanban .agent-card').filter({ hasText: 'Mobile terminal' });
      await card.click();
      await expect(page.getByTestId(kind === 'thread' ? 'thread-modal' : 'agent-terminal-modal')).toBeVisible();
      await expect(page).toHaveURL(serverUrl + '/agents');
      await page.setViewportSize({ width: 390, height: 900 });
      await expect(page).toHaveURL(kind === 'thread' ? /\/threads\/[^/]+$/ : /\/sessions\/[^/]+$/);
      await expect(page.locator('.agent-terminal-modal, .modal-backdrop')).toHaveCount(0);
      await page.goBack();
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.locator('.zcc-kanban')).toBeVisible();
      await expect(page.locator('.agent-terminal-modal')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await expect(page.locator('.agent-monitor-list')).toBeVisible();
    await expect(page.locator('.agent-monitor-main')).toBeVisible();
    const desktopList = await page.locator('.agent-monitor-list').boundingBox();
    const desktopDetail = await page.locator('.agent-monitor-main').boundingBox();
    expect(desktopDetail!.x).toBeGreaterThanOrEqual(desktopList!.x + desktopList!.width - 1);
    await expect(page.getByRole('button', { name: 'Back to agents', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Flow view', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole('button', { name: 'Agents actions', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Canvas view', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close actions', exact: true }).click();
    await expect(page.getByTestId('mobile-agent-board')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('button', { name: 'Flow view', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.squad-flow, .squad-flow-empty').first()).toBeVisible();
    writeFileSync(testInfo.outputPath('responsive-audit.json'), JSON.stringify(audit, null, 2));
  } finally {
    await browser.close();
    await gateway.close();
  }
});
