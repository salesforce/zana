import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { envelopeTitle } from '../lib/guardrail.js';
import { ARTIFACT_RETENTION, createKvArtifactStore } from '../lib/artifacts.js';
import { compactError } from '../lib/dx-project.js';
import { AGENT_SCRIPT_EXAMPLES } from '../lib/agent-script-model.js';
import { STUDIO_CHANGED_CHANNEL } from '../lib/studio-contract.js';
import type { SalesforceDeps, SalesforceRequest } from '../lib/types.js';

function orgDisplay(kind: 'sandbox' | 'production' = 'sandbox') {
  return JSON.stringify({
    result: {
      alias: 'dev',
      username: 'dev@example.com',
      orgId: '00Dxx0000000001',
      instanceUrl:
        kind === 'sandbox' ? 'https://foo--dev.sandbox.my.salesforce.com' : 'https://org.my.salesforce.com',
      accessToken: 'SECRET_TOKEN',
      apiVersion: '62.0',
      isSandbox: kind === 'sandbox',
      isScratchOrg: false
    }
  });
}

function baseFs() {
  const files: Record<string, string> = {
    '/proj/sfdx-project.json': '{"packageDirectories":[{"path":"force-app"}]}',
    '/proj/force-app/main/default/lwc/hello/hello.js-meta.xml': '<xml/>',
    '/proj/force-app/main/default/lwc/hello/hello.js': 'import { api } from "lwc"; export default class Hello { @api name; }',
    '/proj/force-app/main/default/lwc/hello/hello.html': '<template></template>',
    '/proj/force-app/main/default/classes/Widget.cls': 'public class Widget {}',
    '/proj/force-app/main/default/agents/MyBot.agent': 'config {\n  name: "MyBot"\n  default_agent_user: "bot@example.com"\n}\nstart_agent {\n}\n',
    '/proj/evals/spec.json': JSON.stringify({ tests: [{ utterance: 'hello' }] }),
    '/proj/evals/spec.yaml': 'subjectType: AGENT\ntests:\n  - utterance: hello\n',
    '/proj/evals/spec.yaml': 'subjectName: MyBot\ntests:\n  - utterance: hello\n',
    '/proj/node_modules/.bin/sfdx-lwc-jest': '#!/usr/bin/env node'
  };
  const dirs: Record<string, string[]> = {
    '/proj': ['sfdx-project.json', 'force-app', 'node_modules', 'evals'],
    '/proj/force-app': ['main'],
    '/proj/force-app/main': ['default'],
    '/proj/force-app/main/default': ['lwc', 'classes', 'agents'],
    '/proj/force-app/main/default/lwc': ['hello'],
    '/proj/force-app/main/default/lwc/hello': ['hello.js-meta.xml', 'hello.js', 'hello.html'],
    '/proj/force-app/main/default/classes': ['Widget.cls'],
    '/proj/force-app/main/default/agents': ['MyBot.agent'],
    '/proj/evals': ['spec.json', 'spec.yaml'],
    '/proj/node_modules': ['.bin'],
    '/proj/node_modules/.bin': ['sfdx-lwc-jest']
  };
  return { files, dirs };
}

function mockDeps(options?: {
  kind?: 'sandbox' | 'production';
  rest?: (req: SalesforceRequest) => { status: number; json: unknown; text: string };
  jestCode?: number;
  agentCompileCode?: number;
  extraFiles?: Record<string, string>;
  extraDirs?: Record<string, string[]>;
}): SalesforceDeps {
  const kind = options?.kind ?? 'sandbox';
  const { files, dirs } = baseFs();
  Object.assign(files, options?.extraFiles);
  Object.assign(dirs, options?.extraDirs);
  if (options?.extraFiles) {
    for (const file of Object.keys(options.extraFiles)) {
      if (file.includes('node_modules/.bin/agent-script') && !dirs['/proj/node_modules/.bin']?.includes('agent-script')) {
        dirs['/proj/node_modules/.bin'] = [...(dirs['/proj/node_modules/.bin'] ?? []), 'agent-script'];
      }
    }
  }
  return {
    execSf: async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: '@salesforce/cli/2.0.0\n', stderr: '' };
      if (args[0] === 'org' && args[1] === 'list') {
        return { code: 0, stdout: JSON.stringify({ result: { sandboxes: [{ alias: 'dev', username: 'dev@example.com', isSandbox: true }] } }), stderr: '' };
      }
      if (args.includes('display')) return { code: 0, stdout: orgDisplay(kind), stderr: '' };
      if (args[0] === 'agent' && args[1] === '--help') {
        return { code: 0, stdout: 'validate preview publish activate\n', stderr: '' };
      }
      if (args[0] === 'agent' && args[1] === 'validate') {
        return { code: 0, stdout: JSON.stringify({ status: 0, result: { success: true } }), stderr: '' };
      }
      if (args[0] === 'agent' && args[1] === 'preview') {
        return { code: 0, stdout: JSON.stringify({ status: 0, result: { sessionId: 'sess-1', response: 'hello' } }), stderr: '' };
      }
      if (args[0] === 'agent' && args[1] === 'publish') {
        return { code: 0, stdout: JSON.stringify({ status: 0, result: { id: 'bv-1' } }), stderr: '' };
      }
      if (args[0] === 'agent' && args[1] === 'activate') {
        return { code: 0, stdout: JSON.stringify({ status: 0, result: { success: true } }), stderr: '' };
      }
      if (args[0] === 'agent' && args[1] === 'deactivate') {
        return args.includes('Broken')
          ? { code: 1, stdout: JSON.stringify({ status: 1, message: 'No active version for Broken.' }), stderr: '' }
          : { code: 0, stdout: JSON.stringify({ status: 0, result: { success: true } }), stderr: '' };
      }
      if (args[0] === 'agent' && args[1] === 'test') {
        if (args.includes('--help')) {
          return { code: 0, stdout: 'USAGE\n  $ sf agent test run-eval --spec <value>\n', stderr: '' };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            status: 0,
            result: { success: true, passedCount: 1, failedCount: 0, subjectName: 'MyBot', botVersionId: 'bv-1' }
          }),
          stderr: ''
        };
      }
      return { code: 1, stdout: '', stderr: 'unexpected' };
    },
    request: async (_org, req) => {
      if (options?.rest) return options.rest(req);
      if (req.path === '/sobjects') {
        return { status: 200, json: { sobjects: [{ name: 'Account', label: 'Account' }] }, text: '{}' };
      }
      if (req.path.includes('/describe')) {
        return { status: 200, json: { name: 'Account', fields: [{ name: 'Id', type: 'id', label: 'Id' }] }, text: '{}' };
      }
      if (req.path.includes('runTestsSynchronous')) {
        return { status: 200, json: { summaries: [{ name: 'WidgetTest', outcome: 'Pass' }] }, text: '{}' };
      }
      if (req.path.includes('ApexLog') && req.path.includes('Body')) {
        return { status: 200, json: null, text: 'DEBUG|' };
      }
      if (req.path.includes('tooling/query')) {
        return { status: 200, json: { records: [{ Id: '07Lxx' }] }, text: '{}' };
      }
      if (req.path.includes('executeAnonymous')) {
        return { status: 200, json: { compiled: true, success: true }, text: '{}' };
      }
      if (req.path.includes('einstein')) {
        return { status: 200, json: { success: true, passedCount: 1, failedCount: 0, botVersionId: 'bv-1' }, text: '{}' };
      }
      return { status: 200, json: { totalSize: 1, records: [{ Id: '001' }] }, text: '{}' };
    },
    now: () => Date.now(),
    exists: (path) => path in files || path in dirs,
    stat: (path) => (path in dirs ? 'dir' : path in files ? 'file' : 'missing'),
    readFile: (path) => files[path] ?? null,
    readdir: (path) => dirs[path] ?? [],
    realpath: (path) => path,
    spawnContained: async (bin) => {
      if (bin.includes('agent-script') || bin.includes('agentscript')) {
        return { code: options?.agentCompileCode ?? 0, stdout: 'compiled', stderr: options?.agentCompileCode ? 'syntax' : '' };
      }
      return { code: options?.jestCode ?? 0, stdout: 'PASS', stderr: '' };
    },
    writeFile: (path, content) => {
      files[path] = content;
    }
  };
}

const ctx = { threadId: 'thr-1', projectId: 'p1', signal: AbortSignal.abort() };

describe('salesforce family tools', () => {
  it('discovers preview context through confined source reads and carries typed RPC values to the CLI', async () => {
    const base = mockDeps();
    const execSf = vi.fn(base.execSf);
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, { ...base, execSf });
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    await expect(harness.callRpc('agentPreview.context', { source: 'variables:\n  sessionId: linked string\n    source: @MessagingSession.Id' })).resolves.toMatchObject({ ok: true, fields: [{ name: '$Context.sessionId', type: 'Text' }] });
    await expect(harness.callRpc('agentPreview.context', { path: 'force-app/main/default/agents/MyBot.agent' })).resolves.toMatchObject({ ok: true, fields: [] });
    await expect(harness.callRpc('agentPreview.context', { path: '/etc/passwd' })).resolves.toMatchObject({ ok: false });
    const contextVariables = [{ name: 'verified', type: 'Boolean', value: false }];
    await expect(harness.callRpc('agentPreview.start', { path: 'force-app/main/default/agents/MyBot.agent', contextVariables, startedByUser: true })).resolves.toMatchObject({ ok: true });
    const args = execSf.mock.calls.find(([args]) => args[0] === 'agent' && args[1] === 'preview' && args[2] === 'start')![0];
    expect(JSON.parse(args[args.indexOf('--context-variables-json') + 1]!)).toEqual(contextVariables);
    await expect(harness.callRpc('agentPreview.start', { path: 'force-app/main/default/agents/MyBot.agent', contextVariables: {}, startedByUser: true })).resolves.toMatchObject({ ok: false, code: 'invalid_input' });
  });
  it('lists CLI orgs once across status, org and setting reads until Refresh asks again', async () => {
    const base = mockDeps();
    let lists = 0;
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, { ...base, execSf: async (args, opts) => {
      if (args[0] === 'org' && args[1] === 'list' && args[2] === '--json') lists += 1;
      return base.execSf(args, opts);
    } });
    harness.setSettings({ defaultOrg: '', projectRoot: '/proj' });
    await Promise.all([harness.callRpc('status'), harness.callRpc('orgs'), harness.callRpc('orgs', { projectId: 'p1' })]);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    await expect(harness.callRpc('orgs')).resolves.toMatchObject({ ok: true, selectedAlias: 'dev' });
    expect(lists).toBe(1);
    await expect(harness.callRpc('orgs', { refresh: true })).resolves.toMatchObject({ ok: true, orgs: [expect.objectContaining({ alias: 'dev' })] });
    await harness.callRpc('status');
    expect(lists).toBe(2);
    await harness.callRpc('status', { refresh: true, projectId: 'p1' });
    await harness.callRpc('orgs', { projectId: 'p1' });
    expect(lists).toBe(3);
  });

  it('exposes doctor/status/org RPC and CLI help', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const doctor = await harness.callRpc('doctor');
    expect(doctor).toMatchObject({ cliOk: true });
    const status = await harness.callRpc('status');
    expect(status).toMatchObject({ defaultOrg: 'dev', dxProject: true });
    expect(status).toMatchObject({
      orgs: [expect.objectContaining({ alias: 'dev', username: 'dev@example.com' })]
    });
    const listedOrgs = await harness.callRpc('orgs');
    expect(listedOrgs).toMatchObject({ ok: true, selectedAlias: 'dev' });
    expect(JSON.stringify(listedOrgs)).not.toContain('SECRET_TOKEN');
    const org = await harness.callRpc('org');
    expect(org).toMatchObject({ ok: true });
    expect(JSON.stringify(org)).not.toContain('SECRET_TOKEN');
    const help = await harness.cli!.run(['--help'], { pluginId: 'salesforce', argv: ['--help'] });
    expect(help.stdout).toContain('zcc sf doctor');
    expect(help.stdout).toContain('zcc sf lint');
    const listed = await harness.callRpc('agentFiles.list');
    expect(listed).toMatchObject({ ok: true });
    expect((listed as { files: Array<{ apiName: string }> }).files.some((row) => row.apiName === 'MyBot')).toBe(true);
    const parsed = await harness.callRpc('agentScript.parse', { source: AGENT_SCRIPT_EXAMPLES[0]!.source, dialect: 'agentforce' });
    expect(parsed).toMatchObject({ ok: true });
    const queried = await harness.callRpc('agentScript.query', {
      source: AGENT_SCRIPT_EXAMPLES[0]!.source,
      dialect: 'agentforce',
      query: 'symbols'
    });
    expect(queried).toMatchObject({ ok: true });
    const lint = await harness.cli!.run(['lint', 'force-app/main/default/agents/MyBot.agent'], {
      pluginId: 'salesforce',
      argv: ['lint', 'force-app/main/default/agents/MyBot.agent']
    });
    expect(lint.stdout).toContain('MyBot.agent');
    const written = await harness.callRpc('agentFiles.write', {
      path: 'force-app/main/default/agents/MyBot.agent',
      content: 'config:\n    agent_name: "MyBot"\nstart_agent:\n    reasoning:\n        instructions: "hi"\n'
    });
    expect(written).toMatchObject({ ok: true });
    // An open Studio hears the write and reloads the file.
    expect(harness.published).toContainEqual({ event: STUDIO_CHANGED_CHANNEL, payload: expect.objectContaining({ path: 'force-app/main/default/agents/MyBot.agent', kind: 'files' }) });
    const reread = await harness.callRpc('agentFiles.read', { path: 'force-app/main/default/agents/MyBot.agent' });
    expect(reread).toMatchObject({ ok: true, file: { apiName: 'MyBot' } });
    await expect(harness.callRpc('agentFiles.read', { path: '/etc/passwd' })).resolves.toMatchObject({
      ok: false,
      code: 'path_refused'
    });
    await expect(
      harness.callRpc('agentFiles.write', {
        path: 'force-app/main/default/agents/MyBot.agent',
        content: 'stale',
        expectedSha256: 'deadbeef'
      })
    ).resolves.toMatchObject({ ok: false, code: 'sha_mismatch' });
    const emptyParse = await harness.callRpc('agentScript.parse', { source: '', dialect: 'agentforce' });
    expect(emptyParse).toMatchObject({ ok: true });
    await expect(harness.callRpc('agentFiles.read', {})).resolves.toMatchObject({ ok: false, code: 'invalid_input' });
    await expect(harness.callRpc('agentFiles.write', { path: 'x.agent' })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_input'
    });
    const examples = await harness.callRpc('agentScript.examples');
    expect(examples).toMatchObject({ ok: true });
    const lintAll = await harness.cli!.run(['lint'], { pluginId: 'salesforce', argv: ['lint'] });
    expect(lintAll.stdout).toContain('MyBot.agent');
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '' });
    const lintMissing = await harness.cli!.run(['lint'], { pluginId: 'salesforce', argv: ['lint'] });
    expect(lintMissing.exitCode).toBe(1);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const unknown = await harness.cli!.run(['nope'], { pluginId: 'salesforce', argv: ['nope'] });
    expect(unknown.exitCode).toBe(2);
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    await expect(soql.execute({ action: 'nope' }, ctx)).resolves.toMatchObject({ code: 'invalid_input' });
  });

  it('lists .agent files from a ZCC project folder without a DX setting', async () => {
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'salesforce',
      listProjects: async () => [{ id: 'p1', name: 'Agents', path: '/src' }]
    });
    await createSalesforcePlugin(
      zcc,
      mockDeps({
        extraFiles: { '/src/bots/QC.agent': 'config:\n    agent_name: "QC"\n' },
        extraDirs: { '/src': ['bots'], '/src/bots': ['QC.agent'] }
      })
    );
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '' });
    const listed = await harness.callRpc('agentFiles.list', { projectId: 'p1' });
    expect(listed).toMatchObject({ ok: true });
    expect((listed as { files: Array<{ path: string }> }).files.some((row) => row.path === 'bots/QC.agent')).toBe(
      true
    );
    await expect(harness.callRpc('agentFiles.list', { projectId: 'missing' })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_context'
    });
  });

  it('searches, describes, and validates SOQL', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev' });
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    await expect(soql.execute({ action: 'schema.search', term: 'Acc' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(soql.execute({ action: 'schema.describe', sobject: 'Account' }, ctx)).resolves.toMatchObject({
      ok: true,
      artifactId: expect.any(String)
    });
    await expect(soql.execute({ action: 'query.validate', query: 'SELECT Id FROM Account LIMIT 1' }, ctx)).resolves.toMatchObject({
      ok: true
    });
    await expect(
      soql.execute({ action: 'query.validate', query: 'SELECT Id FROM Account ALL ROWS' }, ctx)
    ).resolves.toMatchObject({ ok: true, summary: expect.stringMatching(/ALL ROWS/) });
  });

  it('validates a bare COUNT() as running without an added LIMIT', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev' });
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    await expect(soql.execute({ action: 'query.validate', query: 'SELECT COUNT() FROM Account' }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: 'Query parsed. A bare COUNT() runs as written, with no added LIMIT.',
      data: { limit: null }
    });
    await expect(soql.execute({ action: 'query.validate', query: 'SELECT COUNT() FROM Account LIMIT 5', limit: 50 }, ctx)).resolves.toMatchObject({
      summary: 'Query parsed. A bare COUNT() runs as written, with no added LIMIT.',
      data: { limit: 5 }
    });
    await expect(soql.execute({ action: 'query.validate', query: 'SELECT Id FROM Account LIMIT 1' }, ctx)).resolves.toMatchObject({
      summary: 'Query parsed. Bounded run will use LIMIT 1.',
      data: { limit: 1 }
    });
  });

  it('runs an approved bare COUNT() with no added LIMIT and reports the count', async () => {
    const requests: SalesforceRequest[] = [];
    const rest = (req: SalesforceRequest) => {
      requests.push(req);
      const q = req.query?.q;
      if (q === 'SELECT Id FROM Account LIMIT 5') return { status: 200, json: { totalSize: 1, done: true, records: [{ Id: '001' }] }, text: '{}' };
      return { status: 200, json: q === 'SELECT COUNT() FROM Contact' ? { done: true, records: [] } : { totalSize: 1234, done: true, records: [] }, text: '{}' };
    };
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps({ rest }));
    harness.setSettings({ defaultOrg: 'dev' });
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    const confirmation = vi.spyOn(zcc.ui, 'requestInput');
    const run = async (action: string, query: string) => {
      const before = confirmation.mock.calls.length;
      const pending = soql.execute({ action, query }, ctx);
      await vi.waitFor(() => expect(confirmation).toHaveBeenCalledTimes(before + 1));
      harness.submitInteraction({ approved: true });
      return pending as Promise<any>;
    };

    const counted = await run('query.run', 'SELECT COUNT() FROM Account');
    expect(counted).toMatchObject({ ok: true, summary: 'Count: 1234', data: { totalSize: 1234 } });
    expect(requests.at(-1)!.query).toEqual({ q: 'SELECT COUNT() FROM Account' });
    expect(confirmation.mock.calls.at(-1)![0]).toMatchObject({ payload: { preview: 'SELECT COUNT() FROM Account' } });

    await run('query.sample', 'SELECT COUNT() FROM Lead');
    expect(confirmation.mock.calls.at(-1)![0]).toMatchObject({ payload: { kind: 'soql.unbounded', preview: 'SELECT COUNT() FROM Lead' } });
    expect(requests.at(-1)!.query).toEqual({ q: 'SELECT COUNT() FROM Lead' });

    const noTotal = await run('query.run', 'SELECT COUNT() FROM Contact');
    expect(noTotal).toMatchObject({ ok: true, summary: '0 row(s); showing 0' });

    const ordinary = await soql.execute({ action: 'query.run', query: 'SELECT Id FROM Account LIMIT 5' }, ctx);
    expect(ordinary).toMatchObject({ ok: true, summary: '1 row(s); showing 1' });
    expect(requests.at(-1)!.query).toEqual({ q: 'SELECT Id FROM Account LIMIT 5' });
  });

  it('includes exact sObjects in a large org and honors schema search limits', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    const sobjects = [...Array.from({ length: 30 }, (_, i) => ({ name: `ns__Account_${i}__c` })), { name: 'Account', label: 'Account' }];
    await createSalesforcePlugin(zcc, mockDeps({ rest: () => ({ status: 200, json: { sobjects }, text: '{}' }) }));
    harness.setSettings({ defaultOrg: 'dev' });
    const soql = harness.agentTools.find(row => row.name === 'sf_soql')!;
    await expect(soql.execute({ action: 'schema.search', term: 'Account', limit: 1 }, ctx)).resolves.toMatchObject({
      ok: true, data: [{ name: 'Account', label: 'Account' }],
    });
  });

  it('diagnoses Apex, runs targeted tests, and fetches logs on a sandbox', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const apex = harness.agentTools.find((row) => row.name === 'sf_apex')!;
    await expect(
      apex.execute({ action: 'diagnose', path: 'force-app/main/default/classes/Widget.cls' }, ctx)
    ).resolves.toMatchObject({ ok: true, data: { className: 'Widget' } });
    await expect(apex.execute({ action: 'test.run', className: 'WidgetTest' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(apex.execute({ action: 'logs.fetch' }, ctx)).resolves.toMatchObject({ ok: true });
  });

  it('scans, inspects, diagnoses, and jests local LWCs', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const lwc = harness.agentTools.find((row) => row.name === 'sf_lwc')!;
    await expect(lwc.execute({ action: 'scan' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(lwc.execute({ action: 'inspect', component: 'hello' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(lwc.execute({ action: 'diagnose', component: 'hello' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(lwc.execute({ action: 'test.jest', component: 'hello' }, ctx)).resolves.toMatchObject({ ok: true });
  });

  it('refuses LWC work without a DX project and reports jest failures', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps({ jestCode: 1 }));
    const lwc = harness.agentTools.find((row) => row.name === 'sf_lwc')!;
    await expect(lwc.execute({ action: 'scan' }, { ...ctx, projectId: '' })).resolves.toMatchObject({ code: 'not_configured' });
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    await expect(lwc.execute({ action: 'test.jest', component: 'hello' }, ctx)).resolves.toMatchObject({
      ok: false,
      code: 'jest_failed'
    });
  });

  it('surfaces org RPC/CLI failures and Apex/LWC input errors', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(
      zcc,
      mockDeps({
        rest: () => ({ status: 400, json: [{ errorCode: 'INVALID_FIELD', message: 'nope' }], text: '' })
      })
    );
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const org = await harness.callRpc('org');
    expect(org).toMatchObject({ ok: true });
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    await expect(soql.execute({ action: 'schema.search', term: 'Acc' }, ctx)).resolves.toMatchObject({
      code: 'api_error'
    });
    const apex = harness.agentTools.find((row) => row.name === 'sf_apex')!;
    await expect(apex.execute({ action: 'diagnose', className: 'Widget' }, ctx)).resolves.toMatchObject({
      ok: true
    });
    const escaped = await apex.execute({ action: 'diagnose', path: '/etc/passwd' }, ctx);
    expect(escaped).toMatchObject({ code: 'path_refused' });
    const lwc = harness.agentTools.find((row) => row.name === 'sf_lwc')!;
    await expect(lwc.execute({ action: 'inspect', component: 'missing' }, ctx)).resolves.toMatchObject({
      code: 'not_found'
    });
  });

  it('requires confirmation for production reads and SOQL export', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps({ kind: 'production' }));
    harness.setSettings({ defaultOrg: 'dev' });
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    const pending = soql.execute({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 1' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(pending).resolves.toMatchObject({ ok: true });

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc2, mockDeps());
    harness2.setSettings({ defaultOrg: 'dev' });
    const soql2 = harness2.agentTools.find((row) => row.name === 'sf_soql')!;
    const exported = soql2.execute({ action: 'query.export', query: 'SELECT Id FROM Account LIMIT 1' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness2.cancelInteraction();
    await expect(exported).resolves.toMatchObject({ code: 'refused' });

    const { zcc: zcc3, harness: harness3 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc3, mockDeps({ kind: 'production' }));
    harness3.setSettings({ defaultOrg: 'dev' });
    const soql3 = harness3.agentTools.find((row) => row.name === 'sf_soql')!;
    const denied = soql3.execute({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 1' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness3.submitInteraction({ approved: false });
    await expect(denied).resolves.toMatchObject({ code: 'refused' });
  });

  it('serves standalone production browsing without a thread while agent reads still require approval', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps({ kind: 'production' }));
    harness.setSettings({ defaultOrg: 'dev' });
    const scope = { projectId: 'p1' };
    for (const method of ['soql.describeGlobal', 'sql.describeGlobal', 'soql.limits']) {
      await expect(harness.callRpc(method, scope)).resolves.toMatchObject({ ok: true, org: { kind: 'production' } });
    }
    await expect(harness.callRpc('soql.describeSObject', { ...scope, sobject: 'Account' })).resolves.toMatchObject({ ok: true });
    for (const soql of ['SELECT Id FROM Account', 'SELECT Id FROM Account LIMIT 5']) {
      await expect(harness.callRpc('soql.query', { ...scope, soql })).resolves.toMatchObject({ ok: true });
      await expect(harness.callRpc('soql.explain', { ...scope, soql })).resolves.toMatchObject({ ok: true });
    }
    await expect(harness.callRpc('soql.queryMore', { ...scope, nextRecordsUrl: '/services/data/v62.0/query/01g000000000001-2000' })).resolves.toMatchObject({ ok: true });
    await expect(harness.callRpc('soql.query', { ...scope, soql: 'DELETE FROM Account' })).resolves.toMatchObject({ ok: false, code: 'invalid_input' });
    await expect(harness.callRpc('soql.queryMore', { ...scope, nextRecordsUrl: 'https://evil.example/records' })).resolves.toMatchObject({ ok: false });
    const tool = harness.agentTools.find(row => row.name === 'sf_soql')!;
    await expect(tool.execute({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 5' }, { ...ctx, threadId: '' })).resolves.toMatchObject({ ok: false, code: 'refused' });
  });

  it('fails closed when requestInput throws and when the CLI org lookup fails', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps({ kind: 'production' }));
    harness.setSettings({ defaultOrg: 'dev' });
    zcc.ui.requestInput = async () => {
      throw new Error('no renderer');
    };
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    await expect(
      soql.execute({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 1' }, ctx)
    ).resolves.toMatchObject({ ok: false, code: 'refused' });

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(
      zcc2,
      mockDeps({
        rest: () => {
          throw new Error('network down');
        }
      })
    );
    harness2.setSettings({ defaultOrg: 'dev' });
    const soql2 = harness2.agentTools.find((row) => row.name === 'sf_soql')!;
    await expect(soql2.execute({ action: 'schema.search', term: 'Acc' }, ctx)).resolves.toMatchObject({
      ok: false,
      code: 'failed'
    });

    const missingCli: SalesforceDeps = {
      ...mockDeps(),
      execSf: async () => ({ code: 127, stdout: '', stderr: '' })
    };
    const { zcc: zcc3, harness: harness3 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc3, missingCli);
    harness3.setSettings({ defaultOrg: 'dev' });
    await expect(harness3.callRpc('org')).resolves.toMatchObject({ ok: false, code: 'cli_missing' });
    const orgCli = await harness3.cli!.run(['org'], { pluginId: 'salesforce', argv: ['org'] });
    expect(orgCli.exitCode).toBe(1);
    const defaultDoctor = await harness3.cli!.run([], { pluginId: 'salesforce', argv: [] });
    expect(defaultDoctor.exitCode).toBe(1);
  });

  it('refuses Apex paths outside the project and missing LWC Jest', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    const apex = harness.agentTools.find((row) => row.name === 'sf_apex')!;
    await expect(
      apex.execute({ action: 'diagnose', path: 'force-app/main/default/classes/Widget.cls' }, { ...ctx, projectId: '' })
    ).resolves.toMatchObject({ code: 'not_configured' });
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    await expect(apex.execute({ action: 'diagnose', path: 'nope.cls' }, ctx)).resolves.toMatchObject({
      code: 'path_refused'
    });

    const noJest: SalesforceDeps = {
      ...mockDeps(),
      stat: (path) => (path.includes('node_modules/.bin') ? 'missing' : mockDeps().stat(path)),
      exists: (path) => (path.includes('node_modules/.bin') ? false : mockDeps().exists(path))
    };
    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc2, noJest);
    harness2.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const lwc = harness2.agentTools.find((row) => row.name === 'sf_lwc')!;
    await expect(lwc.execute({ action: 'test.jest', component: 'hello' }, ctx)).resolves.toMatchObject({
      code: 'jest_missing'
    });
    await expect(lwc.execute({ action: 'inspect', relativePath: 'lwc/hello' }, ctx)).resolves.toMatchObject({
      ok: true
    });
  });

  it('persists Apex compile errors and empty log lists', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(
      zcc,
      mockDeps({
        rest: (req) => {
          if (req.path.includes('executeAnonymous')) {
            return { status: 200, json: { compiled: false, success: false, exceptionMessage: 'line 1' }, text: '{}' };
          }
          if (req.path.includes('tooling/query')) {
            return { status: 200, json: { records: [] }, text: '{}' };
          }
          if (req.path.includes('runTestsSynchronous')) {
            return { status: 400, json: { message: 'class missing' }, text: '' };
          }
          return { status: 200, json: {}, text: '{}' };
        }
      })
    );
    harness.setSettings({ defaultOrg: 'dev' });
    const apex = harness.agentTools.find((row) => row.name === 'sf_apex')!;
    const pending = apex.execute({ action: 'anon.run', body: 'System.debug(1);' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(pending).resolves.toMatchObject({ ok: true, summary: 'line 1' });
    await expect(apex.execute({ action: 'logs.fetch' }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '0 Apex log(s)'
    });
    await expect(apex.execute({ action: 'test.run', className: 'Missing' }, ctx)).resolves.toMatchObject({
      code: 'api_error'
    });
    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc2, {
      ...mockDeps(),
      execSf: async () => {
        throw new Error('spawn failed');
      }
    });
    harness2.setSettings({ defaultOrg: 'dev' });
    const apex2 = harness2.agentTools.find((row) => row.name === 'sf_apex')!;
    await expect(apex2.execute({ action: 'logs.fetch' }, ctx)).resolves.toMatchObject({ code: 'failed' });
    await expect(harness2.callRpc('org')).resolves.toMatchObject({ ok: false, code: 'org_failed' });
  });

  it('inspects confined Agent Script bundles and compiles via CLI fallback', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'inspect' }, { ...ctx, projectId: '' })).resolves.toMatchObject({ code: 'not_configured' });
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    await expect(agent.execute({ action: 'inspect' }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: expect.stringMatching(/1 Agentforce/)
    });
    await expect(agent.execute({ action: 'inspect', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(agent.execute({ action: 'diagnose', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      ok: true,
      data: expect.objectContaining({ query: 'diagnostics', diagnostics: expect.any(Array) })
    });
    await expect(
      agent.execute({ action: 'diagnose', apiName: 'MyBot', query: 'symbols' }, ctx)
    ).resolves.toMatchObject({
      ok: true,
      data: expect.objectContaining({ query: 'symbols', symbols: expect.any(Array) })
    });
    await expect(
      agent.execute({ action: 'diagnose', apiName: 'MyBot', query: 'complete', line: 0, column: 0 }, ctx)
    ).resolves.toMatchObject({
      ok: true,
      data: expect.objectContaining({ query: 'complete', completions: expect.any(Array) })
    });
    await expect(agent.execute({ action: 'diagnose', path: '/etc/passwd' }, ctx)).resolves.toMatchObject({
      code: 'path_refused'
    });
    await expect(agent.execute({ action: 'diagnose' }, ctx)).resolves.toMatchObject({ code: 'invalid_input' });
    await expect(agent.execute({ action: 'inspect', path: '/etc/passwd' }, ctx)).resolves.toMatchObject({
      code: 'path_refused'
    });
    await expect(agent.execute({ action: 'inspect', apiName: 'Missing' }, ctx)).resolves.toMatchObject({
      code: 'not_found'
    });
    await expect(agent.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: expect.stringMatching(/cli/)
    });
    await expect(agent.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({ ok: true });
    harness.setSettings({ defaultOrg: '', projectRoot: '/proj' });
    // A listed org without an explicit default is not an implicit target.
    await expect(agent.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({ ok: false, code: 'not_configured' });
    await expect(agent.execute({ action: 'nope' }, ctx)).resolves.toMatchObject({ code: 'invalid_input' });
  });

  it('fails compile when the Agent Script compiler is missing', async () => {
    const base = mockDeps();
    const deps: SalesforceDeps = {
      ...base,
      execSf: async (args) => {
        if (args[0] === 'agent') {
          return { code: 1, stdout: '', stderr: 'Command agent not found.' };
        }
        return base.execSf(args);
      }
    };
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, deps);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      code: 'compiler_missing'
    });
  });

  it('compiles with the official library and surfaces compiler failures', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(
      zcc,
      mockDeps({ extraFiles: { '/proj/node_modules/.bin/agent-script': '#!/usr/bin/env node' } })
    );
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: expect.stringMatching(/library/)
    });

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(
      zcc2,
      mockDeps({
        extraFiles: { '/proj/node_modules/.bin/agent-script': '#!/usr/bin/env node' },
        agentCompileCode: 1
      })
    );
    harness2.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent2 = harness2.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent2.execute({ action: 'compile', path: 'force-app/main/default/agents/MyBot.agent' }, ctx)).resolves.toMatchObject({
      code: 'compile_failed'
    });
  });

  it('runs preview and eval with compact artifacts', async () => {
    const calls: Array<{ args: string[]; cwd?: string; timeoutMs?: number }> = [];
    const base = mockDeps();
    const deps: SalesforceDeps = {
      ...base,
      execSf: async (args, opts) => {
        calls.push({ args, cwd: opts?.cwd, timeoutMs: opts?.timeoutMs });
        return base.execSf(args, opts);
      }
    };
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, deps);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'preview.start', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      ok: true,
      artifactId: expect.any(String),
      data: { sessionId: 'sess-1' }
    });
    expect(calls.find((row) => row.args[1] === 'preview' && row.args[2] === 'start')?.args).toEqual(
      expect.arrayContaining(['--authoring-bundle', 'MyBot', '--simulate-actions'])
    );
    expect(calls.find((row) => row.args[1] === 'preview')?.cwd).toBe('/proj');
    expect(calls.find((row) => row.args[1] === 'preview')?.timeoutMs).toBe(120_000);
    await expect(
      agent.execute({ action: 'preview.send', sessionId: 'sess-1', utterance: 'hi', apiName: 'MyBot' }, ctx)
    ).resolves.toMatchObject({ ok: true });
    await expect(agent.execute({ action: 'preview.end', sessionId: 'sess-1', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      ok: true
    });
    const restHits: string[] = [];
    const evalCalls: Array<{ args: string[]; cwd?: string }> = [];
    const evalDeps: SalesforceDeps = {
      ...base,
      execSf: async (args, opts) => {
        evalCalls.push({ args, cwd: opts?.cwd });
        return base.execSf(args, opts);
      },
      request: async (org, req) => {
        restHits.push(req.path);
        return base.request(org, req);
      }
    };
    const { zcc: zccEval, harness: harnessEval } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccEval, evalDeps);
    harnessEval.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentEval = harnessEval.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agentEval.execute({ action: 'eval.run', specPath: 'evals/spec.json', botVersionId: 'bv-1' }, ctx)
    ).resolves.toMatchObject({ ok: true, summary: expect.stringMatching(/passed/) });
    expect(restHits.some((path) => path.includes('einstein'))).toBe(false);
    expect(evalCalls.find((row) => row.args.includes('run-eval'))).toMatchObject({
      cwd: '/proj',
      args: expect.arrayContaining(['agent', 'test', 'run-eval', '--spec', '/proj/evals/spec.json'])
    });
    // A YAML spec in the sf agent test format counts its own cases, so the run reports n/n of the spec.
    await expect(agentEval.execute({ action: 'eval.run', specPath: 'evals/spec.yaml' }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: expect.stringContaining('(1/1)'),
      data: { testCount: 1 }
    });
    await expect(agent.execute({ action: 'eval.run', specPath: '../secret.json' }, ctx)).resolves.toMatchObject({
      code: 'path_refused'
    });
    await expect(agent.execute({ action: 'lifecycle.list' }, ctx)).resolves.toMatchObject({ ok: true });
  });

  it('requires confirmation for preview on production and always for publish', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps({ kind: 'production' }));
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    const preview = agent.execute({ action: 'preview.start', apiName: 'MyBot' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(preview).resolves.toMatchObject({ ok: true });

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc2, mockDeps());
    harness2.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent2 = harness2.agentTools.find((row) => row.name === 'sf_agent')!;
    const published = agent2.execute({ action: 'lifecycle.publish', apiName: 'MyBot' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness2.cancelInteraction();
    await expect(published).resolves.toMatchObject({ code: 'refused' });

    const approved = agent2.execute({ action: 'lifecycle.publish', apiName: 'MyBot' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness2.submitInteraction({ approved: true });
    await expect(approved).resolves.toMatchObject({ ok: true, summary: expect.stringMatching(/inactive/) });
  });

  it('starts simulate preview from RPC and always confirms live preview', async () => {
    const seen: string[] = [];
    const base = mockDeps();
    const deps: SalesforceDeps = {
      ...base,
      execSf: async (args, opts) => {
        if (args[1] === 'preview') seen.push(...args);
        return base.execSf(args, opts);
      }
    };
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, deps);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    await expect(
      harness.callRpc('agentPreview.start', {
        threadId: 'thr-1',
        projectId: 'p1',
        path: 'force-app/main/default/agents/MyBot.agent'
      })
    ).resolves.toMatchObject({ ok: true, data: { sessionId: 'sess-1' } });
    expect(seen).toContain('--simulate-actions');
    await expect(
      harness.callRpc('agentPreview.send', {
        threadId: 'thr-1',
        sessionId: 'sess-1',
        utterance: 'hi',
        path: 'force-app/main/default/agents/MyBot.agent'
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      harness.callRpc('agentPreview.end', {
        threadId: 'thr-1',
        sessionId: 'sess-1',
        path: 'force-app/main/default/agents/MyBot.agent'
      })
    ).resolves.toMatchObject({ ok: true });

    const live = harness.callRpc('agentPreview.start', {
      threadId: 'thr-1',
      path: 'force-app/main/default/agents/MyBot.agent',
      live: true
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(live).resolves.toMatchObject({ ok: true });
    expect(seen).toContain('--use-live-actions');
    // Ending a Live session runs no actions, so it never waits for an approval.
    const ended = harness.callRpc('agentPreview.end', { threadId: 'thr-1', sessionId: 'sess-1', path: 'force-app/main/default/agents/MyBot.agent', live: true });
    await expect(Promise.race([ended, new Promise(resolve => setTimeout(() => resolve('awaiting approval'), 50))])).resolves.toMatchObject({ ok: true });
    await expect(
      harness.callRpc('agentPreview.start', { path: 'force-app/main/default/agents/MyBot.agent' })
    ).resolves.toMatchObject({ ok: true });
    await expect(harness.callRpc('agentPreview.start', { apiName: 'PublishedBot' })).resolves.toMatchObject({ code: 'refused', error: expect.stringContaining('Live runs real actions, so it needs approval in a thread') });
  });

  it('gates activate on eval evidence and still confirms untested intent', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agent.execute({ action: 'lifecycle.activate', apiName: 'MyBot', botVersionId: 'bv-1' }, ctx)
    ).resolves.toMatchObject({ code: 'eval_required' });

    await expect(
      agent.execute({ action: 'eval.run', specPath: 'evals/spec.json', botVersionId: 'bv-1' }, ctx)
    ).resolves.toMatchObject({ ok: true });
    const activate = agent.execute({ action: 'lifecycle.activate', apiName: 'MyBot', botVersionId: 'bv-1' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(activate).resolves.toMatchObject({ ok: true });

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc2, mockDeps());
    harness2.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent2 = harness2.agentTools.find((row) => row.name === 'sf_agent')!;
    const untested = agent2.execute(
      { action: 'lifecycle.activate', apiName: 'MyBot', botVersionId: 'bv-9', allow_untested: true },
      ctx
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness2.cancelInteraction();
    await expect(untested).resolves.toMatchObject({ code: 'refused' });

    await expect(
      agent2.execute(
        { action: 'lifecycle.activate', apiName: 'MyBot', allow_untested: true },
        { threadId: '', projectId: 'p1', signal: AbortSignal.abort() }
      )
    ).resolves.toMatchObject({ code: 'refused' });
  });

  it('evals an org definition via Connect POST+poll and keeps evidence after reload', async () => {
    let polls = 0;
    const restCalls: Array<{ method: string; path: string; apiVersion?: string; body?: unknown }> = [];
    const deps = mockDeps({
      rest: (req) => {
        restCalls.push({ method: req.method, path: req.path, apiVersion: req.apiVersion, body: req.body });
        if (req.path === '/einstein/ai-evaluations/runs' && req.method === 'POST') {
          return { status: 201, json: { id: 'run-1', status: 'NEW' }, text: '{}' };
        }
        if (req.path === '/einstein/ai-evaluations/runs/run-1' && req.method === 'GET') {
          polls += 1;
          if (polls === 1) return { status: 200, json: { id: 'run-1', status: 'IN_PROGRESS' }, text: '{}' };
          return { status: 200, json: { id: 'run-1', status: 'COMPLETED' }, text: '{}' };
        }
        if (req.path === '/einstein/ai-evaluations/runs/run-1/results') {
          return {
            status: 200,
            json: { success: true, passedCount: 2, failedCount: 0, botVersionId: 'bv-1' },
            text: '{}'
          };
        }
        return { status: 200, json: { records: [] }, text: '{}' };
      }
    });
    deps.sleep = async () => undefined;
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, deps);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agent.execute({ action: 'eval.run', aiEvaluationDefinitionName: 'My_Eval', botVersionId: 'bv-1' }, ctx)
    ).resolves.toMatchObject({ ok: true, summary: expect.stringMatching(/passed/) });
    expect(restCalls[0]).toMatchObject({
      method: 'POST',
      path: '/einstein/ai-evaluations/runs',
      apiVersion: '63.0',
      body: { aiEvaluationDefinitionName: 'My_Eval' }
    });
    expect(polls).toBe(2);

    await harness.reload((api) => createSalesforcePlugin(api, deps));
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentReloaded = [...harness.agentTools].reverse().find((row) => row.name === 'sf_agent')!;
    const activate = agentReloaded.execute(
      { action: 'lifecycle.activate', apiName: 'MyBot', botVersionId: 'bv-1' },
      ctx
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(activate).resolves.toMatchObject({ ok: true });
  });

  it('previews a published agent with --api-name and no action-mode flags', async () => {
    const seen: string[] = [];
    const base = mockDeps();
    const deps: SalesforceDeps = {
      ...base,
      execSf: async (args, opts) => {
        if (args[1] === 'preview') seen.push(...args);
        return base.execSf(args, opts);
      }
    };
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, deps);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    const published = agent.execute({ action: 'preview.start', apiName: 'PublishedBot' }, ctx);
    await new Promise(resolve => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(published).resolves.toMatchObject({ ok: true });
    const explicit = agent.execute({ action: 'preview.start', apiName: 'MyBot', published: true }, ctx);
    await new Promise(resolve => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(explicit).resolves.toMatchObject({ ok: true });
    expect(seen.filter((flag) => flag === '--api-name').length).toBeGreaterThanOrEqual(2);
    expect(seen).toContain('--api-name');
    expect(seen).toContain('PublishedBot');
    expect(seen).not.toContain('--simulate-actions');
    expect(seen).not.toContain('--authoring-bundle');
  });

  it('surfaces Connect eval poll failures and published preview identity errors', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(
      zcc,
      mockDeps({
        rest: (req) => {
          if (req.path === '/einstein/ai-evaluations/runs' && req.method === 'POST') {
            return { status: 201, json: { status: 'NEW' }, text: '{}' };
          }
          return { status: 200, json: { records: [] }, text: '{}' };
        }
      })
    );
    harness.setSettings({ defaultOrg: 'dev' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agent.execute({ action: 'eval.run', aiEvaluationDefinitionName: 'My_Eval' }, ctx)
    ).resolves.toMatchObject({ code: 'api_error' });

    const pollFail = mockDeps({
      rest: (req) => {
        if (req.path === '/einstein/ai-evaluations/runs' && req.method === 'POST') {
          return { status: 201, json: { id: 'run-1' }, text: '{}' };
        }
        if (req.path.includes('/einstein/ai-evaluations/runs/run-1')) {
          return { status: 400, json: { message: 'poll failed' }, text: '' };
        }
        return { status: 200, json: { records: [] }, text: '{}' };
      }
    });
    const { zcc: zccP, harness: harnessP } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccP, pollFail);
    harnessP.setSettings({ defaultOrg: 'dev' });
    const agentP = harnessP.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agentP.execute({ action: 'eval.run', aiEvaluationDefinitionName: 'My_Eval' }, ctx)
    ).resolves.toMatchObject({ code: 'api_error' });

    const stuck = mockDeps({
      rest: (req) => {
        if (req.path === '/einstein/ai-evaluations/runs' && req.method === 'POST') {
          return { status: 201, json: { id: 'run-9' }, text: '{}' };
        }
        if (req.path === '/einstein/ai-evaluations/runs/run-9') {
          return { status: 200, json: { id: 'run-9', status: 'IN_PROGRESS' }, text: '{}' };
        }
        return { status: 200, json: { records: [] }, text: '{}' };
      }
    });
    stuck.sleep = async () => undefined;
    const { zcc: zccT, harness: harnessT } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccT, stuck);
    harnessT.setSettings({ defaultOrg: 'dev' });
    const agentT = harnessT.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agentT.execute({ action: 'eval.run', aiEvaluationDefinitionName: 'My_Eval' }, ctx)
    ).resolves.toMatchObject({ code: 'eval_timeout' });

    const { zcc: zccS, harness: harnessS } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccS, mockDeps());
    harnessS.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentS = harnessS.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agentS.execute({ action: 'preview.send', sessionId: 'sess-1', utterance: 'hi', published: true }, ctx)
    ).resolves.toMatchObject({ code: 'invalid_input' });
  });

  it('surfaces Agent Script compile, preview, eval, and lifecycle failures', async () => {
    const base = mockDeps();
    const compileFail: SalesforceDeps = {
      ...base,
      execSf: async (args) => {
        if (args[0] === 'agent' && args[1] === 'validate') {
          return { code: 1, stdout: JSON.stringify({ status: 1, message: 'syntax' }), stderr: '' };
        }
        return base.execSf(args);
      }
    };
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, compileFail);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      code: 'compile_failed'
    });
    await expect(
      agent.execute({ action: 'preview.start', path: 'force-app/main/default/agents/MyBot.agent' }, ctx)
    ).resolves.toMatchObject({ ok: true });
    await expect(agent.execute({ action: 'eval.run', specPath: 'evals/missing.json' }, ctx)).resolves.toMatchObject({
      code: 'not_found'
    });

    const evalCliFail: SalesforceDeps = {
      ...base,
      execSf: async (args, opts) => {
        if (args[0] === 'agent' && args[1] === 'test' && !args.includes('--help')) {
          return { code: 1, stdout: JSON.stringify({ status: 1, message: 'bad spec' }), stderr: '' };
        }
        return base.execSf(args, opts);
      }
    };
    const { zcc: zccSpec, harness: harnessSpec } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccSpec, evalCliFail);
    harnessSpec.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentSpec = harnessSpec.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agentSpec.execute({ action: 'eval.run', specPath: 'evals/spec.json' }, ctx)).resolves.toMatchObject({
      code: 'eval_failed'
    });

    const thrown: SalesforceDeps = {
      ...base,
      execSf: async (args) => {
        if (args[0] === 'agent' && args[1] === 'validate') throw new Error('spawn failed');
        return base.execSf(args);
      }
    };
    const { zcc: zccT, harness: harnessT } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccT, thrown);
    harnessT.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentT = harnessT.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agentT.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({ code: 'failed' });

    const previewFail: SalesforceDeps = {
      ...base,
      execSf: async (args) => {
        if (args[0] === 'agent' && args[1] === 'preview') {
          return { code: 1, stdout: JSON.stringify({ status: 1, message: 'no session' }), stderr: '' };
        }
        return base.execSf(args);
      }
    };
    const { zcc: zccP, harness: harnessP } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccP, previewFail);
    harnessP.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentP = harnessP.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agentP.execute({ action: 'preview.start', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      code: 'preview_failed'
    });

    const { zcc: zccE, harness: harnessE } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(
      zccE,
      mockDeps({
        rest: (req) => {
          if (req.path.includes('einstein')) return { status: 400, json: { message: 'eval down' }, text: '' };
          return { status: 200, json: { records: [] }, text: '{}' };
        }
      })
    );
    harnessE.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentE = harnessE.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agentE.execute({ action: 'eval.run', aiEvaluationDefinitionName: 'My_Eval' }, ctx)
    ).resolves.toMatchObject({ code: 'api_error' });

    const { zcc: zccL, harness: harnessL } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(
      zccL,
      mockDeps({
        rest: () => ({ status: 400, json: { message: 'query failed' }, text: '' })
      })
    );
    harnessL.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentL = harnessL.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agentL.execute({ action: 'lifecycle.list' }, ctx)).resolves.toMatchObject({ code: 'api_error' });

    const publishFail: SalesforceDeps = {
      ...base,
      execSf: async (args) => {
        if (args[0] === 'agent' && args[1] === 'publish') {
          return { code: 1, stdout: JSON.stringify({ status: 1, message: 'cannot publish' }), stderr: '' };
        }
        return base.execSf(args);
      }
    };
    const { zcc: zccPub, harness: harnessPub } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccPub, publishFail);
    harnessPub.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentPub = harnessPub.agentTools.find((row) => row.name === 'sf_agent')!;
    const pendingPub = agentPub.execute({ action: 'lifecycle.publish', apiName: 'MyBot' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harnessPub.submitInteraction({ approved: true });
    await expect(pendingPub).resolves.toMatchObject({ code: 'publish_failed' });
    await expect(agentPub.execute({ action: 'lifecycle.publish', apiName: 'Missing' }, ctx)).resolves.toMatchObject({
      code: 'not_found'
    });

    const activateFail: SalesforceDeps = {
      ...base,
      execSf: async (args) => {
        if (args[0] === 'agent' && args[1] === 'activate') {
          return { code: 1, stdout: JSON.stringify({ status: 1, message: 'cannot activate' }), stderr: '' };
        }
        return base.execSf(args);
      }
    };
    const { zcc: zccA, harness: harnessA } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccA, activateFail);
    harnessA.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentA = harnessA.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agentA.execute({ action: 'eval.run', specPath: 'evals/spec.json', botVersionId: 'bv-1' }, ctx)
    ).resolves.toMatchObject({ ok: true });
    const pendingAct = agentA.execute({ action: 'lifecycle.activate', apiName: 'MyBot', botVersionId: 'bv-1' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harnessA.submitInteraction({ approved: true });
    await expect(pendingAct).resolves.toMatchObject({ code: 'activate_failed' });

    const vanished: SalesforceDeps = {
      ...base,
      execSf: async (args) => {
        if (args[0] === 'agent' && args[1] === 'validate') return { code: 127, stdout: '', stderr: '' };
        return base.execSf(args);
      }
    };
    const { zcc: zccV, harness: harnessV } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccV, vanished);
    harnessV.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentV = harnessV.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agentV.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      code: 'compiler_missing'
    });

    const { zcc: zccProd, harness: harnessProd } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zccProd, mockDeps({ kind: 'production' }));
    harnessProd.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentProd = harnessProd.agentTools.find((row) => row.name === 'sf_agent')!;
    const evalPending = agentProd.execute({ action: 'eval.run', specPath: 'evals/spec.json' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harnessProd.cancelInteraction();
    await expect(evalPending).resolves.toMatchObject({ code: 'refused' });
    await expect(
      agentProd.execute({ action: 'preview.start', path: 'force-app/main/default/lwc/hello/hello.js' }, ctx)
    ).resolves.toMatchObject({ code: 'not_found' });
  });
});

describe('sf_agent lifecycle.deactivate', () => {
  it('confirms on every org kind, then takes the agent offline with sf agent deactivate', async () => {
    const calls: string[][] = [];
    const base = mockDeps();
    const deps: SalesforceDeps = { ...base, execSf: async (args, opts) => { calls.push(args); return base.execSf(args, opts); } };
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
    await createSalesforcePlugin(zcc, deps);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    const deactivations = () => calls.filter((args) => args[0] === 'agent' && args[1] === 'deactivate');
    await expect(agent.execute({ action: 'lifecycle.deactivate' }, ctx)).resolves.toMatchObject({ code: 'invalid_input', error: expect.stringContaining('apiName') });
    // A sandbox still asks: deactivate is never a silent org read.
    const confirmation = vi.spyOn(zcc.ui, 'requestInput');
    const cancelled = agent.execute({ action: 'lifecycle.deactivate', apiName: 'MyBot' }, ctx);
    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce());
    expect(confirmation.mock.calls[0]![0]).toMatchObject({ payload: { kind: 'agent.deactivate', orgAlias: 'dev', orgKind: 'sandbox', preview: 'MyBot', summary: expect.stringContaining('lose the agent') } });
    harness.cancelInteraction();
    await expect(cancelled).resolves.toMatchObject({ ok: false, code: 'refused', error: 'Operator cancelled lifecycle.deactivate.' });
    expect(deactivations()).toHaveLength(0);
    const approved = agent.execute({ action: 'lifecycle.deactivate', apiName: 'MyBot' }, ctx);
    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledTimes(2));
    harness.submitInteraction({ approved: true });
    await expect(approved).resolves.toMatchObject({ ok: true, summary: 'Deactivated MyBot', artifactId: expect.any(String) });
    expect(deactivations()).toEqual([['agent', 'deactivate', '--json', '--api-name', 'MyBot', '--target-org', 'dev']]);
    const broken = agent.execute({ action: 'lifecycle.deactivate', apiName: 'Broken' }, ctx);
    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledTimes(3));
    harness.submitInteraction({ approved: true });
    await expect(broken).resolves.toMatchObject({ ok: false, code: 'deactivate_failed', error: 'No active version for Broken.' });
    // Without a thread there is no one to ask, so nothing goes offline.
    await expect(agent.execute({ action: 'lifecycle.deactivate', apiName: 'MyBot' }, { ...ctx, threadId: '' })).resolves.toMatchObject({ code: 'refused', error: 'Operator headless lifecycle.deactivate.' });
    expect(deactivations()).toHaveLength(2);
  });
});

describe('salesforce helpers', () => {
  it('names every guardrail envelope', () => {
    expect(envelopeTitle('org.production.read')).toMatch(/production/i);
    expect(envelopeTitle('org.unknown.read')).toMatch(/unknown/i);
    expect(envelopeTitle('org.write')).toMatch(/Salesforce write/i);
    expect(envelopeTitle('apex.anonymous')).toMatch(/anonymous/i);
    expect(envelopeTitle('soql.unbounded')).toMatch(/unbounded/i);
    expect(envelopeTitle('soql.export')).toMatch(/export/i);
    expect(envelopeTitle('agent.publish')).toMatch(/publish/i);
    expect(envelopeTitle('agent.activate')).toMatch(/activate/i);
    expect(envelopeTitle('agent.deactivate')).toMatch(/deactivate/i);
    expect(envelopeTitle('agent.preview.live')).toMatch(/live preview/i);
  });

  it('keeps kv artifacts unique and bounded, pruning legacy ones first', async () => {
    const kv = new Map<string, unknown>([['artifact:soql-legacy', '{}'], ['settings', 'kept']]);
    let failList = false;
    const store = createKvArtifactStore({
      get: async (key) => kv.get(key) as never,
      set: async (key, value) => {
        kv.set(key, value);
      },
      delete: async (key) => {
        kv.delete(key);
      },
      list: async (prefix) => {
        if (failList) throw new Error('kv offline');
        return [...kv.keys()].filter((key) => !prefix || key.startsWith(prefix));
      }
    });
    const ids: string[] = [];
    for (let i = 0; i < ARTIFACT_RETENTION + 1; i += 1) ids.push(await store.put('agent-preview', { i }));
    // Same-millisecond puts never overwrite each other.
    expect(new Set(ids).size).toBe(ids.length);
    const kept = [...kv.keys()].filter((key) => key.startsWith('artifact:'));
    expect(kept).toHaveLength(ARTIFACT_RETENTION);
    expect(kv.has('artifact:soql-legacy')).toBe(false);
    expect(kv.has(`artifact:${ids[0]}`)).toBe(false);
    await expect(store.get(ids.at(-1)!)).resolves.toEqual({ i: ARTIFACT_RETENTION });
    expect(kv.get('settings')).toBe('kept');
    // A failed prune still returns the stored artifact.
    kv.delete('artifact-index');
    failList = true;
    const late = await store.put('soql', { late: true });
    await expect(store.get(late)).resolves.toEqual({ late: true });
  });

  it('round-trips kv artifacts and formats API errors', async () => {
    const kv = new Map<string, unknown>();
    const store = createKvArtifactStore({
      get: async (key) => kv.get(key) as never,
      set: async (key, value) => {
        kv.set(key, value);
      },
      delete: async (key) => {
        kv.delete(key);
      },
      list: async (prefix) => [...kv.keys()].filter((key) => !prefix || key.startsWith(prefix))
    });
    const id = await store.put('soql', { ok: true });
    await expect(store.get(id)).resolves.toEqual({ ok: true });
    await kv.set('artifact:bad', '{');
    await expect(store.get('bad')).resolves.toBe('{');
    await expect(store.get('missing')).resolves.toBeUndefined();
    const huge = 'x'.repeat(70_000);
    const clippedId = await store.put('soql', huge);
    const clipped = await kv.get(`artifact:${clippedId}`);
    expect(typeof clipped === 'string' && clipped.endsWith('…')).toBe(true);
    expect(compactError(400, [{ errorCode: 'INVALID', message: 'bad query' }], '')).toBe('INVALID: bad query');
    expect(compactError(400, [{ message: 'only' }], '')).toBe('only');
    expect(compactError(500, { message: 'boom' }, '')).toBe('boom');
    expect(compactError(500, null, '  raw  ')).toBe('raw');
    expect(compactError(418, null, '')).toBe('Salesforce API error (418)');
  });
});
