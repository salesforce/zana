import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import { discoverPluginSkillNames } from '@zana-ai/zcc-server/plugins/plugin-skills';
import plugin from '../server.ts';
import app from '../app.js';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { CONSTITUTION_INSTRUCTIONS } from '../lib/constitution.js';
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
    spawnContained: async () => ({ code: 0, stdout: 'ok', stderr: '' })
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
    const server = readFileSync(join(root, 'server.ts'), 'utf8');
    expect(server).toContain('./lib/plugin.js');
    expect(server).not.toContain('./src/');
  });

  it('registers settings, project tab, guardrail, and composer banner', () => {
    const set = collectTestPluginApp(app, 'salesforce');
    expect(set.settingsSections[0]?.id).toBe('salesforce');
    expect(set.projectTabs[0]?.label).toBe('Salesforce');
    expect(set.pendingInteractions[0]?.id).toBe('salesforce-guardrail');
    expect(set.composerCustomizations[0]?.id).toBe('salesforce-banner');
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
    expect(configured?.instructions).toBe(CONSTITUTION_INSTRUCTIONS);
    expect(configured?.tools).toEqual(['sf_soql', 'sf_apex', 'sf_lwc', 'sf_agent']);
    expect(configured?.skills).toEqual(['salesforce-constitution', 'salesforce-dx']);
    harness.setSettings({ defaultOrg: '', projectRoot: '/proj' });
    expect((await harness.agentConfigurers[0]?.({}))?.instructions).toBe(CONSTITUTION_INSTRUCTIONS);
  });

  it('runs doctor and org CLI without leaking the access token', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
    const doctor = await harness.cli!.run(['doctor'], { pluginId: 'salesforce', argv: ['doctor'] });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain('dev');
    expect(doctor.stdout).toContain('Agent Script:');
    expect(JSON.stringify(doctor)).not.toContain('SECRET_TOKEN');
    const org = await harness.cli!.run(['org'], { pluginId: 'salesforce', argv: ['org'] });
    expect(org.stdout).toContain('sandbox');
    expect(org.stdout).not.toContain('SECRET_TOKEN');
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
