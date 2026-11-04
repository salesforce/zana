import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, webkit, type Locator, type Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true }
});

// Desktop browser automation cannot summon an iPhone keyboard. Model its visual
// viewport independently of the unchanged layout viewport, including Safari pan.
async function keyboardViewport(page: Page, height: number, offsetTop = 0) {
  await page.evaluate(({ height, offsetTop }) => {
    Object.assign(window.visualViewport!, { height, offsetTop });
    window.visualViewport!.dispatchEvent(new Event('resize'));
    window.visualViewport!.dispatchEvent(new Event('scroll'));
  }, { height, offsetTop });
}

async function checkTypeaheadViewport(page: Page, composer: Locator) {
  const editor = composer.getByTestId('thread-command-input');
  await editor.fill('/');
  const menu = page.getByTestId('composer-typeahead-menu');
  await expect(menu.getByRole('option').first()).toBeVisible();
  const checkBounds = async () => {
    await expect.poll(() => menu.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const viewport = window.visualViewport!;
      return rect.height > 60 && rect.top >= viewport.offsetTop &&
        rect.bottom <= viewport.offsetTop + viewport.height &&
        rect.left >= viewport.offsetLeft && rect.right <= viewport.offsetLeft + viewport.width;
    })).toBe(true);
  };
  for (const offset of [0, 160]) {
    await keyboardViewport(page, 400, offset);
    await checkBounds();
    // Real hit testing must still reach the body portal above the composer.
    const option = menu.getByRole('option').first();
    await option.tap();
    await expect(menu).toHaveCount(0);
    await editor.fill('/');
  }
  await composer.getByTestId('thread-command-expand').tap();
  await expect(composer).toHaveAttribute('data-mobile-expanded', 'true');
  await editor.fill('/');
  await checkBounds();
  await keyboardViewport(page, 300, 220);
  await checkBounds();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Done', exact: true }).tap();
  await keyboardViewport(page, 844);
  await editor.fill('');
  await editor.evaluate(node => node.blur());
}

async function checkToolbar(composer: Locator, width: number, compactModel = true) {
  await composer.getByTestId('thread-command-input').focus();
  const model = composer.getByRole('button', { name: 'Provider and model', exact: true });
  const attach = composer.getByRole('button', { name: 'Attach files', exact: true });
  const options = composer.getByRole('button', { name: 'Composer options', exact: true });
  await expect(options).toBeVisible();
  await expect(attach).toBeVisible();
  await expect(composer.locator('input[type="file"]')).toBeHidden();
  // Touch hover can persist after the file picker returns, including while
  // focus has moved back into the draft. Accessible names remain available.
  await attach.hover();
  await composer.getByTestId('thread-command-input').focus();
  expect(await attach.locator('..').evaluate((node) => getComputedStyle(node, '::after').display)).toBe('none');
  await expect(composer.locator('.thread-command-options')).toBeHidden();
  const controls = [model, composer.locator('.thread-command-permission button'), options,
    attach, composer.locator('.thread-command-send')];
  const boxes = [];
  for (const control of controls) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    boxes.push(box);
  }
  const modelLabel = await model.locator('.model-reasoning-picker-trigger-model').textContent();
  if (compactModel && modelLabel?.trim() === 'Auto') {
    expect(boxes[0]!.width).toBeLessThan(110);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (const b of boxes.slice(i + 1)) {
      const a = boxes[i]!;
      expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 ||
        a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1).toBe(true);
    }
  }
}

async function checkChatScrollBounds(page: Page) {
  const timeline = page.getByTestId('thread-timeline');
  await expect(timeline).toHaveCSS('overscroll-behavior-y', 'none');
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'none');
  await expect(page.locator('body')).toHaveCSS('overscroll-behavior-y', 'none');
  await expect.poll(() => timeline.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(800);
  const header = (await page.locator('.titlebar').boundingBox())!;
  const composer = page.locator('.thread-command-composer');
  const card = (await composer.boundingBox())!;
  const bounds = (await timeline.boundingBox())!;
  const chromiumTouch = page.context().browser()?.browserType().name() === 'chromium';
  for (const edge of ['top', 'bottom']) {
    await timeline.evaluate((node, edge) => { node.scrollTop = edge === 'top' ? 0 : node.scrollHeight; }, edge);
    if (chromiumTouch) {
      const cdp = await page.context().newCDPSession(page);
      try {
        const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        for (let step = 1; step <= 8; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
            x: start.x, y: start.y + (edge === 'top' ? 1 : -1) * 120 * step / 8
          }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await cdp.detach();
      }
    } else {
      // Mobile WebKit does not expose native drag or wheel synthesis. Exercise
      // clamping and layout here; Chromium above covers real touch boundary drags.
      await timeline.evaluate((node, edge) => { node.scrollTop += edge === 'top' ? -1000 : 1000; }, edge);
    }
    // Let the native scrolling transaction settle before checking the shell.
    await page.waitForTimeout(150);
    const scroll = await timeline.evaluate((node) => ({ top: node.scrollTop, max: node.scrollHeight - node.clientHeight }));
    expect(scroll.top).toBeGreaterThanOrEqual(0);
    expect(scroll.top).toBeLessThanOrEqual(scroll.max + 1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect((await page.locator('.titlebar').boundingBox())!.y).toBe(header.y);
    expect((await composer.boundingBox())!.y).toBe(card.y);
  }
  // Reading older messages must survive keyboard/composer resizing.
  await timeline.evaluate((node) => { node.scrollTop = 100; });
  await expect(page.getByRole('button', { name: 'Scroll to bottom' })).toBeVisible();
  await keyboardViewport(page, 400);
  expect(await timeline.evaluate((node) => node.scrollTop)).toBe(100);
  await keyboardViewport(page, 844);
  await page.getByRole('button', { name: 'Scroll to bottom' }).tap();
  await expect.poll(() => timeline.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
}

async function checkCompactComposer(page: Page, composer: Locator) {
  const card = composer.locator('.thread-command-card');
  const editor = composer.getByTestId('thread-command-input');
  const send = composer.locator('.thread-command-send');
  const options = composer.getByRole('button', { name: 'Composer options', exact: true });
  const runSettings = composer.getByRole('button', { name: /^Run settings:/ });
  await expect(editor).not.toBeFocused();
  await expect(options).toBeHidden();
  await expect(runSettings).toBeHidden();
  await expect(editor).toHaveCSS('max-height', '24px');
  const resting = (await card.boundingBox())!;
  expect(resting.height).toBeLessThanOrEqual(56);
  const inputBox = (await editor.boundingBox())!;
  const sendBox = (await send.boundingBox())!;
  expect(sendBox.width).toBeGreaterThanOrEqual(44);
  expect(sendBox.height).toBeGreaterThanOrEqual(44);
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(sendBox.x);
  expect(Math.abs(inputBox.y + inputBox.height / 2 - sendBox.y - sendBox.height / 2)).toBeLessThan(2);

  await editor.tap();
  await expect(editor).toBeFocused();
  await expect(options).toBeVisible();
  await expect(runSettings).toBeHidden();
  const writing = (await card.boundingBox())!;
  expect(writing.height).toBeGreaterThan(resting.height);
  expect(writing.height).toBeLessThanOrEqual(resting.height + 60);

  // Focus can move into the toolbar or its picker without collapsing the card.
  await options.tap();
  await expect(composer.locator('.thread-command-options')).toBeVisible();
  if (await runSettings.count()) {
    await expect(composer.locator('.thread-command-composer-meta .mobile-run-settings-trigger')).toHaveCount(0);
    await runSettings.tap();
    const settings = page.getByRole('dialog', { name: 'Run settings', exact: true });
    await expect(settings).toBeVisible();
    const workspace = settings.getByRole('button', { name: 'Workspace', exact: true });
    await workspace.tap();
    await page.keyboard.press('Escape');
    await expect(settings).toBeVisible();
    await expect(options).toHaveAttribute('aria-expanded', 'true');
    await settings.getByRole('button', { name: 'Close run settings', exact: true }).tap();
    await expect(runSettings).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(options).toBeFocused();
  await expect(options).toBeVisible();
  const model = composer.getByTestId('model-reasoning-picker-trigger');
  await model.tap();
  await page.getByRole('button', { name: 'Close model picker', exact: true }).tap();
  await expect(model).toBeFocused();
  await expect(options).toBeVisible();

  await editor.fill('First line\nSecond line\nThird line');
  await editor.evaluate((node) => node.blur());
  await expect(options).toBeHidden();
  expect((await card.boundingBox())!.height).toBe(resting.height);
  await editor.tap();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText(/First line\s*Second line\s*Third line/);
  // Reset fixture state through the editor transaction; mobile WebKit does not
  // reliably translate desktop selection shortcuts into ProseMirror selections.
  await editor.evaluate(node => (node as HTMLElement & { editor: Editor }).editor.commands.clearContent());
  await expect(editor).toHaveText('');
  await editor.evaluate((node) => node.blur());
}

for (const engine of [chromium, webkit]) {
  test(`mobile typeahead survives keyboard resize, pan and expansion (${engine.name()})`, async ({ app }) => {
    test.setTimeout(120_000);
    const threadId = await app.window.evaluate(async () => {
      const project = (await window.cc.projects.list())[0]!;
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, providerId: 'fake', input: 'Typeahead viewport regression' })
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).thread.id as string;
    });
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const serverUrl = `http://127.0.0.1:${port}`;
    const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
    const browser = await engine.launch().catch(async error => { await gateway.close(); throw error; });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const paired = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Typeahead viewport' } });
      expect(paired.ok()).toBe(true);
      const credential = await paired.json();
      expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
      await context.addInitScript(() => {
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          value: Object.assign(new EventTarget(), { height: 844, offsetTop: 0, width: 390, offsetLeft: 0, scale: 1 })
        });
        localStorage.setItem('zcc.defaultLaunchMode', 'thread');
      });
      const page = await context.newPage();
      for (const route of ['/', '/threads/new', `/threads/${threadId}`]) {
        await page.goto(serverUrl + route);
        await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
        await checkTypeaheadViewport(page, page.locator('.thread-command-composer'));
      }
    } finally {
      await browser.close();
      await gateway.close();
    }
  });

  test(`mobile composer fits Auto, portalled launch and keyboard pan (${engine.name()})`, async ({ app }, testInfo) => {
    test.setTimeout(180_000);
    const directory = join(app.home, 'composer-layout');
    mkdirSync(directory);
    const threadId = await app.window.evaluate(async (path) => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error('Project registration failed');
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input:
          Array.from({ length: 30 }, (_, index) => `Scroll paragraph ${index + 1}. A mobile conversation needs enough content to exercise both scroll boundaries.`).join('\n\n') })
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).thread.id as string;
    }, directory);
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const serverUrl = `http://127.0.0.1:${port}`;
    const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const paired = await context.request.post(`${serverUrl}/_mobile/pair`, {
        data: { code: gateway.pair().code, label: 'Composer layout' }
      });
      expect(paired.ok()).toBe(true);
      const credential = await paired.json();
      expect((await context.request.post(`${serverUrl}/_mobile/session`, {
        headers: { authorization: `Bearer ${credential.credential}` }
      })).ok()).toBe(true);
      await context.addInitScript(() => {
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          value: Object.assign(new EventTarget(), { height: 844, offsetTop: 0, width: innerWidth, offsetLeft: 0, scale: 1 })
        });
        localStorage.setItem('zcc.defaultLaunchMode', 'thread');
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(15_000);
      let modelLabel = 'Auto';
      await page.route('**/api/v1/system/execution-options*', (route) => route.fulfill({ json: {
        providers: [{ id: 'fake', displayName: 'Fake', available: true,
          composerActions: [], capabilities: { permissionModes: ['full', 'accept-edits'] } }],
        models: [{ id: 'fake-model', model: 'fake-model', displayName: modelLabel, isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }], defaultReasoningEffort: 'medium' }],
        selectedOnlyModels: [], permissionCeiling: 'full', modelLoadError: null
      } }));

      // Both the standalone new-agent page and an existing conversation keep
      // the draft and actions in the visible area when only visualViewport moves.
      for (const route of ['/', '/threads/new', `/threads/${threadId}`]) {
        await page.goto(serverUrl + route);
        const composer = page.locator('.thread-command-composer');
        const editor = composer.getByTestId('thread-command-input');
        await expect(composer.getByTestId('model-reasoning-picker-trigger')).toContainText('Auto');
        if (route === `/threads/${threadId}`) {
          await test.step('Chat scroll boundaries and keyboard scrollback', () => checkChatScrollBounds(page));
        }
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 844 });
          await checkCompactComposer(page, composer);
          if (route === `/threads/${threadId}`) {
            // Width changes rewrap the transcript even if its pane height stays fixed.
            await expect.poll(() => page.getByTestId('thread-timeline').evaluate(node =>
              node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
          }
          await page.screenshot({ path: testInfo.outputPath(`compact-${route === '/' ? 'home' : route.includes('new') ? 'new' : 'reply'}-${width}.png`) });
        }
        await editor.fill('Draft stays visible above the keyboard');
        await composer.locator('input[type="file"]').setInputFiles([1, 2].map((number) => ({
          name: `screenshot-${number}.png`, mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
        })));
        await expect(composer.locator('.composer-image-thumb')).toHaveCount(2);
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 844 });
          await keyboardViewport(page, 844);
          await checkToolbar(composer, width, route !== '/');
          await editor.focus();
          await expect(editor).toHaveCSS('font-size', '16px');
          await expect(editor).toHaveCSS('overscroll-behavior-y', 'none');
          for (const offset of [0, 160, 220]) {
            await keyboardViewport(page, 400, offset);
            await expect(page.locator('.app-shell')).toHaveCSS('top', `${offset}px`);
            await page.screenshot({ path: testInfo.outputPath(`keyboard-${route === '/' ? 'home' : route.includes('new') ? 'new' : 'reply'}-${width}.png`) });
            const shell = (await page.locator('.app-shell').boundingBox())!;
            expect(shell.height).toBe(400);
            const navigation = (await page.getByTestId('sidebar-trigger-overlay').boundingBox())!;
            expect(navigation.y).toBe(shell.y);
            for (const control of [editor, composer.locator('.thread-command-send')]) {
              const box = (await control.boundingBox())!;
              expect(box.y).toBeGreaterThanOrEqual(offset);
              expect(box.y + box.height, `${route} at ${width}px: ${await control.getAttribute('class')}`).toBeLessThanOrEqual(offset + 400);
            }
            const card = (await composer.locator('.thread-command-card').boundingBox())!;
            expect(offset + 400 - card.y - card.height).toBeLessThan(110);
            await expect(editor).toHaveText('Draft stays visible above the keyboard');
            if (route === `/threads/${threadId}`) {
              await expect.poll(() => page.getByTestId('thread-timeline').evaluate((node) =>
                node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
            }
          }
          await keyboardViewport(page, 844);
        }
      }

      // Send and Stop remain usable directly from the compact row, even on
      // small phones where the focused toolbar wraps its running controls.
      await page.goto(`${serverUrl}/threads/${threadId}`);
      const reply = page.locator('.thread-command-composer');
      await page.setViewportSize({ width: 320, height: 844 });
      const replyEditor = reply.getByTestId('thread-command-input');
      await replyEditor.fill('delay:60000 Check compact send and stop');
      await replyEditor.evaluate((node) => node.blur());
      const sent = page.waitForResponse((response) => response.url().endsWith(`/threads/${threadId}/send`) && response.request().method() === 'POST', { timeout: 15_000 });
      await reply.getByTestId('thread-command-send').tap();
      expect((await sent).ok()).toBe(true);
      const stop = reply.getByTestId('thread-command-stop');
      await expect(stop).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      expect((await reply.locator('.thread-command-card').boundingBox())!.height).toBeLessThanOrEqual(56);
      const stopped = page.waitForResponse((response) => response.url().endsWith(`/threads/${threadId}/stop`) && response.request().method() === 'POST', { timeout: 15_000 });
      await stop.tap();
      expect((await stopped).ok()).toBe(true);
      await expect(stop).toBeHidden();

      await page.goto(serverUrl + '/agents');
      await page.getByTestId('agents-board-new-thread').first().click();
      const modal = page.getByTestId('launch-modal');
      await expect(modal).toBeVisible();
      expect(await modal.evaluate((node) => node.closest('.app-shell') === null)).toBe(true);
      const composer = modal.locator('.thread-command-composer');
      await expect(composer.getByTestId('model-reasoning-picker-trigger')).toContainText('Auto');
      await checkCompactComposer(page, composer);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await checkToolbar(composer, width);
        await composer.getByTestId('thread-command-input').fill('A mobile launch draft');
        await keyboardViewport(page, 400, 160);
        await expect(modal.locator('..')).toHaveCSS('top', '160px');
        const box = (await modal.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(160);
        expect(box.y + box.height).toBeLessThanOrEqual(560);
        const options = composer.getByRole('button', { name: 'Composer options', exact: true });
        await options.click();
        await expect(composer.locator('.thread-command-options')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(options).toHaveAttribute('aria-expanded', 'false');
        await expect(modal).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`launcher-${width}.png`) });
        await keyboardViewport(page, 844);
      }

      // The model may shrink, but must not push permissions or Send out of view.
      modelLabel = 'A very long model name with a large context window';
      await page.goto(serverUrl + '/threads/new');
      const longComposer = page.locator('.thread-command-composer');
      await expect(longComposer.getByTestId('model-reasoning-picker-trigger')).toContainText(modelLabel);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await checkToolbar(longComposer, width, false);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'false');
      await expect(page.locator('.app-shell')).toHaveCSS('position', 'static');
      await longComposer.getByTestId('thread-command-input').evaluate((node) => node.blur());
      await expect(longComposer.getByTestId('model-reasoning-picker-trigger')).toBeVisible();
      await expect(longComposer.getByRole('button', { name: 'Composer options', exact: true })).toBeHidden();
      expect(await longComposer.locator('.thread-command-attach').locator('..').evaluate((node) =>
        getComputedStyle(node, '::after').display)).not.toBe('none');
    } finally {
      await browser.close();
      await gateway.close();
    }
  });
}
