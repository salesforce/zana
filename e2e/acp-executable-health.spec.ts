import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

test.use({
  initialConfig: { sponsorPromptDismissed: true, providerBridgeRecordingEnabled: true },
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'shadow-bin');
    mkdirSync(bin);
    // The inherited PATH intentionally selects a dead wrapper. An explicit
    // native binary must select the working executable for every ACP operation.
    writeFileSync(join(bin, 'opencode'), `#!${process.execPath}\nconsole.error('shadow wrapper dependency is missing'); process.exit(127);\n`, { mode: 0o700 });
    const init = `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`;
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(home, name), init);
    await use({ PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ZDOTDIR: home,
      ZCC_PROVIDER_BRIDGE_RECORD_DIR: join(home, 'acp-health-recordings') });
  },
});

type Launch = { identity: string; args: string[]; cwd: string; home: string; context?: string };
function launches(home: string): Launch[] {
  const path = join(home, 'acp-launches.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

function healthMessages(home: string, command?: string): Array<{ status: string; installedVersion?: string; statusMessage?: string }> {
  const root = join(home, 'acp-health-recordings');
  if (!existsSync(root)) return [];
  const records = readdirSync(root, { recursive: true }).map(String)
    .filter(path => ['bridge→runtime.ndjson', 'runtime→bridge.ndjson'].includes(basename(path)))
    .flatMap(path => readFileSync(join(root, path), 'utf8').trim().split('\n').filter(Boolean).flatMap(line => {
      try { const entry = JSON.parse(line); return [{ ...entry, message: JSON.parse(entry.line) }]; }
      catch { return []; }
    }));
  const requests = new Set(records.filter(({ message }) => message.method === 'provider/health'
    && message.params.providerId === 'acp-opencode'
    && (command === undefined || message.params.providerOptions?.acpLaunchSpec?.command === command))
    .map(({ run, message }) => `${run}:${message.id}`));
  return records.filter(({ run, message }) => message.result?.health && requests.has(`${run}:${message.id}`))
    .sort((a, b) => a.ts - b.ts).map(({ message }) => message.result.health);
}

test.afterEach(async ({ app }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach('launches-on-failure', { body: JSON.stringify(launches(app.home), null, 2), contentType: 'application/json' });
  const root = join(app.home, 'acp-health-recordings', '_process');
  for (const name of ['runtime→bridge.ndjson', 'bridge→runtime.ndjson', 'provider→bridge.ndjson']) {
    const file = join(root, name);
    if (existsSync(file)) await testInfo.attach(name, { path: file, contentType: 'application/x-ndjson' });
  }
});

function writeAgent(home: string, identity: string, modelCount: number): string {
  const command = join(home, `agent ${identity}`);
  const fakeAgent = new URL('../plugins/provider-acp/src/bridge/fake-acp-agent.mjs', import.meta.url).href;
  writeFileSync(command, `#!${process.execPath}\n
const { appendFileSync } = await import('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(home, 'acp-launches.jsonl'))}, JSON.stringify({ identity: ${JSON.stringify(identity)}, args, cwd: process.cwd(), home: process.env.HOME, context: process.env.LAUNCH_CONTEXT }) + '\\n');
if (process.env.EXPECTED_CWD && (process.cwd() !== process.env.EXPECTED_CWD || process.env.LAUNCH_CONTEXT !== 'configured-context')) { console.error('configured launch context was lost'); process.exit(42); }
if (args.includes('--version')) { console.log(${JSON.stringify(`fixture ${identity === 'first' ? '1.2.3' : '2.3.4'}`)}); process.exit(0); }
if (args[0] === 'models') { process.stdout.write(Array.from({ length: 1500 }, (_, i) => 'fixture-provider/model-' + i).join('\\n') + '\\n', () => process.exit(0)); }
else if (args[0] === 'acp') {
  process.env.FAKE_ACP_MODEL_CONFIG = '1'; process.env.FAKE_ACP_MODEL_COUNT = '${modelCount}';
  process.env.FAKE_ACP_PROMPT_PREFIX = 'HEALTH_E2E:';
  await import(${JSON.stringify(fakeAgent)});
} else { console.error('unexpected command'); process.exit(64); }
`, { mode: 0o700 });
  return command;
}

test('ACP uses native executable settings across health, large discovery, sessions and config refresh', async ({ app }, testInfo) => {
  test.setTimeout(180_000);
  const projectPath = join(app.home, 'acp-project');
  mkdirSync(projectPath);
  const first = writeAgent(app.home, 'first', 400);
  const second = writeAgent(app.home, 'second', 450);
  await waitForThreadProvider(app.window, 'acp-opencode');
  const project = await app.window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }, projectPath);
  const setBinary = (binary: string) => app.window.evaluate(binary => window.cc.config.set({
    harnesses: { byId: { opencode: { binary, enabled: true } } },
  }), binary);
  const discover = (providerId: string) => app.window.evaluate(async ({ projectId, providerId }) => {
    const response = await fetch(`/api/v1/system/execution-options?providerId=${providerId}&projectId=${projectId}&refresh=1`);
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    return { body: JSON.parse(text), bytes: new TextEncoder().encode(text).byteLength };
  }, { projectId: project.id, providerId });
  const start = (providerId: string, input: string) => app.window.evaluate(async ({ projectId, providerId, input }) => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId, input: 'HEALTH_E2E:' + input, permissionMode: 'full', model: 'fake/default' }) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, { projectId: project.id, providerId, input });
  const openThread = async (id: string) => {
    await app.window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
    return app.window.getByTestId('thread-timeline');
  };

  await setBinary(first);
  const listed = await discover('acp-opencode');
  expect(listed.bytes).toBeGreaterThan(8192);
  expect(JSON.stringify(listed.body.models)).toContain('fake/gen-399');
  expect(listed.body.modelLoadError).toBeNull();
  await expect.poll(() => healthMessages(app.home).some(row => row.status === 'ready' && row.installedVersion === '1.2.3')).toBe(true);
  const firstThread = await start('acp-opencode', 'first configured executable');
  await expect(await openThread(firstThread)).toContainText('echo:first configured executable', { timeout: 30_000 });
  await setBinary(second);
  const refreshed = await discover('acp-opencode');
  expect(JSON.stringify(refreshed.body.models)).toContain('fake/gen-449');
  await expect.poll(() => healthMessages(app.home).some(row => row.status === 'ready' && row.installedVersion === '2.3.4')).toBe(true);
  const secondThread = await start('acp-opencode', 'second configured executable');
  await expect(await openThread(secondThread)).toContainText('echo:second configured executable', { timeout: 30_000 });

  // A plugin-owned explicit ACP launch is independent of the native setting.
  const custom = { id: 'acp-health-fixture', displayName: 'Context fixture', command: first, args: ['acp'],
    cwd: realpathSync(projectPath), env: { EXPECTED_CWD: realpathSync(projectPath), LAUNCH_CONTEXT: 'configured-context' } };
  await app.window.evaluate(custom => window.cc.pluginApps.setSettings('provider-acp', { customAgents: JSON.stringify([custom]) }), custom);
  await waitForThreadProvider(app.window, custom.id);
  const customModels = await discover(custom.id);
  await testInfo.attach('custom-models', { body: JSON.stringify(customModels.body), contentType: 'application/json' });
  expect(JSON.stringify(customModels.body.models)).toContain('fake/gen-399');
  const customThread = await start(custom.id, 'explicit context survived');
  await expect(await openThread(customThread)).toContainText('echo:explicit context survived', { timeout: 30_000 });
  const invoked = launches(app.home);
  expect(invoked.some(row => row.identity === 'first' && row.args[0] === 'acp')).toBe(true);
  expect(invoked.some(row => row.identity === 'second' && row.args[0] === 'acp')).toBe(true);
  expect(invoked.some(row => row.context === 'configured-context' && row.args.includes('--version') && row.cwd === realpathSync(projectPath))).toBe(true);
  expect(invoked.every(row => row.home === app.home)).toBe(true);
  await testInfo.attach('launches', { body: JSON.stringify(invoked, null, 2), contentType: 'application/json' });
});

test('broken, missing and timed-out ACP executables never report healthy and expose launch failures', async ({ app }) => {
  test.setTimeout(180_000);
  await waitForThreadProvider(app.window, 'acp-opencode');
  const projectPath = join(app.home, 'failure-project');
  mkdirSync(projectPath);
  const project = await app.window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }, projectPath);
  const check = async (binary: string, status: string, message: string) => {
    const previous = healthMessages(app.home, binary).length;
    await app.window.evaluate(binary => window.cc.config.set({ harnesses: { byId: { opencode: { binary, enabled: true } } } }), binary);
    await app.window.evaluate(async projectId => {
      const response = await fetch(`/api/v1/system/execution-options?providerId=acp-opencode&projectId=${projectId}&refresh=1`);
      if (!response.ok) throw new Error(await response.text());
    }, project.id);
    await expect.poll(() => healthMessages(app.home, binary).slice(previous).some(row => row.status === status && row.statusMessage?.includes(message)), { timeout: 20_000 }).toBe(true);
    expect(healthMessages(app.home, binary).slice(previous).some(row => row.status === 'ready')).toBe(false);
  };
  await check(join(app.home, 'shadow-bin', 'opencode'), 'unknown', 'shadow wrapper dependency is missing');
  await check(join(app.home, 'missing-agent'), 'not_installed', 'missing-agent');
  const hanging = join(app.home, 'hanging-agent');
  writeFileSync(hanging, `#!${process.execPath}\nif (process.argv.includes('--version')) setInterval(() => {}, 1000); else { console.error('startup dependency is unavailable'); process.exit(127); }\n`, { mode: 0o700 });
  await check(hanging, 'unknown', 'timed out');
  const created = await app.window.evaluate(async projectId => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'acp-opencode', input: 'show startup error', permissionMode: 'full' }) });
    const body = await response.json();
    return { status: response.status, body };
  }, project.id);
  const id = created.body.thread?.id ?? created.body.value?.id;
  if (id) {
    await app.window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
    await app.window.getByRole('button', { name: 'Command thread.start failed', exact: true }).click({ timeout: 30_000 });
    await expect(app.window.getByTestId('thread-timeline')).toContainText('startup dependency is unavailable', { timeout: 30_000 });
  } else {
    expect(created.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(created.body)).toContain('startup dependency is unavailable');
  }
});
