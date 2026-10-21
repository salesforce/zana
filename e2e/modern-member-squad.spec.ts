/**
 * Modern members, not merely a Modern owner: teams.startJob must create genuine
 * ACP conversations through the supervised runtime and never fall back to PTYs.
 * The shipped OpenCode bridge runs the existing fake ACP binary. The test plays
 * its model by calling the session's real DynamicTool MCP bridge, without
 * inventing member credentials, seeding records, or replacing runtime services.
 * Setup requires the opencode -> acp-opencode member mapping, successful trusted
 * Modern preflight, and the normal bound-member tool catalog. No
 * ZCC_FAKE_PROVIDER override is used: native-policy failures must stay failures.
 */
import { test as base, expect, type AppHandle } from './fixtures/app.js';
import type { Page } from '@playwright/test';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { BUILTIN_PLUGINS } from '../apps/server/src/plugins/builtin-registry.js';
import type { InstalledPluginRow } from '../apps/server/src/plugins/plugin-store.js';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureBin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');
const teamId = 'e2e-modern-member-squad';
const workerPersona = 'e2e-modern-member-worker';
const coordinatorPersona = 'e2e-modern-member-coordinator';
const commandPrefix = 'SQUAD_FIXTURE:';
const marker = 'MODERN_MEMBER_ASSIGNMENT_REACHED_PROVIDER';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'modern-member-bin');
    mkdirSync(bin);
    // Observe the real fixture's request boundary, not a later polling snapshot.
    // No runtime authority, tool-policy decisions, or ACP responses are replaced.
    writeFileSync(join(bin, 'opencode'), `#!/usr/bin/env node
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
if (process.argv[2] === 'acp') {
  let bindingId;
  const append = fs.appendFileSync;
  fs.appendFileSync = function(path, data, ...args) {
    if (path === process.env.FAKE_ACP_REQUEST_LOG) {
      const request = JSON.parse(String(data));
      if (request.method === 'session/new') {
        const bridge = request.params?.mcpServers?.find(server => server.name === 'zcc' && server.type === 'http');
        if (bridge) bindingId = new URL(bridge.url).pathname.split('/').pop();
      }
      if (bindingId && ['session/prompt', 'session/cancel'].includes(request.method)) {
        // Provider spawn env is scrubbed, so the isolated HOME is baked in here.
        const store = JSON.parse(fs.readFileSync(${JSON.stringify(join(home, 'electron-user-data', 'team-lifecycle.json'))}, 'utf8'));
        const record = store.records.find(row => row.workers.some(member => member.threadId === bindingId));
        const member = record?.workers.find(row => row.threadId === bindingId);
        request.lifecycleAtRequest = { threadId: bindingId, state: record?.state,
          bindingState: member?.bindingState, process: member?.process,
          capacityReleased: member?.capacityReleased, generation: member?.generation };
        data = JSON.stringify(request) + '\\n';
      }
    }
    return append.call(fs, path, data, ...args);
  };
  syncBuiltinESMExports();
}
await import(${JSON.stringify(new URL('./fixtures/bin/opencode', import.meta.url).href)});
`, { mode: 0o755 });
    await use({
      PATH: `${bin}${delimiter}${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_ACP_MODEL_CONFIG: '1', FAKE_ACP_MODE_CONFIG: '1',
      FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan', FAKE_ACP_HTTP_MCP: '1',
      FAKE_ACP_REQUEST_LOG: '.modern-acp-requests.jsonl',
      // Host instructions must not accidentally select fake-agent commands such
      // as "hang". Unscripted kickoff and assignment prompts settle normally.
      FAKE_ACP_PROMPT_PREFIX: commandPrefix
    });
  }
});

test.use({
  e2e: true,
  initialConfig: {
    teamJobLaunchEnabled: true, harnessOpenCodeEnabled: true,
    sponsorPromptDismissed: true, tmuxScope: 'off', autoRenameTabs: false
  }
});
test.setTimeout(120_000);

interface Member {
  sessionId: string;
  threadId: string;
  projectId: string;
  slotId: string;
  transport: string;
  process: string;
  generation: number;
  bindingState: string;
  capacityReleased: boolean;
  modernContext: { role: 'worker' | 'orchestrator'; executionId: string; providerId: string; worktreePath: string };
}
interface Lifecycle {
  id: string;
  state: string;
  workers: Member[];
}
interface Thread {
  id: string;
  status: string;
  providerId: string;
  providerThreadId: string | null;
  projectId: string;
  environmentId: string;
  cwd: string;
  visibility: string;
  isWorktree: boolean;
}
interface TimelineRow { kind: string; role?: string; text?: string }
interface Bridge {
  url: string;
  headers: Array<{ name: string; value: string }>;
}
interface ToolResult { isError?: boolean; content?: Array<{ text?: string }> }
interface ProviderRequest {
  method?: string;
  params?: { sessionId?: string; prompt?: unknown };
  lifecycleAtRequest?: Pick<Member, 'threadId' | 'bindingState' | 'process' | 'capacityReleased' | 'generation'> & { state: string };
}

function providerRequests(member: Member): ProviderRequest[] {
  const path = join(member.modernContext.worktreePath, '.modern-acp-requests.jsonl');
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  // A concurrent append can expose an unfinished final line. Only read complete
  // records; the next poll picks up the remainder without masking bad JSON.
  const lastNewline = raw.lastIndexOf('\n');
  return lastNewline < 0 ? [] : raw.slice(0, lastNewline).split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function readThread(page: Page, id: string): Promise<Thread> {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread;
  }, id);
}

async function timeline(page: Page, id: string): Promise<TimelineRow[]> {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}/timeline?segmentLimit=100`);
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.rows;
  }, id);
}

async function send(page: Page, id: string, command: string): Promise<void> {
  await page.evaluate(async ({ id, text }) => {
    const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, mode: 'queue-if-active' })
    });
    if (!response.ok) throw new Error(await response.text());
  }, { id, text: `${commandPrefix}${command}` });
}

async function memberBridge(page: Page, member: Member): Promise<Bridge> {
  await expect.poll(async () => (await readThread(page, member.threadId)).status).toBe('idle');
  await send(page, member.threadId, 'echo-mcp-server-config');
  let config = '';
  await expect.poll(async () => {
    config = (await timeline(page, member.threadId)).filter(row => row.role === 'assistant')
      .map(row => row.text ?? '').find(text => text.startsWith('mcp-server-config:')) ?? '';
    return config;
  }).not.toBe('');
  const servers = JSON.parse(config.slice('mcp-server-config:'.length)) as Array<Bridge & { name: string; type: string }>;
  const bridge = servers.find(server => server.name === 'zcc' && server.type === 'http');
  expect(bridge, 'ACP member must receive its session-scoped DynamicTool bridge').toBeTruthy();
  expect(new URL(bridge!.url).pathname).toBe(`/mcp/${member.threadId}`);
  return bridge!;
}

function rawBridgeCall(bridge: Bridge, method: string, params?: Record<string, unknown>) {
  return fetch(bridge.url, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', ...Object.fromEntries(bridge.headers.map(row => [row.name, row.value])) },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, ...(params ? { params } : {}) })
  });
}

async function callBridge(bridge: Bridge, method: string, params?: Record<string, unknown>) {
  const response = await rawBridgeCall(bridge, method, params);
  expect(response.status, `ACP bridge ${method} failed`).toBe(200);
  const body = await response.json();
  expect(body.error, `ACP bridge ${method}: ${JSON.stringify(body.error)}`).toBeUndefined();
  return body.result;
}

async function tool(bridge: Bridge, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return callBridge(bridge, 'tools/call', { name, arguments: args });
}
const toolText = (result: ToolResult) => (result.content ?? []).map(item => item.text ?? '').join('\n');
function success(result: ToolResult): void {
  expect(result.isError, toolText(result)).not.toBe(true);
}
function denied(result: ToolResult, reason: RegExp): void {
  expect(result.isError, toolText(result)).toBe(true);
  expect(toolText(result)).toMatch(reason);
}

async function setup(app: AppHandle) {
  const { window: page, home, electron } = app;
  const diagnostics: string[] = [];
  electron.process()?.stderr?.on('data', chunk => {
    diagnostics.push(String(chunk));
    if (diagnostics.length > 100) diagnostics.shift();
  });
  const projectDir = join(home, 'modern-member-project');
  mkdirSync(projectDir);
  const root = realpathSync(projectDir);
  const planPath = join(root, 'plan.md');
  writeFileSync(planPath, [
    '# Modern member probe', '', '### inspect: Inspect shared checkout <!-- executable-step -->',
    `- **Work:** Report ${marker} after reading README.md.`,
    '- **Depends on:** None', '- **Mode:** read-only',
    '- **Verification:** README.md contains Modern member fixture.', ''
  ].join('\n'));
  writeFileSync(join(root, 'README.md'), 'Modern member fixture.\n');
  // Only this disposable fixture repository is initialized; no product commit.
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env: { ...process.env, HOME: home } });
  git('init', '-b', 'main');
  git('add', 'README.md', 'plan.md');
  git('-c', 'user.name=Modern Squad E2E', '-c', 'user.email=modern-squad@example.test', 'commit', '-m', 'Seed fixture');
  const projectId = await page.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);
  await page.evaluate(async ({ teamId, workerPersona, coordinatorPersona }) => {
    for (const [id, name] of [[workerPersona, 'Modern probe worker'], [coordinatorPersona, 'Modern probe coordinator']]) {
      const result = await window.cc.personas.save({
        id, name, baseProfile: 'opencode', model: 'fake/default', permissionMode: 'default'
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
    }
    const result = await window.cc.teams.save({
      id: teamId, name: 'Modern member probe', transport: 'MODERN', worktreeIsolation: true,
      routingEnforced: false, slots: [{ personaId: workerPersona, quantity: 1 }], orchestratorPersonaId: coordinatorPersona
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
  }, { teamId, workerPersona, coordinatorPersona });
  await expect.poll(() => page.evaluate(async () =>
    (await (await fetch('/api/v1/threads/providers')).json()).providers.map((row: { id: string }) => row.id)
  ), { timeout: 30_000 }).toContain('acp-opencode');
  await expect.poll(() => page.evaluate(async () =>
    (await window.cc.pluginApps.list()).find(row => row.id === 'harness-mastracode')?.status
  ), { timeout: 30_000 }).toBe('running');
  // This unrelated bundled plugin has no configured runtime in the disposable
  // HOME. Disable its persisted enablement, never waive unknown native policy.
  const plugins = await page.evaluate(() => window.cc.pluginApps.list());
  if (plugins.some(row => row.id === 'salesforce')) {
    const disabled = await page.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', false));
    expect(disabled.ok, JSON.stringify(disabled)).toBe(true);
    await expect.poll(() => page.evaluate(async () =>
      (await window.cc.pluginApps.list()).find(row => row.id === 'salesforce')?.enabled
    )).toBe(false);
    const installed = JSON.parse(readFileSync(join(home, '.zcc', 'plugins', 'installed.json'), 'utf8'));
    expect(installed.plugins.find((row: { id: string }) => row.id === 'salesforce')).toMatchObject({ enabled: false });
  }
  // One ready harness does not mean builtin startup has finished. Wait for the
  // full installed roster and sealed classifications, not weaker policy checks.
  await expect.poll(() => {
    const { plugins } = JSON.parse(readFileSync(join(home, '.zcc', 'plugins', 'installed.json'), 'utf8')) as { plugins: InstalledPluginRow[] };
    return [
      ...BUILTIN_PLUGINS.filter(plugin => plugin.autoInstall && !plugins.some(row => row.id === plugin.pluginId))
        .map(plugin => `${plugin.pluginId}: not installed`),
      ...plugins.filter(row => row.enabled && row.serverEntry && row.toolPolicy !== 'true' && row.toolPolicy !== 'false')
        .map(row => `${row.id}: policy unsealed`)
    ];
  }, { timeout: 30_000 }).toEqual([]);
  const userData = await electron.evaluate(({ app }) => app.getPath('userData'));
  const lifecycle = (executionId: string): Lifecycle | undefined => {
    const path = join(userData, 'team-lifecycle.json');
    if (!existsSync(path)) return;
    const store = JSON.parse(readFileSync(path, 'utf8')) as { records: Lifecycle[] };
    return store.records.find(record => record.workers.some(member => member.modernContext?.executionId === executionId));
  };
  const launch = async (title: string) => {
    const result = await page.evaluate(input => window.cc.teams.startJob(input), {
      teamId, projectId, title, goal: `implement ${planPath}`, coordinationMode: 'structured' as const
    });
    expect(result.ok, `teams.startJob: ${JSON.stringify(result)}\n${diagnostics.join('').slice(-16_384)}`).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.value.executionId;
  };
  const snapshot = (executionId: string) => page.evaluate(async ({ projectId, executionId }) => {
    const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
    if (!snapshot) throw new Error('Modern execution snapshot missing');
    return snapshot;
  }, { projectId, executionId });
  const members = async (executionId: string) => {
    try {
      await expect.poll(() => lifecycle(executionId)?.workers.filter(member =>
        member.transport === 'MODERN' && member.bindingState === 'BOUND' && member.process === 'running'
      ).length ?? 0, { timeout: 30_000 }).toBe(2);
    } catch (error) {
      const workers = lifecycle(executionId)?.workers.map(member => ({
        transport: member.transport, bindingState: member.bindingState, process: member.process
      }));
      throw new Error(`Modern members not bound+running: ${JSON.stringify(workers)}\n${diagnostics.join('').slice(-16_384)}`, { cause: error });
    }
    const record = lifecycle(executionId)!;
    expect(record.workers).toHaveLength(2);
    for (const member of record.workers) {
      expect(member.threadId).toBe(member.sessionId);
      expect(member.generation).toBeGreaterThan(0);
      expect(member.modernContext.providerId).toBe('acp-opencode');
      await expect.poll(async () => (await readThread(page, member.threadId)).providerThreadId).toMatch(/^fake-sess-/);
      const nativeId = (await readThread(page, member.threadId)).providerThreadId;
      await expect.poll(() => providerRequests(member).filter(request =>
        request.method === 'session/prompt' && request.params?.sessionId === nativeId
      ).length).toBeGreaterThan(0);
      for (const request of providerRequests(member).filter(request =>
        request.method === 'session/prompt' && request.params?.sessionId === nativeId
      )) {
        expect(request.lifecycleAtRequest, 'No ACP turn may precede main lifecycle BOUND').toMatchObject({
          threadId: member.threadId, state: 'active', bindingState: 'BOUND',
          process: 'running', capacityReleased: false, generation: member.generation
        });
      }
    }
    const worker = record.workers.find(member => member.modernContext.role === 'worker')!;
    const coordinator = record.workers.find(member => member.modernContext.role === 'orchestrator')!;
    const workerThread = await readThread(page, worker.threadId);
    const coordinatorThread = await readThread(page, coordinator.threadId);
    expect(workerThread.visibility).toBe('hidden');
    expect(coordinatorThread.visibility).toBe('visible');
    expect(workerThread.environmentId).toBe(coordinatorThread.environmentId);
    expect(workerThread.cwd).toBe(coordinatorThread.cwd);
    expect(workerThread.cwd).toBe(worker.modernContext.worktreePath);
    expect(workerThread.cwd).not.toBe(root);
    expect(workerThread.isWorktree).toBe(true);
    expect(readFileSync(join(workerThread.cwd, 'README.md'), 'utf8')).toBe('Modern member fixture.\n');
    expect(await page.evaluate(id => window.cc.terminals.list(id), projectId), 'Modern squad must never allocate PTYs').toEqual([]);
    return { worker, coordinator, record };
  };
  const cleanup = async () => {
    await page.evaluate(async projectId => {
      for (const execution of (await window.cc.executionBoard.listProject(projectId)).executions) {
        if (['STARTING', 'RUNNING', 'BLOCKED'].includes(execution.state)) {
          await window.cc.executionBoard.stop(projectId, execution.executionId, execution.stateVersion ?? 0);
        }
      }
      await window.cc.projects.remove(projectId);
    }, projectId).catch(() => undefined);
  };
  return { page, projectId, launch, snapshot, lifecycle, members, cleanup };
}

test('Modern member Job Team delivers seeded work through ACP, fences role and claims, and completes without PTYs', async ({ app }) => {
  const probe = await setup(app);
  try {
    const executionId = await probe.launch('Modern member completion');
    const { worker, coordinator } = await probe.members(executionId);
    await expect.poll(async () => (await probe.snapshot(executionId)).execution.work?.assignments[0]?.state).toBe('CLAIMED');
    await expect.poll(async () => (await timeline(probe.page, worker.threadId)).filter(row => row.role === 'user')
      .map(row => row.text ?? '').join('\n')).toContain(marker);
    const workerThread = await readThread(probe.page, worker.threadId);
    await expect.poll(() => providerRequests(worker).some(request => request.method === 'session/prompt'
      && request.params?.sessionId === workerThread.providerThreadId
      && JSON.stringify(request.params.prompt).includes(marker))).toBe(true);
    const forgedRuntime = await probe.page.evaluate(async ({ projectId, bindingId, generation }) => {
      const response = await fetch('/internal/main/squad-runtime', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'squad-member-stop', request: { projectId, bindingId, generation } })
      });
      return { status: response.status, body: await response.text() };
    }, { projectId: probe.projectId, bindingId: worker.threadId, generation: worker.generation });
    expect(forgedRuntime).toMatchObject({ status: 403 });
    // Settled provider turn is delivery evidence only; idle must not finish work.
    await expect.poll(async () => (await readThread(probe.page, worker.threadId)).status).toBe('idle');
    expect((await probe.snapshot(executionId)).execution.work?.completed).toBe(0);
    const workerBridge = await memberBridge(probe.page, worker);
    const coordinatorBridge = await memberBridge(probe.page, coordinator);
    // Provider tool calls route through the member's active turn, as a real ACP agent's would.
    for (const member of [worker, coordinator]) {
      await send(probe.page, member.threadId, 'hang');
      await expect.poll(async () => (await readThread(probe.page, member.threadId)).status).toBe('active');
    }
    const workerTools = (await callBridge(workerBridge, 'tools/list')).tools.map((row: { name: string }) => row.name);
    const coordinatorTools = (await callBridge(coordinatorBridge, 'tools/list')).tools.map((row: { name: string }) => row.name);
    expect(workerTools).toContain('execution_work_complete');
    expect(workerTools).not.toContain('execution_complete');
    expect(workerTools).not.toContain('execution_start');
    expect(coordinatorTools).toContain('execution_complete');
    expect(coordinatorTools).not.toContain('execution_work_complete');
    denied(await tool(workerBridge, 'execution_complete', { executionId, summary: 'Forged coordinator completion' }), /Unknown tool|unavailable/);
    denied(await tool(coordinatorBridge, 'execution_work_complete', { executionId, workUnitId: 'inspect', result: 'Forged worker' }), /Unknown tool|unavailable/);
    denied(await tool(workerBridge, 'execution_event', {
      executionId, eventId: randomUUID(), type: 'outcome', severity: 'info',
      summary: 'Forged coordinator identity', producerRole: 'orchestrator', slotId: coordinator.slotId
    }), /member identity is host-bound|not authorized|invalid arguments/);
    denied(await tool(coordinatorBridge, 'execution_complete', { executionId, summary: 'Premature completion' }), /required work units are incomplete/);
    denied(await tool(workerBridge, 'execution_snapshot', { executionId: randomUUID() }), /not bound to this execution/);
    const before: ExecutionBoardSnapshot = await probe.snapshot(executionId);
    denied(await tool(workerBridge, 'execution_work_claim', { executionId, workUnitId: 'inspect', assignedSlotId: coordinator.slotId }), /worker cannot claim another slot/);
    const claim = await tool(workerBridge, 'execution_work_claim', { executionId, workUnitId: 'inspect' });
    success(claim);
    const unit = (JSON.parse(toolText(claim)) as { workUnits: Array<{ id: string; claimId: string; claimGeneration: number }> })
      .workUnits.find(unit => unit.id === 'inspect')!;
    expect(unit.claimId).toBe(before.execution.work!.assignments[0]!.claimId);
    expect(unit.claimGeneration).toBe(before.execution.work!.assignments[0]!.claimGeneration);
    denied(await tool(workerBridge, 'execution_work_complete', {
      executionId, workUnitId: 'inspect', result: 'Stale result', claimId: unit.claimId, claimGeneration: unit.claimGeneration + 1
    }), /stale work claim/);
    expect((await probe.snapshot(executionId)).execution.work?.completed).toBe(0);
    success(await tool(workerBridge, 'execution_work_complete', {
      executionId, workUnitId: 'inspect', result: marker, claimId: unit.claimId, claimGeneration: unit.claimGeneration
    }));
    await expect.poll(async () => (await probe.snapshot(executionId)).execution.state).toBe('COMPLETED');
    const completed = await probe.snapshot(executionId);
    expect(completed.execution.work).toMatchObject({ total: 1, completed: 1, assignments: [{ state: 'COMPLETED', result: marker }] });
    // Engine auto-finalizes the last worker outcome and cancels the cohort.
    // A late coordinator call must not restore authority to a terminal binding.
    await expect.poll(() => probe.lifecycle(executionId)?.state).toBe('canceled');
    expect((await rawBridgeCall(coordinatorBridge, 'tools/call', { name: 'execution_complete', arguments: { executionId, summary: 'Late coordinator completion' } })).status,
      'Late coordinator call must not reach a bridge tool').toBe(404);
    expect(await probe.page.evaluate(id => window.cc.terminals.list(id), probe.projectId)).toEqual([]);
  } finally { await probe.cleanup(); }
});

test('stopping a Modern member Job Team cancels active ACP turns and rejects late member outcomes', async ({ app }) => {
  const probe = await setup(app);
  try {
    const executionId = await probe.launch('Modern member stop');
    const { worker, coordinator } = await probe.members(executionId);
    const bridge = await memberBridge(probe.page, worker);
    await send(probe.page, worker.threadId, 'hang');
    await send(probe.page, coordinator.threadId, 'hang');
    for (const member of [worker, coordinator]) {
      await expect.poll(async () => (await readThread(probe.page, member.threadId)).status).toBe('active');
    }
    const snapshot = await probe.snapshot(executionId);
    const unit = snapshot.execution.work!.assignments[0]!;
    expect(unit.state).toBe('CLAIMED');
    const nativeIds = await Promise.all([worker, coordinator].map(async member => (await readThread(probe.page, member.threadId)).providerThreadId));
    for (const [index, member] of [worker, coordinator].entries()) {
      await expect.poll(() => providerRequests(member).some(request => request.method === 'session/prompt'
        && request.params?.sessionId === nativeIds[index]
        && JSON.stringify(request.params.prompt).includes(`${commandPrefix}hang`))).toBe(true);
    }
    const cancelCounts = [worker, coordinator].map((member, index) => providerRequests(member)
      .filter(request => request.method === 'session/cancel' && request.params?.sessionId === nativeIds[index]).length);
    const stale = await probe.page.evaluate(async ({ projectId, executionId }) => {
      const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return window.cc.executionBoard.stop(projectId, executionId, snapshot!.execution.stateVersion! - 1);
    }, { projectId: probe.projectId, executionId });
    expect(stale, JSON.stringify(stale)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect((await probe.snapshot(executionId)).execution.state).toBe('RUNNING');
    for (const [index, member] of [worker, coordinator].entries()) {
      expect((await readThread(probe.page, member.threadId)).status).toBe('active');
      expect(providerRequests(member).filter(request => request.method === 'session/cancel'
        && request.params?.sessionId === nativeIds[index])).toHaveLength(cancelCounts[index]!);
    }
    const result = await probe.page.evaluate(async ({ projectId, executionId }) => {
      const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return window.cc.executionBoard.stop(projectId, executionId, snapshot!.execution.stateVersion!);
    }, { projectId: probe.projectId, executionId });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    await expect.poll(async () => (await probe.snapshot(executionId)).execution.state).toBe('STOPPED');
    await expect.poll(() => probe.lifecycle(executionId)?.state).toBe('canceled');
    for (const [index, member] of [worker, coordinator].entries()) {
      await expect.poll(() => providerRequests(member).filter(request => request.method === 'session/cancel'
        && request.params?.sessionId === nativeIds[index]).length).toBeGreaterThan(cancelCounts[index]!);
      const cancel = providerRequests(member).filter(request => request.method === 'session/cancel'
        && request.params?.sessionId === nativeIds[index])[cancelCounts[index]!]!;
      expect(cancel.lifecycleAtRequest, 'Cancel dispatch alone must not release member capacity').toMatchObject({
        threadId: member.threadId, state: 'cancel-pending', bindingState: 'BOUND',
        process: 'running', capacityReleased: false, generation: member.generation
      });
      await expect.poll(async () => (await readThread(probe.page, member.threadId)).status).toBe('idle');
      expect(probe.lifecycle(executionId)?.workers.find(row => row.threadId === member.threadId))
        .toMatchObject({ process: 'canceled', bindingState: 'TERMINAL', capacityReleased: true });
    }
    // Terminal members lose their session-scoped bridge, so late outcomes never reach a tool.
    const late = await rawBridgeCall(bridge, 'tools/call', { name: 'execution_work_complete', arguments: {
      executionId, workUnitId: 'inspect', result: 'Late canceled result', claimId: unit.claimId, claimGeneration: unit.claimGeneration
    } });
    expect(late.status, 'Late member outcome must not reach a bridge tool').toBe(404);
    expect((await probe.snapshot(executionId)).execution.work?.completed).toBe(0);
    expect(await probe.page.evaluate(id => window.cc.terminals.list(id), probe.projectId)).toEqual([]);
  } finally { await probe.cleanup(); }
});
