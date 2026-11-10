import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { stubNativeDialogs, stubOpenDialog } from './sdk/native-dialog.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true, agentSoundNeedsYou: true } });

test('sound providers share Settings, inspect safely, activate exclusively and survive reload/removal', async ({ app, home }, info) => {
  test.setTimeout(120_000);
  const win = app.window;
  const route = (path: string) => win.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  const install = async (id: string, title: string) => {
    const dir = join(home, id); mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@zcc-ext/${id}`, version: '0.1.0', type: 'module', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: title, description: 'Sound provider test fixture', branding: { icon: 'Volume2' }, app: './app.tsx', server: './server.ts' } }));
    writeFileSync(join(dir, 'server.ts'), 'export default () => {};');
    writeFileSync(join(dir, 'app.tsx'), `import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
      export default definePluginApp(app => app.slots.notificationSoundProvider({
        id: 'voice', title: ${JSON.stringify(title)}, description: 'Example notification voices',
        component: () => <p>Controls for ${title}</p>,
        mount(context) {
          const root = globalThis as any; (root.__soundProviders ??= { starts: [], stops: [] }).starts.push(context.pluginId);
          return () => { root.__soundProviders.stops.push(context.pluginId); };
        }
      }));`);
    await stubOpenDialog(app.electron, [[dir]]); await stubNativeDialogs(app.electron, [0, 0, 0]);
    const installed = await win.evaluate(() => window.cc.extensions.install({ kind: 'localDir' }));
    expect(installed, JSON.stringify(installed)).toMatchObject({ ok: true });
    await expect.poll(() => win.evaluate(async id => (await window.cc.pluginApps.list()).find(p => p.id === id)?.status, id)).toBe('running');
  };
  await install('voice-alpha', 'Alpha voices'); await install('voice-beta', 'Beta voices');
  await route('/settings/notifications');
  const master = win.getByRole('switch', { name: 'Play notification sounds' });
  await expect(master).toHaveAttribute('aria-checked', 'true'); // legacy built-in preference retained
  const tap = () => win.evaluate(() => (globalThis as any).__soundProviders ?? { starts: [], stops: [] });
  expect((await tap()).starts).toEqual([]);
  await win.getByRole('button', { name: 'Sound provider' }).click();
  const providerSearch = win.getByRole('textbox', { name: 'Search sound providers…' });
  await providerSearch.fill('no matching provider');
  await expect(win.getByText('No sound providers match your search.')).toBeVisible();
  expect((await tap()).starts).toEqual([]);
  await providerSearch.fill('Alpha');
  await expect(win.getByRole('option', { name: /Beta voices/ })).toHaveCount(0);
  await captureElectronScreenshot(app.electron, win, info.outputPath('sound-provider-search.png'));
  await win.getByRole('option', { name: /Alpha voices/ }).click();
  await expect(master).toHaveAttribute('aria-checked', 'false');
  await expect(win.getByText('Controls for Alpha voices')).toBeVisible();
  expect((await tap()).starts).toEqual([]);
  await master.click(); await expect.poll(async () => (await tap()).starts).toEqual(['voice-alpha']);
  // A Configure link opens another provider's controls without selecting it.
  await route('/settings/notifications?provider=voice-beta%2Fvoice#agent-sounds');
  await expect(win.getByText('Controls for Beta voices')).toBeVisible();
  await expect(win.getByRole('button', { name: 'Sound provider' })).toContainText('Alpha voices');
  await expect(master).toHaveAttribute('aria-checked', 'true');
  expect((await tap()).starts).toEqual(['voice-alpha']);
  await win.getByRole('button', { name: 'Use Beta voices' }).click();
  await expect(master).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await tap()).stops).toEqual(['voice-alpha']);
  expect((await tap()).starts).toEqual(['voice-alpha']);
  await master.click(); await expect.poll(async () => (await tap()).starts).toEqual(['voice-alpha', 'voice-beta']);
  await route('/inbox'); await win.reload(); await route('/settings/notifications');
  await expect(win.getByRole('button', { name: 'Sound provider' })).toContainText('Beta voices');
  await expect(master).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await tap()).starts).toEqual(['voice-beta']);
  await route('/settings/agents#agents.sound-volume');
  await expect(win.getByRole('heading', { name: 'Sounds by event' })).toBeVisible();
  await expect(win.getByRole('button', { name: 'Sound provider' })).toContainText('Beta voices');
  await expect(master).toHaveAttribute('aria-checked', 'true');
  await win.getByRole('button', { name: 'Back to active provider' }).click();
  // The built-in main-process player shares the same selection gate.
  await app.electron.evaluate(({ webContents }) => {
    (globalThis as any).__builtInSoundCues = [];
    for (const contents of webContents.getAllWebContents()) {
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (channel === 'app:onAgentSound') (globalThis as any).__builtInSoundCues.push(args);
        send(channel, ...args);
      };
    }
  });
  const projectPath = join(home, 'sound-ownership-project'); mkdirSync(projectPath);
  const projectId = await win.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw new Error(result.message); return result.value.id;
  }, projectPath);
  const question = Buffer.from(JSON.stringify({ questions: [{ question: 'Review this?', options: ['Continue', 'Review'] }] })).toString('base64url');
  const asking = await win.evaluate(async ({ projectId, question }) => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', input: `call_tool:ask_user_question tool_args:${question}` }) });
    if (!response.ok) throw new Error(await response.text()); return response.json();
  }, { projectId, question });
  await expect.poll(() => win.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.hasPendingInteraction, asking.thread.id)).toBe(true);
  await win.waitForTimeout(300);
  expect(await app.electron.evaluate(() => (globalThis as any).__builtInSoundCues)).toEqual([]);
  await captureElectronScreenshot(app.electron, win, info.outputPath('notifications-sound-provider.png'));
  await route('/settings/notifications');
  await win.getByRole('link', { name: 'Manage plugin' }).click();
  await expect(win.getByRole('link', { name: 'Configure sounds →' })).toBeVisible();
  await win.getByRole('link', { name: 'Configure sounds →' }).click();
  await expect(win.getByText('Controls for Beta voices')).toBeVisible();
  const search = win.getByRole('combobox', { name: 'Search settings' });
  await search.fill('Alpha voices');
  await win.getByRole('option').filter({ hasText: 'Alpha voices' }).first().click();
  await expect(win.getByText('Controls for Alpha voices')).toBeVisible();
  await expect(win.getByRole('button', { name: 'Sound provider' })).toContainText('Beta voices');
  expect(await win.evaluate(() => window.cc.pluginApps.setEnabled('voice-beta', false))).toMatchObject({ ok: true });
  await expect.poll(async () => (await tap()).stops).toEqual(['voice-beta']);
  await route('/settings/notifications');
  await expect(master).toBeDisabled();
  await expect(win.getByRole('status')).toContainText('no other provider will play');
  expect((await tap()).starts).toEqual(['voice-beta']);
});
