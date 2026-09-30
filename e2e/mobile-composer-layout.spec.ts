import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, webkit, type Locator, type Page } from '@playwright/test';
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

async function checkToolbar(composer: Locator, width: number, compactModel = true) {
  const model = composer.getByRole('button', { name: 'Provider and model', exact: true });
  const attach = composer.getByRole('button', { name: 'Attach files', exact: true });
  const options = composer.getByRole('button', { name: 'Composer options', exact: true });
  await expect(options).toBeVisible();
  await expect(attach).toBeVisible();
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

for (const engine of [chromium, webkit]) {
  test(`mobile composer fits Auto, portalled launch and keyboard pan (${engine.name()})`, async ({ app }, testInfo) => {
    test.setTimeout(180_000);
    const directory = join(app.home, 'composer-layout');
    mkdirSync(directory);
    const threadId = await app.window.evaluate(async (path) => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error('Project registration failed');
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Mobile layout delay:500' })
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
          }
          await keyboardViewport(page, 844);
        }
      }

      await page.goto(serverUrl + '/agents');
      await page.getByTestId('agents-board-new-thread').first().click();
      const modal = page.getByTestId('launch-modal');
      await expect(modal).toBeVisible();
      expect(await modal.evaluate((node) => node.closest('.app-shell') === null)).toBe(true);
      const composer = modal.locator('.thread-command-composer');
      await expect(composer.getByTestId('model-reasoning-picker-trigger')).toContainText('Auto');
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
      await expect(longComposer.getByRole('button', { name: 'Composer options', exact: true })).toBeHidden();
    } finally {
      await browser.close();
      await gateway.close();
    }
  });
}
