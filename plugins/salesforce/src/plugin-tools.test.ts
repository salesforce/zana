import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { envelopeTitle } from '../lib/guardrail.js';
import { createKvArtifactStore } from '../lib/artifacts.js';
import { compactError } from '../lib/dx-project.js';
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
    '/proj/force-app/main/default/agents/MyBot.agent': 'config {\n  name: "MyBot"\n}\nstart_agent {\n}\n',
    '/proj/evals/spec.json': JSON.stringify({ tests: [{ utterance: 'hello' }] }),
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
    '/proj/evals': ['spec.json'],
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
    }
  };
}

const ctx = { threadId: 'thr-1', projectId: 'p1', signal: AbortSignal.abort() };

describe('salesforce family tools', () => {
  it('exposes doctor/status/org RPC and CLI help', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const doctor = await harness.callRpc('doctor');
    expect(doctor).toMatchObject({ cliOk: true });
    const status = await harness.callRpc('status');
    expect(status).toMatchObject({ defaultOrg: 'dev', dxProject: true });
    const org = await harness.callRpc('org');
    expect(org).toMatchObject({ ok: true });
    expect(JSON.stringify(org)).not.toContain('SECRET_TOKEN');
    const help = await harness.cli!.run(['--help'], { pluginId: 'salesforce', argv: ['--help'] });
    expect(help.stdout).toContain('zcc sf doctor');
    const unknown = await harness.cli!.run(['nope'], { pluginId: 'salesforce', argv: ['nope'] });
    expect(unknown.exitCode).toBe(2);
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    await expect(soql.execute({ action: 'nope' }, ctx)).resolves.toMatchObject({ code: 'invalid_input' });
  });

  it('searches, describes, and validates SOQL', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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

  it('diagnoses Apex, runs targeted tests, and fetches logs on a sandbox', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const lwc = harness.agentTools.find((row) => row.name === 'sf_lwc')!;
    await expect(lwc.execute({ action: 'scan' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(lwc.execute({ action: 'inspect', component: 'hello' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(lwc.execute({ action: 'diagnose', component: 'hello' }, ctx)).resolves.toMatchObject({ ok: true });
    await expect(lwc.execute({ action: 'test.jest', component: 'hello' }, ctx)).resolves.toMatchObject({ ok: true });
  });

  it('refuses LWC work without a DX project and reports jest failures', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps({ jestCode: 1 }));
    const lwc = harness.agentTools.find((row) => row.name === 'sf_lwc')!;
    await expect(lwc.execute({ action: 'scan' }, ctx)).resolves.toMatchObject({ code: 'not_configured' });
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    await expect(lwc.execute({ action: 'test.jest', component: 'hello' }, ctx)).resolves.toMatchObject({
      ok: false,
      code: 'jest_failed'
    });
  });

  it('surfaces org RPC/CLI failures and Apex/LWC input errors', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps({ kind: 'production' }));
    harness.setSettings({ defaultOrg: 'dev' });
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    const pending = soql.execute({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 1' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(pending).resolves.toMatchObject({ ok: true });

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc2, mockDeps());
    harness2.setSettings({ defaultOrg: 'dev' });
    const soql2 = harness2.agentTools.find((row) => row.name === 'sf_soql')!;
    const exported = soql2.execute({ action: 'query.export', query: 'SELECT Id FROM Account LIMIT 1' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness2.cancelInteraction();
    await expect(exported).resolves.toMatchObject({ code: 'refused' });

    const { zcc: zcc3, harness: harness3 } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc3, mockDeps({ kind: 'production' }));
    harness3.setSettings({ defaultOrg: 'dev' });
    const soql3 = harness3.agentTools.find((row) => row.name === 'sf_soql')!;
    const denied = soql3.execute({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 1' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness3.submitInteraction({ approved: false });
    await expect(denied).resolves.toMatchObject({ code: 'refused' });
  });

  it('fails closed when requestInput throws and when the CLI org lookup fails', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps({ kind: 'production' }));
    harness.setSettings({ defaultOrg: 'dev' });
    zcc.ui.requestInput = async () => {
      throw new Error('no renderer');
    };
    const soql = harness.agentTools.find((row) => row.name === 'sf_soql')!;
    await expect(
      soql.execute({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 1' }, ctx)
    ).resolves.toMatchObject({ ok: false, code: 'refused' });

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc: zcc3, harness: harness3 } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc3, missingCli);
    harness3.setSettings({ defaultOrg: 'dev' });
    await expect(harness3.callRpc('org')).resolves.toMatchObject({ ok: false, code: 'cli_missing' });
    const orgCli = await harness3.cli!.run(['org'], { pluginId: 'salesforce', argv: ['org'] });
    expect(orgCli.exitCode).toBe(1);
    const defaultDoctor = await harness3.cli!.run([], { pluginId: 'salesforce', argv: [] });
    expect(defaultDoctor.exitCode).toBe(1);
  });

  it('refuses Apex paths outside the project and missing LWC Jest', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps());
    const apex = harness.agentTools.find((row) => row.name === 'sf_apex')!;
    await expect(
      apex.execute({ action: 'diagnose', path: 'force-app/main/default/classes/Widget.cls' }, ctx)
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
    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps());
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'inspect' }, ctx)).resolves.toMatchObject({ code: 'not_configured' });
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    await expect(agent.execute({ action: 'inspect' }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: expect.stringMatching(/1 Agent Script/)
    });
    await expect(agent.execute({ action: 'inspect', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({ ok: true });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, deps);
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      code: 'compiler_missing'
    });
  });

  it('compiles with the official library and surfaces compiler failures', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'preview.start', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      ok: true,
      artifactId: expect.any(String),
      data: { sessionId: 'sess-1' }
    });
    await expect(
      agent.execute({ action: 'preview.send', sessionId: 'sess-1', utterance: 'hi' }, ctx)
    ).resolves.toMatchObject({ ok: true });
    await expect(agent.execute({ action: 'preview.end', sessionId: 'sess-1' }, ctx)).resolves.toMatchObject({
      ok: true
    });
    await expect(
      agent.execute({ action: 'eval.run', specPath: 'evals/spec.json', botVersionId: 'bv-1' }, ctx)
    ).resolves.toMatchObject({ ok: true, summary: expect.stringMatching(/passed/) });
    await expect(agent.execute({ action: 'eval.run', specPath: '../secret.json' }, ctx)).resolves.toMatchObject({
      code: 'path_refused'
    });
    await expect(agent.execute({ action: 'lifecycle.list' }, ctx)).resolves.toMatchObject({ ok: true });
  });

  it('requires confirmation for preview on production and always for publish', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps({ kind: 'production' }));
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    const preview = agent.execute({ action: 'preview.start', apiName: 'MyBot' }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(preview).resolves.toMatchObject({ ok: true });

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce' });
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

  it('gates activate on eval evidence and still confirms untested intent', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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

    const { zcc: zcc2, harness: harness2 } = createFakePluginHost({ pluginId: 'salesforce' });
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

  it('falls back to the v1 evaluation path after a 404', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(
      zcc,
      mockDeps({
        rest: (req) => {
          if (req.path === '/einstein/ai-evaluations/runs') {
            return { status: 404, json: null, text: 'missing' };
          }
          if (req.path === '/einstein/evaluation/v1/tests') {
            return { status: 200, json: { success: true, passedCount: 1, failedCount: 0, botVersionId: 'bv-1' }, text: '{}' };
          }
          return { status: 200, json: { records: [] }, text: '{}' };
        }
      })
    );
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agent = harness.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(
      agent.execute({ action: 'eval.run', specPath: 'evals/spec.json', botVersionId: 'bv-1' }, ctx)
    ).resolves.toMatchObject({ ok: true, summary: expect.stringMatching(/passed/) });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    await expect(
      agent.execute({ action: 'eval.run', specPath: 'force-app/main/default/classes/Widget.cls' }, ctx)
    ).resolves.toMatchObject({ code: 'invalid_input' });

    const thrown: SalesforceDeps = {
      ...base,
      execSf: async (args) => {
        if (args[0] === 'agent' && args[1] === 'validate') throw new Error('spawn failed');
        return base.execSf(args);
      }
    };
    const { zcc: zccT, harness: harnessT } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc: zccP, harness: harnessP } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zccP, previewFail);
    harnessP.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentP = harnessP.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agentP.execute({ action: 'preview.start', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      code: 'preview_failed'
    });

    const { zcc: zccE, harness: harnessE } = createFakePluginHost({ pluginId: 'salesforce' });
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
      agentE.execute({ action: 'eval.run', specPath: 'evals/spec.json' }, ctx)
    ).resolves.toMatchObject({ code: 'api_error' });

    const { zcc: zccL, harness: harnessL } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc: zccPub, harness: harnessPub } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc: zccA, harness: harnessA } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc: zccV, harness: harnessV } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zccV, vanished);
    harnessV.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const agentV = harnessV.agentTools.find((row) => row.name === 'sf_agent')!;
    await expect(agentV.execute({ action: 'compile', apiName: 'MyBot' }, ctx)).resolves.toMatchObject({
      code: 'compiler_missing'
    });

    const { zcc: zccProd, harness: harnessProd } = createFakePluginHost({ pluginId: 'salesforce' });
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

describe('salesforce helpers', () => {
  it('names every guardrail envelope', () => {
    expect(envelopeTitle('org.production.read')).toMatch(/production/i);
    expect(envelopeTitle('org.unknown.read')).toMatch(/unknown/i);
    expect(envelopeTitle('apex.anonymous')).toMatch(/anonymous/i);
    expect(envelopeTitle('soql.unbounded')).toMatch(/unbounded/i);
    expect(envelopeTitle('soql.export')).toMatch(/export/i);
    expect(envelopeTitle('agent.publish')).toMatch(/publish/i);
    expect(envelopeTitle('agent.activate')).toMatch(/activate/i);
  });

  it('round-trips kv artifacts and formats API errors', async () => {
    const kv = new Map<string, unknown>();
    const store = createKvArtifactStore({
      get: async (key) => kv.get(key) as never,
      set: async (key, value) => {
        kv.set(key, value);
      }
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
