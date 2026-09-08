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
    expect(set.projectTabs.map((tab) => tab.id)).toEqual(['salesforce', 'soql']);
    expect(set.projectTabs[1]).toMatchObject({ label: 'SOQL', icon: 'Database', global: false });
    expect(set.threadPanelActions.map((row) => row.id)).toEqual(['playground', 'preview']);
    expect(set.threadPanelActions[0]).toMatchObject({ title: 'Playground', layout: 'flush' });
    expect(set.threadPanelActions[1]).toMatchObject({ title: 'Preview', layout: 'flush' });
    expect(set.newThreadPanelActions).toEqual([]);
    expect(set.navPanels).toMatchObject([
      { id: 'orgs', title: 'Salesforce', icon: 'Cloud', placement: 'unlisted' }
    ]);
    expect(set.sidebarFooterActions).toMatchObject([{ id: 'orgs', title: 'Salesforce', icon: 'Cloud' }]);
    const footerToPanel = vi.fn();
    set.sidebarFooterActions[0]?.run({ openSettings: vi.fn(), toPluginPanel: footerToPanel });
    expect(footerToPanel).toHaveBeenCalledWith('orgs');
    expect(set.projectMenuActions[0]).toMatchObject({
      id: 'open-soql',
      title: 'SOQL',
      icon: 'Database',
      placement: 'project'
    });
    const toProject = vi.fn();
    set.projectMenuActions[0]?.run({ projectId: 'proj-1', toProject });
    expect(toProject).toHaveBeenCalledWith('proj-1', { tabId: 'soql' });
    const palette = set.commandPaletteActions.find((row) => row.id === 'open-soql');
    const paletteCtx = {
      threadId: null,
      projectId: 'proj-1',
      openPanel: vi.fn(),
      toPluginPanel: vi.fn(),
      toProject: vi.fn()
    };
    expect(palette?.isAvailable?.({ ...paletteCtx, projectId: null })).toBe(false);
    expect(palette?.isAvailable?.(paletteCtx)).toBe(true);
    palette?.run(paletteCtx);
    expect(paletteCtx.toProject).toHaveBeenCalledWith('proj-1', { tabId: 'soql' });
    const openOrgs = set.commandPaletteActions.find((row) => row.id === 'open-orgs');
    openOrgs?.run(paletteCtx);
    expect(paletteCtx.toPluginPanel).toHaveBeenCalledWith('orgs');
    expect(set.pendingInteractions[0]?.id).toBe('salesforce-guardrail');
    expect(set.composerCustomizations[0]?.id).toBe('salesforce-banner');
    expect(set.fileOpeners[0]?.extensions).toEqual(['agent', 'afscript']);
    expect(set.fileOpeners[0]?.title).toBe('Agentforce Playground');
    expect(set.commandPaletteActions.map((row) => row.id)).toEqual([
      'open-orgs',
      'open-playground',
      'open-preview',
      'open-soql'
    ]);
    expect(set.createProjectActions[0]).toMatchObject({
      id: 'dx-project',
      title: 'Salesforce DX project',
      icon: 'Cloud'
    });
    expect(typeof set.createProjectActions[0]?.component).toBe('function');
    const appSource = readFileSync(join(root, 'app.tsx'), 'utf8');
    expect(appSource).toContain("className: 'modal-hint'");
    expect(appSource).toContain("className: 'remote-form-row local-path-row'");
    expect(appSource).toContain("className: 'local-path-input-group'");
    expect(appSource).toContain("className: 'plugin-create-project-actions'");
    expect(appSource).toContain("className: 'btn primary'");
  });

  it('packages the Agentforce playground under playground/dist', () => {
    const build = readFileSync(join(root, 'scripts/build-app.mjs'), 'utf8');
    expect(build).toContain('playground/vite.config.ts');
    const html = readFileSync(join(root, 'playground/dist/index.html'), 'utf8');
    expect(html).toContain('/plugins/salesforce/assets/playground/dist/');
    expect(existsSync(join(root, 'playground/dist/assets'))).toBe(true);
  });

  it('loads against the fake host and registers family tools plus zcc sf', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await plugin(zcc);
    expect(harness.cli?.name).toBe('sf');
    expect(harness.agentTools.map((tool) => tool.name).sort()).toEqual(['sf_agent', 'sf_apex', 'sf_lwc', 'sf_soql']);
    expect(harness.needsConfiguration).toMatch(/default org/i);
  });
});

describe('salesforce plugin behavior', () => {
  it('injects constitution only after an org is configured', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps());
    expect(await harness.agentConfigurers[0]?.({})).toEqual({});
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const configured = await harness.agentConfigurers[0]?.({});
    expect(configured?.instructions).toContain(CONSTITUTION_INSTRUCTIONS);
    expect(configured?.instructions).toContain('Connected Salesforce CLI orgs');
    expect(configured?.instructions).toContain('dev');
    expect(configured?.tools).toEqual(['sf_soql', 'sf_apex', 'sf_lwc', 'sf_agent']);
    expect(configured?.skills).toEqual(['salesforce-constitution', 'salesforce-dx']);
    harness.setSettings({ defaultOrg: '', projectRoot: '/proj' });
    expect((await harness.agentConfigurers[0]?.({}))?.instructions).toContain(CONSTITUTION_INSTRUCTIONS);
  });

  it('runs doctor and org CLI without leaking the access token', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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

  it('starts Salesforce CLI web login and refreshes the org roster', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
      selectedAlias: 'qa',
      orgs: [expect.objectContaining({ alias: 'qa' })]
    });
    expect(seen.some((args) => args[0] === 'org' && args[1] === 'login')).toBe(true);
    await expect(harness.callRpc('orgs.login', { instance: 'other' })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_input'
    });
  });

  it('surfaces a missing Salesforce CLI when connecting an org', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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

  it('surfaces a failed Salesforce CLI web login', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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

  it('surfaces a missing Salesforce CLI when generating a project', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
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
