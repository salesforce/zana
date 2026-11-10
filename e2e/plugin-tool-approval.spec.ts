import { cpSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test as base, expect, type AppHandle } from './fixtures/app.js';

const fixture = fileURLToPath(new URL('./fixtures/plugins/tool-approval-probe', import.meta.url));
const pluginId = 'tool-approval-probe';
const tokenPattern = /\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}/;
type Outcome = { threadId: string; approved: boolean; reason?: string; consumed?: boolean; replay?: boolean;
  macSpoof?: boolean; targetSpoof?: boolean; revisionSpoof?: boolean; invocationSpoof?: boolean };
type State = { changed: number; outcomes: Outcome[]; attempts: Array<{ threadId: string; crossInvocation: boolean; desktopPresentation: boolean }> };

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const root = join(home, 'tool-approval-plugin');
    cpSync(fixture, root, { recursive: true });
    const store = join(home, '.zcc/plugins');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
      id: pluginId, version: '0.1.0', name: 'Tool Approval Probe', enabled: true, status: 'running',
      provenance: 'direct', sourceKind: 'path', source: `path:${root}`, rootDir: root,
      serverEntry: './server.ts', appEntry: null, installedAt: Date.now(), updatedAt: Date.now()
    }] }));
    await use({ ZCC_FAKE_PROVIDER: '1' });
  }
});
test.use({ initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(180_000);

const rpc = <T,>(page: Page, method: string, args: unknown = {}) => page.evaluate(
  ({ pluginId, method, args }) => window.cc.pluginApps.callRpc(pluginId, method, args), { pluginId, method, args }
) as Promise<T>;

async function setup(app: AppHandle) {
  const win = app.window;
  let mainErrors = '';
  const capture = (chunk: Buffer | string) => { mainErrors = (mainErrors + String(chunk)).slice(-16_384); };
  app.electron.process().stderr?.on('data', capture);
  app.electron.process().stdout?.on('data', capture);
  await expect.poll(() => win.evaluate(async id => (await window.cc.pluginApps.list()).find(row => row.id === id)?.status, pluginId),
    { timeout: 30_000 }).toBe('running');
  const projectDir = join(app.home, 'approval-project');
  mkdirSync(projectDir);
  const projectId = await win.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    return project.value.id;
  }, realpathSync(projectDir));
  const state = () => rpc<State>(win, 'state');
  const events = (id: string) => win.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}/events?limit=100`);
    if (!response.ok) throw new Error(await response.text());
    return response.text();
  }, id);
  const start = (mode = '') => win.evaluate(async ({ projectId, mode }) => {
    const args = btoa(JSON.stringify({ mode })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Approval proof E2E', input: `call_tool:tool_approval_probe tool_args:${args}` }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, { projectId, mode });
  const sheets = () => app.electron.windows().filter(page => page !== win && page.url().startsWith('data:text/html'));
  const sheet = async (threadId: string) => {
    try {
      await expect.poll(() => sheets().length, { timeout: 30_000 }).toBe(1);
      return sheets()[0]!;
    } catch (error) {
      throw new Error(`Approval sheet missing. State: ${JSON.stringify(await state())} Events: ${await events(threadId)} Main errors: ${mainErrors}`, { cause: error });
    }
  };
  const outcome = async (threadId: string, expected: Partial<Outcome>) => {
    await expect.poll(async () => (await state()).outcomes.find(row => row.threadId === threadId)).toEqual({ threadId, ...expected });
    await expect.poll(() => sheets().length).toBe(0);
    expect(await events(threadId), 'Approval tokens must never enter the transcript').not.toMatch(tokenPattern);
  };
  const approve = async (page: Page) => {
    await page.locator('#typed').fill('sandbox');
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect.poll(() => page.isClosed()).toBe(true);
  };
  return { win, projectId, state, start, sheet, sheets, outcome, approve, events };
}

test('main-owned sheet binds approval to action and invocation; MAC spoof and replay fail', async ({ app }) => {
  const { win, state, start, sheet, outcome, approve, events } = await setup(app);
  expect(await rpc(win, 'outsideApproval')).toEqual({ approved: false, reason: 'unavailable' });
  const threadId = await start();
  const approval = await sheet(threadId);
  await expect(approval.getByText('Tool Approval Probe asks for approval')).toBeVisible();
  await expect(approval.getByRole('heading', { name: 'Activate Probe Agent' })).toBeVisible();
  await expect(approval.locator('dd')).toHaveText(['probe.activate', 'Test sandbox', 'Probe Agent', 'revision-1']);
  await expect(approval.getByRole('button', { name: 'Activate', exact: true })).toBeDisabled();
  expect(await approval.evaluate(() => ({ cc: typeof (window as any).cc, require: typeof (window as any).require })))
    .toEqual({ cc: 'undefined', require: 'undefined' });
  const browserWindow = await app.electron.browserWindow(approval);
  expect(await browserWindow.evaluate(window => {
    const prefs = window.webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, preload: prefs.preload ?? '' };
  })).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, preload: '' });
  expect(await state()).toEqual({ changed: 0, outcomes: [], attempts: [{ threadId, crossInvocation: false, desktopPresentation: true }] });
  const forged = await win.evaluate(({ pluginId, threadId }) => window.cc.pluginApprovals.request({ pluginId,
    title: 'Forged', binding: { action: 'probe.activate', target: 'test-org', targetLabel: 'Test sandbox', subject: 'Probe Agent',
      revision: 'revision-1', threadId, invocationId: 'forged' } } as never), { pluginId, threadId });
  expect(forged).toEqual({ approved: false, reason: 'invalid' });
  await approval.locator('#typed').fill('wrong sandbox');
  await expect(approval.getByRole('button', { name: 'Activate', exact: true })).toBeDisabled();
  // Human approval must survive the control socket's ordinary ten-second deadline.
  await approval.waitForTimeout(11_000);
  expect(approval.isClosed()).toBe(false);
  expect((await state()).changed).toBe(0);
  expect((await state()).outcomes).toEqual([]);
  await approve(approval);
  await outcome(threadId, { approved: true, consumed: true, replay: false, macSpoof: false, targetSpoof: false, revisionSpoof: false, invocationSpoof: false });
  expect((await state()).changed).toBe(1);
  await expect.poll(() => rpc(win, 'staleApproval')).toEqual({ approved: false, reason: 'unavailable' });
  expect(await rpc(win, 'outsideConsume')).toBe(false);

  // Retain an unused proof so cross-invocation refusal cannot pass solely on replay detection.
  const retainedId = await start('retain-proof');
  await approve(await sheet(retainedId));
  await outcome(retainedId, { approved: true, consumed: false });
  await expect.poll(() => rpc(win, 'staleApproval')).toEqual({ approved: false, reason: 'unavailable' });
  expect(await rpc(win, 'outsideConsume')).toBe(false);
  const nextId = await start();
  const next = await sheet(nextId);
  expect((await state()).attempts.find(row => row.threadId === nextId)).toEqual({ threadId: nextId, crossInvocation: false, desktopPresentation: true });
  await next.getByRole('button', { name: 'Cancel', exact: true }).click();
  await outcome(nextId, { approved: false, reason: 'cancelled' });
  expect((await state()).changed).toBe(1);
  expect(await events(threadId)).toContain('Tool called: tool_approval_probe');
  expect(JSON.stringify(await state())).not.toMatch(tokenPattern);
});

test('cancel, timeout, stopped invocation, changed revision and archived scope never act', async ({ app }) => {
  const { win, state, start, sheet, outcome, approve } = await setup(app);
  const deniedId = await start();
  const denied = await sheet(deniedId);
  await denied.getByRole('button', { name: 'Cancel', exact: true }).click();
  await outcome(deniedId, { approved: false, reason: 'cancelled' });

  const timeoutId = await start('timeout');
  const timedOut = await sheet(timeoutId);
  await outcome(timeoutId, { approved: false, reason: 'timeout' });
  expect(timedOut.isClosed()).toBe(true);
  await expect.poll(() => rpc(win, 'staleApproval')).toEqual({ approved: false, reason: 'unavailable' });

  const stoppedId = await start();
  const stopped = await sheet(stoppedId);
  await win.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error(await response.text());
  }, stoppedId);
  await approve(stopped);
  // Cancellation can revoke the invocation before the sheet response reaches the server.
  await expect.poll(async () => (await state()).outcomes.find(row => row.threadId === stoppedId)).toMatchObject({ threadId: stoppedId, approved: false });
  const stoppedReason = (await state()).outcomes.find(row => row.threadId === stoppedId)!.reason;
  expect(['cancelled', 'unavailable']).toContain(stoppedReason);
  await outcome(stoppedId, { approved: false, reason: stoppedReason });

  for (const mode of ['stale-revision', 'archived-scope']) {
    const staleId = await start(mode);
    await approve(await sheet(staleId));
    await outcome(staleId, { approved: true, consumed: false });
  }
  expect((await state()).changed).toBe(0);
});

test('hidden headless workers, remote conversations and forged invocation scope refuse without a sheet', async ({ app }) => {
  const { win, projectId, state, start, sheets, outcome } = await setup(app);
  const opened: Page[] = [];
  app.electron.on('window', page => { if (page !== win) opened.push(page); });
  for (const surface of ['hidden', 'remote'] as const) {
    const { id } = await rpc<{ id: string }>(win, 'spawn', { projectId, surface });
    await outcome(id, { approved: false, reason: 'unavailable' });
    expect((await state()).attempts.find(row => row.threadId === id)).toEqual({ threadId: id, crossInvocation: false, desktopPresentation: false });
  }
  const forgedId = await start('forged-scope');
  await outcome(forgedId, { approved: false, reason: 'invalid' });
  expect(sheets()).toHaveLength(0);
  expect(opened).toHaveLength(0);
  expect((await state()).changed).toBe(0);
});
