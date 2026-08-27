import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionError, ConnectionManager } from '../lib/connection.js';
import { publicOrgView } from '../lib/org-resolution.js';
import type { SalesforceDeps, SalesforceRequest } from '../lib/types.js';

function displayJson(kind: 'sandbox' | 'production' = 'sandbox') {
  return JSON.stringify({
    result: {
      alias: 'dev',
      username: 'dev@example.com',
      orgId: '00Dxx0000000001',
      instanceUrl:
        kind === 'sandbox' ? 'https://foo--dev.sandbox.my.salesforce.com' : 'https://org.my.salesforce.com',
      accessToken: 'TOKEN',
      apiVersion: '62.0',
      isSandbox: kind === 'sandbox',
      isScratchOrg: false
    }
  });
}

function deps(handlers: {
  exec?: (args: string[]) => { code: number; stdout: string; stderr: string };
  request?: (req: SalesforceRequest) => { status: number; json: unknown; text: string };
}): SalesforceDeps {
  return {
    execSf: async (args) => handlers.exec?.(args) ?? { code: 1, stdout: '', stderr: 'unexpected sf' },
    request: async (_org, req) =>
      handlers.request?.(req) ?? { status: 200, json: {}, text: '{}' },
    now: () => 1,
    exists: () => false,
    stat: () => 'missing',
    readFile: () => null,
    readdir: () => [],
    realpath: (path) => path,
    spawnContained: async () => ({ code: 1, stdout: '', stderr: 'no' })
  };
}

describe('connection manager', () => {
  beforeEach(() => {
    vi.stubEnv('SF_TARGET_ORG', '');
    vi.stubEnv('SFDX_DEFAULTUSERNAME', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the setting alias and caches org display', async () => {
    let displays = 0;
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args[0] === 'org' && args[1] === 'display') {
            displays += 1;
            return { code: 0, stdout: displayJson(), stderr: '' };
          }
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    const first = await manager.connect();
    const second = await manager.connect();
    expect(displays).toBe(1);
    expect(publicOrgView(first)).not.toHaveProperty('accessToken');
    expect(JSON.stringify(publicOrgView(first))).not.toContain('TOKEN');
    expect(second.alias).toBe('dev');
  });

  it('refreshes after 401', async () => {
    let displays = 0;
    let calls = 0;
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('display')) {
            displays += 1;
            return { code: 0, stdout: displayJson(), stderr: '' };
          }
          return { code: 1, stdout: '', stderr: 'no' };
        },
        request: () => {
          calls += 1;
          if (calls === 1) return { status: 401, json: [{ message: 'expired' }], text: '' };
          return { status: 200, json: { sobjects: [] }, text: '{}' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    const { response } = await manager.request('/sobjects', { method: 'GET' });
    expect(response.status).toBe(200);
    expect(displays).toBe(2);
  });

  it('fails closed when CLI is missing', async () => {
    const manager = new ConnectionManager(
      deps({
        exec: () => ({ code: 127, stdout: '', stderr: '' })
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await expect(manager.connect()).rejects.toMatchObject({ code: 'cli_missing' } satisfies Partial<ConnectionError>);
  });

  it('fails when no alias can be resolved', async () => {
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args[0] === 'org' && args[1] === 'list') {
            return { code: 0, stdout: JSON.stringify({ result: { nonScratchOrgs: [] } }), stderr: '' };
          }
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: '', apiVersion: '62.0' })
    );
    await expect(manager.connect()).rejects.toMatchObject({ code: 'no_org' });
  });

  it('fails when org display is unusable', async () => {
    const missing = new ConnectionManager(
      deps({
        exec: () => ({ code: 1, stdout: '', stderr: 'not authed' })
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await expect(missing.connect()).rejects.toMatchObject({ code: 'org_display_failed' });

    const empty = new ConnectionManager(
      deps({
        exec: () => ({ code: 0, stdout: '{"result":{"username":"x"}}', stderr: '' })
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: 'v62.0' })
    );
    await expect(empty.connect()).rejects.toMatchObject({ code: 'org_display_failed' });
  });

  it('falls back to the CLI default alias and can invalidate one cache entry', async () => {
    let now = 1;
    let lists = 0;
    const manager = new ConnectionManager(
      {
        ...deps({
          exec: (args) => {
            if (args[0] === 'org' && args[1] === 'list') {
              lists += 1;
              return {
                code: 0,
                stdout: JSON.stringify({
                  result: [{ alias: 'cli-default', username: 'c@x.com', isDefaultUsername: true, isSandbox: true }]
                }),
                stderr: ''
              };
            }
            if (args.includes('display')) {
              return { code: 0, stdout: displayJson(), stderr: '' };
            }
            return { code: 1, stdout: '', stderr: 'no' };
          }
        }),
        now: () => now
      },
      async () => ({ defaultOrg: '', apiVersion: '62.0' })
    );
    await expect(manager.connect()).resolves.toMatchObject({ alias: 'dev' });
    manager.invalidate('dev');
    now = 1;
    await manager.connect();
    expect(lists).toBeGreaterThan(0);
    const failedList = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args[0] === 'org' && args[1] === 'list') return { code: 1, stdout: '', stderr: 'no' };
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: '', apiVersion: '62.0' })
    );
    await expect(failedList.connect()).rejects.toMatchObject({ code: 'no_org' });
  });
});
