import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { createNodeDeps } from '../lib/node-deps.js';
import type { SalesforceDeps } from '../lib/types.js';
const roots: string[] = [];
const disposals: Array<() => unknown> = [];
const ctx = { projectId: 'p', threadId: '', signal: new AbortController().signal };
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
async function fixture(production = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sf-actions-'))); roots.push(root);
  const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p', name: 'Project', path: root }, { id: 'other', name: 'Other', path: root }] });
  const org = { alias: 'dev', username: 'test@example.com', id: '00D000000000001', orgId: '00D000000000001', instanceUrl: 'https://example.salesforce.com', accessToken: 'TEST_TOKEN', isSandbox: !production };
  const deps = createNodeDeps();
  const exec = vi.fn<SalesforceDeps['execSf']>(async args => ({ code: 0, stderr: '', stdout: JSON.stringify({ status: 0, result: args[0] === 'agent' ? { sessionId: 'preview', success: true, passedCount: 1, failedCount: 0, botVersionId: 'version-1' } : args.includes('display') ? org : args.includes('metadata') ? [{ fullName: 'Help_v1' }] : { [production ? 'nonScratchOrgs' : 'sandboxes']: [org] } }) }));
  const request = vi.fn<SalesforceDeps['request']>(async () => ({ status: 200, json: { totalSize: 1, done: true, records: [{ Id: '001000000000001' }] }, text: '{}' }));
  deps.execSf = exec; deps.request = request;
  await createSalesforcePlugin(zcc, deps);
  harness.setSettings({ defaultOrg: 'dev' });
  // The fake host owns plugin cleanup hooks.
  disposals.push(() => harness.dispose());
  const tool = harness.agentTools.find(tool => tool.name === 'sf_workbench')!;
  const action = (action: string, input: unknown = {}, context = ctx) => tool.execute({ action, input }, context) as Promise<any>;
  return { root, harness, action, exec, request, zcc };
}
it('uses identical scoped creation and file revisions from tools, UI RPC and CLI', async () => {
  const { action, harness, root } = await fixture();
  const destination = await action('draft.destination'); expect(destination.initializesProject).toBe(true);
  const result = await action('draft.create', { name: 'Help', apiName: 'Help', projectId: 'forged', threadId: 'forged', orgAlias: 'forged' });
  expect(result.ok).toBe(true); expect(readFileSync(join(root, result.file.path), 'utf8')).toContain('agent_name: "Help"');
  const read = await action('files.read', { path: result.file.path }); expect(read.file.sha256).toBe(result.file.sha256);
  expect(await action('files.write', { path: result.file.path, content: 'bad' })).toMatchObject({ ok: false, error: expect.stringContaining('expectedSha256') });
  expect(await action('files.write', { path: result.file.path, content: read.file.content + '\n# edited', expectedSha256: read.file.sha256 })).toMatchObject({ ok: true });
  expect(await action('files.write', { path: result.file.path, content: 'bad', expectedSha256: read.file.sha256 })).toMatchObject({ ok: false, code: 'sha_mismatch' });
  const cli = await harness.cli!.run(['action', 'draft.create', '--input', JSON.stringify({ name: 'CLI', apiName: 'CLI' }), '--json'], { pluginId: 'salesforce', argv: [], projectId: 'p' });
  expect(cli.exitCode).toBe(0); expect(JSON.parse(cli.stdout!).file.apiName).toBe('CLI');
  const lint = await harness.agentTools.find(t => t.name === 'sf_agent')!.execute({ action: 'diagnose', path: result.file.path }, ctx);
  expect(lint).toMatchObject({ ok: true });
  const previewFiles = await harness.callRpc('agentFiles.list', { projectId: 'p', purpose: 'preview' }) as any;
  expect(previewFiles.files.map((file: any) => file.path)).toContain(result.file.path);
  const cliRead = await harness.cli!.run(['tool', 'sf_agent', '--input', JSON.stringify({ action: 'files.read', input: { path: result.file.path } })], { pluginId: 'salesforce', argv: [], projectId: 'p' });
  expect(JSON.parse(cliRead.stdout!).file.content).toContain('# edited');
});
it('offers discoverable capabilities and rejects unknown, oversized and unscoped requests', async () => {
  const { action, harness } = await fixture();
  expect((await action('capabilities')).actions.some((a: any) => a.action === 'draft.create')).toBe(true);
  expect(await action('constructor')).toMatchObject({ ok: false, code: 'invalid_input' });
  expect(await action('draft.create', {}, { ...ctx, projectId: '' })).toMatchObject({ code: 'project_required' });
  expect(await action('draft.create', { purpose: 'x'.repeat(200_000) })).toMatchObject({ ok: false });
  expect(await action('draft.create', { name: 'Invalid', apiName: '../escape' })).toMatchObject({ ok: false });
  const cli = (argv: string[], projectId?: string) => harness.cli!.run(argv, { pluginId: 'salesforce', argv, projectId });
  expect((await cli(['action', 'draft.create'])).exitCode).toBe(2);
  expect((await cli(['action', 'capabilities'])).exitCode).toBe(0);
  expect((await cli(['action', 'draft.create', '--input', '{'], 'p')).exitCode).toBe(2);
  expect((await cli(['tool', 'nope'], 'p')).exitCode).toBe(1);
  expect((await cli(['tool', 'sf_soql', '--input', '{"action":"query.validate","query":"SELECT Id FROM Account LIMIT 1"}'], 'p')).exitCode).toBe(0);
  expect((await cli(['action', 'context.status'], 'missing')).exitCode).toBe(1);
});
it('mediates org reads and UI reads but permits offline local drafts', async () => {
  const { action, request, exec, harness } = await fixture(true);
  expect(await action('draft.create', { name: 'Offline', apiName: 'Offline' })).toMatchObject({ ok: true });
  expect(await action('source.list')).toMatchObject({ ok: false, code: 'refused' });
  expect(await action('records.get', { objectName: 'Account', recordId: '001000000000001' })).toMatchObject({ code: 'refused' });
  const view = await harness.callRpc('control.register', { projectId: 'p', surface: 'data', commands: ['record.open'] }) as any;
  expect(await action('ui.command', { viewId: view.viewId, command: 'record.open', input: {} })).toMatchObject({ code: 'refused' });
  expect(request).not.toHaveBeenCalled();
  expect(exec.mock.calls.some(([args]) => args.includes('metadata'))).toBe(false);
});
it('runs bounded queries, stores real results and refuses cross-project presentation', async () => {
  const { action, harness, request } = await fixture();
  const result = await action('query.execute', { query: 'SELECT Id FROM Account LIMIT 1' });
  expect(result).toMatchObject({ ok: true, resultId: expect.any(String), records: [{ Id: '001000000000001' }] });
  expect(request).toHaveBeenCalled();
  expect(await harness.callRpc('query.result', { projectId: 'p', resultId: result.resultId })).toMatchObject({ ok: true });
  expect(await harness.callRpc('query.result', { projectId: 'other', resultId: result.resultId })).toMatchObject({ ok: false });
  expect(await action('query.execute', { query: 'DELETE FROM Account' })).toMatchObject({ ok: false });
  expect(await action('query.execute', { query: 'SELECT Id FROM Account' })).toMatchObject({ ok: false, code: 'refused' });
});
it('uses acknowledged controls and refuses unsafe project creation', async () => {
  const { action, harness } = await fixture();
  const view = await harness.callRpc('control.register', { projectId: 'p', surface: 'workbench', commands: ['view.open'] }) as any;
  const job = await action('ui.command', { viewId: view.viewId, command: 'view.open', input: { view: 'agentforce' } });
  expect(await action('ui.result', { commandId: job.commandId })).toMatchObject({ state: 'pending' });
  const poll = await harness.callRpc('control.poll', { projectId: 'p', viewId: view.viewId, state: {} }) as any;
  expect(poll.commands[0].input.view).toBe('agentforce');
  await harness.callRpc('control.ack', { projectId: 'p', viewId: view.viewId, commandId: job.commandId, ok: true, state: { view: 'agentforce' } });
  expect(await action('ui.result', { commandId: job.commandId })).toMatchObject({ state: 'completed', viewState: { view: 'agentforce' } });
  expect((await action('ui.views')).views).toHaveLength(1);
  expect(await action('project.create', { name: '../outside' })).toMatchObject({ ok: false });
  await action('draft.create', { name: 'Help', apiName: 'Help' });
  expect(await action('project.create', { name: 'agentforce-drafts' })).toMatchObject({ ok: false, error: expect.stringContaining('exists') });
});

it('pins visible commands to the backend-resolved org and refuses changed targets before delivery', async () => {
  const { action, harness, request } = await fixture();
  const other = await harness.callRpc('control.register', { projectId: 'p', orgAlias: 'production', surface: 'data', commands: ['record.open'] }) as any;
  expect(await action('ui.command', { viewId: other.viewId, command: 'record.open', input: {} })).toMatchObject({ ok: false, error: expect.stringContaining('different org') });
  const view = await harness.callRpc('control.register', { projectId: 'p', surface: 'data', commands: ['record.open'] }) as any;
  expect(await action('ui.command', { viewId: view.viewId, command: 'record.open', input: {} })).toMatchObject({ ok: true });
  expect(await harness.callRpc('control.poll', { projectId: 'p', orgAlias: 'production', viewId: view.viewId, state: {} })).toMatchObject({ ok: false, error: expect.stringContaining('different org') });
  expect(request).not.toHaveBeenCalled();
});

it('uses the managed DX child for compile, preview, evaluation and confirmed publication', async () => {
  const { action, harness, root, exec, zcc } = await fixture();
  const created = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const agent = harness.agentTools.find(tool => tool.name === 'sf_agent')!;
  const run = (input: unknown) => agent.execute(input, ctx);
  const cli = (argv: string[]) => harness.cli!.run(argv, { pluginId: 'salesforce', argv, projectId: 'p' });
  expect(await cli(['lint', created.file.path])).toMatchObject({ exitCode: 0, stdout: expect.stringContaining(': ok') });
  expect(await cli(['lint'])).toMatchObject({ exitCode: 0, stdout: expect.stringContaining(created.file.path) });
  expect(await run({ action: 'compile', path: created.file.path })).toMatchObject({ ok: true });
  expect(await run({ action: 'preview.start', path: created.file.path })).toMatchObject({ ok: true, data: { sessionId: 'preview' } });
  const specPath = 'agentforce-drafts/evals/spec.json';
  mkdirSync(join(root, 'agentforce-drafts/evals'));
  writeFileSync(join(root, specPath), JSON.stringify({ tests: [{ utterance: 'hello' }] }));
  expect(await run({ action: 'eval.run', specPath })).toMatchObject({ ok: true });
  for (const verb of ['validate', 'preview', 'test']) {
    const call = exec.mock.calls.find(([args]) => args[0] === 'agent' && args[1] === verb)!;
    expect(call?.[1]?.cwd).toBe(join(root, 'agentforce-drafts'));
  }
  expect(exec.mock.calls.find(([args]) => args[1] === 'test')?.[0]).toContain(join(root, specPath));
  expect(await run({ action: 'lifecycle.publish', path: created.file.path })).toMatchObject({ code: 'refused' });
  expect(exec.mock.calls.some(([args]) => args[1] === 'publish')).toBe(false);
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  const publication = agent.execute({ action: 'lifecycle.publish', path: created.file.path }, { ...ctx, threadId: 'thread' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce());
  harness.submitInteraction({ approved: true });
  expect(await publication).toMatchObject({ ok: true, summary: expect.stringContaining('inactive') });
  expect(exec.mock.calls.find(([args]) => args[1] === 'publish')?.[1]?.cwd).toBe(join(root, 'agentforce-drafts'));
  expect(exec.mock.calls.some(([args]) => args[1] === 'activate')).toBe(false);
  writeFileSync(join(root, created.file.metadataPath), '<AiAuthoringBundle><target>Help.v1</target></AiAuthoringBundle>');
  expect(await run({ action: 'lifecycle.publish', path: created.file.path })).toMatchObject({ code: 'versioned_source' });
});

it('never substitutes an API name for an explicit missing, conflicting or escaped source path', async () => {
  const { action, harness, root, exec } = await fixture();
  const created = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const run = (input: unknown) => harness.agentTools.find(tool => tool.name === 'sf_agent')!.execute(input, ctx);
  const missing = created.file.path.replace('/Help/Help.agent', '/missing/Help.agent');
  mkdirSync(join(root, created.file.path.replace('/Help/Help.agent', '/missing')));
  expect(await run({ action: 'compile', path: missing, apiName: 'Help' })).toMatchObject({ code: 'path_refused' });
  writeFileSync(join(root, 'agentforce-drafts/Help.agent'), 'config:\n    agent_name: Help\n');
  expect(await run({ action: 'compile', path: 'agentforce-drafts/Help.agent', apiName: 'Help' })).toMatchObject({ code: 'not_found' });
  expect(await run({ action: 'compile', path: created.file.path, apiName: 'Other' })).toMatchObject({ code: 'invalid_input' });
  writeFileSync(join(root, 'Help.agent'), 'config:\n    agent_name: Help\n');
  expect(await run({ action: 'compile', path: 'Help.agent' })).toMatchObject({ code: 'path_refused' });
  expect(await run({ action: 'compile', path: '../Help.agent' })).toMatchObject({ code: 'path_refused' });
  writeFileSync(join(root, 'outside.json'), '{}');
  expect(await run({ action: 'eval.run', specPath: 'outside.json' })).toMatchObject({ code: 'path_refused' });
  symlinkSync(join(root, 'outside.json'), join(root, 'agentforce-drafts/linked.json'));
  expect(await run({ action: 'eval.run', specPath: 'agentforce-drafts/linked.json' })).toMatchObject({ code: 'path_refused' });
  expect(await run({ action: 'eval.run', specPath: 'agentforce-drafts/missing.json' })).toMatchObject({ code: 'path_refused' });
  expect(exec.mock.calls.some(([args]) => args[0] === 'agent')).toBe(false);
});
