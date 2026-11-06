import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('agent chimes cross the production event, main, preload and audio boundary', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const win = app.window;
  // Observe actual Chromium audio, preserving both IPC sends and the audio device.
  await app.electron.evaluate(({ app, webContents }) => {
    const tap = { cues: [] as unknown[][], audibleStarts: 0 };
    (globalThis as any).__agentSoundTap = tap;
    const watch = (contents: Electron.WebContents) => {
      contents.on('audio-state-changed', event => { if (event.audible) tap.audibleStarts += 1; });
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (channel === 'app:onAgentSound') tap.cues.push(args);
        send(channel, ...args);
      };
    };
    for (const contents of webContents.getAllWebContents()) watch(contents);
    app.on('web-contents-created', (_event, contents) => watch(contents));
  });
  const tap = () => app.electron.evaluate(() => (globalThis as any).__agentSoundTap as { cues: [string, number][]; audibleStarts: number });
  const request = (route: string, body?: unknown) => win.evaluate(async ({ route, body }) => {
    const response = await fetch(`/api/v1/${route}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, data: await response.json() };
  }, { route, body });
  const path = join(home, 'sound-project'); mkdirSync(path);
  const projectId = await win.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);
  await win.evaluate(id => window.cc.windows.openProject(id), projectId);
  await expect.poll(() => app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => !win.isDestroyed() && win.webContents.getURL().includes('projectId=')).length)).toBeGreaterThan(0);
  await app.electron.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide(); });
  await win.evaluate(() => window.cc.config.set({ agentSoundIdle: true, agentSoundNeedsYou: false, agentSoundVolume: 50 }));
  // Reload clears the document's user activation: automatic chimes must still work.
  await win.reload();
  await expect(win.locator('#root')).not.toBeEmpty();
  const idle = await request('threads', { projectId, providerId: 'fake', input: 'delay:600 first idle chime' });
  expect(idle.status).toBe(201);
  await expect.poll(async () => (await tap()).cues, { timeout: 15_000 }).toEqual([['idle', 50]]);
  await expect.poll(async () => (await tap()).audibleStarts).toBeGreaterThan(0);
  await win.waitForTimeout(2_000);
  expect((await tap()).cues).toHaveLength(1);

  await win.evaluate(() => window.cc.config.set({ agentSoundIdle: false, agentSoundNeedsYou: true }));
  const question = Buffer.from(JSON.stringify({ questions: [{ question: 'Which option should I use?', options: ['Continue', 'Review'] }] })).toString('base64url');
  const asking = await request('threads', { projectId, providerId: 'fake', input: `call_tool:ask_user_question tool_args:${question}` });
  expect(asking.status).toBe(201);
  await expect.poll(async () => (await request(`threads/${asking.data.thread.id}`)).data.thread.hasPendingInteraction).toBe(true);
  await expect.poll(async () => (await tap()).cues.map(cue => cue[0])).toEqual(['idle', 'needs-you']);
  await expect.poll(async () => (await tap()).audibleStarts).toBeGreaterThan(1);
});

test('sound Settings persist and previews play while notifications are disabled', async ({ app }, testInfo) => {
  const win = app.window;
  // A fresh visible window keeps Settings actionability independent of the hidden-window scenario.
  await app.electron.evaluate(({ webContents }) => {
    (globalThis as any).__previewAudibleStarts = 0;
    for (const contents of webContents.getAllWebContents()) {
      contents.on('audio-state-changed', event => {
        if (event.audible) (globalThis as any).__previewAudibleStarts += 1;
      });
    }
  });
  const audibleStarts = () => app.electron.evaluate(() => (globalThis as any).__previewAudibleStarts as number);
  await win.evaluate(() => window.cc.config.set({ agentSoundIdle: false, agentSoundNeedsYou: true, agentSoundVolume: 50 }));
  await win.evaluate(() => { history.pushState({}, '', '/settings/agents#agent-sounds'); dispatchEvent(new PopStateEvent('popstate')); });
  const section = win.locator('#settings-anchor-agent-sounds');
  await section.scrollIntoViewIfNeeded();
  const needs = section.getByRole('switch', { name: 'Play a chime when an agent needs you' });
  await expect(needs).toHaveAttribute('aria-checked', 'true');
  await needs.click(); await expect(needs).toHaveAttribute('aria-checked', 'false');
  await section.getByRole('slider', { name: 'Chime volume' }).fill('75');
  await expect.poll(() => win.evaluate(() => window.cc.config.get().then(config => config.agentSoundVolume))).toBe(75);
  const before = await audibleStarts();
  await section.getByRole('button', { name: 'Preview Idle' }).click();
  await expect(section.getByRole('status')).toHaveText('Idle preview played.');
  await expect.poll(audibleStarts).toBeGreaterThan(before);
  const bounds = await section.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('agent-notification-sounds.png'));
  await win.reload();
  await expect(win.locator('#settings-anchor-agent-sounds').getByRole('slider', { name: 'Chime volume' })).toHaveValue('75');
  expect(await win.evaluate(() => window.cc.config.get().then(config => [config.agentSoundIdle, config.agentSoundNeedsYou]))).toEqual([false, false]);
});
