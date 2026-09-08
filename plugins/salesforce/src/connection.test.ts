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
    spawnContained: async () => ({ code: 1, stdout: '', stderr: 'no' }),
    writeFile: () => {
      throw new Error('writeFile not stubbed');
    }
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

  it('connects a requested alias without using the default', async () => {
    const seen: string[] = [];
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args[0] === 'org' && args[1] === 'display') {
            seen.push(args[args.indexOf('--target-org') + 1] ?? '');
            return { code: 0, stdout: displayJson(), stderr: '' };
          }
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: 'other', apiVersion: '62.0' })
    );
    const org = await manager.connect({ alias: 'dev' });
    expect(seen).toEqual(['dev']);
    expect(org.alias).toBe('dev');
  });

  it('requests a non-default alias and retries 401 against that alias', async () => {
    const seen: string[] = [];
    let calls = 0;
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args[0] === 'org' && args[1] === 'display') {
            const alias = args[args.indexOf('--target-org') + 1] ?? '';
            seen.push(alias);
            const parsed = JSON.parse(displayJson()) as { result: { alias: string } };
            parsed.result.alias = alias;
            return { code: 0, stdout: JSON.stringify(parsed), stderr: '' };
          }
          return { code: 1, stdout: '', stderr: 'no' };
        },
        request: () => {
          calls += 1;
          if (calls === 1) return { status: 401, json: [{ message: 'expired' }], text: '' };
          return { status: 200, json: { totalSize: 0, records: [] }, text: '{}' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    const { org, response } = await manager.request('/query', { method: 'GET', alias: 'prod' });
    expect(response.status).toBe(200);
    expect(org.alias).toBe('prod');
    expect(seen).toEqual(['prod', 'prod']);
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

  it('forwards a per-request API version to the REST transport', async () => {
    const seen: string[] = [];
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('display')) return { code: 0, stdout: displayJson(), stderr: '' };
          return { code: 1, stdout: '', stderr: 'no' };
        },
        request: (req) => {
          seen.push(req.apiVersion ?? '');
          return { status: 200, json: { id: 'run-1' }, text: '{}' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await manager.request('/einstein/ai-evaluations/runs', {
      method: 'POST',
      body: { aiEvaluationDefinitionName: 'My_Eval' },
      apiVersion: '63.0'
    });
    expect(seen).toEqual(['63.0']);
  });

  it('forwards PUT PATCH and DELETE methods', async () => {
    const seen: string[] = [];
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('display')) return { code: 0, stdout: displayJson(), stderr: '' };
          return { code: 1, stdout: '', stderr: 'no' };
        },
        request: (req) => {
          seen.push(req.method);
          return { status: 200, json: {}, text: '{}' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await manager.request('/sobjects/Account/001', { method: 'PATCH', body: { Name: 'n' } });
    await manager.request('/sobjects/Account/001', { method: 'DELETE' });
    await manager.request('/sobjects/Account/001', { method: 'PUT', body: { Name: 'n' } });
    expect(seen).toEqual(['PATCH', 'DELETE', 'PUT']);
  });

  it('forwards an AbortSignal on REST requests', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('display')) return { code: 0, stdout: displayJson(), stderr: '' };
          return { code: 1, stdout: '', stderr: 'no' };
        },
        request: (req) => {
          seen = req.signal;
          return { status: 200, json: {}, text: '{}' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await manager.request('/query', { method: 'GET', signal: controller.signal });
    expect(seen).toBe(controller.signal);
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

  it('reports a missing CLI when listing orgs', async () => {
    const manager = new ConnectionManager(
      deps({
        exec: () => ({ code: 127, stdout: '', stderr: '' })
      }),
      async () => ({ defaultOrg: '', apiVersion: '62.0' })
    );
    await expect(manager.listOrgs()).rejects.toMatchObject({ code: 'cli_missing' } satisfies Partial<ConnectionError>);
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

  it('reads a redacted org-display token from sf org auth show-access-token', async () => {
    const seen: string[][] = [];
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          seen.push(args);
          if (args[0] === 'org' && args[1] === 'display') {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: {
                  alias: 'gus',
                  username: 'dev@example.com',
                  orgId: '00Dxx0000000001',
                  instanceUrl: 'https://gus.my.salesforce.com',
                  accessToken: "[REDACTED] Use 'sf org auth show-access-token' to view",
                  apiVersion: '62.0',
                  isSandbox: false,
                  isScratchOrg: false
                }
              }),
              stderr: ''
            };
          }
          if (args[0] === 'org' && args[1] === 'auth' && args[2] === 'show-access-token') {
            return {
              code: 0,
              stdout: JSON.stringify({ result: { accessToken: '00Dxx!REAL' } }),
              stderr: ''
            };
          }
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: 'gus', apiVersion: '62.0' })
    );
    const org = await manager.connect();
    expect(org.accessToken).toBe('00Dxx!REAL');
    expect(org.instanceUrl).toBe('https://gus.my.salesforce.com');
    expect(seen.some((args) => args.includes('show-access-token'))).toBe(true);
  });

  it('does not call show-access-token when org display still has a real token', async () => {
    let tokenCalls = 0;
    const manager = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('show-access-token')) {
            tokenCalls += 1;
            return { code: 1, stdout: '', stderr: 'should not run' };
          }
          if (args.includes('display')) return { code: 0, stdout: displayJson(), stderr: '' };
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await expect(manager.connect()).resolves.toMatchObject({ accessToken: 'TOKEN' });
    expect(tokenCalls).toBe(0);
  });

  it('fails closed when show-access-token cannot supply a token', async () => {
    const missing = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('display')) {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: {
                  alias: 'dev',
                  username: 'dev@example.com',
                  instanceUrl: 'https://org.my.salesforce.com',
                  accessToken: '[REDACTED] hidden'
                }
              }),
              stderr: ''
            };
          }
          if (args.includes('show-access-token')) return { code: 1, stdout: '', stderr: 'not authed' };
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await expect(missing.connect()).rejects.toMatchObject({ code: 'org_display_failed', message: 'not authed' });

    const empty = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('display')) {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: {
                  alias: 'dev',
                  username: 'dev@example.com',
                  instanceUrl: 'https://org.my.salesforce.com'
                }
              }),
              stderr: ''
            };
          }
          if (args.includes('show-access-token')) {
            return { code: 0, stdout: JSON.stringify({ result: { accessToken: '[REDACTED] hidden' } }), stderr: '' };
          }
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await expect(empty.connect()).rejects.toMatchObject({ code: 'org_display_failed' });

    const blankFailure = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('display')) {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: {
                  alias: 'dev',
                  username: 'dev@example.com',
                  instanceUrl: 'https://org.my.salesforce.com'
                }
              }),
              stderr: ''
            };
          }
          if (args.includes('show-access-token')) return { code: 2, stdout: '', stderr: '' };
          return { code: 1, stdout: '', stderr: 'no' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await expect(blankFailure.connect()).rejects.toMatchObject({
      code: 'org_display_failed',
      message: 'sf org auth show-access-token failed (2)'
    });

    const cliGone = new ConnectionManager(
      deps({
        exec: (args) => {
          if (args.includes('display')) {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: {
                  alias: 'dev',
                  username: 'dev@example.com',
                  instanceUrl: 'https://org.my.salesforce.com'
                }
              }),
              stderr: ''
            };
          }
          return { code: 127, stdout: '', stderr: '' };
        }
      }),
      async () => ({ defaultOrg: 'dev', apiVersion: '62.0' })
    );
    await expect(cliGone.connect()).rejects.toMatchObject({ code: 'cli_missing' });
  });
});
