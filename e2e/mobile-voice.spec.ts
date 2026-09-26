import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';

const { build } = createRequire(new URL('../apps/host-daemon/package.json', import.meta.url))('esbuild') as typeof import('../apps/host-daemon/node_modules/esbuild');

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('mobile voice uses the host Keychain and inserts MP4 transcripts; blocked reads remain actionable', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const codexHome = join(home, 'voice-codex');
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, 'config.toml'), 'cli_auth_credentials_store = "keyring"');
  const keychainFixture = join(codexHome, 'security-fixture.cjs');
  writeFileSync(keychainFixture, `
const fs = require('node:fs');
if (process.cwd() !== fs.realpathSync(process.env.HOME)) process.exit(2);
const mode = fs.readFileSync('mode', 'utf8');
if (mode === 'missing') process.exit(44);
if (mode === 'locked') { process.stderr.write('synthetic-private-error'); process.exit(1); }
if (mode === 'timeout') { setInterval(() => {}, 1000); }
else {
  const padding = 'x'.repeat(mode === 'overflow' ? 300 * 1024 : 32 * 1024);
  // The usable credential follows >8192 bytes, catching truncated child stdout.
  process.stdout.write(JSON.stringify({ padding, auth_mode: 'apikey', OPENAI_API_KEY: 'synthetic-e2e-key' }));
}
`);
  const fixtureBundle = join(home, 'voice-host.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/voice-host.ts', import.meta.url))], outfile: fixtureBundle,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    define: { 'import.meta.url': JSON.stringify(new URL('./fixtures/voice-host.ts', import.meta.url).href) } });
  const invoke = async (audioBase64: string, mimeType: string, filename: string) => app.electron.evaluate(async (_electron, args) => {
    const fixture = process.getBuiltinModule('module').createRequire(args.fixtureBundle)(args.fixtureBundle);
    return fixture.transcribe(args);
  }, { fixtureBundle, codexHome, keychainFixture, node: process.execPath, audioBase64, mimeType, filename });

  const project = join(home, 'voice-project');
  mkdirSync(project);
  const threadId = await app.window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Cannot add voice fixture project');
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Voice fixture' }) });
    const body = await response.json();
    return (body.thread ?? body.value).id;
  }, project);
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const pair = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Mobile voice test' } });
    const credential = await pair.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const window = await context.newPage();
    await window.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => new MediaStream() });
      class Recorder {
        static isTypeSupported(type: string) { return type === 'audio/mp4'; }
        mimeType = 'audio/mp4';
        state = 'inactive';
        onstart?: () => void;
        ondataavailable?: (event: { data: Blob }) => void;
        onstop?: () => void;
        start() { this.state = 'recording'; this.onstart?.(); }
        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({ data: new Blob(['synthetic-microphone-audio'], { type: this.mimeType }) });
          this.onstop?.();
        }
      }
      Object.defineProperty(window, 'MediaRecorder', { value: Recorder });
    });
    await window.route('**/api/v1/system/voice-status', (route) => route.fulfill({ json: { enabled: true } }));
    await window.route('**/api/v1/system/voice-transcription', async (route) => {
      const req = route.request();
      const form = await new Request(req.url(), { method: 'POST', headers: { 'content-type': req.headers()['content-type']! }, body: req.postDataBuffer()! }).formData();
      const audio = form.get('file') as File;
      expect(audio.name).toBe('recording.mp4');
      const result = await invoke(Buffer.from(await audio.arrayBuffer()).toString('base64'), audio.type, audio.name);
      await route.fulfill({ status: result.status, json: result.body });
    });
    await window.goto(`${serverUrl}/threads/${threadId}`);
    await expect(window.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    const input = window.getByTestId('thread-command-input');
    await expect(input).toBeVisible();
    const record = async () => {
      const options = window.getByRole('button', { name: 'Composer options', exact: true });
      if (await options.getAttribute('aria-expanded') !== 'true') await options.click();
      await window.getByRole('button', { name: 'Start voice input', exact: true }).click();
      await expect(window.getByTestId('thread-voice-bar')).toBeVisible();
      await window.waitForTimeout(1100); // real minimum recording duration
      await window.getByRole('button', { name: 'Stop and transcribe recording' }).click();
    };
    writeFileSync(join(codexHome, 'mode'), 'success');
    await input.fill('Draft: ');
    await input.press('End');
    await record();
    await expect(input).toContainText('Voice works on my phone.');
    await expect(input).toContainText('Draft:');
    await expect(window.locator('.toast.error')).toHaveCount(0);
    await window.screenshot({ path: testInfo.outputPath('mobile-voice-transcript.png') });

    writeFileSync(join(codexHome, 'mode'), 'locked');
    await record();
    await expect(window.locator('.toast.error')).toContainText('Keychain');
    await expect(window.locator('.toast.error')).not.toContainText('synthetic-private-error');
    await expect(input).toContainText('Draft:');
    await window.screenshot({ path: testInfo.outputPath('mobile-voice-keychain-guidance.png') });

    for (const mode of ['missing', 'timeout', 'overflow', 'success']) {
      writeFileSync(join(codexHome, 'mode'), mode);
      const result = await invoke(Buffer.from('synthetic-microphone-audio').toString('base64'), 'audio/mp4', 'recording.mp4');
      expect(result.status, mode).toBe(mode === 'success' ? 200 : mode === 'missing' ? 501 : 503);
      expect(JSON.stringify(result.body)).not.toContain('synthetic-private');
    }
  } finally {
    await browser.close();
    await gateway.close();
  }
});
