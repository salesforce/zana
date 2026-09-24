import { mkdirSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
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
  test.setTimeout(process.env.ZCC_MOBILE_MAESTRO ? 480_000 : 120_000);
  const directory = join(app.home, 'mobile-project');
  mkdirSync(directory);
  const threadId = await app.window.evaluate(async (path) => {
    const projectResponse = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const { project } = await projectResponse.json();
    if (!project?.id) throw new Error('Project creation failed');
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
  }, directory);
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
    expect((await context.request.get(`${serverUrl}/internal/hosts`)).status()).toBe(404);
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
    await expect(phone.getByTestId('thread-detail')).toBeVisible();
    await expect(
      phone.getByText('Hello from the desktop delay:500', { exact: true }).first()
    ).toBeVisible();
    expect(await phone.evaluate(() => 'cc' in window)).toBe(false);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
    await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(phone.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible();
    await phone
      .getByRole('dialog', { name: 'Navigation', exact: true })
      .getByRole('button', { name: 'Close navigation' })
      .click();
    await expect(phone.getByRole('dialog', { name: 'Navigation', exact: true })).toBeHidden();
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
      expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );
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
    await composer.fill('');
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
