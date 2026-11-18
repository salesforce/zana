import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';
import { buildPlugin } from '../packages/plugin-build/src/build-plugin.js';

const pluginId = 'permission-default-fixture';
test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true, defaultThreadProviderId: 'fake' }
});
test.beforeEach(async ({ home }) => {
  const root = join(home, 'permission-plugin');
  mkdirSync(root, { recursive: true });
  const manifest = { name: `zcc-plugin-${pluginId}`, version: '0.1.0', type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Permission fixture', description: 'Isolated permission inheritance fixture', branding: { icon: 'Puzzle' }, server: './server.ts' } };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'server.ts'), `export default function(zcc) {
    zcc.rpc.method('spawn', args => zcc.sdk.threads.spawn({ ...args, providerId: 'fake', prompt: 'Direct action using permission defaults' }));
  }`);
  await buildPlugin(root, JSON.parse(readFileSync('package.json', 'utf8')).version);
  manifest.zcc.server = './server.mjs';
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  const plugins = join(home, '.zcc/plugins'); mkdirSync(plugins, { recursive: true });
  writeFileSync(join(plugins, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
    id: pluginId, version: '0.1.0', name: 'Permission fixture', enabled: true,
    description: 'Isolated permission inheritance fixture', icon: 'Puzzle', status: 'running', statusDetail: null,
    provenance: 'direct', sourceKind: 'path', source: `path:${root}`, rootDir: root,
    serverEntry: './server.mjs', appEntry: null, installedAt: 1, updatedAt: 1,
    npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null
  }] }));
});

test('shared permissions persist and an unsupported single-mode provider has an explicit recovery', async ({ app }, info) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await waitForThreadProvider(page, 'fake');
  await page.evaluate(() => { history.pushState({}, '', '/settings/composer'); dispatchEvent(new PopStateEvent('popstate')); });
  const setting = page.getByRole('button', { name: 'Default permissions', exact: true });
  await expect(setting).toContainText('Keep existing defaults');
  await setting.click();
  await page.getByRole('option', { name: /^Accept Edits/ }).click();
  await expect.poll(async () => (await page.evaluate(() => window.cc.config.get())).defaultThreadPermissionMode).toBe('accept-edits');
  await page.reload();
  await expect(setting).toContainText('Accept Edits');
  await page.screenshot({ path: info.outputPath('default-permissions.png') });

  await page.getByRole('link', { name: 'Back to app', exact: true }).click();
  const home = page.locator('.home-agent-composer');
  await home.getByRole('group', { name: 'Launch mode' }).getByRole('button', { name: 'Modern', exact: true }).click();
  await home.getByTestId('thread-command-input').fill('Explicitly choose Full for this launch');
  await expect(home.getByText(/default permission policy is unavailable/)).toBeVisible();
  await expect(home.getByTestId('thread-command-send')).toBeDisabled();
  await home.getByRole('button', { name: 'Permission mode', exact: true }).click();
  await page.getByRole('option', { name: /^Full Access/ }).click();
  await expect(home.getByTestId('thread-command-send')).toBeEnabled();
  const request = page.waitForRequest(r => r.url().endsWith('/api/v1/threads') && r.method() === 'POST');
  await home.getByTestId('thread-command-send').click();
  expect((await request).postDataJSON().permissionMode).toBe('full');
  await expect(page.getByTestId('thread-detail')).toBeVisible();
  expect((await page.evaluate(() => window.cc.config.get())).defaultThreadPermissionMode).toBe('accept-edits');
});

test('direct plugin actions inherit defaults, explicit modes win, and existing threads retain their policy', async ({ app }) => {
  const page = app.window;
  await waitForThreadProvider(page, 'fake');
  await expect.poll(() => page.evaluate(async id => (await window.cc.pluginApps.list()).find(p => p.id === id)?.status, pluginId)).toBe('running');
  const projectId = await page.evaluate(async () => (await window.cc.projects.list()).find(p => p.quickAgent)!.id);
  const setDefault = (mode: 'full' | 'accept-edits' | null) => page.evaluate(async value => {
    await window.cc.config.set({ defaultThreadPermissionMode: value });
  }, mode);
  await setDefault('full');
  const spawn = (permissionMode?: 'accept-edits', environmentId?: string) => page.evaluate(async args => {
    return await window.cc.pluginApps.callRpc(args.pluginId, 'spawn', { projectId: args.projectId,
      ...(args.environmentId ? { environment: { kind: 'reuse', environmentId: args.environmentId } } : {}),
      ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}) }) as { id: string };
  }, { pluginId, projectId, permissionMode, environmentId });
  const inherited = await spawn();
  const read = (id: string) => page.evaluate(async threadId => (await (await fetch(`/api/v1/threads/${threadId}`)).json()).thread, id);
  await expect.poll(async () => { const t = await read(inherited.id); return [t.status, t.permissionMode]; }).toEqual(['idle', 'full']);
  const explicit = await spawn('accept-edits', (await read(inherited.id)).environmentId);
  await expect.poll(async () => { const t = await read(explicit.id); return [t.status, t.permissionMode]; }).toEqual(['idle', 'accept-edits']);
  await setDefault('accept-edits');
  const refused = await page.evaluate(async id => {
    const before = (await (await fetch('/api/v1/threads')).json()).threads.length;
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: id, providerId: 'fake', input: 'Unsupported default' }) });
    return { status: response.status, body: await response.text(), before,
      after: (await (await fetch('/api/v1/threads')).json()).threads.length };
  }, projectId);
  expect(refused.status).toBe(400);
  expect(refused.body).toContain('default permission policy');
  expect(refused.after).toBe(refused.before);
  await page.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'Keep the existing policy' }) });
    if (!response.ok) throw new Error(await response.text());
  }, inherited.id);
  await expect.poll(async () => { const t = await read(inherited.id); return [t.status, t.permissionMode]; }).toEqual(['idle', 'full']);
  await setDefault(null);
  expect((await page.evaluate(() => window.cc.config.get())).defaultThreadPermissionMode).toBeNull();
});
