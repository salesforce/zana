import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { stubNativeDialogs, stubOpenDialog } from './sdk/native-dialog.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('optional sound plugin imports audio, runs with its panel closed, and disposes in built Electron', async ({ app, home }, info) => {
  test.setTimeout(150_000);
  const win = app.window, source = join(home, 'sound-plugin');
  cpSync(resolve('plugins/agent-sounds'), source, { recursive: true, filter: path => !path.includes('node_modules') });
  // Record the real generic SDK feed in the fixture copy; no synthetic status events.
  const entry = join(source, 'app.tsx');
  writeFileSync(entry, readFileSync(entry, 'utf8').replace('mount: mountBackground', `mount: context => {
    const off = context.experimental_observeAgents?.(snapshot => {
      const root = globalThis as any;
      (root.__studioActivity ??= []).push(snapshot);
      root.__studioActivity = root.__studioActivity.slice(-20);
    });
    const dispose = mountBackground(context);
    return () => { off?.(); dispose(); };
  }`));
  await stubOpenDialog(app.electron, [[source]]); await stubNativeDialogs(app.electron, [0, 0, 0]);
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'localDir' }))).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'agent-sounds')?.status)).toBe('running');
  const route = async (path: string) => { await win.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path); };
  await route('/extensions/pages/agent-sounds/main');
  await expect(win.getByRole('heading', { name: 'Give your agents a voice.' })).toBeVisible();
  await expect(win.getByText('Notification player ready', { exact: true })).toBeVisible();
  await expect(win.getByRole('switch', { name: 'Sound notifications' })).toHaveAttribute('aria-checked', 'false');
  await app.electron.evaluate(({ app, webContents }) => {
    (globalThis as any).__studioAudible = [];
    const watch = (contents: Electron.WebContents) => contents.on('audio-state-changed', event => {
      if (event.audible) (globalThis as any).__studioAudible.push(contents.id);
    });
    for (const contents of webContents.getAllWebContents()) watch(contents);
    app.on('web-contents-created', (_event, contents) => { watch(contents); });
  });
  const audible = () => app.electron.evaluate(() => (globalThis as any).__studioAudible as number[]);
  // Import a real short generated WAV through the production file input and plugin RPC/storage.
  const sampleRate = 16000, frames = 16000, wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 660 / sampleRate) * 10000), 44 + i * 2);
  // Keep one second of real audio and pad with a valid RIFF JUNK chunk to the
  // advertised 1 MiB limit. Paired base64 clips must cross the actual RPC seam.
  const fullWav = Buffer.alloc(1024 * 1024), padding = fullWav.length - wav.length;
  wav.copy(fullWav); fullWav.writeUInt32LE(fullWav.length - 8, 4);
  fullWav.write('JUNK', wav.length); fullWav.writeUInt32LE(padding - 8, wav.length + 4);
  await win.getByLabel('Pack name').fill('My sound pack');
  await win.getByLabel('Needs you audio').setInputFiles({ name: 'request.wav', mimeType: 'audio/wav', buffer: fullWav });
  await win.getByLabel('Idle audio').setInputFiles({ name: 'idle.wav', mimeType: 'audio/wav', buffer: fullWav });
  await win.getByRole('button', { name: 'Save sound pack' }).click(); await expect(win.getByRole('status')).toContainText('Sound pack imported.');
  await win.getByRole('button', { name: 'Preview Needs you' }).click(); await expect.poll(audible).toHaveLength(1);
  await win.getByRole('switch', { name: 'Sound notifications' }).click();
  await expect(win.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await win.getByRole('checkbox', { name: /Becomes idle/ }).check();
  await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('agent-sounds', 'read').then((v: any) => v.preferences.idle))).toBe(true);
  await captureElectronScreenshot(app.electron, win, info.outputPath('sound-studio.png'));
  await win.evaluate(async () => { await window.cc.config.set({ theme: 'light' }); document.querySelector<HTMLElement>('.sound-studio')!.style.width = '390px'; });
  await expect.poll(() => win.evaluate(() => { const panel = document.querySelector<HTMLElement>('.sound-studio')!; return panel.scrollWidth <= panel.clientWidth + 1; })).toBe(true);
  await captureElectronScreenshot(app.electron, win, info.outputPath('sound-studio-narrow-light.png'));
  await win.evaluate(async () => { await window.cc.config.set({ theme: 'dark' }); document.querySelector<HTMLElement>('.sound-studio')!.style.width = ''; });
  // A second scoped window must not play another copy or steal the player lock.
  const path = join(home, 'sound-project'); mkdirSync(path);
  const projectId = await win.evaluate(async path => { const result = await window.cc.projects.add(path); if (!result.ok) throw new Error(result.message); return result.value.id; }, path);
  await win.evaluate(id => window.cc.windows.openProject(id), projectId);
  await route('/inbox');
  await win.reload(); await route('/extensions/pages/agent-sounds/main');
  await expect(win.getByText('Notification player ready', { exact: true })).toBeVisible();
  await route('/inbox');
  await win.evaluate(() => {
    const Context = window.AudioContext;
    (window as any).__studioContexts = [];
    window.AudioContext = class extends Context { constructor(options?: AudioContextOptions) { super(options); (window as any).__studioContexts.push(this); } };
  });
  await app.electron.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide(); });
  const request = async (input: string) => win.evaluate(async ({ projectId, input }) => {
    const result = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, providerId: 'fake', input }) });
    if (!result.ok) throw new Error(await result.text()); return result.json();
  }, { projectId, input });
  const beforeIdle = (await audible()).length;
  await request('delay:700 sound plugin idle');
  try {
    await expect.poll(async () => (await audible()).length, { timeout: 15_000 }).toBe(beforeIdle + 1);
  } catch (error) {
    console.log('Sound Studio diagnostics:', JSON.stringify(await win.evaluate(() => ({ activity: (window as any).__studioActivity, audio: (window as any).__studioContexts.map((c: AudioContext) => ({ state: c.state, time: c.currentTime })) }))));
    throw error;
  }
  const question = Buffer.from(JSON.stringify({ questions: [{ question: 'Review this?', options: ['Continue', 'Review'] }] })).toString('base64url');
  await request(`call_tool:ask_user_question tool_args:${question}`); await expect.poll(async () => (await audible()).length).toBe(beforeIdle + 2);
  // Disable the plugin itself. A pending stable-idle timer must be disposed.
  await request('delay:700 disable pending idle'); await win.waitForTimeout(1500);
  expect(await win.evaluate(() => window.cc.extensions.setEnabled('agent-sounds', false))).toMatchObject({ ok: true });
  const beforeDisabled = (await audible()).length; await win.waitForTimeout(6000); expect((await audible()).length).toBe(beforeDisabled);
  expect(await win.evaluate(() => window.cc.extensions.setEnabled('agent-sounds', true))).toMatchObject({ ok: true });
  await route('/extensions/pages/agent-sounds/main'); await expect(win.getByText('Notification player ready', { exact: true })).toBeVisible();
  await expect(win.getByRole('button', { name: /My sound pack Your audio/ })).toHaveAttribute('aria-pressed', 'true');
});
