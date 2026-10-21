import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import {
  buildBridgeInjectionScript,
  MOBILE_BRIDGE_VERSION
} from '../packages/mobile-bridge/src/index.js';

// The composer mic only renders once Settings → Experimental → voice input is on (#377).
test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { voiceInputEnabled: true } });
test('Mobile pairs to built Electron, uses phone navigation, reads and sends a live thread', async ({
  app
}, testInfo) => {
  test.setTimeout(180_000);
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
      content: `window.ReactNativeWebView = { postMessage: (raw) => {
        const message = JSON.parse(raw);
        (window.__mobileMessages ||= []).push(message);
        if (message.type === 'request' && message.request.kind === 'share') queueMicrotask(() =>
          window.zccMobile.native.__receive({ type: 'response', id: message.id, response: { ok: true, result: 'dismissed' } }));
      } };\n${buildBridgeInjectionScript({ bridgeVersion: MOBILE_BRIDGE_VERSION, appVersion: '0.1.0', platform: 'ios', profileMode: 'connect', secureContext: false, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, capabilities: ['badge', 'share', 'open-native'] })}`
    });
    const phone = await context.newPage();
    let checkActiveHeader = true;
    const longMobileMessage = 'Review this mobile layout carefully.\n\n' +
      Array.from({ length: 24 }, (_, i) => `Instruction ${i + 1}: Keep the agent response readable on a small screen.`).join('\n\n') +
      '\n\nFinal mobile preview instruction.';
    const previewImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=';
    const headerTitle = 'Review the mobile navigation and keep a long agent title readable';
    await phone.route((url) => url.pathname === `/api/v1/threads/${threadId}`, async (route) => {
      const response = await route.fetch();
      if (!checkActiveHeader) return route.fulfill({ response });
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, thread: {
        ...body.thread, title: headerTitle, status: 'active',
        runtime: { ...body.thread.runtime, displayStatus: 'active' }
      } } });
    });
    // Exercise the populated settings footer from the reported phone overlap.
    // Keep the real timeline, adding deterministic presentation-only usage.
    await phone.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body,
        rows: checkActiveHeader ? body.rows.map((row: { kind: string; role?: string }) => {
          if (row.kind !== 'conversation') return row;
          return row.role === 'user' ? {
            ...row, text: longMobileMessage,
            attachments: { webImages: 1, localImages: 0, localFiles: 0, imageUrls: [previewImage], localImagePaths: [], localFilePaths: [] }
          } : { ...row, text: 'The agent response continues below the compact prompt.\n\n'.repeat(20) };
        }) : body.rows,
        contextWindowUsage: {
        usedTokens: 47_000, modelContextWindow: 100_000, estimated: false
      } } });
    });
    await phone.route('**/api/v1/system/voice-status', (route) => route.fulfill({ json: { enabled: true, reason: null } }));
    const wsConnected = phone.waitForEvent('websocket', {
      predicate: (socket) => socket.url().endsWith('/ws')
    });
    await Promise.all([
      phone.goto(`${serverUrl}/threads/${threadId}`, { waitUntil: 'domcontentloaded' }),
      wsConnected
    ]);
    await expect(phone.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    const openNavigation = async () => {
      const back = phone.getByRole('link', { name: 'Back to agents', exact: true });
      if (await back.isVisible()) await back.click();
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    };
    const agentMenu = phone.getByTestId('thread-overflow-trigger');
    await expect(phone.getByRole('button', { name: 'Connection options', exact: true })).toHaveCount(0);
    await expect.poll(() => phone.evaluate(() => (window as unknown as {
      __mobileMessages: unknown[];
    }).__mobileMessages)).toEqual(expect.arrayContaining([
      { type: 'shell-chrome', visible: true }
    ]));
    await openNavigation();
    const deviceOptions = phone.getByRole('button', { name: 'Device options', exact: true });
    const deviceActions = phone.getByRole('menu', { name: 'Device actions', exact: true });
    await expect(deviceActions).toHaveCount(0);
    await expect(phone.locator('.mobile-nav-header').getByRole('button', { name: 'Device options' })).toBeVisible();
    for (const width of [320, 390, 820]) {
      await phone.setViewportSize({ width, height: 844 });
      const agentsBox = (await phone.locator('.mobile-agent-navigation').boundingBox())!;
      await deviceOptions.click();
      const optionsBox = (await deviceActions.boundingBox())!;
      expect(optionsBox.x).toBeGreaterThanOrEqual(0);
      expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(width);
      expect((await deviceOptions.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await phone.locator('.mobile-agent-navigation').boundingBox())!.height).toBe(agentsBox.height);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-device-options-${width}.png`) });
      await phone.keyboard.press('Escape');
      await expect(deviceActions).toHaveCount(0);
      await expect(phone.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible();
      await expect(deviceOptions).toBeFocused();
    }
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.screenshot({ path: testInfo.outputPath('mobile-navigation-compact.png') });
    await deviceOptions.click();
    await deviceActions.getByRole('menuitem', { name: 'Share', exact: true }).click();
    await expect.poll(() => phone.evaluate(() => (window as unknown as { __mobileMessages: unknown[] }).__mobileMessages))
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'request', request: { kind: 'share', payload: { url: `${serverUrl}/agents` } } })]));
    await expect(deviceActions).toHaveCount(0);
    await deviceOptions.click();
    await expect(deviceActions.getByRole('menuitem', { name: 'Share', exact: true })).toBeEnabled();
    await deviceActions.getByRole('menuitem', { name: 'This device', exact: true }).click();
    await expect.poll(() => phone.evaluate(() => (window as unknown as { __mobileMessages: unknown[] }).__mobileMessages))
      .toContainEqual({ type: 'open-native', screen: 'device-settings' });
    await expect(deviceActions).toHaveCount(0);
    await deviceOptions.click();
    const oldDocument = await phone.evaluate(() => performance.timeOrigin);
    await Promise.all([phone.waitForEvent('load'), deviceActions.getByRole('menuitem', { name: 'Reload', exact: true }).click()]);
    expect(await phone.evaluate(() => performance.timeOrigin)).toBeGreaterThan(oldDocument);
    await expect(phone).toHaveURL(`${serverUrl}/agents`);
    await phone.goto(`${serverUrl}/threads/${threadId}`);
    await expect(phone.getByTestId('thread-detail')).toBeVisible();
    const shellTitle = phone.locator('.mobile-thread-title-slot h1');
    const threadHeader = phone.locator('.thread-detail-header');
    for (const width of [320, 390, 820]) {
      await phone.setViewportSize({ width, height: 844 });
      await expect(phone.getByTestId('thread-prompt-context')).toHaveCount(0);
      await expect(phone.getByTestId('thread-workspace-banner')).toHaveCount(0);
      await expect(phone.locator('.thread-composer-dock .ui-command-composer')).not.toHaveCSS('border-top-left-radius', '0px');
      await expect(shellTitle).toHaveText(headerTitle);
      await expect(phone.locator('.titlebar-title')).toBeHidden();
      await expect(threadHeader.locator('h1')).toHaveCount(0);
      await expect(phone.getByTestId('thread-detail-status')).toBeVisible();
      const shellBox = (await phone.locator('.titlebar').boundingBox())!;
      await expect(threadHeader).toBeHidden();
      // Wait for the mobile search/header styles to settle after resize and hydration.
      await expect.poll(async () => (await shellTitle.boundingBox())?.width ?? 0).toBeGreaterThan(60);
      const titleBox = (await shellTitle.boundingBox())!;
      expect(titleBox.y).toBeGreaterThanOrEqual(shellBox.y);
      expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(shellBox.y + shellBox.height);
      expect(shellBox.height).toBe(48);
      expect((await phone.getByTestId('thread-timeline').boundingBox())!.y).toBeLessThanOrEqual(56);
      const searchToggle = phone.getByRole('menuitem', { name: 'Search in thread', exact: true });
      const panelToggle = phone.getByRole('button', { name: 'Show right panel', exact: true });
      const overflow = phone.getByTestId('thread-overflow-trigger');
      const controls = [panelToggle];
      for (const button of controls) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.y).toBeGreaterThanOrEqual(shellBox.y);
        expect(box.y + box.height).toBeLessThanOrEqual(shellBox.y + shellBox.height);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await expect(phone.locator('.mobile-thread-controls-slot').getByTestId('thread-overflow-trigger')).toBeVisible();
      await expect(threadHeader.getByTestId('thread-overflow-trigger')).toHaveCount(0);
      const overflowBox = (await overflow.boundingBox())!;
      await expect(phone.locator('.titlebar-bell')).toBeHidden();
      expect(overflowBox.width).toBeGreaterThanOrEqual(44);
      expect(overflowBox.height).toBeGreaterThanOrEqual(44);
      expect(overflowBox.y).toBeGreaterThanOrEqual(shellBox.y);
      expect(overflowBox.y + overflowBox.height).toBeLessThanOrEqual(shellBox.y + shellBox.height);
      const statusBox = (await phone.getByTestId('thread-detail-status').boundingBox())!;
      await phone.screenshot({ path: testInfo.outputPath(`mobile-header-controls-${width}.png`) });
      // The direct Agents return uses one additional 44px target in this same row.
      const agentsBackBox = (await phone.getByRole('link', { name: 'Back to agents', exact: true }).boundingBox())!;
      expect(agentsBackBox.width).toBeGreaterThanOrEqual(44);
      expect(agentsBackBox.x + agentsBackBox.width).toBeLessThanOrEqual(titleBox.x);
      expect(titleBox.width).toBeGreaterThan(60);
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(statusBox.x);
      expect(statusBox.width).toBeLessThanOrEqual(20);
      const panelToggleBox = (await panelToggle.boundingBox())!;
      expect(panelToggleBox.x + panelToggleBox.width).toBeLessThanOrEqual(overflowBox.x);
      expect(overflowBox.x + overflowBox.width).toBe(width - 4);
      await panelToggle.focus();
      await phone.keyboard.press('Tab');
      await expect(overflow).toBeFocused();
      await overflow.click();
      await searchToggle.tap();
      const search = phone.getByRole('searchbox', { name: 'Search in thread', exact: true });
      await expect(search).toBeFocused();
      await expect(searchToggle).toBeHidden();
      await search.fill('desktop');
      await expect(threadHeader).toBeHidden();
      expect((await phone.locator('.titlebar').boundingBox())!.height).toBe(48);
      const searchBox = (await search.boundingBox())!;
      const panelBox = (await panelToggle.boundingBox())!;
      expect(searchBox.width).toBeGreaterThan(60);
      const searchStatus = (await phone.getByTestId('thread-detail-status').boundingBox())!;
      expect(searchBox.x).toBeGreaterThanOrEqual(searchStatus.x + searchStatus.width);
      const searchOverflowBox = (await overflow.boundingBox())!;
      expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(searchOverflowBox.x);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(searchOverflowBox.x);
      expect(searchOverflowBox.x + searchOverflowBox.width).toBe(width - 4);
      await phone.getByRole('button', { name: 'Close search', exact: true }).click();
      await expect(shellTitle).toBeVisible();
      await expect(search).toHaveCount(0);
      await expect(phone.getByRole('button', { name: 'Close search', exact: true })).toBeHidden();
      await overflow.click();
      await expect(phone.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();
      for (const item of await phone.getByRole('menu', { name: 'Agent actions', exact: true }).getByRole('menuitem').all()) {
        const box = (await item.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await phone.keyboard.press('Escape');
      const prompt = phone.getByTestId('thread-user-text').first();
      const preview = prompt.locator('.mobile-message-preview');
      const more = preview.getByRole('button', { name: 'Show more', exact: true });
      await expect(more).toBeVisible();
      const promptBox = (await prompt.boundingBox())!;
      expect(promptBox.height).toBeLessThanOrEqual(140);
      expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await preview.locator('.composer-image-thumb-preview').boundingBox())!.height).toBe(44);
      await more.click();
      await expect(preview).toHaveAttribute('data-expanded', 'true');
      await expect(prompt.getByText('Final mobile preview instruction.', { exact: true })).toHaveCount(1);
      await expect(prompt.locator('..')).toHaveCSS('position', 'relative');
      // Expansion must leave the top of the prompt in view, not follow the reply.
      await expect.poll(async () => (await preview.locator('.mobile-message-preview-viewport').boundingBox())!.y).toBeGreaterThanOrEqual(
        (await phone.getByTestId('thread-timeline').boundingBox())!.y - 1
      );
      await preview.getByRole('button', { name: 'Show less', exact: true }).click();
      await expect(more).toBeVisible();
      expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(140);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-single-row-header-${width}.png`) });
    }
    await phone.setViewportSize({ width: 1280, height: 844 });
    await expect(shellTitle).toHaveCount(0);
    await expect(threadHeader.getByRole('heading', { name: headerTitle, exact: true })).toBeVisible();
    await expect(threadHeader.getByTestId('thread-overflow-trigger')).toBeVisible();
    await expect(phone.locator('.titlebar-title')).toBeVisible();
    await expect(phone.getByTestId('thread-prompt-context')).toContainText('git: mobile-panel-theme');
    // The workspace status is host-backed and mounts for the first time on
    // desktop. Wait for the real dirty-workspace precondition before its UI.
    const loadedThread = await (await context.request.get(`${serverUrl}/api/v1/threads/${threadId}`)).json();
    const environmentId = loadedThread.thread.environmentId;
    expect(environmentId).toBeTruthy();
    await expect.poll(async () => {
      const response = await context.request.get(`${serverUrl}/api/v1/environments/${environmentId}/status`);
      if (!response.ok()) return `HTTP ${response.status()}`;
      const status = await response.json();
      return status.dirty && status.files.some((file: { path: string }) => file.path === 'theme-example.ts');
    }, { timeout: 30_000 }).toBe(true);
    await expect(phone.getByTestId('thread-workspace-banner')).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByTestId('thread-workspace-review')).toBeVisible();
    await expect(phone.locator('.mobile-message-preview')).toHaveCount(0);
    checkActiveHeader = false;
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.reload();
    await expect(shellTitle).toHaveText('Hello from the desktop delay:500');
    await expect(phone.getByTestId('thread-user-text').first().getByRole('button', { name: 'Show more', exact: true })).toHaveCount(0);
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
      await openNavigation();
      await expect(drawer).toBeVisible();
      await expectFullscreenDrawer(width);
      await expect(drawer.locator('.mobile-nav-brand')).toHaveText('Zana');
      await expect(drawer.locator('[data-sortable-nav-id]')).toHaveCount(0);
      await expect(drawer.locator('.sidebar-resizer')).toHaveCount(0);
      await expect(drawer.getByRole('link', { name: 'New agent', exact: true })).toBeVisible();
      await expect(drawer.getByTestId('mobile-nav-inbox')).toBeVisible();
      const overviewShortcut = drawer.getByTestId('mobile-nav-agents');
      await expect(overviewShortcut).toHaveAttribute('href', '/agents');
      const shortcutBoxes = await Promise.all([
        overviewShortcut, drawer.getByTestId('mobile-nav-inbox'), drawer.getByRole('button', { name: 'More', exact: true })
      ].map((shortcut) => shortcut.boundingBox()));
      for (const box of shortcutBoxes) {
        expect(box!.y).toBe(shortcutBoxes[0]!.y);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await phone.screenshot({ path: testInfo.outputPath(`mobile-agents-shortcut-${width}.png`) });
      await expect(deviceOptions).toBeFocused();
      await deviceOptions.click();
      const deviceMenuBox = (await deviceActions.boundingBox())!;
      expect(deviceMenuBox.y + deviceMenuBox.height).toBeLessThanOrEqual(844);
      for (const label of ['Share', 'Reload', 'This device']) {
        const box = (await deviceActions.getByRole('menuitem', { name: label, exact: true }).boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await phone.keyboard.press('Escape');
      await expect(deviceActions).toHaveCount(0);
      await expect(drawer.getByRole('searchbox', { name: 'Search agents' })).toBeVisible();
      await expect(drawer.getByTestId('nav-agents')).toHaveCount(0);
      await expect(deviceOptions).toBeFocused();
      await phone.keyboard.press('Shift+Tab');
      await expect(deviceOptions).not.toBeFocused();
      await phone.keyboard.press('Tab');
      await expect(deviceOptions).toBeFocused();
      {
        await overviewShortcut.click();
        await expect(phone).toHaveURL(`${serverUrl}/agents`);
        await expect(drawer).toBeHidden();
        await phone.getByRole('button', { name: 'Agents actions', exact: true }).click();
        const boardView = phone.getByRole('button', { name: 'Board view', exact: true });
        const listView = phone.getByRole('button', { name: 'List view', exact: true });
        await expect(phone.getByRole('button', { name: 'Canvas view', exact: true })).toBeVisible();
        await boardView.click();
        const newAgent = phone.getByTestId('agents-board-new-thread');
        await expect(newAgent).toHaveAttribute('aria-label', 'New agent');
        const newAgentBox = (await newAgent.boundingBox())!;
        const pageHeaderBox = (await phone.locator('.titlebar').boundingBox())!;
        expect(newAgentBox.height).toBeGreaterThanOrEqual(44);
        expect(newAgentBox.width).toBe(44);
        expect(newAgentBox.y + newAgentBox.height).toBeLessThanOrEqual(pageHeaderBox.y + pageHeaderBox.height);
        const agentsFilterBox = (await phone.getByRole('textbox', { name: 'Filter agents', exact: true }).boundingBox())!;
        expect(agentsFilterBox.y).toBeGreaterThanOrEqual(pageHeaderBox.y + pageHeaderBox.height);
        await phone.screenshot({ path: testInfo.outputPath(`mobile-new-agent-button-${width}.png`) });
        await expect(phone.getByTestId('mobile-agent-board')).toBeVisible();
        await phone.getByRole('button', { name: 'Agents actions', exact: true }).click();
        await listView.click();
        await expect(phone.locator('.agent-monitor-list')).toBeVisible();
        await openNavigation();
        await expect(overviewShortcut).toHaveAttribute('aria-current', 'page');
        await overviewShortcut.click();
        await expect(drawer).toBeHidden();
        await phone.getByRole('button', { name: 'Agents actions', exact: true }).click();
        await expect(listView).toHaveAttribute('aria-pressed', 'true');
        await phone.getByRole('button', { name: 'Close actions', exact: true }).click();
        await openNavigation();
        await drawer.locator(`.mobile-agent-row[href="/threads/${threadId}"]`).click();
        await expect(phone.getByTestId('thread-detail')).toBeVisible();
        await openNavigation();
      }
      await drawer.getByRole('button', { name: 'More', exact: true }).click();
      await expect(drawer.getByRole('button', { name: 'All agents', exact: true })).toBeFocused();
      await drawer.getByRole('button', { name: 'Close navigation', exact: true }).focus();
      await expect(drawer.getByRole('heading', { name: 'Plugins & tools' })).toBeVisible();
      await expect(drawer.getByTestId('nav-extensions')).toBeVisible();
      await expect(drawer.getByTestId('nav-agents')).toBeVisible();
      await expect(drawer.getByTestId('nav-scheduler')).toBeVisible();
      await expect(drawer.getByTestId('nav-home')).toHaveCount(0);
      await expect(drawer.getByTestId('nav-inbox')).toHaveCount(0);
      // More lives in the utility bar beside Settings, so it stays in the drawer's tools view.
      await expect(drawer.getByRole('button', { name: 'More', exact: true })).toBeVisible();
      const toolsSearch = drawer.getByRole('searchbox', { name: 'Search plugins and tools' });
      const toolsSearchBox = (await toolsSearch.boundingBox())!;
      const tiles = drawer.locator('.mobile-tools-grid > :is(a, button)');
      expect(await tiles.count()).toBeGreaterThanOrEqual(5);
      for (const tile of await tiles.all()) {
        const box = (await tile.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(72);
        expect(box.height).toBeGreaterThanOrEqual(72);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      const firstTile = (await tiles.nth(0).boundingBox())!;
      const secondTile = (await tiles.nth(1).boundingBox())!;
      expect(firstTile.y).toBe(secondTile.y);
      expect(secondTile.x).toBeGreaterThan(firstTile.x + firstTile.width);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-navigation-tools-${width}.png`) });
      await toolsSearch.fill('SCHED');
      await expect(drawer.getByTestId('nav-scheduler')).toBeVisible();
      await expect(drawer.getByTestId('nav-agents')).toHaveCount(0);
      await toolsSearch.fill('no-such-plugin');
      await expect(drawer.getByRole('status')).toContainText('No plugins or tools match');
      await drawer.getByRole('button', { name: 'Clear tools search' }).click();
      await expect(toolsSearch).toBeFocused();
      await drawer.locator('.mobile-tools-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
      expect(await toolsSearch.boundingBox()).toEqual(toolsSearchBox);
      await drawer.getByRole('button', { name: 'Projects', exact: true }).click();
      const pickerBack = drawer.getByRole('button', { name: 'Plugins & tools', exact: true });
      await expect(pickerBack).toBeFocused();
      await expect(drawer.getByRole('list', { name: 'Sessions in mobile-project' })).toBeVisible();
      const menuScroll = drawer.locator('.mobile-tools-section');
      const search = drawer.locator('.mobile-sticky-search');
      const filter = drawer.getByPlaceholder('Filter projects');
      await expect(filter).toBeVisible();
      await menuScroll.evaluate(element => { element.scrollTop = 250; });
      const menuTop = (await menuScroll.boundingBox())!.y;
      await expect.poll(async () => (await search.boundingBox())!.y).toBeCloseTo(menuTop, 0);
      if (width === 390) {
        await phone.setViewportSize({ width, height: 568 });
        await expectFullscreenDrawer(width, 568);
        await expect(filter).toBeVisible();
        expect((await menuScroll.boundingBox())!.height).toBeGreaterThan(100);
        await phone.screenshot({ path: testInfo.outputPath('mobile-project-picker-short.png') });
        await phone.setViewportSize({ width, height: 844 });
      }
      await filter.fill('scroll-project-18');
      await expect(drawer.getByRole('button', { name: 'Project actions for scroll-project-18', exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Project actions for scroll-project-17', exact: true })).toHaveCount(0);
      await filter.fill('no-such-mobile-project');
      await expect(drawer.getByRole('status')).toContainText('No projects match');
      await drawer.getByRole('button', { name: 'Clear filter', exact: true }).click();
      await menuScroll.evaluate(element => { element.scrollTop = 0; });
      const collapseProject = drawer.getByRole('button', { name: /Collapse sessions for mobile-project/ });
      await expect(collapseProject).toHaveAttribute('aria-expanded', 'true');
      await collapseProject.click();
      await expect(drawer.getByRole('list', { name: 'Sessions in mobile-project' })).toBeHidden();
      await drawer.getByRole('button', { name: /Expand sessions for mobile-project/ }).click();
      await expect(drawer.getByRole('list', { name: 'Sessions in mobile-project' })).toBeVisible();
      await pickerBack.click();
      await expect(drawer.getByRole('button', { name: 'Projects', exact: true })).toBeFocused();
      await expect(drawer.getByTestId('nav-extensions')).toBeVisible();
      await drawer.getByRole('button', { name: 'Close navigation', exact: true }).click();
      await expect(drawer).toBeHidden();
      // Settings must have an exit on the page itself, including after section
      // changes and scrolling; its drawer must also dismiss on the current tab.
      await openNavigation();
      await drawer.getByRole('button', { name: 'More', exact: true }).click();
      await drawer.getByRole('link', { name: 'Settings', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(phone.locator('.settings-panel--preferences')).toBeVisible();
      await expect(phone.locator('.mobile-thread-title-slot')).toBeEmpty();
      const settingsBack = phone.locator('.titlebar > .mobile-settings-back');
      await expect(settingsBack).toHaveAttribute('href', '/agents');
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
      await openNavigation();
      await expect(phone.getByRole('link', { name: 'Back to app', exact: true })).toHaveCount(1);
      await expectFullscreenDrawer(width);
      const drawerBack = drawer.locator('.mobile-nav-header .mobile-settings-back');
      await expect(drawerBack).toHaveAttribute('href', '/agents');
      expect(await drawerBack.evaluate((link) => {
        const style = getComputedStyle(link);
        return [style.color, style.fontSize, style.fontWeight, style.padding, style.gap];
      })).toEqual(backAppearance);
      expect((await drawer.locator('.mobile-nav-header').boundingBox())!.height).toBe(48);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-settings-menu-${width}.png`) });
      await drawerBack.click();
      await expect(drawer).toBeHidden();
      await expect(phone).toHaveURL(`${serverUrl}/agents`);
      await openNavigation();
      await drawer.getByRole('button', { name: 'More', exact: true }).click();
      await drawer.getByRole('link', { name: 'Settings', exact: true }).click();
      await openNavigation();
      await drawer.getByRole('link', { name: 'Preferences', exact: true }).click();
      await expect(drawer).toBeHidden();
      await openNavigation();
      await drawer.getByRole('link', { name: 'Preferences', exact: true }).click();
      await expect(drawer).toBeHidden();
      await openNavigation();
      await drawer.getByRole('link', { name: 'Terminal', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(settingsBack).toHaveAttribute('href', '/agents');
      await expect(phone.getByRole('heading', { name: 'Terminal', exact: true })).toBeVisible();
      await phone.locator('.settings-panel--preferences').evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
      expect(await settingsBack.boundingBox()).toEqual(backBox);
      expect(await settingsHeader.boundingBox()).toEqual(headerBox);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-settings-back-${width}.png`) });
      await settingsBack.click();
      await expect(phone).toHaveURL(`${serverUrl}/agents`);
      await expect(phone.locator('.agents-board')).toBeVisible();
      await expect(settingsBack).toHaveCount(0);
    }
    expect(await phone.evaluate(() => localStorage.getItem('zcc.sidebarCollapsed'))).toBe('1');
    await phone.setViewportSize({ width: 390, height: 844 });
    await expect(phone.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    // The compact row moves New agent into its overflow menu, preserving the
    // project selection and handing focus back to the ordinary launcher.
    await openNavigation();
    await drawer.getByRole('button', { name: 'More', exact: true }).click();
    await drawer.getByRole('button', { name: 'Projects', exact: true }).click();
    await drawer.getByRole('button', { name: 'Project actions for mobile-project', exact: true }).click();
    await drawer.getByRole('button', { name: 'New agent', exact: true }).click();
    await expect(drawer).toBeHidden();
    const launcher = phone.getByRole('dialog', { name: 'New agent', exact: true });
    await expect(launcher).toBeVisible();
    await phone.keyboard.press('Escape');
    await expect(launcher).toBeHidden();
    // The History action opens an overlay without changing the URL. It must
    // dismiss the drawer too, otherwise its focus trap covers the history.
    await openNavigation();
    await drawer.getByRole('button', { name: 'More', exact: true }).click();
    await drawer.getByTestId('nav-conversation-history').click();
    await expect(drawer).toBeHidden();
    await phone.keyboard.press('Escape');
    await phone.goto(`${serverUrl}/threads/${threadId}`);
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
      await composer.tap();
      await expect(composerOptions).toHaveAttribute('aria-expanded', 'false');
      await expect(phone.getByTestId('composer-mode-picker-trigger')).toBeHidden();
      for (const button of [
        agentMenu,
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
      await expect(phone.locator('.titlebar-bell')).toBeHidden();
      await expect(phone.locator('.titlebar').getByTestId('thread-overflow-trigger')).toBeVisible();
      expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );
      await expect(composer).toHaveText('Draft survives mobile options');
      await phone.getByTestId('thread-command-expand').click();
      const expandedComposer = phone.getByRole('dialog', { name: 'Write a message', exact: true });
      await expect.poll(() => expandedComposer.boundingBox()).toEqual({ x: 0, y: 0, width, height: 844 });
      expect((await composer.boundingBox())!.height).toBeGreaterThan(600);
      await expandedComposer.getByRole('button', { name: 'Done', exact: true }).press('Escape');
      await expect(expandedComposer).toHaveCount(0);
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
      await sidePanel.getByRole('button', { name: 'Choose panel view', exact: true }).click();
      await sidePanel.getByTestId('thread-info-pin').click();
      const workspace = sidePanel.getByTestId('environment-actions');
      await expect(workspace).toBeVisible();
      const changesDisclosure = workspace.locator('details').filter({ hasText: /changed files?/ }).first();
      try {
        await expect(changesDisclosure).toBeVisible();
      } catch (error) {
        await phone.screenshot({ path: testInfo.outputPath(`mobile-panel-loading-${width}.png`) });
        writeFileSync(testInfo.outputPath('mobile-workspace-loading.txt'), await workspace.innerHTML());
        throw error;
      }
      await expect(changesDisclosure).not.toHaveAttribute('open', '');
      await expect(workspace.locator('.environment-changes')).toBeHidden();
      await changesDisclosure.locator('summary').click();
      await expect(workspace.locator('.environment-changes')).toBeVisible();
      await changesDisclosure.locator('summary').click();
      await expect(workspace.getByText('Workspace actions', { exact: true })).toBeVisible();
      await phone.screenshot({ path: testInfo.outputPath(`zana-mobile-panel-${width}.png`) });
      expect(panelBox.y).toBe(0);
      expect(panelBox.height).toBe(844);
      await expect(phone.locator('.titlebar')).toBeHidden();
      await expect(phone.locator('.sidebar-trigger-overlay')).toBeHidden();
      await sidePanel.getByRole('button', { name: 'Choose panel view', exact: true }).click();
      await expect(sidePanel.getByRole('navigation', { name: 'Panel views', exact: true })).toBeVisible();
      await phone.screenshot({ path: testInfo.outputPath(`mobile-panel-views-${width}.png`) });
      const changesView = sidePanel.getByTestId('thread-diff-pin');
      expect((await changesView.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await changesView.click();
      await expect(sidePanel.getByRole('navigation', { name: 'Panel views', exact: true })).toHaveCount(0);
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
    // Small phones wrap the permission row. Settings and auxiliary actions must
    // stay in separate rows on both sides of that breakpoint.
    for (const width of [320, 390, 480, 481, 820]) {
      await phone.setViewportSize({ width, height: 844 });
      await composer.tap();
      await composerOptions.click();
      const options = phone.getByRole('group', { name: 'Additional composer controls', exact: true });
      const actions = phone.locator('.thread-command-secondary-actions');
      const meter = phone.getByTestId('thread-context-window');
      await expect(options).toBeVisible();
      await expect(options.locator('.thread-command-location')).toHaveText('Local');
      await expect(phone.getByTestId('thread-env-label')).toHaveCount(0);
      await expect(meter).toContainText('47%');
      await expect(actions.getByRole('button', { name: 'Start voice input', exact: true })).toBeVisible();
      const optionsBox = (await options.boundingBox())!;
      const actionsBox = (await actions.boundingBox())!;
      expect(actionsBox.y).toBeGreaterThanOrEqual(optionsBox.y + optionsBox.height);
      for (const row of await options.locator('.thread-command-option:visible').all()) {
        const label = (await row.locator('.thread-command-option-label').boundingBox())!;
        const control = (await row.locator('button, .thread-command-location').first().boundingBox())!;
        expect(label.x + label.width).toBeLessThanOrEqual(control.x);
      }
      const meterButton = meter.locator('.thread-context-meter-trigger');
      expect((await meterButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await meterButton.click();
      const contextCard = meter.locator('.thread-context-meter-card');
      await expect(contextCard).toBeVisible();
      const cardBox = (await contextCard.boundingBox())!;
      expect(cardBox.x).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width);
      await phone.keyboard.press('Escape');
      await expect(composerOptions).toHaveAttribute('aria-expanded', 'false');
      await composerOptions.click();
      await phone.screenshot({ path: testInfo.outputPath(`mobile-composer-options-${width}.png`) });
      await phone.keyboard.press('Escape');
    }
    await phone.setViewportSize({ width: 390, height: 844 });
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
    await expect(modelMenu).toHaveAttribute('aria-modal', 'true');
    await expect.poll(() => modelMenu.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await modelMenu.getByRole('button', { name: 'Close model picker' }).click();
    await expect(modelMenu).toBeHidden();
    await expect(modelTrigger).toBeFocused();
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
    // Finish loading the host roster before revoking the device. Otherwise a
    // pending roster request gets 401 and correctly disables Send before this
    // assertion can exercise the rejected-send path.
    await composer.fill('This revoked device must be rejected');
    await expect(send).toBeEnabled();
    gateway.revoke(credential.deviceId);
    expect((await context.request.get(`${serverUrl}/api/v1/projects`)).status()).toBe(401);
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
    await browser.contexts()[0]?.tracing.stop({ path: testInfo.outputPath('phone-trace.zip') });
    await browser.close();
    await gateway.close();
  }
});
