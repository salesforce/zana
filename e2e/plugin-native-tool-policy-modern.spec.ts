/** Real SDK -> shipped Claude bridge -> daemon-authenticated host route -> plugin policy.
 * Only the model/CLI is scripted; runtime, identity, callback and veto stay production code.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import { test as base, expect, type AppHandle } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';
import { BUILTIN_PLUGINS } from '../apps/server/src/plugins/builtin-registry.js';

const pluginId = 'native-tool-policy-probe';
const reason = 'Aida native veto fixture denied Bash';
const fixture = fileURLToPath(new URL('./fixtures/plugins/native-tool-policy-probe', import.meta.url));
const claudeFixture = fileURLToPath(new URL('./fixtures/claude-native-tool-policy.cjs', import.meta.url));
const codexFixture = fileURLToPath(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url));

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'native-policy-bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), `#!${process.execPath}\nrequire(${JSON.stringify(claudeFixture)});\n`, { mode: 0o700 });
    const script = join(home, 'codex-script.json');
    writeFileSync(script, JSON.stringify({ modelId: 'native-policy-codex', messageText: 'Codex native veto is wired' }));
    writeFileSync(join(bin, 'codex'), `#!${process.execPath}\n
if (process.argv.includes('--version')) { console.log('codex-cli 0.154.0'); process.exit(0); }
if (!process.argv.includes('app-server')) process.exit(64);
process.argv = [process.execPath, ${JSON.stringify(codexFixture)}, ${JSON.stringify(script)}];
import(${JSON.stringify(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url).href)});
`, { mode: 0o700 });
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) {
      writeFileSync(join(home, name), `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`);
    }
    const root = join(home, 'native-policy-plugin');
    cpSync(fixture, root, { recursive: true });
    const store = join(home, '.zcc/plugins');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
      id: pluginId, version: '0.1.0', name: 'Native Tool Policy Probe', enabled: true, status: 'running',
      provenance: 'direct', sourceKind: 'path', source: `path:${root}`, rootDir: root,
      serverEntry: './server.ts', appEntry: null, installedAt: Date.now(), updatedAt: Date.now()
    }] }));
    // Explicit fixture binary avoids the shared app fixture's disabled-Claude guard.
    writeFileSync(join(home, '.zcc/config.json'), JSON.stringify({ walkthroughCompleted: true, setupDismissed: true,
      sponsorPromptDismissed: true, teamJobLaunchEnabled: true, tmuxScope: 'off', autoRenameTabs: false,
      claudeBinary: join(bin, 'claude'), codexBinary: join(bin, 'codex') }));
    await use({ PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ZDOTDIR: home,
      ZCC_CLAUDE_CODE_EXECUTABLE: join(bin, 'claude') });
  }
});
test.setTimeout(180_000);

type PolicyEvent = { invocationId: string; threadId: string; projectId: string; providerId: string; toolName: string; input: Record<string, unknown> };
type ProviderRow = { phase: string; label: string; sessionId: string; decision: string; reason?: string; callbacks?: string[];
  outputs?: Array<{ hookSpecificOutput?: { hookEventName: string; permissionDecision: string; permissionDecisionReason?: string } }>;
  exitCode?: number | null; elapsedMs?: number };
const rpc = <T,>(page: Page, method: string, args?: unknown) =>
  page.evaluate(({ pluginId, method, args }) => window.cc.pluginApps.callRpc(pluginId, method, args), { pluginId, method, args }) as Promise<T>;
async function attachProof(testInfo: TestInfo, name: string, proof: unknown) {
  const path = testInfo.outputPath(name);
  writeFileSync(path, JSON.stringify(proof, null, 2));
  await testInfo.attach(name, { contentType: 'application/json', path });
}
const providerRows = (cwd: string): ProviderRow[] => {
  const path = join(cwd, '.native-policy-provider.jsonl');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return text.slice(0, text.lastIndexOf('\n')).split('\n').filter(Boolean).map(line => JSON.parse(line));
};
const thread = (page: Page, id: string) => page.evaluate(async id => {
  const response = await fetch(`/api/v1/threads/${id}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).thread as { id: string; status: string; providerId: string; providerThreadId: string; cwd: string; visibility: string };
}, id);

async function setup(app: AppHandle) {
  const page = app.window;
  await expect.poll(() => page.evaluate(async id => (await window.cc.pluginApps.list()).find(row => row.id === id)?.status, pluginId), { timeout: 45_000 }).toBe('running');
  await waitForThreadProvider(page, 'claude-code');
  await waitForThreadProvider(page, 'codex');
  const plugins = await page.evaluate(() => window.cc.pluginApps.list());
  // Unconfigured unrelated integration must not remain an unsealed policy owner.
  if (plugins.some(row => row.id === 'salesforce')) {
    expect(await page.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', false))).toMatchObject({ ok: true });
  }
  await expect.poll(() => {
    const { plugins } = JSON.parse(readFileSync(join(app.home, '.zcc/plugins/installed.json'), 'utf8'));
    return [
      ...BUILTIN_PLUGINS.filter(row => row.autoInstall && !plugins.some((installed: { id: string }) => installed.id === row.pluginId)).map(row => row.pluginId),
      ...plugins.filter((row: { enabled: boolean; serverEntry?: string; toolPolicy?: string }) => row.enabled && row.serverEntry && !['true', 'false'].includes(row.toolPolicy ?? ''))
    ];
  }, { timeout: 45_000 }).toEqual([]);
  const root = join(app.home, 'native-policy-project');
  mkdirSync(root);
  const cwd = realpathSync(root);
  const projectId = await page.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    return project.value.id;
  }, cwd);
  const start = (providerId = 'claude-code', input = 'Native fixture standby') => page.evaluate(async body => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return (result.thread ?? result.value).id as string;
  }, { projectId, providerId, input, permissionMode: 'accept-edits' });
  const send = async (id: string, label: string) => {
    await expect.poll(async () => (await thread(page, id)).status, { timeout: 30_000 }).toBe('idle');
    await page.evaluate(async ({ id, text }) => {
      const response = await fetch(`/api/v1/threads/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, mode: 'queue-if-active' }) });
      if (!response.ok) throw new Error(await response.text());
    }, { id, text: `NATIVE_POLICY:${label}` });
  };
  return { page, cwd, projectId, start, send };
}

async function settled(page: Page, id: string, cwd: string, label: string, decision: 'allow' | 'deny') {
  let row: ProviderRow | undefined;
  await expect.poll(() => {
    row = providerRows(cwd).find(row => row.phase === 'settled' && row.label === label);
    return row?.decision;
  }, { timeout: 30_000 }).toBe(decision);
  const attempt = providerRows(cwd).find(row => row.phase === 'attempt' && row.label === label)!;
  expect(attempt.callbacks?.length, 'SDK must register actual PreToolUse callbacks').toBeGreaterThan(0);
  expect(existsSync(join(cwd, `.native-policy-${label}.marker`))).toBe(decision === 'allow');
  if (decision === 'allow') expect(readFileSync(join(cwd, `.native-policy-${label}.marker`), 'utf8')).toBe(`NATIVE_SIDE_EFFECT:${label}`);
  else {
    expect(row!.exitCode, 'Denied Bash must never reach the shell').toBeNull();
    expect(row!.outputs, 'Production SDK callback must return deny, not fixture-local timeout').toEqual(expect.arrayContaining([
      expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ hookEventName: 'PreToolUse',
        permissionDecision: 'deny', permissionDecisionReason: row!.reason }) })
    ]));
  }
  await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  await expect(page.getByTestId('thread-timeline')).toContainText(`NATIVE_POLICY_RESULT:${label}:${decision}`, { timeout: 30_000 });
  await expect.poll(async () => (await thread(page, id)).status).toBe('idle');
  return row!;
}

test('Modern Claude native Bash veto reaches plugin; allow control, error and timeout fail closed', async ({ app }, testInfo) => {
  const probe = await setup(app);
  await rpc(probe.page, 'setMode', { mode: 'allow' });
  const id = await probe.start();
  await probe.send(id, 'allow');
  expect((await settled(probe.page, id, probe.cwd, 'allow', 'allow')).exitCode).toBe(0);
  const capability = await rpc<{ capabilities: unknown[] }>(probe.page, 'capabilities', { threadId: id });
  expect(capability.capabilities).toContainEqual({ id: 'tool-before-native', available: true });
  for (const mode of ['deny', 'throw', 'hang']) {
    await rpc(probe.page, 'setMode', { mode });
    await probe.send(id, mode);
    const result = await settled(probe.page, id, probe.cwd, mode, 'deny');
    if (mode === 'deny') expect(result.reason).toBe(reason);
    else expect(result.reason).toMatch(/unavailable|timed out/i);
    if (mode === 'hang') {
      expect(result.elapsedMs, 'Hanging plugin must exercise the real deadline').toBeGreaterThanOrEqual(4_500);
      expect(result.elapsedMs, 'Production deadline must precede fixture watchdog').toBeLessThan(15_000);
    }
  }
  const events = await rpc<PolicyEvent[]>(probe.page, 'events');
  expect(events.filter(row => row.threadId === id)).toHaveLength(4);
  const nativeId = (await thread(probe.page, id)).providerThreadId;
  for (const row of events) {
    expect(row).toMatchObject({ threadId: id, projectId: probe.projectId, providerId: 'claude-code', toolName: 'Bash', input: { token: '[REDACTED]' } });
    expect(row.invocationId).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(providerRows(probe.cwd).filter(row => row.phase === 'attempt').map(row => row.sessionId)).toEqual(Array(4).fill(nativeId));
  await attachProof(testInfo, 'individual-native-policy-proof.json', {
    thread: await thread(probe.page, id), events, provider: providerRows(probe.cwd), capabilities: capability.capabilities,
    markers: Object.fromEntries(['allow', 'deny', 'throw', 'hang'].map(label => [label, existsSync(join(probe.cwd, `.native-policy-${label}.marker`))]))
  });
});

test('Modern Claude cannot execute Bash after its required policy worker disappears', async ({ app }, testInfo) => {
  const probe = await setup(app);
  const id = await probe.start();
  await expect.poll(async () => (await thread(probe.page, id)).status).toBe('idle');
  await rpc(probe.page, 'crash');
  await expect.poll(() => probe.page.evaluate(async id => (await window.cc.pluginApps.list()).find(row => row.id === id)?.status, pluginId)).not.toBe('running');
  const policyWorker = await probe.page.evaluate(async id => (await window.cc.pluginApps.list()).find(row => row.id === id), pluginId);
  expect(policyWorker, 'Required plugin must remain installed after worker crash').toMatchObject({ id: pluginId, enabled: true });
  const installed = JSON.parse(readFileSync(join(app.home, '.zcc/plugins/installed.json'), 'utf8'));
  expect(installed.plugins.find((row: { id: string }) => row.id === pluginId)).toMatchObject({ enabled: true, toolPolicy: 'true' });
  await probe.send(id, 'missing-worker');
  expect((await settled(probe.page, id, probe.cwd, 'missing-worker', 'deny')).reason).toMatch(/not ready|unavailable|policy/i);
  await attachProof(testInfo, 'crashed-worker-native-policy-proof.json', {
    policyWorker, provider: providerRows(probe.cwd), markerExists: existsSync(join(probe.cwd, '.native-policy-missing-worker.marker'))
  });
});

test('Modern mixed squad launches with Codex native-veto descriptor and Claude member veto', async ({ app }, testInfo) => {
  const probe = await setup(app);
  const planPath = join(probe.cwd, 'plan.md');
  writeFileSync(join(probe.cwd, 'README.md'), 'Native policy squad fixture.\n');
  writeFileSync(planPath, '# Native policy squad\n\n### inspect: Inspect <!-- executable-step -->\n- **Work:** Stand by.\n- **Depends on:** None\n- **Mode:** read-only\n- **Verification:** README.md exists.\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: probe.cwd, env: { ...process.env, HOME: app.home }, timeout: 15_000 });
  git('init', '-b', 'main');
  git('add', 'README.md', 'plan.md');
  git('-c', 'user.name=Native Policy E2E', '-c', 'user.email=native-policy@example.test', 'commit', '-m', 'Fixture setup');
  await probe.page.evaluate(async () => {
    for (const persona of [{ id: 'native-claude-worker', baseProfile: 'claude', model: 'sonnet' },
      { id: 'native-codex-coordinator', baseProfile: 'codex', model: 'native-policy-codex' }]) {
      const saved = await window.cc.personas.save({ ...persona, name: persona.id, permissionMode: 'acceptEdits' });
      if (!saved.ok) throw new Error(JSON.stringify(saved));
    }
    const saved = await window.cc.teams.save({ id: 'native-policy-squad', name: 'Native policy mixed squad',
      transport: 'MODERN', worktreeIsolation: true, routingEnforced: false,
      slots: [{ personaId: 'native-claude-worker', quantity: 1 }], orchestratorPersonaId: 'native-codex-coordinator' });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
  });
  const launched = await probe.page.evaluate(input => window.cc.teams.startJob(input), {
    teamId: 'native-policy-squad', projectId: probe.projectId, title: 'Native policy mixed squad',
    goal: `implement ${planPath}`, coordinationMode: 'structured' as const
  });
  expect(launched.ok, JSON.stringify(launched)).toBe(true);
  if (!launched.ok) throw new Error(JSON.stringify(launched));
  const executionId = launched.value.executionId;
  try {
    const userData = await app.electron.evaluate(({ app }) => app.getPath('userData'));
    const members = () => {
      const path = join(userData, 'team-lifecycle.json');
      if (!existsSync(path)) return [];
      const store = JSON.parse(readFileSync(path, 'utf8'));
      return store.records.find((row: { workers: Array<{ modernContext?: { executionId: string } }> }) => row.workers.some(member => member.modernContext?.executionId === executionId))?.workers ?? [];
    };
    await expect.poll(() => members().filter((row: { transport: string; bindingState: string; process: string }) => row.transport === 'MODERN' && row.bindingState === 'BOUND' && row.process === 'running').length, { timeout: 45_000 }).toBe(2);
    const worker = members().find((row: { modernContext: { role: string } }) => row.modernContext.role === 'worker');
    const coordinator = members().find((row: { modernContext: { role: string } }) => row.modernContext.role === 'orchestrator');
    expect(await probe.page.evaluate(id => window.cc.terminals.list(id), probe.projectId)).toEqual([]);
    expect(await thread(probe.page, coordinator.threadId)).toMatchObject({ providerId: 'codex', visibility: 'visible' });
    // Codex routes commands and file changes through decideNativeTool, but that is not
    // proven live and web search / MCP calls raise no approval, so the descriptor
    // honestly reports the veto as unavailable with the limit stated (OBL-019).
    const descriptor = await rpc<{ capabilities: Array<{ id: string; available: boolean; reason?: string }> }>(probe.page, 'capabilities', { threadId: coordinator.threadId });
    expect(descriptor.capabilities.find(row => row.id === 'tool-before-native')).toMatchObject({
      available: false, reason: expect.stringContaining('not advertised as a full veto')
    });
    const workerThread = await thread(probe.page, worker.threadId);
    expect(workerThread).toMatchObject({ providerId: 'claude-code', visibility: 'hidden' });
    expect(workerThread.cwd).not.toBe(probe.cwd);
    await probe.send(worker.threadId, 'squad-deny');
    expect((await settled(probe.page, worker.threadId, workerThread.cwd, 'squad-deny', 'deny')).reason).toBe(reason);
    const events = await rpc<PolicyEvent[]>(probe.page, 'events');
    expect(events.find(row => row.threadId === worker.threadId)).toMatchObject({ projectId: probe.projectId, providerId: 'claude-code', toolName: 'Bash' });
    await attachProof(testInfo, 'squad-native-policy-proof.json', {
      executionId, members: members(), workerThread, codex: descriptor, events, provider: providerRows(workerThread.cwd),
      markerExists: existsSync(join(workerThread.cwd, '.native-policy-squad-deny.marker'))
    });
  } finally {
    const snapshot = await probe.page.evaluate(({ projectId, executionId }) => window.cc.executionBoard.snapshot(projectId, executionId, 0), { projectId: probe.projectId, executionId });
    if (snapshot) await probe.page.evaluate(({ projectId, executionId, version }) => window.cc.executionBoard.stop(projectId, executionId, version),
      { projectId: probe.projectId, executionId, version: snapshot.execution.stateVersion ?? 0 });
  }
});
