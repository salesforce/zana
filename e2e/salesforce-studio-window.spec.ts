import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import type { ElectronApplication, Page } from '@playwright/test';
import { AGENT_SCRIPT_EXAMPLES } from '../plugins/salesforce/lib/agent-script-model.js';

// The Salesforce tab opened in its own window: real plugin, real BrowserWindow,
// real realtime relay between the two renderers. Orgs come from a fake `sf`
// and REST from a loopback server, so no credentials or network are needed.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      res.setHeader('content-type', 'application/json');
      if (url.pathname.includes('/query')) res.end(JSON.stringify({ totalSize: 0, done: true, records: [] }));
      else if (url.pathname.endsWith('/limits')) res.end(JSON.stringify({ DailyApiRequests: { Max: 15000, Remaining: 14000 } }));
      else { res.statusCode = 404; res.end('[]'); }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'sf'), `#!${process.execPath}
const args = process.argv.slice(2);
const orgs = ['studio', 'second'].map((alias, i) => ({ alias, username: alias + '@example.com', orgId: '00D00000000000' + (i + 1), instanceUrl: process.env.SF_E2E_URL, isSandbox: true, isScratchOrg: false, apiVersion: '62.0' }));
const target = args[args.indexOf('--target-org') + 1];
let result = {};
if (args[0] === '--version') { console.log('@salesforce/cli/2.fixture'); process.exit(0); }
if (args.includes('display')) result = { ...(orgs.find((org) => org.alias === target || org.username === target) || orgs[0]), accessToken: 'FAKE_PRIVATE_TOKEN' };
else if (args[0] === 'org' && args[1] === 'list' && args[2] === 'metadata') result = [];
else if (args[0] === 'org' && args[1] === 'list') result = { nonScratchOrgs: orgs.map((org, i) => ({ ...org, isDefaultUsername: i === 0 })) };
console.log(JSON.stringify({ status: 0, result }));
`, { mode: 0o700 });
    mkdirSync(join(home, 'dx', 'force-app'), { recursive: true });
    writeFileSync(join(home, 'dx', 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }));
    writeFileSync(join(home, 'dx', 'force-app', 'Help.agent'), AGENT_SCRIPT_EXAMPLES[0].source);
    try {
      await use({ ZCC_FAKE_PROVIDER: '1', PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, SF_E2E_URL: `http://127.0.0.1:${address.port}`, SF_TARGET_ORG: '', SFDX_DEFAULTUSERNAME: '' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});
test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(180_000);

const isStudioUrl = (url: string) => url.includes('surface=plugin-view') && url.includes('pluginId=salesforce');
const studioWindows = (electron: ElectronApplication) => electron.windows().filter((w) => !w.isClosed() && isStudioUrl(w.url()));
/** BrowserWindows main still holds for the Salesforce view (Playwright can lag behind a close). */
const liveStudioWindows = (electron: ElectronApplication) =>
  electron.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('surface=plugin-view')).length);

async function waitForStudio(electron: ElectronApplication): Promise<Page> {
  let studio: Page | undefined;
  await expect.poll(() => (studio = studioWindows(electron)[0]) ? 'open' : 'waiting', { timeout: 20_000 }).toBe('open');
  await studio!.waitForSelector('#root', { timeout: 30_000 });
  return studio!;
}

async function route(page: Page, path: string) {
  await page.evaluate((next) => { history.pushState({}, '', next); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
}

test('Salesforce Studio window: one owner, status card, cross-window org sync and bring back', async ({ app, home }) => {
  const { window: main, electron } = app;
  const errors: string[] = [];
  main.on('pageerror', (error) => errors.push(`main: ${error.message}`));
  expect(await main.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = main.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => main.evaluate(async () => (await window.cc.pluginApps.list()).find((p) => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await main.evaluate(async (path) => {
    const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id;
  }, join(home, 'dx'));
  await main.evaluate(() => window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' }));
  await route(main, `/projects/${projectId}`);
  const nav = main.getByRole('navigation', { name: 'dx navigation' });
  await nav.getByRole('button', { name: 'Salesforce', exact: true }).click();
  const tab = main.getByTestId('salesforce-workbench');
  await expect(tab.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');

  // Open: the Studio window draws an activity bar and opens on Agentforce.
  await tab.getByTestId('plugin-tab-open-in-window').click();
  const studio = await waitForStudio(electron);
  studio.on('pageerror', (error) => errors.push(`studio: ${error.message}`));
  // The Studio titles its own window: the view, then the project and org. A sandbox gets no risk badge.
  const title = studio.getByTestId('plugin-view-title');
  await expect(title).toHaveText('Agentforce — dx · studio');
  await expect(studio).toHaveTitle(/^Agentforce — dx · studio — /);
  await expect(studio.getByTestId('plugin-view-title-badge')).toHaveCount(0);
  const workbench = studio.getByTestId('salesforce-workbench');
  await expect(workbench).toHaveAttribute('data-surface', 'studio-window');
  const bar = workbench.getByRole('tablist', { name: 'Salesforce tools' });
  await expect(bar).toHaveAttribute('aria-orientation', 'vertical');
  await expect(bar.getByRole('tab')).toHaveText(['Agents', 'Data', 'Apex', 'Deploy', 'Home']);
  await expect(bar.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true');
  await expect(studio.getByTestId('salesforce-agent-script-panel')).toBeVisible();
  // The Studio window has no thread beside it, and no second window button.
  await expect(studio.getByRole('button', { name: 'Open beside agent' })).toHaveCount(0);
  await expect(studio.getByTestId('plugin-tab-open-in-window')).toHaveCount(0);

  // One live owner: the main tab unmounts the workbench and shows the status card.
  const card = main.getByTestId('salesforce-studio-detached');
  await expect(card).toBeVisible();
  await expect(main.getByTestId('salesforce-workbench')).toHaveCount(0);
  const orgRow = card.locator('.sf-detached-row').filter({ hasText: 'Org' });
  await expect(orgRow).toContainText('studio');

  // Focus and a second open reuse the same window.
  await card.getByRole('button', { name: 'Focus Studio window' }).click();
  expect(await main.evaluate((id) => window.cc.windows.openPluginView({ pluginId: 'salesforce', tabId: 'salesforce', projectId: id }), projectId)).toBe(true);
  await expect.poll(() => liveStudioWindows(electron)).toBe(1);
  expect(await main.evaluate(() => window.cc.windows.listPluginViews())).toEqual([{ pluginId: 'salesforce', tabId: 'salesforce', projectId }]);

  // The window's lease says where it lives, so an open from another window can reach it.
  const listed = await main.evaluate((id) => window.cc.pluginApps.callRpc('salesforce', 'control.views', { projectId: id }), projectId) as
    { ok: boolean; views: Array<{ id: string; surface: string; window?: string; visible: boolean; focused: boolean; commands: string[] }> };
  const lease = listed.views.find((view) => view.window === 'plugin-view' && view.surface === 'workbench');
  expect(lease).toMatchObject({ visible: true, focused: expect.any(Boolean), commands: expect.arrayContaining(['view.open']) });
  // The person's own open (a card in the main window) lands in the Studio window, which retitles to the agent.
  const sent = await main.evaluate(({ id, viewId }) => window.cc.pluginApps.callRpc('salesforce', 'control.command', {
    projectId: id, viewId, command: 'view.open', input: { view: 'agentforce', path: 'force-app/Help.agent', line: 2 },
  }), { id: projectId, viewId: lease!.id });
  expect(sent).toMatchObject({ ok: true, commandId: expect.any(String) });
  await expect(studio.getByTestId('salesforce-agent-script-panel').locator('.af-document-name')).toHaveText('Help.agent');
  await expect(title).toHaveText('Agentforce · Help — dx · studio');
  await expect(studio).toHaveTitle(/^Agentforce · Help — dx · studio — /);

  // The window keeps the host side panel beside the tab, so Studio's tools open there too.
  const studioPanel = studio.getByTestId('salesforce-agent-script-panel');
  const sidePanel = studio.getByTestId('plugin-panel-host-layout').getByTestId('thread-secondary-panel');
  await expect(studio.getByTestId('plugin-panel-agent-show')).toHaveCount(0);
  await expect(studioPanel.locator('.af-tools')).toHaveCount(0);
  await studioPanel.locator('.af-document-bar').getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(sidePanel).toBeVisible();
  await expect(sidePanel.locator('.thread-secondary-tab.is-active')).toContainText('Preview');
  await expect(sidePanel.locator('.sf-panel-tool[data-studio-tool="preview"]').getByTestId('preview-workbench')).toBeVisible();
  await sidePanel.getByTestId('thread-secondary-new-tab').click();
  await expect(sidePanel.getByTestId('thread-new-tab-plugin-salesforce-studio-graph')).toBeVisible();
  await sidePanel.getByTestId('thread-secondary-hide').click();
  await expect(sidePanel).toBeHidden();

  // An org chosen in the Studio window reaches the main card without a reload.
  const picker = workbench.getByTestId('salesforce-org-picker');
  await expect(picker).toBeEnabled();
  await picker.selectOption('second');
  await expect(orgRow).toContainText('second');
  await expect(orgRow).not.toContainText('studio');
  await expect(title).toHaveText('Agentforce · Help — dx · second');

  // Bring back from the card: the window closes and the tab mounts here again.
  await card.getByRole('button', { name: 'Bring back here' }).click();
  await expect.poll(() => liveStudioWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect(main.getByTestId('salesforce-workbench')).toBeVisible();
  await expect(main.getByTestId('salesforce-studio-detached')).toHaveCount(0);
  await expect(main.getByTestId('salesforce-workbench').getByRole('tablist', { name: 'Salesforce tools' })).not.toHaveAttribute('aria-orientation', 'vertical');
  expect(await main.evaluate(() => window.cc.windows.listPluginViews())).toEqual([]);

  // Bring back from the Studio title bar after the main window moved on: main returns to the tab.
  await main.getByTestId('salesforce-workbench').getByTestId('plugin-tab-open-in-window').click();
  const again = await waitForStudio(electron);
  await expect(again.getByTestId('salesforce-workbench')).toHaveAttribute('data-surface', 'studio-window');
  await route(main, `/projects/${projectId}`);
  await again.getByTestId('plugin-view-bring-back').click();
  await expect.poll(() => liveStudioWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect(main.getByTestId('salesforce-workbench')).toBeVisible();

  // The close-tab chord closes the window, which has no tabs of its own.
  await main.getByTestId('salesforce-workbench').getByTestId('plugin-tab-open-in-window').click();
  const keyed = await waitForStudio(electron);
  await expect(keyed.getByTestId('salesforce-workbench')).toBeVisible();
  // The window closes on key-down, so the key-up can find the page gone.
  await keyed.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')
    .catch((error: Error) => { if (!/has been closed/.test(error.message)) throw error; });
  await expect.poll(() => liveStudioWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect(main.getByTestId('salesforce-workbench')).toBeVisible();

  // Closing the window itself also hands the tab back.
  await main.getByTestId('salesforce-workbench').getByTestId('plugin-tab-open-in-window').click();
  await waitForStudio(electron);
  await expect(main.getByTestId('salesforce-studio-detached')).toBeVisible();
  await electron.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('surface=plugin-view')) w.close();
  });
  await expect.poll(() => liveStudioWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect(main.getByTestId('salesforce-workbench')).toBeVisible();
  await expect(main.getByTestId('salesforce-studio-detached')).toHaveCount(0);
  expect(errors).toEqual([]);
});
