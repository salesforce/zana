import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
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
const ORG_TEST_CASES = [
  { n: 1, utterance: 'Where is my order?', topic: 'Orders', actions: "[&apos;Lookup&apos;]", reply: 'Asks for the order number' },
  // A form submission after an earlier turn, written with the CSV-doubled quotes Testing Center exports keep.
  { n: 2, utterance: '{&quot;&quot;orderNumber&quot;&quot;: &quot;&quot;00012345&quot;&quot;, &quot;&quot;reason&quot;&quot;: &quot;&quot;Damaged&quot;&quot;, &quot;&quot;refundTo&quot;&quot;: &quot;&quot;Card&quot;&quot;}', topic: 'Returns', actions: '[]', reply: 'Explains the refund policy',
    inputs: `<conversationHistory><index>0</index><message>I want a refund</message><role>user</role></conversationHistory>
      <conversationHistory><index>1</index><message>Which order should I refund?</message><role>agent</role></conversationHistory>
      <contextVariable><variableName>currentObjectApiName</variableName><variableValue>Order</variableValue></contextVariable>
      <contextVariable><variableName>channel</variableName><variableValue>Web</variableValue></contextVariable>` },
  { n: 3, utterance: 'Cancel my subscription', topic: 'Billing', actions: '[]', reply: 'Confirms the cancellation' },
];
const ORG_TEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AiEvaluationDefinition xmlns="http://soap.sforce.com/2006/04/metadata">
  <name>Support regression</name>
  <subjectName>Support</subjectName>
  <subjectType>AGENT</subjectType>
  <subjectVersion>v1</subjectVersion>
${ORG_TEST_CASES.map(c => `  <testCase>
    <expectation><name>topic_sequence_match</name><expectedValue>${c.topic}</expectedValue></expectation>
    <expectation><name>action_sequence_match</name><expectedValue>${c.actions}</expectedValue></expectation>
    <expectation><name>bot_response_rating</name><expectedValue>${c.reply}</expectedValue></expectation>
    <expectation><name>completeness</name></expectation>
    <expectation><name>coherence</name></expectation>
    <inputs>${'inputs' in c ? c.inputs : ''}<utterance>${c.utterance}</utterance></inputs>
    <number>${c.n}</number>
  </testCase>`).join('\n')}
</AiEvaluationDefinition>`;
const ORG_TEST_RESULTS = {
  status: 'COMPLETED', startTime: '2026-10-20T10:00:00.000Z', endTime: '2026-10-20T10:01:30.000Z', subjectName: 'Support',
  testCases: ORG_TEST_CASES.map(c => {
    const failing = c.n === 3;
    const topic = failing ? 'General_FAQ' : c.topic;
    return {
      status: 'COMPLETED', testNumber: c.n, startTime: '2026-10-20T10:00:00.000Z', endTime: '2026-10-20T10:00:30.000Z',
      inputs: { utterance: c.utterance.replace(/&quot;/g, '"') },
      generatedData: { topic, actionsSequence: c.n === 1 ? ['Lookup'] : [], outcome: c.reply + '.', sessionId: 'sess-' + c.n, invokedActions: '[]' },
      testResults: [
        { name: 'topic_sequence_match', expectedValue: c.topic, actualValue: topic, score: failing ? 0 : 1, result: failing ? 'FAILURE' : 'PASS', status: 'COMPLETED',
          metricExplainability: failing ? 'The agent routed to General_FAQ instead of Billing.' : 'Topic matched.' },
        { name: 'bot_response_rating', expectedValue: c.reply, actualValue: c.reply + '.', score: 0.9, result: 'PASS', status: 'COMPLETED', metricExplainability: 'The reply covers the expectation.' },
        { name: 'completeness', score: 0.8, result: null, status: 'COMPLETED' },
        { name: 'coherence', score: 0.9, result: null, status: 'COMPLETED' },
      ],
    };
  }),
};
// Replace only the upstream network in the installed fixture. The real transport,
// session service, plugin RPC, Monaco iframe and Electron UI all run unchanged.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const requests: Array<{ path: string; host: string; body: Record<string, unknown> }> = [];
    let evalPolls = 0;
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
        const progressGate = existsSync(join(home, 'simulation-hold')) ? 'simulation-hold' : text === 'Suite progress first case' ? 'suite-first' : text === 'Suite progress second case' ? 'suite-second' : null;
        if (progressGate) {
          const deadline = Date.now() + 30_000;
          while (existsSync(join(home, progressGate)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (text === 'Fail this turn') { res.writeHead(503); res.end('{}'); return; }
        if (text === 'Wait for cancellation') { await new Promise(resolve => setTimeout(resolve, 8000)); }
        result = { messages: [{ message: text === 'Long response' ? 'Complete response. '.repeat(1200) + 'END_OF_RESPONSE' : 'I can help you track an order or resolve an issue. Could you share your order number so I can find the right details?', planId: 'plan-e2e-1' }] };
      } else if (path.endsWith('/chat-generations')) {
        const system = body.messages[0].content as string;
        const failedJudge = existsSync(join(home, 'simulation-judge-fail'));
        result = { generationDetails: { generations: [{ content: system.startsWith('Evaluate') ? JSON.stringify({ outcome: failedJudge ? 'fail' : 'pass', reason: failedJudge ? 'The agent did not complete the requested refund.' : 'The agent stayed within scope and asked for the missing order details.', evidence: ['The agent asked for an order number before proceeding.'] }) : system.includes('CUSTOMER') ? 'My order is ORD-1042. Can you check the delivery date?' : 'I can help with that. What is your order number?' }] } };
      } else if (path.includes('/einstein/ai-evaluations/runs')) {
        // Testing Center: a run starts NEW, reads IN_PROGRESS once, then COMPLETED with 2 passing and 1 failing case.
        if (req.method === 'POST' && path.endsWith('/runs')) result = { id: '4KB000000000001AAA', status: 'NEW' };
        else if (path.endsWith('/results')) result = ORG_TEST_RESULTS;
        else { evalPolls++; result = { id: '4KB000000000001AAA', status: evalPolls < 2 ? 'IN_PROGRESS' : 'COMPLETED' }; }
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
// Testing Center definitions: listed by metadata type, retrieved by manifest in source format.
if (args[0] === 'org' && args[1] === 'list' && args[2] === 'metadata' && args.includes('AiEvaluationDefinition')) result = [
  { fullName: 'Support_Regression', createdByName: 'Ada Admin', lastModifiedDate: '2026-10-01T10:00:00.000Z' },
  { fullName: 'Billing_Smoke', createdByName: 'Bo Builder', lastModifiedDate: '2026-09-01T10:00:00.000Z' },
];
if (args[0] === 'project' && args[1] === 'retrieve' && args.includes('--manifest') && fs.readFileSync(path.join(process.cwd(), 'package.xml'), 'utf8').includes('<name>AiEvaluationDefinition</name>')) {
  // Every member of the manifest, as the real CLI does; Billing_Smoke tests another agent.
  const files = [...fs.readFileSync(path.join(process.cwd(), 'package.xml'), 'utf8').matchAll(/<members>([^<]+)<\\/members>/g)].map(([, fullName]) => {
    const file = path.join(process.cwd(), 'force-app/main/default/aiEvaluationDefinitions', fullName + '.aiEvaluationDefinition-meta.xml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const xml = ${JSON.stringify(ORG_TEST_XML)};
    fs.writeFileSync(file, fullName === 'Billing_Smoke' ? xml.replace('<name>Support regression</name>', '<name>Billing smoke</name>').replace('<subjectName>Support</subjectName>', '<subjectName>Billing</subjectName>') : xml);
    return { fullName, type: 'AiEvaluationDefinition', state: 'Created', filePath: file };
  });
  console.log(JSON.stringify({ status: 0, result: { success: true, done: true, files, fileProperties: [] } }));
  process.exit(0);
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
    mkdirSync(join(home, 'acme-service', 'force-app'), { recursive: true });
    writeFileSync(join(home, 'acme-service', 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
    writeFileSync(join(home, 'acme-service', 'force-app', 'Support.agent'), AGENT_SCRIPT_EXAMPLES[0].source);
    mkdirSync(join(home, 'acme-service', 'force-app/main/default/aiAuthoringBundles/Customer_Service_Agent_With_A_Long_Name'), { recursive: true });
    writeFileSync(join(home, 'acme-service', toolbarFile), AGENT_SCRIPT_EXAMPLES[0].source);
    writeFileSync(join(home, 'acme-service', 'force-app', 'Orders.agent'), ACTION_AGENT);
    mkdirSync(join(home, 'acme-service', 'force-app', 'main', 'default', 'classes'), { recursive: true });
    mkdirSync(join(home, 'acme-service', 'force-app', 'main', 'default', 'flows'), { recursive: true });
    writeFileSync(join(home, 'acme-service', 'force-app', 'main', 'default', 'classes', 'OrderLookup.cls'), ACTION_APEX);
    writeFileSync(join(home, 'acme-service', 'force-app', 'main', 'default', 'flows', 'CheckReturn.flow-meta.xml'), ACTION_FLOW_XML);
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
/** Actions and Comments are the Studio tools that stay host side-panel tools. */
const PANEL_TOOL_IDS: Record<string, string> = { Actions: 'actions', Comments: 'comments' };
/** Graph, Preview, Tests and Org preview are view tabs of the active agent in the Studio editor area. */
const VIEW_TOOLS: Record<string, { target: 'graph' | 'preview' | 'tests' | 'org-preview'; tab: string }> = {
  'Graph view': { target: 'graph', tab: 'Graph' }, Graph: { target: 'graph', tab: 'Graph' },
  Preview: { target: 'preview', tab: 'Preview' }, Tests: { target: 'tests', tab: 'Tests' }, 'Org preview': { target: 'org-preview', tab: 'Org preview' }
};
/** The agent view tab strip (Script, Preview, Tests, Graph, Org preview, plus referenced Apex / Flow / Org tabs). */
const editorTabs = (page: Page) => studioPanel(page).getByRole('tablist', { name: 'Open files' });
/** The agent tab strip at the top of the Studio: one tab per open agent. */
const agentTabs = (page: Page) => studioPanel(page).getByRole('tablist', { name: 'Open agents' });
/** The visible pane of one view tab (several agents keep their panes mounted, hidden). */
const viewPane = (page: Page, target: 'graph' | 'preview' | 'tests' | 'org-preview') => studioPanel(page).locator(`[data-testid="studio-view-${target}"]:visible`);

/** Brings the active agent's Script tab forward (the editor stays mounted behind view tabs). */
async function showScript(page: Page) {
  await editorTabs(page).getByRole('tab', { name: /^Script/ }).click();
}

/** Shows the host side panel through its own toggle, when it is hidden. */
async function showSidePanel(page: Page) {
  if (!(await sidePanel(page).isVisible())) await page.getByTestId('plugin-panel-host-layout').getByTestId('plugin-panel-secondary-show').click();
  await expect(sidePanel(page)).toBeVisible();
}

/** Opens a Studio tool: Actions / Comments in the host side panel, everything else as a view tab of the active agent. */
async function openTool(studio: Locator, name: string) {
  const page = studio.page();
  const view = VIEW_TOOLS[name];
  if (!view) {
    await showSidePanel(page);
    const tab = sidePanelTab(page, name);
    if (await tab.count()) { await tab.click(); return; }
    await openThreadToolLauncher(sidePanel(page));
    await sidePanel(page).getByTestId(`thread-new-tab-plugin-salesforce-studio-${PANEL_TOOL_IDS[name]}`).click();
    await expect(activeSidePanelTab(page)).toHaveText(name);
    return;
  }
  if (view.target === 'org-preview') {
    // Org preview has no button in the wide agent tab bar; the compact tool strip lists it.
    const size = page.viewportSize() ?? { width: 1440, height: 900 };
    await page.setViewportSize({ width: 760, height: size.height });
    await studioPanel(page).getByRole('tablist', { name: 'Studio tools' }).getByRole('tab', { name: 'Org preview', exact: true }).click();
    await page.setViewportSize(size);
  } else {
    await studioPanel(page).getByRole('button', { name: `Open ${view.tab} view`, exact: true }).click();
  }
  await expect(editorTabs(page).getByRole('tab', { name: view.tab, exact: true })).toHaveAttribute('aria-selected', 'true');
}

// Demo recording only: ZCC_E2E_RECORD_VIDEO=<dir> pnpm test:e2e -- e2e/demo-agentforce-studio.spec.ts
test('demo: Agentforce Studio tour', async ({ app, home }) => {
  test.skip(!process.env.ZCC_E2E_RECORD_VIDEO, 'demo recording only');
  const page = app.window;
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id;
  }, join(home, 'acme-service'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('navigation', { name: 'acme-service navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  const editor = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(editor.getByTestId('agent-script-ide')).toBeVisible();
  await studio.getByTestId('salesforce-agent-script-file:force-app/Orders.agent').click();
  await expect(editor.locator('.view-lines')).toContainText('apex://OrderLookup');
  // The project status bar shows the throwaway E2E home path; the sidebar takes room Studio can use.
  await page.addStyleTag({ content: '.statusbar { display: none !important; }' });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).first().click();
  await page.waitForTimeout(1500);

  const beat = (ms: number) => page.waitForTimeout(ms);
  const caption = (text: string) => page.evaluate(value => {
    let node = document.getElementById('e2e-caption');
    if (!node) {
      node = Object.assign(document.createElement('div'), { id: 'e2e-caption' });
      node.style.cssText = 'position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:99999;padding:10px 18px;border-radius:10px;background:rgba(20,24,33,.92);color:#fff;font:600 16px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(120,160,255,.6);pointer-events:none';
      document.body.appendChild(node);
    }
    node.textContent = value;
  }, text);
  // A black flash marks where the trimmed demo starts.
  await page.evaluate(() => {
    const flash = Object.assign(document.createElement('div'), { id: 'e2e-flash' });
    flash.style.cssText = 'position:fixed;inset:0;background:#000;z-index:100000';
    document.body.appendChild(flash);
  });
  await beat(600);
  await page.evaluate(() => document.getElementById('e2e-flash')?.remove());

  await caption('Agentforce Studio · edit Agent Script with a real editor');
  await beat(3000);

  await caption('See the agent as a conversation graph');
  await openTool(studio, 'Graph view');
  await expect(viewPane(page, 'graph').frameLocator('iframe[title="AgentScript graph"]').getByText('Conversation map')).toBeVisible();
  await beat(3500);

  await caption('Inspect actions: the Apex behind each step…');
  await showScript(page);
  await openTool(studio, 'Actions');
  await studio.getByRole('button', { name: 'Inspect lookup in start_agent.orders' }).click();
  await expect(page.frameLocator('iframe[title="Action implementation source"]').locator('.view-lines')).toContainText('InvocableMethod');
  await beat(3000);
  await caption('…and the Flow, drawn as the real canvas');
  await studio.locator('.af-related-tabs').getByRole('button', { name: 'All actions' }).click();
  await studio.getByRole('button', { name: 'Inspect refund in start_agent.orders' }).click();
  await expect(page.frameLocator('iframe[title="Salesforce Flow visualizer"]').locator('svg text').filter({ hasText: /^Within 30 days$/ })).toBeVisible();
  await beat(3500);
  await sidePanel(page).getByTestId('thread-secondary-hide').click();

  await caption('Preview a conversation against the org');
  await openTool(studio, 'Preview');
  const preview = viewPane(page, 'preview').getByTestId('preview-workbench');
  await preview.getByRole('group', { name: 'Preview engine' }).getByRole('button', { name: 'Simulate' }).click();
  await preview.getByTestId('pw-start').click();
  await expect(preview.getByRole('button', { name: 'End', exact: true })).toBeVisible({ timeout: 30_000 });
  await preview.getByLabel('Preview message', { exact: true }).pressSequentially('Where is my order?', { delay: 45 });
  await preview.getByRole('button', { name: 'Send preview message' }).click();
  await expect(preview.getByText(/Could you share your order number/)).toBeVisible();
  await beat(2500);

  await caption('Run simulated customers and get a judge verdict');
  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await tests.getByRole('button', { name: 'Batch simulations', exact: true }).click();
  const simulations = tests.getByTestId('studio-simulations');
  await simulations.getByLabel('Missing details', { exact: true }).uncheck();
  await simulations.getByLabel('Stay in scope', { exact: true }).uncheck();
  await beat(800);
  await simulations.getByRole('button', { name: 'Run 1 conversation', exact: true }).click();
  await expect(simulations.getByLabel('1 of 1 pass')).toBeVisible({ timeout: 30_000 });
  await simulations.getByRole('listitem').click();
  await expect(simulations.getByRole('region', { name: 'Conversation Happy path' })).toContainText('Judge');
  await beat(3500);
});
