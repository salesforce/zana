import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import { AGENT_SCRIPT_EXAMPLES } from '../plugins/salesforce/lib/agent-script-model.js';
import { ACTION_AGENT, ACTION_APEX, ACTION_FLOW, ACTION_FLOW_XML } from '../plugins/salesforce/src/action-fixtures.js';

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
      } else if (path.includes('/actions/custom/apex/')) result = { inputs: [{ name: 'orderId', type: 'String', required: true }], outputs: [{ name: 'status', type: 'String' }] };
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
    for (const name of ['app.js', 'app.meta.json', 'playground']) cpSync(join(root, 'plugins/salesforce', name), join(pluginDir, name), { recursive: true });
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
const org = { alias:'studio', username:'studio@example.com', orgId:'00D000000000001', instanceUrl:'https://studio.my.salesforce.com', isSandbox:true, accessToken:'PRIVATE_CLI_TOKEN' };
let result = args.includes('display') ? org : args.includes('list') ? { sandboxes:[org] } : {};
if (args[0] === 'agent' && args[1] === 'preview') result = { sessionId:'cli-preview', messages:[{ message: args[2] === 'send' ? 'CLI preview response. '.repeat(1100) + 'CLI_END_OF_RESPONSE' : 'Ready' }] };
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
    try { await use({ PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ZCC_BUNDLED_PLUGINS_DIR: join(home, 'bundled'), ZCC_FAKE_PROVIDER: '1' }); }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(180_000);

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
  await studio.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(frame.getByText('Conversation map')).toBeVisible();
  // Electron zoom may round the rendered width to a fractional CSS pixel.
  expect(await frame.locator('.split-handle').evaluate(el => parseFloat(getComputedStyle(el).width))).toBeCloseTo(1, 1);
  expect(await frame.locator('.split-handle').evaluate(el => parseFloat(getComputedStyle(el, '::after').width))).toBeCloseTo(11, 1);
  await page.screenshot({ path: testInfo.outputPath('studio-build-dark.png') });
  await studio.getByRole('button', { name: 'Script', exact: true }).click();
  // Edit the real Monaco model through normal keyboard input.
  await frame.locator('.view-lines').click();
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
  await frame.locator('.view-lines').click();
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
  await studio.getByRole('button', { name: /02 Rehearse/ }).click();
  const lab = studio.locator('[data-testid="agentforce-lab"]:visible');
  const divider = studio.getByRole('separator', { name: 'Resize editor and conversation' });
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
  await studio.getByRole('button', { name: /03 Test/ }).click();
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
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 900));
  expect(await studio.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('studio-narrow-light.png') });
  const requests = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')) as Array<{ path: string; body: Record<string, any> }>;
  expect(requests.find(r => r.path.endsWith('/authoring/scripts'))?.body.assets[0].content).toContain('# unsaved studio draft');
  expect(requests.filter(r => r.path.endsWith('/preview/sessions')).every(r => r.body.enableSimulationMode === true)).toBe(true);
  expect(await studio.innerText()).not.toMatch(/PRIVATE_CLI_TOKEN|PRIVATE_NAMED_JWT/);
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  await studio.getByRole('button', { name: 'Org preview', exact: true }).click();
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
  await page.getByRole('button', { name: 'Back to studio', exact: true }).click();
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
  await expect(studio.getByRole('button', { name: 'Inspect lookup in start_agent.orders' })).toBeVisible();
  await agent.locator('.view-lines').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('# preserve my action draft\n');
  await studio.getByRole('button', { name: /02 Rehearse/ }).click();
  const lab = studio.locator('[data-testid="agentforce-lab"]:visible');
  await lab.getByRole('button', { name: /Start conversation/ }).click();
  await expect(lab.getByText('Conversation ready')).toBeVisible({ timeout: 30_000 });
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
  await source.locator('.view-lines').click();
  await page.keyboard.insertText('MUST_NOT_EDIT');
  await expect(source.locator('.view-lines')).not.toContainText('MUST_NOT_EDIT');
  await expect(lab.getByText('Conversation ready')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('actions-apex-dark.png') });
  await detail.getByRole('button', { name: 'Org · studio' }).click();
  await expect(detail.getByText('studio · Deployed Apex')).toBeVisible();
  await source.locator('.view-lines').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await expect(source.locator('.view-lines')).toContainText('ORG_SOURCE_COMPLETE');
  await detail.getByRole('button', { name: 'Inputs & outputs' }).click();
  await expect(detail.getByText(/Name matched/)).toHaveCount(2);
  await detail.getByRole('button', { name: 'Used by' }).click();
  await expect(detail.getByText(/set @variables.status/)).toBeVisible();
  await detail.getByRole('button', { name: /Go to action definition/ }).click();
  // Monaco virtualizes lines: revealing the declaration may scroll the draft
  // header out of the DOM, depending on the host's available editor height.
  await agent.locator('.view-lines').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await expect(agent.locator('.view-lines')).toContainText('# preserve my action draft');
  await expect(studio.getByText(/Unsaved draft/)).toBeVisible();
  const targetLine = ACTION_AGENT.split('\n').findIndex(line => line.includes('apex://OrderLookup')) + 1;
  for (let line = 0; line < targetLine; line++) await page.keyboard.press('ArrowDown');
  await agent.locator('.view-line').filter({ hasText: 'apex://OrderLookup' }).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expect(detail.getByRole('heading', { name: 'OrderLookup' })).toBeVisible();
  await studio.locator('.af-related-tabs').getByRole('button', { name: /Orders.agent/ }).click();
  await studio.getByRole('button', { name: 'Inspect refund in start_agent.orders' }).click();
  await expect(detail.getByLabel('Flow implementation map')).toBeVisible();
  await expect(detail.getByText('Within 30 days')).toBeVisible();
  await expect(detail.getByText('Fault', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('actions-flow-dark.png') });
  await detail.getByRole('button', { name: 'Org · studio' }).click();
  await expect(detail.getByText('studio · Active Flow · v7')).toBeVisible();
  await detail.getByRole('button', { name: 'Action: Log lookup failure' }).click();
  await detail.getByRole('button', { name: 'Open apex://OrderLookup ↗' }).click();
  await expect(detail.getByText('studio · Deployed Apex')).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect.poll(keywordColor).toBe('rgb(166, 38, 164)');
  await page.screenshot({ path: testInfo.outputPath('actions-apex-light.png') });
  await studio.getByRole('button', { name: /01 Build/ }).click();
  await studio.getByRole('button', { name: 'Graph', exact: true }).click();
  await agent.getByRole('button', { name: 'Inspect refund', exact: true }).click();
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
