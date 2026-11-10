import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { test, expect } from './fixtures/app.js';
import { stubOpenDialog } from './sdk/native-dialog.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('custom audio needs no plugin and crosses native selection, persistence, completion and Chromium playback', async ({ app, home }, info) => {
  test.setTimeout(150_000);
  const win = app.window;
  await app.electron.evaluate(({ app, webContents }) => {
    const tap = { cues: [] as unknown[][], audibleStarts: 0 }; (globalThis as any).__customSounds = tap;
    const watch = (contents: Electron.WebContents) => {
      contents.on('audio-state-changed', event => { if (event.audible) tap.audibleStarts++; });
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => { if (channel === 'app:onAgentSound') tap.cues.push(args); send(channel, ...args); };
    };
    webContents.getAllWebContents().forEach(watch); app.on('web-contents-created', (_event, contents) => watch(contents));
  });
  const tap = () => app.electron.evaluate(() => (globalThis as any).__customSounds as { cues: [string, number, { mime: string; base64: string }][]; audibleStarts: number });
  const route = () => win.evaluate(() => { history.pushState({}, '', '/settings/notifications'); dispatchEvent(new PopStateEvent('popstate')); });
  const pick = async (event: string, option: string) => {
    await win.getByRole('button', { name: `${event} sound`, exact: true }).click();
    await win.getByRole('option', { name: option, exact: true }).click();
  };
  const mp3 = join(home, 'my-finish.mp3'); writeFileSync(mp3, readFileSync(resolve('e2e/fixtures/audio/notification-chime.mp3')));
  const expectedHash = createHash('sha256').update(readFileSync(mp3)).digest('hex');
  const invalid = join(home, 'not-a-sound.mp3'); writeFileSync(invalid, 'plain text');
  const large = join(home, 'too-large.mp3'); writeFileSync(large, Buffer.alloc(1024 * 1024 + 1));
  await route();
  await expect(win.getByRole('heading', { name: 'Sounds by event' })).toBeVisible({ timeout: 60_000 });
  await expect(win.getByRole('button', { name: 'Agent finishes a turn sound', exact: true })).toBeEnabled();
  await win.getByRole('button', { name: 'Agent finishes a turn sound', exact: true }).click();
  await expect(win.getByRole('option', { name: 'Choose audio file…', exact: true })).toBeVisible();
  await captureElectronScreenshot(app.electron, win, info.outputPath('custom-audio-menu.png'));
  await win.getByRole('listbox', { name: 'Agent finishes a turn sound', exact: true }).press('Escape');
  await stubOpenDialog(app.electron, [[mp3]]); await pick('Agent finishes a turn', 'Choose audio file…');
  await expect(win.getByRole('button', { name: 'Agent finishes a turn sound', exact: true })).toContainText('my-finish.mp3');
  await expect(win.getByRole('button', { name: 'Agent needs you sound', exact: true })).toContainText('Default chime');
  await expect(win.getByRole('switch', { name: 'Play notification sounds' })).toHaveAttribute('aria-checked', 'false');
  await expect(win.getByRole('switch', { name: 'Agent finishes a turn', exact: true })).toHaveAttribute('aria-checked', 'false');
  const before = (await tap()).audibleStarts;
  await win.getByRole('button', { name: 'Preview Finished turn' }).click();
  await expect(win.getByRole('status')).toHaveText('Finished turn preview played.');
  await expect.poll(async () => (await tap()).audibleStarts).toBeGreaterThan(before);
  for (const path of [null, invalid, large]) {
    await stubOpenDialog(app.electron, [path ? [path] : []]); await pick('Agent finishes a turn', 'Choose audio file…');
    if (path) await expect(win.getByRole('alert')).toContainText(path === invalid ? 'MP3, WAV, or OGG' : '1 MB');
    await expect(win.getByRole('button', { name: 'Agent finishes a turn sound', exact: true })).toBeEnabled();
    await expect(win.getByRole('button', { name: 'Agent finishes a turn sound', exact: true })).toContainText('my-finish.mp3');
  }
  unlinkSync(mp3); await win.reload(); await route();
  await expect(win.getByRole('button', { name: 'Agent finishes a turn sound', exact: true })).toContainText('my-finish.mp3');
  await win.getByRole('switch', { name: 'Agent finishes a turn', exact: true }).click();
  await expect(win.getByRole('switch', { name: 'Agent finishes a turn', exact: true })).toHaveAttribute('aria-checked', 'true');
  await win.getByRole('switch', { name: 'Play notification sounds' }).click();
  await expect(win.getByRole('switch', { name: 'Play notification sounds' })).toHaveAttribute('aria-checked', 'true');
  await win.getByRole('button', { name: 'Quiet spacing' }).click(); await win.getByRole('option', { name: '5 seconds', exact: true }).click();
  const project = join(home, 'custom-sound-project'); mkdirSync(project);
  const projectId = await win.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw new Error(result.message); return result.value.id;
  }, project);
  await captureElectronScreenshot(app.electron, win, info.outputPath('custom-notification-settings.png'));
  // Reload removes document activation; hidden-window playback still uses preload.
  await win.reload(); await expect(win.locator('#root')).not.toBeEmpty();
  await win.evaluate(async () => {
    const url = new URL('/ws', location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url); const root = globalThis as any; root.__soundEvents = [];
    socket.onmessage = message => {
      const event = JSON.parse(message.data), row = event.payload, record = row?.payload?.event ?? row?.payload;
      if (event.type === 'threads:updated' || (event.type === 'threads:event' && ['turn/started', 'turn/completed'].includes(record?.type ?? row?.type))) {
        root.__soundEvents.push({ type: event.type, eventType: row?.type, protocolType: record?.type, status: row?.status ?? record?.status, scope: record?.scope,
          parent: record?.parentToolCallId, visible: row?.visibility, pending: row?.hasPendingInteraction, activity: row?.activity });
        root.__soundEvents = root.__soundEvents.slice(-30);
      }
    };
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('Sound diagnostics stream unavailable')); });
  });
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.hide()));
  const started = await win.evaluate(async projectId => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', input: 'delay:600 completed turn sound' }) });
    return { status: response.status, data: await response.json() };
  }, projectId);
  expect(started.status).toBe(201);
  try {
    await expect.poll(async () => (await tap()).cues.map(cue => cue[0]), { timeout: 20_000 }).toEqual(['done']);
  } catch (error) {
    const state = await win.evaluate(async id => ({ events: (globalThis as any).__soundEvents,
      saved: await window.cc.config.get().then(config => ({ done: config.agentSoundDone, master: config.notificationSoundsEnabled, provider: config.notificationSoundProvider })),
      turns: await fetch(`/api/v1/threads/${id}/events?limit=50`).then(response => response.json()).then(body => body.events.filter((row: any) => row.type.startsWith('turn')).map((row: any) => ({ type: row.type, payload: row.payload })))
    }), started.data.thread.id);
    await info.attach('completion-state', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
    throw error;
  }
  const cue = (await tap()).cues[0]!;
  expect(cue[2].mime).toBe('audio/mpeg');
  expect(createHash('sha256').update(Buffer.from(cue[2].base64, 'base64')).digest('hex')).toBe(expectedHash);
  await expect.poll(async () => (await tap()).audibleStarts).toBeGreaterThan(before + 1);
  await win.waitForTimeout(6_000); expect((await tap()).cues).toHaveLength(1);
  await route(); await pick('Agent finishes a turn', 'Default chime');
  await expect(win.getByRole('button', { name: 'Agent finishes a turn sound', exact: true })).toContainText('Default chime');
  expect(await win.evaluate(() => window.cc.app.getAgentSoundFiles!())).toEqual({});
  // Renderer-supplied paths and unknown events never authorize file access.
  await expect(win.evaluate(() => window.cc.app.chooseAgentSoundFile!('../escape' as never))).rejects.toThrow('Unknown agent sound');
});
