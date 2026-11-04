import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, type Page, type Route } from '@playwright/test';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';

const { build } = createRequire(new URL('../apps/host-daemon/package.json', import.meta.url))('esbuild') as typeof import('../apps/host-daemon/node_modules/esbuild');

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true, voiceInputEnabled: true } });

function installSyntheticMicrophone() {
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
}

test('desktop and mobile voice validate host commands and insert MP4 transcripts; blocked reads remain actionable', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const codexHome = join(home, 'voice-codex');
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, 'config.toml'), 'cli_auth_credentials_store = "keyring"');
  const cliBin = join(codexHome, 'bin');
  mkdirSync(cliBin);
  const codexFixture = fileURLToPath(new URL('./fixtures/codex-auth.cjs', import.meta.url));
  const node = await app.electron.evaluate(() => process.execPath);
  const launcher = join(cliBin, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  writeFileSync(launcher, process.platform === 'win32'
    ? `@echo off\r\n"${node}" "${codexFixture}" %*\r\n`
    : `#!/bin/sh\nexec ${quote(node)} ${quote(codexFixture)} "$@"\n`, { mode: 0o700 });
  const fixtureBundle = join(home, 'voice-host.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/voice-host.ts', import.meta.url))], outfile: fixtureBundle,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    define: { 'import.meta.url': JSON.stringify(new URL('./fixtures/voice-host.ts', import.meta.url).href) } });
  const invoke = async (audioBase64: string, mimeType: string, filename: string) => app.electron.evaluate(async (_electron, args) => {
    const fixture = process.getBuiltinModule('module').createRequire(args.fixtureBundle)(args.fixtureBundle);
    return fixture.transcribe(args);
  }, { fixtureBundle, codexHome, cliBin, audioBase64, mimeType, filename });

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
  const transcribeRoute = async (route: Route) => {
    const req = route.request();
    const form = await new Request(req.url(), { method: 'POST', headers: { 'content-type': req.headers()['content-type']! }, body: req.postDataBuffer()! }).formData();
    const audio = form.get('file') as File;
    expect(audio.name).toBe('recording.mp4');
    const result = await invoke(Buffer.from(await audio.arrayBuffer()).toString('base64'), audio.type, audio.name);
    await testInfo.attach('voice-response', { body: JSON.stringify(result), contentType: 'application/json' });
    await route.fulfill({ status: result.status, json: result.body });
  };
  const record = async (window: Page, send = false) => {
    await expect(window.getByTestId('thread-voice-bar')).toHaveCount(0);
    const options = window.getByRole('button', { name: 'Composer options', exact: true });
    if (await options.isVisible() && await options.getAttribute('aria-expanded') !== 'true') await options.click();
    await window.getByRole('button', { name: 'Start voice input', exact: true }).click();
    await expect(window.getByTestId('thread-voice-bar')).toBeVisible();
    await window.waitForTimeout(1100); // real minimum recording duration
    await window.getByRole('button', { name: send ? 'Transcribe and send recording' : 'Stop and transcribe recording', exact: true }).click();
  };

  // Avoid a real OS microphone prompt while exercising the built desktop
  // composer and the schema-validated production transcription service.
  await app.electron.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice:ensureMicAccess');
    ipcMain.handle('voice:ensureMicAccess', async () => true);
  });
  await app.window.addInitScript(installSyntheticMicrophone);
  await app.window.route('**/api/v1/system/voice-status', (route) => route.fulfill({ json: { enabled: true } }));
  await app.window.route('**/api/v1/system/voice-transcription', transcribeRoute);
  writeFileSync(join(codexHome, 'mode'), 'success');
  await app.window.goto(`${new URL(app.window.url()).origin}/threads/${threadId}`);
  const desktopInput = app.window.getByTestId('thread-command-input');
  await expect(desktopInput).toBeVisible();
  await desktopInput.fill('Desktop draft: ');
  await desktopInput.press('End');
  await record(app.window);
  await expect(desktopInput).toContainText('Voice works on my phone.');
  await expect(desktopInput).toContainText('Desktop draft:');
  await expect(app.window.getByRole('button', { name: 'Retry voice transcription', exact: true })).toHaveCount(0);
  await expect(app.window.locator('.toast.error')).toHaveCount(0);
  await app.window.screenshot({ path: testInfo.outputPath('desktop-voice-transcript.png') });

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
    window.setDefaultTimeout(15_000);
    await window.addInitScript(installSyntheticMicrophone);
    await window.route('**/api/v1/system/voice-status', (route) => route.fulfill({ json: { enabled: true } }));
    await window.route('**/api/v1/system/voice-transcription', transcribeRoute);
    await window.goto(`${serverUrl}/threads/${threadId}`);
    await expect(window.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    const input = window.getByTestId('thread-command-input');
    await expect(input).toBeVisible();
    writeFileSync(join(codexHome, 'mode'), 'success');
    await input.fill('Draft: ');
    await input.press('End');
    await record(window);
    await expect(input).toContainText('Voice works on my phone.');
    await expect(input).toContainText('Draft:');
    await expect(window.locator('.toast.error')).toHaveCount(0);
    await window.screenshot({ path: testInfo.outputPath('mobile-voice-transcript.png') });

    writeFileSync(join(codexHome, 'mode'), 'error');
    await record(window);
    await expect(window.locator('.toast.error')).toContainText('Codex');
    await expect(window.locator('.toast.error')).not.toContainText('unlock Keychain');
    await expect(window.locator('.toast.error')).not.toContainText('synthetic-private-error');
    await expect(input).toContainText('Draft:');
    await window.screenshot({ path: testInfo.outputPath('mobile-voice-codex-auth-guidance.png') });

    writeFileSync(join(codexHome, 'mode'), 'success');
    await window.getByRole('button', { name: 'Retry voice transcription', exact: true }).click();
    await expect.poll(async () => (await input.innerText()).match(/Voice works on my phone\./g)?.length ?? 0).toBe(2);
    await expect(window.getByTestId('thread-voice-bar')).toHaveCount(0);
    await expect(window.getByRole('button', { name: 'Retry voice transcription', exact: true })).toHaveCount(0);
    await expect(input).toContainText('Voice works on my phone.');
    await input.fill('Send this recording:');
    await record(window, true);
    await expect(window.getByTestId('thread-timeline')).toContainText('Send this recording:');
    await expect(window.getByTestId('thread-timeline')).toContainText('Voice works on my phone.');
    await expect(input).toBeEmpty();

    for (const mode of ['missing', 'timeout', 'overflow', 'exit', 'success']) {
      writeFileSync(join(codexHome, 'mode'), mode);
      const result = await invoke(Buffer.from('synthetic-microphone-audio').toString('base64'), 'audio/mp4', 'recording.mp4');
      expect(result.status, mode).toBe(mode === 'success' ? 200 : mode === 'missing' ? 501 : 503);
      expect(JSON.stringify(result.body)).not.toContain('synthetic-private');
      if (mode === 'timeout') expect(result.body.message).toContain('Timed out');
    }
    const calls = readFileSync(join(codexHome, 'calls.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) {
      expect(call.home).toBe(codexHome);
      expect(call.codexHome).toBe(realpathSync(codexHome));
      expect(call.cwd).toBe(realpathSync(codexHome));
      expect(call.outputMode).toBe(0o600);
      expect(() => process.kill(call.pid, 0)).toThrow();
    }
    // A stale npm shim must fail cleanly without falling through to a real CLI.
    writeFileSync(launcher, process.platform === 'win32'
      ? '@echo off\r\n"C:\\missing\\codex.exe" %*\r\n'
      : '#!/bin/sh\nexec /missing/codex-executable "$@"\n', { mode: 0o700 });
    expect((await invoke(Buffer.from('synthetic-microphone-audio').toString('base64'), 'audio/mp4', 'recording.mp4')).status).toBe(503);
  } finally {
    await browser.close();
    await gateway.close();
  }
});
