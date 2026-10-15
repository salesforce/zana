import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { createNodeDeps } from '../lib/node-deps.js';
import type { SalesforceDeps } from '../lib/types.js';

const roots: string[] = []; const disposals: Array<() => unknown> = [];
const ctx = { projectId: 'p', threadId: '', signal: new AbortController().signal };
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
async function fixture(production = false, getThread?: (args: { threadId: string }) => Promise<unknown>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sf-studio-ctl-'))); roots.push(root);
  const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p', name: 'Project', path: root }], ...(getThread ? { getThread: getThread as never } : {}) });
  const org = { alias: 'dev', username: 'test@example.com', id: '00D000000000001', orgId: '00D000000000001', instanceUrl: 'https://example.salesforce.com', accessToken: 'TEST_TOKEN', isSandbox: !production };
  const deps = createNodeDeps();
  deps.execSf = vi.fn<SalesforceDeps['execSf']>(async args => ({ code: 0, stderr: '', stdout: JSON.stringify({ status: 0, result: args.includes('display') ? org : { [production ? 'nonScratchOrgs' : 'sandboxes']: [org] } }) }));
  deps.request = vi.fn<SalesforceDeps['request']>(async () => ({ status: 200, json: {}, text: '{}' }));
  const publish = vi.spyOn(zcc.realtime, 'publish');
  await createSalesforcePlugin(zcc, deps);
  harness.setSettings({ defaultOrg: 'dev' });
  disposals.push(() => harness.dispose());
  const tool = harness.agentTools.find(t => t.name === 'sf_workbench')!;
  return { harness, publish, tool, action: (action: string, input: unknown = {}) => tool.execute({ action, input }, ctx) as Promise<any> };
}
const sha = 'e'.repeat(64);

it('delivers ui.command editor.proposeEdit, wakes the view over realtime and returns the human outcome via ui.result', async () => {
  const { action, harness, publish } = await fixture();
  const view = await harness.callRpc('control.register', { projectId: 'p', surface: 'agentforce', commands: ['editor.proposeEdit'] }) as any;
  const bad = await action('ui.command', { viewId: view.viewId, command: 'editor.proposeEdit', input: { path: 'a.agent', expectedSha256: 'nope', content: 'x', summary: 's' } });
  expect(bad).toMatchObject({ ok: false });
  const job = await action('ui.command', { viewId: view.viewId, command: 'editor.proposeEdit', input: { path: 'a.agent', expectedSha256: sha, content: 'x', summary: 'tidy' } });
  expect(job).toMatchObject({ ok: true, state: 'pending' });
  expect(publish).toHaveBeenCalledWith('sf.ui.wake', { viewId: view.viewId });
  const poll = await harness.callRpc('control.poll', { projectId: 'p', viewId: view.viewId, state: {} }) as any;
  expect(poll.commands[0]).toMatchObject({ command: 'editor.proposeEdit' });
  // No thread, no author: the Studio then names nobody.
  expect(poll.commands[0].from).toBeUndefined();
  await harness.callRpc('control.ack', { projectId: 'p', viewId: view.viewId, commandId: job.commandId, ok: true, pending: 'user', proposalId: 'prop', state: { path: 'a.agent' } });
  expect(await action('ui.result', { commandId: job.commandId })).toMatchObject({ state: 'awaiting_user', proposalId: 'prop' });
  const waiting = action('ui.result', { commandId: job.commandId, waitMs: 20_000 });
  const outcome = { outcome: 'partial', acceptedHunks: 1, rejectedHunks: 1, sha256: sha };
  await harness.callRpc('control.outcome', { projectId: 'p', viewId: view.viewId, commandId: job.commandId, outcome });
  expect(await waiting).toMatchObject({ state: 'completed', ok: true, outcome });
});

it('mediates preview verbs as org reads and no longer takes the rehearse engine', async () => {
  const { action, harness } = await fixture(true);
  const view = await harness.callRpc('control.register', { projectId: 'p', surface: 'agentforce', commands: ['preview.start', 'preview.send'] }) as any;
  expect(await action('ui.command', { viewId: view.viewId, command: 'preview.start', input: { engine: 'simulate' } })).toMatchObject({ code: 'refused' });
  expect(await action('ui.command', { viewId: view.viewId, command: 'preview.send', input: { text: 'hi' } })).toMatchObject({ code: 'refused' });
  expect(await action('ui.command', { viewId: view.viewId, command: 'preview.start', input: { engine: 'rehearse' } })).toMatchObject({ ok: false });
});

it('names the thread behind each ui.command so the Studio can show who it follows', async () => {
  const threads: Record<string, unknown> = {
    'thr-1': { id: 'thr-1', title: 'Fix QC', projectId: 'p' },
    'thr-2': { id: 'thr-2', title: null, titleFallback: 'Untitled run', projectId: 'p' },
    'thr-3': { id: 'thr-3', title: 'Another project', projectId: 'other' },
    'thr-5': { id: 'thr-5', title: 'x'.repeat(300), projectId: 'p' }
  };
  const { tool, harness } = await fixture(false, async ({ threadId }) => { if (threadId === 'thr-4') throw Error('threads unavailable'); return threads[threadId] ?? null; });
  const view = await harness.callRpc('control.register', { projectId: 'p', surface: 'agentforce', commands: ['editor.reveal'] }) as any;
  for (const threadId of ['thr-1', 'thr-2', 'thr-3', 'thr-4', 'thr-5', 'thr-6']) {
    expect(await tool.execute({ action: 'ui.command', input: { viewId: view.viewId, command: 'editor.reveal', input: { line: 2 } } }, { ...ctx, threadId })).toMatchObject({ ok: true, state: 'pending' });
  }
  const poll = await harness.callRpc('control.poll', { projectId: 'p', viewId: view.viewId, state: {} }) as any;
  expect(poll.commands.map((command: any) => command.from)).toEqual([
    { threadId: 'thr-1', title: 'Fix QC' },
    { threadId: 'thr-2', title: 'Untitled run' },
    // A thread from another project, a failed lookup or an unknown thread keeps only the id.
    { threadId: 'thr-3' },
    { threadId: 'thr-4' },
    { threadId: 'thr-5', title: 'x'.repeat(120) },
    { threadId: 'thr-6' }
  ]);
  // The renderer cannot name an author: control.command from the panel carries none.
  const direct = await harness.callRpc('control.command', { projectId: 'p', viewId: view.viewId, command: 'editor.reveal', input: { line: 1 }, threadId: 'thr-1', from: { threadId: 'thr-1', title: 'Spoofed' } }) as any;
  expect(direct).toMatchObject({ ok: true });
  const next = await harness.callRpc('control.poll', { projectId: 'p', viewId: view.viewId, state: {} }) as any;
  expect(next.commands).toHaveLength(1);
  expect(next.commands[0].from).toBeUndefined();
});
