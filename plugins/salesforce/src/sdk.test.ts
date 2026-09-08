import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '../lib/connection.js';
import { Guardrail } from '../lib/guardrail.js';
import { createSalesforceSdk, assertPublicOrg, parseApiError, QueryMoreError } from '../lib/sdk.js';
import type { SalesforceDeps, SalesforceRequest } from '../lib/types.js';

function displayJson(alias = 'dev') {
  return JSON.stringify({
    result: {
      alias,
      username: `${alias}@example.com`,
      orgId: '00Dxx0000000001',
      instanceUrl: 'https://foo--dev.sandbox.my.salesforce.com',
      accessToken: 'SECRET_TOKEN',
      apiVersion: '62.0',
      isSandbox: true,
      isScratchOrg: false
    }
  });
}

function deps(rest?: (req: SalesforceRequest) => { status: number; json: unknown; text: string }): SalesforceDeps {
  return {
    execSf: async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: '@salesforce/cli/2.0.0\n', stderr: '' };
      if (args[0] === 'org' && args[1] === 'list') {
        return {
          code: 0,
          stdout: JSON.stringify({
            result: {
              sandboxes: [
                {
                  alias: 'dev',
                  username: 'dev@example.com',
                  isSandbox: true,
                  isDefaultUsername: true,
                  instanceUrl: 'https://foo--dev.sandbox.my.salesforce.com'
                }
              ]
            }
          }),
          stderr: ''
        };
      }
      if (args.includes('display')) {
        const idx = args.indexOf('--target-org');
        const alias = idx >= 0 ? args[idx + 1] : 'dev';
        return { code: 0, stdout: displayJson(alias), stderr: '' };
      }
      return { code: 0, stdout: args.join(' '), stderr: '' };
    },
    request: async (_org, req) =>
      rest?.(req) ?? { status: 200, json: { totalSize: 0, records: [] }, text: '{}' },
    now: () => 1,
    exists: () => false,
    stat: () => 'missing',
    readFile: () => null,
    readdir: () => [],
    realpath: (path) => path,
    spawnContained: async () => ({ code: 0, stdout: '', stderr: '' }),
    writeFile: () => {
      throw new Error('writeFile not stubbed');
    }
  };
}

describe('SalesforceSdk', () => {
  beforeEach(() => {
    vi.stubEnv('SF_TARGET_ORG', '');
    vi.stubEnv('SFDX_DEFAULTUSERNAME', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeSdk(rest?: (req: SalesforceRequest) => { status: number; json: unknown; text: string }) {
    const nodeDeps = deps(rest);
    const connections = new ConnectionManager(nodeDeps, async () => ({
      defaultOrg: 'dev',
      apiVersion: '62.0'
    }));
    const guardrail = new Guardrail(async () => ({ approved: false, reason: 'denied' }));
    return createSalesforceSdk({
      connections,
      guardrail,
      deps: nodeDeps,
      readSettings: async () => ({
        defaultOrg: 'dev',
        apiVersion: '62.0',
        projectRoot: '',
        agentScriptDialect: 'agentforce'
      })
    });
  }

  it('re-exports parseApiError and QueryMoreError from the host factory module', () => {
    expect(typeof parseApiError).toBe('function');
    expect(parseApiError(400, [{ message: 'bad at row 1, column 2' }], '')).toMatchObject({
      line: 1,
      column: 2
    });
    expect(new QueryMoreError('x', 'host_mismatch')).toMatchObject({ code: 'host_mismatch' });
  });

  it('never returns accessToken from connect or request', async () => {
    const { sdk } = makeSdk();
    const org = await sdk.connect();
    expect(org).not.toHaveProperty('accessToken');
    expect(() => assertPublicOrg(org)).not.toThrow();
    expect(JSON.stringify(org)).not.toContain('SECRET_TOKEN');
    const listed = await sdk.listOrgs();
    expect(JSON.stringify(listed)).not.toContain('SECRET_TOKEN');
    const { org: fromRequest, response } = await sdk.request('/query', { method: 'GET' });
    expect(fromRequest).not.toHaveProperty('accessToken');
    expect(JSON.stringify(fromRequest)).not.toContain('SECRET_TOKEN');
    expect(response.status).toBe(200);
  });

  it('retries request after 401 without exposing the token', async () => {
    let calls = 0;
    const { sdk } = makeSdk(() => {
      calls += 1;
      if (calls === 1) return { status: 401, json: { error: 'unauthorized' }, text: 'unauthorized' };
      return { status: 200, json: { ok: true }, text: '{}' };
    });
    const { org, response } = await sdk.request('/sobjects', { method: 'GET' });
    expect(calls).toBe(2);
    expect(response.status).toBe(200);
    expect(org).not.toHaveProperty('accessToken');
  });

  it('fail-closes confirm when the operator denies', async () => {
    const { sdk } = makeSdk();
    const org = await sdk.connect();
    await expect(
      sdk.confirm(
        {
          orgAlias: org.alias,
          orgId: org.orgId,
          orgKind: org.kind,
          kind: 'apex.anonymous',
          summary: 'write'
        },
        'thr-1'
      )
    ).resolves.toEqual({ approved: false, reason: 'denied' });
  });

  it('execSf is the CLI escape hatch', async () => {
    const { sdk } = makeSdk();
    await expect(sdk.execSf(['org', 'list', '--json'])).resolves.toMatchObject({ code: 0 });
  });

  it('assertPublicOrg rejects a leaked accessToken', () => {
    expect(() => assertPublicOrg({ accessToken: 'SECRET_TOKEN' } as never)).toThrow(/accessToken/);
  });

  it('onOrgChange passes a public org view until unsubscribed', async () => {
    const { sdk, emitOrgChange } = makeSdk();
    const seen: Array<unknown> = [];
    const stop = sdk.onOrgChange((org) => {
      seen.push(org);
    });
    emitOrgChange();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ alias: 'dev' });
    expect(JSON.stringify(seen[0])).not.toContain('SECRET_TOKEN');
    expect(seen[0]).not.toHaveProperty('accessToken');
    stop();
    emitOrgChange();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toHaveLength(1);
  });

  it('targets a request alias instead of the default org', async () => {
    const seen: string[] = [];
    const { sdk } = makeSdk((req) => {
      seen.push(req.path);
      return { status: 200, json: { ok: true }, text: '{}' };
    });
    const { org } = await sdk.request('/sobjects/Account/001', { method: 'GET', alias: 'prod' });
    expect(org.alias).toBe('prod');
    expect(org).not.toHaveProperty('accessToken');
    expect(seen).toEqual(['/sobjects/Account/001']);
  });

  it('queries, paginates, describes, and reads limits without leaking tokens', async () => {
    const seen: Array<{ path: string; q?: string }> = [];
    const { sdk } = makeSdk((req) => {
      seen.push({ path: req.path, q: req.query?.q });
      if (req.path === '/query' || req.path === '/queryAll' || req.path === '/tooling/query') {
        return {
          status: 200,
          json: {
            totalSize: 2,
            done: false,
            nextRecordsUrl: '/services/data/v62.0/query/01gxx-2000',
            records: [{ Id: '001' }]
          },
          text: '{}'
        };
      }
      if (req.path === '/query/01gxx-2000') {
        return { status: 200, json: { totalSize: 2, done: true, records: [{ Id: '002' }] }, text: '{}' };
      }
      if (req.path === '/sobjects' || req.path === '/tooling/sobjects') {
        return { status: 200, json: { sobjects: [{ name: 'Account' }] }, text: '{}' };
      }
      if (req.path.includes('/describe')) {
        return { status: 200, json: { name: 'Account', fields: [] }, text: '{}' };
      }
      if (req.path === '/limits') {
        return { status: 200, json: { DailyApiRequests: { Max: 15_000, Remaining: 14_900 } }, text: '{}' };
      }
      return { status: 404, json: [{ message: 'missing' }], text: '' };
    });

    const queried = await sdk.query('SELECT Id FROM Account', { alias: 'prod' });
    expect(queried.org.alias).toBe('prod');
    expect(queried.org).not.toHaveProperty('accessToken');
    expect(JSON.stringify(queried.org)).not.toContain('SECRET_TOKEN');
    expect(queried.records).toEqual([{ Id: '001' }]);
    expect(queried.nextRecordsUrl).toBe('/services/data/v62.0/query/01gxx-2000');
    expect(seen.some((row) => row.path === '/query' && row.q === 'SELECT Id FROM Account')).toBe(true);

    const tooling = await sdk.query('SELECT Id FROM ApexClass', { tooling: true });
    expect(seen.some((row) => row.path === '/tooling/query')).toBe(true);
    expect(tooling.org).not.toHaveProperty('accessToken');

    const allRows = await sdk.query('SELECT Id FROM Account', { allRows: true });
    expect(seen.some((row) => row.path === '/queryAll')).toBe(true);
    expect(allRows.done).toBe(false);

    await expect(
      sdk.queryMore('https://evil.example/services/data/v62.0/query/01gxx-2000')
    ).rejects.toMatchObject({ code: 'host_mismatch' });

    const more = await sdk.queryMore('/services/data/v62.0/query/01gxx-2000');
    expect(more.records).toEqual([{ Id: '002' }]);
    expect(more.org).not.toHaveProperty('accessToken');

    const global = await sdk.describeGlobal();
    expect(global.sobjects).toEqual([{ name: 'Account' }]);
    expect(global.org).not.toHaveProperty('accessToken');

    const toolingGlobal = await sdk.describeGlobal({ tooling: true });
    expect(seen.some((row) => row.path === '/tooling/sobjects')).toBe(true);
    expect(toolingGlobal.org).not.toHaveProperty('accessToken');

    const described = await sdk.describeSObject('Account');
    expect(described.describe).toMatchObject({ name: 'Account' });
    expect(described.org).not.toHaveProperty('accessToken');

    const toolingDescribed = await sdk.describeSObject('ApexClass', { tooling: true });
    expect(seen.some((row) => row.path === '/tooling/sobjects/ApexClass/describe')).toBe(true);
    expect(toolingDescribed.org).not.toHaveProperty('accessToken');

    const limits = await sdk.limits();
    expect(limits.dailyApiRequests).toEqual({ max: 15_000, remaining: 14_900 });
    expect(limits.org).not.toHaveProperty('accessToken');
  });

  it('returns empty describe catalogs and null limits when payloads are empty', async () => {
    const { sdk } = makeSdk(() => ({ status: 200, json: {}, text: '{}' }));
    const global = await sdk.describeGlobal();
    expect(global.sobjects).toEqual([]);
    const limits = await sdk.limits();
    expect(limits.dailyApiRequests).toBeNull();
  });

  it('resolveAlias uses the selected org', async () => {
    const { sdk } = makeSdk();
    await expect(sdk.resolveAlias()).resolves.toBe('dev');
  });

  it('onOrgChange passes null when connect fails', async () => {
    const nodeDeps = deps();
    const connections = new ConnectionManager(nodeDeps, async () => ({
      defaultOrg: '',
      apiVersion: '62.0'
    }));
    nodeDeps.execSf = async (args) => {
      if (args[0] === 'org' && args[1] === 'list') {
        return { code: 0, stdout: JSON.stringify({ result: { sandboxes: [] } }), stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'no' };
    };
    const { sdk, emitOrgChange } = createSalesforceSdk({
      connections,
      guardrail: new Guardrail(async () => ({ approved: true, reason: 'submitted' })),
      deps: nodeDeps,
      readSettings: async () => ({
        defaultOrg: '',
        apiVersion: '62.0',
        projectRoot: '',
        agentScriptDialect: 'agentforce'
      })
    });
    const seen: Array<unknown> = [];
    sdk.onOrgChange((org) => {
      seen.push(org);
    });
    emitOrgChange();
    await vi.waitFor(() => expect(seen).toEqual([null]));
  });

  it('fail-closes org.write when the operator denies', async () => {
    const { sdk } = makeSdk();
    const org = await sdk.connect();
    await expect(
      sdk.confirm(
        {
          orgAlias: org.alias,
          orgId: org.orgId,
          orgKind: org.kind,
          kind: 'org.write',
          summary: 'PATCH Account'
        },
        'thr-write'
      )
    ).resolves.toEqual({ approved: false, reason: 'denied' });
  });
});
