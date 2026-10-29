import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { createNodeDeps } from '../lib/node-deps.js';
import type { SalesforceDeps } from '../lib/types.js';
import type { AgentforceTransport } from '../lib/agentforce-transport.js';
import { actionInput } from '../lib/workbench-actions.js';
const roots: string[] = [];
const disposals: Array<() => unknown> = [];
const ctx = { projectId: 'p', threadId: '', signal: new AbortController().signal };
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
async function fixture(production = false, labTransport?: AgentforceTransport, database?: Parameters<typeof createFakePluginHost>[0]['database']) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sf-actions-'))); roots.push(root);
  const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', ...(database ? { database } : {}), listProjects: async () => [{ id: 'p', name: 'Project', path: root }, { id: 'other', name: 'Other', path: root }] });
  const org = { alias: 'dev', username: 'test@example.com', id: '00D000000000001', orgId: '00D000000000001', instanceUrl: 'https://example.salesforce.com', accessToken: 'TEST_TOKEN', isSandbox: !production };
  const deps = createNodeDeps();
  const exec = vi.fn<SalesforceDeps['execSf']>(async args => ({ code: 0, stderr: '', stdout: JSON.stringify({ status: 0, result: args[0] === 'agent' ? { sessionId: 'preview', success: true, passedCount: 1, failedCount: 0, botVersionId: 'version-1' } : args.includes('display') ? org : args.includes('metadata') ? [{ fullName: 'Help_v1' }] : { [production ? 'nonScratchOrgs' : 'sandboxes']: [org] } }) }));
  const request = vi.fn<SalesforceDeps['request']>(async () => ({ status: 200, json: { totalSize: 1, done: true, records: [{ Id: '001000000000001' }] }, text: '{}' }));
  deps.execSf = exec; deps.request = request;
  await createSalesforcePlugin(zcc, deps, labTransport);
  harness.setSettings({ defaultOrg: 'dev' });
  // The fake host owns plugin cleanup hooks.
  disposals.push(() => harness.dispose());
  const tool = harness.agentTools.find(tool => tool.name === 'sf_workbench')!;
  const action = (action: string, input: unknown = {}, context = ctx) => tool.execute({ action, input }, context) as Promise<any>;
  return { root, harness, action, exec, request, zcc };
}
it('lets assistants create shared scenarios locally with project and revision boundaries', async () => {
  const db = createSqliteDatabase(':memory:');
  const database = { runScript: (sql: string) => { db.exec(sql); }, prepare: (sql: string) => db.prepare(sql), migrate: (statements: string[]) => statements.forEach(sql => db.exec(sql)), transaction: (fn: () => unknown) => db.transaction(fn)() };
  const { action, root, exec, request } = await fixture(false, undefined, database);
  disposals.push(() => db.close());
  writeFileSync(join(root, 'Bot.agent'), 'config:');
  const list = await action('scenarios.list', { agentPath: 'Bot.agent' }); expect(list.scenarios).toHaveLength(3);
  const input = { agentPath: 'Bot.agent', name: 'Verified customer', ...list.scenarios[0], id: undefined, contextVariables: [{ name: 'verified', type: 'Boolean', value: false }] };
  input.name = 'Verified customer';
  const saved = await action('scenarios.save', input); expect(saved).toMatchObject({ ok: true, scenario: { revision: 1, contextVariables: input.contextVariables } });
  expect((await action('scenarios.list', { agentPath: 'Bot.agent' }, { ...ctx, projectId: 'other' })).scenarios).toHaveLength(3);
  expect(await action('scenarios.save', { ...input, projectId: 'forged', id: saved.scenario.id, expectedRevision: 1, name: 'Edited' })).toMatchObject({ ok: true, scenario: { revision: 2 } });
  expect(await action('scenarios.save', { ...input, id: saved.scenario.id, expectedRevision: 1 })).toMatchObject({ ok: false, code: 'revision_mismatch' });
  expect(await action('scenarios.list', { agentPath: '../Outside.agent' })).toMatchObject({ ok: false });
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'scenario-outside-'))); roots.push(outside); writeFileSync(join(outside, 'Secret.agent'), 'config:'); symlinkSync(join(outside, 'Secret.agent'), join(root, 'Escape.agent'));
  expect(await action('scenarios.list', { agentPath: 'Escape.agent' })).toMatchObject({ ok: false });
  expect(await action('scenarios.list', { agentPath: 'Bot.agent' }, { ...ctx, projectId: '' })).toMatchObject({ ok: false });
  expect(await action('scenarios.remove', { agentPath: 'Bot.agent', id: saved.scenario.id, expectedRevision: 2 })).toEqual({ ok: true });
  expect((await action('capabilities')).actions).toContainEqual(expect.objectContaining({ action: 'scenarios.save' }));
  expect(request).not.toHaveBeenCalled(); expect(exec.mock.calls.every(([args]) => args[0] === 'org')).toBe(true);
});
it('lets an assistant create multiple typed test cases and update only the revision it read', async () => {
  const { action, harness } = await fixture();
  const created = await action('draft.create', { name: 'Cases', apiName: 'Cases' });
  const cases = [false, true].map((verified, i) => ({ id: `c${i}`, name: `Verified ${verified}`, utterances: ['Can you help?'], expect: { contains: ['help'] }, contextVariables: [{ name: 'verified', type: 'Boolean', value: verified }] }));
  const saved = await action('suites.save', { agentPath: created.file.path, cases });
  expect(saved).toMatchObject({ ok: true, suite: { cases } });
  expect((await action('capabilities')).actions).toContainEqual(expect.objectContaining({ action: 'suites.save' }));
  const listed = await action('suites.list');
  expect(listed.suites[0].sha256).toBe(saved.suite.sha256);
  expect(await action('suites.save', { agentPath: created.file.path, cases })).toMatchObject({ ok: false, code: 'sha_mismatch' });
  expect(await action('suites.save', { path: '../../escape.scenario.json', cases })).toMatchObject({ ok: false, code: 'path_refused' });
  const updated = await action('suites.save', { agentPath: created.file.path, cases: [...cases, { ...cases[0], id: 'third' }], expectedSha256: saved.suite.sha256 });
  expect(updated.suite.cases).toHaveLength(3);
  const cli = await harness.cli!.run(['action', 'suites.save', '--input', JSON.stringify({ agentPath: created.file.path, cases, expectedSha256: updated.suite.sha256 })], { pluginId: 'salesforce', argv: [], projectId: 'p' });
  expect(JSON.parse(cli.stdout!)).toMatchObject({ ok: true, suite: { cases } });
});
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
it('uses input files for large CLI writes and family actions with the same revision and project checks', async () => {
  const { action, harness, root } = await fixture();
  const created = await action('draft.create', { name: 'Large', apiName: 'Large' });
  const content = '# full CLI input\n'.repeat(20000) + '# END';
  const input = { path: created.file.path, content, expectedSha256: created.file.sha256 };
  writeFileSync(join(root, 'write.json'), JSON.stringify(input));
  const cli = (argv: string[], projectId = 'p') => harness.cli!.run(argv, { pluginId: 'salesforce', argv, projectId });
  expect((await cli(['action', 'files.write', '--input-file', 'write.json'])).exitCode).toBe(0);
  expect(readFileSync(join(root, created.file.path), 'utf8')).toBe(content);
  expect(JSON.parse((await cli(['action', 'files.write', '--input-file', 'write.json'])).stdout!)).toMatchObject({ code: 'sha_mismatch' });
  const current = await action('files.read', { path: created.file.path });
  writeFileSync(join(root, 'family.json'), JSON.stringify({ action: 'files.write', input: { ...input, expectedSha256: current.file.sha256, content: content + '\n# family' } }));
  expect((await cli(['tool', 'sf_agent', '--input-file', 'family.json'])).exitCode).toBe(0);
  expect(readFileSync(join(root, created.file.path), 'utf8')).toBe(content + '\n# family');
  expect((await cli(['action', 'files.write', '--input-file', 'write.json'], '')).exitCode).toBe(2);
  expect((await cli(['--help'])).stdout).toContain('--input-file');
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
it('gates Agentforce lab runs on an org that is not a known sandbox, like every other org read', async () => {
  const bootstrap = vi.fn(async () => 'JWT');
  const { harness, zcc } = await fixture(true, { bootstrap, request: vi.fn() } as unknown as AgentforceTransport);
  const start = (extra: Record<string, unknown> = {}) =>
    harness.callRpc('agentLab.start', { projectId: 'p', engine: 'rehearsal', source: 'config:\n  agent_name: Help', ...extra }) as Promise<any>;
  // No thread to ask in: refused before Salesforce is called.
  expect(await start()).toMatchObject({ ok: false, error: expect.stringContaining('beside a thread') });
  expect(bootstrap).not.toHaveBeenCalled();
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  const cancelled = start({ threadId: 'thread' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce());
  expect(confirmation.mock.calls[0]![0]).toMatchObject({ threadId: 'thread', payload: { kind: 'org.unknown.read', orgAlias: 'dev', summary: expect.stringContaining('Rehearse') } });
  harness.cancelInteraction();
  expect(await cancelled).toMatchObject({ ok: false, error: 'Operator cancelled the rehearse run.' });
  expect(bootstrap).not.toHaveBeenCalled();
  const approved = start({ threadId: 'thread', engine: 'preview' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledTimes(2));
  expect(confirmation.mock.calls[1]![0]).toMatchObject({ payload: { summary: expect.stringContaining('Simulate') } });
  harness.submitInteraction({ approved: true });
  await approved;
  expect(bootstrap).toHaveBeenCalledOnce();
});
it('treats a Start click in the Studio as the approval, but never an agent claiming one', async () => {
  const bootstrap = vi.fn(async () => 'JWT');
  const { harness, zcc, action } = await fixture(true, { bootstrap, request: vi.fn() } as unknown as AgentforceTransport);
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  const source = 'config:\n  agent_name: Help';
  // An agent cannot forge the click: sf_workbench drops the flag, so the org gate still refuses.
  expect(await action('studio.start', { engine: 'rehearsal', source, startedByUser: true })).toMatchObject({ ok: false, code: 'refused' });
  expect(bootstrap).not.toHaveBeenCalled();
  expect(await harness.callRpc('agentLab.start', { projectId: 'p', engine: 'rehearsal', source, startedByUser: true })).toMatchObject({ ok: true });
  expect(bootstrap).toHaveBeenCalledOnce();
  expect(confirmation).not.toHaveBeenCalled();
  // A forged flag that reaches the lab directly is dropped by actionInput too.
  expect(actionInput({ engine: 'preview', startedByUser: true, threadId: 't' })).toEqual({ engine: 'preview' });
});
it('runs Agentforce lab rehearsals on a sandbox without asking', async () => {
  const bootstrap = vi.fn(async () => 'JWT');
  const { harness, zcc } = await fixture(false, { bootstrap, request: vi.fn() } as unknown as AgentforceTransport);
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  expect(await harness.callRpc('agentLab.start', { projectId: 'p', engine: 'rehearsal', source: 'config:\n  agent_name: Help' })).toMatchObject({ ok: true, data: { engine: 'rehearsal', orgAlias: 'dev' } });
  expect(confirmation).not.toHaveBeenCalled();
  expect(bootstrap).toHaveBeenCalledOnce();
});
it('reconnects server-owned role-play after its RPC returns without crossing project, path or org scope', async () => {
  let finishTurn!: () => void;
  const heldTurn = new Promise<void>(resolve => { finishTurn = resolve; });
  const request = vi.fn(async (_token: string, _path: string, input: unknown) => {
    const judging = JSON.stringify(input).includes('Evaluate a test transcript');
    if (!judging) await heldTurn;
    return { host: 'test.api.salesforce.com', body: { generationDetails: { generations: [{ content: judging
      ? JSON.stringify({ outcome: 'pass', reason: 'Question answered', evidence: ['The agent replied.'] }) : 'I can help.' }] } } };
  });
  const { harness } = await fixture(false, { bootstrap: async () => 'PRIVATE_JWT', request } as unknown as AgentforceTransport);
  const owner = { projectId: 'p', orgAlias: 'dev', path: 'Bot.agent' };
  const started = await harness.callRpc('agentLab.run', { ...owner, engine: 'rehearsal', source: 'start_agent:\n', threadId: 'original-thread',
    contextVariables: [{ name: 'verified', type: 'Boolean', value: true }],
    scenario: { persona: 'Cooperative', goal: 'Get help', opening: 'Help me', criteria: 'Agent replies', maxTurns: 1 } }) as any;
  expect(started).toMatchObject({ ok: true, data: { busy: true, execution: { totalTurns: 1 } } });
  const id = started.data.id;
  expect(await harness.callRpc('agentLab.list', owner)).toMatchObject({ ok: true, data: [{ id, path: 'Bot.agent', threadId: 'original-thread' }] });
  expect(await harness.callRpc('agentLab.list', { ...owner, projectId: 'other' })).toEqual({ ok: true, data: [] });
  expect(await harness.callRpc('agentLab.get', { ...owner, id, projectId: 'other' })).toMatchObject({ ok: false, error: expect.stringContaining('another project') });
  expect(await harness.callRpc('agentLab.get', { ...owner, id, path: 'Other.agent' })).toMatchObject({ ok: false, error: expect.stringContaining('another agent or org') });
  expect(await harness.callRpc('agentLab.get', { ...owner, id, orgAlias: 'different' })).toMatchObject({ ok: false, error: expect.stringContaining('another agent or org') });
  finishTurn();
  await vi.waitFor(async () => expect(await harness.callRpc('agentLab.get', { ...owner, id, includeSource: true })).toMatchObject({ ok: true,
    data: { source: 'start_agent:\n', busy: false, threadId: 'original-thread', contextVariables: [{ name: 'verified', type: 'Boolean', value: true }], execution: { phase: 'done', verdict: { outcome: 'pass' } } } }));
  const restored = await harness.callRpc('agentLab.get', { ...owner, id });
  expect(JSON.stringify(restored)).not.toContain('PRIVATE_JWT');
  expect(await harness.callRpc('agentLab.end', { ...owner, id })).toMatchObject({ ok: true, data: { closed: true } });
  expect(await harness.callRpc('agentLab.list', owner)).toEqual({ ok: true, data: [] });
});
it('lets an agent read the preview context, manage presets and start a run from one', async () => {
  const { request, transport } = previewApi();
  const db = createSqliteDatabase(':memory:');
  disposals.push(() => db.close());
  const { action, harness } = await fixture(false, transport,
    { runScript: sql => { db.exec(sql); }, prepare: sql => db.prepare(sql), migrate: statements => statements.forEach(sql => db.exec(sql)), transaction: fn => db.transaction(fn)() } as never);
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const path = draft.file.path;
  const read = await action('files.read', { path });
  const source = 'config:\n  agent_name: "Help"\nvariables:\n  verified: mutable boolean = False\n    visibility: "External"\n';
  expect(await action('files.write', { path, content: source, expectedSha256: read.file.sha256 })).toMatchObject({ ok: true });
  const fields = await action('context.fields', { path });
  expect(fields).toMatchObject({ ok: true, fields: expect.arrayContaining([expect.objectContaining({ name: 'verified', type: 'Boolean' })]) });
  // An agent's save needs no field definitions or scope: it types values from the agent's declarations.
  const saved = await action('contextPresets.save', { path, name: 'Verified', values: [{ name: 'verified', value: true }] }, { ...ctx, threadId: 'thread-1' });
  expect(saved).toMatchObject({ ok: true, preset: { name: 'Verified', savedBy: 'agent', values: [{ name: 'verified', type: 'Boolean', value: true }] } });
  expect((await action('contextPresets.list', { path })).presets).toHaveLength(1);
  // studio.start and sf_agent preview.start take the preset in place of contextVariables.
  expect(await action('studio.start', { engine: 'rehearsal', source, path, presetId: saved.preset.id })).toMatchObject({ ok: true, data: { contextVariables: [{ name: 'verified', type: 'Boolean', value: true }] } });
  expect(await action('studio.start', { engine: 'rehearsal', source, path, presetId: saved.preset.id, contextVariables: [] })).toMatchObject({ ok: false, error: expect.stringContaining('not both') });
  expect(await action('studio.start', { engine: 'rehearsal', source, presetId: saved.preset.id })).toMatchObject({ ok: false, error: expect.stringContaining('agent path') });
  expect(await action('studio.start', { engine: 'rehearsal', source, path, presetId: 'missing' })).toMatchObject({ ok: false, error: expect.stringContaining('contextPresets.list') });
  expect(await action('studio.start', { engine: 'rehearsal', source, path, presetId: 7 })).toMatchObject({ ok: false, error: expect.stringContaining('presetId must be') });
  const sfAgent = harness.agentTools.find(t => t.name === 'sf_agent')!;
  expect(await sfAgent.execute({ action: 'preview.start', path, presetId: saved.preset.id }, ctx)).toMatchObject({ ok: true });
  const previewed = request.mock.calls.find(([, path]) => path.endsWith('/preview/sessions')) as unknown[] | undefined;
  expect((previewed?.[2] as { variables?: unknown })?.variables).toEqual([{ name: 'verified', type: 'Boolean', value: true }]);
  expect(await action('contextPresets.remove', { path, id: saved.preset.id, expectedRevision: 1 })).toEqual({ ok: true, id: saved.preset.id });
  expect((await action('contextPresets.list', { path })).presets).toEqual([]);
});
it('compiles from the Studio button behind the same org gate as every other org read', async () => {
  const { action, harness, zcc, exec } = await fixture(true);
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const compile = (extra: Record<string, unknown> = {}) =>
    harness.callRpc('agentScript.compile', { projectId: 'p', path: draft.file.path, ...extra }) as Promise<any>;
  const validations = () => exec.mock.calls.filter(([args]) => args[0] === 'agent' && args[1] === 'validate');
  expect(await harness.callRpc('agentScript.compile', { projectId: 'p' })).toMatchObject({ ok: false, code: 'invalid_input' });
  // sf agent validate runs in the org: with no thread to ask in, an org that is not a known sandbox is refused first.
  expect(await compile()).toMatchObject({ ok: false, code: 'refused', error: expect.stringContaining('Compile beside a thread') });
  expect(validations()).toHaveLength(0);
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  const denied = compile({ threadId: 'thread' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce());
  expect(confirmation.mock.calls[0]![0]).toMatchObject({ threadId: 'thread', payload: { kind: 'org.unknown.read', orgAlias: 'dev', summary: 'Compile Help with sf agent validate on dev (unknown)', preview: 'Help' } });
  harness.cancelInteraction();
  expect(await denied).toMatchObject({ ok: false, code: 'refused', error: 'Operator cancelled compile.' });
  expect(validations()).toHaveLength(0);
  const approved = compile({ threadId: 'thread' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledTimes(2));
  harness.submitInteraction({ approved: true });
  expect(await approved).toMatchObject({ ok: true, summary: 'Compiled Help (cli)' });
  expect(validations()[0]![0]).toEqual(['agent', 'validate', 'authoring-bundle', '--json', '--api-name', 'Help', '--target-org', 'dev']);
});
it('compiles on a sandbox from the Studio button without asking', async () => {
  const { action, harness, zcc } = await fixture();
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  expect(await harness.callRpc('agentScript.compile', { projectId: 'p', path: draft.file.path })).toMatchObject({ ok: true, summary: 'Compiled Help (cli)' });
  expect(confirmation).not.toHaveBeenCalled();
  expect(await harness.callRpc('agentScript.compile', { projectId: 'p', path: '../outside.agent' })).toMatchObject({ ok: false, code: 'path_refused' });
});
it('opens the saved agent in Agentforce Builder through the CLI without returning its session URL', async () => {
  const { action, harness, exec } = await fixture();
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const open = (extra: Record<string, unknown> = {}) => harness.callRpc('agentBuilder.open', { projectId: 'p', path: draft.file.path, ...extra }) as Promise<any>;
  const opens = () => exec.mock.calls.filter(([args]) => args[0] === 'org' && args[1] === 'open');
  expect(await harness.callRpc('agentBuilder.open', { projectId: 'p' })).toMatchObject({ ok: false, code: 'invalid_input' });
  expect(await open({ path: '../outside.agent' })).toMatchObject({ ok: false, code: 'path_refused' });
  expect(await open({ path: 'force-app/main/default/aiAuthoringBundles/Nope/Nope.agent' })).toMatchObject({ ok: false });
  const opened = await open();
  expect(opened).toEqual({ ok: true, summary: 'Opened Help in Agentforce Builder on dev.' });
  expect(opens()[0]![0]).toEqual(['org', 'open', 'agent', '--json', '--target-org', 'dev', '--authoring-bundle', 'Help', '--browser', 'chrome']);
  const base = exec.getMockImplementation()!;
  exec.mockImplementation(async (args, opts) => args[1] === 'open'
    ? { code: 1, stderr: '', stdout: JSON.stringify({ status: 1, message: 'Cannot open https://example.my.salesforce.com/secur/frontdoor.jsp?sid=SECRET' }) }
    : base(args, opts));
  const failed = await open();
  expect(failed).toMatchObject({ ok: false, code: 'open_failed', error: 'Cannot open [url]' });
  expect(JSON.stringify(failed)).not.toContain('SECRET');
  exec.mockImplementation(async (args, opts) => args[1] === 'open' ? { code: 1, stderr: '', stdout: '' } : base(args, opts));
  expect(await open()).toMatchObject({ ok: false, code: 'open_failed', error: 'Could not open Help in Agentforce Builder.' });
});
it('opens Agentforce Builder by project and version id, falling back to the bundle name', async () => {
  const { action, harness, exec, request } = await fixture();
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const open = () => harness.callRpc('agentBuilder.open', { projectId: 'p', path: draft.file.path }) as Promise<any>;
  const lastOpen = () => exec.mock.calls.filter(([args]) => args[0] === 'org' && args[1] === 'open').at(-1)![0];
  const base = exec.getMockImplementation()!;
  let listed: unknown = [{ fullName: 'Help_1', id: '1bZdw0000000aaaEAA' }, { fullName: 'Help', id: '1bZdw0000000junEAA' }];
  exec.mockImplementation(async (args, opts) => args[1] === 'list' && args.includes('AiAuthoringBundle')
    ? { code: 0, stderr: '', stdout: JSON.stringify({ status: 0, result: listed }) }
    : base(args, opts));
  const baseRequest = request.getMockImplementation()!;
  let bundle: { status: number; json: unknown } = { status: 200, json: { apiName: 'Help', bundleId: '1bYdw00000004TREAY', id: '1bZdw0000000junEAA' } };
  request.mockImplementation(async (org, req) => req.path.startsWith('/nextgen-authoring/') ? { ...bundle, text: '{}' } : baseRequest(org, req));

  expect(await open()).toMatchObject({ ok: true });
  expect(request.mock.calls.find(([, req]) => req.path.startsWith('/nextgen-authoring/'))![1]).toMatchObject({ path: '/nextgen-authoring/bundle-versions/1bZdw0000000junEAA', apiVersion: '66.0' });
  expect(lastOpen()).toEqual(['org', 'open', '--json', '--target-org', 'dev', '--path', 'AgentAuthoring/agentAuthoringBuilder.app#/project?projectId=1bYdw00000004TREAY&projectVersionId=1bZdw0000000junEAA', '--browser', 'chrome']);

  const byName = ['org', 'open', 'agent', '--json', '--target-org', 'dev', '--authoring-bundle', 'Help', '--browser', 'chrome'];
  bundle = { status: 404, json: [{ errorCode: 'NOT_FOUND' }] };
  expect(await open()).toMatchObject({ ok: true }); expect(lastOpen()).toEqual(byName);
  bundle = { status: 200, json: { bundleId: 'not-an-id' } };
  expect(await open()).toMatchObject({ ok: true }); expect(lastOpen()).toEqual(byName);
  listed = [{ fullName: 'Help', id: '../bad' }];
  expect(await open()).toMatchObject({ ok: true }); expect(lastOpen()).toEqual(byName);
  listed = null;
  expect(await open()).toMatchObject({ ok: true }); expect(lastOpen()).toEqual(byName);
  listed = [{ fullName: 'Help', id: '1bZdw0000000junEAA' }];
  request.mockImplementation(async (org, req) => { if (req.path.startsWith('/nextgen-authoring/')) throw new Error('offline'); return baseRequest(org, req); });
  expect(await open()).toMatchObject({ ok: true }); expect(lastOpen()).toEqual(byName);
});
it('explains a preview refused for lack of a thread instead of naming the internal reason', async () => {
  const { action, harness } = await fixture(true);
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  expect(await harness.callRpc('agentPreview.start', { projectId: 'p', path: draft.file.path })).toMatchObject({ ok: false, code: 'refused', error: 'dev is not a known sandbox. Preview it beside a thread to approve, or pick a sandbox.' });
  expect(await harness.callRpc('agentPreview.start', { projectId: 'p', path: draft.file.path, live: true })).toMatchObject({ ok: false, code: 'refused', error: expect.stringMatching(/^Live runs real actions/) });
});
function previewApi() {
  const request = vi.fn(async (_token: string, path: string) => ({
    host: 'test.api.salesforce.com',
    body: path.endsWith('/authoring/scripts') ? { status: 'success', compiledArtifact: { globalConfiguration: {} } }
      : path.endsWith('/preview/sessions') ? { sessionId: 'remote-1', messages: [{ message: 'Welcome' }] }
        : { messages: [{ message: 'Hello there', planId: 'plan-1' }] }
  }));
  return { request, transport: { bootstrap: async () => 'JWT', request } as unknown as AgentforceTransport };
}
it('starts and talks to a Live preview from the user\'s own clicks without a thread', async () => {
  const { request, transport } = previewApi();
  const { action, harness, zcc, exec } = await fixture(true, transport);
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  // A new draft has no default_agent_user, which sf agent preview cannot start, so Live runs on the Preview API.
  const started = await harness.callRpc('agentPreview.start', { projectId: 'p', path: draft.file.path, live: true, startedByUser: true }) as any;
  expect(started).toMatchObject({ ok: true, data: { response: 'Welcome' } });
  expect(request.mock.calls[1][2]).toMatchObject({ enableSimulationMode: false });
  const sessionId = started.data.sessionId;
  expect(await harness.callRpc('agentPreview.send', { projectId: 'p', path: draft.file.path, live: true, sessionId, utterance: 'hi', startedByUser: true })).toMatchObject({ ok: true, data: { sessionId, utterance: 'hi', response: 'Hello there', planId: 'plan-1' } });
  expect(await harness.callRpc('agentPreview.end', { projectId: 'p', path: draft.file.path, live: true, sessionId, startedByUser: true })).toMatchObject({ ok: true, data: { sessionId } });
  // An ended session is gone from the lab, so a late send cannot reach it.
  expect(await harness.callRpc('agentPreview.send', { projectId: 'p', path: draft.file.path, live: true, sessionId, utterance: 'again', startedByUser: true })).toMatchObject({ ok: true });
  expect(confirmation).not.toHaveBeenCalled();
  expect(exec.mock.calls.filter(([args]) => args[0] === 'agent' && args[1] === 'preview').map(([args]) => args[2])).toEqual(['send']);
});
it('asks before an agent-driven Live preview on the Preview API, and explains the CLI default_agent_user crash', async () => {
  const { request, transport } = previewApi();
  const { action, harness, zcc, exec, root } = await fixture(true, transport);
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  const agent = harness.agentTools.find(tool => tool.name === 'sf_agent')!;
  const started = agent.execute({ action: 'preview.start', path: draft.file.path, live: true }, { ...ctx, threadId: 'thread' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce());
  harness.submitInteraction({ approved: true });
  expect(await started).toMatchObject({ ok: true, data: { response: 'Welcome' } });
  request.mockRejectedValueOnce(new Error('Salesforce session expired'));
  const sessionId = ((await started) as any).data.sessionId;
  const sent = agent.execute({ action: 'preview.send', path: draft.file.path, live: true, sessionId, utterance: 'hi' }, { ...ctx, threadId: 'thread' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledTimes(2));
  harness.submitInteraction({ approved: true });
  expect(await sent).toMatchObject({ ok: false, code: 'preview_failed', error: 'Salesforce session expired' });
  // A bundle that names a default_agent_user goes to the CLI; its crash still reads as a fix, not a stack trace.
  const source = join(root, draft.file.path);
  writeFileSync(source, readFileSync(source, 'utf8').replace('config:\n', 'config:\n    default_agent_user: "bot@example.com"\n'));
  exec.mockImplementationOnce(async () => ({ code: 1, stderr: '', stdout: JSON.stringify({ status: 1, message: "Cannot read properties of undefined (reading 'replace')" }) }));
  expect(await harness.callRpc('agentPreview.start', { projectId: 'p', path: draft.file.path, startedByUser: true })).toMatchObject({ ok: false, code: 'preview_failed', error: expect.stringContaining('no default_agent_user') });
});
it('asks before opening Agentforce Builder on an org that is not a known sandbox', async () => {
  const { action, harness, zcc, exec } = await fixture(true);
  const draft = await action('draft.create', { name: 'Help', apiName: 'Help' });
  const open = (extra: Record<string, unknown> = {}) => harness.callRpc('agentBuilder.open', { projectId: 'p', path: draft.file.path, ...extra }) as Promise<any>;
  const opens = () => exec.mock.calls.filter(([args]) => args[0] === 'org' && args[1] === 'open');
  expect(await open()).toMatchObject({ ok: false, code: 'refused', error: expect.stringContaining('Open it beside a thread') });
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  const denied = open({ threadId: 'thread' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce());
  expect(confirmation.mock.calls[0]![0]).toMatchObject({ threadId: 'thread', payload: { summary: 'Open Help in Agentforce Builder on dev (unknown)' } });
  harness.cancelInteraction();
  expect(await denied).toMatchObject({ ok: false, code: 'refused', error: 'Operator cancelled opening Agentforce Builder.' });
  expect(opens()).toHaveLength(0);
  const approved = open({ threadId: 'thread' });
  await vi.waitFor(() => expect(confirmation).toHaveBeenCalledTimes(2));
  harness.submitInteraction({ approved: true });
  expect(await approved).toMatchObject({ ok: true });
  expect(opens()).toHaveLength(1);
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
it('runs an approved bare COUNT() query execute without an added LIMIT', async () => {
  const { action, harness, request, zcc } = await fixture();
  const confirmation = vi.spyOn(zcc.ui, 'requestInput');
  const sent = () => (request.mock.calls.at(-1)![1] as { query: { q: string } }).query.q;
  const run = async (query: string) => {
    const pending = action('query.execute', { query }, { ...ctx, threadId: 'thread' });
    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce());
    harness.submitInteraction({ approved: true });
    return pending;
  };
  expect(await run('SELECT COUNT() FROM Account')).toMatchObject({ ok: true });
  expect(sent()).toBe('SELECT COUNT() FROM Account');
  expect(await action('query.execute', { query: 'SELECT COUNT() FROM Account LIMIT 5' })).toMatchObject({ ok: true });
  expect(sent()).toBe('SELECT COUNT() FROM Account LIMIT 5');
  expect(await action('query.execute', { query: 'SELECT Id FROM Account LIMIT 1' })).toMatchObject({ ok: true });
  expect(sent()).toBe('SELECT Id FROM Account LIMIT 1');
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
  // The CLI previews a bundle that names its default_agent_user; others run on the Preview API.
  const source = join(root, created.file.path);
  writeFileSync(source, readFileSync(source, 'utf8').replace('config:\n', 'config:\n    default_agent_user: "bot@example.com"\n'));
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

it('supports a realistic large source through semantic actions and confined revision-pinned paths', async () => {
  const { action, root } = await fixture(false, previewApi().transport);
  const created = await action('draft.create', { name: 'Large', apiName: 'Large' });
  const source = created.file.content + '\n# ' + 'x'.repeat(234_000) + '\n';
  writeFileSync(join(root, created.file.path), source);
  expect(await action('source.parse', { source })).toMatchObject({ ok: true });
  expect(await action('source.parse', { path: created.file.path })).toMatchObject({ ok: true });
  expect(await action('studio.start', { path: created.file.path, expectedSha256: '0'.repeat(64) })).toMatchObject({ ok: false, code: 'sha_mismatch' });
  expect(await action('studio.start', { path: '../outside.agent' })).toMatchObject({ ok: false, code: 'path_refused' });
  const run = await action('studio.start', { path: created.file.path, engine: 'preview' });
  expect(run).toMatchObject({ ok: true, data: { sourceHash: expect.any(String) } });
  await action('studio.end', { id: run.data.id });
  expect(() => actionInput({ source }, 'source.parse')).not.toThrow();
  expect(() => actionInput({ source })).toThrow('200,000');
  expect(() => actionInput({ source: 'x'.repeat(10 * 1024 * 1024 + 1) }, 'studio.start')).toThrow('10 MB');
  expect(() => actionInput({ source, other: 'x'.repeat(200001) }, 'studio.start')).toThrow('200,000');
});

it('returns background handles for public suite run and compare actions', async () => {
  const { action, root } = await fixture(false, previewApi().transport);
  const created = await action('draft.create', { name: 'Async', apiName: 'Async' });
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests/Async.scenario.json'), JSON.stringify({ cases: [{ id: 'a', utterances: ['hello'], expect: { contains: ['Hello'] } }] }));
  const run = await action('suites.run', { agentPath: created.file.path, requestId: 'attempt-1' });
  expect(run).toMatchObject({ ok: true, status: 'running', jobId: expect.any(String) });
  await vi.waitFor(async () => expect(await action('suites.result', { jobId: run.jobId })).toMatchObject({ status: 'completed', result: { results: { a: { outcome: 'pass' } } } }));
  expect(await action('suites.run', { agentPath: created.file.path, requestId: 'attempt-1' })).toMatchObject({ jobId: run.jobId, status: 'completed' });
  const compared = await action('suites.compare', { agentPath: created.file.path, source: created.file.content + '\n# candidate' });
  await vi.waitFor(async () => expect(await action('suites.result', { jobId: compared.jobId })).toMatchObject({ status: 'completed', result: { comparison: { referenceHash: expect.any(String), candidateHash: expect.any(String) } } }));
});
