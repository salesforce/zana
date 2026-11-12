/**
 * P5 hold proof for MODERN (ACP) Squad workers: a worker thread parked on an OPEN human
 * blocker must survive the host's idle provider-session reap sweep, while an equally idle
 * thread with no blocker is reaped under the SAME threshold (control: proves the sweep runs).
 *
 * The sweep timing comes from the E2E-only daemon knobs ZCC_E2E_IDLE_REAP_INTERVAL_MS /
 * ZCC_E2E_IDLE_REAP_AFTER_MS (honored only inside an isolated E2E home). The test plays the
 * worker's model through its real session-scoped DynamicTool bridge, as modern-member-squad does.
 */
import { test as base, expect, type AppHandle } from './fixtures/app.js';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureBin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');
const REAP_INTERVAL_MS = 1_000;
const REAP_AFTER_MS = 6_000;
const teamId = 'e2e-modern-reap-squad';
const workerPersona = 'e2e-modern-reap-worker';
const coordinatorPersona = 'e2e-modern-reap-coordinator';
const commandPrefix = 'SQUAD_FIXTURE:';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    await use({
      FAKE_ACP_REQUEST_LOG: join(home, 'acp-requests.jsonl'),
      PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_ACP_MODEL_CONFIG: '1', FAKE_ACP_MODE_CONFIG: '1',
      FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan', FAKE_ACP_HTTP_MCP: '1',
      FAKE_ACP_PROMPT_PREFIX: commandPrefix,
      ZCC_E2E_IDLE_REAP_INTERVAL_MS: String(REAP_INTERVAL_MS),
      ZCC_E2E_IDLE_REAP_AFTER_MS: String(REAP_AFTER_MS)
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
test.setTimeout(180_000);

interface Member { threadId: string; slotId: string; generation: number; transport: string; bindingState: string; process: string;
  modernContext: { role: 'worker' | 'orchestrator'; executionId: string } }
interface Bridge { url: string; headers: Array<{ name: string; value: string }> }
interface ToolResult { isError?: boolean; content?: Array<{ text?: string }> }
interface TimelineRow { role?: string; text?: string }

const readThread = (page: Page, id: string) => page.evaluate(async id => {
  const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}`);
  const body = await response.json();
  return { httpStatus: response.status, status: (body.thread?.status ?? 'missing') as string, providerThreadId: (body.thread?.providerThreadId ?? null) as string | null };
}, id);

const timeline = (page: Page, id: string) => page.evaluate(async id => {
  const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}/timeline?segmentLimit=100`);
  return ((await response.json()).rows ?? []) as TimelineRow[];
}, id);

const send = (page: Page, id: string, command: string, mode = 'queue-if-active') => page.evaluate(async ({ id, text, mode }) => {
  const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}/send`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, mode })
  });
  if (!response.ok) throw new Error(await response.text());
}, { id, text: `${commandPrefix}${command}`, mode });

async function bridgeFor(page: Page, threadId: string): Promise<Bridge> {
  await expect.poll(async () => (await readThread(page, threadId)).status, { timeout: 30_000 }).toBe('idle');
  await send(page, threadId, 'echo-mcp-server-config');
  let config = '';
  await expect.poll(async () => {
    config = (await timeline(page, threadId)).filter(row => row.role === 'assistant')
      .map(row => row.text ?? '').find(text => text.startsWith('mcp-server-config:')) ?? '';
    return config;
  }, { timeout: 30_000 }).not.toBe('');
  const servers = JSON.parse(config.slice('mcp-server-config:'.length)) as Array<Bridge & { name: string; type: string }>;
  return servers.find(server => server.name === 'zcc' && server.type === 'http')!;
}

async function call(bridge: Bridge, method: string, params?: Record<string, unknown>) {
  const response = await fetch(bridge.url, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', ...Object.fromEntries(bridge.headers.map(row => [row.name, row.value])) },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, ...(params ? { params } : {}) })
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}
async function tool(bridge: Bridge, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const { status, body } = await call(bridge, 'tools/call', { name, arguments: args });
  expect(status, `bridge ${name}`).toBe(200);
  expect(body.error, `bridge ${name}: ${JSON.stringify(body.error)}`).toBeUndefined();
  return body.result;
}
const text = (r: ToolResult) => (r.content ?? []).map(i => i.text ?? '').join('\n');

async function setup(app: AppHandle) {
  const { window: page, home, electron } = app;
  const diagnostics: string[] = [];
  electron.process()?.stderr?.on('data', chunk => { diagnostics.push(String(chunk)); if (diagnostics.length > 100) diagnostics.shift(); });
  const projectDir = join(home, 'modern-reap-project');
  mkdirSync(projectDir);
  const root = realpathSync(projectDir);
  const planPath = join(root, 'plan.md');
  writeFileSync(planPath, ['# Reap probe', '', '### inspect: Inspect <!-- executable-step -->',
    '- **Work:** Report done after reading README.md.', '- **Depends on:** None', '- **Mode:** read-only',
    '- **Verification:** README.md exists.', ''].join('\n'));
  writeFileSync(join(root, 'README.md'), 'Reap fixture.\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env: { ...process.env, HOME: home } });
  git('init', '-b', 'main'); git('add', 'README.md', 'plan.md');
  git('-c', 'user.name=Reap E2E', '-c', 'user.email=reap@example.test', 'commit', '-m', 'Fixture setup');
  const projectId = await page.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);
  await page.evaluate(async ({ teamId, workerPersona, coordinatorPersona }) => {
    for (const [id, name] of [[workerPersona, 'Reap worker'], [coordinatorPersona, 'Reap coordinator']]) {
      const r = await window.cc.personas.save({ id, name, baseProfile: 'opencode', model: 'fake/default', permissionMode: 'default' });
      if (!r.ok) throw new Error(JSON.stringify(r));
    }
    const r = await window.cc.teams.save({ id: teamId, name: 'Reap probe', transport: 'MODERN', worktreeIsolation: true,
      routingEnforced: false, slots: [{ personaId: workerPersona, quantity: 1 }], orchestratorPersonaId: coordinatorPersona });
    if (!r.ok) throw new Error(JSON.stringify(r));
  }, { teamId, workerPersona, coordinatorPersona });
  await expect.poll(() => page.evaluate(async () =>
    (await (await fetch('/api/v1/threads/providers')).json()).providers.map((row: { id: string }) => row.id)), { timeout: 30_000 }).toContain('acp-opencode');
  await expect.poll(() => page.evaluate(async () =>
    (await window.cc.pluginApps.list()).find(row => row.id === 'harness-mastracode')?.status), { timeout: 30_000 }).toBe('running');
  const plugins = await page.evaluate(() => window.cc.pluginApps.list());
  if (plugins.some(row => row.id === 'salesforce')) {
    await page.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', false));
    await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'salesforce')?.enabled)).toBe(false);
  }
  await expect.poll(() => {
    const { plugins } = JSON.parse(readFileSync(join(home, '.zcc', 'plugins', 'installed.json'), 'utf8')) as { plugins: Array<{ id: string; enabled: boolean; serverEntry?: string; toolPolicy?: unknown }> };
    return plugins.filter(row => row.enabled && row.serverEntry && row.toolPolicy !== 'true' && row.toolPolicy !== 'false').map(row => row.id);
  }, { timeout: 30_000 }).toEqual([]);
  const userData = await electron.evaluate(({ app }) => app.getPath('userData'));
  const lifecycle = (executionId: string) => {
    const path = join(userData, 'team-lifecycle.json');
    if (!existsSync(path)) return;
    const store = JSON.parse(readFileSync(path, 'utf8')) as { records: Array<{ workers: Member[] }> };
    return store.records.find(record => record.workers.some(m => m.modernContext?.executionId === executionId));
  };
  return { page, projectId, planPath, lifecycle, diagnostics };
}

test('MODERN worker parked on an open blocker survives the idle reap sweep; an idle control thread is reaped; answer continues the run', async ({ app }) => {
  const s = await setup(app);
  const { page, projectId } = s;
  const t0 = Date.now();
  const mark = (label: string) => { const d = `${label}@${Date.now() - t0}ms`; console.log(`[reap-e2e] ${d}`); test.info().annotations.push({ type: 'timing', description: d }); };
  try {
    // Control thread: standalone MODERN thread, no execution, no blocker.
    const control = await page.evaluate(async projectId => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, providerId: 'acp-opencode', model: 'fake/default', acpMode: 'plan', permissionMode: 'full', input: 'control standby' })
      });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(JSON.stringify(body));
      return body.value.id as string;
    }, projectId);

    const started = await page.evaluate(input => window.cc.teams.startJob(input), {
      teamId, projectId, title: 'Reap hold job', goal: `implement ${s.planPath}`, coordinationMode: 'structured' as const
    });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    const executionId = (started as { value: { executionId: string } }).value.executionId;
    await expect.poll(() => s.lifecycle(executionId)?.workers.filter(m => m.transport === 'MODERN' && m.bindingState === 'BOUND' && m.process === 'running').length ?? 0,
      { timeout: 30_000 }).toBe(2);
    const worker = s.lifecycle(executionId)!.workers.find(m => m.modernContext.role === 'worker')!;

    // Park the worker: claim + raise a HUMAN blocker while its turn is active (hang), then end the turn.
    await expect.poll(async () => (await readThread(page, worker.threadId)).status, { timeout: 30_000 }).toBe('idle');
    const bridge = await bridgeFor(page, worker.threadId);
    await send(page, worker.threadId, 'hang');
    await expect.poll(async () => (await readThread(page, worker.threadId)).status).toBe('active');
    const claim = await tool(bridge, 'execution_work_claim', { executionId, workUnitId: 'inspect' });
    const unit = (JSON.parse(text(claim)) as { workUnits: Array<{ id: string; claimId: string; claimGeneration: number }> }).workUnits.find(u => u.id === 'inspect')!;
    const blockerId = `reap-blocker-${randomUUID().slice(0, 8)}`;
    const blocked = await tool(bridge, 'execution_work_block', {
      executionId, workUnitId: 'inspect', blockerId, question: 'Which label should the reap probe use?', options: ['Atlas', 'Borealis'],
      claimId: unit.claimId, claimGeneration: unit.claimGeneration
    });
    expect(blocked.isError, text(blocked)).not.toBe(true);
    mark('blocker-open');
    const snap = () => page.evaluate(async ({ projectId, executionId }) => {
      const sn = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const ex = sn?.execution as unknown as { state: string; stateVersion: number; currentBlocker?: { id: string } | null };
      return { state: ex?.state, stateVersion: ex?.stateVersion ?? 0, blockerId: ex?.currentBlocker?.id ?? '' };
    }, { projectId, executionId });
    await expect.poll(async () => (await snap()).blockerId).toBe(blockerId);

    // End the hung turn without stopping the thread so it becomes reap-eligible (idle) with the blocker open.
    await send(page, worker.threadId, 'finish', 'steer-if-active');
    await expect.poll(async () => (await readThread(page, worker.threadId)).status, { timeout: 30_000 }).toBe('idle');
    const workerProviderId = (await readThread(page, worker.threadId)).providerThreadId;
    const controlProviderId = (await readThread(page, control)).providerThreadId;
    expect(workerProviderId).toBeTruthy();
    mark('worker-idle');

    // (2) control: same threshold, no blocker -> its provider session must be released.
    // Release is observed as the thread's provider session being dropped / status leaving idle-live.
    const observeControl = async () => JSON.stringify(await readThread(page, control));
    const controlBefore = await observeControl();
    // (1) hold the blocker open for >= 3x threshold, sampling both threads.
    const samples: string[] = [];
    const until = Date.now() + REAP_AFTER_MS * 3 + 4_000;
    let controlChangedAt = -1;
    let controlReestablished = false;
    while (Date.now() < until) {
      const w = await readThread(page, worker.threadId);
      samples.push(`w:${w.status}/${w.providerThreadId}`);
      expect(w.httpStatus).toBe(200);
      expect((await snap()).state, 'run must stay BLOCKED').toBe('BLOCKED');
      if (controlChangedAt < 0 && await observeControl() !== controlBefore) controlChangedAt = Date.now() - t0;
      await page.waitForTimeout(1_000);
    }
    mark('hold-done');
    console.log(`[reap-e2e] control before=${controlBefore} after=${await observeControl()} changedAt=${controlChangedAt} controlProv=${controlProviderId}`);
    console.log(`[reap-e2e] worker-samples ${[...new Set(samples)].join(' | ')}`);
    // Discriminator: a released session must be re-established (initialize/session/load|new) on the next send;
    // a held session just takes session/prompt. Compare ACP log growth per thread after the hold.
    const reqLog = join(app.home, 'acp-requests.jsonl');
    const rows = () => (existsSync(reqLog) ? readFileSync(reqLog, 'utf8').split('\n').filter(Boolean) : []).map(l => { try { const r = JSON.parse(l); return `${r.method}:${r.params?.sessionId ?? ''}`; } catch { return 'bad'; } });
    const mc = rows().length;
    await send(page, control, 'ping');
    await expect.poll(() => rows().length, { timeout: 20_000 }).toBeGreaterThan(mc);
    await page.waitForTimeout(1_500);
    const controlRows = rows().slice(mc);
    console.log(`[reap-e2e] control-after-hold rows: ${controlRows.join(' ')}`);
    controlReestablished = controlRows.some(r => r.startsWith('initialize') || r.startsWith('session/new') || r.startsWith('session/load'));
    // Worker bridge still authorized => the worker's session was not released/torn down.
    const probe = await call(bridge, 'tools/list');
    expect(probe.status, 'worker bridge must still be live after the hold window').toBe(200);
    const after = await readThread(page, worker.threadId);
    expect(after.providerThreadId).toBe(workerProviderId);

    // (3) answer -> run progresses.
    const answered = await page.evaluate(async ({ projectId, executionId, blockerId }) => {
      const sn = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return window.cc.executionBoard.respond(projectId, executionId, sn?.execution.stateVersion ?? 0, blockerId, `${blockerId}:${crypto.randomUUID()}`, 'Atlas');
    }, { projectId, executionId, blockerId });
    expect(answered?.ok, JSON.stringify(answered)).toBe(true);
    mark('answered');

    // Worker receives the answer through its delivery channel and finishes the unit.
    const wmark = rows().length;
    await send(page, worker.threadId, 'hang');
    await expect.poll(async () => (await readThread(page, worker.threadId)).status).toBe('active');
    const workerRows = rows().slice(wmark);
    console.log(`[reap-e2e] worker-after-hold rows: ${workerRows.join(' ')}`);
    const workerReestablished = workerRows.some(r => r.startsWith('initialize') || r.startsWith('session/new') || r.startsWith('session/load'));
    expect(workerReestablished, 'worker session must not have been released while blocked').toBe(false);
    let pulledText = '';
    await expect.poll(async () => { pulledText = text(await tool(bridge, 'execution_delivery_pull', {})); return pulledText; },
      { timeout: 30_000, intervals: [1_000] }).toContain('Atlas');
    const d = JSON.parse(pulledText) as { id: string; leaseId: string };
    const acked = await tool(bridge, 'execution_delivery_ack', { deliveryId: d.id, leaseId: d.leaseId, delivered: true });
    expect(acked.isError, text(acked)).not.toBe(true);
    const done = await tool(bridge, 'execution_work_complete', {
      executionId, workUnitId: 'inspect', result: 'Atlas', claimId: unit.claimId, claimGeneration: unit.claimGeneration
    });
    expect(done.isError, text(done)).not.toBe(true);
    await expect.poll(async () => (await snap()).state, { timeout: 60_000 }).toBe('COMPLETED');
    mark('completed');

    expect(controlReestablished, 'control (no blocker) idle MODERN thread must have been reaped under the same threshold').toBe(true);
  } finally {
    const stopIds = await page.evaluate(async projectId => (await window.cc.executionBoard.listProject(projectId)).executions
      .filter(e => ['STARTING', 'RUNNING', 'BLOCKED'].includes(e.state)).map(e => ({ id: e.executionId, v: e.stateVersion ?? 0 })), projectId).catch(() => []);
    for (const { id, v } of stopIds) await page.evaluate(({ projectId, id, v }) => window.cc.executionBoard.stop(projectId, id, v), { projectId, id, v }).catch(() => undefined);
    await page.evaluate(id => window.cc.projects.remove(id), projectId).catch(() => undefined);
  }
});
