import { describe, expect, it } from 'vitest';
import { doctorFailure, formatDoctor, runDoctor } from '../lib/doctor.js';
import { ConnectionError } from '../lib/connection.js';
import type { DoctorReport, SalesforceDeps } from '../lib/types.js';

function agentFields(
  overrides?: Partial<Pick<DoctorReport, 'agentCompiler' | 'agentPluginOk' | 'agentEvalOk' | 'agentBundleCount'>>
): Pick<DoctorReport, 'agentCompiler' | 'agentPluginOk' | 'agentEvalOk' | 'agentBundleCount'> {
  return { agentCompiler: 'missing', agentPluginOk: false, agentEvalOk: false, agentBundleCount: 0, ...overrides };
}

function deps(exec: SalesforceDeps['execSf']): SalesforceDeps {
  return {
    execSf: exec,
    request: async () => ({ status: 500, json: null, text: '' }),
    now: () => 42,
    exists: (path) => path.endsWith('sfdx-project.json'),
    stat: () => 'missing',
    readFile: () => null,
    readdir: () => [],
    realpath: (path) => path,
    spawnContained: async () => ({ code: 1, stdout: '', stderr: '' })
  };
}

describe('doctor', () => {
  it('reports a missing CLI without probing Salesforce APIs', async () => {
    const report = await runDoctor(deps(async () => ({ code: 127, stdout: '', stderr: '' })), {
      defaultOrg: 'dev',
      apiVersion: '62.0',
      projectRoot: '/proj'
    });
    expect(report.cliOk).toBe(false);
    expect(report.cliError).toMatch(/not found/);
    expect(report.dxProject).toBe(true);
    expect(formatDoctor(report)).toContain('CLI:');
  });

  it('reports a non-zero CLI version as a doctor error', async () => {
    const report = await runDoctor(deps(async () => ({ code: 1, stdout: '', stderr: 'sf exploded' })), {
      defaultOrg: '',
      apiVersion: '62.0',
      projectRoot: ''
    });
    expect(report.cliOk).toBe(false);
    expect(report.cliError).toContain('sf exploded');
  });

  it('uses stdout when version stderr is empty', async () => {
    const report = await runDoctor(deps(async () => ({ code: 2, stdout: 'no binary output', stderr: '' })), {
      defaultOrg: '',
      apiVersion: '62.0',
      projectRoot: ''
    });
    expect(report.cliError).toContain('no binary output');
    expect(formatDoctor({
      cliOk: false,
      cliVersion: null,
      cliError: null,
      defaultOrg: null,
      org: null,
      aliases: [],
      dxProject: false,
      projectRoot: null,
      ...agentFields(),
      at: 1
    })).toContain('missing');
  });

  it('lists aliases and redacts tokens from stdout', async () => {
    const report = await runDoctor(
      deps(async (args) => {
        if (args[0] === '--version') {
          return { code: 0, stdout: '@salesforce/cli/2.0.0\n', stderr: '' };
        }
        if (args[0] === 'org' && args[1] === 'list') {
          return {
            code: 0,
            stdout: JSON.stringify({
              result: {
                sandboxes: [{ alias: 'dev', username: 'dev@example.com', isSandbox: true, isDefaultUsername: true }]
              }
            }),
            stderr: ''
          };
        }
        if (args.includes('display')) {
          return {
            code: 0,
            stdout: JSON.stringify({
              result: {
                alias: 'dev',
                username: 'dev@example.com',
                orgId: '00Dxx',
                instanceUrl: 'https://foo--dev.sandbox.my.salesforce.com',
                accessToken: 'SECRET',
                isSandbox: true
              }
            }),
            stderr: ''
          };
        }
        if (args[0] === 'agent') {
          return { code: 0, stdout: 'validate preview publish activate\n', stderr: '' };
        }
        return { code: 1, stdout: '', stderr: 'unexpected' };
      }),
      { defaultOrg: 'dev', apiVersion: '62.0', projectRoot: '/proj' }
    );
    expect(report.cliOk).toBe(true);
    expect(report.org?.kind).toBe('sandbox');
    expect(report.agentCompiler).toBe('cli');
    expect(report.agentPluginOk).toBe(true);
    expect(formatDoctor(report)).toContain('Agent Script:');
    expect(formatDoctor(report)).toContain('run-eval ok');
    expect(formatDoctor(report)).toContain('Agent CLI cwd:');
    expect(formatDoctor(report)).toContain('Publish/activate:');
    expect(formatDoctor(report)).not.toContain('SECRET');
    expect(JSON.stringify(report)).not.toContain('SECRET');
  });

  it('notes a failed org display without treating the CLI as missing', async () => {
    const report = await runDoctor(
      deps(async (args) => {
        if (args[0] === '--version') return { code: 0, stdout: '@salesforce/cli/2.0.0\n', stderr: '' };
        if (args[0] === 'org' && args[1] === 'list') {
          return { code: 0, stdout: JSON.stringify({ result: [] }), stderr: '' };
        }
        return { code: 1, stdout: '', stderr: 'alias missing' };
      }),
      { defaultOrg: 'dev', apiVersion: '62.0', projectRoot: '' }
    );
    expect(report.cliOk).toBe(true);
    expect(report.cliError).toContain('alias missing');
    expect(formatDoctor(report)).toContain('Note:');
  });

  it('formats reports without an org and with a fallback CLI version', () => {
    const text = formatDoctor({
      cliOk: true,
      cliVersion: null,
      cliError: null,
      defaultOrg: null,
      org: {
        alias: 'dev',
        username: 'dev@example.com',
        orgId: '',
        instanceUrl: 'https://example.my.salesforce.com',
        apiVersion: '62.0',
        kind: 'sandbox',
        isDefault: false
      },
      aliases: [{ alias: 'other', username: 'o@x.com', kind: 'scratch', isDefault: false }],
      dxProject: true,
      projectRoot: null,
      ...agentFields({ agentCompiler: 'cli', agentPluginOk: true, agentBundleCount: 2 }),
      at: 1
    });
    expect(text).toContain('CLI: ok');
    expect(text).toContain('DX project: yes');
    expect(text).toContain('(none)');
    expect(text).toContain('(unknown)');
    expect(text).toContain('other');
    expect(text).toContain('2 .agent');
    expect(text).toContain('run-eval missing');
    expect(text).toContain('Agent CLI cwd:');
  });

  it('maps connection errors for callers', () => {
    expect(doctorFailure(new Error('boom'))).toMatchObject({ ok: false, code: 'doctor_failed' });
    expect(doctorFailure('stringy')).toMatchObject({ ok: false, error: 'stringy' });
    expect(doctorFailure(new ConnectionError('nope', 'no_org'))).toMatchObject({ ok: false, code: 'no_org' });
  });

  it('counts confined .agent bundles when the DX project is present', async () => {
    const files: Record<string, string> = {
      '/proj/sfdx-project.json': '{"packageDirectories":[{"path":"force-app"}]}',
      '/proj/force-app/MyBot.agent': 'config {}\nstart_agent {}\n'
    };
    const dirs: Record<string, string[]> = {
      '/proj': ['sfdx-project.json', 'force-app'],
      '/proj/force-app': ['MyBot.agent']
    };
    const report = await runDoctor(
      {
        ...deps(async (args) => {
          if (args[0] === '--version') return { code: 0, stdout: '@salesforce/cli/2.0.0\n', stderr: '' };
          if (args[0] === 'org' && args[1] === 'list') {
            return { code: 0, stdout: JSON.stringify({ result: [] }), stderr: '' };
          }
          if (args[0] === 'agent') return { code: 0, stdout: 'validate preview publish activate\n', stderr: '' };
          return { code: 1, stdout: '', stderr: 'unexpected' };
        }),
        exists: (path) => path in files || path in dirs,
        stat: (path) => (path in dirs ? 'dir' : path in files ? 'file' : 'missing'),
        readFile: (path) => files[path] ?? null,
        readdir: (path) => dirs[path] ?? []
      },
      { defaultOrg: '', apiVersion: '62.0', projectRoot: '/proj' }
    );
    expect(report.agentBundleCount).toBe(1);
    expect(report.agentCompiler).toBe('cli');
    expect(formatDoctor(report)).toContain('1 .agent');
  });
});
