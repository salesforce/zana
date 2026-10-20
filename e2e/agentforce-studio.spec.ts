import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { AGENT_SCRIPT_EXAMPLES } from '../plugins/salesforce/lib/agent-script-model.js';
import { ACTION_AGENT, ACTION_APEX, ACTION_FLOW, ACTION_FLOW_XML } from '../plugins/salesforce/src/action-fixtures.js';
import { VISUALIZER_FLOW } from '../plugins/salesforce/src/flow-visualizer-fixtures.js';
import { flowSnapshotXml } from '../plugins/salesforce/lib/flow-visualizer.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const toolbarFile = 'force-app/main/default/aiAuthoringBundles/Customer_Service_Agent_With_A_Long_Name/Customer_Service_Agent_With_A_Long_Name.agent';
// Replace only the upstream network in the installed fixture. The real transport,
// session service, plugin RPC, Monaco iframe and Electron UI all run unchanged.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const requests: Array<{ path: string; host: string; body: Record<string, unknown> }> = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const path = req.url!;
      requests.push({ path, host: String(req.headers['x-fixture-host']), body });
      writeFileSync(join(home, 'sfap-requests.json'), JSON.stringify(requests));
      let result: unknown;
      const query = new URL(path, 'http://localhost').searchParams.get('q') ?? '';
      if (path.includes('/tooling/query')) {
        if (query.includes('FROM BotVersion')) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify([{ errorCode: 'INVALID_TYPE', message: "sObject type 'BotVersion' is not supported." }])); return; }
        // Freshness stamps: the org copy is then retrieved in source format by the fake CLI below.
        if (query.includes('Id, LastModifiedDate FROM ApexClass')) result = { records: [{ Id: '01p000000000001', LastModifiedDate: '2026-10-01T10:00:00.000+0000' }] };
        else if (query.includes('FROM FlowDefinition')) result = { records: [{ Id: '300000000000001', LastModifiedDate: '2026-10-01T10:00:00.000+0000', ActiveVersion: { VersionNumber: 7 }, LatestVersion: { VersionNumber: 7, LastModifiedDate: '2026-10-01T10:00:00.000+0000' } }] };
        else result = query.includes('FROM ApexClass') ? { records: [{ Body: '// Deployed org implementation\n' + ACTION_APEX + '// Deployed detail\n'.repeat(1200) + '// ORG_SOURCE_COMPLETE' }] } : { records: [{ Id: '3010001', VersionNumber: 7, Metadata: ACTION_FLOW }] };
      } else if (path.includes('/query?') && query.includes('FROM BotVersion')) {
        if (existsSync(join(home, 'sf-versions-unavailable'))) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify([{ errorCode: 'SERVER_UNAVAILABLE', message: 'Try again shortly.' }])); return; }
        result = { totalSize: 1, done: true, records: [{ Id: '0X9000000000001', Status: 'Inactive', VersionNumber: 7, LastModifiedDate: '2026-10-01T10:00:00.000Z' }] };
      } else if (path.includes('/query?')) result = { totalSize: 1, done: true, records: [{ Id: '001000000000001', Name: 'Workbench result account' }] };
      else if (path.endsWith('/sobjects')) result = { sobjects: [{ name: 'Account', label: 'Account', queryable: true }] };
      else if (path.endsWith('/limits')) result = { DailyApiRequests: { Max: 10000, Remaining: 9999 } };
      else if (path.includes('/actions/custom/apex/')) result = { inputs: [{ name: 'orderId', type: 'String', required: true }], outputs: [{ name: 'status', type: 'String' }] };
      else if (path.endsWith('/nameduser')) result = { access_token: 'PRIVATE_NAMED_JWT' };
      else if (path.endsWith('/authoring/scripts')) result = { status: 'success', compiledArtifact: { globalConfiguration: { label: 'Support concierge' } } };
      else if (path.endsWith('/preview/sessions')) result = { sessionId: 'remote-session', messages: [{ message: 'Hello! I’m your support concierge. How can I help today?' }] };
      else if (path.endsWith('/messages')) {
        const text = body.message.text;
        if (text === 'Fail this turn') { res.writeHead(503); res.end('{}'); return; }
        if (text === 'Wait for cancellation') { await new Promise(resolve => setTimeout(resolve, 8000)); }
        result = { messages: [{ message: text === 'Long response' ? 'Complete response. '.repeat(1200) + 'END_OF_RESPONSE' : 'I can help you track an order or resolve an issue. Could you share your order number so I can find the right details?', planId: 'plan-e2e-1' }] };
      } else if (path.endsWith('/chat-generations')) {
        const system = body.messages[0].content as string;
        result = { generationDetails: { generations: [{ content: system.startsWith('Evaluate') ? JSON.stringify({ outcome: 'pass', reason: 'The agent stayed within scope and asked for the missing order details.', evidence: ['The agent asked for an order number before proceeding.'] }) : system.includes('CUSTOMER') ? 'My order is ORD-1042. Can you check the delivery date?' : 'I can help with that. What is your order number?' }] } };
      } else { res.writeHead(404); res.end('{}'); return; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const pluginDir = join(home, 'bundled', 'salesforce');
    mkdirSync(pluginDir, { recursive: true });
    for (const name of ['app.js', 'app.meta.json', 'playground', 'flow-visualizer']) cpSync(join(root, 'plugins/salesforce', name), join(pluginDir, name), { recursive: true });
    const pkg = JSON.parse(readFileSync(join(root, 'plugins/salesforce/package.json'), 'utf8'));
    delete pkg.dependencies; delete pkg.devDependencies; delete pkg.scripts; delete pkg.zcc.skills;
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(pluginDir, 'server.ts'), `
      import { createSalesforcePlugin } from ${JSON.stringify(join(root, 'plugins/salesforce/lib/plugin.ts'))};
      import { AgentforceTransport } from ${JSON.stringify(join(root, 'plugins/salesforce/lib/agentforce-transport.ts'))};
      import { createNodeDeps } from ${JSON.stringify(join(root, 'plugins/salesforce/lib/node-deps.ts'))};
      import { salesforceRestRequest } from ${JSON.stringify(join(root, 'plugins/salesforce/lib/sf-cli.ts'))};
      export default async function(zcc) {
        const transport = new AgentforceTransport((url, init) => {
          const upstream = new URL(url);
          return fetch('http://127.0.0.1:${port}' + upstream.pathname, { ...init, headers: { ...init.headers, 'x-fixture-host': upstream.hostname } });
        });
        const deps = createNodeDeps();
        deps.request = (org, request) => salesforceRestRequest({ ...org, instanceUrl: 'http://127.0.0.1:${port}' }, request);
        await createSalesforcePlugin(zcc, deps, transport);
      }
    `);
    const bin = join(home, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'sf'), `#!${process.execPath}
const args = process.argv.slice(2);
const fs = require('node:fs');
const path = require('node:path');
const org = { alias:'studio', username:'studio@example.com', orgId:'00D000000000001', instanceUrl:'https://studio.my.salesforce.com', isSandbox:true, accessToken:'PRIVATE_CLI_TOKEN' };
let result = args.includes('display') ? org : args.includes('list') ? { sandboxes:[org] } : {};
const orgStatePath = path.join(process.env.HOME, 'sf-org-state');
if (args[0] === 'org' && args[1] === 'list' && args[2] !== 'metadata' && fs.existsSync(orgStatePath)) {
  const state = fs.readFileSync(orgStatePath, 'utf8');
  if (state === 'missing') process.exit(127);
  if (state === 'failed') { console.error('PRIVATE_CLI_ERROR'); process.exit(1); }
  if (state === 'empty') result = { sandboxes: [] };
  if (state === 'expired') result = { sandboxes: [{ ...org, connectedStatus: 'RefreshTokenAuthError' }] };
}
if (args[0] === 'org' && args[1] === 'list' && args[2] === 'metadata') result = [...Array.from({ length: 450 }, (_, index) => ({ fullName: 'Agent_' + index + '_v1', lastModifiedDate: '2026-09-23T08:00:00Z' })), { fullName: 'Support_v1' }, { fullName: 'Support_v2' }, { fullName: 'Unavailable_v1' }, { fullName: 'Z_Last_v1' }];
if (args[0] === 'org' && args[1] === 'list' && args[2] === 'metadata') {
  const statePath = path.join(process.env.HOME, 'sf-metadata-state');
  const state = () => fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
  const deadline = Date.now() + 15000;
  while (state() === 'hold' && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  if (state() === 'empty') result = [];
  if (state() === 'denied') { console.log(JSON.stringify({ status: 1, message: 'Metadata API access denied for this org.' })); process.exit(1); }
}
// Implementation source, retrieved by manifest like the real CLI: files land in the temp project and are reported in files[].
if (args[0] === 'project' && args[1] === 'retrieve' && args.includes('--manifest')) {
  const xml = fs.readFileSync(path.join(process.cwd(), 'package.xml'), 'utf8');
  const base = path.join(process.cwd(), 'force-app/main/default');
  const files = [];
  const write = (type, fullName, rest, content) => {
    const file = path.join(base, rest);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    files.push({ fullName, type, state: 'Created', filePath: file });
  };
  if (xml.includes('<members>OrderLookup</members>')) {
    write('ApexClass', 'OrderLookup', 'classes/OrderLookup.cls', ${JSON.stringify('// Deployed org implementation\n' + ACTION_APEX + '// Deployed detail\n'.repeat(1200) + '// ORG_SOURCE_COMPLETE')});
    write('ApexClass', 'OrderLookup', 'classes/OrderLookup.cls-meta.xml', '<ApexClass/>');
  }
  if (xml.includes('<members>CheckReturn</members>')) write('Flow', 'CheckReturn', 'flows/CheckReturn.flow-meta.xml', ${JSON.stringify(ACTION_FLOW_XML)});
  fs.appendFileSync(path.join(process.env.HOME, 'source-retrievals.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
  console.log(JSON.stringify({ status: 0, result: { success: true, done: true, files, fileProperties: [] } }));
  process.exit(0);
}
// Opt-in org versions for the Release viewer: { fullName: { target, content } }.
const versionsPath = path.join(process.env.HOME, 'sf-version-bundles');
const versionBundles = fs.existsSync(versionsPath) ? JSON.parse(fs.readFileSync(versionsPath, 'utf8')) : null;
if (versionBundles && args[0] === 'org' && args[1] === 'list' && args[2] === 'metadata') result = Object.keys(versionBundles).map(fullName => ({ fullName }));
if (versionBundles && args[0] === 'project' && args[1] === 'retrieve') {
  args.forEach((flag, index) => {
    if (flag !== '--metadata') return;
    const fullName = args[index + 1].split(':')[1];
    const dir = path.join(process.cwd(), 'force-app/main/default/aiAuthoringBundles', fullName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fullName + '.agent'), versionBundles[fullName].content);
    fs.writeFileSync(path.join(dir, fullName + '.bundle-meta.xml'), '<AiAuthoringBundle><target>' + versionBundles[fullName].target + '</target></AiAuthoringBundle>');
  });
  console.log(JSON.stringify({ status: 0, result: { success: true, done: true } }));
  process.exit(0);
}
if (args[0] === 'project' && args[1] === 'retrieve') {
  const fullName = args[args.indexOf('--metadata') + 1].split(':')[1];
  if (fullName === 'Unavailable_v1') { console.log(JSON.stringify({ status: 1, message: 'Source access denied' })); process.exit(1); }
  const dir = path.join(process.cwd(), 'force-app/main/default/aiAuthoringBundles', fullName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fullName + '.agent'), ${JSON.stringify(AGENT_SCRIPT_EXAMPLES[0].source + '\n' + '# Retrieved source detail\n'.repeat(1100) + '# ORG_AGENT_SOURCE_COMPLETE\n')});
  fs.writeFileSync(path.join(dir, fullName + '.bundle-meta.xml'), '<AiAuthoringBundle><target>Support.v1</target></AiAuthoringBundle>');
  result = { success: true, done: true, status: 'Succeeded', detail: 'complete metadata output '.repeat(800), marker: 'RETRIEVE_COMPLETE' };
  fs.appendFileSync(path.join(process.env.HOME, 'agent-retrievals.jsonl'), JSON.stringify({ args, cwd: process.cwd(), home: process.env.HOME }) + '\\n');
}
if (args[0] === 'agent' && args[1] === 'preview') result = { sessionId:'cli-preview', messages:[{ message: args[2] === 'send' ? 'CLI preview response. '.repeat(1100) + 'CLI_END_OF_RESPONSE' : 'Ready' }] };
if (args[0] === 'agent' && ['validate', 'preview', 'test', 'publish', 'activate', 'deactivate'].includes(args[1])) {
  fs.appendFileSync(path.join(process.env.HOME, 'agent-cli.jsonl'), JSON.stringify({ args, cwd: process.cwd(), home: process.env.HOME }) + '\\n');
  if (!fs.existsSync(path.join(process.cwd(), 'sfdx-project.json'))) { console.log(JSON.stringify({ status: 1, message: 'Agent command needs its DX project cwd' })); process.exit(1); }
  if (args[1] === 'test') {
    if (!fs.existsSync(args[args.indexOf('--spec') + 1])) { console.log(JSON.stringify({ status: 1, message: 'Evaluation spec is missing' })); process.exit(1); }
    result = { success: true, passedCount: 1, failedCount: 0, botVersionId: 'version-1' };
  }
}
console.log(JSON.stringify({ status:0, result }));
`, { mode: 0o700 });
    mkdirSync(join(home, 'dx', 'force-app'), { recursive: true });
    writeFileSync(join(home, 'dx', 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
    writeFileSync(join(home, 'dx', 'force-app', 'Support.agent'), AGENT_SCRIPT_EXAMPLES[0].source);
    mkdirSync(join(home, 'dx', 'force-app/main/default/aiAuthoringBundles/Customer_Service_Agent_With_A_Long_Name'), { recursive: true });
    writeFileSync(join(home, 'dx', toolbarFile), AGENT_SCRIPT_EXAMPLES[0].source);
    writeFileSync(join(home, 'dx', 'force-app', 'Orders.agent'), ACTION_AGENT);
    mkdirSync(join(home, 'dx', 'force-app', 'main', 'default', 'classes'), { recursive: true });
    mkdirSync(join(home, 'dx', 'force-app', 'main', 'default', 'flows'), { recursive: true });
    writeFileSync(join(home, 'dx', 'force-app', 'main', 'default', 'classes', 'OrderLookup.cls'), ACTION_APEX);
    writeFileSync(join(home, 'dx', 'force-app', 'main', 'default', 'flows', 'CheckReturn.flow-meta.xml'), ACTION_FLOW_XML);
    try { await use({ PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ZCC_BUNDLED_PLUGINS_DIR: join(home, 'bundled'), ZCC_FAKE_PROVIDER: '1', SF_TARGET_ORG: '', SFDX_DEFAULTUSERNAME: '' }); }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(180_000);

/** An open agent focuses the explorer on itself; widen it to every project agent before navigating elsewhere. */
async function showAllAgents(studio: import('@playwright/test').Locator) {
  const all = studio.getByTestId('sf-explorer-all-agents');
  if (await all.isVisible()) await all.click();
}

/** Org row actions appear on hover or focus; reveal the row's Retrieve button, then press it. */
async function retrieveOrgAgent(agents: import('@playwright/test').Locator, name: string) {
  await agents.locator('.af-agent-row').filter({ has: agents.page().getByTitle(name, { exact: true }) }).hover();
  await agents.getByRole('button', { name: `Retrieve & open ${name}`, exact: true }).click();
}

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

/** Studio itself, without the tools it shows in the host side panel. */
const studioPanel = (page: Page) => page.getByTestId('salesforce-agent-script-panel');
/** Studio plus the tool it renders into the host side panel beside the Salesforce tab. */
const studioIn = (page: Page) => studioPanel(page).or(page.locator('.sf-panel-tool'));
/** The host side panel beside the Salesforce tab. */
const sidePanel = (page: Page) => page.getByTestId('plugin-panel-host-layout').getByTestId('thread-secondary-panel');
const sidePanelTab = (page: Page, name: string) => sidePanel(page).locator('.thread-secondary-tabs').getByRole('button', { name, exact: true });
const activeSidePanelTab = (page: Page) => sidePanel(page).locator('.thread-secondary-tab.is-active .thread-secondary-tab-label');
const TOOL_IDS: Record<string, string> = { Agents: 'agents', 'Graph view': 'graph', Preview: 'preview', Tests: 'test', Release: 'release', Actions: 'actions', 'Org preview': 'org-preview', Comments: 'comments' };

/** Opens a Studio tool in the host side panel: its tab when open, else from the panel's New Tab page. */
async function openTool(studio: Locator, name: string) {
  const page = studio.page();
  if (!(await sidePanel(page).isVisible())) {
    await studioPanel(page).getByRole('button', { name: 'Show side panel', exact: true }).first().click();
    await expect(sidePanel(page)).toBeVisible();
  }
  const tab = sidePanelTab(page, name);
  if (await tab.count()) { await tab.click(); return; }
  await sidePanel(page).getByTestId('thread-secondary-new-tab').click();
  await sidePanel(page).getByTestId(`thread-new-tab-plugin-salesforce-studio-${TOOL_IDS[name]}`).click();
  await expect(activeSidePanelTab(page)).toHaveText(name);
}

test('Agentforce document toolbar and focused explorer: long paths, save state and narrow light/dark layouts', async ({ app, home }, testInfo) => {
  const page = app.window;
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id;
  }, join(home, 'dx'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  const frame = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(frame.getByTestId('agent-script-ide')).toBeVisible();
  await studio.getByTestId(`salesforce-agent-script-file:${toolbarFile}`).click();
  await expect(studio.locator('.af-document-name')).toHaveText('Customer_Service_Agent_With_A_Long_Name.agent');
  await expect(studio.getByLabel('Agentforce file', { exact: true })).toHaveAttribute('title', toolbarFile);
  await expect(studio.locator('.af-draft-state')).toHaveText('Saved');
  await expect(studio.locator('.af-document-bar').getByText('Saved', { exact: true })).toHaveCount(1);
  // Studio tools open in the host side panel, so Studio keeps no panel of its own.
  await expect(studio.locator('.af-tools')).toHaveCount(0);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 900 });
      const bar = studio.locator('.af-document-bar');
      expect(await bar.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      await expect(bar.getByRole('button', { name: 'Save Agentforce file' })).toBeVisible();
      await expect(bar.getByRole('button', { name: 'More save options' })).toBeVisible();
      await expect(bar.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
      // Compact studios drop the folder line; wide ones show it under the title.
      const folder = studio.locator('.af-document-folder');
      await expect(studio.locator('.sf-as-body.sf-studio')).toHaveAttribute('data-layout', width < 1000 ? 'compact' : 'wide');
      if (width < 1000) await expect(folder).toBeHidden();
      else {
        expect((await folder.boundingBox())!.y).toBeGreaterThan((await studio.locator('.af-document-name').boundingBox())!.y);
        const agent = studio.getByTestId(`salesforce-agent-script-file:${toolbarFile}`);
        await expect(agent).toHaveAttribute('aria-current', 'true');
        // The focused row needs room for its selection border and a gap between its icon and name.
        const spacing = await agent.evaluate(el => {
          const row = el.getBoundingClientRect();
          const icon = el.querySelector('.sf-as-kind-icon')!.getBoundingClientRect();
          const name = el.querySelector('.sf-as-tree-name')!.getBoundingClientRect();
          const meta = el.querySelector('.sf-as-tree-meta')!.getBoundingClientRect();
          return { left: icon.left - row.left, gap: name.left - icon.right, right: row.right - meta.right, overflow: el.scrollWidth - el.clientWidth };
        });
        // Allow subpixel rounding from Electron's display scale for the 6px spacing.
        expect(spacing.left).toBeGreaterThanOrEqual(5.5);
        expect(spacing.gap).toBeGreaterThanOrEqual(5.5);
        expect(spacing.right).toBeGreaterThanOrEqual(5.5);
        expect(spacing.overflow).toBeLessThanOrEqual(1);
      }
      await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`document-toolbar-${theme}-${width}.png`));
    }
  }
  await frame.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('# toolbar save verification\n');
  await expect(studio.locator('.af-draft-state')).toHaveText('Unsaved draft');
  await studio.getByRole('button', { name: 'Save Agentforce file' }).click();
  await expect(studio.locator('.af-draft-state')).toHaveText('Saved');
  expect(readFileSync(join(home, 'dx', toolbarFile), 'utf8')).toContain('# toolbar save verification');
  await studio.getByRole('button', { name: 'More save options' }).click();
  await studio.getByRole('menuitem', { name: 'Save as…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save agent to project' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('Agentforce Studio: edit, Preview API conversation, AI role-play, cancellation and evidence', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const installed = await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }));
  expect(installed).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id;
  }, join(home, 'dx'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  const workbench = page.getByTestId('salesforce-workbench');
  await workbench.getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  await expect(studioPanel(page)).toBeVisible();
  const frame = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(frame.getByTestId('agent-script-ide')).toBeVisible();
  // No example opens by default; the studio asks for a project agent.
  await expect(studio.getByTestId('salesforce-agent-script-no-file')).toContainText('Open an agent');
  await expect(studio.getByRole('button', { name: 'Support concierge', exact: true })).toHaveCount(0);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await expect(studio.getByTestId('salesforce-agent-script-no-file')).toHaveCount(0);
  await expect(frame.locator('.view-lines')).not.toHaveText('');
  // Assert actual rendered semantic colors, not only a theme class or marker.
  const keywordColor = () => frame.locator('.view-lines').evaluate(el => {
    const token = [...el.querySelectorAll('span')].find(node => node.textContent === 'config');
    return token ? getComputedStyle(token).color : 'uncolored';
  });
  await expect.poll(keywordColor, { timeout: 15_000 }).toBe('rgb(86, 156, 214)');
  await expect(studio.getByLabel('Agentforce dialect', { exact: true })).toHaveCount(0);
  await expect(page.locator('.project-topbar')).toHaveCount(0);
  await expect(workbench.getByRole('combobox', { name: 'Salesforce org', exact: true })).toHaveCount(1);
  await expect(frame.getByText('Agent definition', { exact: true })).toHaveCount(0);
  const editorBox = await studio.locator('iframe[title="Agentforce playground"]').boundingBox();
  const workbenchBox = await workbench.boundingBox();
  // Workbench tabs, file tabs and a one-row document bar sit above the code; a wrapping bar adds a fourth row.
  expect(editorBox!.y - workbenchBox!.y).toBeLessThanOrEqual(128);
  const codeBox = await frame.locator('.monaco-editor').boundingBox();
  // The editor fills the frame apart from the playground status bar; allow a classic horizontal scrollbar's worth of slack for
  // platforms that reserve one (the old flat 40px sat within 0.35px of Linux CI's 40.35px).
  const statusBox = await frame.locator('.statusbar').boundingBox();
  expect(codeBox!.height).toBeGreaterThan(editorBox!.height - statusBox!.height - 24);
  const explorerBox = await studio.getByTestId('salesforce-agent-script-explorer').boundingBox();
  expect(explorerBox!.x + explorerBox!.width).toBeLessThanOrEqual(editorBox!.x + 1);
  // A selection gets a one-row chip above it, and its Comment box opens in the editor under the lines.
  await frame.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  const chip = frame.locator('.sf-selection-chip');
  await expect(chip).toBeVisible();
  const [commentBox, askBox] = await Promise.all(['Comment', 'Ask agent'].map(name => chip.getByRole('button', { name, exact: true }).boundingBox()));
  expect(Math.abs(commentBox!.y - askBox!.y)).toBeLessThan(2);
  const selectionBox = await frame.locator('.selected-text').first().boundingBox();
  expect((await chip.boundingBox())!.y + (await chip.boundingBox())!.height).toBeLessThanOrEqual(selectionBox!.y + 1);
  await chip.getByRole('button', { name: 'Comment', exact: true }).click();
  // Monaco hides its view zones from the accessibility tree, so find the box by its markup.
  const commentForm = frame.locator('form[aria-label="Add comment"]');
  await expect(commentForm).toBeVisible();
  await expect(studio.locator('.sf-comment-form')).toHaveCount(0);
  expect((await commentForm.boundingBox())!.y).toBeGreaterThan(selectionBox!.y);
  await expect(commentForm.locator('textarea')).toBeFocused();
  await page.keyboard.type('Check this line');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-inline-comment.png'));
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await expect(commentForm).toHaveCount(0);
  await expect(frame.locator('.sf-comment-glyph')).toHaveCount(1);
  await expect(frame.locator('.view-lines')).not.toContainText('Check this line');
  // "Show side panel" opens the host side panel beside the tab; its New Tab page lists only Studio's tools.
  await studioPanel(page).getByRole('button', { name: 'Show side panel', exact: true }).first().click();
  await expect(sidePanel(page)).toBeVisible();
  await sidePanel(page).getByTestId('thread-secondary-new-tab').click();
  await expect(sidePanel(page).getByTestId('thread-new-tab-plugin-salesforce-studio-graph')).toBeVisible();
  await expect(sidePanel(page).getByTestId('thread-new-tab-plugin-salesforce-playground')).toHaveCount(0);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-add-tools.png'));
  await sidePanel(page).getByTestId('thread-new-tab-plugin-salesforce-studio-graph').click();
  const graph = page.frameLocator('iframe[title="AgentScript graph"]');
  await expect(graph.getByText('Conversation map')).toBeVisible();
  await expect(frame.locator('.view-lines')).toBeVisible();
  // The tool renders inside the host panel, not inside Studio.
  await expect(sidePanel(page).locator('.sf-panel-tool[data-studio-tool="graph"]')).toBeVisible();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-editor-graph-dark.png'));
  await sidePanel(page).getByTestId('thread-secondary-hide').click();
  await expect(sidePanel(page)).toBeHidden();
  await expect(frame.locator('.view-lines')).toBeVisible();
  // Showing it again reopens the last tool.
  await studioPanel(page).getByRole('button', { name: 'Show side panel', exact: true }).first().click();
  await expect(activeSidePanelTab(page)).toHaveText('Graph view');
  await expect(graph.getByText('Conversation map')).toBeVisible();
  await sidePanel(page).getByRole('button', { name: 'Close Graph view', exact: true }).click();
  // The remaining tab takes over; hiding the panel gives Studio its wide layout back.
  await expect(activeSidePanelTab(page)).toHaveText('Preview');
  await expect(sidePanel(page).locator('.sf-panel-tool[data-studio-tool="preview"]')).toBeVisible();
  await sidePanel(page).getByTestId('thread-secondary-hide').click();
  await expect(studio.getByTestId('salesforce-agent-script-explorer')).toBeVisible();
  // Edit the real Monaco model through normal keyboard input.
  await frame.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('# unsaved studio draft\n');
  // The last keystroke must survive parent-tab unmounts and file switches.
  await workbench.getByRole('tab', { name: 'Data', exact: true }).click();
  await workbench.getByRole('tab', { name: 'Agentforce', exact: true }).click();
  await expect(frame.locator('.view-lines')).toContainText('# unsaved studio draft');
  await expect(studio.getByTestId('sf-explorer-all-agents')).toBeVisible();
  await showAllAgents(studio);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Orders.agent').click();
  await expect(frame.locator('.view-lines')).not.toContainText('# unsaved studio draft');
  await showAllAgents(studio);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await expect(frame.locator('.view-lines')).toContainText('# unsaved studio draft');
  // Save as refuses a collision before publishing a complete new project file.
  await studio.getByRole('button', { name: 'More save options' }).click();
  await studio.getByRole('menuitem', { name: 'Save as…', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save agent to project' });
  await saveDialog.getByLabel('File path').fill('force-app/Support.agent');
  await saveDialog.getByRole('button', { name: 'Save new file' }).click();
  await expect(saveDialog.getByRole('alert')).toContainText('already exists');
  expect(readFileSync(join(home, 'dx/force-app/Support.agent'), 'utf8')).toBe(AGENT_SCRIPT_EXAMPLES[0].source);
  await saveDialog.getByLabel('File path').fill('DraftCopy.afscript');
  await saveDialog.getByRole('button', { name: 'Save new file' }).click();
  await expect(saveDialog).toHaveCount(0);
  await expect(studio.getByTestId('salesforce-agent-script-file:DraftCopy.afscript')).toBeVisible();
  await expect(studio.getByTestId('salesforce-agent-script-save')).toHaveText(/^Save(⌘S)?$/);
  await expect(studio.locator('.af-draft-state')).toHaveText('Saved');
  expect(readFileSync(join(home, 'dx/DraftCopy.afscript'), 'utf8')).toContain('# unsaved studio draft');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-saved-draft.png'));
  // A recovered draft retains the original checksum, so external edits cannot be overwritten.
  await frame.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('# recovered conflict draft\n');
  const externalSource = '# external change\n' + AGENT_SCRIPT_EXAMPLES[0].source;
  writeFileSync(join(home, 'dx/DraftCopy.afscript'), externalSource);
  await workbench.getByRole('tab', { name: 'Data', exact: true }).click();
  await workbench.getByRole('tab', { name: 'Agentforce', exact: true }).click();
  await expect(frame.locator('.view-lines')).toContainText('# recovered conflict draft');
  await studio.getByTestId('salesforce-agent-script-save').click();
  await expect(studio.getByRole('alert')).toContainText('changed on disk');
  expect(readFileSync(join(home, 'dx/DraftCopy.afscript'), 'utf8')).toBe(externalSource);
  await studioPanel(page).locator('.af-document-bar').getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = studio.getByTestId('preview-workbench');
  await expect(sidePanel(page).getByTestId('preview-workbench')).toBeVisible();
  // The host panel's divider resizes the tool beside the editor.
  const divider = sidePanel(page).getByRole('separator', { name: 'Resize right panel' });
  const beforeResize = (await preview.boundingBox())!.width;
  const handleBox = (await divider.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 180, handleBox.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await preview.boundingBox())!.width).toBeGreaterThan(beforeResize + 100);
  await preview.getByRole('group', { name: 'Preview engine' }).getByRole('button', { name: 'Simulate' }).click();
  await preview.getByTestId('pw-start').click();
  await expect(preview.getByRole('button', { name: 'End', exact: true })).toBeVisible({ timeout: 30_000 });
  const say = async (text: string) => {
    await preview.getByLabel('Preview message', { exact: true }).fill(text);
    await preview.getByRole('button', { name: 'Send preview message' }).click();
  };
  await say('Where is my order?');
  await expect(preview.getByText(/Could you share your order number/)).toBeVisible();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-rehearse-dark.png'));
  await say('Long response');
  await expect(preview.getByRole('log', { name: 'Preview conversation' })).toContainText('END_OF_RESPONSE');
  await say('Fail this turn');
  await expect(preview.getByRole('alert')).toContainText('503');
  const lab = studio.locator('[data-testid="agentforce-lab"]:visible');
  await openTool(studio, 'Tests');
  // Tests open on the case table; an imported sf agent test spec becomes rows.
  const tests = studio.getByTestId('studio-tests-pane');
  await expect(tests.getByRole('group', { name: 'Tests view' }).getByRole('button', { name: 'Cases' })).toHaveAttribute('aria-pressed', 'true');
  await tests.getByTestId('tests-import-input').setInputFiles({
    name: 'orders.yaml',
    mimeType: 'application/x-yaml',
    buffer: Buffer.from('testCases:\n  - utterance: "Where is my order?"\n    expectedTopic: "Orders"\n')
  });
  await expect(tests.getByRole('status')).toHaveText('Imported 1 case from orders.yaml.');
  await expect(tests.getByTestId('tests-table')).toContainText('Where is my order?');
  await tests.getByRole('group', { name: 'Tests view' }).getByRole('button', { name: 'Role-play' }).click();
  await lab.getByLabel('Conversation budget').selectOption('2');
  await lab.getByRole('button', { name: /Run AI role-play/ }).click();
  await expect(lab.getByText('Run complete')).toBeVisible({ timeout: 30_000 });
  await expect(lab.getByText('Criteria met')).toBeVisible();
  await lab.getByRole('region', { name: 'AI evaluation' }).scrollIntoViewIfNeeded();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-test-dark.png'));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect(frame.getByTestId('agent-script-ide')).toHaveClass(/light/);
  await expect.poll(keywordColor).toBe('rgb(5, 80, 174)');
  await lab.getByRole('region', { name: 'AI evaluation' }).scrollIntoViewIfNeeded();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-test-light.png'));
  await lab.getByRole('button', { name: /AI rehearsal/ }).click();
  await lab.getByRole('button', { name: /Run AI role-play/ }).click();
  await expect(lab.getByText('Run complete')).toBeVisible({ timeout: 30_000 });
  await expect(lab.getByText('AI approximation')).toBeVisible();
  await lab.getByRole('button', { name: /Salesforce Preview/ }).click();
  await lab.locator('.af-scenario-details > summary').click();
  await lab.getByLabel('Opening message').fill('Wait for cancellation');
  await lab.getByRole('button', { name: /Run AI role-play/ }).click();
  await expect(lab.getByText('Turn 1 of 2 · Agent replying…')).toBeVisible();
  await lab.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(lab.getByText('Stopped · partial conversation')).toBeVisible();
  await expect(lab.getByText('Criteria met')).toHaveCount(0);
  await page.setViewportSize({ width: 760, height: 900 });
  // A narrow window's side panel covers the page; its tools keep running while Studio is out of sight.
  await expect(sidePanel(page).locator('.sf-panel-tool[data-studio-tool="test"]')).toBeVisible();
  await expect(sidePanel(page).getByText('Tests needs Agent Script Studio')).toHaveCount(0);
  await sidePanel(page).getByTestId('thread-secondary-hide').click();
  await expect(sidePanel(page)).toBeHidden();
  // Narrow studios show one tool at a time instead of squeezing the editor beside the panel.
  await expect(studio.locator('.sf-as-body.sf-studio')).toHaveAttribute('data-layout', 'compact');
  // The compact strip launches tools in the host panel and the editor stays put.
  const strip = studioPanel(page).getByRole('tablist', { name: 'Studio tools' });
  await expect(strip).toBeVisible();
  await expect(frame.locator('.view-lines')).toBeVisible();
  expect(await studioPanel(page).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-narrow-light.png'));
  await strip.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(activeSidePanelTab(page)).toHaveText('Preview');
  await expect(preview).toBeVisible();
  await sidePanel(page).getByTestId('thread-secondary-hide').click();
  await expect(frame.locator('.view-lines')).toBeVisible();
  const requests = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')) as Array<{ path: string; body: Record<string, any> }>;
  expect(requests.find(r => r.path.endsWith('/authoring/scripts'))?.body.assets[0].content).toContain('# unsaved studio draft');
  expect(requests.filter(r => r.path.endsWith('/preview/sessions')).every(r => r.body.enableSimulationMode === true)).toBe(true);
  expect(await page.getByTestId('plugin-panel-host-layout').innerText()).not.toMatch(/PRIVATE_CLI_TOKEN|PRIVATE_NAMED_JWT/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTool(studio, 'Org preview');
  const orgPreview = page.getByTestId('salesforce-agentforce-preview');
  await expect(orgPreview.getByRole('heading', { name: 'Try your connected agent' })).toBeVisible();
  await expect(orgPreview.getByRole('log', { name: 'Org preview conversation' })).toBeVisible();
  await orgPreview.getByTestId('salesforce-agentforce-preview-start').click();
  await expect(orgPreview.getByText('Simulate preview started.')).toBeVisible();
  await orgPreview.getByTestId('salesforce-agentforce-preview-input').fill('Long response');
  await orgPreview.getByTestId('salesforce-agentforce-preview-send').click();
  await expect(orgPreview.getByRole('log')).toContainText('END_OF_RESPONSE');
  await orgPreview.getByTestId('salesforce-agentforce-preview-end').click();
  await expect(orgPreview.getByText('Preview ended.')).toBeVisible();
  await sidePanel(page).getByRole('button', { name: 'Close Org preview', exact: true }).click();
  await expect(frame.locator('.view-lines')).toBeVisible();
  await expect(studioPanel(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('Org preview: searchable agent picker, employee-agent simulation and an unclipped composer', async ({ app, home }, testInfo) => {
  const employeeSource = AGENT_SCRIPT_EXAMPLES[0].source.replace('config:\n', 'config:\n    agent_type: "AgentforceEmployeeAgent"\n');
  writeFileSync(join(home, 'dx', toolbarFile), employeeSource);
  const page = app.window;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id;
  }, join(home, 'dx'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  await expect(page.frameLocator('iframe[title="Agentforce playground"]').getByTestId('agent-script-ide')).toBeVisible();
  await openTool(studio, 'Org preview');
  const preview = page.getByTestId('salesforce-agentforce-preview');
  const picker = preview.getByRole('button', { name: 'Agentforce preview file', exact: true });
  await picker.click();
  const search = page.getByRole('textbox', { name: 'Search agents…', exact: true });
  await expect(search).toBeFocused();
  await search.fill('no-such-agent');
  await expect(page.getByRole('listbox', { name: 'Agentforce preview file' })).toContainText('No matching agents');
  await search.fill('aiAuthoringBundles/Customer');
  await expect(page.getByRole('listbox', { name: 'Agentforce preview file' }).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(picker).toContainText('Customer_Service_Agent_With_A_Long_Name');
  await expect(picker).toBeFocused();

  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1440, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(preview).toBeVisible();
      await expect(preview.getByTestId('salesforce-agentforce-preview-send')).toBeVisible();
      // The preview fills the host side panel without spilling past it.
      expect((await preview.boundingBox())!.width).toBeLessThanOrEqual((await sidePanel(page).boundingBox())!.width);
      for (const locator of [preview, preview.locator('.sf-as-header'), preview.locator('.af-composer')]) {
        expect(await locator.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      }
      const send = preview.getByTestId('salesforce-agentforce-preview-send');
      const fits = await send.evaluate(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const text = range.getBoundingClientRect(); const button = el.getBoundingClientRect();
        return text.left >= button.left && text.right <= button.right;
      });
      expect(fits).toBe(true);
      await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`org-preview-${theme}-${width}.png`));
    }
  }
  await preview.getByTestId('salesforce-agentforce-preview-start').click();
  await expect(preview.getByRole('log')).toContainText('Hello! I’m your support concierge.');
  await expect(picker).toBeDisabled();
  await preview.getByTestId('salesforce-agentforce-preview-input').fill('Long response');
  await preview.getByTestId('salesforce-agentforce-preview-send').click();
  await expect(preview.getByRole('log')).toContainText('END_OF_RESPONSE');
  await preview.getByTestId('salesforce-agentforce-preview-end').click();
  await expect(picker).toBeEnabled();
  await preview.getByTestId('salesforce-agentforce-preview-start').click();
  await expect(preview.getByRole('log')).not.toContainText('END_OF_RESPONSE');
  await preview.getByTestId('salesforce-agentforce-preview-end').click();
  const requests = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')) as Array<{ path: string; body: Record<string, any> }>;
  const starts = requests.filter(row => row.path.endsWith('/preview/sessions'));
  expect(starts).toHaveLength(2);
  expect(starts.every(row => row.body.enableSimulationMode === true && row.body.bypassUser === false)).toBe(true);
  expect(existsSync(join(home, 'agent-cli.jsonl'))).toBe(false);
  expect(errors).toEqual([]);
});

test('Agentforce action explorer: real source RPC, Apex colors, Flow map and preserved draft/conversation', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id;
  }, join(home, 'dx'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  const agent = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(agent.getByTestId('agent-script-ide')).toBeVisible();
  // Wide enough that Studio keeps its full layout beside the host side panel.
  await page.setViewportSize({ width: 1800, height: 1000 });
  await studio.getByTestId('salesforce-agent-script-file:force-app/Orders.agent').click();
  await openTool(studio, 'Actions');
  await expect(studio.getByRole('button', { name: 'Inspect lookup in start_agent.orders' })).toBeVisible();
  await agent.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('# preserve my action draft\n');
  await openTool(studio, 'Preview');
  const preview = studio.getByTestId('preview-workbench');
  await preview.getByTestId('pw-start').click();
  await expect(preview.getByRole('button', { name: 'End', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByLabel('Preview message', { exact: true })).toBeEnabled();
  await openTool(studio, 'Actions');
  await studio.getByRole('button', { name: 'Inspect lookup in start_agent.orders' }).click();
  const detail = studio.getByTestId('agent-action-panel');
  const source = page.frameLocator('iframe[title="Action implementation source"]');
  await expect(source.getByTestId('action-source-editor')).toBeVisible();
  await expect(source.locator('.view-lines')).toContainText('InvocableMethod');
  // Separate read-only model with real Apex token colors in the built iframe.
  const keywordColor = () => source.locator('.view-lines').evaluate(el => {
    const token = [...el.querySelectorAll('span')].find(node => node.textContent === 'public');
    return token ? getComputedStyle(token).color : 'missing';
  });
  await expect.poll(keywordColor).toBe('rgb(197, 134, 192)');
  await source.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.insertText('MUST_NOT_EDIT');
  await expect(source.locator('.view-lines')).not.toContainText('MUST_NOT_EDIT');
  await expect(agent.locator('.view-lines')).toBeVisible();
  await openTool(studio, 'Preview');
  await expect(preview.getByRole('button', { name: 'End', exact: true })).toBeVisible();
  await openTool(studio, 'Actions');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('actions-apex-dark.png'));
  await detail.getByRole('button', { name: 'Org · studio' }).click();
  await expect(detail.getByText('Deployed', { exact: true })).toBeVisible();
  await source.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await expect(source.locator('.view-lines')).toContainText('ORG_SOURCE_COMPLETE');
  await detail.getByRole('button', { name: 'Contract', exact: true }).click();
  await expect(detail.getByText(/Name matched/)).toHaveCount(2);
  await detail.getByRole('button', { name: 'Used by' }).click();
  await expect(detail.getByText(/set @variables.status/)).toBeVisible();
  await detail.getByRole('button', { name: /Go to action definition/ }).click();
  // Monaco virtualizes lines: revealing the declaration may scroll the draft
  // header out of the DOM, depending on the host's available editor height.
  await agent.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await expect(agent.locator('.view-lines')).toContainText('# preserve my action draft');
  await expect(studio.getByText(/Unsaved draft/)).toBeVisible();
  const targetLine = ACTION_AGENT.split('\n').findIndex(line => line.includes('apex://OrderLookup')) + 1;
  for (let line = 0; line < targetLine; line++) await page.keyboard.press('ArrowDown');
  await agent.locator('.view-line').filter({ hasText: 'apex://OrderLookup' }).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expect(detail.getByRole('heading', { name: 'OrderLookup' })).toBeVisible();
  await studio.locator('.af-related-tabs').getByRole('button', { name: 'All actions' }).click();
  await studio.getByRole('button', { name: 'Inspect refund in start_agent.orders' }).click();
  const flow = page.frameLocator('iframe[title="Salesforce Flow visualizer"]');
  await expect(flow.locator('svg text').filter({ hasText: /^Within 30 days$/ })).toBeVisible();
  await expect(flow.getByText('Fault', { exact: true }).first()).toBeVisible();
  await expect(flow.getByRole('button', { name: /Collapse All/ })).toBeVisible();
  await expect(flow.getByRole('button', { name: 'Select components to edit with AI' })).toHaveCount(0);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('actions-flow-dark.png'));
  await detail.getByRole('button', { name: 'Org · studio' }).click();
  await expect(detail.getByText('Active · v7', { exact: true })).toBeVisible();
  await expect(flow.locator('svg text').filter({ hasText: /^Within 30 days$/ })).toBeVisible();
  await detail.locator('.af-flow-dependencies summary').click();
  await detail.getByRole('button', { name: 'Open apex://OrderLookup ↗' }).click();
  await expect(detail.getByText('Deployed', { exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect.poll(keywordColor).toBe('rgb(166, 38, 164)');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('actions-apex-light.png'));
  await expect(studio.getByTestId('salesforce-agent-script-explorer')).toBeVisible();
  await openTool(studio, 'Graph view');
  await page.frameLocator('iframe[title="AgentScript graph"]').getByRole('button', { name: 'Inspect refund', exact: true }).click();
  await expect(agent.locator('.view-lines')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'CheckReturn' })).toBeVisible();
  // The last Project / Org choice carries over to the next implementation opened.
  await expect(detail.getByRole('button', { name: 'Org · studio' })).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.getByText('Active · v7', { exact: true })).toBeVisible();
  const retrievals = readFileSync(join(home, 'source-retrievals.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(retrievals.every(row => row.args.includes('--manifest') && !row.cwd.startsWith(join(home, 'dx')))).toBe(true);
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 850));
  expect(await studioPanel(page).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('actions-flow-narrow-light.png'));
  await expect(detail.getByRole('button', { name: 'Last preview' })).toHaveCount(0);
  expect(await page.getByTestId('plugin-panel-host-layout').innerText()).not.toContain('PRIVATE_TOKEN');
  // Editor tabs: right-click offers bulk close; Close others keeps only the clicked tab.
  await showAllAgents(studio);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  const openFiles = studio.getByRole('tablist', { name: 'Open files' });
  await expect(openFiles.getByRole('tab', { name: /Support\.agent/ })).toBeVisible();
  await openFiles.getByRole('tab', { name: /Orders\.agent/ }).click({ button: 'right' });
  const tabMenu = studio.getByRole('menu', { name: /Orders\.agent tab actions/ });
  await expect(tabMenu.getByRole('menuitem')).toHaveText(['Close', 'Close others', 'Close to the right', 'Close all']);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('editor-tab-menu.png'));
  await page.keyboard.press('Escape');
  await expect(tabMenu).toHaveCount(0);
  await openFiles.getByRole('tab', { name: /Orders\.agent/ }).click({ button: 'right' });
  await tabMenu.getByRole('menuitem', { name: 'Close others' }).click();
  await expect(openFiles.getByRole('tab', { name: /Support\.agent/ })).toHaveCount(0);
  await expect(openFiles.getByRole('tab', { name: /Orders\.agent/ })).toHaveAttribute('aria-selected', 'true');
  expect(readFileSync(join(home, 'dx', 'force-app', 'Orders.agent'), 'utf8')).toBe(ACTION_AGENT);
  expect(readFileSync(join(home, 'dx', 'force-app', 'main', 'default', 'classes', 'OrderLookup.cls'), 'utf8')).toBe(ACTION_APEX);
  expect(errors).toEqual([]);
});

test('Salesforce Flow visualizer: official canvas, branches, details, themes and fallback', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const flowPath = join(home, 'dx/force-app/main/default/flows/CheckReturn.flow-meta.xml');
  const xml = flowSnapshotXml({ origin: 'project', target: 'flow://CheckReturn', status: 'ready', label: 'Check return', flow: VISUALIZER_FLOW });
  writeFileSync(flowPath, xml);
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status)).toBe('running');
  const projectId = await page.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id;
  }, join(home, 'dx'));
  await page.evaluate(id => { history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  await expect(page.frameLocator('iframe[title="Agentforce playground"]').getByTestId('agent-script-ide')).toBeVisible();
  await studio.getByTestId('salesforce-agent-script-file:force-app/Orders.agent').click();
  await openTool(studio, 'Actions');
  await studio.getByRole('button', { name: 'Inspect refund in start_agent.orders' }).click();
  const detail = studio.getByTestId('agent-action-panel');
  const frame = detail.locator('iframe[title="Salesforce Flow visualizer"]');
  const flow = page.frameLocator('iframe[title="Salesforce Flow visualizer"]');
  await expect(flow.getByText('Each order item', { exact: true })).toBeVisible();
  await expect(flow.getByText('Tomorrow', { exact: true })).toBeVisible();
  await expect(flow.getByText(/After commit|Run Asynchronously/).first()).toBeVisible();
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(flow.getByRole('button', { name: 'Select components to edit with AI' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Expand Flow', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Expanded Flow' })).toBeVisible();
  await expect(flow.getByText('Each order item', { exact: true })).toBeVisible();
  // Expanding moves the canvas into the dialog; on a slow runner its first click can land before it is wired.
  await expect(async () => {
    await flow.getByText('Return eligible?', { exact: true }).click();
    await expect(flow.getByText('Element Details', { exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('flow-official-details-dark.png'));
  await flow.getByRole('button', { name: 'Close', exact: true }).click();
  await flow.getByRole('button', { name: 'Collapse All', exact: true }).click();
  await expect(flow.getByRole('button', { name: 'Expand All', exact: true })).toBeVisible();
  await flow.getByRole('button', { name: 'Expand All', exact: true }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect(frame).toHaveAttribute('src', /light\.html$/);
  await expect(flow.getByText('Each order item', { exact: true })).toBeVisible();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('flow-official-light.png'));
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 850));
  expect(await studioPanel(page).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(flow.getByRole('button', { name: 'Collapse All', exact: true })).toBeVisible();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('flow-official-narrow-light.png'));
  // Focus a control inside the sandbox: Escape must cross the frame boundary.
  await flow.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Expanded Flow' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Expand Flow', exact: true })).toBeFocused();
  // A failed local asset must leave a usable map and the complete source.
  await page.route('**/assets/flow-visualizer/*.html', route => route.abort());
  await detail.getByRole('button', { name: 'Refresh implementation' }).click();
  await expect(detail.getByLabel('Flow implementation map')).toBeVisible({ timeout: 15_000 });
  await expect(detail.getByText(/Showing the basic map/)).toBeVisible();
  await detail.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.frameLocator('iframe[title="Action implementation source"]').getByTestId('action-source-editor')).toBeVisible();
  expect(readFileSync(flowPath, 'utf8')).toBe(xml);
  expect(errors).toEqual([]);
});

test('Agentforce Studio: Lightning Types, collapsible explorer sections and a hideable explorer', async ({ app, home }, testInfo) => {
  const page = app.window;
  const typeDir = join(home, 'dx', 'force-app/main/default/lightningTypes/OrderRequest');
  mkdirSync(join(typeDir, 'lightningDesktopGenAi'), { recursive: true });
  writeFileSync(join(typeDir, 'schema.json'), JSON.stringify({ title: 'Order request', description: 'What the agent sends to look up an order.', required: ['orderId'], properties: { orderId: { title: 'Order', 'lightning:type': 'lightning__textType', description: 'Order number' } } }));
  writeFileSync(join(typeDir, 'lightningDesktopGenAi', 'renderer.json'), JSON.stringify({ renderer: { componentOverrides: { $: { definition: 'c/orderCard' } } } }));
  writeFileSync(join(home, 'dx', 'force-app', 'Typed.agent'), ACTION_AGENT + '\n# inputs:\n#   order: object\n#     complex_data_type_name: "c__OrderRequest"\n#   text: object\n#     complex_data_type_name: "lightning__textType"\n');
  const installed = await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }));
  expect(installed).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id;
  }, join(home, 'dx'));
  await page.evaluate(id => { history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  const explorer = studio.getByTestId('salesforce-agent-script-explorer');
  const types = explorer.getByTestId('sf-explorer-lightning-type');
  // No agent is open, so the outline lists agents; the Lightning Types section lives in the all-references catalogue.
  const allReferences = explorer.getByRole('button', { name: /^All references/ });
  await allReferences.click();
  await expect(types.getByRole('button', { name: /Lightning Types/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(types.getByRole('button', { name: /lightning__textType/ })).toContainText('std');
  await types.getByRole('button', { name: /^c__OrderRequest/ }).click();
  const view = studio.getByTestId('lightning-type-view');
  await expect(view.getByRole('heading', { name: 'Order request' })).toBeVisible();
  await expect(studio.getByRole('tab', { name: /TYPE.*c__OrderRequest/ })).toHaveAttribute('aria-selected', 'true');
  await expect(view.getByRole('cell', { name: 'lightning__textType' })).toBeVisible();
  await expect(view.getByRole('button', { name: 'Typed.agent' })).toBeVisible();
  await view.getByRole('button', { name: 'lightningDesktopGenAi/renderer.json' }).click();
  await expect(view.getByLabel(/Source of .*renderer\.json/)).toContainText('c/orderCard');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('lightning-type.png'));
  // Folding survives a remount; a filter shows folded matches.
  await types.getByRole('button', { name: /Lightning Types/ }).click();
  await expect(types.getByRole('button', { name: /^c__OrderRequest/ })).toHaveCount(0);
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Data', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  await allReferences.click();
  await expect(types.getByRole('button', { name: /Lightning Types/ })).toHaveAttribute('aria-expanded', 'false');
  await explorer.getByLabel('Filter Agentforce files').fill('OrderRequest');
  await expect(types.getByRole('button', { name: /^c__OrderRequest/ })).toBeVisible();
  await explorer.getByLabel('Filter Agentforce files').fill('');
  // Hide the column from its header, bring it back with the shortcut.
  await explorer.getByRole('button', { name: 'Hide explorer' }).click();
  await expect(explorer).toHaveCount(0);
  await view.getByRole('heading', { name: 'Order request' }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B');
  await expect(explorer).toBeVisible();
});

test('Agentforce Studio: browse org source versions, retrieve and preserve local edits', async ({ app, home }, testInfo) => {
  const page = app.window;
  // A project agent named like an org agent is listed under the project, not retrieved again; browse the org's Support versions.
  rmSync(join(home, 'dx', 'force-app', 'Support.agent'));
  const installed = await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }));
  expect(installed).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id;
  }, join(home, 'dx'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  const editor = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(studio.getByTestId('salesforce-agent-script-no-file')).toBeVisible();
  await studio.getByRole('button', { name: 'Browse org agents', exact: true }).click();
  const agents = studio.getByRole('region', { name: 'Org agents' });
  // Inventory exceeds the observed 8192-byte Electron capture boundary.
  await expect(agents.getByText('Z Last', { exact: true })).toBeVisible({ timeout: 30_000 });
  await agents.getByRole('textbox', { name: 'Search org agents' }).fill('Support');
  await agents.getByRole('combobox', { name: 'Source version for Support' }).selectOption('Support_v1');
  await retrieveOrgAgent(agents, 'Support');
  await expect(agents.getByRole('status')).toContainText('Retrieved to your project', { timeout: 30_000 });
  const imported = join(home, 'dx', 'agentforce', '00D000000000001', 'Support_v1', 'Support_v1.agent');
  expect(readFileSync(imported, 'utf8')).toContain('ORG_AGENT_SOURCE_COMPLETE');
  expect(readFileSync(imported.replace('.agent', '.bundle-meta.xml'), 'utf8')).toContain('Support.v1');
  await editor.locator('.monaco-editor').click({ position: { x: 160, y: 45 } });
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n# MY_LOCAL_AGENT_EDIT');
  await studio.getByRole('button', { name: 'Save Agentforce file' }).click();
  await expect.poll(() => readFileSync(imported, 'utf8')).toContain('MY_LOCAL_AGENT_EDIT');
  await retrieveOrgAgent(agents, 'Support');
  await expect(agents.getByRole('status')).toContainText('Existing edits were preserved');
  expect(readFileSync(imported, 'utf8')).toContain('MY_LOCAL_AGENT_EDIT');
  const retrievals = readFileSync(join(home, 'agent-retrievals.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(retrievals).toHaveLength(1);
  expect(retrievals[0].args).toContain('AiAuthoringBundle:Support_v1');
  expect(retrievals[0].home).toBe(home);
  expect(existsSync(retrievals[0].cwd)).toBe(false);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('org-agent-source-browser.png'));
  await agents.getByRole('textbox', { name: 'Search org agents' }).fill('Unavailable');
  await retrieveOrgAgent(agents, 'Unavailable');
  await expect(agents.getByRole('alert')).toHaveText('Source access denied');
  expect(await page.getByTestId('plugin-panel-host-layout').innerText()).not.toContain('PRIVATE_CLI_TOKEN');
  // Invalid project ids never grant a local write root.
  const refused = await page.evaluate(async () => window.cc.pluginApps.callRpc('salesforce', 'agents.retrieve.start', { projectId: 'missing', orgId: '00D000000000001', fullName: 'Support_v2', projectRoot: '/tmp' }));
  expect(refused).toMatchObject({ ok: false, code: 'invalid_context' });
});

test('Agentforce Studio: no-file entry points reach org agents, an explorer org agent opens, and the empty graph reads as one hint', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => { const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id; }, join(home, 'dx'));
  await page.evaluate(async id => { await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' }); history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, projectId);
  // Wide enough that Studio keeps its explorer beside the host side panel.
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  await expect(studio.locator('.sf-as-body.sf-studio')).toHaveAttribute('data-layout', 'wide');
  const noFile = studio.getByTestId('salesforce-agent-script-no-file');
  await expect(noFile).toBeVisible({ timeout: 30_000 });
  const agentsTab = sidePanelTab(page, 'Agents');
  const search = studio.getByRole('region', { name: 'Org agents' }).getByRole('textbox', { name: 'Search org agents' });

  // The empty state's actions sit with its message instead of floating far below it.
  const message = await noFile.locator('.sf-state-hint').boundingBox();
  const openOrgAgents = noFile.getByRole('button', { name: 'Open org agents', exact: true });
  expect((await openOrgAgents.boundingBox())!.y - (message!.y + message!.height)).toBeLessThan(48);
  await openOrgAgents.click();
  await expect(activeSidePanelTab(page)).toHaveText('Agents');
  await expect(search).toBeFocused();

  // An empty graph is a single readable hint, not one row per text run and code chip.
  await openTool(studio, 'Graph view');
  const hint = page.frameLocator('iframe[title="AgentScript graph"]').locator('.graph-empty');
  await expect(hint).toContainText('No topics defined. Add a start_agent or topic in the Script view.');
  expect(await hint.evaluate(el => [...el.childNodes].map(node => node.nodeName))).toEqual(['P']);
  expect((await hint.locator('p').boundingBox())!.height).toBeLessThan(80);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('empty-graph-hint.png'));

  // The explorer link switches back to Agents, and re-asking while Agents is already open still lands focus in its search.
  const explorer = studio.getByTestId('salesforce-agent-script-explorer');
  // No local file matches, so the project section offers the org instead, next to the matching org agent row.
  await explorer.getByRole('textbox', { name: 'Filter Agentforce files' }).fill('Agent_0');
  const browse = explorer.getByRole('button', { name: 'Browse agents in your org', exact: true });
  await browse.click();
  await expect(activeSidePanelTab(page)).toHaveText('Agents');
  await expect(search).toBeFocused();
  await search.blur();
  await expect(search).not.toBeFocused();
  await browse.click();
  await expect(search).toBeFocused();

  // An org agent row retrieves and opens that agent rather than only showing the list.
  await openTool(studio, 'Graph view');
  // The explorer only links to the org; the Agents panel lists org agents and retrieves them per row.
  await expect(explorer.getByTestId('sf-explorer-org-agent')).toHaveCount(0);
  await openTool(studio, 'Agents');
  await expect(activeSidePanelTab(page)).toHaveText('Agents');
  await search.fill('Agent_0');
  await retrieveOrgAgent(studio.getByRole('region', { name: 'Org agents' }), 'Agent_0');
  await expect(studio.getByRole('region', { name: 'Org agents' }).getByRole('status')).toContainText('Retrieved to your project', { timeout: 30_000 });
  await expect(studio.locator('.af-document-name')).toHaveText('Agent_0_v1.agent');
  await expect(noFile).toBeHidden();
  const retrievals = readFileSync(join(home, 'agent-retrievals.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(retrievals.map(row => row.args.join(' '))).toEqual([expect.stringContaining('AiAuthoringBundle:Agent_0_v1')]);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('explorer-org-agent-opened.png'));

  // Reopening a closed Agents tab starts clean instead of replaying the last request.
  await sidePanel(page).getByRole('button', { name: 'Close Agents', exact: true }).click();
  await expect(agentsTab).toHaveCount(0);
  await openTool(studio, 'Agents');
  await expect(studio.getByRole('region', { name: 'Org agents' }).getByText('Z Last', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(search).toHaveValue('');
  await expect(studio.getByRole('region', { name: 'Org agents' }).getByRole('status')).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('Agentforce Studio: create local agents and control the visible workbench through the CLI', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  // A normal registered folder proves creation does not depend on existing DX setup.
  const projectRoot = join(home, 'new-agents'); mkdirSync(projectRoot);
  const projectId = await page.evaluate(async path => { const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id; }, projectRoot);
  await page.evaluate(async id => { await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' }); history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, projectId);
  await page.getByRole('navigation', { name: 'new-agents navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  const workbench = page.getByTestId('salesforce-workbench');
  await workbench.getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  const editor = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(studio.getByTestId('salesforce-agent-script-no-file')).toBeVisible();
  await studio.getByRole('button', { name: 'Browse org agents', exact: true }).click();
  await studio.getByRole('button', { name: 'New agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent' });
  await dialog.getByLabel('Name', { exact: true }).fill('Customer support');
  await dialog.getByLabel('Purpose', { exact: false }).fill('Help customers with clear, concise answers.');
  await expect(dialog.getByLabel('API name')).toHaveValue('Customer_support');
  await expect(dialog).toContainText('agentforce-drafts/force-app/main/default/aiAuthoringBundles');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('new-agent-dialog.png'));
  await dialog.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(editor.locator('.view-lines')).toContainText('Customer_support');
  const draftPath = 'agentforce-drafts/force-app/main/default/aiAuthoringBundles/Customer_support/Customer_support.agent';
  expect(existsSync(join(projectRoot, 'sfdx-project.json'))).toBe(false);
  expect(readFileSync(join(projectRoot, draftPath.replace('.agent', '.bundle-meta.xml')), 'utf8')).toContain('<bundleType>AGENT</bundleType>');
  async function cli(argv: string[], json = true) {
    return page.evaluate(async ({ argv, projectId, json }) => {
      const response = await fetch('/api/v1/plugins/salesforce/cli', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ argv, projectId }) });
      if (!response.ok) throw Error(await response.text());
      const result = await response.json();
      if (!result.stdout) throw Error(result.stderr || 'Missing CLI result');
      return json ? JSON.parse(result.stdout) : result;
    }, { argv, projectId, json });
  }
  const action = (name: string, input = {}) => cli(['action', name, '--input', JSON.stringify(input), '--json']);
  const created = await action('draft.create', { name: 'Billing assistant', apiName: 'Billing', purpose: 'Help with billing questions.' });
  expect(created).toMatchObject({ ok: true, file: { apiName: 'Billing' } });
  expect(await action('draft.create', { name: 'Billing assistant', apiName: 'Billing' })).toMatchObject({ ok: false });
  expect(await cli(['tool', 'sf_agent', '--input', JSON.stringify({ action: 'diagnose', path: created.file.path })])).toMatchObject({ ok: true });
  expect(await cli(['lint', created.file.path], false)).toMatchObject({ exitCode: 0, stdout: expect.stringContaining(': ok') });
  const agent = (input: object) => cli(['tool', 'sf_agent', '--input', JSON.stringify(input)]);
  expect(await agent({ action: 'compile', path: created.file.path })).toMatchObject({ ok: true });
  expect(await agent({ action: 'preview.start', path: created.file.path })).toMatchObject({ ok: true, data: { sessionId: 'cli-preview' } });
  expect(await agent({ action: 'preview.end', sessionId: 'cli-preview' })).toMatchObject({ ok: true });
  const specPath = 'agentforce-drafts/evals.json';
  writeFileSync(join(projectRoot, specPath), JSON.stringify({ tests: [{ utterance: 'Hello' }] }));
  expect(await agent({ action: 'eval.run', specPath })).toMatchObject({ ok: true, data: { passed: true } });
  expect(await agent({ action: 'lifecycle.publish', path: created.file.path })).toMatchObject({ ok: false, code: 'refused' });
  const cliCalls = readFileSync(join(home, 'agent-cli.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(cliCalls.some(call => call.args[1] === 'publish')).toBe(false);
  for (const verb of ['validate', 'preview', 'test']) {
    expect(cliCalls.find(call => call.args[1] === verb)).toMatchObject({ cwd: realpathSync(join(projectRoot, 'agentforce-drafts')), home });
  }
  async function view(surface: string) {
    let id = '';
    await expect.poll(async () => { const result = await action('ui.views'); id = result.views.find((v: any) => v.surface === surface)?.id ?? ''; return id; }).not.toBe('');
    return id;
  }
  async function command(viewId: string, command: string, input = {}) {
    const job = await action('ui.command', { viewId, command, input }); expect(job.ok).toBe(true);
    let result: any;
    await expect.poll(async () => { result = await action('ui.result', { commandId: job.commandId }); return result.state; }, { timeout: 15_000 }).not.toBe('pending');
    return result;
  }
  const agentView = await view('agentforce');
  expect(await command(agentView, 'file.open', { path: created.file.path })).toMatchObject({ ok: true, viewState: { path: created.file.path } });
  await expect(editor.locator('.view-lines')).toContainText('Billing');
  expect(await command(agentView, 'panel.open', { tool: 'graph' })).toMatchObject({ ok: true, viewState: { panels: { active: 'graph' } } });
  await expect(activeSidePanelTab(page)).toHaveText('Graph view');
  await editor.locator('.monaco-editor').click({ position: { x: 180, y: 50 } });
  await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type('\n# HUMAN_EDIT');
  await expect(studio.getByRole('button', { name: 'Save Agentforce file' })).toContainText('Save');
  expect(await command(agentView, 'file.open', { path: draftPath })).toMatchObject({ ok: false, error: expect.stringContaining('Save the current draft') });
  await studio.getByRole('button', { name: 'Save Agentforce file' }).click();
  await expect.poll(() => readFileSync(join(projectRoot, created.file.path), 'utf8')).toContain('HUMAN_EDIT');
  expect(await command(agentView, 'file.open', { path: draftPath })).toMatchObject({ ok: true });
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('new-agent-controlled-graph.png'));
  // The Data view checks its full-width results table, so put the side panel away.
  // Studio opens host tabs but leaves closing them to the panel.
  expect(await command(agentView, 'panel.hide')).toMatchObject({ ok: false, error: expect.stringContaining('ZCC side panel') });
  await sidePanel(page).getByTestId('thread-secondary-hide').click();
  await expect(sidePanel(page)).toBeHidden();
  const query = await action('query.execute', { query: 'SELECT Id, Name FROM Account LIMIT 1' });
  expect(query).toMatchObject({ ok: true, resultId: expect.any(String) });
  expect(await command(await view('workbench'), 'view.open', { view: 'data' })).toMatchObject({ ok: true, viewState: { view: 'data' } });
  expect(await command(await view('data'), 'query.show', { resultId: query.resultId })).toMatchObject({ ok: true, viewState: { rows: 1 } });
  await expect(page.getByRole('cell', { name: 'Workbench result account', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Agentforce Release: a Zana-drawn sheet approves Publish and Activate; cancel, forged and replayed tokens change nothing', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id;
  }, join(home, 'dx'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  await expect(page.frameLocator('iframe[title="Agentforce playground"]').getByTestId('agent-script-ide')).toBeVisible();
  const explorer = studio.getByTestId('salesforce-agent-script-explorer');
  // The explorer lists project agents by name rather than as a folder tree.
  await studio.getByTestId(`salesforce-agent-script-file:${toolbarFile}`).click();
  await expect(studio.locator('.af-draft-state')).toHaveText('Saved');
  const apiName = 'Customer_Service_Agent_With_A_Long_Name';
  const dx = realpathSync(join(home, 'dx'));
  const cliLog = join(home, 'agent-cli.jsonl');
  const cliCalls = (verb: string) => existsSync(cliLog)
    ? readFileSync(cliLog, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(call => call.args[1] === verb)
    : [];
  // Main draws the sheet; the test reaches it only from main, like a person's click.
  const sheet = <T,>(script: string) => app.electron.evaluate(async ({ BrowserWindow }, script) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === 'Zana approval');
    return win ? await win.webContents.executeJavaScript(script) as T : null;
  }, script);
  const sheetWindow = () => app.electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === 'Zana approval');
    return win ? { modal: win.isModal(), parent: win.getParentWindow()?.getTitle() ?? null } : null;
  });
  const sheetText = async () => (await sheet<string>('document.body.innerText')) ?? '';
  // Target the current main-owned sheet, and retry if focus re-arms Approve.
  const press = (id: 'approve' | 'cancel') => expect.poll(() => sheet<boolean>(`(() => {
    const button = document.getElementById('${id}');
    if (!button.disabled) setTimeout(() => button.click(), 0);
    return true;
  })()`)).toBeNull();

  // Publish opens the Release tool on the file's org and versions.
  await studio.getByRole('button', { name: 'More save options' }).click();
  await studio.getByTestId('salesforce-agent-script-publish').click();
  const release = studio.getByTestId('studio-release-pane');
  await expect(release.getByTestId('release-org')).toHaveText('studio (sandbox)');
  const v7 = release.getByRole('list', { name: 'Versions' }).getByRole('listitem').filter({ hasText: 'v7' });
  await expect(v7).toContainText('Inactive');
  await expect(v7).toContainText('No eval');
  await expect(release).toContainText('Uploads a new inactive version.');
  await expect(release.getByRole('heading', { name: 'Publish agent', exact: true })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1440, 1180, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(release).toBeVisible();
      await expect(release.getByRole('button', { name: 'Publish…', exact: true })).toBeEnabled();
      expect(await release.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const draft = release.locator('.sf-rl-draft');
      expect(await draft.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const publish = release.getByRole('button', { name: 'Publish…', exact: true });
      expect(await publish.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`release-${theme}-${width}.png`));
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // A failed version read leaves the exact draft and publish approval available.
  writeFileSync(join(home, 'sf-versions-unavailable'), '1');
  await release.getByRole('button', { name: 'Refresh release' }).click();
  await expect(release.getByTestId('release-versions-error')).toContainText('Try again shortly.');
  await expect(release.getByRole('button', { name: 'Publish…', exact: true })).toBeEnabled();
  await expect(release.getByText('No published versions yet.', { exact: true })).toHaveCount(0);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('release-versions-unavailable.png'));

  // A token the host did not sign never reaches the CLI.
  const runArgs = { projectId, path: toolbarFile, action: 'agent.publish' };
  expect(await page.evaluate(args => window.cc.pluginApps.callRpc('salesforce', 'release.run', { ...args, token: 'forged.token' }), runArgs))
    .toMatchObject({ ok: false, code: 'approval_invalid' });
  expect(cliCalls('publish')).toHaveLength(0);

  // Approve: the sheet shows the exact source revision, then one publish runs in the DX project.
  const revision = createHash('sha256').update(readFileSync(join(home, 'dx', toolbarFile), 'utf8')).digest('hex');
  await release.getByRole('button', { name: 'Publish…', exact: true }).click();
  await expect.poll(sheetText).toContain(`Publish ${apiName}`);
  const text = await sheetText();
  expect(text).toContain('studio (sandbox)');
  expect(text).toContain(revision.slice(0, 12));
  // The eyebrow is styled uppercase, and innerText follows the CSS.
  expect(text).toMatch(/asks for approval/i);
  expect(await sheet('typeof window.cc + typeof require + typeof process')).toBe('undefinedundefinedundefined');
  expect(await sheetWindow()).toMatchObject({ modal: true, parent: expect.any(String) });
  await expect(release.getByRole('button', { name: 'Publishing…', exact: true })).toBeDisabled();
  // Capture the modal itself; macOS can suspend captures of its blocked parent.
  const sheetPng = await app.electron.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === 'Zana approval');
    return win ? (await win.webContents.capturePage()).toPNG().toString('base64') : '';
  });
  expect(sheetPng).not.toBe('');
  writeFileSync(testInfo.outputPath('release-approval-sheet.png'), Buffer.from(sheetPng, 'base64'));
  await press('approve');
  await expect(release).toContainText(`Published inactive version of ${apiName}`);
  await expect(release).toContainText('No changes since.');
  await expect.poll(sheetWindow).toBeNull();
  expect(cliCalls('publish')).toEqual([expect.objectContaining({ cwd: dx, args: expect.arrayContaining(['--api-name', apiName, '--target-org', 'studio']) })]);
  await expect(release.getByTestId('release-versions-error')).toBeVisible();
  rmSync(join(home, 'sf-versions-unavailable'));
  await release.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(v7).toBeVisible();
  await expect(release.getByTestId('release-versions-error')).toHaveCount(0);

  // Cancel changes nothing; a second request while a sheet is open is refused as busy.
  await release.getByRole('button', { name: 'Publish…', exact: true }).click();
  await expect.poll(sheetText).toContain(`Publish ${apiName}`);
  const binding = { action: 'agent.publish', target: '00D000000000001', targetLabel: 'studio (sandbox)', subject: apiName, revision };
  expect(await page.evaluate(binding => window.cc.pluginApprovals.request({ pluginId: 'salesforce', binding, title: 'Second sheet' }), binding))
    .toEqual({ approved: false, reason: 'busy' });
  await press('cancel');
  await expect(release).toContainText('Cancelled. Nothing changed.');
  await expect.poll(sheetWindow).toBeNull();
  expect(cliCalls('publish')).toHaveLength(1);

  // A plugin that is not installed gets no sheet at all.
  expect(await page.evaluate(binding => window.cc.pluginApprovals.request({ pluginId: 'not-installed', binding, title: 'Publish' }), binding))
    .toEqual({ approved: false, reason: 'invalid' });
  await expect.poll(sheetWindow).toBeNull();

  // A signed token is single use, and only fits the binding it was signed for.
  const prepared = await page.evaluate(args => window.cc.pluginApps.callRpc('salesforce', 'release.prepare', args), runArgs) as { ok: boolean; data: { request: unknown } };
  expect(prepared).toMatchObject({ ok: true, data: { request: { binding } } });
  const pending = page.evaluate(request => window.cc.pluginApprovals.request({ ...(request as object), pluginId: 'salesforce' } as never), prepared.data.request);
  await expect.poll(sheetText).toContain(`Publish ${apiName}`);
  await press('approve');
  const signed = await pending as { approved: true; token: string };
  expect(signed).toMatchObject({ approved: true, token: expect.any(String) });
  const run = (extra: Record<string, unknown>) => page.evaluate(args => window.cc.pluginApps.callRpc('salesforce', 'release.run', args), { ...runArgs, token: signed.token, ...extra });
  expect(await run({ action: 'agent.activate', versionNumber: 7 })).toMatchObject({ ok: false, code: 'approval_invalid' });
  expect(cliCalls('activate')).toHaveLength(0);
  expect(await run({})).toMatchObject({ ok: true, summary: `Published inactive version of ${apiName}` });
  expect(cliCalls('publish')).toHaveLength(2);
  expect(await run({})).toMatchObject({ ok: false, code: 'approval_invalid' });
  expect(cliCalls('publish')).toHaveLength(2);

  // View: v7 opens read-only from a temp retrieve and diffs against the draft; the project is not written.
  const draft = readFileSync(join(home, 'dx', toolbarFile), 'utf8');
  writeFileSync(join(home, 'sf-version-bundles'), JSON.stringify({
    [`${apiName}_v8`]: { target: `${apiName}.v8`, content: 'not this one' },
    [`${apiName}_v7`]: { target: `${apiName}.v7`, content: `${draft}# ONLY_IN_V7\n` },
  }));
  await v7.getByRole('button', { name: 'View v7', exact: true }).click();
  const viewer = release.getByTestId('release-version-viewer');
  await expect(viewer).toContainText(`${apiName}_v7 · Read-only`);
  await expect(viewer.getByTestId('release-version-source')).toContainText('# ONLY_IN_V7');
  await viewer.getByRole('button', { name: 'Diff with draft', exact: true }).click();
  await expect(viewer.getByTestId('release-version-diff-stats')).toHaveText(/^0 added and [12] removed in your draft, against v7\.$/);
  await expect(viewer.getByTestId('release-version-diff')).toContainText('−# ONLY_IN_V7');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('release-version-diff.png'));
  expect(readFileSync(join(home, 'dx', toolbarFile), 'utf8')).toBe(draft);
  expect(existsSync(join(home, 'dx', 'agentforce'))).toBe(false);
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viewer).toHaveCount(0);

  // Activate: the sheet names the version and says it is untested on this sandbox.
  await v7.getByRole('button', { name: 'Activate…', exact: true }).click();
  await expect.poll(sheetText).toContain(`Activate ${apiName} v7`);
  expect(await sheetText()).toContain('No eval evidence for this version. Activating it is untested.');
  await press('approve');
  await expect(release).toContainText(`Activated ${apiName}`);
  expect(cliCalls('activate')).toEqual([expect.objectContaining({ cwd: dx, args: expect.arrayContaining(['--api-name', apiName, '--target-org', 'studio', '--version', '7']) })]);
  expect(errors).toEqual([]);
});

test('Salesforce readiness: local authoring without CLI, project org selection and connection recovery', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const statePath = join(home, 'sf-org-state');
  writeFileSync(statePath, 'missing');
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  const pluginStatus = () => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status);
  await expect.poll(pluginStatus, { timeout: 30_000 }).toBe('running');
  const initialSettings = await page.evaluate(() => window.cc.pluginApps.getSettings('salesforce'));
  const projectRoot = join(home, 'local-authoring'); mkdirSync(projectRoot);
  const projectId = await page.evaluate(async path => { const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id; }, projectRoot);
  await page.evaluate(id => { history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, projectId);
  await page.getByRole('navigation', { name: 'local-authoring navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  const workbench = page.getByTestId('salesforce-workbench');
  await expect(workbench.getByText('Local authoring ready', { exact: true })).toBeVisible();
  await expect(workbench.getByRole('heading', { name: 'Org connections unavailable' })).toBeVisible();
  await expect(workbench.getByText('Salesforce CLI (sf) was not found on PATH. Install it, then check again.', { exact: true })).toBeVisible();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('salesforce-local-ready-without-cli.png'));
  await workbench.getByRole('button', { name: /Build an agent/ }).click();
  const studio = studioIn(page);
  const editor = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(studio.getByTestId('salesforce-agent-script-no-file')).toBeVisible();
  await studio.getByRole('button', { name: 'Browse org agents', exact: true }).click();
  await studio.getByRole('button', { name: 'New agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent' });
  await dialog.getByLabel('Name', { exact: true }).fill('Offline support');
  await dialog.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(editor.locator('.view-lines')).toContainText('Offline_support');
  // The org agents opened in the host side panel; hide it to check the workbench on its own.
  await sidePanel(page).getByTestId('thread-secondary-hide').click();
  expect(existsSync(join(projectRoot, 'agentforce-drafts/force-app/main/default/aiAuthoringBundles/Offline_support/Offline_support.agent'))).toBe(true);
  await workbench.getByRole('tab', { name: 'Data', exact: true }).click();
  await expect(workbench.getByRole('button', { name: 'Sign in to an org' })).toBeVisible();
  await expect(page.getByTestId('soql-editor')).toHaveCount(0);
  await workbench.getByRole('button', { name: 'Sign in to an org' }).click();
  const login = page.getByRole('dialog', { name: 'Connect an org' });
  await expect(login).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(login).not.toBeVisible();
  writeFileSync(statePath, 'empty');
  await workbench.getByRole('button', { name: 'Check again' }).click();
  await expect(workbench.getByRole('heading', { name: 'Choose an org when you need it' })).toBeVisible();
  writeFileSync(statePath, 'connected');
  await workbench.getByRole('button', { name: 'Check again' }).click();
  const picker = workbench.getByRole('combobox', { name: 'Salesforce org' });
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveValue('');
  await picker.selectOption('studio');
  await expect(page.getByTestId('soql-editor')).toBeVisible();
  expect(await page.evaluate(() => window.cc.pluginApps.getSettings('salesforce'))).toEqual(initialSettings);
  await workbench.getByRole('tab', { name: 'Overview' }).click();
  await expect(workbench).toContainText('Project target');
  writeFileSync(statePath, 'expired');
  // A real project-scoped refresh, without editing shared settings.
  await page.evaluate(id => window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: id } })), projectId);
  await expect(workbench.getByRole('heading', { name: 'Reconnect your org' })).toBeVisible();
  await page.setViewportSize({ width: 760, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('salesforce-reconnect-narrow-light.png'));
  writeFileSync(statePath, 'failed');
  await workbench.getByRole('button', { name: 'Check again' }).click();
  await expect(workbench.getByRole('heading', { name: 'Org connections unavailable' })).toBeVisible();
  await expect(workbench).not.toContainText('PRIVATE_CLI_ERROR');
  writeFileSync(statePath, 'connected');
  await workbench.getByRole('button', { name: 'Check again' }).click();
  await expect(workbench.getByText('Ready for your next change.', { exact: true })).toBeVisible();
  await expect.poll(pluginStatus).toBe('running');
  expect(errors).toEqual([]);
});

test('Salesforce illustrated states: editor and agents loading, empty results, reduced motion and narrow layout', async ({ app, home }, testInfo) => {
  const page = app.window;
  // Project agents are listed first and suppress the empty state, so start from a project without any.
  for (const file of ['Support.agent', 'Orders.agent']) rmSync(join(home, 'dx', 'force-app', file));
  rmSync(join(home, 'dx', toolbarFile.split('/').slice(0, -1).join('/')), { recursive: true });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => { const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id; }, join(home, 'dx'));
  await page.evaluate(async id => { await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' }); history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, projectId);

  // Hold the editor and fixture CLI to inspect otherwise transient states.
  // The plugin RPC, CLI capture and UI still run through the built app.
  let releaseEditor!: () => void;
  const editorGate = new Promise<void>(resolve => { releaseEditor = resolve; });
  await page.route('**/plugins/salesforce/assets/playground/dist/index.html', async route => { await editorGate; await route.continue(); });
  const metadataState = join(home, 'sf-metadata-state');
  writeFileSync(metadataState, 'hold');
  try {
    await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
    const workbench = page.getByTestId('salesforce-workbench');
    await workbench.getByRole('tab', { name: 'Agentforce', exact: true }).click();
    const editorLoading = page.getByRole('status').filter({ hasText: 'Opening your editor…' });
    await expect(editorLoading).toBeVisible();
    await expect(editorLoading.locator('.sf-state-art')).toHaveAttribute('aria-hidden', 'true');
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath('salesforce-editor-loading.png'));
    releaseEditor();
    await expect(editorLoading).toHaveCount(0);
    const studio = studioIn(page);
    await studio.getByRole('button', { name: 'Browse org agents' }).click();
    const loading = studio.getByRole('status').filter({ hasText: 'Loading agents…' });
    await expect(loading).toBeVisible();
    const animatedLine = loading.locator('.sf-state-window-body span').first();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(animatedLine).toHaveCSS('animation-name', 'sf-state-line');
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath('salesforce-agents-loading-dark.png'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(animatedLine).toHaveCSS('animation-name', 'none');
    writeFileSync(metadataState, 'empty');
    await expect(studio.getByRole('heading', { name: 'No Agent Script sources found' })).toBeVisible();
    await studio.getByRole('button', { name: 'Create a local agent' }).click();
    await expect(page.getByRole('dialog', { name: 'New agent' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath('salesforce-agents-empty-dark.png'));
    writeFileSync(metadataState, 'denied');
    await studio.getByRole('button', { name: 'Refresh agents' }).click();
    await expect(studio.getByRole('alert')).toContainText('Metadata API access denied');
    await expect(studio.getByRole('button', { name: 'Create a local agent' })).toBeEnabled();
    await page.setViewportSize({ width: 760, height: 900 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath('salesforce-agents-unavailable-narrow-light.png'));
    const state = studio.locator('.sf-state[data-kind=error]');
    expect(await state.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    // The narrow window's side panel covers the page until it is closed.
    await sidePanel(page).getByTestId('thread-secondary-hide').click();
    await workbench.getByRole('tab', { name: 'Data', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Run a query to see records.' })).toBeVisible();
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath('salesforce-data-empty-light.png'));
    expect(errors).toEqual([]);
  } finally { releaseEditor(); writeFileSync(metadataState, 'empty'); }
});
