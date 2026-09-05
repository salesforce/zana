import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { ConnectionManager } from '../lib/connection.js';
import { parseSoqlApiError } from '../lib/soql-api-error.js';
import {
  filterSObjectList,
  normalizeSObjectDescribe,
  normalizeSObjectList,
  resolveSObjectEntry
} from '../lib/soql-describe.js';
import { SoqlExplorer } from '../lib/soql-explorer.js';
import { pushRecent } from '../lib/soql-history.js';
import { createSalesforcePlugin } from '../lib/plugin.js';
import type { SalesforceDeps, SalesforceRequest } from '../lib/types.js';
import { SOQL_HISTORY_RECENT_CAP } from '../lib/types.js';

function orgDisplay() {
  return JSON.stringify({
    result: {
      alias: 'dev',
      username: 'dev@example.com',
      orgId: '00Dxx0000000001',
      instanceUrl: 'https://foo--dev.sandbox.my.salesforce.com',
      accessToken: 'SECRET_TOKEN',
      apiVersion: '62.0',
      isSandbox: true,
      isScratchOrg: false
    }
  });
}

function mockDeps(rest?: (req: SalesforceRequest) => { status: number; json: unknown; text: string }): SalesforceDeps {
  return {
    execSf: async (args) => {
      if (args.includes('display')) return { code: 0, stdout: orgDisplay(), stderr: '' };
      if (args[0] === 'org' && args[1] === 'list') {
        return {
          code: 0,
          stdout: JSON.stringify({
            result: { sandboxes: [{ alias: 'dev', username: 'dev@example.com', isSandbox: true, isDefaultUsername: true }] }
          }),
          stderr: ''
        };
      }
      return { code: 1, stdout: '', stderr: 'unexpected' };
    },
    request: async (_org, req) =>
      rest?.(req) ?? { status: 200, json: { totalSize: 1, done: true, records: [{ Id: '001' }] }, text: '{}' },
    now: () => 1_700_000_000_000,
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

describe('describe helpers', () => {
  it('normalizes catalogs and prefers the tooling entry when asked', () => {
    const standard = normalizeSObjectList(
      { sobjects: [{ name: 'Account', label: 'Account', keyPrefix: '001', queryable: true }] },
      'standard'
    );
    const tooling = normalizeSObjectList(
      { sobjects: [{ name: 'Account', label: 'Account (T)', keyPrefix: '001', queryable: true }] },
      'tooling'
    );
    const catalogs = { standard, tooling };
    expect(resolveSObjectEntry('Account', false, catalogs)?.source).toBe('standard');
    expect(resolveSObjectEntry('Account', true, catalogs)?.label).toBe('Account (T)');
    expect(filterSObjectList(standard, 'acc')).toHaveLength(1);
    expect(filterSObjectList(standard, 'zzz')).toHaveLength(0);
  });

  it('keeps fields and child relationships from a describe payload', () => {
    const describe = normalizeSObjectDescribe(
      {
        name: 'Account',
        label: 'Account',
        fields: [
          { name: 'Id', label: 'Id', type: 'id', nillable: false, updateable: false },
          { name: 'Name', type: 'string', relationshipName: '', referenceTo: [] }
        ],
        childRelationships: [{ relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId' }]
      },
      'standard'
    );
    expect(describe.fields.map((row) => row.name)).toEqual(['Id', 'Name']);
    expect(describe.childRelationships[0]).toMatchObject({ relationshipName: 'Contacts', childSObject: 'Contact' });
  });
});

describe('history helpers', () => {
  it('dedupes identical recent queries and caps the list', () => {
    const first = pushRecent([], { soql: 'SELECT Id FROM Account', useToolingApi: false, includeDeleted: false, at: 1 });
    const second = pushRecent(first, {
      soql: 'SELECT Id FROM Account',
      useToolingApi: false,
      includeDeleted: false,
      at: 2
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.at).toBe(2);
    let items = second;
    for (let i = 0; i < SOQL_HISTORY_RECENT_CAP + 5; i += 1) {
      items = pushRecent(items, {
        soql: `SELECT Id FROM Account LIMIT ${i}`,
        useToolingApi: false,
        includeDeleted: false,
        at: i
      });
    }
    expect(items).toHaveLength(SOQL_HISTORY_RECENT_CAP);
  });
});

describe('parseSoqlApiError', () => {
  it('maps Salesforce line/column and errorCode', () => {
    expect(
      parseSoqlApiError(400, [{ message: 'unexpected token at row 2, column 8', errorCode: 'MALFORMED_QUERY' }], '')
    ).toMatchObject({ errorCode: 'MALFORMED_QUERY', line: 2, column: 8 });
  });
});

describe('SoqlExplorer', () => {
  it('describes, caches, queries, and refuses DML', async () => {
    const seen: string[] = [];
    const deps = mockDeps((req) => {
      seen.push(`${req.method} ${req.path}`);
      if (req.path === '/sobjects') {
        return { status: 200, json: { sobjects: [{ name: 'Account', label: 'Account' }] }, text: '{}' };
      }
      if (req.path === '/tooling/sobjects') {
        return { status: 200, json: { sobjects: [{ name: 'BotVersion', label: 'Bot Version' }] }, text: '{}' };
      }
      if (req.path.includes('/describe')) {
        return {
          status: 200,
          json: { name: 'Account', fields: [{ name: 'Id', type: 'id' }], childRelationships: [] },
          text: '{}'
        };
      }
      if (req.path === '/query' || req.path === '/queryAll' || req.path === '/tooling/query') {
        if (req.query?.explain) {
          return { status: 200, json: { plans: [{ cardinality: 1 }] }, text: '{}' };
        }
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
      if (req.path === '/limits') {
        return { status: 200, json: { DailyApiRequests: { Max: 15_000, Remaining: 14_900 } }, text: '{}' };
      }
      return { status: 404, json: [{ message: 'missing' }], text: '' };
    });
    const { zcc } = createFakePluginHost({ pluginId: 'salesforce' });
    const connections = new ConnectionManager(deps, async () => ({ defaultOrg: 'dev', apiVersion: '62.0' }));
    const explorer = new SoqlExplorer(connections, zcc.storage.kv, deps.now);

    const global1 = await explorer.describeGlobal({});
    const global2 = await explorer.describeGlobal({});
    expect(global1).toMatchObject({ ok: true });
    expect(seen.filter((row) => row.endsWith('/sobjects')).length).toBe(2);
    expect(global2).toMatchObject({ ok: true });
    expect(seen.filter((row) => row.endsWith('/sobjects')).length).toBe(2);

    await explorer.describeGlobal({ forceRefresh: true });
    expect(seen.filter((row) => row.endsWith('/sobjects')).length).toBe(4);

    const described = await explorer.describeSObject({ sobject: 'Account' });
    expect(described).toMatchObject({ ok: true, describe: { name: 'Account' } });

    const dml = await explorer.query({ soql: 'DELETE FROM Account' });
    expect(dml).toMatchObject({ ok: false, code: 'invalid_input' });

    const ran = await explorer.query({ soql: 'SELECT Id FROM Account', requestId: 'r1' });
    expect(ran).toMatchObject({
      ok: true,
      sobjectName: 'Account',
      nextRecordsUrl: '/services/data/v62.0/query/01gxx-2000'
    });

    const more = await explorer.queryMore({
      nextRecordsUrl: 'https://evil.example/services/data/v62.0/query/01gxx-2000'
    });
    expect(more).toMatchObject({ ok: false, code: 'host_mismatch' });

    const next = await explorer.queryMore({
      nextRecordsUrl: '/services/data/v62.0/query/01gxx-2000'
    });
    expect(next).toMatchObject({ ok: true, done: true });
    expect((next as { records?: unknown[] }).records).toEqual([{ Id: '002' }]);

    const explained = await explorer.explain({ soql: 'SELECT Id FROM Account' });
    expect(explained).toMatchObject({ ok: true });

    const limits = await explorer.limits();
    expect(limits).toMatchObject({ ok: true, dailyApiRequests: { max: 15_000, remaining: 14_900 } });

    const saved = await explorer.historySave({ kind: 'saved', name: 'Accounts', soql: 'SELECT Id FROM Account' });
    expect(saved).toMatchObject({ ok: true });
    const listed = await explorer.historyList();
    expect(listed).toMatchObject({ ok: true });
    if (listed.ok) {
      expect(listed.recent[0]?.soql).toContain('SELECT Id FROM Account');
      expect(listed.saved[0]?.name).toBe('Accounts');
    }
    const removed = await explorer.historyRemove({ kind: 'saved', id: saved.ok ? saved.item.id : '' });
    expect(removed.ok && removed.saved).toEqual([]);
  });

  it('aborts an in-flight query and maps API errors', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pendingDeps: SalesforceDeps = {
      ...mockDeps(),
      request: async (_org, req) => {
        if (req.path === '/query') {
          await new Promise<void>((resolve, reject) => {
            if (req.signal?.aborted) {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
              return;
            }
            req.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
            void gate.then(() => resolve());
          });
        }
        return {
          status: 400,
          json: [{ message: 'bad at row 1, column 4', errorCode: 'MALFORMED_QUERY' }],
          text: ''
        };
      }
    };
    const { zcc } = createFakePluginHost({ pluginId: 'salesforce' });
    const connections = new ConnectionManager(pendingDeps, async () => ({ defaultOrg: 'dev', apiVersion: '62.0' }));
    const explorer = new SoqlExplorer(connections, zcc.storage.kv, pendingDeps.now);
    const pending = explorer.query({ soql: 'SELECT Id FROM Account', requestId: 'run-1' });
    await Promise.resolve();
    expect(explorer.abort({ requestId: 'run-1' })).toEqual({ ok: true, aborted: true });
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'aborted' });
    release?.();

    const failed = await explorer.query({ soql: 'SELECT Id FROM Account' });
    expect(failed).toMatchObject({ ok: false, code: 'MALFORMED_QUERY', line: 1, column: 4 });
  });
});

describe('soql explorer RPC registration', () => {
  it('exposes explorer methods on the plugin host', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce' });
    await createSalesforcePlugin(zcc, mockDeps());
    harness.setSettings({ defaultOrg: 'dev' });
    const result = await harness.callRpc('soql.query', { soql: 'SELECT Id FROM Account LIMIT 1' });
    expect(result).toMatchObject({ ok: true, sobjectName: 'Account' });
    expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
    await expect(harness.callRpc('soql.abort', { requestId: 'missing' })).resolves.toEqual({
      ok: true,
      aborted: false
    });
  });
});
