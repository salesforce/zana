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
async function fixture(production = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sf-studio-ctl-'))); roots.push(root);
  const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p', name: 'Project', path: root }] });
  const org = { alias: 'dev', username: 'test@example.com', id: '00D000000000001', orgId: '00D000000000001', instanceUrl: 'https://example.salesforce.com', accessToken: 'TEST_TOKEN', isSandbox: !production };
  const deps = createNodeDeps();
  deps.execSf = vi.fn<SalesforceDeps['execSf']>(async args => ({ code: 0, stderr: '', stdout: JSON.stringify({ status: 0, result: args.includes('display') ? org : { [production ? 'nonScratchOrgs' : 'sandboxes']: [org] } }) }));
  deps.request = vi.fn<SalesforceDeps['request']>(async () => ({ status: 200, json: {}, text: '{}' }));
  const publish = vi.spyOn(zcc.realtime, 'publish');
  await createSalesforcePlugin(zcc, deps);
  harness.setSettings({ defaultOrg: 'dev' });
  disposals.push(() => harness.dispose());
  const tool = harness.agentTools.find(t => t.name === 'sf_workbench')!;
  return { harness, publish, action: (action: string, input: unknown = {}) => tool.execute({ action, input }, ctx) as Promise<any> };
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
  await harness.callRpc('control.ack', { projectId: 'p', viewId: view.viewId, commandId: job.commandId, ok: true, pending: 'user', proposalId: 'prop', state: { path: 'a.agent' } });
  expect(await action('ui.result', { commandId: job.commandId })).toMatchObject({ state: 'awaiting_user', proposalId: 'prop' });
  const waiting = action('ui.result', { commandId: job.commandId, waitMs: 20_000 });
  const outcome = { outcome: 'partial', acceptedHunks: 1, rejectedHunks: 1, sha256: sha };
  await harness.callRpc('control.outcome', { projectId: 'p', viewId: view.viewId, commandId: job.commandId, outcome });
  expect(await waiting).toMatchObject({ state: 'completed', ok: true, outcome });
});

it('mediates preview verbs as org reads except for the rehearse engine', async () => {
  const { action, harness } = await fixture(true);
  const view = await harness.callRpc('control.register', { projectId: 'p', surface: 'agentforce', commands: ['preview.start', 'preview.send'] }) as any;
  expect(await action('ui.command', { viewId: view.viewId, command: 'preview.start', input: { engine: 'simulate' } })).toMatchObject({ code: 'refused' });
  expect(await action('ui.command', { viewId: view.viewId, command: 'preview.send', input: { text: 'hi' } })).toMatchObject({ code: 'refused' });
  expect(await action('ui.command', { viewId: view.viewId, command: 'preview.start', input: { engine: 'rehearse' } })).toMatchObject({ ok: true, state: 'pending' });
});
