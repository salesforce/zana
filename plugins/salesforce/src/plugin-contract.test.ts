import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import { discoverPluginSkillNames } from '@zana-ai/zcc-server/plugins/plugin-skills';
import plugin from '../server.ts';
import app from '../app.tsx';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { CONSTITUTION_INSTRUCTIONS } from '../lib/constitution.js';
import type { SalesforceSdk } from '../lib/sdk-contract.js';
import type { SalesforceDeps, SalesforceRequest } from '../lib/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function mockDeps(kind: 'sandbox' | 'production' = 'sandbox', rest?: (req: SalesforceRequest) => { status: number; json: unknown; text: string }): SalesforceDeps {
  return {
    execSf: async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: '@salesforce/cli/2.0.0\n', stderr: '' };
      if (args[0] === 'org' && args[1] === 'list') {
        return {
          code: 0,
          stdout: JSON.stringify({
            result: { sandboxes: [{ alias: 'dev', username: 'dev@example.com', isSandbox: true, isDefaultUsername: true }] }
          }),
          stderr: ''
        };
      }
      if (args.includes('display')) return { code: 0, stdout: orgDisplay(kind), stderr: '' };
      if (args[0] === 'agent' && args[1] === '--help') {
        return { code: 0, stdout: 'validate preview publish activate\n', stderr: '' };
      }
      if (args[0] === 'agent' && args[1] === 'test') {
        return { code: 0, stdout: 'USAGE\n  $ sf agent test run-eval --spec <value>\n', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
    },
    request: async (_org, req) =>
      rest?.(req) ?? { status: 200, json: { totalSize: 1, records: [{ Id: '001xx', Name: 'Acme' }] }, text: '{}' },
    now: () => Date.now(),
    exists: (path) => path.endsWith('sfdx-project.json'),
    stat: (path) => (path.endsWith('sfdx-project.json') ? 'file' : 'missing'),
    readFile: (path) => (path.endsWith('sfdx-project.json') ? '{"packageDirectories":[{"path":"force-app"}]}' : null),
    readdir: () => [],
    realpath: (path) => path,
    spawnContained: async () => ({ code: 0, stdout: 'ok', stderr: '' }),
    writeFile: () => {
      throw new Error('writeFile not stubbed');
    }
  };
}

describe('salesforce plugin contract', () => {
  it('authorizes Save as against registered project roots and validates its inputs', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p', name: 'Project', path: '/project' }] });
    const deps = mockDeps();
    deps.stat = path => path === '/project' ? 'dir' : 'missing';
    const create = vi.fn(); deps.createFile = create;
    await createSalesforcePlugin(zcc, deps);
    await expect(harness.callRpc('agentFiles.create', { projectId: 'p', path: 'Copy.agent', content: 'draft', projectRoot: '/untrusted' })).resolves.toMatchObject({ ok: true, file: { path: 'Copy.agent' } });
    expect(create).toHaveBeenCalledWith('/project/Copy.agent', 'draft');
    create.mockClear();
    for (const args of [
      { projectId: 'missing', path: 'Copy.agent', content: 'draft' },
      { projectId: 'p', path: '../escape.agent', content: 'draft' },
      { projectId: 'p', content: 'draft' },
      { projectId: 'p', path: 'Copy.agent', content: 1 },
    ]) await expect(harness.callRpc('agentFiles.create', args)).resolves.toMatchObject({ ok: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('resolves composer status from the owning thread when the route has no project', async () => {
    const getThread = vi.fn(async ({ threadId }: { threadId: string }) => threadId === 't' ? { id: 't', projectId: 'p1' } as never : null);
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', getThread, listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/shared' });
    await zcc.storage.kv.set('sf:project:p1:org', 'project-dev');
    await expect(harness.callRpc('status', { threadId: 't' })).resolves.toMatchObject({ projectId: 'p1', defaultOrg: 'project-dev', projectRoot: '/tmp/dx' });
    await expect(harness.callRpc('status', { threadId: 'missing' })).resolves.toMatchObject({ ok: false, code: 'invalid_context' });
    getThread.mockClear();
    await expect(harness.callRpc('status', { projectId: 'p1', threadId: 'cli-session' })).resolves.toMatchObject({ projectId: 'p1' });
    expect(getThread).not.toHaveBeenCalled();
    await harness.callRpc('doctor', { projectId: 'p1' });
    await expect(harness.callRpc('status', {})).resolves.toMatchObject({ lastDoctor: null });
  });

  it('derives a stable id and ships DX skills', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('salesforce');
    const manifest = readPluginManifest(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    expect(manifest.skillsRootPaths).toEqual(['skills']);
    expect(discoverPluginSkillNames(root, manifest.skillsRootPaths).sort()).toEqual([
      'salesforce-constitution',
      'salesforce-dx'
    ]);
    expect(readFileSync(join(root, 'skills/salesforce-dx/SKILL.md'), 'utf8')).toContain('zcc sf doctor');
    expect(readFileSync(join(root, 'skills/salesforce-dx/SKILL.md'), 'utf8')).toContain('sf org list');
    expect(readFileSync(join(root, 'skills/salesforce-dx/SKILL.md'), 'utf8')).toContain('SOQL Explorer');
    expect(readFileSync(join(root, 'skills/salesforce-dx/SKILL.md'), 'utf8')).toContain('Agentforce');
    expect(readFileSync(join(root, 'skills/salesforce-dx/SKILL.md'), 'utf8')).toContain('diagnose');
    expect(readFileSync(join(root, 'NOTICE'), 'utf8')).toContain('Apache License 2.0');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('SalesforceSdk');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('zcc.services.use');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('SDK.md');
    expect(readFileSync(join(root, 'SDK.md'), 'utf8')).toContain('SalesforceSdk');
    const server = readFileSync(join(root, 'server.ts'), 'utf8');
    expect(server).toContain('./lib/plugin.js');
    expect(server).not.toContain('./src/');
  });

  it('registers settings, Salesforce tab, Agentforce side panels, guardrail, composer banner, and file opener', () => {
    const set = collectTestPluginApp(app, 'salesforce');
    expect(set.settingsSections).toMatchObject([
      { id: 'orgs', title: 'Connected orgs', component: expect.any(Function) }
    ]);
    expect(set.projectTabs.map((tab) => tab.id)).toEqual(['salesforce']);
    expect(set.projectTabs[0]).toMatchObject({ label: 'Salesforce', icon: 'Cloud', global: false });
    expect(set.threadPanelActions.map((row) => row.id)).toEqual(['sf-org', 'sf-soql', 'sf-object', 'sf-record', 'sf-logs', 'sf-deployments', 'sf-operations', 'playground', 'preview']);
    expect(set.threadPanelActions.find(row => row.id === 'playground')).toMatchObject({ title: 'Playground', layout: 'flush' });
    expect(set.threadPanelActions.find(row => row.id === 'preview')).toMatchObject({ title: 'Preview', layout: 'flush' });
    expect(set.newThreadPanelActions).toEqual([]);
    expect(set.navPanels).toMatchObject([
      { id: 'orgs', title: 'Salesforce', icon: 'Cloud', placement: 'unlisted' }
    ]);
    expect(set.sidebarFooterActions).toMatchObject([{ id: 'orgs', title: 'Salesforce', icon: 'Cloud' }]);
    const footerToPanel = vi.fn();
    set.sidebarFooterActions[0]?.run({ openSettings: vi.fn(), toPluginPanel: footerToPanel });
    expect(footerToPanel).toHaveBeenCalledWith('orgs');
    expect(set.projectMenuActions).toEqual([]);
    const paletteCtx = {
      threadId: null,
      projectId: 'proj-1',
      openPanel: vi.fn(),
      toPluginPanel: vi.fn(),
      toProject: vi.fn()
    };
    const openOrgs = set.commandPaletteActions.find((row) => row.id === 'open-orgs');
    openOrgs?.run(paletteCtx);
    expect(paletteCtx.toPluginPanel).toHaveBeenCalledWith('orgs');
    expect(set.pendingInteractions[0]?.id).toBe('salesforce-guardrail');
    expect(set.composerCustomizations[0]?.id).toBe('salesforce-banner');
    expect(set.fileOpeners[0]?.extensions).toEqual(['agent', 'afscript']);
    expect(set.fileOpeners[0]?.title).toBe('Agentforce Playground');
    expect(set.commandPaletteActions.filter(row => !row.id.startsWith('sf-')).map((row) => row.id)).toEqual([
      'open-orgs',
      'open-playground',
      'open-preview'
    ]);
    expect(set.createProjectActions[0]).toMatchObject({
      id: 'dx-project',
      title: 'Salesforce project',
      icon: 'Cloud'
    });
    expect(typeof set.createProjectActions[0]?.component).toBe('function');
    const openDialog = vi.fn();
    set.createProjectActions[0].run({ openDialog } as never);
    expect(openDialog).toHaveBeenCalledWith({ title: 'Create Salesforce project' });
  });

  it('packages the Agentforce playground under playground/dist', () => {
    const build = readFileSync(join(root, 'scripts/build-app.mjs'), 'utf8');
    expect(build).toContain('playground/vite.config.ts');
    const html = readFileSync(join(root, 'playground/dist/index.html'), 'utf8');
    expect(html).toContain('/plugins/salesforce/assets/playground/dist/');
    expect(existsSync(join(root, 'playground/dist/assets'))).toBe(true);
  });

  it('loads against the fake host and registers family tools plus zcc sf', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await plugin(zcc);
    expect(harness.cli?.name).toBe('sf');
    expect(harness.agentTools.map((tool) => tool.name).sort()).toEqual(['sf_agent', 'sf_apex', 'sf_lwc', 'sf_soql', 'sf_workbench']);
    expect(harness.needsConfiguration).toBeNull();
  });
});

describe('salesforce plugin behavior', () => {
  it('keeps local authoring available and reports org readiness in the owning project', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    const deps = mockDeps();
    let mode = 'empty';
    const exec = deps.execSf;
    deps.execSf = async (args, opts) => args[0] === 'org' && args[1] === 'list'
      ? mode === 'missing' ? { code: 127, stdout: '', stderr: '' }
      : mode === 'failed' ? { code: 1, stdout: '', stderr: 'PRIVATE_ERROR' }
      : mode === 'empty' ? { code: 0, stdout: '{"status":0,"result":{"sandboxes":[]}}', stderr: '' }
      : exec(args, opts)
      : exec(args, opts);
    await createSalesforcePlugin(zcc, deps);
    expect(harness.needsConfiguration).toBeNull();
    await expect(harness.callRpc('status', { projectId: 'p1' })).resolves.toMatchObject({ selectedAlias: null, orgs: [], orgsError: null });
    mode = 'missing';
    await expect(harness.callRpc('status', { projectId: 'p1' })).resolves.toMatchObject({ orgs: [], orgsError: expect.stringContaining('not found on PATH') });
    mode = 'failed';
    await expect(harness.callRpc('status', { projectId: 'p1' })).resolves.toMatchObject({ orgsError: 'Could not read Salesforce CLI connections. Check the CLI, then try again.' });
    mode = 'connected';
    await harness.callRpc('context.select', { projectId: 'p1', selectedAlias: 'dev' });
    await expect(harness.callRpc('status', { projectId: 'p1' })).resolves.toMatchObject({ targetSource: 'project', selectedAlias: 'dev', orgsError: null });
    expect(await zcc.storage.kv.get('sf:project:p1:org')).toBe('dev');
    expect(harness.needsConfiguration).toBeNull();
  });

  it('injects constitution only after an org is configured', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    expect(await harness.agentConfigurers[0]?.({})).toEqual({});
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const configured = await harness.agentConfigurers[0]?.({});
    expect(configured?.instructions).toContain(CONSTITUTION_INSTRUCTIONS);
    expect(configured?.instructions).toContain('Connected Salesforce CLI orgs');
    expect(configured?.instructions).toContain('dev');
    expect(configured?.tools).toEqual(['sf_soql', 'sf_apex', 'sf_lwc', 'sf_agent', 'sf_workbench']);
    expect(configured?.skills).toEqual(['salesforce-constitution', 'salesforce-dx']);
    harness.setSettings({ defaultOrg: '', projectRoot: '/proj' });
    expect((await harness.agentConfigurers[0]?.({}))?.instructions).toContain(CONSTITUTION_INSTRUCTIONS);
  });

  it('runs doctor and org CLI without leaking the access token', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const doctor = await harness.cli!.run(['doctor'], { pluginId: 'salesforce', argv: ['doctor'] });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain('dev');
    expect(doctor.stdout).toContain('Agentforce:');
    expect(JSON.stringify(doctor)).not.toContain('SECRET_TOKEN');
    const org = await harness.cli!.run(['org'], { pluginId: 'salesforce', argv: ['org'] });
    expect(org.stdout).toContain('sandbox');
    expect(org.stdout).toContain('Connected orgs:');
    expect(org.stdout).toContain('Target:');
    expect(org.stdout).not.toContain('SECRET_TOKEN');
  });

  it('provides SalesforceSdk on zcc.services without leaking accessToken', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const sf = zcc.services.use<SalesforceSdk>('salesforce');
    const org = await sf.connect();
    expect(org).not.toHaveProperty('accessToken');
    expect(JSON.stringify(org)).not.toContain('SECRET_TOKEN');
    const listed = await sf.listOrgs();
    expect(JSON.stringify(listed)).not.toContain('SECRET_TOKEN');
    const { org: fromRequest } = await sf.request('/query', { method: 'GET' });
    expect(fromRequest).not.toHaveProperty('accessToken');
    const doctor = await sf.doctor();
    expect(JSON.stringify(doctor)).not.toContain('SECRET_TOKEN');
  });

  it('generates a DX project via sf project generate', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, {
      ...mockDeps(),
      execSf: async (args) => {
        if (args[0] === 'project' && args[1] === 'generate') {
          expect(args).toEqual(['project', 'generate', '--name', 'Acme', '--output-dir', '/tmp/ws', '--json']);
          return {
            code: 0,
            stdout: JSON.stringify({ status: 0, result: { outputDir: '/tmp/ws/Acme' } }),
            stderr: ''
          };
        }
        return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
      }
    });
    await expect(harness.callRpc('project.generate', { name: 'Acme', outputDir: '/tmp/ws' })).resolves.toEqual({
      ok: true,
      name: 'Acme',
      path: '/tmp/ws/Acme'
    });
    await expect(harness.callRpc('project.generate', { name: 'foo/bar', outputDir: '/tmp/ws' })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_input'
    });
  });

  it('connects only a registered project and persists its target after CLI configuration succeeds', async () => {
    const setProjectIcon = vi.fn();
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', setProjectIcon, listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    const deps = mockDeps();
    const original = deps.execSf;
    const configure = vi.fn<SalesforceDeps['execSf']>(async () => ({ code: 0, stdout: '{"status":0}', stderr: '' }));
    deps.execSf = (args, options) => args[0] === 'config' ? configure(args, options) : original(args, options);
    await createSalesforcePlugin(zcc, deps);
    await expect(harness.callRpc('project.connect', { projectId: 'missing', selectedAlias: 'dev' })).resolves.toMatchObject({ ok: false });
    await expect(harness.callRpc('project.connect', { selectedAlias: 'dev' })).resolves.toMatchObject({ ok: false });
    expect(configure).not.toHaveBeenCalled();
    await expect(harness.callRpc('project.connect', { projectId: 'p1', projectRoot: '/untrusted', selectedAlias: 'dev' })).resolves.toEqual({ ok: true });
    expect(configure).toHaveBeenCalledWith(['config', 'set', 'target-org=dev', '--json'], { cwd: '/tmp/dx', timeoutMs: 30_000 });
    expect(await zcc.storage.kv.get('sf:project:p1:org')).toBe('dev');
    expect(setProjectIcon).toHaveBeenCalledWith({ projectId: 'p1', icon: 'Cloud' });
    await zcc.storage.kv.set('sf:project:p1:org', 'previous');
    configure.mockResolvedValue({ code: 1, stdout: '', stderr: 'denied' });
    await expect(harness.callRpc('project.connect', { projectId: 'p1', selectedAlias: 'dev' })).resolves.toMatchObject({ ok: false });
    expect(await zcc.storage.kv.get('sf:project:p1:org')).toBe('previous');
  });

  it('starts Salesforce CLI web login and refreshes the org roster', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    const seen: string[][] = [];
    await createSalesforcePlugin(zcc, {
      ...mockDeps(),
      execSf: async (args, opts) => {
        seen.push(args);
        if (args[0] === 'org' && args[1] === 'login') {
          expect(opts?.timeoutMs).toBeGreaterThan(30_000);
          expect(args).toEqual([
            'org',
            'login',
            'web',
            '--json',
            '--instance-url',
            'https://test.salesforce.com',
            '--alias',
            'qa'
          ]);
          return { code: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'org' && args[1] === 'list') {
          return {
            code: 0,
            stdout: JSON.stringify({
              result: { sandboxes: [{ alias: 'qa', username: 'qa@example.com', isSandbox: true }] }
            }),
            stderr: ''
          };
        }
        return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
      }
    });
    await expect(harness.callRpc('orgs.login', { instance: 'sandbox', alias: 'qa' })).resolves.toMatchObject({
      ok: true,
      selectedAlias: null,
      connectedAlias: null,
      warning: 'Signed in. Refresh the list and select the org to use.',
      orgs: [expect.objectContaining({ alias: 'qa' })]
    });
    expect(seen.some((args) => args[0] === 'org' && args[1] === 'login')).toBe(true);
    await expect(harness.callRpc('orgs.login', { instance: 'other' })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_input'
    });
  });

  it('surfaces a missing Salesforce CLI when connecting an org', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, {
      ...mockDeps(),
      execSf: async (args) => {
        if (args[0] === 'org' && args[1] === 'login') return { code: 127, stdout: '', stderr: 'sf: not found' };
        return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
      }
    });
    await expect(harness.callRpc('orgs.login', { instance: 'production' })).resolves.toMatchObject({
      ok: false,
      code: 'cli_missing'
    });
  });

  it('pins browser login to its registered project and leaves shared and other project targets alone', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/tmp/dx' }] });
    const base = mockDeps();
    await createSalesforcePlugin(zcc, { ...base, execSf: async (args, opts) => {
      if (args[1] === 'login') {
        expect(opts?.cwd).toBe('/tmp/dx');
        return { code: 0, stdout: JSON.stringify({ result: { username: 'dev@example.com', accessToken: 'SECRET_TOKEN' } }), stderr: '' };
      }
      return base.execSf(args, opts);
    } });
    harness.setSettings({ defaultOrg: 'shared' });
    await zcc.storage.kv.set('sf:project:p2:org', 'other');
    const response = await harness.callRpc('orgs.login', { projectId: 'p1' });
    expect(response).toMatchObject({ ok: true, selectedAlias: 'dev', connectedAlias: 'dev', targetSource: 'project' });
    expect(JSON.stringify(response)).not.toContain('SECRET_TOKEN');
    expect(await zcc.storage.kv.get('sf:project:p1:org')).toBe('dev');
    expect(await zcc.storage.kv.get('sf:project:p2:org')).toBe('other');
    expect(await harness.callRpc('status', {})).toMatchObject({ selectedAlias: 'shared' });
    expect(await harness.callRpc('orgs.login', { projectId: 'unregistered' })).toMatchObject({ ok: false, code: 'invalid_context' });
  });

  it('surfaces a failed Salesforce CLI web login', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, {
      ...mockDeps(),
      execSf: async (args) => {
        if (args[0] === 'org' && args[1] === 'login') return { code: 1, stdout: '', stderr: 'login cancelled' };
        return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
      }
    });
    await expect(harness.callRpc('orgs.login', {})).resolves.toMatchObject({
      ok: false,
      code: 'login_failed'
    });
  });

  it('starts browser auth without holding RPC open, confines status to the project, and bounds retained results', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => ['p1', 'p2'].map(id => ({ id, name: id, path: `/tmp/${id}` })) });
    const base = mockDeps();
    let finish!: () => void;
    let pause = true;
    await createSalesforcePlugin(zcc, { ...base, execSf: async (args, opts) => {
      if (args[1] === 'login') {
        if (pause) await new Promise<void>(resolve => { finish = resolve; });
        return { code: 0, stdout: JSON.stringify({ result: { username: 'dev@example.com', refreshToken: 'SECRET_TOKEN' } }), stderr: '' };
      }
      return base.execSf(args, opts);
    } });
    harness.setSettings({ defaultOrg: 'dev' });
    const started = await harness.callRpc('orgs.login.start', { projectId: 'p1' }) as { ok: boolean; loginId: string };
    expect(started).toMatchObject({ ok: true, loginId: expect.any(String) });
    expect(await harness.callRpc('orgs.login.status', { projectId: 'p1', loginId: started.loginId })).toEqual({ ok: true, done: false });
    expect(await harness.callRpc('orgs.login.status', { projectId: 'p2', loginId: started.loginId })).toMatchObject({ ok: false });
    expect(await harness.callRpc('orgs.login.start', { projectId: 'p2' })).toMatchObject({ code: 'login_busy' });
    expect(await harness.callRpc('orgs.login.start', { projectId: 'p1', instance: 'invalid' })).toMatchObject({ code: 'invalid_input' });
    pause = false;
    finish();
    await vi.waitFor(async () => {
      const status = await harness.callRpc('orgs.login.status', { projectId: 'p1', loginId: started.loginId });
      expect(status).toMatchObject({ done: true, result: { ok: true, selectedAlias: 'dev', targetSource: 'project' } });
      expect(JSON.stringify(status)).not.toContain('SECRET_TOKEN');
    });
    for (let i = 0; i < 12; i++) {
      const next = await harness.callRpc('orgs.login.start', { projectId: 'p1' }) as { loginId: string };
      await vi.waitFor(async () => expect(await harness.callRpc('orgs.login.status', { projectId: 'p1', loginId: next.loginId })).toMatchObject({ done: true }));
    }
    expect(await harness.callRpc('orgs.login.status', { projectId: 'p1', loginId: started.loginId })).toMatchObject({ ok: false });
  });

  it('surfaces a missing Salesforce CLI when generating a project', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, {
      ...mockDeps(),
      execSf: async () => ({ code: 127, stdout: '', stderr: 'sf: not found' })
    });
    await expect(harness.callRpc('project.generate', { name: 'Acme', outputDir: '/tmp/ws' })).resolves.toMatchObject({
      ok: false,
      code: 'cli_missing'
    });
  });

  it('returns generate_failed when sf project generate exits nonzero', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, {
      ...mockDeps(),
      execSf: async () => ({
        code: 1,
        stdout: JSON.stringify({ status: 1, message: 'Directory already exists' }),
        stderr: ''
      })
    });
    await expect(harness.callRpc('project.generate', { name: 'Acme', outputDir: '/tmp/ws' })).resolves.toMatchObject({
      ok: false,
      code: 'generate_failed',
      error: 'Directory already exists'
    });
  });

  it('runs bounded sandbox SOQL without a confirmation prompt', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, mockDeps('sandbox'));
    harness.setSettings({ defaultOrg: 'dev' });
    const tool = harness.agentTools.find((row) => row.name === 'sf_soql');
    const result = await tool!.execute(
      { action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 5' },
      { threadId: 'thr-1', projectId: 'p1', signal: AbortSignal.abort() }
    );
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
  });

  it('fails closed for anonymous Apex when the operator cancels', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, mockDeps('sandbox'));
    harness.setSettings({ defaultOrg: 'dev' });
    const tool = harness.agentTools.find((row) => row.name === 'sf_apex');
    const pending = tool!.execute(
      { action: 'anon.run', body: 'System.debug(1);', allow_mutation: true },
      { threadId: 'thr-1', projectId: 'p1', signal: AbortSignal.abort() }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.cancelInteraction();
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'refused' });
  });

  it('runs anonymous Apex after an explicit approval and ignores allow_mutation as approval', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(
      zcc,
      mockDeps('sandbox', () => ({ status: 200, json: { compiled: true, success: true }, text: '{}' }))
    );
    harness.setSettings({ defaultOrg: 'dev' });
    const tool = harness.agentTools.find((row) => row.name === 'sf_apex');
    const pending = tool!.execute(
      { action: 'anon.run', body: 'System.debug(1);', allow_mutation: true },
      { threadId: 'thr-1', projectId: 'p1', signal: AbortSignal.abort() }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.submitInteraction({ approved: true });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it('fails closed without a thread id', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX project', path: '/tmp/dx' }] });
    await createSalesforcePlugin(zcc, mockDeps('production'));
    harness.setSettings({ defaultOrg: 'dev' });
    const tool = harness.agentTools.find((row) => row.name === 'sf_soql');
    await expect(
      tool!.execute(
        { action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 5' },
        { threadId: '', projectId: 'p1', signal: AbortSignal.abort() }
      )
    ).resolves.toMatchObject({ ok: false, code: 'refused' });
  });
});
