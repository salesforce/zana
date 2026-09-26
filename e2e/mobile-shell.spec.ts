import { mkdirSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import {
  buildBridgeInjectionScript,
  MOBILE_BRIDGE_VERSION
} from '../packages/mobile-bridge/src/index.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });
test('Mobile pairs to built Electron, uses phone navigation, reads and sends a live thread', async ({
  app
}, testInfo) => {
  test.setTimeout(process.env.ZCC_MOBILE_MAESTRO ? 480_000 : 180_000);
  const directory = join(app.home, 'mobile-project');
  mkdirSync(directory);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  git('init', '-b', 'mobile-panel-theme');
  git('config', 'user.name', 'Mobile E2E');
  git('config', 'user.email', 'mobile@example.test');
  const source = Array.from({ length: 30 }, (_, i) => `export const value${i} = ${i};`).join('\n') + '\n';
  writeFileSync(join(directory, 'theme-example.ts'), source);
  git('add', '.');
  git('commit', '-m', 'Seed mobile diff');
  writeFileSync(join(directory, 'theme-example.ts'), source.replace('value20 = 20', 'value20 = 42'));
  const scrollProjects = Array.from({ length: 18 }, (_, index) =>
    join(app.home, `scroll-project-${String(index + 1).padStart(2, '0')}`)
  );
  for (const path of scrollProjects) mkdirSync(path);
  const threadId = await app.window.evaluate(async ({ path, scrollProjects }) => {
    const projectResponse = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const { project } = await projectResponse.json();
    if (!project?.id) throw new Error('Project creation failed');
    for (const scrollPath of scrollProjects) {
      const response = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: scrollPath })
      });
      if (!response.ok) throw new Error('Scroll project creation failed');
    }
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        providerId: 'fake',
        // Let launch acknowledgement settle before the fake's completion event.
        input: 'Hello from the desktop delay:500'
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return (result.thread ?? result.value).id as string;
  }, { path: directory, scrollProjects });
  await expect(app.window.locator('.mobile-sticky-search').first()).toHaveCSS('display', 'contents');
  await expect(app.window.locator('.mobile-settings-back')).toHaveCount(0);
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({
    upstream: new URL(app.window.url()).origin,
    publicUrl: serverUrl,
    port
  });
  const browser = await chromium.launch();
  const androidAdb = process.env.ZCC_MOBILE_ADB;
  const nativeDevice = process.env.ZCC_MOBILE_DEVICE;
  let reversedAndroidPort = false;
  const runNative = promisify(execFile);
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    context.setDefaultTimeout(30_000);
    context.setDefaultNavigationTimeout(30_000);
    const code = gateway.pair();
    const paired = await context.request.post(`${serverUrl}/_mobile/pair`, {
      data: { code: code.code, label: 'E2E iPhone' }
    });
    expect(paired.ok()).toBe(true);
    const credential = await paired.json();
    const session = await context.request.post(`${serverUrl}/_mobile/session`, {
      headers: { authorization: `Bearer ${credential.credential}` }
    });
    expect(session.ok()).toBe(true);
    const seededTabs = await context.request.put(`${serverUrl}/api/v1/threads/${threadId}/tabs`, {
      data: { expectedRevision: 0, tabs: [{ id: 'mobile-saved-tab', kind: 'new-tab' }] }
    });
    expect(seededTabs.ok()).toBe(true);
    expect((await context.request.get(`${serverUrl}/internal/hosts`)).status()).toBe(404);
    // A desktop preference must not remove the contents of the phone drawer.
    await context.addInitScript(() => localStorage.setItem('zcc.sidebarCollapsed', '1'));
    await context.addInitScript({
      content: `window.ReactNativeWebView = { postMessage: (raw) => { (window.__mobileMessages ||= []).push(JSON.parse(raw)); } };\n${buildBridgeInjectionScript({ bridgeVersion: MOBILE_BRIDGE_VERSION, appVersion: '0.1.0', platform: 'ios', profileMode: 'connect', secureContext: false, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, capabilities: ['badge', 'open-native'] })}`
    });
    const phone = await context.newPage();
    const wsConnected = phone.waitForEvent('websocket', {
      predicate: (socket) => socket.url().endsWith('/ws')
    });
    await Promise.all([
      phone.goto(`${serverUrl}/threads/${threadId}`, { waitUntil: 'domcontentloaded' }),
      wsConnected
    ]);
    await expect(phone.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    const connectionMenu = phone.getByRole('button', { name: 'Connection options', exact: true });
    await expect(connectionMenu).toBeVisible();
    await connectionMenu.click();
    await expect.poll(() => phone.evaluate(() => (window as unknown as {
      __mobileMessages: unknown[];
    }).__mobileMessages)).toEqual(expect.arrayContaining([
      { type: 'shell-chrome', visible: true },
      { type: 'open-native', screen: 'connection-menu' }
    ]));
    await expect(phone.getByTestId('thread-detail')).toBeVisible();
    // Wait for actual server hydration, not just the initial closed render.
    await expect.poll(() => phone.evaluate((id) => (
      JSON.parse(localStorage.getItem(`zcc.secondaryPanel.${id}`) ?? 'null')?.tabs
    ), threadId)).toEqual([expect.objectContaining({ id: 'mobile-saved-tab' })]);
    const sidePanel = phone.getByTestId('thread-secondary-panel');
    const showPanel = phone.getByRole('button', { name: 'Show right panel', exact: true });
    await expect(sidePanel).toBeHidden();
    await expect(showPanel).toBeVisible();
    await expect(
      phone.getByText('Hello from the desktop delay:500', { exact: true }).first()
    ).toBeVisible();
    expect(await phone.evaluate(() => 'cc' in window)).toBe(false);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
    const drawer = phone.getByRole('dialog', { name: 'Navigation', exact: true });
    const expectFullscreenDrawer = async (width: number, height = 844) => {
      await expect.poll(() => drawer.boundingBox()).toEqual({ x: 0, y: 0, width, height });
      await expect(drawer).toHaveCSS('border-radius', '0px');
    };
    for (const width of [320, 390, 820]) {
      await phone.setViewportSize({ width, height: 844 });
      await expect(phone.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await expect(drawer).toBeVisible();
      await expectFullscreenDrawer(width);
      await expect(drawer.locator('.mobile-nav-brand')).toHaveText('Zana');
      await expect(drawer.locator('[data-sortable-nav-id]')).toHaveCount(0);
      await expect(drawer.locator('.sidebar-resizer')).toHaveCount(0);
      await expect(drawer.getByTestId('nav-extensions')).toBeHidden();
      await expect(drawer.getByTestId('nav-agents')).toBeVisible();
      await expect(drawer.locator('.mobile-nav-tools-list').getByTestId('nav-agents')).toHaveCount(0);
      const tools = drawer.getByRole('button', { name: 'More', exact: true });
      await expect(tools).toHaveAttribute('aria-expanded', 'false');
      await expect(drawer.getByRole('button', { name: 'Collapse Projects section' })).toBeVisible();
      await expect(drawer.getByPlaceholder('Filter projects')).toBeVisible();
      await expect(drawer.getByRole('list', { name: 'Sessions in mobile-project' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
      await phone.keyboard.press('Shift+Tab');
      await expect(drawer.getByRole('link', { name: 'Settings', exact: true })).toBeFocused();
      await phone.keyboard.press('Tab');
      await expect(drawer.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
      for (const control of [
        drawer.getByRole('button', { name: 'Close navigation', exact: true }),
        drawer.getByTestId('nav-home'), drawer.getByTestId('nav-agents'), drawer.getByTestId('nav-inbox'),
        drawer.getByTestId('nav-conversation-history'), tools,
        drawer.getByRole('button', { name: 'Collapse Projects section' }),
        drawer.getByRole('link', { name: 'Settings', exact: true })
      ]) {
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      const inbox = (await drawer.getByTestId('nav-inbox').boundingBox())!;
      const history = (await drawer.getByTestId('nav-conversation-history').boundingBox())!;
      const newChat = (await drawer.getByTestId('nav-home').boundingBox())!;
      const agents = (await drawer.getByTestId('nav-agents').boundingBox())!;
      expect(agents.x).toBe(newChat.x);
      expect(agents.width).toBe(newChat.width);
      expect(agents.y).toBeGreaterThanOrEqual(newChat.y + newChat.height);
      expect(agents.y + agents.height).toBeLessThan(inbox.y);
      expect(inbox.y).toBe(history.y);
      expect(inbox.x + inbox.width).toBeLessThan(history.x);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-navigation-${width}.png`) });
      await tools.click();
      await expect(drawer.getByTestId('nav-extensions')).toBeVisible();
      await expect(drawer.getByTestId('nav-agents')).toBeVisible();
      await expect(drawer.getByTestId('nav-scheduler')).toBeVisible();
      await expect(tools).toHaveAttribute('aria-expanded', 'true');
      await phone.screenshot({ path: testInfo.outputPath(`mobile-navigation-tools-${width}.png`) });
      await tools.click();
      // New Chat and Agents stay fixed above the scroller. Search travels with
      // the remaining menu, then pins beneath those actions as projects scroll.
      const menuScroll = drawer.locator('.mobile-sidebar-scroll');
      const search = drawer.locator('.mobile-sticky-search');
      const filter = drawer.getByPlaceholder('Filter projects');
      await menuScroll.evaluate((element) => { element.scrollTop = 0; });
      const menuTop = (await menuScroll.boundingBox())!.y;
      expect(menuTop).toBeGreaterThanOrEqual(agents.y + agents.height);
      const searchStart = (await search.boundingBox())!.y;
      const pinAt = searchStart - menuTop;
      expect(pinAt).toBeGreaterThan(100);
      await menuScroll.evaluate((element, top) => { element.scrollTop = top; }, pinAt - 24);
      await expect.poll(async () => (await search.boundingBox())!.y).toBeCloseTo(menuTop + 24, 0);
      await menuScroll.evaluate((element, top) => { element.scrollTop = top; }, pinAt + 24);
      await expect.poll(async () => (await search.boundingBox())!.y).toBeCloseTo(menuTop, 0);
      const tree = drawer.locator('.sidebar-projects-body');
      const treeTop = (await tree.boundingBox())!.y;
      await menuScroll.evaluate((element, top) => { element.scrollTop = top; }, pinAt + 180);
      await expect.poll(async () => (await search.boundingBox())!.y).toBeCloseTo(menuTop, 0);
      expect((await tree.boundingBox())!.y).toBeLessThan(treeTop - 100);
      for (const [action, initialBox] of [
        [drawer.getByTestId('nav-home'), newChat],
        [drawer.getByTestId('nav-agents'), agents]
      ] as const) {
        expect(await action.boundingBox()).toEqual(initialBox);
      }
      for (const control of [filter, drawer.getByTestId('nav-home'), drawer.getByTestId('nav-agents')]) {
        expect(await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
      }
      await phone.screenshot({ path: testInfo.outputPath(`mobile-navigation-sticky-search-${width}.png`) });
      if (width === 390) {
        await phone.setViewportSize({ width, height: 568 });
        await expectFullscreenDrawer(width, 568);
        expect(await drawer.getByTestId('nav-home').boundingBox()).toEqual(newChat);
        expect(await drawer.getByTestId('nav-agents').boundingBox()).toEqual(agents);
        await expect.poll(async () => (await search.boundingBox())!.y).toBeCloseTo(menuTop, 0);
        const scrollBox = (await menuScroll.boundingBox())!;
        expect(scrollBox.height - (await search.boundingBox())!.height).toBeGreaterThan(100);
        await phone.screenshot({ path: testInfo.outputPath('mobile-navigation-pinned-actions-short.png') });
        await phone.setViewportSize({ width, height: 844 });
      }
      await filter.fill('scroll-project-18');
      await expect(drawer.getByRole('button', { name: 'Project actions for scroll-project-18', exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Project actions for scroll-project-17', exact: true })).toHaveCount(0);
      await filter.fill('no-such-mobile-project');
      await expect(drawer.getByRole('status')).toContainText('No projects match');
      await drawer.getByRole('button', { name: 'Clear filter', exact: true }).click();
      await menuScroll.evaluate((element) => { element.scrollTop = 0; });
      await expect.poll(async () => (await search.boundingBox())!.y).toBeCloseTo(searchStart, 0);
      const collapseProject = drawer.getByRole('button', { name: /Collapse sessions for mobile-project/ });
      await collapseProject.scrollIntoViewIfNeeded();
      await expect(collapseProject).toHaveAttribute('aria-expanded', 'true');
      await collapseProject.click();
      await expect(drawer.getByRole('list', { name: 'Sessions in mobile-project' })).toBeHidden();
      const expandProject = drawer.getByRole('button', { name: /Expand sessions for mobile-project/ });
      await expect(expandProject).toHaveAttribute('aria-expanded', 'false');
      await expandProject.click();
      await expect(drawer.getByRole('list', { name: 'Sessions in mobile-project' })).toBeVisible();
      await drawer.getByRole('button', { name: /Collapse sessions for mobile-project/ }).click();
      await drawer.getByRole('button', { name: 'Collapse Projects section' }).click();
      await expect(drawer.getByPlaceholder('Filter projects')).toBeHidden();
      await drawer.getByRole('button', { name: 'Close navigation', exact: true }).click();
      await expect(drawer).toBeHidden();
      // Settings must have an exit on the page itself, including after section
      // changes and scrolling; its drawer must also dismiss on the current tab.
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await drawer.getByRole('link', { name: 'Settings', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(phone.locator('.settings-panel--preferences')).toBeVisible();
      const settingsBack = phone.locator('.titlebar > .mobile-settings-back');
      await expect(settingsBack).toHaveAttribute('href', `/threads/${threadId}`);
      const backBox = (await settingsBack.boundingBox())!;
      expect(backBox.height).toBeGreaterThanOrEqual(44);
      const menuBox = (await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).boundingBox())!;
      const settingsHeader = phone.locator('.titlebar');
      const headerBox = (await settingsHeader.boundingBox())!;
      expect(headerBox.width).toBe(width);
      expect(headerBox.height).toBe(48);
      expect(backBox.y + backBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
      expect(backBox.x + backBox.width).toBeLessThanOrEqual(menuBox.x);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
      expect((await phone.locator('.settings-panel--preferences').boundingBox())!.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
      const backAppearance = await settingsBack.evaluate((link) => {
        const style = getComputedStyle(link);
        return [style.color, style.fontSize, style.fontWeight, style.padding, style.gap];
      });
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await expect(phone.getByRole('link', { name: 'Back to app', exact: true })).toHaveCount(1);
      await expectFullscreenDrawer(width);
      const drawerBack = drawer.locator('.mobile-nav-header .mobile-settings-back');
      await expect(drawerBack).toHaveAttribute('href', `/threads/${threadId}`);
      expect(await drawerBack.evaluate((link) => {
        const style = getComputedStyle(link);
        return [style.color, style.fontSize, style.fontWeight, style.padding, style.gap];
      })).toEqual(backAppearance);
      expect((await drawer.locator('.mobile-nav-header').boundingBox())!.height).toBe(48);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-settings-menu-${width}.png`) });
      await drawerBack.click();
      await expect(drawer).toBeHidden();
      await expect(phone).toHaveURL(`${serverUrl}/threads/${threadId}`);
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await drawer.getByRole('link', { name: 'Settings', exact: true }).click();
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await drawer.getByRole('link', { name: 'Preferences', exact: true }).click();
      await expect(drawer).toBeHidden();
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await drawer.getByRole('link', { name: 'Preferences', exact: true }).click();
      await expect(drawer).toBeHidden();
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await drawer.getByRole('link', { name: 'Terminal', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(settingsBack).toHaveAttribute('href', `/threads/${threadId}`);
      await expect(phone.getByRole('heading', { name: 'Terminal', exact: true })).toBeVisible();
      await phone.locator('.settings-panel--preferences').evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
      expect(await settingsBack.boundingBox()).toEqual(backBox);
      expect(await settingsHeader.boundingBox()).toEqual(headerBox);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-settings-back-${width}.png`) });
      await settingsBack.click();
      await expect(phone).toHaveURL(`${serverUrl}/threads/${threadId}`);
      await expect(phone.getByTestId('thread-detail')).toBeVisible();
      await expect(settingsBack).toHaveCount(0);
    }
    expect(await phone.evaluate(() => localStorage.getItem('zcc.sidebarCollapsed'))).toBe('1');
    await phone.setViewportSize({ width: 390, height: 844 });
    await expect(phone.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    // The compact row moves New agent into its overflow menu, preserving the
    // project selection and handing focus back to the ordinary launcher.
    await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await drawer.getByRole('button', { name: 'Project actions for mobile-project', exact: true }).click();
    await drawer.getByRole('button', { name: 'New agent', exact: true }).click();
    await expect(drawer).toBeHidden();
    const launcher = phone.getByRole('dialog', { name: 'New agent', exact: true });
    await expect(launcher).toBeVisible();
    await phone.keyboard.press('Escape');
    await expect(launcher).toBeHidden();
    // The History action opens an overlay without changing the URL. It must
    // dismiss the drawer too, otherwise its focus trap covers the history.
    await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await drawer.getByTestId('nav-conversation-history').click();
    await expect(drawer).toBeHidden();
    await phone.keyboard.press('Escape');
    const composer = phone.getByTestId('thread-detail').getByLabel('Message', { exact: true });
    const send = phone.getByRole('button', { name: /^(Send|Send message)$/ }).first();
    const composerOptions = phone.getByRole('button', { name: 'Composer options', exact: true });
    // The isolated host's cold catalog can outlast the default 15s assertion
    // deadline while native simulators and the production build share the host.
    await expect(phone.locator('.model-reasoning-picker-trigger-skel')).toHaveCount(0, {
      timeout: 60_000
    });
    await composer.fill('Draft survives mobile options');
    for (const width of [320, 390]) {
      await phone.setViewportSize({ width, height: 844 });
      await expect(composerOptions).toHaveAttribute('aria-expanded', 'false');
      await expect(phone.getByTestId('composer-mode-picker-trigger')).toBeHidden();
      for (const button of [
        connectionMenu,
        send,
        composerOptions,
        phone.getByRole('button', { name: 'Provider and model', exact: true })
      ]) {
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      const menuBox = (await connectionMenu.boundingBox())!;
      const bellBox = (await phone.locator('.titlebar-bell').boundingBox())!;
      expect(bellBox.x + bellBox.width).toBeLessThanOrEqual(menuBox.x);
      expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );
      await expect(composer).toHaveText('Draft survives mobile options');
      await showPanel.click();
      await expect(sidePanel).toBeVisible();
      await expect(phone.locator('.thread-detail-main')).toBeHidden();
      await expect(composer).toBeHidden();
      await expect(phone.getByTestId('thread-secondary-maximize')).toBeHidden();
      const panelBox = (await sidePanel.boundingBox())!;
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.width).toBeGreaterThanOrEqual(width - 4);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
      expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await phone.screenshot({ path: testInfo.outputPath(`zana-mobile-panel-${width}.png`) });
      await sidePanel.getByTestId('thread-diff-pin').click();
      const hunks = sidePanel.getByTestId('thread-diff-hunks');
      await expect(hunks).toBeVisible();
      // Neutral rows and the tab strip inherit the panel background. A stale
      // narrow-screen fallback must not put light-mode text on a dark surface.
      for (const theme of ['light', 'dark', 'light'] as const) {
        await phone.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        const background = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(30, 30, 30)';
        await expect(sidePanel).toHaveCSS('background-color', background);
        for (const surface of [
          sidePanel.getByTestId('thread-secondary-chrome'),
          hunks.locator('.thread-diff-hunk-line.is-context .thread-diff-hunk-code').first()
        ]) {
          await expect.poll(() => surface.evaluate((node) => {
            let current: Element | null = node;
            while (current) {
              const color = getComputedStyle(current).backgroundColor;
              if (color !== 'rgba(0, 0, 0, 0)') return color;
              current = current.parentElement;
            }
            return 'transparent';
          })).toBe(background);
        }
        await expect(hunks.locator('code').first()).toHaveCSS('color',
          theme === 'light' ? 'rgb(36, 41, 46)' : 'rgb(230, 237, 243)');
        await phone.screenshot({ path: testInfo.outputPath(`mobile-diff-${width}-${theme}.png`) });
      }
      await sidePanel.getByRole('button', { name: 'Close panel', exact: true }).click();
      await expect(sidePanel).toBeHidden();
      await expect(composer).toBeVisible();
      await expect(composer).toHaveText('Draft survives mobile options');
    }
    await composerOptions.click();
    await expect(composerOptions).toHaveAttribute('aria-expanded', 'true');
    await expect(
      phone.getByRole('group', { name: 'Additional composer controls', exact: true })
    ).toBeVisible();
    await expect(phone.getByTestId('composer-mode-picker-trigger')).toBeVisible();
    await expect(phone.getByTestId('composer-send-mode-picker')).toBeVisible();
    await phone.screenshot({ path: testInfo.outputPath('zana-mobile-composer-options.png') });
    await phone.keyboard.press('Escape');
    await expect(composerOptions).toHaveAttribute('aria-expanded', 'false');
    await expect(composer).toHaveText('Draft survives mobile options');
    await composerOptions.click();
    await composer.focus();
    await expect(composerOptions).toHaveAttribute('aria-expanded', 'false');
    const modelTrigger = phone.getByRole('button', { name: 'Provider and model', exact: true });
    await modelTrigger.click();
    const modelMenu = phone.getByRole('dialog', { name: 'Provider and model', exact: true });
    await expect(modelMenu).toBeVisible();
    const modelRow = modelMenu.locator('.model-reasoning-picker-row').first();
    await expect(modelRow).toBeVisible();
    expect((await modelRow.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await modelTrigger.click();
    // Use editing keystrokes so ProseMirror observes the deletion transaction.
    await composer.press('ControlOrMeta+A');
    await composer.press('Backspace');
    await expect(composer).toHaveText('');
    await composer.focus();
    await expect(phone.locator('.sponsor-nudge')).toBeHidden();
    await expect(composer).toBeVisible();
    await expect(composer.locator('p.is-editor-empty').first()).toHaveAttribute(
      'data-placeholder',
      /Ask/
    );
    await phone.screenshot({ path: testInfo.outputPath('zana-mobile-composer.png') });
    if (process.env.ZCC_MOBILE_MAESTRO) {
      // Force native swipes through the renderer's inner scroll area. A short
      // conversation fits on screen and cannot detect disabled WebView scrolling.
      await composer.fill(
        'Mobile scroll regression\n\n' +
          Array.from(
            { length: 12 },
            (_, i) => `Scroll checkpoint ${i + 1}: keep this conversation readable on a phone.`
          ).join('\n\n')
      );
      // The first follow-up also applies model/options to the isolated host.
      // Await its HTTP acknowledgement explicitly before checking the reply.
      const [sent] = await Promise.all([
        phone.waitForResponse(
          (response) => response.url().endsWith(`/api/v1/threads/${threadId}/send`)
            && response.request().method() === 'POST',
          { timeout: 60_000 }
        ),
        send.click()
      ]);
      expect(sent.ok()).toBe(true);
      await expect(
        phone.getByText('Response to: Mobile scroll regression', { exact: true })
      ).toBeVisible();
    }
    await composer.fill('Hello from the phone');
    await send.click();
    await expect(phone.getByText('Hello from the phone', { exact: true }).first()).toBeVisible();
    await phone.screenshot({ path: testInfo.outputPath('zana-mobile-thread.png') });
    await showPanel.click();
    await expect(sidePanel).toBeVisible();
    await expect.poll(() => phone.evaluate((id) => (
      JSON.parse(localStorage.getItem(`zcc.secondaryPanel.${id}`) ?? 'null')?.isOpen
    ), threadId)).toBe(true);
    await phone.reload();
    await expect(showPanel).toBeVisible();
    await expect(sidePanel).toBeHidden();
    await expect(composer).toBeVisible();
    await expect.poll(() => phone.evaluate((id) => (
      JSON.parse(localStorage.getItem(`zcc.secondaryPanel.${id}`) ?? 'null')?.tabs
    ), threadId)).toEqual([expect.objectContaining({ id: 'mobile-saved-tab' })]);
    // Optional real iOS/Android shell acceptance against this same isolated
    // production server. The default test remains independent of native SDKs.
    if (process.env.ZCC_MOBILE_MAESTRO) {
      // A per-test reverse keeps both platforms on the same loopback gateway.
      // Never bind the production server to the LAN just to test Android.
      if (androidAdb) {
        if (!nativeDevice) throw new Error('ZCC_MOBILE_ADB requires ZCC_MOBILE_DEVICE.');
        await runNative(
          androidAdb,
          ['-s', nativeDevice, 'reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`],
          { timeout: 10_000 }
        );
        reversedAndroidPort = true;
      }
      const pairing = gateway.pair();
      const pairLink = `zana://connect?payload=${encodeURIComponent(JSON.stringify(pairing))}`;
      const threadLink = `zana://open?server=${encodeURIComponent(serverUrl)}&path=${encodeURIComponent(`/threads/${threadId}`)}`;
      try {
        const native = await runNative(
          process.env.ZCC_MOBILE_MAESTRO,
          [
            ...(process.env.ZCC_MOBILE_DEVICE ? ['--device', process.env.ZCC_MOBILE_DEVICE] : []),
            'test',
            '--test-output-dir',
            testInfo.outputPath('native'),
            '-e',
            `PAIR_LINK=${pairLink}`,
            '-e',
            `THREAD_LINK=${threadLink}`,
            'apps/mobile/e2e/flows/paired-thread.yaml'
          ],
          { timeout: 420_000, maxBuffer: 2 * 1024 * 1024 }
        );
        writeFileSync(testInfo.outputPath('native-acceptance.log'), native.stdout + native.stderr);
      } catch (error) {
        const failure = error as Error & {
          stdout?: string;
          stderr?: string;
          code?: unknown;
          signal?: string;
        };
        writeFileSync(
          testInfo.outputPath('native-acceptance.log'),
          `${failure.message}\nExit: ${failure.code}, signal: ${failure.signal}\n${failure.stdout ?? ''}${failure.stderr ?? ''}`
        );
        throw error;
      }
    }
    await phone.setViewportSize({ width: 1280, height: 1180 });
    await expect(phone.locator('.app-shell')).toHaveAttribute('data-mobile', 'false');
    await expect(composerOptions).toBeHidden();
    await expect(phone.getByTestId('composer-mode-picker-trigger')).toBeVisible();
    await showPanel.click();
    await expect(sidePanel).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(phone.getByTestId('thread-secondary-maximize')).toBeVisible();
    await phone.setViewportSize({ width: 390, height: 844 });
    await expect(showPanel).toBeVisible();
    await expect(sidePanel).toBeHidden();
    await expect(composer).toBeVisible();
    await phone.setViewportSize({ width: 1280, height: 1180 });
    await phone.reload();
    await expect(phone.getByTestId('thread-detail')).toBeVisible();
    gateway.revoke(credential.deviceId);
    expect((await context.request.get(`${serverUrl}/api/v1/projects`)).status()).toBe(401);
    await composer.fill('This revoked device must be rejected');
    await send.click();
    await expect
      .poll(() =>
        phone.evaluate(() =>
          (
            (window as unknown as { __mobileMessages: Array<{ type: string }> }).__mobileMessages ??
            []
          ).some((message) => message.type === 'auth-required')
        )
      )
      .toBe(true);
    // The desktop continues to use its original local transport.
    expect(await app.window.evaluate(async () => (await fetch('/api/v1/projects')).status)).toBe(
      200
    );
  } finally {
    if (reversedAndroidPort) {
      await runNative(androidAdb!, ['-s', nativeDevice!, 'reverse', '--remove', `tcp:${port}`], {
        timeout: 10_000
      }).catch((error) => console.warn('Android test port cleanup failed:', error.message));
    }
    await browser.contexts()[0]?.tracing.stop({ path: testInfo.outputPath('phone-trace.zip') });
    await browser.close();
    await gateway.close();
  }
});
