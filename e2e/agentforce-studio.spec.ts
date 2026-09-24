import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync, cpSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import { AGENT_SCRIPT_EXAMPLES } from '../plugins/salesforce/lib/agent-script-model.js';
import { ACTION_AGENT, ACTION_APEX, ACTION_FLOW, ACTION_FLOW_XML } from '../plugins/salesforce/src/action-fixtures.js';
import { VISUALIZER_FLOW } from '../plugins/salesforce/src/flow-visualizer-fixtures.js';
import { flowSnapshotXml } from '../plugins/salesforce/lib/flow-visualizer.js';

const root = fileURLToPath(new URL('..', import.meta.url));
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
      if (path.includes('/tooling/query')) {
        const query = new URL(path, 'http://localhost').searchParams.get('q') ?? '';
        result = query.includes('FROM ApexClass') ? { records: [{ Body: '// Deployed org implementation\n' + ACTION_APEX + '// Deployed detail\n'.repeat(1200) + '// ORG_SOURCE_COMPLETE' }] } : { records: [{ Id: '3010001', VersionNumber: 7, Metadata: ACTION_FLOW }] };
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
        if (text === 'Wait for cancellation') { await new Promise(resolve => setTimeout(resolve, 1500)); }
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
if (args[0] === 'agent' && ['validate', 'preview', 'test', 'publish'].includes(args[1])) {
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

async function openTool(studio: import('@playwright/test').Locator, name: string) {
  const tab = studio.getByRole('tab', { name, exact: true });
  if (await tab.count()) { await tab.click(); return; }
  await studio.getByRole('button', { name: 'Add side panel tab', exact: true }).click();
  await studio.getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

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
  const studio = page.getByTestId('salesforce-agent-script-panel');
  await expect(studio).toBeVisible();
  const frame = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(frame.getByTestId('agent-script-ide')).toBeVisible();
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
  // Navigation and file controls use at most two compact rows above the code.
  expect(editorBox!.y - workbenchBox!.y).toBeLessThanOrEqual(94);
  const codeBox = await frame.locator('.monaco-editor').boundingBox();
  expect(codeBox!.height).toBeGreaterThan(editorBox!.height - 40);
  const explorerBox = await studio.getByTestId('salesforce-agent-script-explorer').boundingBox();
  expect(explorerBox!.x).toBeGreaterThan(editorBox!.x + editorBox!.width - 1);
  await studio.getByRole('button', { name: 'Add side panel tab' }).click();
  await page.screenshot({ path: testInfo.outputPath('studio-add-tools.png') });
  await studio.getByRole('button', { name: /^Graph view/ }).click();
  const graph = page.frameLocator('iframe[title="AgentScript graph"]');
  await expect(graph.getByText('Conversation map')).toBeVisible();
  await expect(frame.locator('.view-lines')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('studio-editor-graph-dark.png') });
  await studio.locator('.af-tools').getByRole('button', { name: 'Hide side panel' }).click();
  await expect(studio.locator('.af-tools')).toBeHidden();
  await expect(frame.locator('.view-lines')).toBeVisible();
  await studio.getByRole('button', { name: 'Show side panel' }).click();
  await studio.getByRole('button', { name: 'Close Graph view' }).click();
  await openTool(studio, 'File explorer');
  // Edit the real Monaco model through normal keyboard input.
  await frame.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('# unsaved studio draft\n');
  // The last keystroke must survive parent-tab unmounts and file switches.
  await workbench.getByRole('tab', { name: 'Data', exact: true }).click();
  await workbench.getByRole('tab', { name: 'Agentforce', exact: true }).click();
  await expect(frame.locator('.view-lines')).toContainText('# unsaved studio draft');
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await expect(frame.locator('.view-lines')).not.toContainText('# unsaved studio draft');
  await studio.getByRole('button', { name: 'Support concierge', exact: true }).click();
  await expect(frame.locator('.view-lines')).toContainText('# unsaved studio draft');
  // Save as refuses a collision before publishing a complete new project file.
  await studio.getByRole('button', { name: 'Save as…', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save agent to project' });
  await saveDialog.getByLabel('File path').fill('force-app/Support.agent');
  await saveDialog.getByRole('button', { name: 'Save new file' }).click();
  await expect(saveDialog.getByRole('alert')).toContainText('already exists');
  expect(readFileSync(join(home, 'dx/force-app/Support.agent'), 'utf8')).toBe(AGENT_SCRIPT_EXAMPLES[0].source);
  await saveDialog.getByLabel('File path').fill('DraftCopy.afscript');
  await saveDialog.getByRole('button', { name: 'Save new file' }).click();
  await expect(saveDialog).toHaveCount(0);
  await expect(studio.getByTestId('salesforce-agent-script-file:DraftCopy.afscript')).toBeVisible();
  await expect(studio.getByTestId('salesforce-agent-script-save')).toHaveText('Saved');
  expect(readFileSync(join(home, 'dx/DraftCopy.afscript'), 'utf8')).toContain('# unsaved studio draft');
  await page.screenshot({ path: testInfo.outputPath('studio-saved-draft.png') });
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
  await openTool(studio, 'Preview');
  const lab = studio.locator('[data-testid="agentforce-lab"]:visible');
  const divider = studio.getByRole('separator', { name: 'Resize editor and side panel' });
  expect(await divider.evaluate(el => parseFloat(getComputedStyle(el).width))).toBeCloseTo(1, 1);
  expect(await divider.evaluate(el => parseFloat(getComputedStyle(el, '::after').width))).toBeCloseTo(11, 1);
  const beforeResize = (await lab.boundingBox())!.width;
  const handleBox = (await divider.boundingBox())!;
  // Grab the invisible hit area outside the visible 1px rule.
  await page.mouse.move(handleBox.x + 4, handleBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 180, handleBox.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await lab.boundingBox())!.width).toBeGreaterThan(beforeResize + 100);
  await expect(studio.locator('.af-workspace')).toHaveAttribute('data-resizing', 'false');
  await lab.getByRole('button', { name: /Start conversation/ }).click();
  await expect(lab.getByText('Conversation ready')).toBeVisible({ timeout: 30_000 });
  await lab.getByLabel('Rehearsal message', { exact: true }).fill('Where is my order?');
  await lab.getByRole('button', { name: 'Send rehearsal message' }).click();
  await expect(lab.getByText(/Could you share your order number/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('studio-rehearse-dark.png') });
  await lab.getByLabel('Rehearsal message', { exact: true }).fill('Long response');
  await lab.getByRole('button', { name: 'Send rehearsal message' }).click();
  await expect(lab.getByTestId('agentforce-lab-transcript')).toContainText('END_OF_RESPONSE');
  await lab.getByLabel('Rehearsal message', { exact: true }).fill('Fail this turn');
  await lab.getByRole('button', { name: 'Send rehearsal message' }).click();
  await expect(lab.getByRole('alert')).toContainText('503');
  await expect(lab.getByText('Run incomplete')).toBeVisible();
  await openTool(studio, 'Tests');
  await lab.getByLabel('Conversation budget').selectOption('2');
  await lab.getByRole('button', { name: /Run AI role-play/ }).click();
  await expect(lab.getByText('Run complete')).toBeVisible({ timeout: 30_000 });
  await expect(lab.getByText('Criteria met')).toBeVisible();
  await lab.getByRole('region', { name: 'AI evaluation' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('studio-test-dark.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect(frame.getByTestId('agent-script-ide')).toHaveClass(/light/);
  await expect.poll(keywordColor).toBe('rgb(5, 80, 174)');
  await lab.getByRole('region', { name: 'AI evaluation' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('studio-test-light.png') });
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
  await expect(frame.locator('.view-lines')).toBeVisible();
  await expect(studio.locator('.af-workspace')).toHaveCSS('flex-direction', 'column');
  expect(await studio.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('studio-narrow-light.png') });
  const requests = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')) as Array<{ path: string; body: Record<string, any> }>;
  expect(requests.find(r => r.path.endsWith('/authoring/scripts'))?.body.assets[0].content).toContain('# unsaved studio draft');
  expect(requests.filter(r => r.path.endsWith('/preview/sessions')).every(r => r.body.enableSimulationMode === true)).toBe(true);
  expect(await studio.innerText()).not.toMatch(/PRIVATE_CLI_TOKEN|PRIVATE_NAMED_JWT/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTool(studio, 'Org preview');
  const orgPreview = page.getByTestId('salesforce-agentforce-preview');
  await expect(orgPreview.getByRole('heading', { name: 'Try your connected agent' })).toBeVisible();
  await expect(orgPreview.getByRole('log', { name: 'Org preview conversation' })).toBeVisible();
  await orgPreview.getByTestId('salesforce-agentforce-preview-start').click();
  await expect(orgPreview.getByText('Simulate preview started.')).toBeVisible();
  await orgPreview.getByTestId('salesforce-agentforce-preview-input').fill('A full response please');
  await orgPreview.getByTestId('salesforce-agentforce-preview-send').click();
  await expect(orgPreview.getByRole('log')).toContainText('CLI_END_OF_RESPONSE');
  await orgPreview.getByTestId('salesforce-agentforce-preview-end').click();
  await expect(orgPreview.getByText('Preview ended.')).toBeVisible();
  await studio.getByRole('button', { name: 'Close Org preview', exact: true }).click();
  await expect(frame.locator('.view-lines')).toBeVisible();
  await expect(studio).toBeVisible();
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
  const studio = page.getByTestId('salesforce-agent-script-panel');
  const agent = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(agent.getByTestId('agent-script-ide')).toBeVisible();
  await studio.getByTestId('salesforce-agent-script-file:force-app/Orders.agent').click();
  await openTool(studio, 'Actions');
  await expect(studio.getByRole('button', { name: 'Inspect lookup in start_agent.orders' })).toBeVisible();
  await agent.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('# preserve my action draft\n');
  await openTool(studio, 'Preview');
  const lab = studio.locator('[data-testid="agentforce-lab"]:visible');
  await lab.getByRole('button', { name: /Start conversation/ }).click();
  await expect(lab.getByText('Conversation ready')).toBeVisible({ timeout: 30_000 });
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
  await expect(lab.getByText('Conversation ready')).toBeVisible();
  await openTool(studio, 'Actions');
  await page.screenshot({ path: testInfo.outputPath('actions-apex-dark.png') });
  await detail.getByRole('button', { name: 'Org · studio' }).click();
  await expect(detail.getByText('studio · Deployed Apex')).toBeVisible();
  await source.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await expect(source.locator('.view-lines')).toContainText('ORG_SOURCE_COMPLETE');
  await detail.getByRole('button', { name: 'Inputs & outputs' }).click();
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
  await page.screenshot({ path: testInfo.outputPath('actions-flow-dark.png') });
  await detail.getByRole('button', { name: 'Org · studio' }).click();
  await expect(detail.getByText('studio · Active Flow · v7')).toBeVisible();
  await expect(flow.locator('svg text').filter({ hasText: /^Within 30 days$/ })).toBeVisible();
  await detail.locator('.af-flow-dependencies summary').click();
  await detail.getByRole('button', { name: 'Open apex://OrderLookup ↗' }).click();
  await expect(detail.getByText('studio · Deployed Apex')).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect.poll(keywordColor).toBe('rgb(166, 38, 164)');
  await page.screenshot({ path: testInfo.outputPath('actions-apex-light.png') });
  await openTool(studio, 'File explorer');
  await openTool(studio, 'Graph view');
  await page.frameLocator('iframe[title="AgentScript graph"]').getByRole('button', { name: 'Inspect refund', exact: true }).click();
  await expect(agent.locator('.view-lines')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'CheckReturn' })).toBeVisible();
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 850));
  expect(await studio.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('actions-flow-narrow-light.png') });
  await detail.getByRole('button', { name: 'Last preview' }).click();
  await expect(detail.getByText('No action trace available')).toBeVisible();
  expect(await studio.innerText()).not.toContain('PRIVATE_TOKEN');
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
  const studio = page.getByTestId('salesforce-agent-script-panel');
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
  await flow.getByText('Return eligible?', { exact: true }).click();
  await expect(flow.getByText('Element Details', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('flow-official-details-dark.png'), animations: 'disabled' });
  await flow.getByRole('button', { name: 'Close', exact: true }).click();
  await flow.getByRole('button', { name: 'Collapse All', exact: true }).click();
  await expect(flow.getByRole('button', { name: 'Expand All', exact: true })).toBeVisible();
  await flow.getByRole('button', { name: 'Expand All', exact: true }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect(frame).toHaveAttribute('src', /light\.html$/);
  await expect(flow.getByText('Each order item', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('flow-official-light.png'), animations: 'disabled' });
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 850));
  expect(await studio.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(flow.getByRole('button', { name: 'Collapse All', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('flow-official-narrow-light.png'), animations: 'disabled' });
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

test('Agentforce Studio: browse org source versions, retrieve and preserve local edits', async ({ app, home }, testInfo) => {
  const page = app.window;
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
  const studio = page.getByTestId('salesforce-agent-script-panel');
  const editor = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(editor.locator('.view-lines')).not.toHaveText('');
  await studio.getByRole('button', { name: 'Browse org agents', exact: true }).click();
  const agents = studio.getByRole('region', { name: 'Org agents' });
  // Inventory exceeds the observed 8192-byte Electron capture boundary.
  await expect(agents.getByText('Z Last', { exact: true })).toBeVisible({ timeout: 30_000 });
  await agents.getByRole('textbox', { name: 'Search org agents' }).fill('Support');
  await agents.getByRole('combobox', { name: 'Source version for Support' }).selectOption('Support_v1');
  await agents.getByRole('button', { name: 'Retrieve & open' }).click();
  await expect(agents.getByRole('status')).toContainText('Retrieved to your project', { timeout: 30_000 });
  const imported = join(home, 'dx', 'agentforce', '00D000000000001', 'Support_v1', 'Support_v1.agent');
  expect(readFileSync(imported, 'utf8')).toContain('ORG_AGENT_SOURCE_COMPLETE');
  expect(readFileSync(imported.replace('.agent', '.bundle-meta.xml'), 'utf8')).toContain('Support.v1');
  await editor.locator('.monaco-editor').click({ position: { x: 160, y: 45 } });
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n# MY_LOCAL_AGENT_EDIT');
  await studio.getByRole('button', { name: 'Save Agentforce file' }).click();
  await expect.poll(() => readFileSync(imported, 'utf8')).toContain('MY_LOCAL_AGENT_EDIT');
  await agents.getByRole('button', { name: 'Retrieve & open' }).click();
  await expect(agents.getByRole('status')).toContainText('Existing edits were preserved');
  expect(readFileSync(imported, 'utf8')).toContain('MY_LOCAL_AGENT_EDIT');
  const retrievals = readFileSync(join(home, 'agent-retrievals.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(retrievals).toHaveLength(1);
  expect(retrievals[0].args).toContain('AiAuthoringBundle:Support_v1');
  expect(retrievals[0].home).toBe(home);
  expect(existsSync(retrievals[0].cwd)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('org-agent-source-browser.png') });
  await agents.getByRole('textbox', { name: 'Search org agents' }).fill('Unavailable');
  await agents.getByRole('button', { name: 'Retrieve & open' }).click();
  await expect(agents.getByRole('alert')).toHaveText('Source access denied');
  expect(await studio.innerText()).not.toContain('PRIVATE_CLI_TOKEN');
  // Invalid project ids never grant a local write root.
  const refused = await page.evaluate(async () => window.cc.pluginApps.callRpc('salesforce', 'agents.retrieve.start', { projectId: 'missing', orgId: '00D000000000001', fullName: 'Support_v2', projectRoot: '/tmp' }));
  expect(refused).toMatchObject({ ok: false, code: 'invalid_context' });
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
  const studio = page.getByTestId('salesforce-agent-script-panel');
  const editor = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(editor.locator('.view-lines')).not.toHaveText('');
  await studio.getByRole('button', { name: 'Browse org agents', exact: true }).click();
  await studio.getByRole('button', { name: 'New agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent' });
  await dialog.getByLabel('Name', { exact: true }).fill('Customer support');
  await dialog.getByLabel('Purpose', { exact: false }).fill('Help customers with clear, concise answers.');
  await expect(dialog.getByLabel('API name')).toHaveValue('Customer_support');
  await expect(dialog).toContainText('agentforce-drafts/force-app/main/default/aiAuthoringBundles');
  await page.screenshot({ path: testInfo.outputPath('new-agent-dialog.png') });
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
  await expect(studio.getByRole('tab', { name: 'Graph view', exact: true })).toHaveAttribute('aria-selected', 'true');
  await editor.locator('.monaco-editor').click({ position: { x: 180, y: 50 } });
  await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type('\n# HUMAN_EDIT');
  await expect(studio.getByRole('button', { name: 'Save Agentforce file' })).toContainText('Save');
  expect(await command(agentView, 'file.open', { path: draftPath })).toMatchObject({ ok: false, error: expect.stringContaining('Save the current draft') });
  await studio.getByRole('button', { name: 'Save Agentforce file' }).click();
  await expect.poll(() => readFileSync(join(projectRoot, created.file.path), 'utf8')).toContain('HUMAN_EDIT');
  expect(await command(agentView, 'file.open', { path: draftPath })).toMatchObject({ ok: true });
  await page.screenshot({ path: testInfo.outputPath('new-agent-controlled-graph.png') });
  const query = await action('query.execute', { query: 'SELECT Id, Name FROM Account LIMIT 1' });
  expect(query).toMatchObject({ ok: true, resultId: expect.any(String) });
  expect(await command(await view('workbench'), 'view.open', { view: 'data' })).toMatchObject({ ok: true, viewState: { view: 'data' } });
  expect(await command(await view('data'), 'query.show', { resultId: query.resultId })).toMatchObject({ ok: true, viewState: { rows: 1 } });
  await expect(page.getByRole('cell', { name: 'Workbench result account', exact: true })).toBeVisible();
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
  await page.screenshot({ path: testInfo.outputPath('salesforce-local-ready-without-cli.png') });
  await workbench.getByRole('button', { name: /Build an agent/ }).click();
  const studio = page.getByTestId('salesforce-agent-script-panel');
  const editor = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(editor.locator('.view-lines')).not.toHaveText('');
  await studio.getByRole('button', { name: 'Browse org agents', exact: true }).click();
  await studio.getByRole('button', { name: 'New agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent' });
  await dialog.getByLabel('Name', { exact: true }).fill('Offline support');
  await dialog.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(editor.locator('.view-lines')).toContainText('Offline_support');
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
  await page.screenshot({ path: testInfo.outputPath('salesforce-reconnect-narrow-light.png') });
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
    await page.screenshot({ path: testInfo.outputPath('salesforce-editor-loading.png') });
    releaseEditor();
    await expect(editorLoading).toHaveCount(0);
    const studio = page.getByTestId('salesforce-agent-script-panel');
    await studio.getByRole('button', { name: 'Browse org agents' }).click();
    const loading = studio.getByRole('status').filter({ hasText: 'Loading agents…' });
    await expect(loading).toBeVisible();
    const animatedLine = loading.locator('.sf-state-window-body span').first();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(animatedLine).toHaveCSS('animation-name', 'sf-state-line');
    await page.screenshot({ path: testInfo.outputPath('salesforce-agents-loading-dark.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(animatedLine).toHaveCSS('animation-name', 'none');
    writeFileSync(metadataState, 'empty');
    await expect(studio.getByRole('heading', { name: 'No Agent Script sources found' })).toBeVisible();
    await studio.getByRole('button', { name: 'Create a local agent' }).click();
    await expect(page.getByRole('dialog', { name: 'New agent' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('salesforce-agents-empty-dark.png') });
    writeFileSync(metadataState, 'denied');
    await studio.getByRole('button', { name: 'Refresh agents' }).click();
    await expect(studio.getByRole('alert')).toContainText('Metadata API access denied');
    await expect(studio.getByRole('button', { name: 'Create a local agent' })).toBeEnabled();
    await page.setViewportSize({ width: 760, height: 900 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.screenshot({ path: testInfo.outputPath('salesforce-agents-unavailable-narrow-light.png') });
    const state = studio.locator('.sf-state[data-kind=error]');
    expect(await state.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await workbench.getByRole('tab', { name: 'Data', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Run a query to see records.' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('salesforce-data-empty-light.png') });
    expect(errors).toEqual([]);
  } finally { releaseEditor(); writeFileSync(metadataState, 'empty'); }
});
