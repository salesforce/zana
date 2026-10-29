import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    let comparisonCandidate = false;
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
      else if (path.endsWith('/authoring/scripts')) { comparisonCandidate = String(body.assets?.[0]?.content).includes('# comparison-candidate'); result = { status: 'success', compiledArtifact: { globalConfiguration: { label: 'Support concierge' } } }; }
      else if (path.endsWith('/preview/sessions')) result = { sessionId: 'remote-session', messages: [{ message: 'Hello! I’m your support concierge. How can I help today?' }] };
      else if (path.includes('/plans/') && existsSync(join(home, 'preview-trace-fixture'))) result = { plan: [
        { type: 'UserInputStep', message: 'Find my order' },
        { type: 'UpdateTopicStep', topic: 'welcome' },
        { type: 'LLMExecutionStep', executionLatency: 400, data: { prompt_name: 'Route request', prompt_content: 'Help with orders and returns.', prompt_response: 'go_to_orders' } },
        { type: 'TransitionStep', data: { from_agent: 'welcome', to_agent: 'orders', transition_type: 'handoff' } },
        { type: 'UpdateTopicStep', topic: 'orders' },
        { type: 'PlannerResponseStep', message: 'Could you share your order number?', executionLatency: 1200 }
      ] };
      else if (path.endsWith('/messages')) {
        const text = body.message.text;
        const progressGate = existsSync(join(home, 'simulation-hold')) ? 'simulation-hold' : text === 'Suite progress first case' ? 'suite-first' : text === 'Suite progress second case' ? 'suite-second' : null;
        if (progressGate) {
          const deadline = Date.now() + 30_000;
          while (existsSync(join(home, progressGate)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (text === 'Fail this turn') { res.writeHead(503); res.end('{}'); return; }
        if (text === 'Wait for cancellation') { await new Promise(resolve => setTimeout(resolve, 8000)); }
        result = { messages: [{ message: text === 'Comparison acceptance' ? comparisonCandidate ? 'comparison success' : 'comparison baseline' : text === 'Long response' ? 'Complete response. '.repeat(1200) + 'END_OF_RESPONSE' : 'I can help you track an order or resolve an issue. Could you share your order number so I can find the right details?', planId: 'plan-e2e-1' }] };
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
  // Workbench tabs, agent tabs, view tabs and a one-row document bar sit above the code; a wrapping bar adds a fifth row.
  expect(editorBox!.y - workbenchBox!.y).toBeLessThanOrEqual(164);
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
  // The box takes focus; toBeFocused also needs the iframe document to report hasFocus(), which headless Linux CI does not.
  const commentInput = commentForm.locator('textarea');
  await expect.poll(() => commentInput.evaluate(input => input === input.ownerDocument.activeElement)).toBe(true);
  await page.keyboard.type('Check this line');
  await expect(commentInput).toHaveValue('Check this line');
  await expect(chip).toHaveCount(0);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-inline-comment.png'));
  // Real pointer clicks must reach the form above Monaco's transparent view-lines layer.
  await commentForm.getByRole('button', { name: 'Cancel', exact: true, includeHidden: true }).click();
  await expect(commentForm).toHaveCount(0);
  await expect(frame.locator('.sf-comment-glyph')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await chip.getByRole('button', { name: 'Comment', exact: true }).click();
  await commentInput.fill('Check this line');
  await commentForm.getByRole('button', { name: 'Add comment', exact: true, includeHidden: true }).click();
  await expect(commentForm).toHaveCount(0);
  await expect(frame.locator('.sf-comment-glyph')).toHaveCount(1);
  await expect(frame.locator('.view-lines')).not.toContainText('Check this line');
  await frame.locator('.sf-comment-glyph').click();
  const commentRow = frame.locator('.sf-comment-row').filter({ hasText: 'Check this line' });
  await commentRow.getByRole('button', { name: 'Edit', exact: true, includeHidden: true }).click();
  const editComment = frame.locator('form[aria-label="Edit comment"]');
  await editComment.locator('textarea').fill('Check this line again');
  await editComment.getByRole('button', { name: 'Save', exact: true, includeHidden: true }).click();
  await expect(editComment).toHaveCount(0);
  await expect(commentRow).toContainText('Check this line again');
  await commentRow.getByRole('button', { name: 'Delete', exact: true, includeHidden: true }).click();
  await commentRow.getByRole('button', { name: 'Confirm delete', exact: true, includeHidden: true }).click();
  await expect(frame.locator('.sf-comment-glyph')).toHaveCount(0);
  // The host's own toggle opens the side panel beside the tab; its New Tab page lists only Actions and Comments.
  await showSidePanel(page);
  await openThreadToolLauncher(sidePanel(page));
  await expect(sidePanel(page).getByTestId('thread-new-tab-plugin-salesforce-studio-actions')).toBeVisible();
  await expect(sidePanel(page).getByTestId('thread-new-tab-plugin-salesforce-studio-comments')).toBeVisible();
  for (const gone of ['graph', 'preview', 'test', 'release', 'org-preview', 'agents']) await expect(sidePanel(page).getByTestId(`thread-new-tab-plugin-salesforce-studio-${gone}`)).toHaveCount(0);
  await expect(sidePanel(page).getByTestId('thread-new-tab-plugin-salesforce-playground')).toHaveCount(0);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-add-tools.png'));
  await sidePanel(page).getByTestId('thread-secondary-hide').click();
  await expect(sidePanel(page)).toBeHidden();
  // Graph is a view tab of the active agent, inside Studio's editor area.
  await openTool(studio, 'Graph view');
  const graph = viewPane(page, 'graph').frameLocator('iframe[title="AgentScript graph"]');
  await expect(graph.getByText('Conversation map')).toBeVisible();
  await expect(frame.locator('.view-lines')).toBeHidden();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-editor-graph-dark.png'));
  await editorTabs(page).getByRole('button', { name: 'Close Graph', exact: true }).click();
  await expect(editorTabs(page).getByRole('tab', { name: 'Graph', exact: true })).toHaveCount(0);
  await expect(editorTabs(page).getByRole('tab', { name: /^Script/ })).toHaveAttribute('aria-selected', 'true');
  await expect(frame.locator('.view-lines')).toBeVisible();
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
  // The document bar's Preview button opens the Preview view tab of this agent.
  await studioPanel(page).locator('.af-document-bar').getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(editorTabs(page).getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true');
  const preview = viewPane(page, 'preview').getByTestId('preview-workbench');
  await expect(preview).toBeVisible();
  await expect(sidePanel(page)).toBeHidden();
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
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await expect(tests.getByRole('group', { name: 'Tests view' }).getByRole('button')).toHaveText(['Test cases', 'Test catalogue', 'Batch simulations', 'Role-play']);
  await expect(tests.getByRole('group', { name: 'Tests view' }).getByRole('button', { name: 'Test cases' })).toHaveAttribute('aria-pressed', 'true');
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
  // The editor sits behind the Tests view tab; bring Script forward to read its rendered tokens.
  await showScript(page);
  await expect.poll(keywordColor).toBe('rgb(5, 80, 174)');
  await editorTabs(page).getByRole('tab', { name: 'Tests', exact: true }).click();
  await lab.getByRole('region', { name: 'AI evaluation' }).scrollIntoViewIfNeeded();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-test-light.png'));
  await lab.getByRole('button', { name: /AI rehearsal/ }).click();
  await lab.getByRole('button', { name: /^(Run AI role-play|Run again)/ }).click();
  await expect(lab.getByText('Run complete')).toBeVisible({ timeout: 30_000 });
  await expect(lab.getByText('AI approximation')).toBeVisible();
  await lab.getByRole('button', { name: /Salesforce Preview/ }).click();
  await lab.locator('.af-scenario-details > summary').click();
  await lab.getByLabel('Opening message').fill('Wait for cancellation');
  await lab.getByRole('button', { name: /^(Run AI role-play|Run again)/ }).click();
  await expect(lab.getByText('Turn 1 of 2 · Agent replying…')).toBeVisible();
  await lab.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(lab.getByText('Stopped · partial conversation')).toBeVisible();
  await expect(lab.getByText('Criteria met')).toHaveCount(0);
  await page.setViewportSize({ width: 760, height: 900 });
  // Narrow studios show one tool at a time; the compact strip selects view tabs and the host side panel stays closed.
  await expect(studio.locator('.sf-as-body.sf-studio')).toHaveAttribute('data-layout', 'compact');
  const strip = studioPanel(page).getByRole('tablist', { name: 'Studio tools' });
  await expect(strip).toBeVisible();
  expect(await studioPanel(page).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-narrow-light.png'));
  await strip.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(editorTabs(page).getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(preview).toBeVisible();
  await editorTabs(page).getByRole('tab', { name: /^Script/ }).click();
  await expect(frame.locator('.view-lines')).toBeVisible();
  const requests = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')) as Array<{ path: string; body: Record<string, any> }>;
  expect(requests.find(r => r.path.endsWith('/authoring/scripts'))?.body.assets[0].content).toContain('# unsaved studio draft');
  expect(requests.filter(r => r.path.endsWith('/preview/sessions')).every(r => r.body.enableSimulationMode === true)).toBe(true);
  expect(await page.getByTestId('plugin-panel-host-layout').innerText()).not.toMatch(/PRIVATE_CLI_TOKEN|PRIVATE_NAMED_JWT/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTool(studio, 'Org preview');
  const orgPreview = viewPane(page, 'org-preview').getByTestId('salesforce-agentforce-preview');
  await expect(orgPreview.getByRole('heading', { name: 'Try your connected agent' })).toBeVisible();
  await expect(orgPreview.getByRole('log', { name: 'Org preview conversation' })).toBeVisible();
  await orgPreview.getByTestId('salesforce-agentforce-preview-start').click();
  await expect(orgPreview.getByText('Simulate preview started.')).toBeVisible();
  await orgPreview.getByTestId('salesforce-agentforce-preview-input').fill('Long response');
  await orgPreview.getByTestId('salesforce-agentforce-preview-send').click();
  await expect(orgPreview.getByRole('log')).toContainText('END_OF_RESPONSE');
  await orgPreview.getByTestId('salesforce-agentforce-preview-end').click();
  await expect(orgPreview.getByText('Preview ended.')).toBeVisible();
  await editorTabs(page).getByRole('button', { name: 'Close Org preview', exact: true }).click();
  await editorTabs(page).getByRole('tab', { name: /^Script/ }).click();
  await expect(frame.locator('.view-lines')).toBeVisible();
  await expect(studioPanel(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('Thread Agent and Preview panels retain their agent when switching tabs, and a chat card opens the read-only Agent panel', async ({ app, home }) => {
  const page = app.window;
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const threadId = await page.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw Error(project.message);
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Agentforce selection regression\n::sf-agent{path="force-app/Orders.agent"}' })
    });
    const body = await response.json();
    if (!response.ok) throw Error(JSON.stringify(body));
    return body.thread.id as string;
  }, join(home, 'dx'));
  await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  await expect(page.getByTestId('thread-detail')).toBeVisible();
  await page.getByTestId('thread-secondary-show').click();
  const panel = page.getByTestId('thread-secondary-panel');
  await openThreadToolLauncher(panel);
  await panel.getByTestId('thread-new-tab-plugin-salesforce-preview').click();
  const preview = panel.getByTestId('salesforce-agentforce-preview');
  const picker = preview.getByRole('button', { name: 'Agentforce preview file', exact: true });
  await picker.click();
  await page.getByRole('textbox', { name: 'Search agents…', exact: true }).fill('aiAuthoringBundles/Customer');
  await page.getByRole('listbox', { name: 'Agentforce preview file' }).getByRole('option').click();
  await expect(picker).toContainText('Customer_Service_Agent_With_A_Long_Name');

  // The host unmounts Preview here; returning must restore its picker choice.
  await panel.getByTestId('thread-info-pin').click();
  await expect(preview).toHaveCount(0);
  await panel.locator('.thread-secondary-tabs').getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(picker).toContainText('Customer_Service_Agent_With_A_Long_Name');

  // The removed Playground thread panel is no longer offered; the read-only Agent panel is.
  await openThreadToolLauncher(panel);
  await expect(panel.getByTestId('thread-new-tab-plugin-salesforce-playground')).toHaveCount(0);
  for (const gone of ['graph', 'test', 'release', 'org-preview']) await expect(panel.getByTestId(`thread-new-tab-plugin-salesforce-studio-${gone}`)).toHaveCount(0);
  await expect(panel.getByTestId('thread-new-tab-plugin-salesforce-agent')).toBeVisible();
  // Without a path the Agent panel explains how to open an agent instead of rendering an editor.
  await panel.getByTestId('thread-new-tab-plugin-salesforce-agent').click();
  await expect(panel.getByTestId('atp-empty')).toBeVisible();
  await expect(panel.getByRole('alert')).toContainText('Agent Script path');
  // A chat card routes to the thread's Agent panel bound to that agent.
  const card = page.getByTestId('sf-card-agent').last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button').first().click();
  const agent = panel.getByTestId('atp-root');
  await expect(agent).toBeVisible();
  await expect(agent).toContainText('Orders');
  await expect(agent.getByRole('tablist', { name: 'Agent views' })).toBeVisible();
  for (const view of ['file', 'preview', 'tests', 'graph', 'actions', 'comments']) await expect(agent.locator(`#atp-tab-${view}`)).toBeVisible();
  await expect(agent.getByTestId('atp-view-file')).toBeVisible();
  await expect(agent.getByRole('button', { name: /Open in Studio/ })).toBeVisible();
  await expect(agent.locator('textarea, [contenteditable="true"]')).toHaveCount(0);
  await agent.locator('#atp-tab-graph').click();
  await expect(agent.getByTestId('atp-view-graph')).toBeVisible();
  // Switching host tabs keeps the Preview choice and returns to the same agent view.
  await panel.locator('.thread-secondary-tabs').getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(picker).toContainText('Customer_Service_Agent_With_A_Long_Name');
  // The card opened its own host tab labelled with the agent; the empty Agent tab stays beside it.
  await expect(panel.locator('.thread-secondary-tabs').getByRole('button', { name: 'Agent', exact: true })).toBeVisible();
  await panel.locator('.thread-secondary-tabs').getByRole('button', { name: 'Orders', exact: true }).click();
  // The host unmounts the panel on a tab switch; the agent binding (tab params) survives, the chosen view does not.
  await expect(agent).toContainText('Orders');
  await expect(agent.getByRole('tablist', { name: 'Agent views' })).toBeVisible();
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
  // Org preview is a view of the open agent, so open one first; its own picker still reaches every agent.
  await showAllAgents(studio);
  await studio.getByTestId(`salesforce-agent-script-file:${toolbarFile}`).click();
  await openTool(studio, 'Org preview');
  const preview = viewPane(page, 'org-preview').getByTestId('salesforce-agentforce-preview');
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
      // The preview fills its view tab without spilling past the Studio.
      expect((await preview.boundingBox())!.width).toBeLessThanOrEqual((await studioPanel(page).boundingBox())!.width);
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

test('Preview context: Context tab, setup, typed snapshots and restart work in both preview surfaces', async ({ app, home }, testInfo) => {
  const contextSource = `variables:
    sessionId: linked string
        source: @MessagingSession.Id
        label: "Session"
    verified: mutable boolean = False
        visibility: "External"
    retryCount: mutable number = 0
        visibility: "External"
${['accountId', 'accountName', 'currentObjectApiName', 'currentRecordId', 'opportunityId', 'quoteId', 'customerLocale'].map(name => `    ${name}: mutable string
        visibility: "External"
        description: "Use the value supplied by the customer or the current record. Leave unset to use the runtime default."
`).join('')}`;
  writeFileSync(join(home, 'dx', toolbarFile), `${AGENT_SCRIPT_EXAMPLES[0].source}\n${contextSource}`);
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
  await showAllAgents(studio);
  await studio.getByTestId(`salesforce-agent-script-file:${toolbarFile}`).click();
  await openTool(studio, 'Preview');
  const workbench = viewPane(page, 'preview').getByTestId('preview-workbench');
  await workbench.getByRole('tab', { name: 'Context 0', exact: true }).click();
  await expect(workbench.getByRole('checkbox', { name: 'Set Session', exact: true })).toBeVisible();
  await expect(workbench.getByRole('region', { name: 'Agent variables' })).toBeVisible();
  await expect(workbench.getByRole('region', { name: 'Session context' })).toBeVisible();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-context-defaults.png'));
  await workbench.getByRole('button', { name: '+ Add variable', exact: true }).click();
  await expect(workbench.getByLabel('Variable name', { exact: true })).toBeFocused();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-context-add.png'));
  await workbench.getByRole('button', { name: 'Cancel adding variable', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(workbench.getByLabel('Variable name', { exact: true })).toBeHidden();
  await workbench.getByLabel('Session value', { exact: true }).fill('context-e2e-session');
  await expect(workbench.getByRole('checkbox', { name: 'Set Session', exact: true })).toBeChecked();
  await workbench.getByLabel('verified value', { exact: true }).selectOption('false');
  await workbench.getByLabel('retryCount value', { exact: true }).fill('0');
  // Real RPC + isolated SQLite persistence; validation never sends a partial context.
  await expect(workbench.getByLabel('Context preset', { exact: true })).toBeEnabled();
  await workbench.getByRole('button', { name: 'Save as…', exact: true }).click();
  await workbench.getByLabel('Preset name', { exact: true }).fill('Unverified customer');
  await workbench.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(workbench.getByLabel('Preset name', { exact: true })).toBeHidden();
  const presetId = await workbench.getByLabel('Context preset', { exact: true }).inputValue();
  await workbench.getByLabel('retryCount value', { exact: true }).fill('-');
  await workbench.getByLabel('Session value', { exact: true }).focus();
  await expect(workbench.getByRole('alert')).toContainText('Enter a number');
  await expect(workbench.getByRole('button', { name: 'Save as…', exact: true })).toBeDisabled();
  await workbench.getByTestId('pw-start').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Start preview', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await workbench.getByLabel('Context preset', { exact: true }).selectOption('');
  await expect(workbench.getByLabel('retryCount value', { exact: true })).toHaveValue('');
  await workbench.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(workbench.getByLabel('retryCount value', { exact: true })).toHaveValue('-');
  await workbench.getByLabel('Context preset', { exact: true }).selectOption(presetId);
  await expect(workbench.getByLabel('retryCount value', { exact: true })).toHaveValue('0');
  await expect(workbench.getByRole('alert')).toHaveCount(0);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-context-preset.png'));

  await workbench.getByLabel('Options for Session', { exact: true }).click();
  await expect(workbench.getByRole('button', { name: 'Set Session to null', exact: true })).toBeVisible();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-context-options.png'));
  await page.keyboard.press('Escape');
  await expect(workbench.getByRole('button', { name: 'Set Session to null', exact: true })).toBeHidden();
  await workbench.getByTestId('pw-start').click();
  const setup = page.getByRole('dialog', { name: 'Start a conversation' });
  await expect(setup).toBeVisible();
  // The dim must sit above the whole window (sidebar + titlebar), not just the plugin panel.
  const probes = await page.evaluate(() => [[12, 300], [window.innerWidth - 12, 12]].map(([x, y]) => document.elementFromPoint(x, y)?.closest('.sf-context-backdrop') !== null));
  expect(probes).toEqual([true, true]);
  const setupGeometry = await setup.evaluate(el => {
    const bounds = el.getBoundingClientRect(), body = el.querySelector('.sf-context-dialog-body')!, footer = el.querySelector('footer')!.getBoundingClientRect();
    return { width: bounds.width, top: bounds.top, bottom: bounds.bottom, viewport: innerHeight, viewportWidth: innerWidth, scrolls: body.scrollHeight > body.clientHeight, footerBottom: footer.bottom, overflow: el.scrollWidth - el.clientWidth };
  });
  expect(setupGeometry.width).toBeGreaterThan(Math.min(900, setupGeometry.viewportWidth - 80));
  expect(setupGeometry.top).toBeGreaterThanOrEqual(16);
  expect(setupGeometry.bottom).toBeLessThanOrEqual(setupGeometry.viewport - 16);
  expect(setupGeometry.scrolls).toBe(true);
  expect(setupGeometry.overflow).toBeLessThanOrEqual(1);
  await setup.locator('.sf-context-dialog-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(setup.getByRole('button', { name: 'Start preview', exact: true })).toBeInViewport();
  await expect(setup.getByRole('heading', { name: 'Start a conversation' })).toBeInViewport();
  await setup.locator('.sf-context-dialog-body').evaluate(el => { el.scrollTop = 0; });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`preview-context-setup-${theme}.png`));
  }
  const setupSize = await app.electron.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; const size = win.getSize(), minimum = win.getMinimumSize(); win.setMinimumSize(400, 400); win.setSize(620, 650); return { size, minimum }; });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(700);
  const variableLayout = await setup.locator('.sf-context-field').first().evaluate(el => { const label = el.querySelector('.sf-context-field-head')!.getBoundingClientRect(), value = el.querySelector('.sf-context-value')!.getBoundingClientRect(); return { labelBottom: label.bottom, valueTop: value.top }; });
  expect(variableLayout.valueTop).toBeGreaterThanOrEqual(variableLayout.labelBottom);
  await expect(setup.getByRole('button', { name: 'Start preview', exact: true })).toBeInViewport();
  expect(await setup.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-context-setup-narrow.png'));
  await app.electron.evaluate(({ BrowserWindow }, saved) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(saved.minimum[0], saved.minimum[1]); win.setSize(saved.size[0], saved.size[1]); }, setupSize);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-context-setup.png'));
  await setup.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(existsSync(join(home, 'sfap-requests.json')) && readFileSync(join(home, 'sfap-requests.json'), 'utf8').includes('/preview/sessions')).toBe(false);
  await workbench.getByTestId('pw-start').click();
  await setup.getByRole('button', { name: 'Start preview', exact: true }).click();
  await expect(workbench.getByRole('log')).toContainText('support concierge');
  await workbench.getByRole('tab', { name: 'Context 3', exact: true }).click();
  await workbench.getByLabel('Session value', { exact: true }).fill('next-session');
  await expect(workbench.getByText(/keeps its original context/)).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    expect(await workbench.locator('.sf-context-editor').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`preview-context-${theme}.png`));
  }
  const originalSize = await app.electron.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; const size = window.getSize(); window.setSize(900, 850); return size;
  });
  await expect(workbench.getByLabel('Session value', { exact: true })).toBeVisible();
  expect(await workbench.locator('.sf-context-editor').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-context-narrow.png'));
  await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), originalSize);
  await workbench.getByRole('button', { name: 'Review & restart', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restart preview', exact: true }).click();
  await expect(workbench.getByRole('log')).toContainText('support concierge');
  await workbench.getByRole('button', { name: 'End', exact: true }).click();
  // Exercise the real Electron child-process boundary too. Only this private fixture CLI runs.
  const saved = readFileSync(join(home, 'dx', toolbarFile), 'utf8');
  writeFileSync(join(home, 'dx', toolbarFile), saved.replace('config:\n', 'config:\n    default_agent_user: "fixture@example.com"\n'));
  await workbench.getByRole('button', { name: 'Live', exact: true }).click();
  await workbench.getByTestId('pw-start').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start preview', exact: true }).click();
  await expect(workbench.getByRole('button', { name: 'End', exact: true })).toBeVisible();
  await workbench.getByLabel('Preview message', { exact: true }).fill('Large fixture response');
  await workbench.getByRole('button', { name: 'Send preview message', exact: true }).click();
  await expect(workbench.getByRole('log')).toContainText('CLI_END_OF_RESPONSE');
  await workbench.getByRole('button', { name: 'End', exact: true }).click();
  await openTool(studio, 'Org preview');
  const orgPreview = viewPane(page, 'org-preview').getByTestId('salesforce-agentforce-preview');
  await orgPreview.getByTestId('salesforce-agentforce-preview-start').click();
  const orgSetup = page.getByRole('dialog');
  await expect(orgSetup).toBeVisible();
  await expect(orgSetup.getByRole('option', { name: 'Unverified customer', exact: true })).toBeAttached();
  await orgSetup.getByLabel('Context preset', { exact: true }).selectOption(presetId);
  await expect(orgSetup.getByLabel('retryCount value', { exact: true })).toHaveValue('0');
  await orgSetup.getByLabel('Context preset', { exact: true }).selectOption('');

  const verified = orgSetup.getByRole('checkbox', { name: 'Set verified', exact: true });
  // The native checkbox covers its visible label. A 1px hidden control can
  // round below Chromium's clickable-area threshold on Linux or at zoom.
  const hitArea = await verified.evaluate(input => {
    const control = input.getBoundingClientRect();
    const label = input.closest('label')!.getBoundingClientRect();
    return { width: control.width, height: control.height, labelWidth: label.width, labelHeight: label.height };
  });
  expect(hitArea.width).toBeGreaterThanOrEqual(hitArea.labelWidth - 1);
  expect(hitArea.height).toBeGreaterThanOrEqual(hitArea.labelHeight - 1);
  await verified.check();
  await orgSetup.getByRole('button', { name: 'Start preview', exact: true }).click();
  await expect(orgPreview.getByRole('log')).toContainText('support concierge');
  await orgPreview.getByTestId('salesforce-agentforce-preview-end').click();
  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await tests.getByRole('group', { name: 'Tests view' }).getByRole('button', { name: 'Role-play' }).click();
  const lab = tests.getByTestId('agentforce-lab');
  await lab.locator('.af-context-details > summary').click();
  await expect(lab.getByLabel('Context preset', { exact: true })).toBeEnabled();
  await lab.getByLabel('Context preset', { exact: true }).selectOption(presetId);
  await lab.getByLabel('retryCount value', { exact: true }).fill('-');
  await lab.getByLabel('Session value', { exact: true }).focus();
  await expect(lab.getByRole('alert')).toContainText('Enter a number');
  await expect(lab.getByRole('button', { name: 'Run AI role-play', exact: true })).toBeDisabled();
  await lab.getByLabel('Context preset', { exact: true }).selectOption(presetId);
  await lab.getByLabel('Conversation budget').selectOption('1');
  expect(await lab.locator('.sf-context-editor').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  // Shared editor controls keep their own layout inside role-play's scenario form.
  expect(await lab.getByLabel('Set verified', { exact: true }).evaluate(el => getComputedStyle(el).position)).toBe('absolute');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('roleplay-initial-variables.png'));
  await lab.getByRole('button', { name: 'Run AI role-play', exact: true }).click();
  await expect(lab.getByText('Run complete')).toBeVisible({ timeout: 30_000 });
  await lab.getByLabel('retryCount value', { exact: true }).fill('7');
  await lab.getByRole('button', { name: 'Save as test case', exact: true }).click();
  await expect(lab.getByText(/Saved “Role-play/)).toBeVisible();
  const roleplayCase = JSON.parse(readFileSync(join(home, 'dx/tests', toolbarFile.split('/').at(-1)!.replace('.agent', '.scenario.json')), 'utf8')).cases.at(-1);
  expect(roleplayCase.contextVariables).toEqual([{ name: '$Context.sessionId', type: 'Text', value: 'context-e2e-session' }, { name: 'verified', type: 'Boolean', value: false }, { name: 'retryCount', type: 'Number', value: 0 }]);
  const requests = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')) as Array<{ path: string; body: Record<string, any> }>;
  const starts = requests.filter(r => r.path.endsWith('/preview/sessions'));
  expect(starts).toHaveLength(4);
  expect(starts[0]!.body.variables).toEqual([{ name: '$Context.sessionId', type: 'Text', value: 'context-e2e-session' }, { name: 'verified', type: 'Boolean', value: false }, { name: 'retryCount', type: 'Number', value: 0 }]);
  expect(starts[1]!.body.variables[0].value).toBe('next-session');
  expect(starts[2]!.body.variables).toEqual([{ name: 'verified', type: 'Boolean', value: false }]);
  expect(starts[3]!.body.variables).toEqual(starts[0]!.body.variables);
  expect(starts.every(r => r.body.enableSimulationMode === true)).toBe(true);
  const cliCalls = readFileSync(join(home, 'agent-cli.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(cliCalls.map(call => call.args.slice(0, 3))).toEqual([['agent', 'preview', 'start'], ['agent', 'preview', 'send'], ['agent', 'preview', 'end']]);
  expect(cliCalls.every(call => realpathSync(call.cwd) === realpathSync(join(home, 'dx')) && realpathSync(call.home) === realpathSync(home))).toBe(true);
  const startArgs: string[] = cliCalls[0].args;
  expect(JSON.parse(startArgs[startArgs.indexOf('--context-variables-json') + 1]!)).toEqual(starts[1]!.body.variables);
  expect(cliCalls.slice(1).every(call => !call.args.includes('--context-variables-json'))).toBe(true);
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
  const preview = viewPane(page, 'preview').getByTestId('preview-workbench');
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
  await showScript(page);
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
  await showScript(page);
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
  await viewPane(page, 'graph').frameLocator('iframe[title="AgentScript graph"]').getByRole('button', { name: 'Inspect refund', exact: true }).click();
  await showScript(page);
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
  // View tabs: right-click offers bulk close; Close others keeps the clicked tab and the agent's Script.
  const openFiles = editorTabs(page);
  const graphTab = openFiles.getByRole('tab', { name: 'Graph', exact: true });
  await expect(graphTab).toBeVisible();
  expect(await openFiles.getByRole('tab').count()).toBeGreaterThan(2);
  await graphTab.click({ button: 'right' });
  const tabMenu = studioPanel(page).getByRole('menu', { name: 'Graph tab actions' });
  await expect(tabMenu.getByRole('menuitem')).toHaveText(['Close', 'Close others', 'Close to the right', 'Close all']);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('editor-tab-menu.png'));
  await page.keyboard.press('Escape');
  await expect(tabMenu).toHaveCount(0);
  // Each agent keeps its own view tabs: another agent opens on its Script alone, and switching back restores Graph.
  await showAllAgents(studio);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await expect(agentTabs(page).getByRole('tab', { name: /Support/ })).toHaveAttribute('aria-selected', 'true');
  await expect(graphTab).toHaveCount(0);
  await agentTabs(page).getByRole('tab', { name: /Orders/ }).click();
  await expect(graphTab).toBeVisible();
  await graphTab.click({ button: 'right' });
  await tabMenu.getByRole('menuitem', { name: 'Close others' }).click();
  await expect(openFiles.getByRole('tab')).toHaveCount(2);
  await expect(openFiles.getByRole('tab', { name: /^Script/ })).toBeVisible();
  await expect(graphTab).toHaveAttribute('aria-selected', 'true');
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
  await page.getByRole('dialog', { name: 'Expanded Flow' }).getByRole('button', { name: 'Reset Flow view', exact: true }).click();
  await expect(flow.getByText('Each order item', { exact: true })).toBeVisible();
  await expect.poll(() => flow.locator('div[style*="will-change: transform"]').evaluate(el => {
    const diagram = el.getBoundingClientRect(), canvas = el.parentElement!.getBoundingClientRect();
    return diagram.left >= canvas.left - 2 && diagram.right <= canvas.right + 2
      && diagram.top >= canvas.top - 2 && diagram.bottom <= canvas.bottom + 2;
  }), { timeout: 10_000 }).toBe(true);
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
  await expect(view.getByRole('button', { name: 'Typed', exact: true })).toBeVisible();
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
  // Hiding the focused explorer button leaves focus on the document body.
  // The focused tool owns its shortcut before the app's global project-view shortcut.
  await studio.locator('.sf-as-body.sf-studio').press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
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
  // The retrieved agent opens in its own tab; the Org agents tab keeps the result.
  const files = studio.getByRole('tablist', { name: 'Open files' });
  const retrievedAgent = agentTabs(page).getByRole('tab', { name: /Support_v1\.agent/ });
  const script = files.getByRole('tab', { name: /^Script/ });
  await expect(retrievedAgent).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  await expect(script).toHaveAttribute('aria-selected', 'true');
  await files.getByRole('tab', { name: /Org agents/ }).click();
  await expect(agents.getByRole('status')).toContainText('Retrieved to your project');
  await script.click();
  const imported = join(home, 'dx', 'agentforce', '00D000000000001', 'Support_v1', 'Support_v1.agent');
  expect(readFileSync(imported, 'utf8')).toContain('ORG_AGENT_SOURCE_COMPLETE');
  expect(readFileSync(imported.replace('.agent', '.bundle-meta.xml'), 'utf8')).toContain('Support.v1');
  await editor.locator('.monaco-editor').click({ position: { x: 160, y: 45 } });
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n# MY_LOCAL_AGENT_EDIT');
  await studio.getByRole('button', { name: 'Save Agentforce file' }).click();
  await expect.poll(() => readFileSync(imported, 'utf8')).toContain('MY_LOCAL_AGENT_EDIT');
  await files.getByRole('tab', { name: /Org agents/ }).click();
  await retrieveOrgAgent(agents, 'Support');
  await expect(retrievedAgent).toHaveAttribute('aria-selected', 'true');
  await expect(agentTabs(page).getByRole('tab')).toHaveCount(1);
  await expect(script).toHaveAttribute('aria-selected', 'true');
  await files.getByRole('tab', { name: /Org agents/ }).click();
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

test('Agentforce graph: hovering keeps nodes visible and the viewport still', async ({ app, home }, testInfo) => {
  const page = app.window;
  const installed = await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }));
  expect(installed, JSON.stringify(installed)).toMatchObject({ ok: true });
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
  await studio.getByTestId('salesforce-agent-script-file:force-app/Orders.agent').click();
  await openTool(studio, 'Graph view');
  const graph = viewPane(page, 'graph').frameLocator('iframe[title="AgentScript graph"]');
  const nodes = graph.locator('.react-flow__node');
  await expect(nodes).toHaveCount(5);
  const settleGraph = () => graph.locator('.react-flow').evaluate(root => new Promise<void>((resolve, reject) => {
    let previous = ''; let stableFrames = 0; let stableSince = performance.now(); let frame = 0;
    const finish = (error?: Error) => {
      cancelAnimationFrame(frame);
      clearTimeout(deadline);
      if (error) reject(error); else resolve();
    };
    const deadline = window.setTimeout(() => finish(new Error('Graph layout did not settle before the hover check')), 10_000);
    const sample = () => {
      const bounds = root.getBoundingClientRect();
      const current = `${bounds.width}:${bounds.height}:${root.querySelector('.react-flow__viewport')?.getAttribute('style')}`;
      stableFrames = current === previous ? stableFrames + 1 : 0;
      if (current !== previous) stableSince = performance.now();
      previous = current;
      // Xvfb renders at about 1 Hz. Require two rendered frames and a stable
      // observation window, rather than turning 20 frames into a 20-second wait.
      if (stableFrames >= 1 && performance.now() - stableSince >= 350) finish();
      else frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
  }));
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await expect(graph.getByTestId('agent-script-graph')).toHaveClass(new RegExp(theme));
    for (const width of [1800, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      // ResizeObserver and the initial fit run asynchronously. Establish the hover
      // baseline only after resizing and the explicit fit have both completed.
      await settleGraph();
      await graph.getByRole('button', { name: 'Fit View', exact: true }).click();
      await settleGraph();
      // Observe every style mutation, including flashes too brief for toBeVisible() polling to catch.
      await nodes.first().evaluate(() => {
        const state = window as typeof window & { hiddenNodes: string[]; removedEdges: number; hoverObserver?: MutationObserver };
        state.hoverObserver?.disconnect();
        state.hiddenNodes = [];
        state.removedEdges = 0;
        state.hoverObserver = new MutationObserver(records => {
          for (const record of records) {
            const el = record.target as HTMLElement;
            if (el.matches('.react-flow__node') && (el.style.visibility === 'hidden' || record.oldValue?.includes('visibility: hidden'))) state.hiddenNodes.push(el.dataset.id!);
            for (const removed of record.removedNodes) if (removed instanceof Element && removed.matches('.react-flow__edge')) state.removedEdges++;
          }
        });
        state.hoverObserver.observe(document.querySelector('.react-flow__viewport')!, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true, childList: true });
      });
      const viewport = graph.locator('.react-flow__viewport');
      const transform = await viewport.getAttribute('style');
      for (const index of [0, 2, 4]) {
        await nodes.nth(index).hover();
        // Keep a stationary pointer through rendered frames and the observation
        // window; the observer captures every visibility mutation between them.
        await settleGraph();
        await expect(nodes.nth(index).locator('.as-node')).toHaveClass(/is-hot/);
        expect(await nodes.first().evaluate(() => (window as typeof window & { hiddenNodes: string[] }).hiddenNodes)).toEqual([]);
        expect(await nodes.first().evaluate(() => (window as typeof window & { removedEdges: number }).removedEdges)).toBe(0);
        await expect(viewport).toHaveAttribute('style', transform!);
        await graph.locator('.pane-header').hover({ position: { x: 10, y: 10 } });
        await expect(graph.locator('.as-node.is-hot, .as-node.is-dim')).toHaveCount(0);
        expect(await nodes.first().evaluate(() => (window as typeof window & { hiddenNodes: string[] }).hiddenNodes)).toEqual([]);
      }
    }
  }
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('graph-hover-stable.png'));
});

test('Agentforce Studio: no-file entry points reach org agents, an explorer org agent opens, and the empty graph reads as one hint', async ({ app, home }, testInfo) => {
  writeFileSync(join(home, 'dx', 'force-app', 'Empty.agent'), 'config:\n    agent_name: "Empty"\n');
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
  // Org agents pick what to edit, so they open as an editor tab instead of a side-panel tool.
  const agentsTab = studio.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /Org agents/ });
  const openAgents = () => studio.getByRole('button', { name: 'Browse org agents', exact: true }).click();
  const search = studio.getByRole('region', { name: 'Org agents' }).getByRole('textbox', { name: 'Search org agents' });

  // The empty state's actions sit with its message instead of floating far below it.
  const message = await noFile.locator('.sf-state-hint').boundingBox();
  const openOrgAgents = noFile.getByRole('button', { name: 'Open org agents', exact: true });
  expect((await openOrgAgents.boundingBox())!.y - (message!.y + message!.height)).toBeLessThan(48);
  await openOrgAgents.click();
  await expect(agentsTab).toHaveAttribute('aria-selected', 'true');
  await expect(search).toBeFocused();

  // Views belong to an agent: with none open, the agent bar's view buttons are disabled.
  for (const name of ['Graph', 'Preview', 'Tests']) await expect(studio.getByRole('button', { name: `Open ${name} view`, exact: true })).toBeDisabled();

  // An empty graph is a single readable hint, not one row per text run and code chip.
  await studio.getByTestId('salesforce-agent-script-file:force-app/Empty.agent').click();
  await openTool(studio, 'Graph view');
  const hint = viewPane(page, 'graph').frameLocator('iframe[title="AgentScript graph"]').locator('.graph-empty');
  await expect(hint).toContainText('No topics defined. Add a start_agent or topic in the Script view.');
  expect(await hint.evaluate(el => [...el.childNodes].map(node => node.nodeName))).toEqual(['P']);
  expect((await hint.locator('p').boundingBox())!.height).toBeLessThan(80);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('empty-graph-hint.png'));
  // Closing the only agent leaves no agent open.
  await agentTabs(page).getByRole('button', { name: /^Close agent Empty\.agent/ }).click();
  await expect(agentTabs(page).getByRole('tab')).toHaveCount(0);
  // The side panel's New Tab lists only Actions and Comments; views and org agents are Studio tabs.
  await showSidePanel(page);
  await openThreadToolLauncher(sidePanel(page));
  await expect(sidePanel(page).getByTestId('thread-new-tab-plugin-salesforce-studio-actions')).toBeVisible();
  await expect(sidePanel(page).getByTestId('thread-new-tab-plugin-salesforce-studio-comments')).toBeVisible();
  for (const gone of ['graph', 'preview', 'test', 'release', 'org-preview', 'agents']) await expect(sidePanel(page).getByTestId(`thread-new-tab-plugin-salesforce-studio-${gone}`)).toHaveCount(0);

  // The explorer link switches back to Org agents, and re-asking while it is already open still lands focus in its search.
  const explorer = studio.getByTestId('salesforce-agent-script-explorer');
  // No local file matches, so the project section offers the org instead, next to the matching org agent row.
  await explorer.getByRole('textbox', { name: 'Filter Agentforce files' }).fill('Agent_0');
  const browse = explorer.getByRole('button', { name: 'Browse agents in your org', exact: true });
  await browse.click();
  await expect(agentsTab).toHaveAttribute('aria-selected', 'true');
  await expect(search).toBeFocused();
  await search.blur();
  await expect(search).not.toBeFocused();
  await browse.click();
  await expect(search).toBeFocused();

  // An org agent row retrieves and opens that agent rather than only showing the list.
  // The explorer only links to the org; the Org agents tab lists them and retrieves them per row.
  await expect(explorer.getByTestId('sf-explorer-org-agent')).toHaveCount(0);
  // With no agent open there is no document bar (and so no Browse org agents button); the explorer link reaches the list.
  await browse.click();
  await expect(agentsTab).toHaveAttribute('aria-selected', 'true');
  await search.fill('Agent_0');
  await retrieveOrgAgent(studio.getByRole('region', { name: 'Org agents' }), 'Agent_0');
  await expect(studio.locator('.af-document-name')).toHaveText('Agent_0_v1.agent', { timeout: 30_000 });
  await expect(noFile).toBeHidden();
  const retrievals = readFileSync(join(home, 'agent-retrievals.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(retrievals.map(row => row.args.join(' '))).toEqual([expect.stringContaining('AiAuthoringBundle:Agent_0_v1')]);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('explorer-org-agent-opened.png'));

  // Reopening a closed Agents tab starts clean instead of replaying the last request.
  await agentsTab.click();
  await studio.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Close Org agents', exact: true }).click();
  await expect(agentsTab).toHaveCount(0);
  await openAgents();
  await expect(studio.getByRole('region', { name: 'Org agents' }).getByText('Z Last', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(search).toHaveValue('');
  await expect(studio.getByRole('region', { name: 'Org agents' }).getByRole('status')).toHaveCount(0);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('org-agents-editor-tab.png'));
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
  // A new draft has no default_agent_user, so its preview runs on the Preview API, not `sf agent preview`.
  const preview = await agent({ action: 'preview.start', path: created.file.path });
  expect(preview).toMatchObject({ ok: true, data: { sessionId: expect.any(String) } });
  expect(preview.data.sessionId).not.toBe('cli-preview');
  expect(await agent({ action: 'preview.end', sessionId: preview.data.sessionId })).toMatchObject({ ok: true });
  const specPath = 'agentforce-drafts/evals.json';
  writeFileSync(join(projectRoot, specPath), JSON.stringify({ tests: [{ utterance: 'Hello' }] }));
  expect(await agent({ action: 'eval.run', specPath })).toMatchObject({ ok: true, data: { passed: true } });
  expect(await agent({ action: 'lifecycle.publish', path: created.file.path })).toMatchObject({ ok: false, code: 'refused' });
  const cliCalls = readFileSync(join(home, 'agent-cli.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(cliCalls.some(call => call.args[1] === 'publish')).toBe(false);
  // The draft's preview went through the Preview API, so `sf agent preview` never ran.
  expect(cliCalls.some(call => call.args[1] === 'preview')).toBe(false);
  for (const verb of ['validate', 'test']) {
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
  // Graph is a view tab of the open agent, so the command selects that tab rather than adding a side-panel tool.
  expect(await command(agentView, 'panel.open', { tool: 'graph' })).toMatchObject({ ok: true });
  await expect(editorTabs(page).getByRole('tab', { name: 'Graph', exact: true })).toHaveAttribute('aria-selected', 'true');
  await showScript(page);
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
  // Graph no longer opens a host tool, so the panel may already be closed.
  if (await sidePanel(page).isVisible()) await sidePanel(page).getByTestId('thread-secondary-hide').click();
  await expect(sidePanel(page)).toBeHidden();
  const query = await action('query.execute', { query: 'SELECT Id, Name FROM Account LIMIT 1' });
  expect(query).toMatchObject({ ok: true, resultId: expect.any(String) });
  expect(await command(await view('workbench'), 'view.open', { view: 'data' })).toMatchObject({ ok: true, viewState: { view: 'data' } });
  expect(await command(await view('data'), 'query.show', { resultId: query.resultId })).toMatchObject({ ok: true, viewState: { rows: 1 } });
  await expect(page.getByRole('cell', { name: 'Workbench result account', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Agentforce Release RPC: a Zana-drawn sheet approves Publish and Activate; cancel, forged and replayed tokens change nothing', async ({ app, home }, testInfo) => {
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

  // The Release tool and Publish entry are gone from the UI; the host-drawn approval and its token security stay on the RPC.
  await expect(studio.getByTestId('studio-release-pane')).toHaveCount(0);
  await expect(studio.getByTestId('salesforce-agent-script-publish')).toHaveCount(0);
  const revision = createHash('sha256').update(readFileSync(join(home, 'dx', toolbarFile), 'utf8')).digest('hex');
  const binding = { action: 'agent.publish', target: '00D000000000001', targetLabel: 'studio (sandbox)', subject: apiName, revision };
  const runArgs = { projectId, path: toolbarFile, action: 'agent.publish' };
  const prepare = (args: Record<string, unknown>) => page.evaluate(a => window.cc.pluginApps.callRpc('salesforce', 'release.prepare', a), args) as Promise<{ ok: boolean; data: { request: object } }>;
  const request = (req: object) => page.evaluate(r => window.cc.pluginApprovals.request({ ...(r as object), pluginId: 'salesforce' } as never), req);

  // A token the host did not sign never reaches the CLI.
  expect(await page.evaluate(args => window.cc.pluginApps.callRpc('salesforce', 'release.run', { ...args, token: 'forged.token' }), runArgs))
    .toMatchObject({ ok: false, code: 'approval_invalid' });
  expect(cliCalls('publish')).toHaveLength(0);

  // Approve: the sheet shows the exact source revision and org, then one publish runs in the DX project.
  const prepared = await prepare(runArgs);
  expect(prepared).toMatchObject({ ok: true, data: { request: { binding } } });
  const pending = request(prepared.data.request);
  await expect.poll(sheetText).toContain(`Publish ${apiName}`);
  const text = await sheetText();
  expect(text).toContain('studio (sandbox)');
  expect(text).toContain(revision.slice(0, 12));
  expect(text).toMatch(/asks for approval/i);
  expect(await sheet('typeof window.cc + typeof require + typeof process')).toBe('undefinedundefinedundefined');
  expect(await sheetWindow()).toMatchObject({ modal: true, parent: expect.any(String) });
  // A second request while a sheet is open is refused as busy.
  expect(await page.evaluate(b => window.cc.pluginApprovals.request({ pluginId: 'salesforce', binding: b, title: 'Second sheet' }), binding))
    .toEqual({ approved: false, reason: 'busy' });
  // Capture the modal itself; macOS can suspend captures of its blocked parent.
  const sheetPng = await app.electron.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === 'Zana approval');
    return win ? (await win.webContents.capturePage()).toPNG().toString('base64') : '';
  });
  expect(sheetPng).not.toBe('');
  writeFileSync(testInfo.outputPath('release-approval-sheet.png'), Buffer.from(sheetPng, 'base64'));
  await press('approve');
  const signed = await pending as { approved: true; token: string };
  expect(signed).toMatchObject({ approved: true, token: expect.any(String) });
  await expect.poll(sheetWindow).toBeNull();

  // A signed token is single use, and only fits the action it was signed for.
  const run = (extra: Record<string, unknown>) => page.evaluate(args => window.cc.pluginApps.callRpc('salesforce', 'release.run', args), { ...runArgs, token: signed.token, ...extra });
  expect(await run({ action: 'agent.activate', versionNumber: 7 })).toMatchObject({ ok: false, code: 'approval_invalid' });
  expect(cliCalls('activate')).toHaveLength(0);
  expect(await run({})).toMatchObject({ ok: true, summary: `Published inactive version of ${apiName}` });
  expect(cliCalls('publish')).toEqual([expect.objectContaining({ cwd: dx, args: expect.arrayContaining(['--api-name', apiName, '--target-org', 'studio']) })]);
  expect(await run({})).toMatchObject({ ok: false, code: 'approval_invalid' });
  expect(cliCalls('publish')).toHaveLength(1);

  // Cancel changes nothing.
  const cancelled = request((await prepare(runArgs)).data.request);
  await expect.poll(sheetText).toContain(`Publish ${apiName}`);
  await press('cancel');
  expect(await cancelled).toMatchObject({ approved: false });
  await expect.poll(sheetWindow).toBeNull();
  expect(cliCalls('publish')).toHaveLength(1);

  // A plugin that is not installed gets no sheet at all.
  expect(await page.evaluate(b => window.cc.pluginApprovals.request({ pluginId: 'not-installed', binding: b, title: 'Publish' }), binding))
    .toEqual({ approved: false, reason: 'invalid' });
  await expect.poll(sheetWindow).toBeNull();

  // Activate names the version and says it is untested on this sandbox.
  const activateArgs = { projectId, path: toolbarFile, action: 'agent.activate', versionNumber: 7 };
  const activating = request((await prepare(activateArgs)).data.request);
  await expect.poll(sheetText).toContain(`Activate ${apiName} v7`);
  expect(await sheetText()).toContain('No eval evidence for this version. Activating it is untested.');
  await press('approve');
  const activation = await activating as { approved: true; token: string };
  expect(await page.evaluate(args => window.cc.pluginApps.callRpc('salesforce', 'release.run', args), { ...activateArgs, token: activation.token }))
    .toMatchObject({ ok: true });
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
  // Org browsing can stay in the explorer; hide a host panel only if it opened.
  if (await sidePanel(page).isVisible()) await sidePanel(page).getByTestId('thread-secondary-hide').click();
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
  // The roster is cached until sign-in or Refresh, so drop it, then do a real
  // project-scoped refresh without editing shared settings.
  await page.evaluate(id => window.cc.pluginApps.callRpc('salesforce', 'orgs', { refresh: true, projectId: id }), projectId);
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
    // Org agents open in Studio itself, so no side panel covers the narrow page.
    await expect(sidePanel(page)).toBeHidden();
    await workbench.getByRole('tab', { name: 'Data', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Run a query to see records.' })).toBeVisible();
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath('salesforce-data-empty-light.png'));
    expect(errors).toEqual([]);
  } finally { releaseEditor(); writeFileSync(metadataState, 'empty'); }
});

test('Agentforce Studio: Org tests list Testing Center definitions, run one in the org and import its failures', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = [];
  // A recorded demo pauses between steps so each one can be followed.
  const beat = () => process.env.ZCC_E2E_RECORD_VIDEO ? page.waitForTimeout(1500) : Promise.resolve();
  page.on('pageerror', e => errors.push(e.message));
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
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await expect(studio.getByTestId('salesforce-agent-script-no-file')).toHaveCount(0);
  await beat();

  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await tests.getByRole('group', { name: 'Tests view' }).getByRole('button', { name: 'Test catalogue' }).click();
  const view = tests.getByTestId('org-tests-view');
  const table = view.getByTestId('org-tests-table');
  // One retrieve reads each definition's agent and label: Support.agent is open, so the list shows its test only.
  // No run yet, so no "0 with runs": the org cannot list runs, and the detail says so.
  await expect(table.getByTestId('org-tests-scope')).toHaveText('Support· 1 test');
  await expect(table.getByRole('button', { name: 'Support regression', exact: true })).toBeVisible();
  await expect(view.getByTestId('org-def-Support_Regression')).toContainText('3 cases');
  await expect(table.getByTestId('org-def-Billing_Smoke')).toHaveCount(0);
  await beat();
  // Every agent, grouped: Support's group is pinned and open, Billing's opens on a click.
  await table.getByRole('button', { name: 'Show all agents' }).click();
  await expect(table.getByTestId('org-tests-group-support')).toContainText('open in Studio');
  await table.getByRole('button', { name: /^Billing/ }).click();
  await expect(table.getByRole('button', { name: 'Billing smoke', exact: true })).toBeVisible();
  await beat();
  await view.getByLabel('Filter tests').fill('billing');
  await expect(table.getByRole('button', { name: 'Support regression', exact: true })).toHaveCount(0);
  await beat();
  await view.getByLabel('Filter tests').fill('');
  await view.getByRole('group', { name: 'Scope' }).getByRole('button', { name: 'This agent' }).click();

  // The definition's cases, read from the retrieved AiEvaluationDefinition.
  await table.getByRole('button', { name: 'Support regression', exact: true }).click();
  const detail = view.getByTestId('org-def-detail');
  const cases = detail.getByRole('table', { name: 'Test cases' });
  await expect(cases.locator('tr.sf-oc-row')).toHaveCount(3);
  await expect(cases).toContainText('Where is my order?');
  await expect(cases.locator('.sf-oc-tag.is-action', { hasText: 'Lookup' }).first()).toBeVisible();
  await expect(detail.getByTestId('org-runs-note')).toContainText("Runs started in Testing Center aren't visible here.");
  await expect(detail.getByRole('heading', { name: 'Support regression' })).toBeVisible();
  await beat();

  // An invalid run id is rejected before any org call; attach lives in the ⋯ menu.
  await view.getByRole('button', { name: 'More actions' }).click();
  await view.getByLabel('Attach run by id').fill('not a run');
  await view.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(view.getByRole('alert')).toHaveText('A run id is 15 to 18 letters and digits.');
  await beat();
  await view.getByLabel('Attach run by id').press('Escape');
  await expect(view.getByLabel('Attach run by id')).toHaveCount(0);

  // Run in the org: confirm, poll IN_PROGRESS -> COMPLETED, then read the results.
  await detail.getByRole('button', { name: 'Run in org' }).click();
  await beat();
  await detail.getByRole('group', { name: 'Confirm run' }).getByRole('button', { name: 'Start run' }).click();
  const run = view.getByTestId('org-run-detail');
  await expect(run.getByTestId('org-run-counts')).toContainText('2 pass · 1 fail · 0 error of 3', { timeout: 30_000 });
  await expect(run).toContainText('completed');
  await beat();
  const filters = run.getByRole('tablist', { name: 'Case filter' });
  await filters.getByRole('tab', { name: /Failing/ }).click();
  await expect(filters.getByRole('tab', { name: /Failing/ })).toHaveAttribute('aria-selected', 'true');
  await expect(run.getByRole('button', { name: 'Cancel my subscription' })).toBeVisible();
  await expect(run.getByRole('button', { name: 'Where is my order?' })).toHaveCount(0);
  await beat();
  await run.getByRole('button', { name: 'Cancel my subscription' }).click();
  const metrics = run.getByRole('table', { name: 'Case 3 metrics' });
  await expect(metrics).toContainText('General_FAQ');
  await expect(metrics).toContainText('The agent routed to General_FAQ instead of Billing.');
  await beat();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-org-tests-dark.png'));

  // The definition's cases next to the run: a verdict per row, the form read back as fields, and the last run per case.
  await expect(cases.getByRole('button', { name: 'Case 3 · fail' })).toBeVisible();
  await expect(cases).toContainText('{ } Form · orderNumber, reason +1');
  await expect(detail.getByText('Scored on every case: Completeness · Coherence')).toBeVisible();
  await cases.getByRole('button', { name: 'Case 2 · pass' }).click();
  const conversation = cases.getByLabel('Conversation');
  await expect(conversation).toContainText('Which order should I refund?');
  await expect(conversation).toContainText('Form submission');
  await expect(conversation).toContainText('00012345');
  await expect(cases.getByLabel('Context variables')).toContainText('currentObjectApiName');
  await expect(cases.getByLabel('Last run')).toContainText('Last run · pass');
  await cases.getByLabel('Context variables').scrollIntoViewIfNeeded();
  await beat();
  await conversation.getByRole('button', { name: 'Show raw utterance' }).click();
  await expect(conversation).toContainText('""orderNumber""');
  await cases.getByLabel('Context variables').scrollIntoViewIfNeeded();
  await beat();
  await cases.getByRole('button', { name: 'Case 2 · pass' }).click();
  await detail.getByRole('button', { name: 'Failed 1' }).click();
  await expect(cases.locator('tr.sf-oc-row')).toHaveCount(1);
  await cases.getByRole('button', { name: 'Case 3 · fail' }).click();
  await expect(cases.getByLabel('Last run')).toContainText('expected Billing');
  await cases.getByLabel('Last run').scrollIntoViewIfNeeded();
  await beat();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-org-tests-cases.png'));

  // The failing case becomes a local scenario case.
  await run.getByRole('button', { name: 'Import failing to suite' }).click();
  await expect(view.getByRole('status')).toHaveText('Imported 1 case into the suite.');
  await beat();
  await tests.getByRole('group', { name: 'Tests view' }).getByRole('button', { name: 'Test cases' }).click();
  await expect(tests.getByTestId('tests-table')).toContainText('Cancel my subscription');
  await beat();

  const requests = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')) as Array<{ path: string; body: Record<string, unknown> }>;
  expect(requests.filter(r => r.path.endsWith('/einstein/ai-evaluations/runs')).map(r => r.body)).toEqual([{ aiEvaluationDefinitionName: 'Support_Regression' }]);
  expect(requests.some(r => r.path.includes('/einstein/ai-evaluations/runs/4KB000000000001AAA/results'))).toBe(true);
  expect(errors).toEqual([]);
});

test('Agentforce Studio window: Org tests sit in the activity rail, and an agent runs one that the Studio follows live', async ({ app, home }, testInfo) => {
  mkdirSync(join(home, 'dx/tests'), { recursive: true });
  writeFileSync(join(home, 'dx/tests/Support.scenario.json'), JSON.stringify({ version: 1, cases: [
    { id: 'local-order', name: 'Local order status', utterances: ['Local order status'], expect: { contains: ['order'] } }
  ] }));
  writeFileSync(join(home, 'dx/tests/LocalOnly.scenario.json'), JSON.stringify({ version: 1, cases: [
    { id: 'local-only', name: 'Local only case', utterances: ['Local suite without an agent file'], expect: {} }
  ] }));
  const { window: main, electron } = app;
  const errors: string[] = [];
  main.on('pageerror', e => errors.push(`main: ${e.message}`));
  expect(await main.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = main.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => main.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await main.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id;
  }, join(home, 'dx'));
  await main.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await main.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await main.getByTestId('salesforce-workbench').getByTestId('plugin-tab-open-in-window').click();
  let studio: Page | undefined;
  await expect.poll(() => (studio = app.electron.windows().find(w => !w.isClosed() && w.url().includes('surface=plugin-view') && w.url().includes('pluginId=salesforce'))) ? 'open' : 'waiting', { timeout: 20_000 }).toBe('open');
  const page = studio!;
  await page.waitForSelector('#root', { timeout: 30_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(`studio: ${e.message}`));
  const beat = () => process.env.ZCC_E2E_RECORD_VIDEO ? page.waitForTimeout(1800) : Promise.resolve();
  // A recorded demo names each step on screen, so the agent's calls are visible too.
  const caption = async (text: string) => {
    if (!process.env.ZCC_E2E_RECORD_VIDEO) return;
    await page.evaluate(value => {
      let node = document.getElementById('e2e-caption');
      if (!node) {
        node = Object.assign(document.createElement('div'), { id: 'e2e-caption' });
        node.style.cssText = 'position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:99999;padding:10px 16px;border-radius:10px;background:rgba(20,24,33,.92);color:#fff;font:600 15px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(120,160,255,.6);pointer-events:none;max-width:80%;text-align:center';
        document.body.appendChild(node);
      }
      node.textContent = value;
    }, text);
  };
  const panel = page.getByTestId('salesforce-agent-script-panel');
  // A fresh window may take the click before its editor is ready, so retry the open.
  await caption('You: open Support.agent in the Studio window');
  await expect(async () => {
    await panel.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
    await expect(panel.getByTestId('salesforce-agent-script-no-file')).toHaveCount(0, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await beat();

  // The Tests workbench combines local suites and org definitions in a full-width editor tab.
  const rail = panel.getByRole('toolbar', { name: 'Studio activity' });
  expect(await rail.getByRole('button').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).toEqual(['Files', 'Tests', 'Go to file']);
  await caption('You: click Tests in the left activity rail');
  await rail.getByRole('button', { name: 'Tests', exact: true }).click();
  const tab = panel.getByTestId('studio-org-tests-view');
  await expect(panel.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /^TESTS Tests/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tab.getByRole('heading', { name: 'Tests', exact: true })).toBeVisible();
  await expect(tab).toContainText('studio');
  const table = tab.getByTestId('org-tests-table');
  // The org's test definitions load progressively; give the detached window headroom under load.
  await expect(table.getByRole('button', { name: 'Support regression', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByText('Pick local cases or an org test to see its cases and runs.')).toBeVisible();
  const localSuite = table.getByTestId('local-suite-Support');
  await expect(localSuite).toContainText('1 case');
  await localSuite.getByRole('button').click();
  const localDetails = tab.getByTestId('local-suite-detail');
  await expect(localDetails.getByTestId('tests-row-local-order')).toContainText('Local order status');
  await expect(localDetails.getByRole('group', { name: 'Tests view' })).toHaveCount(0);
  await localDetails.getByRole('button', { name: 'Run all in Simulate' }).click();
  await expect(localDetails.getByTestId('tests-row-local-order').locator('td').nth(2)).toContainText('Pass', { timeout: 30_000 });
  await expect(localSuite).toContainText('Has runs');
  await localDetails.getByRole('button', { name: '+ Case', exact: true }).click();
  await localDetails.getByLabel('Name', { exact: true }).fill('Added in tests workbench');
  await localDetails.getByLabel('Utterances, one per line').fill('Track another order');
  await localDetails.getByRole('button', { name: 'Add case', exact: true }).click();
  await expect(localSuite).toContainText('2 cases');
  expect(JSON.parse(readFileSync(join(home, 'dx/tests/Support.scenario.json'), 'utf8')).cases).toHaveLength(2);
  await caption('You: switch to All agents to see every agent\'s org tests');
  await tab.getByRole('group', { name: 'Scope' }).getByRole('button', { name: 'All agents' }).click();
  await table.getByTestId('local-suite-LocalOnly').getByRole('button').click();
  await expect(tab.getByText('No local agent file matches this suite. Open or retrieve its agent to run these cases.')).toBeVisible();
  await expect(tab.getByTestId('local-suite-detail')).toContainText('Local suite without an agent file');
  await table.getByRole('button', { name: /^Billing/ }).click();
  await expect(table.getByRole('button', { name: 'Billing smoke', exact: true })).toBeVisible();
  await beat();
  // Going back to the agent keeps the tab mounted behind it.
  await caption('You: go back to editing Support.agent');
  await panel.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /^Script/ }).click();
  await expect(tab).toBeHidden();
  await beat();

  // The agent's side: the same sf_workbench actions a thread calls.
  async function cli(argv: string[]) {
    return main.evaluate(async ({ argv, projectId }) => {
      const response = await fetch('/api/v1/plugins/salesforce/cli', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ argv, projectId }) });
      if (!response.ok) throw Error(await response.text());
      const result = await response.json();
      if (!result.stdout) throw Error(result.stderr || 'Missing CLI result');
      return JSON.parse(result.stdout);
    }, { argv, projectId });
  }
  const action = (name: string, input = {}) => cli(['action', name, '--input', JSON.stringify(input), '--json']);
  await caption('Agent → sf_workbench orgTests.list');
  await beat();
  const listed = await action('orgTests.list');
  expect(listed).toMatchObject({ ok: true, definitions: expect.arrayContaining([expect.objectContaining({ name: 'Support_Regression' })]) });
  await caption('Agent → sf_workbench orgTests.run { name: "Support_Regression" }');
  await beat();
  const started = await action('orgTests.run', { name: 'Support_Regression' });
  expect(started).toMatchObject({ ok: true, run: { runId: '4KB000000000001AAA', definition: 'Support_Regression', status: expect.stringMatching(/new|in_progress/) } });
  let viewId = '';
  await expect.poll(async () => {
    const views = (await action('ui.views')).views as Array<{ id: string; surface: string; window?: string; commands: string[] }>;
    viewId = views.find(v => v.surface === 'agentforce' && v.window === 'plugin-view' && v.commands.includes('orgTests.open'))?.id ?? '';
    return viewId;
  }).not.toBe('');
  await caption(`Agent → ui.command orgTests.open { runId: "${started.run.runId}" }`);
  await beat();
  const job = await action('ui.command', { viewId, command: 'orgTests.open', input: { runId: started.run.runId } });
  expect(job).toMatchObject({ ok: true });
  let shown: any;
  await expect.poll(async () => { shown = await action('ui.result', { commandId: job.commandId }); return shown.state; }, { timeout: 15_000 }).not.toBe('pending');
  expect(shown).toMatchObject({ ok: true });

  // The Studio follows: the tab comes back on the run's definition and polls the run to completion.
  await expect(tab).toBeVisible();
  await expect(tab.getByTestId('org-def-detail').getByRole('heading', { name: 'Support regression' })).toBeVisible();
  const run = tab.getByTestId('org-run-detail');
  await expect(run.getByTitle('Run 4KB000000000001AAA', { exact: true })).toBeVisible();
  await caption('Studio follows the run live: polling the org until it finishes');
  await beat();
  await expect(run.getByTestId('org-run-counts')).toContainText('2 pass · 1 fail · 0 error of 3', { timeout: 30_000 });
  await expect(run).toContainText('completed');
  await beat();
  await caption('Agent → sf_workbench orgTests.result → 2 pass · 1 fail');
  await beat();
  // The agent reads the same results.
  await expect.poll(async () => (await action('orgTests.result', { runId: '4KB000000000001AAA' })).run?.status).toBe('completed');
  expect((await action('orgTests.result', { runId: '4KB000000000001AAA' })).run.counts).toMatchObject({ total: 3, pass: 2, fail: 1 });
  expect((await action('orgTests.runs')).runs).toEqual([expect.objectContaining({ runId: '4KB000000000001AAA', status: 'completed' })]);

  // The person looks at the failure in the wide tab.
  await caption('You: Failing filter, expand the failing case');
  await run.getByRole('tablist', { name: 'Case filter' }).getByRole('tab', { name: /Failing/ }).click();
  await run.getByRole('button', { name: 'Cancel my subscription' }).click();
  await expect(run.getByRole('table', { name: 'Case 3 metrics' })).toContainText('The agent routed to General_FAQ instead of Billing.');
  await beat();
  await caption('Expected topic Billing, the agent routed to General_FAQ');
  await beat();
  await captureElectronScreenshot(electron, page, testInfo.outputPath('studio-window-org-tests.png'));
  await beat();

  const requests = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')) as Array<{ path: string; body: Record<string, unknown> }>;
  expect(requests.filter(r => r.path.endsWith('/einstein/ai-evaluations/runs')).map(r => r.body)).toEqual([{ aiEvaluationDefinitionName: 'Support_Regression' }]);
  expect(errors).toEqual([]);
});

test('Agentforce suite progress: current case, turns and partial results reach the built Electron UI', async ({ app, home }, testInfo) => {
  const page = app.window;
  const projectRoot = join(home, 'dx');
  mkdirSync(join(projectRoot, 'tests'), { recursive: true });
  writeFileSync(join(projectRoot, 'tests/Support.scenario.json'), JSON.stringify({ version: 1, cases: [
    { id: 'first', name: 'First case', utterances: ['Suite progress first case'], expect: { contains: ['order'] } },
    { id: 'second', name: 'Multi-turn case', utterances: ['Suite progress second case', 'Order 42'], expect: { contains: ['order'] } }
  ] }));
  writeFileSync(join(home, 'suite-first'), 'hold');
  writeFileSync(join(home, 'suite-second'), 'hold');
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  const trust = page.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => {
    const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id;
  }, projectRoot);
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await tests.getByRole('button', { name: 'Run all in Simulate', exact: true }).click();
  const progress = tests.getByTestId('tests-run-progress');
  await expect(progress).toContainText('0 of 2 cases complete');
  await expect(progress).toContainText('Waiting for agent response · turn 1 of 1');
  await expect(tests.getByTestId('tests-row-first')).toContainText('Running…');
  await expect(tests.getByTestId('tests-row-second')).toContainText('Queued');
  await expect(progress.getByTestId('tests-run-elapsed')).not.toHaveText('Elapsed 0s');
  await expect(tests.getByRole('button', { name: 'Run org eval', exact: true })).toBeDisabled();
  rmSync(join(home, 'suite-first'));
  await expect(progress).toContainText('1 of 2 cases complete');
  await expect(progress).toContainText('Multi-turn case');
  await expect(progress).toContainText('turn 1 of 2');
  await expect(tests.getByTestId('tests-row-first')).toContainText('Pass');
  await expect(tests.getByTestId('tests-row-second')).toContainText('Running…');
  await expect(progress.getByRole('progressbar')).toHaveAttribute('value', '1');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('suite-progress.png'));
  rmSync(join(home, 'suite-second'));
  await expect(progress).toHaveCount(0);
  await expect(tests.getByTestId('tests-row-second')).toContainText('Pass');
  await expect(tests.getByTestId('tests-summary')).toContainText('2/2');
  await expect(tests.getByRole('button', { name: 'Run all in Simulate', exact: true })).toBeEnabled();
});

test('Agentforce Studio: two agents keep their own view tabs, and closing one moves to the other', async ({ app, home }, testInfo) => {
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
  const frame = page.frameLocator('iframe[title="Agentforce playground"]');
  const agentTab = (name: string) => agentTabs(page).getByRole('tab', { name: new RegExp(`^${name}\\.agent`) });
  const openFromExplorer = async (path: string) => {
    await showAllAgents(studio);
    await studio.getByTestId(`salesforce-agent-script-file:${path}`).click();
  };

  // Agent 1: Support, with Graph and Tests opened as its view tabs.
  await openFromExplorer('force-app/Support.agent');
  await expect(agentTab('Support')).toHaveAttribute('aria-selected', 'true');
  await expect(frame.locator('.view-lines')).toContainText('Support_Concierge');
  await openTool(studio, 'Graph');
  await expect(viewPane(page, 'graph').frameLocator('iframe[title="AgentScript graph"]').getByText('Conversation map')).toBeVisible();
  await openTool(studio, 'Tests');
  await expect(viewPane(page, 'tests').getByTestId('studio-tests-pane')).toBeVisible();
  await expect(editorTabs(page).getByRole('tab')).toHaveText([/^Script/, 'Graph', 'Tests']);

  // Agent 2: Orders gets its own tab and its own workspace, with no Graph or Tests tab.
  await openFromExplorer('force-app/Orders.agent');
  await expect(agentTab('Orders')).toHaveAttribute('aria-selected', 'true');
  await expect(agentTab('Support')).toHaveAttribute('aria-selected', 'false');
  await expect(editorTabs(page).getByRole('tab', { name: 'Graph', exact: true })).toHaveCount(0);
  await expect(editorTabs(page).getByRole('tab', { name: 'Tests', exact: true })).toHaveCount(0);
  await expect(editorTabs(page).getByRole('tab', { name: /^Script/ })).toHaveAttribute('aria-selected', 'true');
  await expect(frame.locator('.view-lines')).toContainText('Order_Assistant');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-two-agents.png'));

  // Back to agent 1: its Graph and Tests tabs return, Tests still in front.
  await agentTab('Support').click();
  await expect(agentTab('Support')).toHaveAttribute('aria-selected', 'true');
  await expect(editorTabs(page).getByRole('tab')).toHaveText([/^Script/, 'Graph', 'Tests']);
  await expect(editorTabs(page).getByRole('tab', { name: 'Tests', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(viewPane(page, 'tests').getByTestId('studio-tests-pane')).toBeVisible();
  await editorTabs(page).getByRole('tab', { name: 'Graph', exact: true }).click();
  await expect(viewPane(page, 'graph').frameLocator('iframe[title="AgentScript graph"]').getByText('Conversation map')).toBeVisible();

  // The explorer brings an open agent forward instead of opening it twice.
  await openFromExplorer('force-app/Orders.agent');
  await expect(agentTab('Orders')).toHaveAttribute('aria-selected', 'true');
  await expect(agentTab('Orders')).toHaveCount(1);
  await agentTab('Support').click();
  await expect(editorTabs(page).getByRole('tab', { name: 'Graph', exact: true })).toHaveAttribute('aria-selected', 'true');

  // Closing agent 1's tab moves to agent 2 and drops agent 1's view tabs.
  await agentTabs(page).getByRole('button', { name: /^Close agent Support\.agent/ }).click();
  await expect(agentTab('Support')).toHaveCount(0);
  await expect(agentTab('Orders')).toHaveAttribute('aria-selected', 'true');
  await expect(editorTabs(page).getByRole('tab', { name: 'Graph', exact: true })).toHaveCount(0);
  await expect(frame.locator('.view-lines')).toContainText('Order_Assistant');

  // Cards in the Assistant rail beside the Studio open Studio tabs, not a thread side panel.
  await showSidePanel(page);
  await openThreadToolLauncher(sidePanel(page));
  await sidePanel(page).getByTestId('thread-new-tab-agent').click();
  const composer = sidePanel(page).getByTestId('panel-agent-tab-composer');
  await composer.getByTestId('thread-command-input').fill('Review these\n::sf-agent{path="force-app/Support.agent"}\n::sf-preview{runId="rail-run-1" path="force-app/Orders.agent"}');
  await composer.getByTestId('thread-command-send').click();
  const chat = sidePanel(page).getByTestId('panel-agent-tab-chat');
  const agentCard = chat.getByTestId('sf-card-agent').last();
  await expect(agentCard.locator('.plugin-directive-card-main')).toBeEnabled({ timeout: 30_000 });
  await agentCard.locator('.plugin-directive-card-main').click();
  await expect(agentTab('Support')).toHaveAttribute('aria-selected', 'true');
  await expect(editorTabs(page).getByRole('tab', { name: /^Script/ })).toHaveAttribute('aria-selected', 'true');
  await expect(frame.locator('.view-lines')).toContainText('Support_Concierge');
  await expect(sidePanel(page).getByTestId('atp-root')).toHaveCount(0);
  await chat.getByTestId('sf-card-preview').last().locator('.plugin-directive-card-main').click();
  await expect(agentTab('Orders')).toHaveAttribute('aria-selected', 'true');
  await expect(editorTabs(page).getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(viewPane(page, 'preview').getByTestId('preview-workbench')).toBeVisible();
  await expect(sidePanel(page).getByTestId('atp-root')).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('Agentforce simulations: live lanes stay with their agent, stop, verdicts and saved history', async ({ app, home }, testInfo) => {
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
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await tests.getByRole('button', { name: 'Batch simulations', exact: true }).click();
  const simulations = tests.getByTestId('studio-simulations');
  await expect(simulations).toContainText('No simulations yet');
  await simulations.getByLabel('Missing details', { exact: true }).uncheck();
  await simulations.getByLabel('Stay in scope', { exact: true }).uncheck();
  writeFileSync(join(home, 'simulation-hold'), 'hold');
  await simulations.getByRole('button', { name: 'Run 1 conversation', exact: true }).click();
  await expect(simulations.getByTestId('simulation-summary')).toContainText('Running');
  await expect(simulations.getByRole('list', { name: 'Conversations' })).toContainText('Happy path');
  await simulations.getByRole('listitem').click();
  await expect(simulations.getByRole('region', { name: 'Conversation Happy path' })).toContainText('Understand what the agent can do');

  // Another agent owns a separate view and history, even while this project has a running batch.
  await showAllAgents(studio);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Orders.agent').click();
  await openTool(studio, 'Tests');
  const ordersTests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await ordersTests.getByRole('button', { name: 'Batch simulations', exact: true }).click();
  await expect(ordersTests.getByTestId('studio-simulations')).toContainText('No simulations yet');
  await expect(ordersTests.getByTestId('studio-simulations').getByTestId('simulation-summary')).toHaveCount(0);
  await agentTabs(page).getByRole('tab', { name: /^Support\.agent/ }).click();
  await expect(simulations.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await simulations.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(simulations.getByTestId('simulation-summary')).toContainText('Stopped');
  rmSync(join(home, 'simulation-hold'));
  await expect(simulations.getByRole('button', { name: 'Run 1 conversation', exact: true })).toBeEnabled();

  // A failing judge result has evidence, and a subsequent passing run preserves both histories.
  writeFileSync(join(home, 'simulation-judge-fail'), 'fail');
  writeFileSync(join(home, 'simulation-hold'), 'hold');
  await simulations.getByRole('button', { name: 'Run 1 conversation', exact: true }).click();
  await expect(simulations.getByTestId('simulation-summary')).toContainText('Running');
  const pendingId = await simulations.getByRole('combobox', { name: 'Simulation batch', exact: true }).inputValue();
  await agentTabs(page).getByRole('tab', { name: /^Orders\.agent/ }).click();
  rmSync(join(home, 'simulation-hold'));
  await expect.poll(() => page.evaluate(({ projectId, batchId }) => window.cc.pluginApps.callRpc('salesforce', 'studio.simulations.get', {
    projectId, batchId,
  }), { projectId, batchId: pendingId })).toMatchObject({ ok: true, batch: { status: 'done' } });
  // This agent receives project-wide progress messages, but must keep its own empty history.
  await expect(ordersTests.getByTestId('studio-simulations')).toContainText('No simulations yet');
  await expect(ordersTests.getByTestId('studio-simulations').getByTestId('simulation-summary')).toHaveCount(0);
  await agentTabs(page).getByRole('tab', { name: /^Support\.agent/ }).click();
  await expect(simulations.getByTestId('simulation-summary')).toContainText('Done');
  await expect(simulations.getByLabel('0 of 1 pass')).toBeVisible();
  await simulations.getByRole('listitem').click();
  await expect(simulations.getByRole('region', { name: 'Conversation Happy path' })).toContainText('Judge: Fail');
  await expect(simulations.getByRole('region', { name: 'Conversation Happy path' })).toContainText('did not complete the requested refund');
  await expect(simulations.getByRole('region', { name: 'Conversation Happy path' }).locator('.sf-sim-turn.is-user')).toHaveCount(4);
  // Preview includes the agent's opening greeting before the four customer exchanges.
  await expect(simulations.getByRole('region', { name: 'Conversation Happy path' }).locator('.sf-sim-turn:not(.is-user)')).toHaveCount(5);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('simulation-evidence.png'));
  rmSync(join(home, 'simulation-judge-fail'));
  await simulations.getByRole('button', { name: 'Run 1 conversation', exact: true }).click();
  await expect(simulations.getByLabel('1 of 1 pass')).toBeVisible();
  await expect(simulations.getByLabel('Simulation batch', { exact: true }).locator('option')).toHaveCount(3);
  const failedId = await simulations.getByLabel('Simulation batch', { exact: true }).locator('option').nth(1).getAttribute('value');
  await simulations.getByLabel('Simulation batch', { exact: true }).selectOption(failedId!);
  await expect(simulations.getByLabel('0 of 1 pass')).toBeVisible();
  // Reload preserves the project route; its navigation is ready without reopening the project.
  await page.reload();
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  await showAllAgents(studio);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await openTool(studio, 'Tests');
  await viewPane(page, 'tests').getByRole('button', { name: 'Batch simulations', exact: true }).click();
  const restored = viewPane(page, 'tests').getByTestId('studio-simulations');
  await expect(restored.getByLabel('Simulation batch', { exact: true }).locator('option')).toHaveCount(3);
  await expect(restored.getByLabel('1 of 1 pass')).toBeVisible();
  expect(errors).toEqual([]);
});


test('Agentforce self-healing: parallel candidates improve fixed scenarios without saving', async ({ app, home }, testInfo) => {
  const page = app.window;
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => { const result = await window.cc.projects.add(path); if (!result.ok) throw Error(result.message); return result.value.id; }, join(home, 'dx'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  const action = (action: string, input: object = {}): Promise<any> => page.evaluate(({ projectId, action, input }) => window.cc.pluginApps.callRpc('salesforce', 'actions.run', { projectId, action, input }), { projectId, action, input });
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await tests.getByRole('button', { name: 'Batch simulations', exact: true }).click();
  const simulations = tests.getByTestId('studio-simulations');
  await simulations.getByLabel('Stay in scope', { exact: true }).uncheck();
  await simulations.locator('summary').filter({ hasText: 'Run settings' }).click();
  await simulations.getByLabel('Parallel conversations').selectOption('2');
  await page.keyboard.press('Escape');
  writeFileSync(join(home, 'simulation-judge-fail'), 'fail');
  writeFileSync(join(home, 'simulation-hold'), 'hold');
  await simulations.getByRole('button', { name: 'Run 2 conversations', exact: true }).click();
  await expect(simulations.locator('.sf-sim-lane.is-running')).toHaveCount(2);
  rmSync(join(home, 'simulation-hold'));
  await expect(simulations.getByLabel('0 of 2 pass')).toBeVisible();
  await expect(simulations.getByTestId('simulation-summary')).toContainText('Done');
  const baseline = await action('simulations.list', { agentPath: 'force-app/Support.agent' });
  const original = readFileSync(join(home, 'dx/force-app/Support.agent'), 'utf8');
  const healing = simulations.getByRole('region', { name: 'Self-healing' });
  await healing.getByLabel('Candidate attempts').selectOption('2');
  const studioUrl = page.url();
  await healing.getByRole('button', { name: 'Start self-healing', exact: true }).click();
  const composer = sidePanel(page).getByTestId('panel-agent-tab-composer');
  await expect(composer).toBeVisible();
  await expect(composer.getByTestId('thread-command-input')).toContainText('Run self-healing for force-app/Support.agent');
  await expect(composer.getByTestId('thread-command-input')).toContainText('Budget: 2 candidate attempts');
  await expect(simulations).toBeVisible();
  expect(page.url()).toBe(studioUrl);
  const started = await action('selfHealing.status', { agentPath: 'force-app/Support.agent' });
  expect(started).toMatchObject({ ok: true, run: { baselineBatchId: baseline.batches[0].id, baselinePass: 0, maxAttempts: 2 } });
  await expect(composer.getByTestId('thread-command-input')).toContainText(started.run.id);
  await healing.getByRole('button', { name: 'Continue with agent', exact: true }).click();
  await expect(sidePanel(page).getByTestId('panel-agent-tab-composer')).toHaveCount(1);
  await expect(healing.getByRole('button', { name: 'Stop self-healing' })).toBeVisible();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('self-healing-side-panel-draft.png'));
  await composer.getByTestId('thread-command-send').click();
  await expect(sidePanel(page).getByTestId('panel-agent-tab-chat')).toBeVisible();
  await expect(simulations).toBeVisible();
  expect(page.url()).toBe(studioUrl);
  rmSync(join(home, 'simulation-judge-fail'));
  expect(await action('selfHealing.evaluate', { runId: started.run.id, source: original + '\n# tested candidate\n' })).toMatchObject({ ok: true, run: { status: 'testing' } });
  await expect.poll(async () => (await action('selfHealing.status', { runId: started.run.id, waitMs: 100 })).run.status).toBe('passed');
  await expect(healing).toContainText('Baseline 0/2 → Best 2/2');
  await expect(healing).toContainText('Candidate 1: improved');
  await expect(healing.getByRole('button', { name: 'Review best candidate with agent' })).toBeVisible();
  await healing.getByRole('button', { name: 'Review best candidate with agent' }).click();
  await expect(composer).toBeVisible();
  await expect(composer.getByTestId('thread-command-input')).toContainText(started.run.id);
  await expect(simulations).toBeVisible();
  expect(page.url()).toBe(studioUrl);
  expect(readFileSync(join(home, 'dx/force-app/Support.agent'), 'utf8')).toBe(original);
  expect(await action('selfHealing.status', { runId: started.run.id, includeSource: true })).toMatchObject({ ok: true, source: original + '\n# tested candidate\n' });
  expect(await action('selfHealing.evaluate', { runId: started.run.id, source: original + '\n# extra\n' })).toMatchObject({ ok: false, code: 'not_ready' });
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('self-healing-complete.png'));
});

test('Agentforce improvements: cache-safe discovery, source jumps, draft comparison and custom scenarios', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const cache = join(home, 'dx/.pnpm-store');
  mkdirSync(cache, { recursive: true });
  for (let i = 0; i < 4100; i++) writeFileSync(join(cache, `cache${i}.txt`), 'cache');
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
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  const listed = await page.evaluate(projectId => window.cc.pluginApps.callRpc('salesforce', 'agentFiles.list', { projectId }), projectId);
  expect(listed).toMatchObject({ ok: true, truncated: false, files: expect.arrayContaining([expect.objectContaining({ path: 'force-app/Support.agent' })]) });
  const savedSource = readFileSync(join(home, 'dx/force-app/Support.agent'), 'utf8');
  expect(await page.evaluate(projectId => window.cc.pluginApps.callRpc('salesforce', 'studio.suites.save', { projectId, agentPath: 'force-app/Support.agent', cases: [{ id: 'comparison', name: 'Comparison acceptance', utterances: ['Comparison acceptance'], expect: { contains: ['comparison success'], maxLatencyMs: 30000 } }] }), projectId)).toMatchObject({ ok: true });
  const frame = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(frame.getByTestId('agent-script-ide')).toBeVisible();
  await frame.locator('.monaco-editor').click({ position: { x: 120, y: 45 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('# comparison-candidate\n');
  await expect(studio.locator('.af-draft-state')).toContainText('Unsaved');
  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await tests.getByRole('button', { name: 'Compare saved vs draft', exact: true }).click();
  const comparison = tests.getByRole('region', { name: 'Saved source versus editor draft' });
  await expect(comparison).toContainText('0/1 → 1/1 pass', { timeout: 30000 });
  await expect(comparison).toContainText('1 improved · 0 regressed · 0 unclear');
  await comparison.locator('summary').click();
  await expect(comparison).toContainText('comparison baseline');
  await expect(comparison).toContainText('comparison success');
  expect(readFileSync(join(home, 'dx/force-app/Support.agent'), 'utf8')).toBe(savedSource);
  expect(await page.evaluate(projectId => window.cc.pluginApps.callRpc('salesforce', 'studio.suites.list', { projectId, agentPath: 'force-app/Support.agent' }), projectId)).toMatchObject({ suites: [expect.not.objectContaining({ lastResults: expect.anything() })] });
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-comparison-dark.png'));
  // A source comment link must reveal the visible Script, including keyboard activation.
  expect(await page.evaluate(projectId => window.cc.pluginApps.callRpc('salesforce', 'studio.comments.add', { projectId, path: 'force-app/Support.agent', line: 3, endLine: 3, quote: '', body: 'Source jump regression' }), projectId)).toMatchObject({ ok: true });
  await openTool(studio, 'Comments');
  const jump = studio.getByRole('button', { name: 'Jump to line 3', exact: true });
  await jump.focus(); await page.keyboard.press('Enter');
  await expect(editorTabs(page).getByRole('tab', { name: /^Script/ })).toHaveAttribute('aria-selected', 'true');
  await expect(frame.locator('.view-lines')).toBeVisible();
  await sidePanel(page).getByTestId('thread-secondary-hide').click();
  await openTool(studio, 'Tests');
  await tests.getByRole('button', { name: 'Batch simulations', exact: true }).click();
  const simulations = tests.getByTestId('studio-simulations');
  await expect(simulations.getByLabel('Scenario 1 name', { exact: true })).toBeVisible();
  await simulations.getByLabel('Search scenarios').fill('missing');
  await expect(simulations.getByRole('button', { name: 'Edit Happy path', exact: true })).toBeHidden();
  await simulations.getByRole('button', { name: 'Edit Missing details', exact: true }).click();
  await expect(simulations.getByLabel('Scenario 2 persona', { exact: true })).toBeVisible();
  await expect(simulations.getByLabel('Scenario 1 persona', { exact: true })).toHaveCount(0);
  await simulations.getByLabel('Search scenarios').fill('');
  await simulations.getByRole('button', { name: 'Edit Happy path', exact: true }).click();
  await simulations.getByLabel('Scenario 1 name', { exact: true }).fill('Custom return');
  await simulations.getByLabel('Scenario 1 opening', { exact: true }).fill('What is the return policy?');
  await simulations.getByLabel('Missing details', { exact: true }).uncheck();
  await simulations.getByLabel('Stay in scope', { exact: true }).uncheck();
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`studio-scenario-editor-${theme}.png`));
  }
  await simulations.getByRole('button', { name: 'Run 1 conversation', exact: true }).click();
  await expect(simulations.getByTestId('simulation-summary')).toContainText('Done', { timeout: 30000 });
  await simulations.getByRole('button', { name: /Custom return/ }).click();
  await expect(simulations.getByRole('region', { name: 'Conversation Custom return' })).toContainText('What is the return policy?');
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 900));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(simulations).toBeVisible();
  expect(await simulations.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(350);
  expect(await simulations.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await studioPanel(page).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-custom-scenarios-narrow-light.png'));
  await simulations.getByRole('button', { name: /^Scenarios/ }).click();
  await expect(simulations.getByLabel('Scenario 1 opening', { exact: true })).toHaveValue('What is the return policy?');
  expect(await simulations.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await simulations.locator('summary').filter({ hasText: 'Run settings' }).click();
  await expect(simulations.getByRole('group', { name: 'Run settings', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(simulations.getByLabel('Parallel conversations')).toBeHidden();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-scenario-editor-narrow-light.png'));
  await app.electron.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(400, 400); win.setSize(720, 800); });
  await expect.poll(() => simulations.evaluate(el => el.clientWidth)).toBeLessThan(460);
  const stacked = await simulations.evaluate(el => { const list = el.querySelector('.sf-sim-catalogue')!.getBoundingClientRect(), editor = el.querySelector('.sf-sim-editor')!.getBoundingClientRect(); return { listBottom: list.bottom, editorTop: editor.top }; });
  expect(stacked.editorTop).toBeGreaterThanOrEqual(stacked.listBottom - 1);
  expect(await simulations.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-scenario-editor-compact-light.png'));
  expect(errors).toEqual([]);
});

test('AgentScript Studio reliability: large snapshots, background recovery, setup and cancellation', async ({ app, home }, testInfo) => {
  const page = app.window;
  const projectRoot = join(home, 'dx');
  const source = AGENT_SCRIPT_EXAMPLES[0].source + '\n# ' + 'large-source '.repeat(24000) + '\n';
  writeFileSync(join(projectRoot, 'force-app/Large.agent'), source);
  expect(source.length).toBeGreaterThan(280000);
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => { const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id; }, projectRoot);
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  const action = (action: string, input: object = {}): Promise<any> => page.evaluate(async ({ projectId, action, input }) => {
    const response = await fetch('/api/v1/plugins/salesforce/cli', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, argv: ['action', action, '--input', JSON.stringify(input), '--json'] }) });
    const result = await response.json();
    return JSON.parse(result.stdout);
  }, { projectId, action, input });
  // Exercise the actual CLI and desktop socket. A file envelope avoids shell
  // argv and the small inline transport cap, without weakening that cap.
  const cliRoot = join(home, 'large-cli');
  cpSync(join(root, 'packages/cli/dist'), cliRoot, { recursive: true, dereference: true });
  const cli = async (argv: string[]) => {
    const result = await promisify(execFile)(process.execPath, [join(cliRoot, 'bin/zcc'), 'sf', ...argv], {
      cwd: projectRoot, timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, HOME: home, USERPROFILE: home, ZCC_DATA_DIR: join(home, '.zcc'), ZCC_PROJECT_ID: projectId,
        ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined, ZCC_THREAD_ID: undefined, ZCC_SERVER_URL: undefined,
        BB_PROJECT_ID: undefined, BB_THREAD_ID: undefined, NO_COLOR: undefined, FORCE_COLOR: undefined }
    });
    return JSON.parse(result.stdout);
  };
  writeFileSync(join(projectRoot, 'parse-input.json'), JSON.stringify({ source }));
  expect(await cli(['action', 'source.parse', '--input-file', 'parse-input.json', '--json'])).toMatchObject({ ok: true });
  const read = await cli(['action', 'files.read', '--input', JSON.stringify({ path: 'force-app/Large.agent' }), '--json']);
  expect(read.file.content).toBe(source);
  writeFileSync(join(projectRoot, 'write-input.json'), JSON.stringify({ path: 'force-app/Large.agent', content: source + '# CLI_WRITE_COMPLETE\n', expectedSha256: read.file.sha256 }));
  expect(await cli(['action', 'files.write', '--input-file', 'write-input.json', '--json'])).toMatchObject({ ok: true });
  expect(readFileSync(join(projectRoot, 'force-app/Large.agent'), 'utf8')).toBe(source + '# CLI_WRITE_COMPLETE\n');
  expect(await action('source.parse', { source })).toMatchObject({ ok: true });
  expect(await action('source.parse', { path: 'force-app/Large.agent' })).toMatchObject({ ok: true });
  const preview = await action('studio.start', { path: 'force-app/Large.agent', engine: 'preview' });
  expect(preview).toMatchObject({ ok: true, data: { id: expect.any(String) } });
  await action('studio.end', { id: preview.data.id });
  const posted = JSON.parse(readFileSync(join(home, 'sfap-requests.json'), 'utf8')).find((row: any) => row.path.endsWith('/authoring/scripts'));
  expect(posted.body.assets[0].content).toContain('large-source '.repeat(1000));
  expect(await action('files.read', { path: 'force-app/Deleted.agent' })).toMatchObject({ code: 'not_found', error: expect.stringContaining('Open another file') });
  expect(await action('files.read', { path: '../Deleted.agent' })).toMatchObject({ code: 'path_refused' });
  const cases = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, name: `Case ${i}`, utterances: ['Find my order'], expect: { contains: ['order'] }, ...(i === 24 ? { prerequisites: ['Account selected', 'Address form saved'] } : {}) }));
  expect(await page.evaluate(({ projectId, cases }) => window.cc.pluginApps.callRpc('salesforce', 'studio.suites.save', { projectId, agentPath: 'force-app/Large.agent', cases }), { projectId, cases })).toMatchObject({ ok: true });
  const start = await action('suites.run', { agentPath: 'force-app/Large.agent', requestId: 'large-retry' });
  expect(start).toMatchObject({ ok: true, status: 'running', jobId: expect.any(String) });
  expect(await action('suites.start', { agentPath: 'force-app/Large.agent', requestId: 'large-retry' })).toMatchObject({ jobId: start.jobId });
  let complete: any;
  await expect.poll(async () => { complete = await action('suites.result', { jobId: start.jobId }); return complete.status; }, { timeout: 60000 }).toBe('completed');
  expect(Object.keys(complete.result.results)).toHaveLength(25);
  expect(complete.result.results.c23).toMatchObject({ outcome: 'pass', deterministic: 'pass' });
  expect(complete.result.results.c24).toMatchObject({ setupBlocked: true, outcome: 'inconclusive' });
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioIn(page);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Large.agent').click();
  let viewId = '';
  await expect.poll(async () => { const views = await action('ui.views'); viewId = views.views.find((v: any) => v.surface === 'agentforce')?.id ?? ''; return viewId; }).not.toBe('');
  const state = await action('ui.command', { viewId, command: 'state', input: { includeSource: true } });
  let snapshot: any;
  await expect.poll(async () => { snapshot = await action('ui.result', { commandId: state.commandId }); return snapshot.state; }).toBe('completed');
  expect(snapshot).toMatchObject({ ok: true, viewState: { source: source + '# CLI_WRITE_COMPLETE\n' } });
  // A large unsaved edit remains recoverable in the real Monaco iframe.
  const editor = page.frameLocator('iframe[title="Agentforce playground"]');
  await expect(editor.locator('.view-lines')).toContainText('config:');
  await editor.locator('.monaco-editor').click({ position: { x: 180, y: 50 } });
  await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type('\n# RECOVER_LARGE_DRAFT');
  await expect.poll(() => editor.locator('body').evaluate(() => JSON.parse(localStorage.getItem('salesforce.agent-drafts.v1') || '[]').some((draft: any) => draft.content.length > 280000 && draft.content.includes('RECOVER_LARGE_DRAFT')))).toBe(true);
  await expect(studio).not.toContainText('Local recovery is unavailable');
  await studio.getByRole('button', { name: 'Save Agentforce file' }).click();
  await expect.poll(() => readFileSync(join(projectRoot, 'force-app/Large.agent'), 'utf8')).toContain('RECOVER_LARGE_DRAFT');
  await openTool(studio, 'Preview');
  const previewPanel = viewPane(page, 'preview').getByTestId('preview-workbench');
  await expect(previewPanel.getByRole('button', { name: 'Inspect 25 cases ▾' })).toBeVisible();
  await expect(previewPanel.getByRole('region', { name: 'Scenario cases' })).toHaveCount(0);
  await previewPanel.getByRole('button', { name: /Inspect 25 cases/ }).click();
  await previewPanel.getByLabel('Scenario result filter').selectOption('inconclusive');
  await expect(previewPanel.locator('.sf-pw-suite-case')).toHaveCount(1);
  await expect(previewPanel.locator('.sf-pw-suite-case')).toContainText('Case 24');
  await previewPanel.getByLabel('Search scenarios').fill('no matching case');
  await expect(previewPanel.getByRole('status')).toContainText('No scenarios match');
  await previewPanel.getByLabel('Search scenarios').fill('');
  await previewPanel.getByLabel('Scenario result filter').selectOption('all');
  await previewPanel.getByRole('button', { name: /Inspect 25 cases/ }).click();
  writeFileSync(join(home, 'preview-trace-fixture'), 'enabled');
  await previewPanel.getByTestId('pw-start').click();
  await expect(previewPanel.getByLabel('Preview message', { exact: true })).toBeEnabled();
  await previewPanel.getByLabel('Preview message', { exact: true }).fill('Find my order');
  await previewPanel.getByRole('button', { name: 'Send preview message' }).click();
  await expect(previewPanel.getByText('I can help you track an order or resolve an issue. Could you share your order number so I can find the right details?', { exact: true })).toBeVisible();
  await previewPanel.getByRole('button', { name: /trace/ }).last().click();
  const trace = previewPanel.getByRole('region', { name: 'Planner trace' });
  await expect(trace).toBeVisible();
  await expect(trace.locator('details[open]')).toHaveCount(0);
  await trace.getByRole('button', { name: 'Expand all payloads' }).click();
  await expect.poll(() => trace.locator('details[open]').count()).toBeGreaterThan(0);
  await trace.getByRole('button', { name: 'Collapse all payloads' }).click();
  await expect(trace.locator('details[open]')).toHaveCount(0);
  await expect(trace.getByRole('button', { name: 'Expand all payloads' })).toBeVisible();
  // Native capture can precede Chromium's paint after a disclosure changes.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-compact-suite-trace.png'));
  await previewPanel.getByRole('button', { name: 'End', exact: true }).click();
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 900));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  expect(await previewPanel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('preview-compact-narrow-light.png'));
  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests').getByTestId('studio-tests-pane');
  await expect(tests.getByTestId('tests-row-c24')).toContainText('Setup required');
  await tests.getByTestId('tests-row-c24').click();
  await expect(tests.getByLabel('I prepared this case for this session')).toBeVisible();
  await expect(tests).toContainText('AI opinion: not evaluated');
  // A gated response proves Stop reaches the running session, not just the view.
  const current: any = await action('suites.list');
  expect(await page.evaluate(({ projectId, expectedSha256 }) => window.cc.pluginApps.callRpc('salesforce', 'studio.suites.save', { projectId, agentPath: 'force-app/Large.agent', expectedSha256, cases: [{ id: 'held', name: 'Held case', utterances: ['Suite progress first case'], expect: { contains: ['order'], forbiddenActions: ['SendSignature'], stateChecks: [{ variable: 'orderExists', value: false }] } }] }), { projectId, expectedSha256: current.suites.find((s: any) => s.id === 'Large').sha256 })).toMatchObject({ ok: true });
  writeFileSync(join(home, 'suite-first'), 'hold');
  await showScript(page); await openTool(studio, 'Tests');
  await expect(tests.getByTestId('tests-row-held')).toBeVisible();
  await tests.getByRole('button', { name: 'Run all in Simulate', exact: true }).click();
  await expect(tests.getByRole('button', { name: 'Stop suite', exact: true })).toBeVisible();
  await tests.getByRole('button', { name: 'Stop suite', exact: true }).click();
  rmSync(join(home, 'suite-first'), { force: true });
  expect(await page.evaluate(projectId => window.cc.pluginApps.callRpc('salesforce', 'studio.suites.spec', { projectId, agentPath: 'force-app/Large.agent' }), projectId)).toMatchObject({ ok: false, error: expect.stringContaining('Org export would lose those checks') });
  await expect(tests.getByRole('status').filter({ hasText: 'Suite stopped' })).toBeVisible({ timeout: 15000 });
  await expect(tests.getByRole('button', { name: 'Run all in Simulate', exact: true })).toBeEnabled();
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 900));
  await tests.getByRole('button', { name: '+ Case', exact: true }).click();
  const form = tests.getByRole('form', { name: 'New test case' });
  await expect(form.getByLabel('Setup prerequisites, one per line')).toBeVisible();
  await expect(form.getByLabel('Final state checks (JSON)')).toBeVisible();
  await expect.poll(() => form.evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length)).toBe(1);
  expect(await form.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-reliable-tests-narrow.png'));
});

test('Studio footer: inspect saved failures, filter cases and rerun the open agent', async ({ app, home }, testInfo) => {
  const page = app.window;
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'salesforce')?.status), { timeout: 30000 }).toMatch(/running|needs-configuration/);
  const projectId = await page.evaluate(async path => { const added = await window.cc.projects.add(path); if (!added.ok) throw Error(added.message); return added.value.id; }, join(home, 'dx'));
  await page.evaluate(async id => {
    await window.cc.pluginApps.setSettings('salesforce', { defaultOrg: 'studio' });
    history.pushState({}, '', `/projects/${id}`); window.dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  const rpc = (method: string, args: object = {}): Promise<any> => page.evaluate(({ projectId, method, args }) => window.cc.pluginApps.callRpc('salesforce', method, { projectId, ...args }), { projectId, method, args });
  expect(await rpc('studio.suites.save', { agentPath: 'force-app/Support.agent', cases: [
    { id: 'footer-pass', name: 'Footer order lookup', utterances: ['Find my order'], expect: { contains: ['order'] } },
    { id: 'footer-fail', name: 'Footer missing evidence', utterances: ['Find my order'], expect: { contains: ['missing-footer-evidence'] } },
    { id: 'footer-pending', name: 'Footer unrun case', utterances: ['Find my order'], expect: {} }
  ] })).toMatchObject({ ok: true });
  expect(await rpc('studio.suites.run', { agentPath: 'force-app/Support.agent', caseIds: ['footer-pass', 'footer-fail'] })).toMatchObject({ ok: true });
  await page.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await page.getByTestId('salesforce-workbench').getByRole('tab', { name: 'Agentforce', exact: true }).click();
  const studio = studioPanel(page);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  const bottom = studio.getByRole('region', { name: 'Studio panel', exact: true });
  await bottom.getByRole('tab', { name: /^Tests/ }).click();
  const footer = bottom.getByRole('region', { name: 'Saved scenario results', exact: true });
  await expect(footer).toContainText('1 passed');
  await expect(footer).toContainText('1 failed');
  await expect(footer).toContainText('1 not run');
  await expect(bottom.getByRole('tab', { name: /^Tests/ })).toContainText('1');
  await footer.locator('summary').filter({ hasText: 'Support.scenario.json' }).click();
  await footer.getByRole('button', { name: 'Footer missing evidence', exact: true }).click();
  const details = footer.getByRole('region', { name: 'Details for Footer missing evidence', exact: true });
  await expect(details).toContainText('Expected vs actual');
  await expect(details).toContainText('Actual: Not in the reply');
  await details.getByRole('button', { name: 'Close details' }).click();
  await footer.getByRole('button', { name: 'Failed only' }).click();
  await expect(footer.getByRole('button', { name: 'Footer order lookup', exact: true })).toHaveCount(0);
  await expect(footer.getByRole('button', { name: 'Footer missing evidence', exact: true })).toBeVisible();
  await footer.getByRole('searchbox', { name: 'Search scenario cases' }).fill('no such case');
  await expect(footer.getByText('No matching cases.')).toBeVisible();
  await footer.getByRole('searchbox').fill('');
  const before = await rpc('studio.suites.list', { agentPath: 'force-app/Support.agent' });
  await footer.getByRole('button', { name: 'Rerun failed (1)', exact: true }).click();
  await expect(footer.getByText('Rerun complete. Results saved.')).toBeVisible({ timeout: 30000 });
  const after = await rpc('studio.suites.list', { agentPath: 'force-app/Support.agent' });
  expect(after.suites[0].lastResults['footer-fail'].at).toBeGreaterThan(before.suites[0].lastResults['footer-fail'].at);
  expect(after.suites[0].lastResults['footer-pass'].at).toBe(before.suites[0].lastResults['footer-pass'].at);
  expect(after.suites[0].lastResults).not.toHaveProperty('footer-pending');
  expect(await footer.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('studio-footer-results.png'));
  await footer.getByRole('button', { name: 'Open Tests', exact: true }).click();
  await expect(viewPane(page, 'tests')).toBeVisible();
});

test('Agentforce Studio: pane dividers resize smoothly, persist and adapt to narrow containers', async ({ app, home }, testInfo) => {
  const page = app.window;
  await page.setViewportSize({ width: 1920, height: 1080 });
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
  const studio = studioPanel(page);
  await studio.getByTestId('salesforce-agent-script-file:force-app/Support.agent').click();
  const iframe = studio.locator('iframe[title="Agentforce playground"]');
  await expect(page.frameLocator('iframe[title="Agentforce playground"]').getByTestId('agent-script-ide')).toBeVisible();
  await iframe.evaluate(el => { el.dataset.resizeIdentity = 'original'; });

  const drag = async (handle: Locator, dx: number, dy = 0) => {
    const bounds = (await handle.boundingBox())!;
    expect(Math.min(bounds.width, bounds.height)).toBeGreaterThanOrEqual(8.9);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2 + dy, { steps: 8 }); await page.mouse.up();
    await expect(handle).toHaveAttribute('data-resizing', 'false');
  };
  const explorer = studio.locator('.sf-explorer-col');
  const explorerHandle = studio.getByRole('separator', { name: 'Resize explorer' });
  const explorerBounds = (await explorer.boundingBox())!;
  const explorerGrip = (await explorerHandle.boundingBox())!;
  expect(Math.abs(explorerGrip.x + explorerGrip.width - explorerBounds.x - explorerBounds.width)).toBeLessThan(1);
  expect(Math.abs(explorerGrip.height - explorerBounds.height)).toBeLessThan(1);
  const explorerBefore = explorerBounds.width;
  await drag(explorerHandle, 80);
  await expect.poll(async () => (await explorer.boundingBox())!.width).toBeGreaterThan(explorerBefore + 60);
  await expect(iframe).toHaveAttribute('data-resize-identity', 'original');
  await explorerHandle.dblclick();
  await expect.poll(async () => Math.round((await explorer.boundingBox())!.width)).toBe(260);

  const bottom = studio.getByRole('region', { name: 'Studio panel' });
  await bottom.getByRole('tab', { name: /^Problems/ }).click();
  const bottomBefore = (await bottom.boundingBox())!.height;
  await drag(bottom.getByRole('separator', { name: 'Resize bottom panel' }), 0, -70);
  await expect.poll(async () => (await bottom.boundingBox())!.height).toBeGreaterThan(bottomBefore + 50);
  await bottom.getByRole('button', { name: 'Collapse panel' }).click();

  await openTool(studio, 'Tests');
  const tests = viewPane(page, 'tests');
  await tests.getByRole('group', { name: 'Tests view' }).getByRole('button', { name: 'Role-play' }).click();
  const lab = tests.getByTestId('agentforce-lab');
  const divider = lab.getByRole('separator', { name: 'Resize conversation and evidence' });
  await expect(divider).toHaveAttribute('aria-orientation', 'vertical');
  const chat = lab.getByRole('region', { name: 'Conversation', exact: true });
  const chatBefore = (await chat.boundingBox())!.width;
  await drag(divider, 120);
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeGreaterThan(chatBefore + 90);
  const saved = await divider.getAttribute('aria-valuenow');
  await showScript(page); await openTool(studio, 'Tests');
  await expect(divider).toHaveAttribute('aria-valuenow', saved!);
  await divider.focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(Number(saved));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`resizable-panes-${theme}.png`));
  }

  await page.setViewportSize({ width: 900, height: 1080 });
  await expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
  const heightBefore = (await chat.boundingBox())!.height;
  await drag(divider, 0, 70);
  await expect.poll(async () => (await chat.boundingBox())!.height).toBeGreaterThan(heightBefore + 45);
  await expect.poll(() => lab.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('resizable-panes-narrow.png'));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(divider).toHaveAttribute('aria-orientation', 'vertical');
  await divider.dblclick(); await expect(divider).toHaveAttribute('aria-valuenow', '48');

  await tests.getByRole('group', { name: 'Tests view' }).getByRole('button', { name: 'Batch simulations', exact: true }).click();
  const catalogueHandle = tests.getByRole('separator', { name: 'Resize scenario catalogue and editor' });
  const catalogue = tests.getByRole('complementary', { name: 'Scenario catalogue' });
  const catalogueBefore = (await catalogue.boundingBox())!.width;
  await drag(catalogueHandle, 80);
  await expect.poll(async () => (await catalogue.boundingBox())!.width).toBeGreaterThan(catalogueBefore + 60);
  const simulations = tests.getByTestId('studio-simulations');
  await simulations.getByRole('button', { name: /^Run \d+ conversations?$/ }).click();
  const conversations = simulations.getByRole('list', { name: 'Conversations', exact: true });
  await expect(conversations).toBeVisible();
  const resultsBefore = (await conversations.boundingBox())!.width;
  await drag(simulations.getByRole('separator', { name: 'Resize conversations and result details' }), 80);
  await expect.poll(async () => (await conversations.boundingBox())!.width).toBeGreaterThan(resultsBefore + 60);

  await expect(iframe).toHaveAttribute('data-resize-identity', 'original');
});
