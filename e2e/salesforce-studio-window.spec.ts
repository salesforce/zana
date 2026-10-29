import { selectSalesforceSection } from './fixtures/salesforce-navigation.js';
import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import type { ElectronApplication, Page } from '@playwright/test';
import { AGENT_SCRIPT_EXAMPLES } from '../plugins/salesforce/lib/agent-script-model.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

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
    writeFileSync(join(home, 'dx', 'force-app', 'Orders.agent'), AGENT_SCRIPT_EXAMPLES[0].source.replaceAll('Support_Concierge', 'Order_Assistant'));
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
    BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('surface=plugin-view')).length);

async function waitForStudio(electron: ElectronApplication): Promise<Page> {
  let studio: Page | undefined;
  await expect.poll(() => (studio = studioWindows(electron)[0]) ? 'open' : 'waiting', { timeout: 20_000 }).toBe('open');
  await studio!.waitForSelector('#root', { timeout: 30_000 });
  return studio!;
}

async function route(page: Page, path: string) {
  await page.evaluate((next) => { history.pushState({}, '', next); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
}

test('AgentScript windows: independent panels and assistants, main tabs, resource focus and restore', async ({ app, home }, testInfo) => {
  test.setTimeout(240_000);
  const main = app.window;
  const errors: string[] = [];
  main.on('pageerror', error => errors.push(error.message));
  await main.setViewportSize({ width: 1600, height: 1000 });
  expect(await main.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = main.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => main.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const enabled = await main.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', true));
  expect(enabled, JSON.stringify(enabled)).toMatchObject({ ok: true });
  const projectId = await main.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id;
  }, join(home, 'dx'));
  await main.evaluate(() => window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' }));
  await route(main, `/projects/${projectId}/salesforce`);
  await selectSalesforceSection(main.getByTestId('salesforce-workbench'), 'agentforce');
  await expect(main.getByTestId('project-mode-pane').locator(':scope > .statusbar')).toHaveCount(0);
  const script = main.getByTestId('salesforce-agent-script-panel');
  await expect(script).toBeVisible();
  expect((await script.boundingBox())!.width).toBeGreaterThan(620);
  await script.getByTestId('salesforce-agent-script-file:force-app/Help.agent').click();
  await expect(script.locator('.af-document-name')).toHaveText('Help.agent');
  const mainEditor = main.frameLocator('iframe[title="Agentforce playground"]');
  await expect(mainEditor.locator('.view-lines')).toContainText('Support_Concierge');
  await mainEditor.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await main.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await main.keyboard.insertText('# window handoff keeps this unsaved draft\n');
  await expect(mainEditor.locator('.view-lines')).toContainText('# window handoff keeps this unsaved draft');
  const panel = main.getByTestId('plugin-panel-host-layout').getByTestId('thread-secondary-panel');
  await main.getByTestId('plugin-panel-agent-show').click();
  const composer = panel.getByTestId('panel-agent-tab-composer');
  await composer.getByTestId('thread-command-input').fill('Review only Help.agent routing.');
  await composer.getByTestId('thread-command-send').click();
  await expect(panel.getByTestId('thread-timeline')).toContainText('Response to: Review only Help.agent routing.', { timeout: 30_000 });
  await expect.poll(async () => {
    const reply = await main.evaluate(id => window.cc.pluginApps.callRpc('salesforce', 'studio.threads', { projectId: id, path: 'force-app/Help.agent' }), projectId) as { threads?: unknown[] };
    return reply.threads?.length ?? 0;
  }).toBe(1);

  const openScript = async (name: string) => {
    await main.getByTestId('salesforce-navigation-tabs').getByTestId('salesforce-agent-tabs').getByRole('button', { name: 'Open agent', exact: true }).click();
    const picker = main.getByRole('dialog', { name: 'Quick open', exact: true });
    await picker.getByRole('combobox', { name: 'Search files and actions' }).fill(name);
    await picker.getByRole('option').filter({ hasText: `force-app/${name}.agent` }).click();
    await expect(script.locator('.af-document-name')).toHaveText(`${name}.agent`);
  };
  await openScript('Orders');
  await expect(panel.getByTestId('thread-timeline')).toHaveCount(0);
  await script.getByTestId('salesforce-agent-script-preview').click();
  await expect(panel.locator('[data-testid="studio-view-preview"]:visible')).toHaveAttribute('data-agent', 'force-app/Orders.agent');
  const agentTabs = main.getByTestId('salesforce-navigation-tabs').getByRole('tablist', { name: 'Open agents' });
  await agentTabs.getByRole('tab', { name: /^Help\.agent/ }).click();
  await expect(panel.getByTestId('thread-timeline')).toContainText('Review only Help.agent routing.');
  await agentTabs.getByRole('tab', { name: /^Orders\.agent/ }).click();
  await expect(panel.locator('.thread-secondary-tab.is-active .thread-secondary-tab-label')).toHaveText('Preview');

  // One header row: launcher, file tabs and org control share the same vertical bounds.
  const workbench = main.getByTestId('salesforce-workbench');
  const header = workbench.locator('.sf-workbench-toolbar');
  const launcher = header.getByRole('button', { name: 'Open Salesforce tools' });
  const geometry = await header.evaluate(el => {
    const top = el.getBoundingClientRect().top;
    return [el.querySelector('.sf-section-trigger'), el.querySelector('.sf-atabs-bar'), el.querySelector('.sf-workbench-org')].map(child => Math.abs(child!.getBoundingClientRect().top - top));
  });
  expect(geometry.every(delta => delta <= 1), JSON.stringify(geometry)).toBe(true);
  // The same editor iframe and each script's assistant/panel survive visits to other tools.
  await script.locator('iframe').evaluate(el => { el.setAttribute('data-navigation-retention', 'same-frame'); });
  await selectSalesforceSection(workbench, 'data');
  await expect(script).toBeHidden();
  await launcher.focus();
  await main.keyboard.press('ArrowDown');
  await workbench.getByRole('textbox', { name: 'Search Salesforce tools' }).fill('Agent');
  await main.keyboard.press('ArrowDown');
  await main.keyboard.press('Enter');
  await expect(script).toBeVisible();
  await expect(script.locator('iframe')).toHaveAttribute('data-navigation-retention', 'same-frame');
  await expect(panel.locator('.thread-secondary-tab.is-active .thread-secondary-tab-label')).toHaveText('Preview');
  await agentTabs.getByRole('tab', { name: /^Help\.agent/ }).click();
  await expect(mainEditor.locator('.view-lines')).toContainText('# window handoff keeps this unsaved draft');
  await expect(panel.getByTestId('thread-timeline')).toContainText('Review only Help.agent routing.');
  await agentTabs.getByRole('tab', { name: /^Orders\.agent/ }).click();
  await captureElectronScreenshot(app.electron, main, testInfo.outputPath('salesforce-compact-header.png'));
  await launcher.click();
  const popupLayersAboveDividers = await workbench.getByRole('dialog', { name: 'Salesforce tools' }).evaluate(popup => {
    const bounds = popup.getBoundingClientRect();
    return [...document.querySelectorAll('.sf-pane-divider')].flatMap(divider => {
      const rect = divider.getBoundingClientRect();
      const x = Math.max(bounds.left, rect.left) + (Math.min(bounds.right, rect.right) - Math.max(bounds.left, rect.left)) / 2;
      const y = Math.max(bounds.top, rect.top) + (Math.min(bounds.bottom, rect.bottom) - Math.max(bounds.top, rect.top)) / 2;
      if (x <= bounds.left || x >= bounds.right || x <= rect.left || x >= rect.right || y <= bounds.top || y >= bounds.bottom || y <= rect.top || y >= rect.bottom) return [];
      const hit = document.elementFromPoint(x, y);
      return popup.contains(hit) ? [] : [{ x, y, hit: hit?.outerHTML.slice(0, 400), headerZ: getComputedStyle(popup.closest('header')!).zIndex, dividerZ: getComputedStyle(divider).zIndex }];
    });
  });
  expect(popupLayersAboveDividers).toEqual([]);
  await workbench.getByRole('dialog', { name: 'Salesforce tools' }).evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await captureElectronScreenshot(app.electron, main, testInfo.outputPath('salesforce-section-launcher.png'));
  await main.keyboard.press('Escape');
  await expect(launcher).toBeFocused();

  // User-facing detach opens only the requested resource; the main Studio remains usable.
  await agentTabs.getByRole('button', { name: 'Open Help.agent in its own window', exact: true }).click();
  const resourceWindow = async (path: string): Promise<Page> => {
    let found: Page | undefined;
    await expect.poll(() => {
      found = studioWindows(app.electron).find(page => new URL(page.url()).searchParams.get('resourceId') === path);
      return Boolean(found);
    }, { timeout: 25_000 }).toBe(true);
    found!.on('pageerror', error => errors.push(error.message));
    await found!.setViewportSize({ width: 1440, height: 950 });
    await expect(found!.getByTestId('salesforce-agent-script-panel').locator('.af-document-name')).toHaveText(path.split('/').at(-1)!);
    return found!;
  };
  const help = await resourceWindow('force-app/Help.agent');
  await expect(help.locator('.statusbar')).toHaveCount(0);
  await expect.poll(() => main.evaluate(async id => {
    const reply = await window.cc.pluginApps.callRpc('salesforce', 'agentDoc.open', { projectId: id, path: 'force-app/Help.agent' }) as { doc?: { lease?: { label?: string } } };
    return reply.doc?.lease?.label;
  }, projectId)).toBe('Agentforce Studio window');
  await expect(help.getByTestId('salesforce-agent-held-banner')).toHaveCount(0);
  await expect(help.frameLocator('iframe[title="Agentforce playground"]').locator('.view-lines')).toContainText('# window handoff keeps this unsaved draft');
  await expect(script).toBeVisible();
  await expect(main.getByTestId('salesforce-studio-detached')).toHaveCount(0);
  await expect(help.getByTestId('thread-timeline')).toContainText('Review only Help.agent routing.');
  await agentTabs.getByRole('button', { name: 'Open Orders.agent in its own window', exact: true }).click();
  const orders = await resourceWindow('force-app/Orders.agent');
  await expect.poll(() => liveStudioWindows(app.electron)).toBe(2);
  await expect(orders.getByTestId('thread-timeline')).toHaveCount(0);
  await expect(orders.locator('[data-testid="studio-view-preview"]:visible')).toHaveAttribute('data-agent', 'force-app/Orders.agent');
  await expect(help.getByRole('tablist', { name: 'Open agents' }).getByRole('tab')).toHaveCount(1);
  await expect(orders.getByRole('tablist', { name: 'Open agents' }).getByRole('tab')).toHaveCount(1);
  await expect.poll(async () => {
    const linked = await main.evaluate(id => window.cc.pluginApps.callRpc('salesforce', 'studio.threads', { projectId: id, path: 'force-app/Help.agent' }), projectId) as { threads: Array<{ threadId: string }> };
    return main.evaluate(({ id, threadId }) => window.cc.pluginApps.callRpc('salesforce', 'studio.view.get', { projectId: id, threadId }), { id: projectId, threadId: linked.threads[0].threadId });
  }).toMatchObject({ shared: true, state: { path: 'force-app/Help.agent' } });

  for (const theme of ['light', 'dark']) {
    await help.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [1440, 760, 480]) {
      await help.setViewportSize({ width, height: 950 });
      const tools = help.getByTestId('salesforce-workbench');
      const headerBounds = await tools.locator('.sf-workbench-toolbar').evaluate(el => ({ overflow: el.scrollWidth - el.clientWidth, availableWidth: el.clientWidth, height: el.getBoundingClientRect().height }));
      expect(headerBounds.overflow, JSON.stringify({ width, theme, ...headerBounds })).toBeLessThanOrEqual(1);
      expect(headerBounds.height).toBeCloseTo(42, 1);
      await tools.getByRole('button', { name: 'Open Salesforce tools' }).click();
      const popup = tools.getByRole('dialog', { name: 'Salesforce tools' });
      const rect = await popup.boundingBox();
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      await expect(popup.locator('[data-section="agentforce"]')).toBeVisible();
      await popup.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (headerBounds.availableWidth <= 360) await expect(popup.getByRole('button', { name: 'Org details', exact: true })).toBeVisible();
      await captureElectronScreenshot(app.electron, help, testInfo.outputPath(`salesforce-launcher-${theme}-${width}.png`));
      if (width === 480 && theme === 'dark') {
        await popup.getByRole('button', { name: 'Connect org', exact: true }).click();
        await expect(help.getByRole('dialog', { name: 'Connect an org' })).toBeVisible();
        await help.getByRole('button', { name: 'Close connection dialog' }).click();
      } else await help.keyboard.press('Escape');
    }
  }
  await help.setViewportSize({ width: 1440, height: 950 });

  // A dedicated script can request Data in main without losing its assistant or retargeting.
  await selectSalesforceSection(help.getByTestId('salesforce-workbench'), 'data');
  await expect(workbench.getByRole('button', { name: 'Open Salesforce tools' })).toContainText('Data');
  await expect(help.getByTestId('salesforce-agent-script-panel').locator('.af-document-name')).toHaveText('Help.agent');
  await expect(help.getByTestId('thread-timeline')).toContainText('Review only Help.agent routing.');
  await selectSalesforceSection(workbench, 'agentforce');

  // A second open focuses the existing resource window; another script cannot retarget it.
  expect(await main.evaluate(id => window.cc.windows.openPluginView({ pluginId: 'salesforce', tabId: 'salesforce', projectId: id, resourceId: 'force-app/Help.agent' }), projectId)).toBe(true);
  await expect.poll(() => liveStudioWindows(app.electron)).toBe(2);
  const views = await main.evaluate(id => window.cc.pluginApps.callRpc('salesforce', 'control.views', { projectId: id }), projectId) as { views: Array<{ id: string; window?: string; surface?: string; state?: { resourceId?: string } }> };
  const helpLease = views.views.find(view => view.window === 'plugin-view' && view.surface === 'workbench' && view.state?.resourceId === 'force-app/Help.agent');
  expect(helpLease).toBeTruthy();
  const sent = await main.evaluate(({ id, viewId }) => window.cc.pluginApps.callRpc('salesforce', 'control.command', { projectId: id, viewId, command: 'view.open', input: { view: 'agentforce', path: 'force-app/Orders.agent' } }), { id: projectId, viewId: helpLease!.id }) as { commandId: string };
  const result = await main.evaluate(({ id, commandId }) => window.cc.pluginApps.callRpc('salesforce', 'control.result', { projectId: id, commandId, waitMs: 3000 }), { id: projectId, commandId: sent.commandId });
  expect(result).toMatchObject({ ok: false });
  await expect(help.getByTestId('salesforce-agent-script-panel').locator('.af-document-name')).toHaveText('Help.agent');
  await captureElectronScreenshot(app.electron, help, testInfo.outputPath('agent-window-help-assistant.png'));
  await captureElectronScreenshot(app.electron, orders, testInfo.outputPath('agent-window-orders-preview.png'));

  // Each AgentScript persists its own native geometry through the config boundary.
  const resourceBounds = async (path: string) => app.electron.evaluate(({ BrowserWindow }, resourceId) => {
    const window = BrowserWindow.getAllWindows().find(item =>
      new URL(item.webContents.getURL()).searchParams.get('resourceId') === resourceId);
    if (!window) throw Error('Resource window is missing.');
    return window.getNormalBounds();
  }, path);
  await app.electron.evaluate(({ BrowserWindow }) => {
    for (const [resourceId, width, height] of [['force-app/Help.agent', 900, 650], ['force-app/Orders.agent', 1000, 700]] as const) {
      const window = BrowserWindow.getAllWindows().find(item =>
        new URL(item.webContents.getURL()).searchParams.get('resourceId') === resourceId);
      if (!window) throw Error('Resource window is missing.');
      window.setBounds({ width, height });
    }
  });
  const helpBounds = await resourceBounds('force-app/Help.agent');
  const ordersBounds = await resourceBounds('force-app/Orders.agent');
  await expect.poll(() => main.evaluate(() => window.cc.config.get())).toMatchObject({ pluginViewWindowBounds: {
    [JSON.stringify(['salesforce', 'salesforce', projectId, 'force-app/Help.agent'])]: { bounds: helpBounds },
    [JSON.stringify(['salesforce', 'salesforce', projectId, 'force-app/Orders.agent'])]: { bounds: ordersBounds }
  } });

  // Reload and close/reopen restore this script's workspace without touching the other window.
  await help.reload();
  await expect(help.getByTestId('thread-timeline')).toContainText('Review only Help.agent routing.', { timeout: 30_000 });
  // Keep the main editor mounted as a follower, then close immediately after typing.
  await agentTabs.getByRole('tab', { name: /^Help\.agent/ }).click();
  await expect(main.getByTestId('salesforce-agent-detached-banner')).toBeVisible();
  const helpEditor = help.frameLocator('iframe[title="Agentforce playground"]');
  await helpEditor.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await help.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await help.keyboard.insertText('# last native keystroke survives bring back\n');
  await help.getByTestId('plugin-view-bring-back').click();
  await expect.poll(() => liveStudioWindows(app.electron)).toBe(1);
  await expect(orders.getByTestId('salesforce-agent-script-panel').locator('.af-document-name')).toHaveText('Orders.agent');
  await expect(script.locator('.af-document-name')).toHaveText('Help.agent');
  await expect(mainEditor.locator('.view-lines')).toContainText('# window handoff keeps this unsaved draft');
  await expect(mainEditor.locator('.view-lines')).toContainText('# last native keystroke survives bring back');
  await expect.poll(() => main.evaluate(async id => {
    const reply = await window.cc.pluginApps.callRpc('salesforce', 'agentDoc.open', { projectId: id, path: 'force-app/Help.agent' }) as { doc?: { lease?: { label?: string } } };
    return reply.doc?.lease?.label;
  }, projectId)).toBe('Agentforce Studio');
  await expect(main.getByTestId('salesforce-agent-held-banner')).toHaveCount(0);
  await expect(panel.getByTestId('thread-timeline')).toContainText('Review only Help.agent routing.');
  await agentTabs.getByRole('button', { name: 'Open Help.agent in its own window', exact: true }).click();
  const reopened = await resourceWindow('force-app/Help.agent');
  await expect.poll(() => resourceBounds('force-app/Help.agent')).toEqual(helpBounds);
  expect(await resourceBounds('force-app/Orders.agent')).toEqual(ordersBounds);
  await expect(reopened.getByTestId('thread-timeline')).toContainText('Review only Help.agent routing.');
  const reopenedEditor = reopened.frameLocator('iframe[title="Agentforce playground"]');
  await reopenedEditor.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await reopened.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await reopened.keyboard.insertText('# last native keystroke survives native close\n');
  await app.electron.evaluate(({ BrowserWindow }, path) => {
    const window = BrowserWindow.getAllWindows().find(item => {
      const location = item.webContents.getURL();
      if (!location.includes('surface=plugin-view')) return false;
      const url = new URL(location);
      return url.searchParams.get('surface') === 'plugin-view' && url.searchParams.get('resourceId') === path;
    });
    if (!window) throw Error('Resource window is missing.');
    window.close();
  }, 'force-app/Help.agent');
  await expect.poll(() => liveStudioWindows(app.electron)).toBe(1);
  await expect(mainEditor.locator('.view-lines')).toContainText('# last native keystroke survives native close');
  await expect.poll(() => main.evaluate(async id => {
    const reply = await window.cc.pluginApps.callRpc('salesforce', 'agentDoc.open', { projectId: id, path: 'force-app/Help.agent' }) as { doc?: { lease?: { label?: string } } };
    return reply.doc?.lease?.label;
  }, projectId)).toBe('Agentforce Studio');
  expect(errors).toEqual([]);
});

test('Salesforce hub: project tools, recent agents, themes, narrow layout and Studio window', async ({ app, home }, testInfo) => {
  const { window: main, electron } = app;
  await main.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  main.on('pageerror', error => errors.push(error.message));
  expect(await main.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = main.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => main.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  // Wait for the complete bundled startup before the test starts an agent.
  expect(await main.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', true))).toMatchObject({ ok: true });
  const projectId = await main.evaluate(async path => {
    const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id;
  }, join(home, 'dx'));
  await main.evaluate(() => window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' }));
  const hub = main.getByTestId('salesforce-orgs-panel');
  const openHub = async () => {
    await route(main, '/plugins/salesforce/orgs');
    await expect(hub.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue(projectId);
  };
  // The plugin runtime can be running before its navigation contribution reaches the renderer.
  await main.getByRole('button', { name: 'Salesforce', exact: true }).click();
  await openHub();
  for (const [tile, tab] of [['Data', 'Data'], ['Apex & logs', 'Apex & logs'], ['Deployments', 'Deployments'], ['Project home', 'Overview']] as const) {
    await hub.locator('.sf-hub-tile').filter({ has: main.getByText(tile, { exact: true }) }).click();
    await expect(main.getByTestId('salesforce-workbench').getByRole('button', { name: 'Open Salesforce tools' })).toContainText(tab);
    await openHub();
  }
  await hub.getByRole('button', { name: 'Open Studio', exact: true }).click();
  await expect(main.getByTestId('salesforce-agent-script-panel')).toBeVisible();
  await main.getByTestId('salesforce-agent-script-file:force-app/Help.agent').click();
  await expect(main.frameLocator('iframe[title="Agentforce playground"]').locator('.view-lines')).toContainText('Support_Concierge');
  await captureElectronScreenshot(electron, main, testInfo.outputPath('salesforce-project-rail.png'));
  await main.getByTestId('plugin-panel-agent-show').click();
  await expect(main.getByTestId('panel-agent-tab-composer')).toBeVisible();
  await captureElectronScreenshot(electron, main, testInfo.outputPath('salesforce-project-agent.png'));
  const projectComposer = main.getByTestId('panel-agent-tab-composer');
  await projectComposer.getByTestId('thread-command-input').fill('Help me understand this agent configuration.');
  await expect(projectComposer.getByTestId('thread-command-send')).toBeEnabled();
  await projectComposer.getByTestId('thread-command-send').click();
  const projectChat = main.getByTestId('panel-agent-tab-chat');
  await expect(projectChat.getByTestId('thread-command-input')).toBeVisible({ timeout: 30_000 });
  await expect(projectChat.getByTestId('thread-timeline')).toContainText('Response to: Help me understand this agent configuration.', { timeout: 30_000 });
  await captureElectronScreenshot(electron, main, testInfo.outputPath('salesforce-project-conversation.png'));
  await main.getByTestId('thread-secondary-hide').click();
  await openHub();
  await expect(hub.getByRole('list', { name: 'Recent agents' }).getByRole('button')).toContainText('Help');
  for (const theme of ['dark', 'light']) {
    await main.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1440, 760, 480]) {
      await main.setViewportSize({ width, height: 900 });
      const overflow = await hub.evaluate(el => {
        const right = el.getBoundingClientRect().right;
        return { pixels: el.scrollWidth - el.clientWidth, elements: Array.from(el.querySelectorAll('*')).filter(child => child.getBoundingClientRect().right > right + 1).map(child => ({ tag: child.tagName, className: child.className, text: child.textContent?.slice(0, 100), right: child.getBoundingClientRect().right, width: child.getBoundingClientRect().width })) };
      });
      expect(overflow.pixels, JSON.stringify(overflow.elements)).toBeLessThanOrEqual(1);
      expect(await hub.locator(':scope > h3').first().evaluate(el => getComputedStyle(el).marginTop)).toBe('28px');
      await captureElectronScreenshot(electron, main, testInfo.outputPath(`salesforce-hub-${theme}-${width}.png`));
    }
  }
  await main.setViewportSize({ width: 1440, height: 900 });
  await hub.getByRole('list', { name: 'Recent agents' }).getByRole('button').click();
  await expect(main.getByTestId('salesforce-agent-script-panel').locator('.af-document-name')).toHaveText('Help.agent');
  await openHub();
  await hub.getByRole('button', { name: 'Open in own window' }).click();
  const studio = await waitForStudio(electron);
  await expect(studio.getByTestId('salesforce-workbench')).toHaveAttribute('data-surface', 'studio-window');
  await expect(studio.getByTestId('salesforce-agent-script-panel')).toBeVisible();
  await expect(studio.getByTestId('salesforce-workbench').getByRole('tablist', { name: 'Salesforce tools' })).toHaveCount(0);
  await studio.getByTestId('plugin-view-bring-back').click();
  await expect.poll(() => liveStudioWindows(electron)).toBe(0);
  expect(errors).toEqual([]);
});

test('Salesforce Studio window: one owner, status card, cross-window org sync and bring back', async ({ app, home }, testInfo) => {
  const { window: main, electron } = app;
  const errors: string[] = [];
  main.on('pageerror', (error) => errors.push(`main: ${error.message}`));
  expect(await main.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = main.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => main.evaluate(async () => {
    const plugin = (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce');
    return { status: plugin?.status, detail: plugin?.statusDetail };
  }), { timeout: 30_000 }).toMatchObject({ status: expect.stringMatching(/running|needs-configuration/) });
  const projectId = await main.evaluate(async (path) => {
    const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id;
  }, join(home, 'dx'));
  await main.evaluate(() => window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' }));
  await route(main, `/projects/${projectId}`);
  const nav = main.getByRole('navigation', { name: 'dx navigation' });
  await nav.getByRole('button', { name: 'Salesforce', exact: true }).click();
  const tab = main.getByTestId('salesforce-workbench');
  await expect(tab.getByRole('button', { name: 'Open Salesforce tools' })).toContainText('Overview');

  // Open: the Studio window shows Agentforce only, with no Data, Apex or Deploy activity bar.
  await tab.getByTestId('plugin-tab-open-in-window').click();
  const studio = await waitForStudio(electron);
  await studio.setViewportSize({ width: 1440, height: 900 });
  studio.on('pageerror', (error) => errors.push(`studio: ${error.message}`));
  // The Studio titles its own window: the view, then the project and org. A sandbox gets no risk badge.
  const title = studio.getByTestId('plugin-view-title');
  await expect(title).toHaveText('Agentforce — dx · studio');
  await expect(studio).toHaveTitle(/^Agentforce — dx · studio — /);
  await expect(studio.getByTestId('plugin-view-title-badge')).toHaveCount(0);
  const workbench = studio.getByTestId('salesforce-workbench');
  await expect(workbench).toHaveAttribute('data-surface', 'studio-window');
  await expect(studio.getByTestId('salesforce-agent-script-panel')).toBeVisible();
  await expect(workbench.getByRole('tablist', { name: 'Salesforce tools' })).toHaveCount(0);
  for (const name of ['Data', 'Apex', 'Deploy', 'Home', 'Overview']) await expect(workbench.getByRole('tab', { name, exact: true })).toHaveCount(0);
  // General Salesforce tools live in the main window, one link away.
  await expect(workbench.getByRole('button', { name: 'Open Salesforce tools' })).toContainText('Agentforce');
  // The Studio window has no thread beside it, and no second window button.
  await expect(studio.getByRole('button', { name: 'Open beside agent' })).toHaveCount(0);
  await expect(studio.getByTestId('plugin-tab-open-in-window')).toHaveCount(0);

  // One live owner: the main tab keeps the general tools, without Agentforce, and a notice for the Studio window.
  const card = main.getByTestId('salesforce-studio-detached');
  await expect(card).toBeVisible();
  const mainTools = main.getByTestId('salesforce-workbench');
  await expect(mainTools).toBeVisible();
  await expect(main.getByTestId('salesforce-agent-script-panel')).toHaveCount(0);
  await expect(mainTools.getByRole('tab', { name: 'Agentforce', exact: true })).toHaveCount(0);
  await expect(mainTools.getByRole('button', { name: 'Open Salesforce tools' })).toContainText('Overview');
  const mainOrg = mainTools.getByTestId('salesforce-org-picker');
  await expect(mainOrg).toHaveValue('studio');

  // Focus and a second open reuse the same window.
  await card.getByRole('button', { name: 'Show window' }).click();
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
  // A realtime wake can race the window's subscription; allow its 5s fallback poll too.
  await expect.poll(() => main.evaluate(({ id, commandId }) => window.cc.pluginApps.callRpc('salesforce', 'control.result', {
    projectId: id, commandId, waitMs: 1000,
  }), { id: projectId, commandId: (sent as { commandId: string }).commandId }), { timeout: 15_000 })
    .toMatchObject({ ok: true, state: 'completed' });
  await expect(studio.getByTestId('salesforce-agent-script-panel').locator('.af-document-name')).toHaveText('Help.agent');
  await expect(title).toHaveText('Agentforce · Help — dx · studio');
  await expect(studio).toHaveTitle(/^Agentforce · Help — dx · studio — /);

  // The detached window uses the same host tools beside its source editor.
  const studioPanel = studio.getByTestId('salesforce-agent-script-panel');
  const sidePanel = studio.getByTestId('plugin-panel-host-layout').getByTestId('thread-secondary-panel');
  await expect(studio.getByTestId('plugin-panel-agent-show')).toBeVisible();
  await expect(studio.getByTestId('plugin-panel-secondary-show')).toBeVisible();
  await expect(studioPanel.locator('.af-tools')).toHaveCount(0);
  await captureElectronScreenshot(electron, studio, testInfo.outputPath('salesforce-detached-rail.png'));
  // Preview opens in the host panel while the Script remains central.
  await studioPanel.locator('.af-document-bar').getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(studioPanel.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: 'Preview', exact: true })).toHaveCount(0);
  await expect(studioPanel.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /^Script/ })).toHaveAttribute('aria-selected', 'true');
  await expect(sidePanel.locator('.thread-secondary-tab.is-active .thread-secondary-tab-label')).toHaveText('Preview');
  await expect(sidePanel.locator('[data-testid="studio-view-preview"]:visible').getByTestId('preview-workbench')).toBeVisible();
  await expect(studioPanel.locator('iframe[title="Agentforce playground"]')).toBeVisible();
  // Detached windows expose the same explicit owner and pin controls as the main Studio.
  const previewOwner = sidePanel.locator('[data-testid="studio-view-preview"]:visible');
  await expect(previewOwner).toHaveAttribute('data-agent', 'force-app/Help.agent');
  await previewOwner.getByRole('button', { name: 'Pin Preview to Help.agent', exact: true }).click();
  await expect(previewOwner.getByRole('button', { name: 'Follow selected agent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sidePanel.getByTestId('thread-secondary-hide').click();
  await expect(sidePanel).toBeHidden();
  await studio.getByTestId('plugin-panel-secondary-show').click();
  await expect(previewOwner).toBeVisible();
  await expect(previewOwner.getByRole('button', { name: 'Follow selected agent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await previewOwner.getByRole('button', { name: 'Follow selected agent', exact: true }).click();
  await expect(previewOwner.getByRole('button', { name: 'Pin Preview to Help.agent', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await captureElectronScreenshot(electron, studio, testInfo.outputPath('salesforce-detached-preview.png'));
  if (!await sidePanel.isVisible()) await studio.getByTestId('plugin-panel-secondary-show').click();
  await expect(sidePanel).toBeVisible();
  await openThreadToolLauncher(sidePanel);
  await expect(sidePanel.getByTestId('thread-new-tab-plugin-salesforce-studio-actions')).toBeVisible();
  for (const tool of ['graph', 'preview', 'test', 'org-preview', 'comments']) await expect(sidePanel.getByTestId(`thread-new-tab-plugin-salesforce-studio-${tool}`)).toBeVisible();
  // The window has no app shell, yet its Agent composer keeps the desktop toolbar.
  await sidePanel.getByTestId('thread-new-tab-agent').click();
  const panelComposer = sidePanel.getByTestId('panel-agent-tab-composer');
  await expect(panelComposer).toBeVisible();
  await expect(panelComposer.locator('.thread-command-option-label').first()).toBeHidden();
  await expect(panelComposer.locator('.thread-command-options-toggle')).toBeHidden();
  // The page's project is fixed, so there is no project, folder or machine to pick, and no Create plugin.
  await expect(panelComposer.locator('.thread-command-project')).toHaveCount(0);
  await expect(panelComposer.locator('.composer-run-setting')).toHaveCount(0);
  await expect(panelComposer.getByTestId('composer-create-plugin')).toHaveCount(0);
  await captureElectronScreenshot(electron, studio, testInfo.outputPath('salesforce-detached-agent.png'));
  await panelComposer.getByTestId('thread-command-input').fill('Help me review this agent before previewing it.');
  await expect(panelComposer.getByTestId('thread-command-send')).toBeEnabled();
  await panelComposer.getByTestId('thread-command-send').click();
  const chat = sidePanel.getByTestId('panel-agent-tab-chat');
  await expect(chat.getByTestId('thread-command-input')).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByTestId('thread-timeline')).toContainText('Response to: Help me review this agent before previewing it.', { timeout: 30_000 });
  await captureElectronScreenshot(electron, studio, testInfo.outputPath('salesforce-detached-conversation.png'));
  await sidePanel.getByTestId('thread-secondary-hide').click();
  await expect(sidePanel).toBeHidden();

  // An org chosen in the Studio window reaches the main card without a reload.
  const picker = workbench.getByTestId('salesforce-org-picker');
  await expect(picker).toBeEnabled();
  await picker.selectOption('second');
  await expect(mainOrg).toHaveValue('second');
  await expect(title).toHaveText('Agentforce · Help — dx · second');

  // Bring back from the card: the window closes and the tab mounts here again.
  await card.getByRole('button', { name: 'Bring back here' }).click();
  await expect.poll(() => liveStudioWindows(electron), { timeout: 15_000 }).toBe(0);
  await expect(main.getByTestId('salesforce-workbench')).toBeVisible();
  await expect(main.getByTestId('salesforce-studio-detached')).toHaveCount(0);
  await expect(main.getByTestId('salesforce-workbench').getByRole('button', { name: 'Open Salesforce tools' })).toBeVisible();
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
